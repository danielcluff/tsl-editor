import { findGlobal, findSubgraph, resolvePorts } from "./graph";
import { getNodeDef } from "./registry";
import exportsList from "./tsl-exports.json";
import { UTIL_SOURCES, utilClosure } from "./tsl-utils";
import type {
  Diagnostic,
  GlobalDef,
  Graph,
  GraphEdge,
  GraphKind,
  GraphNode,
  NodeDef,
  PortDef,
  ProjectDoc,
  SubgraphDef,
} from "./types";

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export interface GraphOutput {
  /** Statements for this graph (no imports, no utils, no globals). */
  lines: string[];
  /** nodeId -> variable name, for debug previews. */
  nodes: Record<string, string>;
  /** uniform nodeId -> variable name, for live value updates. */
  uniforms: Record<string, string>;
  ok: boolean;
}

export interface CompileResult {
  /** Complete, self-contained ES module. */
  code: string;
  /** Function bodies evaluated by the live preview (see runtime/evaluate.ts). */
  runtime: { material: string; post: string };
  material: GraphOutput;
  post: GraphOutput & { connected: boolean };
  globals: Record<string, string>;
  diagnostics: Diagnostic[];
  utils: string[];
}

export function compileProject(doc: ProjectDoc): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const utilsUsed = new Set<string>();
  const shared: Shared = { doc, diagnostics, utilsUsed, failed: new Set() };

  const globalsOut = emitGlobals(doc);
  const material = compileMaterialGraph(shared, globalsOut.names);
  const post = compilePostGraph(shared, globalsOut.names);
  const subgraphLines = [...material.subgraphLines, ...post.subgraphLines];
  const subgraphs = dedupeBlocks(subgraphLines);

  const utils = utilClosure(utilsUsed);
  const utilCode = utils.map((u) => UTIL_SOURCES[u].code);

  // -- exported module ------------------------------------------------------
  const body: string[] = [];
  if (utilCode.length) body.push("// Inline TSL Utils", ...utilCode, "");
  if (globalsOut.lines.length) body.push("// Globals", ...globalsOut.lines, "");
  if (subgraphs.length) body.push(...subgraphs, "");
  body.push("// Material Graph", "// Generated TSL Code", "", ...material.lines, "");
  body.push("// Post Graph");
  if (post.connected) body.push(...post.lines);
  else body.push("// Post output is not connected.");
  body.push("", "// Pipeline Wiring");
  if (post.connected) {
    body.push(
      "const renderPipeline = new RenderPipeline(renderer);",
      `renderPipeline.outputNode = ${post.outputExpr};`,
      "// in your animation loop:",
      "renderPipeline.render();",
    );
  } else {
    body.push(
      "const scenePass = pass(scene, camera);",
      "scenePass.setMRT(mrt({ output, normal: normalView }));",
      "const renderPipeline = new RenderPipeline(renderer);",
      "renderer.render(scene, camera);",
    );
  }
  const bodyText = body.join("\n");
  const code = [...buildImports(bodyText, material.addonImports.concat(post.addonImports)), "", bodyText, ""].join(
    "\n",
  );

  // -- runtime bodies -------------------------------------------------------
  const prelude = [...utilCode, ...globalsOut.lines, ...subgraphs];
  const runtimeMaterial = [
    ...prelude,
    ...material.lines,
    `return { material: ${material.ok ? "material" : "null"}, nodes: { ${objEntries(material.nodes)} }, uniforms: { ${objEntries(
      { ...material.uniforms, ...prefixKeys(globalsOut.names, "global:") },
    )} } };`,
  ].join("\n");
  const runtimePost = [
    ...prelude,
    ...(post.connected ? post.lines : []),
    `return { outputNode: ${post.connected ? post.outputExpr : "null"}, toneMapping: ${JSON.stringify(
      post.toneMapping,
    )}, nodes: { ${objEntries(post.nodes)} }, uniforms: { ${objEntries({
      ...post.uniforms,
      ...prefixKeys(globalsOut.names, "global:"),
    })} } };`,
  ].join("\n");

  return {
    code,
    runtime: { material: runtimeMaterial, post: runtimePost },
    material: { lines: material.lines, nodes: material.nodes, uniforms: material.uniforms, ok: material.ok },
    post: {
      lines: post.lines,
      nodes: post.nodes,
      uniforms: post.uniforms,
      ok: post.ok,
      connected: post.connected,
    },
    globals: globalsOut.names,
    diagnostics,
    utils,
  };
}

function objEntries(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${JSON.stringify(k)}: ${v}`)
    .join(", ");
}

function prefixKeys(map: Record<string, string>, prefix: string): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [prefix + k, v]));
}

function dedupeBlocks(lines: string[]): string[] {
  // subgraph blocks are joined strings; drop exact duplicates between graphs
  return [...new Set(lines)];
}

// ---------------------------------------------------------------------------
// literals
// ---------------------------------------------------------------------------

const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof var void while with yield await implements interface package private protected public arguments eval".split(" "),
);

export function sanitizeIdent(name: string): string {
  const s = String(name)
    .replace(/[^a-zA-Z0-9_$]/g, "_")
    .replace(/^([0-9])/, "_$1");
  if (!s) return "_";
  return RESERVED.has(s) ? `${s}_` : s;
}

function num(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  // keep integers readable, trim float noise
  return String(Math.round(n * 1e6) / 1e6);
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v);
}

function hex(v: string): string {
  const s = v.startsWith("#") ? v : `#${v}`;
  return JSON.stringify(s.toLowerCase());
}

