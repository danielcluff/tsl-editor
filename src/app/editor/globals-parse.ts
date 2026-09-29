import type { GlobalDef } from "../../core/types";

function parseNum(s: string): number {
  const t = s.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
  return Number(t);
}

/** Parse pasted `const x = uniform(...)` style declarations (Globals → Bulk Import). */
export function parseGlobals(src: string): Omit<GlobalDef, "id">[] {
  const out: Omit<GlobalDef, "id">[] = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(uniform|varying)?\s*\(?\s*(float|int|bool|vec2|vec3|vec4|color)?\s*\(([^()]*)\)\s*\)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, name, wrap, ctor, argsRaw] = m;
    const args = argsRaw.split(",").map((a) => a.trim()).filter(Boolean);
    let type = ctor ?? "float";
    let value: unknown;
    if (type === "color") {
      const a = args[0] ?? "#ffffff";
      value = /^['"]/.test(a) ? a.replace(/['"]/g, "") : `#${parseNum(a).toString(16).padStart(6, "0")}`;
    } else if (type.startsWith("vec")) {
      const n = Number(type.slice(3));
      const nums = args.map(parseNum);
      value = Array.from({ length: n }, (_, i) => nums[i] ?? nums[0] ?? 0);
    } else if (type === "bool") value = args[0] === "true";
    else {
      value = parseNum(args[0] ?? "0");
      if (!ctor && /^(true|false)$/.test(args[0] ?? "")) {
        type = "bool";
        value = args[0] === "true";
      }
    }
    out.push({ name, kind: wrap === "uniform" ? "uniform" : wrap === "varying" ? "varying" : "const", type, value });
  }
  return out;
}

