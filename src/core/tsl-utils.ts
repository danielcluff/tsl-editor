// Utility functions for nodes that have no direct three/tsl equivalent.
//
// Each entry is TSL source text. At runtime the preview evaluates it inside
// the TSL scope; on export it is inlined verbatim above the graph code, so
// generated code stays self-contained ("Inline TSL Utils").

export interface UtilSource {
  code: string;
  deps?: string[];
}

export const UTIL_SOURCES: Record<string, UtilSource> = {
  sdfCircle2D: {
    code: `const sdfCircle2D = (p, center = vec2(0.5), radius = 0.25) =>
  length(vec2(p).sub(center)).sub(radius);`,
  },
  sdfBox2D: {
    code: `const sdfBox2D = (p, center = vec2(0.5), size = vec2(0.5)) => {
  const d = abs(vec2(p).sub(center)).sub(vec2(size).mul(0.5));
  return length(max(d, 0.0)).add(min(max(d.x, d.y), 0.0));
};`,
  },
  sdfRoundedBox2D: {
    code: `const sdfRoundedBox2D = (p, center = vec2(0.5), size = vec2(0.5), radius = 0.05) => {
  const q = abs(vec2(p).sub(center)).sub(vec2(size).mul(0.5)).add(radius);
  return length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0)).sub(radius);
};`,
  },
  sdfCapsule2D: {
    code: `const sdfCapsule2D = (p, pointA = vec2(0.3), pointB = vec2(0.7), radius = 0.1) => {
  const pa = vec2(p).sub(pointA);
  const ba = vec2(pointB).sub(pointA);
  const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0.0, 1.0);
  return length(pa.sub(ba.mul(h))).sub(radius);
};`,
  },
  sdfCross2D: {
    deps: ["sdfBox2D"],
    code: `const sdfCross2D = (p, center = vec2(0.5), armLength = 0.4, thickness = 0.1) =>
  min(
    sdfBox2D(p, center, vec2(armLength, thickness)),
    sdfBox2D(p, center, vec2(thickness, armLength)),
  );`,
  },
  adjustBrightness: {
    code: `const adjustBrightness = (color, brightness = 0) => vec3(color).add(brightness);`,
  },
  adjustContrast: {
    code: `const adjustContrast = (color, contrast = 1) => vec3(color).sub(0.5).mul(contrast).add(0.5);`,
  },
  adjustSaturate: {
    code: `const adjustSaturate = (color, saturation = 1) => mix(vec3(luminance(vec3(color))), vec3(color), saturation);`,
  },
  blendColorBurn: {
    code: `const blendColorBurn = (base, blend) =>
  max(vec3(0.0), vec3(1.0).sub(vec3(1.0).sub(vec3(base)).div(max(vec3(blend), 1e-5))));`,
  },
  blendColorDodge: {
    code: `const blendColorDodge = (base, blend) =>
  min(vec3(1.0), vec3(base).div(max(vec3(1.0).sub(vec3(blend)), 1e-5)));`,
  },
  blendDarken: { code: `const blendDarken = (base, blend) => min(vec3(base), vec3(blend));` },
  blendLighten: { code: `const blendLighten = (base, blend) => max(vec3(base), vec3(blend));` },
  blendExclusion: {
    code: `const blendExclusion = (base, blend) =>
  vec3(base).add(vec3(blend)).sub(vec3(base).mul(vec3(blend)).mul(2.0));`,
  },
  blendMultiply: { code: `const blendMultiply = (base, blend) => vec3(base).mul(vec3(blend));` },
  blendScreen: {
    code: `const blendScreen = (base, blend) =>
  vec3(1.0).sub(vec3(1.0).sub(vec3(base)).mul(vec3(1.0).sub(vec3(blend))));`,
  },
  blendPlusLighter: {
    code: `const blendPlusLighter = (base, blend) => min(vec3(base).add(vec3(blend)), vec3(1.0));`,
  },
  blendOverlay: {
    code: `const blendOverlay = (base, blend) => {
  const b = vec3(base);
  const s = vec3(blend);
  const low = b.mul(s).mul(2.0);
  const high = vec3(1.0).sub(vec3(1.0).sub(b).mul(vec3(1.0).sub(s)).mul(2.0));
  return mix(low, high, step(0.5, b));
};`,
  },
  blendHardLight: {
    deps: ["blendOverlay"],
    code: `const blendHardLight = (base, blend) => blendOverlay(blend, base);`,
  },
  blendSoftLight: {
    code: `const blendSoftLight = (base, blend) => {
  const b = vec3(base);
  const s = vec3(blend);
  return vec3(1.0).sub(s.mul(2.0)).mul(b.mul(b)).add(s.mul(2.0).mul(b));
};`,
  },
  rgbToHsl: {
    code: `const rgbToHsl = (rgb) => {
  const c = vec3(rgb);
  const maxc = max(c.r, max(c.g, c.b));
  const minc = min(c.r, min(c.g, c.b));
  const l = maxc.add(minc).mul(0.5);
  const d = maxc.sub(minc);
  const dd = max(d, 1e-6);
  const s = d.div(max(float(1.0).sub(abs(l.mul(2.0).sub(1.0))), 1e-6));
  const hr = mod(c.g.sub(c.b).div(dd), 6.0);
  const hg = c.b.sub(c.r).div(dd).add(2.0);
  const hb = c.r.sub(c.g).div(dd).add(4.0);
  const h = select(maxc.equal(c.r), hr, select(maxc.equal(c.g), hg, hb)).div(6.0);
  return vec3(select(d.lessThan(1e-6), float(0.0), fract(h)), select(d.lessThan(1e-6), float(0.0), s), l);
};`,
  },
  hslToRgb: {
    code: `const hslToRgb = (h, s = 1, l = 0.5) => {
  const rgb = clamp(abs(mod(float(h).mul(6.0).add(vec3(0.0, 4.0, 2.0)), 6.0).sub(3.0)).sub(1.0), 0.0, 1.0);
  return float(l).add(float(s).mul(rgb.sub(0.5)).mul(float(1.0).sub(abs(float(l).mul(2.0).sub(1.0)))));
};`,
  },
  blendHue: {
    deps: ["rgbToHsl", "hslToRgb"],
    code: `const blendHue = (base, blend) => {
  const a = rgbToHsl(base);
  const b = rgbToHsl(blend);
  return hslToRgb(b.x, a.y, a.z);
};`,
  },
  blendLuminosity: {
    deps: ["rgbToHsl", "hslToRgb"],
    code: `const blendLuminosity = (base, blend) => {
  const a = rgbToHsl(base);
  const b = rgbToHsl(blend);
  return hslToRgb(a.x, a.y, b.z);
};`,
  },
  fresnelFull: {
    code: `const fresnelFull = (bias = 0, scale = 1, power = 2, normal = normalView, viewDir = positionViewDirection) =>
  float(bias).add(float(scale).mul(pow(float(1.0).sub(saturate(dot(normal, viewDir))), power)));`,
  },
  polarUV: {
    code: `const polarUV = (uvIn = uv(), center = vec2(0.5)) => {
  const d = vec2(uvIn).sub(center);
  return vec2(length(d), atan(d.y, d.x).div(PI * 2).add(0.5));
};`,
  },
  rotate2D: {
    code: `const rotate2D = (pos, angle = 0) => {
  const p = vec2(pos);
  const c = cos(angle);
  const s = sin(angle);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
};`,
  },
  rotation3d: {
    code: `const rotation3d = (pos, axis = vec3(0, 1, 0), angle = 0) => {
  const p = vec3(pos);
  const k = normalize(vec3(axis));
  const c = cos(angle);
  const s = sin(angle);
  return p.mul(c).add(cross(k, p).mul(s)).add(k.mul(dot(k, p)).mul(float(1.0).sub(c)));
};`,
  },
  uvTransform: {
    code: `const uvTransform = (uvIn = uv(), scale = vec2(1), offset = vec2(0)) => vec2(uvIn).mul(scale).add(offset);`,
  },
  voronoi: {
    code: `const voronoi = Fn(([position, subdivision, seed]) => {
  const p = vec2(position).mul(subdivision);
  const ip = floor(p);
  const fp = fract(p);
  const minDist = float(8.0).toVar();
  const cell = vec2(0.0).toVar();
  Loop({ start: -1, end: 1, type: 'int', condition: '<=', name: 'j' }, ({ j }) => {
    Loop({ start: -1, end: 1, type: 'int', condition: '<=', name: 'i' }, ({ i }) => {
      const g = vec2(float(i), float(j));
      const h = ip.add(g).add(float(seed).mul(17.13));
      const o = fract(sin(vec2(dot(h, vec2(127.1, 311.7)), dot(h, vec2(269.5, 183.3)))).mul(43758.5453));
      const d = length(g.add(o).sub(fp));
      If(d.lessThan(minDist), () => {
        minDist.assign(d);
        cell.assign(ip.add(g).add(o));
      });
    });
  });
  const id = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
  return vec4(minDist, id, cell.div(subdivision));
});`,
  },
  anamorphic: {
    code: `const anamorphic = (node, threshold = 0.9, scale = 3, samples = 32) => {
  // Horizontal lens streaks from bright pixels (three removed AnamorphicNode).
  const n = typeof samples === 'number' ? Math.max(2, Math.min(64, Math.round(samples))) : 32;
  let sum = vec3(0.0);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1;
    const c = node.sample(screenUV.add(vec2(float(scale).mul(t * 0.02), 0.0))).rgb;
    sum = sum.add(max(c.sub(threshold), 0.0).mul(1 - Math.abs(t)));
  }
  return vec4(sum.div(n * 0.5).mul(vec3(0.55, 0.7, 1.0)), 1.0);
};`,
  },
  linearGradient: {
    code: `const linearGradient = (t = uv().x, mode = 0, stops = []) => {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (sorted.length === 0) return vec3(0.0);
  let c = vec3(color(sorted[0].color));
  for (let i = 1; i < sorted.length; i++) {
    const p0 = sorted[i - 1].pos;
    const p1 = sorted[i].pos;
    const k = mode === 1
      ? step(p1, float(t))
      : clamp(float(t).sub(p0).div(Math.max(p1 - p0, 1e-5)), 0.0, 1.0);
    c = mix(c, vec3(color(sorted[i].color)), k);
  }
  return c;
};`,
  },
};

/** Resolve util names plus transitive deps in dependency order. */
export function utilClosure(names: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n) || !UTIL_SOURCES[n]) return;
    seen.add(n);
    for (const d of UTIL_SOURCES[n].deps ?? []) visit(d);
    out.push(n);
  };
  for (const n of names) visit(n);
  return out;
}
