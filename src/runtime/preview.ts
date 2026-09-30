import * as THREE from "three/webgpu";
import { checker, color, float, mix, positionGeometry, uv, vec2, vec3, vec4 } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { PreviewSettings } from "../core/types";
import { PREVIEW_SIZE, paceFrame } from "./preview-size";
import { evaluateMaterial, evaluatePost, setTextureLoadedHandler, type MaterialResult, type PostResult } from "./scope";

const DREI = "https://raw.githack.com/pmndrs/drei-assets/456060a26bbeb8fdf79326f224b6d99b8bcce736/hdri/";
const POLY = "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/";

export const ENVIRONMENTS: { value: string; label: string; url?: string }[] = [
  { value: "none", label: "None" },
  { value: "apartment", label: "Apartment", url: DREI + "lebombo_1k.hdr" },
  { value: "bridge", label: "Bridge", url: POLY + "rainforest_trail_1k.hdr" },
  { value: "city", label: "City", url: DREI + "potsdamer_platz_1k.hdr" },
  { value: "dawn", label: "Dawn", url: DREI + "kiara_1_dawn_1k.hdr" },
  { value: "esplanade", label: "Esplanade", url: POLY + "shanghai_bund_1k.hdr" },
  { value: "forest", label: "Forest", url: DREI + "forest_slope_1k.hdr" },
  { value: "hall", label: "Hall", url: POLY + "photo_studio_loft_hall_1k.hdr" },
  { value: "lab", label: "Lab", url: POLY + "brown_photostudio_02_1k.hdr" },
  { value: "lobby", label: "Lobby", url: DREI + "st_fagans_interior_1k.hdr" },
  { value: "night", label: "Night", url: DREI + "dikhololo_night_1k.hdr" },
  { value: "park", label: "Park", url: DREI + "rooitou_park_1k.hdr" },
  { value: "sky", label: "Sky", url: POLY + "kloofendal_48d_partly_cloudy_puresky_1k.hdr" },
  { value: "studio", label: "Studio", url: DREI + "studio_small_03_1k.hdr" },
  { value: "sunrise", label: "Sunrise", url: POLY + "spruit_sunrise_1k.hdr" },
  { value: "sunset", label: "Sunset", url: DREI + "venice_sunset_1k.hdr" },
  { value: "venice", label: "Venice", url: DREI + "venice_sunset_1k.hdr" },
  { value: "warehouse", label: "Warehouse", url: DREI + "empty_warehouse_01_1k.hdr" },
  { value: "workshop", label: "Workshop", url: POLY + "autoshop_01_1k.hdr" },
];

export interface PreviewStatus {
  errors: string[];
  backend: string;
}

/**
 * `values`: the node shows a value readout, so compute stats and keep the raw pixels.
 * `animated`: its output can change every frame (e.g. depends on time), so live previews
 * redraw it continuously; others only redraw when out of date.
 */
type DebugTarget = { canvas: HTMLCanvasElement; type: string; values?: boolean; animated?: boolean };

/** What a node's output looked like across the thumbnail. */
export interface DebugStats {
  type: string;
  /** Meaningful components: 1 for scalars, 2-4 for vectors. */
  comps: number;
  /** Every pixel had the same value. */
  constant: boolean;
  min: number[];
  max: number[];
}

/** Node preview refresh rate. */
const PREVIEW_FPS = 30;

function componentCount(t: string): number {
  if (t === "vec2" || t === "ivec2" || t === "uvec2") return 2;
  if (t === "vec4" || t === "ivec4" || t === "uvec4") return 4;
  if (t === "float" || t === "int" || t === "uint" || t === "bool") return 1;
  return 3;
}