/** A value as a TSL expression suitable as a function argument. */
export function literal(value: unknown, type: string, opts: { node?: boolean } = {}): string {
  const node = opts.node ?? false;
  if (value === null || value === undefined) return "undefined";
  if (type === "color") {
    if (isHexColor(value)) return `color(${hex(value)})`;
    if (Array.isArray(value)) return `color(${value.map(num).join(", ")})`;
    if (typeof value === "number") return `color(${num(value)})`;
  }
  const vm = /^(i|u|b)?vec([2-4])$/.exec(type);
  if (vm) {
    const n = Number(vm[2]);
    if (Array.isArray(value)) return `${type}(${value.slice(0, n).map(num).join(", ")})`;
    if (typeof value === "number") return `${type}(${num(value)})`;
    if (isHexColor(value)) return `${type}(color(${hex(value)}))`;
  }
  switch (type) {
    case "float":
      return node ? `float(${num(value)})` : num(value);
    case "int":
      return `int(${Math.round(Number(value) || 0)})`;
    case "uint":
      return `uint(${Math.max(0, Math.round(Number(value) || 0))})`;
    case "bool":
      return `bool(${value ? "true" : "false"})`;
    case "string":
      return JSON.stringify(String(value));
  }
  // `any` — infer from the JS value
  if (typeof value === "number") return node ? `float(${num(value)})` : num(value);
  if (typeof value === "boolean") return `bool(${value})`;
  if (isHexColor(value)) return `color(${hex(value)})`;
  if (Array.isArray(value) && value.every((x) => typeof x === "number")) {
    const n = Math.min(4, Math.max(2, value.length));
    return `vec${n}(${value.slice(0, n).map(num).join(", ")})`;
  }
  return JSON.stringify(value);
}

/** Ensure an expression is a node (so method calls like `.toVar()` work). */
function asNode(expr: string): string {
  return /^-?\d+(\.\d+)?(e-?\d+)?$/.test(expr) ? `float(${expr})` : expr;
}

// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

function uniformInit(type: string, value: unknown): string {
  switch (type) {
    case "color":
      return `uniform(new Color(${isHexColor(value) ? hex(value) : '"#ffffff"'}))`;
    case "vec2":
    case "vec3":
    case "vec4": {
      const n = Number(type[3]);
      const arr = Array.isArray(value) ? value : Array(n).fill(Number(value) || 0);
      return `uniform(new Vector${n}(${arr.slice(0, n).map(num).join(", ")}))`;
    }
    case "int":
      return `uniform(${Math.round(Number(value) || 0)}, 'int')`;
    case "bool":
      return `uniform(${value ? "true" : "false"}, 'bool')`;
    default:
      return `uniform(${num(value ?? 0)})`;
  }
}

function emitGlobals(doc: ProjectDoc): { lines: string[]; names: Record<string, string> } {
  const lines: string[] = [];
  const names: Record<string, string> = {};
  const used = new Set<string>();
  for (const g of doc.globals) {
    let name = sanitizeIdent(g.name || "global");
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    names[g.id] = name;
    lines.push(`const ${name} = ${globalInit(g)};`);
  }
  return { lines, names };
}

function globalInit(g: GlobalDef): string {
  if (g.kind === "uniform") return uniformInit(g.type, g.value);
  const lit = literal(g.value, g.type, { node: true });
  return g.kind === "varying" ? `varying(${lit})` : lit;
}

// ---------------------------------------------------------------------------
// graph compilation
// ---------------------------------------------------------------------------

interface Shared {
  doc: ProjectDoc;
  diagnostics: Diagnostic[];
  utilsUsed: Set<string>;
  /** Nodes that failed to compile; their dependents are skipped without extra errors. */
  failed: Set<string>;
}

interface VarInfo {
  name: string;
  /** Node exposes one value: every handle resolves to `name`. */
  single?: boolean;
  /** Explicit per-handle expressions. */
  handles?: Record<string, string>;
}

interface Scope {
  shared: Shared;
  graphKind: GraphKind;
  graph: Graph;
  globals: Record<string, string>;
  vars: Map<string, VarInfo>;
  names: Set<string>;
  counter: { n: number };
  lines: string[];
  indent: string;
  /** true inside a Fn/Loop body: assignments and Discard can be emitted inline. */
  inFn: boolean;
  /** Collects `Discard(cond)` for the material's fragment wrapper. */
  discards: string[];
  subgraphLines: string[];
  addonImports: { name: string; from: string }[];
  /** For subgraph bodies: subgraph/input handle -> parameter expr. */
  params?: Record<string, string>;
  compilingSubgraphs: Set<string>;
  nodesOut: Record<string, string>;
  uniformsOut: Record<string, string>;
}

function newScope(
  shared: Shared,
  graphKind: GraphKind,
  graph: Graph,
  globals: Record<string, string>,
  parent?: Scope,
): Scope {
  return {
    shared,
    graphKind,
    graph,
    globals,
    vars: parent ? new Map(parent.vars) : new Map(),
    names: parent ? parent.names : new Set(["material", "scenePass", "renderPipeline", ...Object.values(globals)]),
    counter: parent ? parent.counter : { n: 0 },
    lines: [],
    indent: parent ? parent.indent : "",
    inFn: parent?.inFn ?? false,
    discards: parent ? parent.discards : [],
    subgraphLines: parent ? parent.subgraphLines : [],
    addonImports: parent ? parent.addonImports : [],
    params: parent?.params,
    compilingSubgraphs: parent ? parent.compilingSubgraphs : new Set(),
    nodesOut: parent ? parent.nodesOut : {},
    uniformsOut: parent ? parent.uniformsOut : {},
  };
}

function freshName(scope: Scope, hint?: string): string {
  const base = hint ? sanitizeIdent(hint) : `_node${scope.counter.n}`;
  scope.counter.n++;
  let name = base;
  let i = 1;
  while (scope.names.has(name)) name = `${base}_${i++}`;
  scope.names.add(name);
  return name;
}

function emit(scope: Scope, line: string) {
  for (const l of line.split("\n")) scope.lines.push(scope.indent + l);
}

