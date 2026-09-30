import { describe, expect, it } from "vitest";
import { addNode, connect, createLoop, createProject, removeNodes, setLoopMode, type LoopMode } from "../src/core/graph";
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
    expect(r.code).toMatch(/const (\w+)_count = max\(int\(4\), 0\);/);
    expect(r.code).toMatch(/Loop\(\w+_count, \(\{ i \}\) => \{/);
    expect(r.code).toMatch(/\.assign\(/);
  });

  describe("loop modes", () => {
    // a loop that sums its index (or, in condition mode, counts while acc < 5)
    const build = (mode: LoopMode, settings: Record<string, unknown> = {}) => {
      const doc = createProject("t");
      const { loop, parts } = createLoop(doc, "material", { x: 0, y: 0 }, mode);
      Object.assign(loop.data.values, settings);
      const add = addNode(doc, "material", "math/add", { x: 200, y: 100 }, { values: { b: 1 } });
      add.parentId = loop.id;
      connect(doc, "material", { source: parts["loop/accumulator"], sourceHandle: "acc", target: add.id, targetHandle: "a" });
      if (parts["loop/index"]) connect(doc, "material", { source: parts["loop/index"], sourceHandle: "index", target: add.id, targetHandle: "b" });
      connect(doc, "material", { source: add.id, sourceHandle: "out", target: parts["loop/output"], targetHandle: "next" });
      if (mode === "condition") {
        const lt = addNode(doc, "material", "logic/lessThan", { x: 200, y: 200 }, { values: { b: 5 } });
        lt.parentId = loop.id;
        connect(doc, "material", { source: parts["loop/accumulator"], sourceHandle: "acc", target: lt.id, targetHandle: "a" });
        connect(doc, "material", { source: lt.id, sourceHandle: "out", target: parts["loop/condition"], targetHandle: "cond" });
      }
      const mat = doc.graphs.material.nodes[0];
      connect(doc, "material", { source: parts["loop/output"], sourceHandle: "out", target: mat.id, targetHandle: "colorNode" });
      const r = compileProject(doc);
      expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
      // the module must at least parse
      expect(() => new Function(r.code.replace(/^import .*$/gm, ""))).not.toThrow();
      return { doc, parts, code: r.code };
    };

    it("creates the parts each mode needs", () => {
      const types = (mode: LoopMode) => Object.keys(build(mode).parts).sort();
      expect(types("count")).toEqual(["loop/accumulator", "loop/count", "loop/index", "loop/output"]);
      expect(types("range")).toEqual(["loop/accumulator", "loop/end", "loop/index", "loop/output", "loop/start"]);
      expect(types("reverse")).toEqual(["loop/accumulator", "loop/index", "loop/output", "loop/start"]);
      expect(types("nested")).toEqual(["loop/accumulator", "loop/count", "loop/count2", "loop/index", "loop/index2", "loop/output"]);
      expect(types("condition")).toEqual(["loop/accumulator", "loop/condition", "loop/output"]);
    });

    it("generates the original's Loop() shapes", () => {
      expect(build("range").code).toMatch(/Loop\(\{ start: 0, end: 1, type: 'int', condition: '<', name: 'i' \}, \(\{ i \}\) => \{/);
      expect(build("range", { loopType: "float", loopCompare: "<=" }).code).toMatch(/type: 'float', condition: '<='/);
      expect(build("reverse").code).toMatch(/Loop\(\{ start: 0, type: 'int', condition: '>', name: 'i' \}, \(\{ i \}\) => \{/);
      const nested = build("nested").code;
      expect(nested).toMatch(/_count2 = max\(int\(1\), 0\);/);
      expect(nested).toMatch(/Loop\(\w+_count, \w+_count2, \(\{ i, j \}\) => \{/);
    });

    it("condition mode declares the condition before the while loop", () => {
      const code = build("condition").code;
      const lt = /const (\w+) = lessThan\((\w+_acc), /.exec(code);
      expect(lt).not.toBeNull();
      expect(code.indexOf(lt![0])).toBeLessThan(code.indexOf(`Loop(${lt![1]}, () => {`));
    });

    it("switching modes swaps parts and drops their wires", () => {
      const doc = createProject("t");
      const { loop, parts } = createLoop(doc, "material", { x: 0, y: 0 }, "count");
      const next = setLoopMode(doc, "material", loop.id, "range");
      expect(next["loop/count"]).toBeUndefined();
      expect(next["loop/accumulator"]).toBe(parts["loop/accumulator"]); // kept
      expect(doc.graphs.material.nodes.some((n) => n.id === parts["loop/count"])).toBe(false);
      expect(loop.data.values.loopMode).toBe("range");
    });

    it("deleting a loop deletes its parts", () => {
      const doc = createProject("t");
      const { loop } = createLoop(doc, "material", { x: 0, y: 0 });
      removeNodes(doc, "material", [loop.id]);
      expect(doc.graphs.material.nodes.filter((n) => n.type.startsWith("loop"))).toEqual([]);
    });
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
