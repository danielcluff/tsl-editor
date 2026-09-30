import { describe, expect, it } from "vitest";
import { compileProject } from "../src/core/codegen";
import { addNode, connect, createProject, graphOf, makeNode, normalizeDoc, resolvePorts } from "../src/core/graph";
import { chainToMultiOp, detectConvertibleChain, multiOpInfo, multiOpOptions, multiOpToChain } from "../src/core/multiop";
import type { ProjectDoc } from "../src/core/types";

const colorOut = (doc: ProjectDoc, source: string) =>
  connect(doc, "material", { source, sourceHandle: "out", target: doc.graphs.material.nodes[0].id, targetHandle: "colorNode" });

describe("multi-op", () => {
  it("offers the original's 59 operations in its order", () => {
    const opts = multiOpOptions();
    expect(opts).toHaveLength(59);
    expect(opts.slice(0, 5).map((o) => o.label)).toEqual(["Add", "Subtract", "Multiply", "Divide", "Sin"]);
    expect(opts.at(-1)!.label).toBe("fwidth");
  });

  it("picks chain inputs by the original's priority", () => {
    expect(multiOpInfo("add")!.chainKey).toBe("a");
    expect(multiOpInfo("step")!.chainKey).toBe("x"); // not the first input
    expect(multiOpInfo("remap")!.chainKey).toBe("node");
    expect(multiOpInfo("range")!.chainKey).toBe("min"); // no match: first input
  });

  it("only the first operation exposes its chain input", () => {
    const doc = createProject("t");
    const mo = addNode(doc, "material", "math/multiOp", { x: 0, y: 0 });
    mo.data.operations = [
      { id: "a", op: "sin" },
      { id: "b", op: "mul" },
      { id: "c", op: "mix" },
    ];
    expect(resolvePorts(doc, mo).inputs.map((p) => p.key)).toEqual(["op_a_x", "op_b_b", "op_c_b", "op_c_t"]);
  });

  it("generates chained TSL and keeps argument order for non-first chain inputs", () => {
    const doc = createProject("t");
    const mo = addNode(doc, "material", "math/multiOp", { x: 0, y: 0 });
    mo.data.operations = [
      { id: "a", op: "sin" },
      { id: "b", op: "mul" },
      { id: "c", op: "step" },
    ];
    mo.data.values = { op_a_x: 1, op_b_b: 2, op_c_edge: 0.5 };
    colorOut(doc, mo.id);
    const r = compileProject(doc);
    expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    // step(edge, x): the previous result goes in x, the second argument
    expect(r.code).toContain("step(float(0.5), sin(float(1)).mul(float(2)))");
  });

  it("detects convertible chains with the original's rules", () => {
    const doc = createProject("t");
    const g = graphOf(doc, "material");
    const sin = addNode(doc, "material", "math/sin", { x: 0, y: 0 });
    const mul = addNode(doc, "material", "math/mul", { x: 200, y: 0 }, { values: { b: 3 } });
    const add = addNode(doc, "material", "math/add", { x: 400, y: 0 }, { values: { b: 0.5 } });
    connect(doc, "material", { source: sin.id, sourceHandle: "out", target: mul.id, targetHandle: "a" });
    connect(doc, "material", { source: mul.id, sourceHandle: "out", target: add.id, targetHandle: "a" });
    const ok = detectConvertibleChain([add.id, sin.id, mul.id], g);
    expect(ok).toEqual({ valid: true, ordered: [sin.id, mul.id, add.id] });
    expect(detectConvertibleChain([sin.id], g).valid).toBe(false);
    // feeding a non-chain input breaks it
    const other = addNode(doc, "material", "math/cos", { x: 0, y: 200 });
    connect(doc, "material", { source: other.id, sourceHandle: "out", target: add.id, targetHandle: "b" });
    expect(detectConvertibleChain([other.id, add.id], g)).toMatchObject({ valid: false });
    // non-math nodes can't join
    const uv = addNode(doc, "material", "geo/uv", { x: 0, y: 400 });
    expect(detectConvertibleChain([uv.id, sin.id], g)).toMatchObject({ valid: false });
  });

  it("converts a chain and expands it back, keeping values and wires", () => {
    const doc = createProject("t");
    const g = graphOf(doc, "material");
    const uv = addNode(doc, "material", "geo/uv", { x: -200, y: 0 });
    const sin = addNode(doc, "material", "math/sin", { x: 0, y: 0 });
    const mul = addNode(doc, "material", "math/mul", { x: 200, y: 0 }, { values: { b: 3 } });
    connect(doc, "material", { source: uv.id, sourceHandle: "x", target: sin.id, targetHandle: "x" });
    connect(doc, "material", { source: sin.id, sourceHandle: "out", target: mul.id, targetHandle: "a" });
    colorOut(doc, mul.id);
    const before = compileProject(doc).code;

    const mo = makeNode("math/multiOp", sin.position);
    chainToMultiOp(g, [sin.id, mul.id], mo);
    expect(g.nodes.some((n) => n.id === sin.id || n.id === mul.id)).toBe(false);
    expect(mo.data.operations!.map((o) => o.op)).toEqual(["sin", "mul"]);
    expect(Object.values(mo.data.values)).toEqual([3]);
    expect(g.edges.filter((e) => e.target === mo.id || e.source === mo.id)).toHaveLength(2);
    const converted = compileProject(doc);
    expect(converted.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(converted.code).toMatch(/sin\(\w+\.x\)\.mul\(float\(3\)\)/);

    const ids = multiOpToChain(g, mo, (type, pos) => makeNode(type, pos));
    expect(ids.map((id) => g.nodes.find((n) => n.id === id)!.type)).toEqual(["math/sin", "math/mul"]);
    expect(g.nodes.find((n) => n.id === ids[1])!.data.values.b).toBe(3);
    expect(compileProject(doc).code.replace(/_node\d+/g, "_n")).toBe(before.replace(/_node\d+/g, "_n"));
  });

  it("migrates our earlier in0..inN format", () => {
    const doc = createProject("t");
    const mo = addNode(doc, "material", "math/multiOp", { x: 0, y: 0 });
    const legacy = mo.data as unknown as { ops?: { op: string }[]; operations?: unknown };
    delete legacy.operations;
    legacy.ops = [{ op: "add" }, { op: "mul" }];
    mo.data.values = { in0: 1, in1: 2, in2: 4 };
    const uv = addNode(doc, "material", "geo/uv", { x: -200, y: 0 });
    // old ports no longer exist, so add the saved wire directly
    doc.graphs.material.edges.push({ id: "old", source: uv.id, sourceHandle: "x", target: mo.id, targetHandle: "in0" });
    normalizeDoc(doc);
    const [a, b] = mo.data.operations!;
    expect(mo.data.operations!.map((o) => o.op)).toEqual(["add", "mul"]);
    expect(mo.data.values).toEqual({ [`op_${a.id}_a`]: 1, [`op_${a.id}_b`]: 2, [`op_${b.id}_b`]: 4 });
    expect(doc.graphs.material.edges.find((e) => e.target === mo.id)!.targetHandle).toBe(`op_${a.id}_a`);
    expect("ops" in mo.data).toBe(false);
  });
});

import { isUniformAcrossSurface } from "../src/core/graph";
describe("surface-uniform outputs", () => {
  it("treats constants, uniforms and time as uniform, and anything with UVs as varying", () => {
    const doc = createProject("t");
    const g = doc.graphs.material;
    const time = addNode(doc, "material", "geo/time", { x: 0, y: 0 });
    const sin = addNode(doc, "material", "math/sin", { x: 0, y: 0 });
    connect(doc, "material", { source: time.id, sourceHandle: "out", target: sin.id, targetHandle: "x" });
    const uv = addNode(doc, "material", "geo/uv", { x: 0, y: 0 });
    const mix = addNode(doc, "material", "math/mix", { x: 0, y: 0 });
    connect(doc, "material", { source: sin.id, sourceHandle: "out", target: mix.id, targetHandle: "t" });
    expect(isUniformAcrossSurface(doc, g, sin.id)).toBe(true);
    expect(isUniformAcrossSurface(doc, g, mix.id)).toBe(true);
    connect(doc, "material", { source: uv.id, sourceHandle: "x", target: mix.id, targetHandle: "b" });
    expect(isUniformAcrossSurface(doc, g, mix.id)).toBe(false);
  });
});

import { animatedNodes, nodeSignatures } from "../src/core/graph";
describe("preview reuse helpers", () => {
  it("marks only time-dependent nodes as animated", () => {
    const doc = createProject("t");
    const g = doc.graphs.material;
    const time = addNode(doc, "material", "geo/time", { x: 0, y: 0 });
    const sin = addNode(doc, "material", "math/sin", { x: 0, y: 0 });
    const uv = addNode(doc, "material", "geo/uv", { x: 0, y: 0 });
    const cos = addNode(doc, "material", "math/cos", { x: 0, y: 0 });
    connect(doc, "material", { source: time.id, sourceHandle: "out", target: sin.id, targetHandle: "x" });
    connect(doc, "material", { source: uv.id, sourceHandle: "x", target: cos.id, targetHandle: "x" });
    const waves = addNode(doc, "material", "tslTextures/waves", { x: 0, y: 0 });
    const a = animatedNodes(doc, g);
    expect(a.has(sin.id)).toBe(true);
    expect(a.has(cos.id)).toBe(false);
    expect(a.has(waves.id)).toBe(true); // its time input defaults to the live time uniform
    waves.data.values.time = 1;
    expect(animatedNodes(doc, g).has(waves.id)).toBe(false);
  });

  it("signatures change downstream of an edit only, and ignore layout", () => {
    const doc = createProject("t");
    const g = doc.graphs.material;
    const uv = addNode(doc, "material", "geo/uv", { x: 0, y: 0 });
    const a = addNode(doc, "material", "math/mul", { x: 0, y: 0 }, { values: { b: 2 } });
    const b = addNode(doc, "material", "math/add", { x: 0, y: 0 });
    const other = addNode(doc, "material", "math/cos", { x: 0, y: 0 });
    connect(doc, "material", { source: uv.id, sourceHandle: "x", target: a.id, targetHandle: "a" });
    connect(doc, "material", { source: a.id, sourceHandle: "out", target: b.id, targetHandle: "a" });
    const before = nodeSignatures(doc, g);
    a.position = { x: 500, y: 500 };
    a.data.label = "renamed";
    expect(nodeSignatures(doc, g)).toEqual(before);
    a.data.values.b = 3;
    const after = nodeSignatures(doc, g);
    expect(after.get(a.id)).not.toBe(before.get(a.id));
    expect(after.get(b.id)).not.toBe(before.get(b.id)); // downstream
    expect(after.get(uv.id)).toBe(before.get(uv.id)); // upstream
    expect(after.get(other.id)).toBe(before.get(other.id)); // unrelated
  });
});