class NodeError extends Error {}
/** An input comes from a node that already failed: skip quietly, the root cause is reported once. */
class UpstreamError extends NodeError {}

const HANDLE_REMAP: Record<string, Record<string, string>> = {
  "geo/camera": { near: "x", far: "y" },
};

function outputRef(scope: Scope, sourceId: string, handle: string): string {
  const v = scope.vars.get(sourceId);
  if (!v) {
    if (scope.shared.failed.has(sourceId)) throw new UpstreamError("upstream node failed");
    const src = scope.graph.nodes.find((n) => n.id === sourceId);
    throw new NodeError(`Input from "${src ? getNodeDef(src.type)?.label ?? src.type : sourceId}" is not available`);
  }
  if (v.handles && handle in v.handles) return v.handles[handle];
  if (v.single || handle === "out") return v.name;
  const src = scope.graph.nodes.find((n) => n.id === sourceId);
  const remapped = src ? HANDLE_REMAP[src.type]?.[handle] : undefined;
  return `${v.name}.${remapped ?? handle}`;
}

function incomingEdge(scope: Scope, nodeId: string, handle: string): GraphEdge | undefined {
  return scope.graph.edges.find((e) => e.target === nodeId && e.targetHandle === handle);
}

function inputExpr(scope: Scope, node: GraphNode, port: PortDef, opts: { node?: boolean } = {}): string | undefined {
  const e = incomingEdge(scope, node.id, port.key);
  if (e) return outputRef(scope, e.source, e.sourceHandle);
  if (port.connectionOnly) return undefined;
  const value = node.data.values[port.key] ?? port.default;
  if (value === undefined || value === null) return undefined;
  return literal(value, String(port.type), opts);
}

function requireInput(scope: Scope, node: GraphNode, port: PortDef, opts: { node?: boolean } = {}): string {
  const e = inputExpr(scope, node, port, opts);
  if (e === undefined) throw new NodeError(`Input "${port.label}" is not connected`);
  return e;
}

/** Inputs that may be left empty (the TSL function has its own default). */
const OPTIONAL_INPUTS = new Set([
  "texture/viewportShared:uv",
  "texture/viewportDepth:uv",
  "texture/triplanar:textureY",
  "texture/triplanar:textureZ",
  "texture/triplanar:position",
  "texture/triplanar:normal",
  "postfx/film:uv",
]);

function isRequired(def: NodeDef, port: PortDef, index: number): boolean {
  if (port.default !== undefined) return false;
  if (OPTIONAL_INPUTS.has(`${def.type}:${port.key}`)) return false;
  const from = def.importFrom;
  if (from === "tsl-textures" || from === "@/lib/tsl-utils" || from === "tsl-easings") return false;
  if (from?.startsWith("three/addons")) return index === 0 || ["nodeA", "nodeB", "viewZ"].includes(port.key);
  return true;
}

/** Positional args, trimming trailing `undefined`. Literals become nodes so helpers can call methods on them. */
function positionalArgs(scope: Scope, node: GraphNode, inputs: PortDef[], def?: NodeDef): string[] {
  const args = inputs.map((p, i) => {
    const e = inputExpr(scope, node, p, { node: true });
    if (e === undefined && def && isRequired(def, p, i)) throw new NodeError(`Input "${p.label}" is not connected`);
    return e ?? "undefined";
  });
  while (args.length && args[args.length - 1] === "undefined") args.pop();
  return args;
}

// ---------------------------------------------------------------------------
// ordering
// ---------------------------------------------------------------------------

function topoOrder(scope: Scope, nodes: GraphNode[], collapse: (id: string) => string): GraphNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const deps = new Map<string, Set<string>>();
  for (const n of nodes) deps.set(n.id, new Set());
  const addDep = (target: string, source: string) => {
    const t = collapse(target);
    const s = collapse(source);
    if (t === s || !ids.has(t) || !ids.has(s)) return;
    deps.get(t)!.add(s);
  };
  for (const e of scope.graph.edges) addDep(e.target, e.source);
  for (const n of scope.graph.nodes) {
    if (n.data.localSourceId) addDep(n.id, n.data.localSourceId);
    if (n.type === "utils/portal" && n.data.portalId) {
      const sender = scope.graph.nodes.find(
        (m) => m.id !== n.id && m.data.portalId === n.data.portalId && incomingEdge(scope, m.id, "in"),
      );
      if (sender && !incomingEdge(scope, n.id, "in")) addDep(n.id, sender.id);
    }
  }
  // Kahn, stable by position (left→right, top→bottom) for readable output
  const sorted: GraphNode[] = [];
  const pending = [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const done = new Set<string>();
  while (pending.length) {
    const idx = pending.findIndex((n) => [...deps.get(n.id)!].every((d) => done.has(d)));
    if (idx === -1) {
      for (const n of pending) {
        scope.shared.diagnostics.push({
          level: "error",
          message: "Node is part of a dependency cycle",
          nodeId: n.id,
          graph: scope.graphKind,
        });
      }
      break;
    }
    const [n] = pending.splice(idx, 1);
    done.add(n.id);
    sorted.push(n);
  }
  return sorted;
}

const SKIP_KINDS = new Set(["comment", "group", "material", "postOutput", "subgraphOutput"]);

function compileNodes(scope: Scope, nodes: GraphNode[], container?: string) {
  // Nodes inside a loop container compile inside that loop; for ordering the
  // whole loop behaves like one node.
  const loopOf = (id: string) => {
    const n = scope.graph.nodes.find((x) => x.id === id);
    if (n?.parentId && n.parentId !== container) {
      const parent = scope.graph.nodes.find((x) => x.id === n.parentId);
      if (parent && getNodeDef(parent.type)?.kind === "loop") return parent.id;
    }
    return id;
  };
  const topLevel = nodes.filter((n) => loopOf(n.id) === n.id);
  for (const node of topoOrder(scope, topLevel, loopOf)) {
    const def = getNodeDef(node.type);
    if (!def || SKIP_KINDS.has(def.kind ?? "")) continue;
    compileOne(scope, node, def);
  }
}