export class PreviewRenderer {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  controls!: OrbitControls;
  mesh!: THREE.Mesh;
  grid = new THREE.GridHelper(10, 20, 0x444444, 0x222222);
  backdrop?: THREE.Mesh;
  ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  light = new THREE.DirectionalLight(0xffffff, 2);
  lightHelper?: THREE.DirectionalLightHelper;
  pipeline?: THREE.RenderPipeline;
  settings!: PreviewSettings;
  materialResult?: MaterialResult;
  postResult?: PostResult;
  ready: Promise<void>;
  private fallbackMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x888888 });
  private envCache = new Map<string, THREE.Texture>();
  private envToken = 0;
  private resizeObserver: ResizeObserver;
  private debugTargets = new Map<string, DebugTarget>();
  private debugMesh = new THREE.QuadMesh(new THREE.MeshBasicNodeMaterial());
  // one float target per previewed node (so they can all be read back at once), float so
  // previews can report the real output values, not 8-bit colours
  private debugRTs = new Map<string, THREE.RenderTarget>();
  /** Called after each thumbnail render with value stats and the raw pixels (RGBA, top row first). */
  onDebugStats?: (id: string, stats: DebugStats, pixels: Float32Array) => void;
  private debugBusy = false;
  private lastDebug = 0;
  /** Live: previews animate at PREVIEW_FPS. Otherwise they only redraw when out of date. */
  private debugLive = true;
  /** Bumped when what previews show may have changed (recompile, uniform edit). */
  private contentVersion = 0;
  /** What each preview last drew: the content version, and onto which canvas. */
  private drawn = new Map<string, { version: number; canvas: HTMLCanvasElement }>();
  private lastStaleCheck = 0;
  private disposed = false;
  onError: (errors: string[]) => void = () => {};
  onFrame?: () => void;
  /**
   * The main view only re-renders when something changed or can change on its own: an
   * edit, the camera moving, or an animated material/post graph (see setMainAnimated).
   * An idle scene then costs no GPU time.
   */
  private mainDirty = true;
  private mainAnimated = true;
  /** Frame-rate cap for the main view (the display's refresh rate is the real ceiling). */
  private maxFps = 60;
  private nextMainFrame = 0;

  constructor(
    private container: HTMLElement,
    settings: PreviewSettings,
  ) {
    this.settings = settings;
    this.camera.position.set(0, 0.5, 6.2);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.ready = this.init();
  }

  private async init() {
    const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
    await renderer.init();
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    const el = renderer.domElement;
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.display = "block";
    this.container.appendChild(el);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    // the directional light aims at its target, which stays at the origin (the object)
    this.scene.add(this.ambient, this.light, this.light.target);
    this.grid.position.y = -1.2;
    this.scene.add(this.grid);

    this.mesh = new THREE.Mesh(this.buildGeometry(this.settings), this.fallbackMaterial);
    this.scene.add(this.mesh);
    this.applySettings(this.settings, true);
    // textures load asynchronously: redraw once they arrive
    setTextureLoadedHandler(() => this.invalidate());

    this.resizeObserver.observe(this.container);
    this.resize();
    renderer.setAnimationLoop(() => this.frame());
  }

  get backend(): string {
    const b = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } })?.backend;
    return b?.isWebGPUBackend ? "WebGPU" : "WebGL2";
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  /** Redraw the main view on the next frame. */
  invalidate() {
    this.mainDirty = true;
  }

  /** Whether the shown material/post graph changes every frame (e.g. uses time). */
  setMainAnimated(animated: boolean) {
    this.mainAnimated = animated;
    this.invalidate();
  }

  /** Cap the main view's frame rate (frames per second). */
  setMaxFps(fps: number) {
    this.maxFps = Math.max(1, fps);
    this.nextMainFrame = 0;
  }

  private frame() {
    if (!this.renderer) return;
    const now = performance.now();
    // frame cap: skip this display frame if the main view's next slot isn't due yet
    const pace = paceFrame(now, this.nextMainFrame, 1000 / this.maxFps);
    this.nextMainFrame = pace.nextSlot;
    if (pace.render) this.renderMain();
    this.onFrame?.();
    this.scheduleDebug(now);
  }

  private renderMain() {
    // update() reports camera movement, including damping after the pointer is released
    const moved = this.controls.update();
    if (moved || this.mainDirty || this.mainAnimated) {
      this.mainDirty = false;
      try {
        if (this.pipeline && this.settings.enablePost) this.pipeline.render();
        else this.renderer.render(this.scene, this.camera);
      } catch (err) {
        this.onError([`Render: ${err instanceof Error ? err.message : String(err)}`]);
      }
    }
  }

  /** Node previews run on their own clock (PREVIEW_FPS), independent of the main cap. */
  private scheduleDebug(now: number) {
    if (this.debugTargets.size && !this.debugBusy) {
      if (this.debugLive) {
        // animated previews run at PREVIEW_FPS; static ones only when out of date
        if (now - this.lastDebug >= 1000 / PREVIEW_FPS - 2) {
          this.lastDebug = now;
          if ([...this.debugTargets].some(([id, t]) => t.animated || this.isStale(id, t))) void this.renderDebug(false);
        }
      } else if (now - this.lastStaleCheck >= 150) {
        // still images: only redraw previews that are out of date (or newly on screen)
        this.lastStaleCheck = now;
        if ([...this.debugTargets].some(([id, t]) => this.isStale(id, t))) void this.renderDebug(true);
      }
    }
  }

  // -------------------------------------------------------------------------
  // graph application
  // -------------------------------------------------------------------------

  /** Evaluate compiled bodies. Returns error strings (empty on success). */
  apply(materialBody: string, postBody: string | null, signatures?: Map<string, string>): string[] {
    const errors: string[] = [];
    if (!this.renderer) return errors;
    this.contentVersion++;
    this.nodeSignatures = signatures;
    this.invalidate();
    try {
      const res = evaluateMaterial(materialBody);
      this.materialResult = res;
      const mat = res.material ?? this.fallbackMaterial;
      if (this.mesh.material !== mat) {
        const old = this.mesh.material as THREE.Material;
        this.mesh.material = mat;
        if (old !== this.fallbackMaterial) old.dispose();
      }
      this.syncQuad();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    try {
      if (postBody) {
        const res = evaluatePost(postBody, this.scene, this.camera, this.renderer);
        this.postResult = res;
        if (res.outputNode) {
          this.pipeline ??= new THREE.RenderPipeline(this.renderer);
          this.pipeline.outputNode = res.outputNode as THREE.Node;
          const tm = res.toneMapping;
          this.renderer.toneMapping = ((THREE as unknown as Record<string, number>)[tm.toneMapping] ?? THREE.NoToneMapping) as THREE.ToneMapping;
          this.renderer.toneMappingExposure = Number(tm.exposure) || 1;
          this.pipeline.needsUpdate = true;
        } else this.clearPost();
      } else this.clearPost();
    } catch (err) {
      errors.push(`Post: ${err instanceof Error ? err.message : String(err)}`);
      this.clearPost();
    }
    return errors;
  }

  private clearPost() {
    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = undefined;
    }
    this.postResult = undefined;
    if (this.renderer) this.renderer.toneMapping = THREE.NoToneMapping;
  }

  /** Live-update a uniform without recompiling. Returns false if not found. */
  setUniform(key: string, value: unknown): boolean {
    let found = false;
    // kept preview materials may still read the uniforms of an earlier evaluation
    const maps = new Set([this.materialResult?.uniforms, this.postResult?.uniforms, ...[...this.debugMats.values()].map((e) => e.uniforms)]);
    for (const uniforms of maps) {
      const u = uniforms?.[key];
      if (!u) continue;
      found = true;
      this.contentVersion++;
      this.invalidate();
      const cur = u.value as { isColor?: boolean; isVector2?: boolean; set?: (...a: unknown[]) => void } | number;
      if (typeof cur === "object" && cur?.isColor) (cur as unknown as THREE.Color).set(String(value));
      else if (typeof cur === "object" && cur && Array.isArray(value)) (cur as unknown as THREE.Vector3).fromArray(value as number[]);
      else u.value = typeof cur === "boolean" ? Boolean(value) : Number(value);
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // settings
  // -------------------------------------------------------------------------

  applySettings(s: PreviewSettings, force = false) {
    const prev = this.settings;
    this.settings = s;
    if (!this.renderer) return;
    this.invalidate();
    const geoChanged =
      force ||
      prev.geometry !== s.geometry ||
      JSON.stringify(prev.geometryParams) !== JSON.stringify(s.geometryParams) ||
      prev.geometryScript !== s.geometryScript ||
      prev.instancing !== s.instancing ||
      prev.instanceCount !== s.instanceCount;
    if (geoChanged) this.rebuildMesh();
    this.grid.visible = s.showGrid;
    this.applyLights(s);
    if (force || prev.environment !== s.environment || prev.showBackground !== s.showBackground) void this.loadEnv();
    this.scene.environmentIntensity = s.envIntensity;
    this.scene.backgroundIntensity = s.envIntensity;
    if (s.showBackdrop && !this.backdrop) {
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = mix(color(0x1a1f2b), color(0x3a4256), checker(uv().mul(vec2(24, 16))));
      this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), m);
      this.backdrop.position.z = -3;
      this.scene.add(this.backdrop);
    }
    if (this.backdrop) this.backdrop.visible = s.showBackdrop;
  }

  /** Directional light placed on a sphere around the object from azimuth/elevation. */
  private applyLights(s: PreviewSettings) {
    const radius = 7;
    const az = THREE.MathUtils.degToRad(s.lightAzimuth);
    const el = THREE.MathUtils.degToRad(s.lightElevation);
    this.light.position.set(radius * Math.cos(el) * Math.sin(az), radius * Math.sin(el), radius * Math.cos(el) * Math.cos(az));
    this.light.color.set(s.lightColor);
    this.light.intensity = s.lightIntensity;
    this.light.visible = s.lightEnabled;
    this.ambient.intensity = s.ambientIntensity;
    if (s.showLightHelper && s.lightEnabled) {
      if (!this.lightHelper) {
        this.lightHelper = new THREE.DirectionalLightHelper(this.light, 0.6);
        this.scene.add(this.lightHelper);
      }
      this.lightHelper.visible = true;
      this.lightHelper.update();
    } else if (this.lightHelper) {
      this.lightHelper.visible = false;
    }
  }

  geometryError?: string;

  private buildGeometry(s: PreviewSettings): THREE.BufferGeometry {
    this.geometryError = undefined;
    const base = this.baseGeometry(s);
    const script = s.geometryScript?.trim();
    if (!script) return base;
    // like the original, the script modifies the chosen geometry; returning a new one also works
    try {
      const out = new Function("THREE", "geometry", script)(THREE, base);
      if (out && (out as THREE.BufferGeometry).isBufferGeometry) {
        if (out !== base) base.dispose();
        return out as THREE.BufferGeometry;
      }
      if (out !== undefined) throw new Error("Script must modify `geometry` or return a BufferGeometry");
      return base;
    } catch (err) {
      this.geometryError = err instanceof Error ? err.message : String(err);
      return base;
    }
  }

  private baseGeometry(s: PreviewSettings): THREE.BufferGeometry {
    const p = s.geometryParams as Record<string, number>;
    switch (s.geometry) {
      case "box":
        return new THREE.BoxGeometry(
          p.width ?? 1.6,
          p.height ?? 1.6,
          p.depth ?? 1.6,
          p.widthSegments ?? p.segments ?? 1,
          p.heightSegments ?? p.segments ?? 1,
          p.depthSegments ?? p.segments ?? 1,
        );
      case "fullscreenQuad":
        return new THREE.PlaneGeometry(2, 2);
      case "torus":
        return new THREE.TorusGeometry(p.radius ?? 1, p.tube ?? 0.4, p.radialSegments ?? 32, p.tubularSegments ?? 96);
      case "torusKnot":
        return new THREE.TorusKnotGeometry(p.radius ?? 0.8, p.tube ?? 0.28, p.tubularSegments ?? 160, p.radialSegments ?? 24);
      case "plane":
        return new THREE.PlaneGeometry(p.width ?? 2.4, p.height ?? 2.4, p.widthSegments ?? 64, p.heightSegments ?? 64);
      case "cylinder":
        return new THREE.CylinderGeometry(
          p.radiusTop ?? 0.8,
          p.radiusBottom ?? 0.8,
          p.height ?? 2,
          p.radialSegments ?? 48,
          p.heightSegments ?? 1,
          Boolean(s.geometryParams.openEnded),
        );
      case "icosahedron":
        return new THREE.IcosahedronGeometry(p.radius ?? 1.2, p.detail ?? 0);
      default: // sphere (and the legacy "script" kind, whose script now runs as a modifier)
        return new THREE.SphereGeometry(p.radius ?? 1.2, p.widthSegments ?? 64, p.heightSegments ?? 64);
    }
  }

  private rebuildMesh() {
    const material = this.mesh.material;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    const geo = this.buildGeometry(this.settings);
    if (this.settings.instancing) {
      const count = Math.max(1, Math.min(100000, Math.round(this.settings.instanceCount)));
      const im = new THREE.InstancedMesh(geo, material, count);
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) im.setMatrixAt(i, m);
      this.mesh = im;
    } else {
      this.mesh = new THREE.Mesh(geo, material);
    }
    this.scene.add(this.mesh);
    this.syncQuad();
  }

  /** Vertex stage that places the 2x2 plane straight into clip space, covering the viewport. */
  private quadVertex = vec4(positionGeometry.xy, 0, 1);
  private userVertex = new WeakMap<THREE.Material, unknown>();

  /** Fullscreen Quad: override the material's vertex stage; restore it for other geometries. */
  private syncQuad() {
    const on = this.settings.geometry === "fullscreenQuad";
    this.mesh.frustumCulled = !on;
    const mat = this.mesh.material as THREE.NodeMaterial;
    const cur = (mat as unknown as { vertexNode: unknown }).vertexNode;
    if (on && cur !== this.quadVertex) {
      this.userVertex.set(mat, cur ?? null);
      (mat as unknown as { vertexNode: unknown }).vertexNode = this.quadVertex;
      mat.needsUpdate = true;
    } else if (!on && cur === this.quadVertex) {
      (mat as unknown as { vertexNode: unknown }).vertexNode = this.userVertex.get(mat) ?? null;
      mat.needsUpdate = true;
    }
  }

  private async loadEnv() {
    const token = ++this.envToken;
    const s = this.settings;
    const preset = ENVIRONMENTS.find((e) => e.value === s.environment);
    if (!preset || preset.value === "none") {
      this.scene.environment = null;
      this.scene.background = null;
      this.invalidate();
      return;
    }
    let tex = this.envCache.get(preset.value);
    if (!tex) {
      try {
        tex = await new HDRLoader().loadAsync(preset.url!);
        tex.mapping = THREE.EquirectangularReflectionMapping;
      } catch {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      }
      this.envCache.set(preset.value, tex);
    }
    if (token !== this.envToken) return;
    this.scene.environment = tex;
    this.scene.background = s.showBackground ? tex : null;
    this.invalidate();
  }

  // -------------------------------------------------------------------------
  // snapshots + debug previews
  // -------------------------------------------------------------------------

  async snapshot(width?: number, height?: number, withPost = true): Promise<string> {
    await this.ready;
    const r = this.renderer;
    const canvas = r.domElement;
    if (width && height) {
      const prevSize = r.getSize(new THREE.Vector2());
      const prevRatio = r.getPixelRatio();
      r.setPixelRatio(1);
      r.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      if (this.pipeline && withPost && this.settings.enablePost) this.pipeline.render();
      else r.render(this.scene, this.camera);
      const url = canvas.toDataURL("image/png");
      r.setPixelRatio(prevRatio);
      r.setSize(prevSize.x, prevSize.y, false);
      this.resize();
      return url;
    }
    if (this.pipeline && withPost && this.settings.enablePost) this.pipeline.render();
    else r.render(this.scene, this.camera);
    return canvas.toDataURL("image/png");
  }

  /** Small JPEG for dashboard thumbnails. */
  async thumbnail(): Promise<string> {
    const url = await this.snapshot();
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0b0f18";
    ctx.fillRect(0, 0, c.width, c.height);
    const scale = Math.max(c.width / img.width, c.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.8);
  }

  setDebugTargets(targets: Map<string, DebugTarget>) {
    this.debugTargets = targets;
    for (const id of this.drawn.keys()) if (!targets.has(id)) this.drawn.delete(id);
  }

  /** Animate node previews (zoomed in) or keep still images that refresh only on changes. */
  setDebugLive(live: boolean) {
    this.debugLive = live;
  }

  private isStale(id: string, target: DebugTarget) {
    const d = this.drawn.get(id);
    return !d || d.version !== this.contentVersion || d.canvas !== target.canvas;
  }

  /**
   * Preview materials by node id. Each recompile re-evaluates the whole graph, but a node
   * whose signature (itself + everything upstream, see graph.nodeSignatures) is unchanged
   * keeps its material, so only previews downstream of an edit need new shaders. A kept
   * material still reads the uniforms of the evaluation that built it (see setUniform).
   */
  private debugMats = new Map<
    string,
    { node: unknown; sig?: string; type: string; mat: THREE.MeshBasicNodeMaterial; uniforms: MaterialResult["uniforms"] }
  >();
  private nodeSignatures?: Map<string, string>;
  /** New preview shaders built per pass; the rest wait, so big changes fill in progressively. */
  private static readonly MAX_NEW_PREVIEWS_PER_PASS = 6;

  private debugMaterialFresh(id: string, node: unknown, t: string) {
    const cached = this.debugMats.get(id);
    if (!cached || cached.type !== t) return false;
    const sig = this.nodeSignatures?.get(id);
    return sig !== undefined && cached.sig !== undefined ? cached.sig === sig : cached.node === node;
  }

  private debugMaterial(id: string, node: THREE.Node, t: string) {
    const cached = this.debugMats.get(id);
    if (cached && this.debugMaterialFresh(id, node, t)) return cached.mat;
    cached?.mat.dispose();
    const mat = new THREE.MeshBasicNodeMaterial();
    const n = node as unknown as ReturnType<typeof vec4>;
    const sc = node as unknown as ReturnType<typeof float>;
    const comps = componentCount(t);
    // write the raw value (no lighting, colour space or tone mapping) so it can be read back exactly
    mat.fragmentNode =
      comps === 1 ? vec4(vec3(float(sc)), 1) : comps === 2 ? vec4(n.x, n.y, 0, 1) : comps === 4 ? vec4(n) : vec4(vec3(n), 1);
    mat.blending = THREE.NoBlending;
    mat.side = THREE.DoubleSide;
    this.debugMats.set(id, { node, sig: this.nodeSignatures?.get(id), type: t, mat, uniforms: this.materialResult?.uniforms ?? {} });
    return mat;
  }

  private async renderDebug(onlyStale: boolean) {
    const res = this.materialResult;
    if (!res || !this.renderer) return;
    this.debugBusy = true;
    const version = this.contentVersion;
    const S = PREVIEW_SIZE;
    try {
      for (const [id, entry] of this.debugMats) {
        if (!this.debugTargets.has(id) || !res.nodes[id]) {
          entry.mat.dispose();
          this.debugMats.delete(id);
        }
      }
      for (const [id, rt] of this.debugRTs) {
        if (!this.debugTargets.has(id)) {
          rt.dispose();
          this.debugRTs.delete(id);
        }
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const r = this.renderer;
      // render every visible preview first, then read them all back together, so the
      // refresh rate doesn't drop with each extra preview on screen
      const jobs: { id: string; target: DebugTarget; rt: THREE.RenderTarget }[] = [];
      const prev = r.getRenderTarget();
      let built = 0;
      for (const [id, target] of this.debugTargets) {
        if ((onlyStale || !target.animated) && !this.isStale(id, target)) continue;
        const node = res.nodes[id] as THREE.Node | undefined;
        if (!node) continue;
        // skip previews scrolled or zoomed out of view (value-only previews hide the canvas, so use its box)
        const r0 = (target.canvas.parentElement ?? target.canvas).getBoundingClientRect();
        if (r0.width < 4 || r0.right < 0 || r0.bottom < 0 || r0.left > vw || r0.top > vh) continue;
        if (!this.debugMaterialFresh(id, node, target.type)) {
          // a new shader to compile: cap these per pass and leave the rest for the next one
          if (built >= PreviewRenderer.MAX_NEW_PREVIEWS_PER_PASS) continue;
          built++;
        }
        let rt = this.debugRTs.get(id);
        if (!rt) {
          rt = new THREE.RenderTarget(S, S, { type: THREE.FloatType });
          this.debugRTs.set(id, rt);
        }
        this.debugMesh.material = this.debugMaterial(id, node, target.type);
        r.setRenderTarget(rt);
        this.debugMesh.render(r);
        jobs.push({ id, target, rt });
      }
      r.setRenderTarget(prev);
      const results = await Promise.all(jobs.map((j) => r.readRenderTargetPixelsAsync(j.rt, 0, 0, S, S) as Promise<Float32Array>));
      jobs.forEach(({ id, target }, k) => {
        this.drawn.set(id, { version, canvas: target.canvas });
        const raw = results[k];
        // rows may be padded (WebGPU aligns them to 256 bytes); WebGL reads bottom-up
        const stride = (raw.length - S * 4) / (S - 1);
        const flip = this.backend === "WebGL2";
        const pixels = new Float32Array(S * S * 4);
        for (let y = 0; y < S; y++) {
          const src = (flip ? S - 1 - y : y) * stride;
          pixels.set(raw.subarray(src, src + S * 4), y * S * 4);
        }
        const comps = componentCount(target.type);
        if (target.values) {
          const min = Array(comps).fill(Infinity);
          const max = Array(comps).fill(-Infinity);
          let nan = false;
          for (let i = 0; i < pixels.length; i += 4) {
            for (let c = 0; c < comps; c++) {
              const v = pixels[i + c];
              if (Number.isNaN(v)) nan = true;
              else {
                if (v < min[c]) min[c] = v;
                if (v > max[c]) max[c] = v;
              }
            }
          }
          if (nan) for (let c = 0; c < comps; c++) min[c] = max[c] = NaN;
          const constant = nan || min.every((lo, c) => Math.abs(max[c] - lo) <= 1e-5 * Math.max(1, Math.abs(lo)));
          this.onDebugStats?.(id, { type: target.type, comps, constant, min, max }, pixels);
        }
        // value-only previews hide their picture; skip drawing what isn't shown
        if (target.canvas.clientWidth === 0) return;
        const ctx = target.canvas.getContext("2d");
        if (!ctx) return;
        const img = ctx.createImageData(S, S);
        const one = comps === 1;
        for (let i = 0; i < pixels.length; i += 4) {
          img.data[i] = Math.min(1, Math.max(0, pixels[i])) * 255;
          img.data[i + 1] = Math.min(1, Math.max(0, pixels[one ? i : i + 1])) * 255;
          img.data[i + 2] = Math.min(1, Math.max(0, pixels[one ? i : i + 2])) * 255;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      });
    } catch {
      // debug previews are best-effort
    } finally {
      this.debugBusy = false;
    }
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    if (!this.renderer) return;
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.pipeline?.dispose();
    for (const rt of this.debugRTs.values()) rt.dispose();
    for (const e of this.debugMats.values()) e.mat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
