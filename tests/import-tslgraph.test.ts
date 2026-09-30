import { describe, expect, it } from "vitest";
import { compileProject } from "../src/core/codegen";
import { executeCommand } from "../src/core/commands";
import { importTslGraph, isTslGraphExport } from "../src/core/import-tslgraph";

const node = (id: string, type: string, position: { x: number; y: number }, values: Record<string, unknown> = {}, extra: object = {}) => ({
  id,
  type,
  position,
  data: { type, values, connected: {} },
  ...extra,
});

const fixture = {
  version: 2,
  nodes: [
    node("mat", "material/standard", { x: 900, y: 0 }, { emissiveNode: "#000000" }),
    node("grp", "group", { x: 100, y: 100 }, { label: "noise" }, { style: { width: 400, height: 200 } }),
    node("u", "const/uniform", { x: 20, y: 40 }, { localName: "zoom", uniformType: "float", value: 4, step: 0.1 }, { parentId: "grp", extent: "parent" }),
    node("time", "geo/time", { x: 0, y: 400 }),
    node("mul", "math/mul", { x: 300, y: 400 }, { a: 1, b: 2 }),
    node("mystery", "fancy/newNode", { x: 500, y: 400 }, { strength: 3 }),
    { ...node("mo", "math/multiOp", { x: 500, y: 600 }), data: { type: "math/multiOp", values: { op_y_b: 5, localName: "wave" }, operations: [{ id: "x", op: "sin" }, { id: "y", op: "mul" }], connected: {} } },
    { ...node("mo2", "math/multiOp", { x: 500, y: 700 }), data: { type: "math/multiOp", values: {}, operations: [{ id: "z", op: "frobnicate" }], connected: {} } },
    node("sgi", "custom/subgraph-1", { x: 300, y: 800 }),
    node("code", "code/round-1", { x: 500, y: 800 }),
  ],
  edges: [
    { id: "e1", source: "time", sourceHandle: "out", target: "mul", targetHandle: "a" },
    { id: "e2", source: "u", sourceHandle: "out", target: "mul", targetHandle: "b" },
    { id: "e3", source: "mul", sourceHandle: "out", target: "mystery", targetHandle: "input" },
    { id: "e4", source: "mystery", sourceHandle: "result", target: "mat", targetHandle: "colorNode" },
    { id: "e5", source: "time", sourceHandle: "out", target: "mo", targetHandle: "op_x_x" },
    { id: "e6", source: "time", sourceHandle: "out", target: "sgi", targetHandle: "in_0" },
    { id: "e7", source: "sgi", sourceHandle: "out_0", target: "code", targetHandle: "in_0" },
    { id: "bad", source: "time", sourceHandle: "out", target: "mul", targetHandle: "nope" },
  ],
  postNodes: [
    node("post-input", "post/input", { x: 0, y: 0 }, {}, { data: { type: "post/input", values: {}, connected: {}, activeInputs: ["color", "depth", "normal"] } }),
    node("post-output", "post/output", { x: 400, y: 0 }),
  ],
  postEdges: [{ id: "p1", source: "post-input", sourceHandle: "color", target: "post-output", targetHandle: "color" }],
  globals: [],
  subgraphs: {
    "custom/subgraph-1": {
      id: "custom/subgraph-1",
      name: "Wobble",
      inputs: [{ id: "in_0", label: "Input 1", type: "any" }],
      outputs: [{ id: "out_0", label: "Output 1", type: "any" }],
      inputNodePosition: { x: 0, y: 0 },
      outputNodePosition: { x: 500, y: 0 },
      nodes: [node("sin", "math/sin", { x: 250, y: 0 })],
      edges: [
        { source: "subgraph-input", sourceHandle: "in_0", target: "sin", targetHandle: "x" },
        { source: "sin", sourceHandle: "out", target: "subgraph-output", targetHandle: "out_0" },
      ],
    },
  },
  codeNodes: {
    "code/round-1": {
      id: "code/round-1",
      name: "round",
      language: "tsl",
      code: "Fn(([in]) => {\n  return in.round()\n})",
      inputs: [{ id: "in_0", label: "in", type: "any" }],
      output: { id: "out", label: "Result", type: "any" },
    },
  },
  previewSettings: { mesh: "torus", environment: "city", environmentIntensity: 0.5, postEnabled: false, config: { radiusTorus: 0.7, tube: 0.2 } },
};