function compileOne(scope: Scope, node: GraphNode, def: NodeDef) {
  const before = scope.lines.length;
  try {
    compileNode(scope, node, def);
  } catch (err) {
    scope.lines.length = before;
    scope.shared.failed.add(node.id);
    if (err instanceof UpstreamError) return;
    const message = err instanceof Error ? err.message : String(err);
    scope.shared.diagnostics.push({
      level: "error",
      message: `${def.label}: ${message}`,
      nodeId: node.id,
      graph: scope.graphKind,
    });
  }
}

// ---------------------------------------------------------------------------
// per-node emission
// ---------------------------------------------------------------------------

const ASSIGN_METHODS: Record<string, string> = {
  "assign/assign": "assign",
  "assign/addAssign": "addAssign",
  "assign/subAssign": "subAssign",
  "assign/mulAssign": "mulAssign",
  "assign/divAssign": "divAssign",
  "assign/modAssign": "modAssign",
  "assign/bitAndAssign": "bitAndAssign",
  "assign/bitOrAssign": "bitOrAssign",
  "assign/bitXorAssign": "bitXorAssign",
  "assign/shiftLeftAssign": "shiftLeftAssign",
  "assign/shiftRightAssign": "shiftRightAssign",
};

const POST_HANDLES: Record<string, string> = {
  color: "scenePassColor",
  depth: "scenePassDepth",
  normal: "scenePassNormal",
  sceneTexture: "scenePassColor",
  depthTexture: "scenePassDepthTexture",
  normalTexture: "scenePassNormalTexture",
};

function declare(scope: Scope, node: GraphNode, expr: string, info: Omit<VarInfo, "name"> = {}, hint?: string) {
  const name = freshName(scope, hint ?? node.data.localName);
  emit(scope, `const ${name} = ${expr};`);
  scope.vars.set(node.id, { name, ...info });
  if (scope.indent === "" && !scope.params) scope.nodesOut[node.id] = name;
  return name;
}

