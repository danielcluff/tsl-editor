import * as THREE from "three/webgpu";
import { checker, color, mix, uv, vec2, vec3 } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { PreviewSettings } from "../core/types";
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

type DebugTarget = { canvas: HTMLCanvasElement; type: string };

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
  private debugRT = new THREE.RenderTarget(96, 96);
  private debugBusy = false;
  private lastDebug = 0;
  private disposed = false;
  onError: (errors: string[]) => void = () => {};
  onFrame?: () => void;

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
    setTextureLoadedHandler(() => {});

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
  }

  private frame() {
    if (!this.renderer) return;
    this.controls.update();
    try {
      if (this.pipeline && this.settings.enablePost) this.pipeline.render();
      else this.renderer.render(this.scene, this.camera);
    } catch (err) {
      this.onError([`Render: ${err instanceof Error ? err.message : String(err)}`]);
    }
    this.onFrame?.();
    const now = performance.now();
    if (this.debugTargets.size && !this.debugBusy && now - this.lastDebug > 250) {
      this.lastDebug = now;
      void this.renderDebug();
    }
  }

  // -------------------------------------------------------------------------
  // graph application
  // -------------------------------------------------------------------------

  /** Evaluate compiled bodies. Returns error strings (empty on success). */
  apply(materialBody: string, postBody: string | null): string[] {
    const errors: string[] = [];
    if (!this.renderer) return errors;
    try {
      const res = evaluateMaterial(materialBody);
      this.materialResult = res;
      const mat = res.material ?? this.fallbackMaterial;
      if (this.mesh.material !== mat) {
        const old = this.mesh.material as THREE.Material;
        this.mesh.material = mat;
        if (old !== this.fallbackMaterial) old.dispose();
      }
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
    for (const res of [this.materialResult, this.postResult]) {
      const u = res?.uniforms[key];
      if (!u) continue;
      found = true;
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
    const p = s.geometryParams as Record<string, number>;
    this.geometryError = undefined;
    switch (s.geometry) {
      case "box":
        return new THREE.BoxGeometry(p.width ?? 1.6, p.height ?? 1.6, p.depth ?? 1.6, p.segments ?? 1, p.segments ?? 1, p.segments ?? 1);
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
      case "script":
        try {
          const fn = new Function("THREE", "geometry", s.geometryScript ?? "return new THREE.SphereGeometry(1.2, 64, 64);");
          const g = fn(THREE, undefined);
          if (g && g.isBufferGeometry) return g;
          throw new Error("Script must return a BufferGeometry");
        } catch (err) {
          this.geometryError = err instanceof Error ? err.message : String(err);
          return new THREE.SphereGeometry(1.2, 64, 64);
        }
      default:
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
  }

  private async loadEnv() {
    const token = ++this.envToken;
    const s = this.settings;
    const preset = ENVIRONMENTS.find((e) => e.value === s.environment);
    if (!preset || preset.value === "none") {
      this.scene.environment = null;
      this.scene.background = null;
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
  }

  private async renderDebug() {
    const res = this.materialResult;
    if (!res || !this.renderer) return;
    this.debugBusy = true;
    try {
      for (const [id, target] of this.debugTargets) {
        const node = res.nodes[id] as THREE.Node | undefined;
        if (!node) continue;
        const mat = new THREE.MeshBasicNodeMaterial();
        const t = target.type;
        const n = node as unknown as ReturnType<typeof vec3>;
        mat.colorNode =
          t === "float" || t === "int" || t === "uint" || t === "bool"
            ? vec3(n)
            : t === "vec2"
              ? vec3(n.x, n.y, 0)
              : t === "vec4"
                ? n.xyz
                : vec3(n);
        mat.side = THREE.DoubleSide;
        this.debugMesh.material = mat;
        const r = this.renderer;
        const prev = r.getRenderTarget();
        r.setRenderTarget(this.debugRT);
        this.debugMesh.render(r);
        r.setRenderTarget(prev);
        const pixels = (await r.readRenderTargetPixelsAsync(this.debugRT, 0, 0, 96, 96)) as Uint8Array;
        mat.dispose();
        const ctx = target.canvas.getContext("2d");
        if (!ctx) continue;
        const img = ctx.createImageData(96, 96);
        const flip = this.backend === "WebGL2";
        for (let y = 0; y < 96; y++) {
          const srcRow = flip ? 95 - y : y;
          img.data.set(pixels.subarray(srcRow * 96 * 4, srcRow * 96 * 4 + 96 * 4), y * 96 * 4);
        }
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
        ctx.putImageData(img, 0, 0);
      }
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
