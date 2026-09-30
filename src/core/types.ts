// Shared document + node-definition types. Used by the browser editor and the
// MCP server, so nothing in src/core may import DOM or Solid APIs.

export type DataType =
  | "float"
  | "int"
  | "uint"
  | "bool"
  | "vec2"
  | "vec3"
  | "vec4"
  | "ivec2"
  | "ivec3"
  | "ivec4"
  | "uvec2"
  | "uvec3"
  | "uvec4"
  | "bvec2"
  | "bvec3"
  | "bvec4"
  | "mat3"
  | "mat4"
  | "color"
  | "texture"
  | "string"
  | "any";

export interface PortOption {
  label: string;
  value: string | number;
}

export interface PortDef {
  key: string;
  label: string;
  type: DataType | string;
  default?: unknown;
  /** Only accepts a connection; no inline value editor. */
  connectionOnly?: boolean;
  /** Only editable in the properties panel; never gets a handle. */
  propertyOnly?: boolean;
  hidden?: boolean;
  /** Material nodes: assigned as `material.key = value` rather than a node. */
  isMaterialProp?: boolean;
  options?: PortOption[];
  min?: number;
  max?: number;
  step?: number;
}

export type NodeKind =
  | "standard"
  | "const"
  | "uniform"
  | "material"
  | "comment"
  | "group"
  | "code"
  | "subgraph"
  | "subgraphInput"
  | "subgraphOutput"
  | "globalRef"
  | "localSet"
  | "localGet"
  | "split"
  | "multiOp"
  | "assign"
  | "loop"
  | "loopPart"
  | "postInput"
  | "postOutput"
  | "postScene"
  | "textureSample"
  | "gradient"
  | "portal"
  /** Stand-in for an imported node type this editor does not support. */
  | "placeholder";

export interface NodeDef {
  type: string;
  label: string;
  category: string;
  description?: string;
  /** TSL function / identifier this node maps to. */
  tsl?: string;
  importFrom?: string;
  /** Pure identifier (not called), e.g. `positionLocal`. */
  pure?: boolean;
  /** Pure but callable with property inputs, e.g. `uv(1)`. */
  callable?: boolean;
  inputs: PortDef[];
  outputs: PortDef[];
  defaultActiveInputs?: string[];
  kind?: NodeKind;
  /** Graph this node is allowed in. Defaults to both. */
  graphs?: GraphKind[];
  keywords?: string[];
}

export type GraphKind = "material" | "post";
/** A graph address: a top-level graph or a subgraph body (`sg:<subgraphId>`). */
export type GraphRef = GraphKind | `sg:${string}`;

export interface XY {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  type: string;
  position: XY;
  /** Optional explicit size for comments / groups / loops. */
  width?: number;
  height?: number;
  /** Id of the group or loop container this node lives in. */
  parentId?: string;
  data: NodeData;
}

export interface NodeData {
  /** Values for inputs that are not connected (and property-only inputs). */
  values: Record<string, unknown>;
  /** Material nodes: inputs shown on node & compiled. */
  activeInputs?: string[];
  /** User supplied title override. */
  label?: string;
  /** Variable name hint for codegen (Var / Set Local / Multi-op / uniform). */
  localName?: string;
  /** Comment text (markdown) or code node source. */
  text?: string;
  color?: string;
  /** Code nodes. */
  code?: CodeNodeData;
  /** Subgraph instance: id of the SubgraphDef in project.customNodes. */
  subgraphId?: string;
  /** Global ref: id of the GlobalDef. */
  globalId?: string;
  /** Local get: id of the Set Local node. */
  localSourceId?: string;
  /** Multi-op expression tree. */
  operations?: MultiOpOperation[];
  /** Per-node preview override; unset follows `settings.nodePreviews`. */
  debug?: boolean;
  collapsed?: boolean;
  /** Portal pair id. */
  portalId?: string;
  /** Linear gradient stops. */
  stops?: GradientStop[];
  /** Subgraph input/output anchor ports. */
  ports?: { key: string; label: string; type: string }[];
  /** Placeholder nodes: what was imported, shown read-only. */
  placeholder?: PlaceholderInfo;
}

export interface PlaceholderInfo {
  originalType: string;
  originalId: string;
  reason: string;
  /** Input/output handle names the imported edges used, so connections stay visible. */
  inputs: string[];
  outputs: string[];
  /** Everything known about the node, pretty-printed. */
  meta: string;
}

export interface GradientStop {
  pos: number;
  color: string;
}

/** One step of a multi-op: `op` is the TSL function name (see core/multiop.ts). */
export interface MultiOpOperation {
  id: string;
  op: string;
}

export interface CodeNodeData {
  language: "tsl" | "wgsl";
  source: string;
  inputs: { key: string; type: string }[];
  outputs: { key: string; type: string }[];
}

export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GlobalDef {
  id: string;
  name: string;
  /** uniform: a live-editable uniform; const: plain constant; varying: vertex→fragment. */
  kind: "uniform" | "const" | "varying";
  type: string;
  value: unknown;
  min?: number;
  max?: number;
}

export interface SubgraphDef {
  id: string;
  name: string;
  description?: string;
  graph: Graph;
  inputs: { key: string; label: string; type: string; default?: unknown }[];
  outputs: { key: string; label: string; type: string }[];
  scope: "project" | "library";
}

export type GeometryKind =
  | "sphere"
  | "box"
  | "torus"
  | "torusKnot"
  | "plane"
  | "cylinder"
  | "icosahedron"
  | "fullscreenQuad"
  /** @deprecated older docs; the script is now a modifier (`geometryScript`) on any geometry */
  | "script";

export interface PreviewSettings {
  geometry: GeometryKind;
  geometryParams: Record<string, number | boolean>;
  /** Runs on the built geometry with `geometry` and `THREE` in scope; may mutate it or return a new one. */
  geometryScript?: string;
  environment: string;
  envIntensity: number;
  showBackground: boolean;
  showGrid: boolean;
  enablePost: boolean;
  showBackdrop: boolean;
  instancing: boolean;
  instanceCount: number;
  thumbnail: "auto" | "manual";
  /** Directional light aimed at the object. */
  lightEnabled: boolean;
  lightIntensity: number;
  lightColor: string;
  /** Degrees around the Y axis, 0 = in front of the object (+Z). */
  lightAzimuth: number;
  /** Degrees above the horizon. */
  lightElevation: number;
  showLightHelper: boolean;
  /** Hemisphere (ambient) light. */
  ambientIntensity: number;
  /** Default for node preview thumbnails; a node's own `debug` flag overrides it. */
  nodePreviews: boolean;
}

export interface ProjectDoc {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  version: 1;
  thumbnail?: string;
  graphs: Record<GraphKind, Graph>;
  globals: GlobalDef[];
  customNodes: SubgraphDef[];
  settings: PreviewSettings;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  nodeCount: number;
}

export interface Diagnostic {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  graph?: GraphKind;
}