function compileNode(scope: Scope, node: GraphNode, def: NodeDef) {
  const ports = resolvePorts(scope.shared.doc, node);
  switch (def.kind) {
    case "const": {
      if (def.type === "const/color") {
        const e = incomingEdge(scope, node.id, "value");
        const expr = e
          ? `color(${outputRef(scope, e.source, e.sourceHandle)})`
          : literal(node.data.values.value ?? "#ffffff", "color");
        declare(scope, node, expr);
        return;
      }
      if (def.type === "const/float" || def.type === "const/int") {
        const e = incomingEdge(scope, node.id, "value");
        const fn = def.type === "const/float" ? "float" : "int";
        const v = node.data.values.value ?? 0;
        const expr = e
          ? `${fn}(${outputRef(scope, e.source, e.sourceHandle)})`
          : fn === "float"
            ? `float(${num(v)})`
            : `int(${Math.round(Number(v) || 0)})`;
        declare(scope, node, expr);
        return;
      }
      // vec2/3/4 — standard positional
      declare(scope, node, `${def.tsl}(${positionalArgs(scope, node, def.inputs).join(", ")})`);
      return;
    }
    case "uniform": {
      const type = String(node.data.values.type ?? "float");
      const name = declare(scope, node, uniformInit(type, node.data.values.value), {}, node.data.localName || undefined);
      if (!scope.params && scope.indent === "") scope.uniformsOut[node.id] = name;
      return;
    }
    case "globalRef": {
      const g = findGlobal(scope.shared.doc, node.data.globalId);
      const name = g ? scope.globals[g.id] : undefined;
      if (!name) throw new NodeError("Referenced global no longer exists");
      scope.vars.set(node.id, { name });
      if (scope.indent === "" && !scope.params) scope.nodesOut[node.id] = name;
      return;
    }
    case "localSet": {
      const e = incomingEdge(scope, node.id, "value");
      if (!e) throw new NodeError(`Set Local "${node.data.localName ?? node.id}" is missing its source connection`);
      const src = outputRef(scope, e.source, e.sourceHandle);
      declare(scope, node, src, { single: true }, node.data.localName ? `local_${node.data.localName}` : undefined);
      return;
    }
    case "localGet": {
      const srcId = node.data.localSourceId;
      if (!srcId) throw new NodeError("Get Local has no source selected");
      const v = scope.vars.get(srcId);
      if (!v) throw new NodeError("Referenced Set Local is not available in this scope");
      scope.vars.set(node.id, { name: v.name, single: true });
      return;
    }
    case "split": {
      const input = requireInput(scope, node, def.inputs[0], { node: true });
      declare(scope, node, asNode(input));
      return;
    }
    case "multiOp": {
      const ops = node.data.ops ?? [{ op: "add" }];
      let expr = inputExpr(scope, node, ports.inputs[0]) ?? "0";
      ops.forEach((step, i) => {
        const rhs = inputExpr(scope, node, ports.inputs[i + 1]) ?? "0";
        expr = `${step.op}(${expr}, ${rhs})`;
      });
      declare(scope, node, expr, { single: true });
      return;
    }
    case "assign": {
      const target = incomingEdge(scope, node.id, "target");
      if (!target) throw new NodeError("Target is not connected (connect a Var)");
      const t = outputRef(scope, target.source, target.sourceHandle);
      const value = inputExpr(scope, node, def.inputs[1]) ?? "0";
      const method = ASSIGN_METHODS[node.type];
      const stmt =
        node.type === "assign/maxAssign"
          ? `${t}.assign(max(${t}, ${value}));`
          : node.type === "assign/minAssign"
            ? `${t}.assign(min(${t}, ${value}));`
            : `${t}.${method}(${value});`;
      if (scope.inFn) {
        emit(scope, stmt);
        scope.vars.set(node.id, { name: t, single: true });
      } else {
        const fnName = freshName(scope, `_assign_${scope.counter.n}`);
        emit(scope, `const ${fnName} = Fn(() => {\n  ${stmt}\n  return ${t};\n});`);
        declare(scope, node, `${fnName}()`, { single: true });
      }
      return;
    }
    case "loop":
      compileLoop(scope, node);
      return;
    case "loopPart":
      // Parts outside a loop container are meaningless.
      throw new NodeError("Loop parts must be placed inside a Loop");
    case "postInput": {
      const handles: Record<string, string> = {};
      for (const o of def.outputs) handles[o.key] = POST_HANDLES[o.key] ?? "scenePassColor";
      scope.vars.set(node.id, { name: "scenePassColor", handles });
      return;
    }
    case "postScene": {
      const name =
        node.type === "post/sceneDepth"
          ? "scenePassDepth"
          : node.type === "post/sceneNormal"
            ? "scenePassNormal"
            : "scenePassColor";
      scope.vars.set(node.id, { name });
      if (scope.indent === "") scope.nodesOut[node.id] = name;
      return;
    }
    case "textureSample": {
      const v = node.data.values;
      const texName = freshName(scope, `_tex${scope.counter.n}`);
      const url = String(v.url ?? "/uv.png");
      emit(scope, `const ${texName} = new TextureLoader().load(${JSON.stringify(url)});`);
      emit(scope, `${texName}.colorSpace = ${String(v.colorSpace ?? "SRGBColorSpace")};`);
      emit(scope, `${texName}.wrapS = ${String(v.wrapS ?? "RepeatWrapping")};`);
      emit(scope, `${texName}.wrapT = ${String(v.wrapT ?? "RepeatWrapping")};`);
      if (v.minFilter && v.minFilter !== "LinearMipmapLinearFilter") emit(scope, `${texName}.minFilter = ${v.minFilter};`);
      if (v.magFilter && v.magFilter !== "LinearFilter") emit(scope, `${texName}.magFilter = ${v.magFilter};`);
      if (v.flipY === false) emit(scope, `${texName}.flipY = false;`);
      const uvIn = inputExpr(scope, node, def.inputs.find((i) => i.key === "uv")!);
      declare(scope, node, `texture(${texName}${uvIn ? `, ${uvIn}` : ""})`);
      return;
    }
    case "gradient": {
      scope.shared.utilsUsed.add("linearGradient");
      const t = inputExpr(scope, node, def.inputs[0]);
      const mode = Number(node.data.values.mode ?? 0);
      const stops = (node.data.values.stops as { pos: number; color: string }[] | undefined) ?? [];
      const stopsLit = `[${stops.map((s) => `{ pos: ${num(s.pos)}, color: ${hex(s.color)} }`).join(", ")}]`;
      declare(scope, node, `linearGradient(${t ?? "uv().x"}, ${mode}, ${stopsLit})`);
      return;
    }
    case "code":
      compileCodeNode(scope, node);
      return;
    case "subgraph":
      compileSubgraphInstance(scope, node);
      return;
    case "subgraphInput": {
      if (!scope.params) throw new NodeError("Subgraph Input can only be used inside a subgraph");
      scope.vars.set(node.id, { name: "_in", handles: scope.params });
      return;
    }
    case "placeholder":
      throw new NodeError(
        `Unsupported imported node "${node.data.placeholder?.originalType ?? node.type}" — delete it or replace it with a supported node`,
      );
    case "portal": {
      const own = incomingEdge(scope, node.id, "in");
      if (own) {
        scope.vars.set(node.id, { name: outputRef(scope, own.source, own.sourceHandle), single: true });
        return;
      }
      const sender = scope.graph.nodes.find(
        (m) => m.id !== node.id && m.data.portalId && m.data.portalId === node.data.portalId && scope.vars.has(m.id),
      );
      if (!sender) throw new NodeError("Portal has no connected pair");
      scope.vars.set(node.id, { ...scope.vars.get(sender.id)!, single: true });
      return;
    }
  }

  // --- standard nodes -------------------------------------------------------
  switch (node.type) {
    case "geo/camera":
      declare(scope, node, "vec2(cameraNear, cameraFar)");
      return;
    case "geo/instanceCount":
      declare(scope, node, `int(${Math.round(Number(scope.shared.doc.settings.instanceCount) || 1)})`);
      return;
    case "advanced/varying": {
      const input = requireInput(scope, node, def.inputs[0], { node: true });
      declare(scope, node, `varying(${input})`);
      return;
    }
    case "advanced/var": {
      const input = requireInput(scope, node, def.inputs[0], { node: true });
      declare(scope, node, `${asNode(input)}.toVar()`, { single: true });
      return;
    }
    case "logic/discard": {
      const cond = inputExpr(scope, node, def.inputs[0]) ?? "bool(false)";
      if (scope.inFn) emit(scope, `Discard(${cond});`);
      else scope.discards.push(cond);
      return;
    }
    case "texture/sampleNode": {
      const tex = requireInput(scope, node, def.inputs[0]);
      const uvIn = inputExpr(scope, node, def.inputs[1]);
      declare(scope, node, uvIn ? `${tex}.sample(${uvIn})` : tex);
      return;
    }
  }

  const tsl = def.tsl;
  if (!tsl || tsl.startsWith("__")) throw new NodeError(`No code generator for "${def.type}"`);
  if (def.importFrom === "@/lib/tsl-utils") scope.shared.utilsUsed.add(tsl);
  else if (def.importFrom && def.importFrom !== "three/webgpu") {
    scope.addonImports.push({ name: tsl, from: def.importFrom });
  }

  if (def.pure && !def.callable) {
    declare(scope, node, tsl);
    return;
  }
  if (def.callable) {
    const args = def.inputs.map((p) => {
      const v = node.data.values[p.key] ?? p.default;
      return typeof v === "number" ? num(v) : literal(v, String(p.type));
    });
    declare(scope, node, `${tsl}(${args.join(", ")})`);
    return;
  }
  if (def.importFrom === "tsl-textures") {
    const entries = def.inputs
      .map((p) => [p.key, inputExpr(scope, node, p)] as const)
      .filter(([, e]) => e !== undefined)
      .map(([k, e]) => `${k}: ${e}`);
    declare(scope, node, `${tsl}({ ${entries.join(", ")} })`);
    return;
  }
  declare(scope, node, `${tsl}(${positionalArgs(scope, node, def.inputs, def).join(", ")})`);
}

