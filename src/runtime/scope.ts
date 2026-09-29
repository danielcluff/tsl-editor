// Builds the identifier scope generated TSL code is evaluated in.
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import * as TSLTextures from "tsl-textures";
import * as Easings from "tsl-easings";
import { afterImage } from "three/addons/tsl/display/AfterImageNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { boxBlur } from "three/addons/tsl/display/boxBlur.js";
import { chromaticAberration } from "three/addons/tsl/display/ChromaticAberrationNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { dotScreen } from "three/addons/tsl/display/DotScreenNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { hashBlur } from "three/addons/tsl/display/hashBlur.js";
import { rgbShift } from "three/addons/tsl/display/RGBShiftNode.js";
import { sepia } from "three/addons/tsl/display/Sepia.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { sobel } from "three/addons/tsl/display/SobelOperatorNode.js";
import { transition } from "three/addons/tsl/display/TransitionNode.js";
import { UTIL_SOURCES } from "../core/tsl-utils";
import { RUNTIME_EXTRA_NAMES } from "../core/codegen";

// ---------------------------------------------------------------------------
// Cached texture loader: generated code does `new TextureLoader().load(url)`
// on every recompile; returning the same Texture avoids flicker/refetch.
// ---------------------------------------------------------------------------

const textureCache = new Map<string, THREE.Texture>();
let uvTexture: THREE.Texture | undefined;

function makeUvTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cells = 8;
  const cs = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const u = x / (cells - 1);
      const v = 1 - y / (cells - 1);
      const light = (x + y) % 2 === 0;
      ctx.fillStyle = `rgb(${Math.round(u * 200 + (light ? 55 : 20))}, ${Math.round(v * 200 + (light ? 55 : 20))}, ${light ? 190 : 120})`;
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) ctx.fillText(String.fromCharCode(65 + x) + (y + 1), x * cs + cs / 2, y * cs + cs / 2);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

class CachedTextureLoader {
  load(url: string): THREE.Texture {
    if (url === "/uv.png" || !url) {
      uvTexture ??= makeUvTexture();
      return uvTexture;
    }
    let tex = textureCache.get(url);
    if (!tex) {
      tex = new THREE.TextureLoader().load(url, (t) => {
        t.needsUpdate = true;
        onTextureLoaded?.();
      });
      textureCache.set(url, tex);
    }
    return tex;
  }
}

let onTextureLoaded: (() => void) | undefined;
export function setTextureLoadedHandler(fn: () => void) {
  onTextureLoaded = fn;
}

// ---------------------------------------------------------------------------

const ADDONS = {
  afterImage,
  bloom,
  boxBlur,
  chromaticAberration,
  dof,
  dotScreen,
  film,
  fxaa,
  gaussianBlur,
  hashBlur,
  rgbShift,
  sepia,
  smaa,
  sobel,
  transition,
};

const IDENT = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(["default", "arguments", "eval"]);

let cached: { keys: string[]; values: unknown[] } | undefined;

/**
 * Keys/values for `new Function(...keys, body)`. Util names are excluded:
 * generated bodies declare them with `const`, which would clash with a
 * same-named parameter.
 */
export function runtimeScope(): { keys: string[]; values: unknown[] } {
  if (cached) return cached;
  const scope: Record<string, unknown> = {};
  const three = THREE as unknown as Record<string, unknown>;
  for (const name of RUNTIME_EXTRA_NAMES) if (name in three) scope[name] = three[name];
  Object.assign(scope, TSLTextures, Easings, TSL, ADDONS);
  scope.TextureLoader = CachedTextureLoader;
  scope.THREE = THREE;
  for (const util of Object.keys(UTIL_SOURCES)) delete scope[util];
  for (const k of ["material", "scene", "camera", "renderer", "scenePass", "renderPipeline"]) delete scope[k];
  const keys = Object.keys(scope).filter((k) => IDENT.test(k) && !RESERVED.has(k));
  cached = { keys, values: keys.map((k) => scope[k]) };
  return cached;
}

export interface MaterialResult {
  material: THREE.NodeMaterial | null;
  nodes: Record<string, unknown>;
  uniforms: Record<string, { value: unknown }>;
}

export interface PostResult {
  outputNode: unknown;
  toneMapping: { toneMapping: string; exposure: number; outputColorSpace: string };
  nodes: Record<string, unknown>;
  uniforms: Record<string, { value: unknown }>;
}

export function evaluateMaterial(body: string): MaterialResult {
  const { keys, values } = runtimeScope();
  const fn = new Function(...keys, body);
  return fn(...values);
}

export function evaluatePost(body: string, scene: THREE.Scene, camera: THREE.Camera, renderer: unknown): PostResult {
  const { keys, values } = runtimeScope();
  const fn = new Function(...keys, "scene", "camera", "renderer", body);
  return fn(...values, scene, camera, renderer);
}

export { THREE, TSL };
