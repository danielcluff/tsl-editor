import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A `//` comment line between JSX attributes makes Solid's compiler silently drop the
// attributes and handlers that follow it. Comments belong in {/* */} above the element.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });

describe("JSX", () => {
  it("has no // comments between attributes", () => {
    const hits: string[] = [];
    for (const file of files(join(__dirname, "../src"))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/^\s*\/\//.test(line)) return;
        const prev = (lines[i - 1] ?? "").trim();
        const next = (lines[i + 1] ?? "").trim();
        const attr = /^[a-zA-Z:-]+(=|$)/;
        const opensTag = /^<[A-Za-z][\w.]*$/;
        if ((opensTag.test(prev) || attr.test(prev) || /^[a-zA-Z:-]+=\{?.*[}"]$/.test(prev)) && attr.test(next)) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