// ---------------------------------------------------------------------------
// loops
// ---------------------------------------------------------------------------

function compileLoop(scope: Scope, loop: GraphNode) {
  const children = scope.graph.nodes.filter((n) => n.parentId === loop.id);
  const part = (t: string) => children.find((c) => c.type === t);
  const count = part("loop/count");
  const count2 = part("loop/count2");
  const start = part("loop/start");
  const end = part("loop/end");
  const acc = part("loop/accumulator");
  const out = part("loop/output");
  const cond = part("loop/condition");

  const partValue = (n: GraphNode | undefined, key: string, type: string, fallback: string): string => {
    if (!n) return fallback;
    const def = getNodeDef(n.type)!;
    const port = def.inputs.find((i) => i.key === key)!;
    return inputExpr(scope, n, port) ?? literal(n.data.values[key] ?? port.default, type);
  };

  let header: string;
  let params = "{ i }";
  if (count && count2) {
    header = `Loop(${partValue(count, "count", "int", "1")}, ${partValue(count2, "count", "int", "1")}, `;
    params = "{ i, j }";
  } else if (count) {
    header = `Loop(${partValue(count, "count", "int", "1")}, `;
  } else if (start || end) {
    const s = partValue(start, "start", "float", "float(0)");
    const e = partValue(end, "end", "float", "float(1)");
    header = `Loop({ start: ${s}, end: ${e}, type: 'float', condition: '<' }, `;
  } else {
    header = "Loop(1, ";
  }

  const loopName = freshName(scope, `_loop${scope.counter.n}`);
  const accName = acc ? freshName(scope, `_acc${scope.counter.n}`) : undefined;
  emit(scope, `const ${loopName} = Fn(() => {`);
  const inner = newScope(scope.shared, scope.graphKind, scope.graph, scope.globals, scope);
  inner.indent = scope.indent + "  ";
  inner.inFn = true;
  if (acc && accName) {
    const seedPort = getNodeDef(acc.type)!.inputs[0];
    const seed = inputExpr(scope, acc, seedPort) ?? "0";
    emit(inner, `const ${accName} = ${asNode(seed)}.toVar();`);
    inner.vars.set(acc.id, { name: accName, single: true });
  }
  emit(inner, `${header}(${params}) => {`);
  const body = newScope(scope.shared, scope.graphKind, scope.graph, scope.globals, inner);
  body.indent = inner.indent + "  ";
  body.lines = inner.lines;
  for (const idx of children.filter((c) => c.type === "loop/index")) body.vars.set(idx.id, { name: "i", single: true });
  for (const idx of children.filter((c) => c.type === "loop/index2"))
    body.vars.set(idx.id, { name: "j", single: true });
  for (const p of [count, count2, start, end].filter(Boolean) as GraphNode[]) {
    const def = getNodeDef(p.type)!;
    body.vars.set(p.id, { name: partValue(p, def.inputs[0].key, String(def.inputs[0].type), "0"), single: true });
  }
  const structural = new Set(["loop/index", "loop/index2", "loop/count", "loop/count2", "loop/start", "loop/end"]);
  const regular = children.filter(
    (c) => !structural.has(c.type) && c.type !== "loop/accumulator" && c.type !== "loop/output" && c.type !== "loop/condition",
  );
  compileNodes(body, regular, loop.id);
  if (cond) {
    const c = inputExpr(body, cond, getNodeDef(cond.type)!.inputs[0]) ?? "bool(true)";
    emit(body, `If(${c}.not(), () => {\n  Break();\n});`);
  }
  if (out && accName) {
    const next = incomingEdge(scope, out.id, "next");
    if (next) emit(body, `${accName}.assign(${outputRef(body, next.source, next.sourceHandle)});`);
  }
  emit(inner, "});");
  emit(inner, `return ${accName ?? "float(0)"};`);
  scope.lines.push(...inner.lines);
  emit(scope, "})();");
  if (out) {
    scope.vars.set(out.id, { name: loopName, single: true });
    if (scope.indent === "") scope.nodesOut[out.id] = loopName;
  }
  if (acc && !out) throw new NodeError("Loop has an Accumulator but no Output");
}

// ---------------------------------------------------------------------------
// code nodes & subgraphs
// ---------------------------------------------------------------------------

function indentBlock(src: string, pad: string): string {
  return src
    .split("\n")
    .map((l) => (l.trim() ? pad + l : l))
    .join("\n");
}

function compileCodeNode(scope: Scope, node: GraphNode) {
  const code = node.data.code;
  if (!code) throw new NodeError("Code node has no source");
  const ins = code.inputs.map((i) => ({
    key: sanitizeIdent(i.key),
    expr: inputExpr(scope, node, { key: i.key, label: i.key, type: i.type }) ?? "undefined",
  }));
  const single = code.outputs.length <= 1;
  if (code.language === "wgsl") {
    const fnName = freshName(scope, `_wgsl${scope.counter.n}`);
    emit(scope, `const ${fnName} = wgslFn(\`\n${code.source.replace(/`/g, "\\`")}\n\`);`);
    declare(scope, node, `${fnName}({ ${ins.map((i) => `${i.key}: ${i.expr}`).join(", ")} })`, { single });
    return;
  }
  const params = ins.map((i) => i.key).join(", ");
  const args = ins.map((i) => i.expr).join(", ");
  // A syntax error would break the whole generated module, so reject it here
  // and keep the rest of the graph compiling.
  try {
    new Function(...ins.map((i) => i.key), code.source);
  } catch (err) {
    throw new NodeError(`Syntax error in code: ${err instanceof Error ? err.message : String(err)}`);
  }
  declare(scope, node, `((${params}) => {\n${indentBlock(code.source, "  ")}\n})(${args})`, { single });
}