describe("tsl-graph.xyz import", () => {
  const { doc, report } = importTslGraph(structuredClone(fixture) as never, "Imported");
  const m = doc.graphs.material;
  const byId = (id: string) => m.nodes.find((n) => n.id === id)!;

  it("detects the format and not our own project files", () => {
    expect(isTslGraphExport(fixture)).toBe(true);
    expect(isTslGraphExport(doc)).toBe(false);
  });

  it("converts groups, relative child positions and uniforms", () => {
    const grp = byId("grp");
    expect(grp.type).toBe("utils/group");
    expect([grp.width, grp.height, grp.data.label]).toEqual([400, 200, "noise"]);
    const u = byId("u");
    expect(u.parentId).toBe("grp");
    expect(u.position).toEqual({ x: 120, y: 140 });
    expect(u.data.values).toEqual({ type: "float", value: 4 });
    expect(u.data.localName).toBe("zoom");
    expect(byId("mul").data.values).toMatchObject({ a: 1, b: 2 });
  });

  it("keeps unknown nodes as read-only placeholders with their connections and data", () => {
    const ph = byId("mystery");
    expect(ph.type).toBe("import/placeholder");
    expect(ph.data.placeholder).toMatchObject({ originalType: "fancy/newNode", inputs: ["input"], outputs: ["result"] });
    expect(ph.data.placeholder!.meta).toContain('"strength": 3');
    expect(m.edges.some((e) => e.target === "mystery") && m.edges.some((e) => e.source === "mystery")).toBe(true);
    // a multi-op with an operation we don't have stays a placeholder
    const mo2 = byId("mo2");
    expect(mo2.type).toBe("import/placeholder");
    expect(mo2.data.placeholder!.reason).toContain("frobnicate");
    expect(report.placeholders.map((p) => p.type).sort()).toEqual(["fancy/newNode", "math/multiOp"]);
  });

  it("imports multi-ops with their operations, values and wires", () => {
    const mo = byId("mo");
    expect(mo.type).toBe("math/multiOp");
    expect(mo.data.operations).toEqual([{ id: "x", op: "sin" }, { id: "y", op: "mul" }]);
    expect(mo.data.values).toEqual({ op_y_b: 5 });
    expect(mo.data.localName).toBe("wave");
    expect(m.edges.find((e) => e.id === "e5")?.targetHandle).toBe("op_x_x");
    expect(compileProject(doc).code).toMatch(/const wave = sin\(\w+\)\.mul\(float\(5\)\);/);
  });

  it("drops only edges whose ports don't exist", () => {
    expect(report.droppedEdges.map((d) => d.edge)).toEqual(["time.out → mul.nope"]);
    expect(m.edges.find((e) => e.id === "e2")).toBeTruthy();
  });

  it("imports subgraphs, code nodes, post graph and preview settings", () => {
    expect(byId("sgi").type).toBe("subgraph/instance");
    const sg = doc.customNodes[0];
    expect(sg.name).toBe("Wobble");
    expect(sg.graph.edges).toHaveLength(2);
    const code = byId("code");
    expect(code.type).toBe("code/tsl");
    expect(code.data.code!.inputs).toEqual([{ key: "in_0", type: "any" }]);
    expect(doc.graphs.post.edges).toHaveLength(1);
    expect(doc.settings).toMatchObject({ geometry: "torus", environment: "city", envIntensity: 0.5, enablePost: false, geometryParams: { radius: 0.7, tube: 0.2 } });
  });

  it("compiles, reporting only root causes", () => {
    const r = compileProject(doc);
    const errors = r.diagnostics.filter((d) => d.level === "error").map((d) => d.message);
    // the placeholders, and the imported code (its `in` parameter isn't valid JS) — nothing cascades
    expect(errors).toHaveLength(3);
    expect(errors.filter((e) => e.includes("Unsupported imported node"))).toHaveLength(2);
    expect(errors.some((e) => e.includes("Syntax error in code"))).toBe(true);
    expect(r.code).toContain("sg_Wobble");
  });

  it("placeholders can't be added, edited or connected", () => {
    expect(() => executeCommand(doc, { op: "addNode", type: "import/placeholder" })).toThrow(/only come from imports/);
    expect(() => executeCommand(doc, { op: "updateNode", nodeId: "mystery", values: { strength: 1 } })).toThrow(/read-only/);
    expect(() => executeCommand(doc, { op: "updateNode", nodeId: "mystery", position: { x: 0, y: 0 } })).not.toThrow();
    expect(() => executeCommand(doc, { op: "connect", source: "time", target: "mystery", targetHandle: "input" })).toThrow(/can't be connected/);
    expect(() => executeCommand(doc, { op: "deleteNodes", nodeIds: ["mystery"] })).not.toThrow();
  });
});

describe("imported loops", () => {
  // shape copied from the original editor's state for a Range loop
  const L = "loop-1";
  const part = (id: string, type: string, pos: { x: number; y: number }, values: Record<string, unknown> = {}) =>
    node(`${L}::${id}`, type, pos, values, { parentId: L });
  const src = {
    version: 2,
    nodes: [
      node("mat", "material/standard", { x: 900, y: 0 }),
      { ...node(L, "group", { x: 212, y: 224 }), data: { type: "loop", values: { label: "Loop", loopMode: "range", loopType: "int", loopCompare: "<" }, connected: {} }, style: { width: 600, height: 500 } },
      part("acc", "loop/accumulator", { x: 20, y: 290 }, { seed: 0 }),
      part("output", "loop/output", { x: 530, y: 20 }),
      part("start", "loop/start", { x: 20, y: 20 }, { start: 0 }),
      part("end", "loop/end", { x: 20, y: 110 }, { end: 4 }),
      part("index", "loop/index", { x: 20, y: 200 }),
      { ...node("add", "math/add", { x: 300, y: 200 }), parentId: L },
    ],
    edges: [
      { id: "a", source: `${L}::acc`, sourceHandle: "acc", target: "add", targetHandle: "a" },
      { id: "b", source: `${L}::index`, sourceHandle: "index", target: "add", targetHandle: "b" },
      { id: "c", source: "add", sourceHandle: "out", target: `${L}::output`, targetHandle: "next" },
      { id: "d", source: `${L}::output`, sourceHandle: "out", target: "mat", targetHandle: "colorNode" },
    ],
  };

  it("keeps the loop, its mode and its parts", () => {
    const { doc } = importTslGraph(src, "loops");
    const loop = doc.graphs.material.nodes.find((n) => n.id === L)!;
    expect(loop.type).toBe("loop");
    expect(loop.data.values).toMatchObject({ loopMode: "range", loopType: "int", loopCompare: "<" });
    expect(loop.data.label).toBe("Loop");
    expect(doc.graphs.material.nodes.filter((n) => n.parentId === L).map((n) => n.type).sort()).toEqual(
      ["loop/accumulator", "loop/end", "loop/index", "loop/output", "loop/start", "math/add"],
    );
    const r = compileProject(doc);
    expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(r.code).toMatch(/Loop\(\{ start: 0, end: 4, type: 'int', condition: '<', name: 'i' \}/);
  });
});
