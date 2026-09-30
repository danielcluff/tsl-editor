import { describe, expect, it } from "vitest";
import { addNode, connect, createProject } from "../src/core/graph";
import { compileProject } from "../src/core/codegen";
import { allNodeDefs } from "../src/core/registry";

describe("codegen", () => {
  it("compiles the default project", () => {
    const doc = createProject("t");
    const r = compileProject(doc);
    expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(r.code).toContain("const material = new MeshStandardNodeMaterial();");
    expect(r.code).toContain('material.colorNode = color("#ffffff");');
    expect(r.code).toContain("import { MeshStandardNodeMaterial, RenderPipeline } from 'three/webgpu';");
  });

  it("wires uv -> linear gradient -> material color", () => {
    const doc = createProject("t");
    const mat = doc.graphs.material.nodes[0];
    const uv = addNode(doc, "material", "geo/uv", { x: 0, y: 0 });
    const grad = addNode(doc, "material", "utils/linearGradient", { x: 200, y: 0 });
    expect(connect(doc, "material", { source: uv.id, sourceHandle: "y", target: grad.id, targetHandle: "t" }).ok).toBe(true);
    expect(connect(doc, "material", { source: grad.id, sourceHandle: "out", target: mat.id, targetHandle: "colorNode" }).ok).toBe(true);
    const r = compileProject(doc);
    expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(r.code).toContain("const _node0 = uv(0);");
    expect(r.code).toMatch(/linearGradient\(_node0\.y, 0, \[/);
    expect(r.code).toContain("const linearGradient =");
    expect(r.code).toContain("material.colorNode = _node1;");
  });

  it("every catalog node compiles standalone without codegen errors", () => {
    const skip = new Set(["loop", "loopPart", "localGet", "localSet", "globalRef", "subgraph", "subgraphInput", "portal", "assign", "placeholder"]);
    for (const def of allNodeDefs()) {
      if (skip.has(def.kind ?? "")) continue;
      const doc = createProject("t");
      const graph = def.graphs?.includes("material") === false ? "post" : "material";
      addNode(doc, graph, def.type, { x: 0, y: 0 });
      const r = compileProject(doc);
      const errs = r.diagnostics.filter((d) => d.level === "error" && !/not connected|not defined/.test(d.message));
      expect(errs, def.type).toEqual([]);
    }
  });

  it("compiles loops", () => {
    const doc = createProject("t");
    const loop = addNode(doc, "material", "loop", { x: 0, y: 0 });
    const count = addNode(doc, "material", "loop/count", { x: 10, y: 10 }, { values: { count: 4 } });
    const acc = addNode(doc, "material", "loop/accumulator", { x: 10, y: 60 });
    const idx = addNode(doc, "material", "loop/index", { x: 10, y: 110 });
    const add = addNode(doc, "material", "math/add", { x: 100, y: 60 });
    const out = addNode(doc, "material", "loop/output", { x: 200, y: 60 });
    for (const n of [count, acc, idx, add, out]) n.parentId = loop.id;
    connect(doc, "material", { source: acc.id, sourceHandle: "acc", target: add.id, targetHandle: "a" });
    connect(doc, "material", { source: idx.id, sourceHandle: "index", target: add.id, targetHandle: "b" });
    connect(doc, "material", { source: add.id, sourceHandle: "out", target: out.id, targetHandle: "next" });
    const mat = doc.graphs.material.nodes[0];
    connect(doc, "material", { source: out.id, sourceHandle: "out", target: mat.id, targetHandle: "colorNode" });
    const r = compileProject(doc);
    expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(r.code).toMatch(/Loop\(int\(4\), \(\{ i \}\) => \{/);
    expect(r.code).toMatch(/\.assign\(/);
  });
});

import { TEMPLATES, projectFromTemplate } from "../src/core/templates";
describe("templates", () => {
  for (const t of TEMPLATES) {
    it(`builds and compiles "${t.id}"`, () => {
      const doc = projectFromTemplate(t.id);
      const r = compileProject(doc);
      expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    });
  }
});