function subgraphFnName(sg: SubgraphDef): string {
  return `sg_${sanitizeIdent(sg.name)}_${sg.id.slice(-4)}`;
}

function compileSubgraphDef(scope: Scope, sg: SubgraphDef) {
  const fnName = subgraphFnName(sg);
  if (scope.names.has(fnName)) return fnName;
  if (scope.compilingSubgraphs.has(sg.id)) throw new NodeError(`Subgraph "${sg.name}" is recursive`);
  scope.compilingSubgraphs.add(sg.id);
  scope.names.add(fnName);

  const params: Record<string, string> = {};
  for (const i of sg.inputs) params[i.key] = sanitizeIdent(i.key);
  const inner: Scope = {
    ...newScope(scope.shared, scope.graphKind, sg.graph, scope.globals),
    names: new Set([...Object.values(params), ...scope.names]),
    counter: { n: 0 },
    indent: "  ",
    params,
    compilingSubgraphs: scope.compilingSubgraphs,
    subgraphLines: scope.subgraphLines,
    addonImports: scope.addonImports,
    nodesOut: {},
    uniformsOut: {},
  };
  compileNodes(inner, sg.graph.nodes);
  const outNode = sg.graph.nodes.find((n) => n.type === "subgraph/output");
  const returns = sg.outputs.map((o) => {
    const e = outNode ? sg.graph.edges.find((x) => x.target === outNode.id && x.targetHandle === o.key) : undefined;
    return { key: o.key, expr: e ? outputRef(inner, e.source, e.sourceHandle) : "float(0)" };
  });
  const ret =
    returns.length === 1
      ? returns[0].expr
      : `{ ${returns.map((r) => `${sanitizeIdent(r.key)}: ${r.expr}`).join(", ")} }`;
  const block = [
    `// Subgraph: ${sg.name}`,
    `const ${fnName} = (${Object.values(params).join(", ")}) => {`,
    ...inner.lines,
    `  return ${ret};`,
    "};",
  ].join("\n");
  scope.subgraphLines.push(block);
  scope.compilingSubgraphs.delete(sg.id);
  return fnName;
}

function compileSubgraphInstance(scope: Scope, node: GraphNode) {
  const sg = findSubgraph(scope.shared.doc, node.data.subgraphId);
  if (!sg) throw new NodeError("Subgraph definition not found");
  const fnName = compileSubgraphDef(scope, sg);
  const args = sg.inputs.map(
    (i) =>
      inputExpr(scope, node, { key: i.key, label: i.label, type: i.type, default: i.default }) ??
      (i.default !== undefined ? literal(i.default, i.type) : "undefined"),
  );
  declare(scope, node, `${fnName}(${args.join(", ")})`, { single: sg.outputs.length <= 1 });
}

// ---------------------------------------------------------------------------
// material / post graph drivers
// ---------------------------------------------------------------------------

const SIDE = ["FrontSide", "BackSide", "DoubleSide"];
const BLENDING = [
  "NoBlending",
  "NormalBlending",
  "AdditiveBlending",
  "SubtractiveBlending",
  "MultiplyBlending",
  "CustomBlending",
];

interface DriverResult {
  lines: string[];
  nodes: Record<string, string>;
  uniforms: Record<string, string>;
  ok: boolean;
  subgraphLines: string[];
  addonImports: { name: string; from: string }[];
}

function compileMaterialGraph(shared: Shared, globals: Record<string, string>): DriverResult {
  const graph = shared.doc.graphs.material;
  const scope = newScope(shared, "material", graph, globals);
  compileNodes(scope, graph.nodes);

  const materials = graph.nodes.filter((n) => getNodeDef(n.type)?.kind === "material");
  let ok = false;
  if (materials.length === 0) {
    shared.diagnostics.push({ level: "error", message: "material is not defined", graph: "material" });
  } else {
    if (materials.length > 1) {
      for (const m of materials.slice(1))
        shared.diagnostics.push({
          level: "warning",
          message: "Only the first material node is used",
          nodeId: m.id,
          graph: "material",
        });
    }
    const m = materials[0];
    const def = getNodeDef(m.type)!;
    try {
      emit(scope, "");
      emit(scope, "// Material");
      emit(scope, `const material = new ${def.tsl}();`);
      const active = new Set(m.data.activeInputs ?? def.defaultActiveInputs ?? []);
      const fragmentKey = ["outputNode", "fragmentNode", "colorNode"].find(
        (k) => active.has(k) && (incomingEdge(scope, m.id, k) || def.inputs.find((i) => i.key === k && !i.connectionOnly)),
      );
      for (const input of def.inputs) {
        if (input.isMaterialProp) {
          const v = m.data.values[input.key] ?? input.default;
          if (v === input.default) continue;
          if (input.key === "side") emit(scope, `material.side = ${SIDE[Number(v)] ?? "FrontSide"};`);
          else if (input.key === "blending") emit(scope, `material.blending = ${BLENDING[Number(v)] ?? "NormalBlending"};`);
          else emit(scope, `material.${input.key} = ${typeof v === "string" ? JSON.stringify(v) : String(v)};`);
          continue;
        }
        if (!active.has(input.key)) continue;
        let expr = inputExpr(scope, m, input, { node: true });
        if (expr === undefined) continue;
        if (input.key === fragmentKey && scope.discards.length) {
          expr = `Fn(() => {\n${scope.discards.map((d) => `  Discard(${d});`).join("\n")}\n  return ${expr};\n})()`;
        }
        emit(scope, `material.${input.key} = ${expr};`);
      }
      if (m.data.values.transparent === undefined && active.has("opacityNode") && incomingEdge(scope, m.id, "opacityNode")) {
        emit(scope, "material.transparent = true;");
      }
      ok = true;
    } catch (err) {
      if (!(err instanceof UpstreamError))
        shared.diagnostics.push({
          level: "error",
          message: `${def.label}: ${err instanceof Error ? err.message : String(err)}`,
          nodeId: m.id,
          graph: "material",
        });
    }
  }
  return {
    lines: scope.lines,
    nodes: scope.nodesOut,
    uniforms: scope.uniformsOut,
    ok,
    subgraphLines: scope.subgraphLines,
    addonImports: scope.addonImports,
  };
}

