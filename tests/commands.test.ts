import { describe, expect, it } from "vitest";
import { executeCommand, describeGraph, listNodeTypes, describeNodeType } from "../src/core/commands";
import { compileProject } from "../src/core/codegen";
import { createProject } from "../src/core/graph";
import { parseGlobals } from "../src/app/editor/globals-parse";

describe("commands", () => {
  it("batch with refs builds a working graph", () => {
    const doc = createProject("t");
    const mat = doc.graphs.material.nodes[0].id;
    const res = executeCommand(doc, {
      op: "batch",
      ops: [
        { op: "addNode", type: "geo/uv", ref: "uv" },
        { op: "addNode", type: "noise/fractal_noise_float", ref: "n" },
        { op: "addNode", type: "math/mul", ref: "m", values: { b: 4 } },
        { op: "connect", source: "$uv", target: "$m", targetHandle: "a" },
        { op: "connect", source: "$m", target: "$n", targetHandle: "position" },
        { op: "connect", source: "$n", target: mat, targetHandle: "colorNode" },
        { op: "autoLayout" },
      ],
    }) as { refs: Record<string, string> };
    expect(Object.keys(res.refs)).toEqual(["uv", "n", "m"]);
    const r = compileProject(doc);
    expect(r.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(r.code).toContain("mx_fractal_noise_float(");
  });

  it("reports helpful errors", () => {
    const doc = createProject("t");
    expect(() => executeCommand(doc, { op: "addNode", type: "math/sine" })).toThrow(/Did you mean/);
    const a = executeCommand(doc, { op: "addNode", type: "geo/uv" }) as { nodeId: string };
    const mat = doc.graphs.material.nodes[0].id;
    expect(() => executeCommand(doc, { op: "connect", source: a.nodeId, sourceHandle: "nope", target: mat, targetHandle: "colorNode" })).toThrow(
      /Available: x, y, out/,
    );
    expect(() => executeCommand(doc, { op: "addNode", type: "postfx/bloom", graph: "material" })).toThrow(/post graph/);
  });

  it("describes graphs and node types for agents", () => {
    const doc = createProject("t");
    const g = describeGraph(doc, "material");
    expect(g.nodes[0].type).toBe("material/standard");
    expect(listNodeTypes({ search: "fresnel" }).map((n) => n.type)).toContain("utils/fresnel");
    expect(describeNodeType("math/mix").inputs.map((i) => i.key)).toEqual(["a", "b", "t"]);
  });

  it("rejects cycles", () => {
    const doc = createProject("t");
    const a = executeCommand(doc, { op: "addNode", type: "math/add" }) as { nodeId: string };
    const b = executeCommand(doc, { op: "addNode", type: "math/add" }) as { nodeId: string };
    executeCommand(doc, { op: "connect", source: a.nodeId, target: b.nodeId, targetHandle: "a" });
    expect(() => executeCommand(doc, { op: "connect", source: b.nodeId, target: a.nodeId, targetHandle: "a" })).toThrow(/cycle/);
  });
});

describe("globals bulk import", () => {
  it("parses uniform/const declarations", () => {
    const g = parseGlobals("const foo = uniform(1); const bar = uniform(vec2(0, 2)); const c = color(0xff0000); let k = float(0.5);");
    expect(g).toEqual([
      { name: "foo", kind: "uniform", type: "float", value: 1 },
      { name: "bar", kind: "uniform", type: "vec2", value: [0, 2] },
      { name: "c", kind: "const", type: "color", value: "#ff0000" },
      { name: "k", kind: "const", type: "float", value: 0.5 },
    ]);
  });
});

describe("loop commands", () => {
  it("adding a loop creates its parts, updating loopMode swaps them", () => {
    const doc = createProject("t");
    const added = executeCommand(doc, { op: "addNode", type: "loop", values: { loopMode: "range", loopCompare: "<=" } }) as {
      nodeId: string;
      parts: Record<string, string>;
    };
    expect(Object.keys(added.parts).sort()).toEqual(["loop/accumulator", "loop/end", "loop/index", "loop/output", "loop/start"]);
    const loop = doc.graphs.material.nodes.find((n) => n.id === added.nodeId)!;
    expect(loop.data.values).toMatchObject({ loopMode: "range", loopCompare: "<=" });

    const updated = executeCommand(doc, { op: "updateNode", nodeId: added.nodeId, values: { loopMode: "nested" } }) as {
      parts: Record<string, string>;
    };
    expect(updated.parts["loop/count2"]).toBeDefined();
    expect(updated.parts["loop/start"]).toBeUndefined();
  });

  it("refuses a second copy of a part the loop already has", () => {
    const doc = createProject("t");
    const { nodeId, parts } = executeCommand(doc, { op: "addNode", type: "loop" }) as { nodeId: string; parts: Record<string, string> };
    expect(() => executeCommand(doc, { op: "addNode", type: "loop/count", parentId: nodeId })).toThrow(parts["loop/count"]);
    expect(() => executeCommand(doc, { op: "addNode", type: "loop", values: { loopMode: "sideways" } })).toThrow(/Unknown loop mode/);
  });
});