function compilePostGraph(
  shared: Shared,
  globals: Record<string, string>,
): DriverResult & { connected: boolean; outputExpr: string; toneMapping: Record<string, unknown> } {
  const graph = shared.doc.graphs.post;
  const scope = newScope(shared, "post", graph, globals);
  const outNode = graph.nodes.find((n) => n.type === "post/output");
  const toneMapping = {
    toneMapping: outNode?.data.values.toneMapping ?? "NoToneMapping",
    exposure: outNode?.data.values.exposure ?? 1,
    outputColorSpace: outNode?.data.values.outputColorSpace ?? "SRGBColorSpace",
  };
  const edge = outNode ? graph.edges.find((e) => e.target === outNode.id && e.targetHandle === "color") : undefined;
  if (!edge) {
    shared.diagnostics.push({ level: "warning", message: "Post: Post output is not connected.", graph: "post" });
    return {
      lines: [],
      nodes: {},
      uniforms: {},
      ok: true,
      subgraphLines: [],
      addonImports: [],
      connected: false,
      outputExpr: "scenePassColor",
      toneMapping,
    };
  }
  emit(scope, "const scenePass = pass(scene, camera);");
  emit(scope, "scenePass.setMRT(mrt({ output, normal: normalView }));");
  emit(scope, "const scenePassColor = scenePass.getTextureNode('output');");
  emit(scope, "const scenePassDepth = scenePass.getLinearDepthNode();");
  emit(scope, "const scenePassDepthTexture = scenePass.getTextureNode('depth');");
  emit(scope, "const scenePassNormalTexture = scenePass.getTextureNode('normal');");
  emit(scope, "const scenePassNormal = scenePassNormalTexture.xyz;");
  emit(scope, "");
  compileNodes(scope, graph.nodes);
  let outputExpr = "scenePassColor";
  let ok = true;
  try {
    outputExpr = outputRef(scope, edge.source, edge.sourceHandle);
  } catch (err) {
    ok = false;
    if (!(err instanceof UpstreamError))
      shared.diagnostics.push({
        level: "error",
        message: `Post Output: ${err instanceof Error ? err.message : String(err)}`,
        nodeId: outNode?.id,
        graph: "post",
      });
  }
  return {
    lines: scope.lines,
    nodes: scope.nodesOut,
    uniforms: scope.uniformsOut,
    ok,
    subgraphLines: scope.subgraphLines,
    addonImports: scope.addonImports,
    connected: true,
    outputExpr,
    toneMapping,
  };
}

// ---------------------------------------------------------------------------
// imports
// ---------------------------------------------------------------------------

const TSL_NAMES = new Set(exportsList.tsl);
const WEBGPU_NAMES = new Set([
  "MeshStandardNodeMaterial",
  "MeshBasicNodeMaterial",
  "MeshPhysicalNodeMaterial",
  "MeshPhongNodeMaterial",
  "SpriteNodeMaterial",
  "NodeMaterial",
  "RenderPipeline",
  "Color",
  "Vector2",
  "Vector3",
  "Vector4",
  "TextureLoader",
  "SRGBColorSpace",
  "NoColorSpace",
  "LinearSRGBColorSpace",
  "RepeatWrapping",
  "ClampToEdgeWrapping",
  "MirroredRepeatWrapping",
  "NearestFilter",
  "NearestMipmapNearestFilter",
  "NearestMipmapLinearFilter",
  "LinearFilter",
  "LinearMipmapNearestFilter",
  "LinearMipmapLinearFilter",
  ...SIDE,
  ...BLENDING,
]);

function identifiers(code: string): Set<string> {
  const stripped = code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  const out = new Set<string>();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) out.add(m[2]);
  return out;
}

function declaredNames(code: string): Set<string> {
  const out = new Set<string>();
  const re = /\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.add(m[1]);
  return out;
}

function buildImports(code: string, addons: { name: string; from: string }[]): string[] {
  const used = identifiers(code);
  const declared = declaredNames(code);
  const byModule = new Map<string, Set<string>>();
  const add = (mod: string, name: string) => {
    if (!byModule.has(mod)) byModule.set(mod, new Set());
    byModule.get(mod)!.add(name);
  };
  const addonNames = new Map(addons.map((a) => [a.name, a.from]));
  for (const id of used) {
    if (declared.has(id)) continue;
    if (addonNames.has(id)) add(addonNames.get(id)!, id);
    else if (TSL_NAMES.has(id)) add("three/tsl", id);
    else if (WEBGPU_NAMES.has(id)) add("three/webgpu", id);
  }
  const order = ["three/webgpu", "three/tsl"];
  const mods = [...byModule.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return mods.map((m) => `import { ${[...byModule.get(m)!].sort().join(", ")} } from '${m}';`);
}

/** Every identifier generated code may reference at runtime (besides TSL). */
export const RUNTIME_EXTRA_NAMES = [...WEBGPU_NAMES];
