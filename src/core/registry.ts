import catalog from "./catalog.json";
import type { GraphKind, NodeDef, NodeKind, PortDef } from "./types";

interface CatalogFile {
  categories: { name: string; nodes: NodeDef[] }[];
}

// ---------------------------------------------------------------------------
// Material nodes (not part of the public docs catalog)
// ---------------------------------------------------------------------------

const blending: PortDef = {
  key: "blending",
  label: "Blending",
  type: "int",
  default: 1,
  propertyOnly: true,
  isMaterialProp: true,
  options: [
    { label: "No", value: 0 },
    { label: "Normal", value: 1 },
    { label: "Additive", value: 2 },
    { label: "Subtractive", value: 3 },
    { label: "Multiply", value: 4 },
    { label: "Custom", value: 5 },
  ],
};
const side: PortDef = {
  key: "side",
  label: "Side",
  type: "int",
  default: 0,
  propertyOnly: true,
  isMaterialProp: true,
  options: [
    { label: "Front", value: 0 },
    { label: "Back", value: 1 },
    { label: "Double", value: 2 },
  ],
};
const transparent: PortDef = {
  key: "transparent",
  label: "Transparent",
  type: "bool",
  default: false,
  propertyOnly: true,
  isMaterialProp: true,
};
const depthWrite: PortDef = {
  key: "depthWrite",
  label: "Depth Write",
  type: "bool",
  default: true,
  propertyOnly: true,
  isMaterialProp: true,
};
const depthTest: PortDef = { ...depthWrite, key: "depthTest", label: "Depth Test" };
const wireframe: PortDef = {
  key: "wireframe",
  label: "Wireframe",
  type: "bool",
  default: false,
  propertyOnly: true,
  isMaterialProp: true,
};

const p = (key: string, label: string, type: string, extra: Partial<PortDef> = {}): PortDef => ({
  key,
  label,
  type,
  ...extra,
});
const conn = (key: string, label: string, type: string) => p(key, label, type, { connectionOnly: true });

const colorIn = p("colorNode", "Color", "color", { default: "#ffffff" });
const emissiveIn = p("emissiveNode", "Emissive", "color", { default: "#000000" });
const opacityIn = p("opacityNode", "Opacity", "float", { default: 1, min: 0, max: 1 });
const normalIn = conn("normalNode", "Normal", "vec3");
const positionIn = conn("positionNode", "Position", "vec3");
const outputIn = conn("outputNode", "Output", "vec4");
const backdropIn = conn("backdropNode", "Backdrop", "vec3");
const backdropAlphaIn = conn("backdropAlphaNode", "Backdrop Alpha", "float");
const roughnessIn = p("roughnessNode", "Roughness", "float", { default: 0.5, min: 0, max: 1 });
const metalnessIn = p("metalnessNode", "Metalness", "float", { default: 0, min: 0, max: 1 });
const aoIn = p("aoNode", "AO", "float", { default: 1, min: 0, max: 1 });
const alphaTest = p("alphaTest", "Alpha Test", "float", {
  default: 0,
  propertyOnly: true,
  isMaterialProp: true,
  min: 0,
  max: 1,
});
const common = [side, transparent, blending, depthWrite, wireframe, alphaTest];

const materialNodes: NodeDef[] = [
  {
    type: "material/basic",
    label: "MeshBasicMaterial",
    category: "Material",
    description: "Unlit material. Color is output as-is without lighting.",
    tsl: "MeshBasicNodeMaterial",
    importFrom: "three/webgpu",
    defaultActiveInputs: ["colorNode", "positionNode"],
    inputs: [colorIn, emissiveIn, opacityIn, positionIn, outputIn, backdropIn, backdropAlphaIn, ...common],
    outputs: [],
  },
  {
    type: "material/phong",
    label: "MeshPhongMaterial",
    category: "Material",
    description: "Blinn-Phong shaded material with specular highlights.",
    tsl: "MeshPhongNodeMaterial",
    importFrom: "three/webgpu",
    defaultActiveInputs: ["colorNode", "positionNode"],
    inputs: [
      colorIn,
      normalIn,
      p("specularNode", "Specular", "color", { default: "#111111" }),
      p("shininessNode", "Shininess", "float", { default: 30 }),
      emissiveIn,
      opacityIn,
      positionIn,
      outputIn,
      backdropIn,
      backdropAlphaIn,
      ...common,
    ],
    outputs: [],
  },
  {
    type: "material/physical",
    label: "MeshPhysicalMaterial",
    category: "Material",
    description: "Extended PBR material with clearcoat, sheen, iridescence and transmission.",
    tsl: "MeshPhysicalNodeMaterial",
    importFrom: "three/webgpu",
    defaultActiveInputs: ["colorNode", "positionNode"],
    inputs: [
      colorIn,
      normalIn,
      roughnessIn,
      metalnessIn,
      emissiveIn,
      p("clearcoatNode", "Clearcoat", "float", { default: 0, min: 0, max: 1 }),
      p("clearcoatRoughnessNode", "Clearcoat Roughness", "float", { default: 0, min: 0, max: 1 }),
      p("sheenNode", "Sheen", "color", { default: "#000000" }),
      p("sheenRoughnessNode", "Sheen Roughness", "float", { default: 1, min: 0, max: 1 }),
      p("iridescenceNode", "Iridescence", "float", { default: 0, min: 0, max: 1 }),
      p("transmissionNode", "Transmission", "float", { default: 0, min: 0, max: 1 }),
      p("thicknessNode", "Thickness", "float", { default: 0 }),
      p("iorNode", "IOR", "float", { default: 1.5, min: 1, max: 2.333 }),
      aoIn,
      opacityIn,
      positionIn,
      outputIn,
      backdropIn,
      backdropAlphaIn,
      ...common,
    ],
    outputs: [],
  },
  {
    type: "material/standard",
    label: "MeshStandardMaterial",
    category: "Material",
    description: "Physically based metallic-roughness material.",
    tsl: "MeshStandardNodeMaterial",
    importFrom: "three/webgpu",
    defaultActiveInputs: ["colorNode", "positionNode"],
    inputs: [
      colorIn,
      normalIn,
      roughnessIn,
      metalnessIn,
      emissiveIn,
      aoIn,
      opacityIn,
      positionIn,
      outputIn,
      backdropIn,
      backdropAlphaIn,
      ...common,
    ],
    outputs: [],
  },
  {
    type: "material/node",
    label: "NodeMaterial",
    category: "Material",
    description: "Raw node material: you provide the full fragment and vertex output.",
    tsl: "NodeMaterial",
    importFrom: "three/webgpu",
    defaultActiveInputs: ["fragmentNode", "vertexNode"],
    inputs: [conn("fragmentNode", "Fragment", "vec4"), conn("vertexNode", "Vertex", "vec3"), ...common],
    outputs: [],
  },
  {
    type: "material/sprite",
    label: "SpriteNodeMaterial",
    category: "Material",
    description: "Camera-facing sprite material; pair with instancing for particles.",
    tsl: "SpriteNodeMaterial",
    importFrom: "three/webgpu",
    defaultActiveInputs: ["colorNode", "positionNode"],
    inputs: [
      colorIn,
      opacityIn,
      positionIn,
      p("scaleNode", "Scale", "vec2", { connectionOnly: true }),
      p("rotationNode", "Rotation", "float", { default: 0 }),
      alphaTest,
      depthWrite,
      depthTest,
      blending,
      transparent,
    ],
    outputs: [],
  },
];

// ---------------------------------------------------------------------------
// Editor-only structural nodes
// ---------------------------------------------------------------------------

const structuralNodes: NodeDef[] = [
  {
    type: "code/tsl",
    label: "Code",
    category: "Code",
    description: "Write raw TSL (JavaScript) or WGSL inside the graph.",
    kind: "code",
    inputs: [],
    outputs: [],
  },
  {
    type: "subgraph/instance",
    label: "Subgraph",
    category: "Subgraph",
    description: "A reusable block of nodes.",
    kind: "subgraph",
    inputs: [],
    outputs: [],
  },
  {
    type: "subgraph/input",
    label: "Subgraph Input",
    category: "Subgraph",
    description: "Exposes values passed into the subgraph.",
    kind: "subgraphInput",
    inputs: [],
    outputs: [],
  },
  {
    type: "subgraph/output",
    label: "Subgraph Output",
    category: "Subgraph",
    description: "Values returned from the subgraph.",
    kind: "subgraphOutput",
    inputs: [],
    outputs: [],
  },
  {
    type: "utils/group",
    label: "Group",
    category: "Notes",
    description: "Frame that visually groups nodes.",
    kind: "group",
    inputs: [],
    outputs: [],
  },
  {
    type: "import/placeholder",
    label: "Unsupported Node",
    category: "Imported",
    description: "An imported node this editor doesn't support. It can't be edited or connected; delete it or replace it with a supported node.",
    kind: "placeholder",
    inputs: [],
    outputs: [],
  },
  {
    type: "utils/portal",
    label: "Portal",
    category: "Utils",
    description: "Wireless connection: the paired portal forwards its value.",
    kind: "portal",
    inputs: [p("in", "In", "any", { connectionOnly: true })],
    outputs: [p("out", "Out", "any")],
  },
];

const KIND_BY_TYPE: Record<string, NodeKind> = {
  "const/float": "const",
  "const/int": "const",
  "const/vec2": "const",
  "const/vec3": "const",
  "const/vec4": "const",
  "const/color": "const",
  "const/uniform": "uniform",
  "utils/comment": "comment",
  "global/ref": "globalRef",
  "local/set": "localSet",
  "local/get": "localGet",
  "math/split": "split",
  "math/multiOp": "multiOp",
  loop: "loop",
  "post/input": "postInput",
  "post/output": "postOutput",
  "post/sceneColor": "postScene",
  "post/sceneDepth": "postScene",
  "post/sceneNormal": "postScene",
  "texture/sample": "textureSample",
  "utils/linearGradient": "gradient",
};

const POST_ONLY = new Set(["Post", "Post FX"]);

/** Nodes whose original import no longer exists in the installed three.js. */
const IMPORT_OVERRIDES: Record<string, string> = {
  "postfx/anamorphic": "@/lib/tsl-utils",
};

function finalize(def: NodeDef): NodeDef {
  if (IMPORT_OVERRIDES[def.type]) def = { ...def, importFrom: IMPORT_OVERRIDES[def.type] };
  const kind =
    def.kind ??
    KIND_BY_TYPE[def.type] ??
    (def.type.startsWith("assign/")
      ? "assign"
      : def.type.startsWith("loop/")
        ? "loopPart"
        : def.type.startsWith("material/")
          ? "material"
          : "standard");
  let graphs: GraphKind[] | undefined = def.graphs;
  if (!graphs) {
    if (POST_ONLY.has(def.category)) graphs = ["post"];
    else if (def.category === "Material") graphs = ["material"];
  }
  return { ...def, kind, graphs, inputs: def.inputs ?? [], outputs: def.outputs ?? [] };
}

const allDefs: NodeDef[] = [
  ...(catalog as CatalogFile).categories.flatMap((c) => c.nodes),
  ...materialNodes,
  ...structuralNodes,
].map(finalize);

// The Post Input node exposes a few more outputs than the docs list mention.
export const registry = new Map<string, NodeDef>(allDefs.map((d) => [d.type, d]));

export function getNodeDef(type: string): NodeDef | undefined {
  return registry.get(type);
}

export function allNodeDefs(): NodeDef[] {
  return allDefs;
}

/** Sidebar order matches the original editor. */
export const CATEGORY_ORDER = [
  "Advanced",
  "Constants",
  "Easing",
  "Geometry",
  "Globals",
  "Locals",
  "Logic",
  "Material",
  "Math",
  "Model",
  "Noise",
  "Notes",
  "Post",
  "Post FX",
  "SDF",
  "Texture",
  "TSL Textures",
  "Utils",
];

/** Categories shown in the node library for a given graph tab. */
export function libraryCategories(graph: GraphKind): { name: string; nodes: NodeDef[] }[] {
  const hidden = new Set(["Loop", "Subgraph", "Code"]);
  return CATEGORY_ORDER.filter((c) => !hidden.has(c))
    .map((name) => ({
      name,
      nodes: allDefs
        .filter((d) => d.category === name && (!d.graphs || d.graphs.includes(graph)))
        .filter((d) => d.type !== "utils/group" && d.type !== "utils/portal")
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((c) => c.nodes.length > 0);
}

export const CATEGORY_HEADER: Record<string, string> = {
  Math: "cat-math",
  Constants: "cat-constants",
  Geometry: "cat-geometry",
  Material: "cat-material",
  Subgraph: "cat-subgraph",
  Post: "cat-post",
  "Post FX": "cat-post",
  Texture: "cat-texture",
  Model: "cat-model",
  Advanced: "cat-advanced",
  Noise: "cat-noise",
  Utils: "cat-utils",
  SDF: "cat-utils",
  Easing: "cat-utils",
  Logic: "cat-math",
  Loop: "cat-loop",
  Globals: "cat-globals",
  Locals: "cat-locals",
  "TSL Textures": "cat-tsltextures",
  Code: "cat-subgraph",
};

export const TYPE_COLORS: Record<string, string> = {
  float: "#8b5cf6",
  int: "#3b82f6",
  uint: "#06b6d4",
  bool: "#f97316",
  vec2: "#22c55e",
  vec3: "#14b8a6",
  vec4: "#84cc16",
  ivec2: "#3b82f6",
  ivec3: "#3b82f6",
  ivec4: "#3b82f6",
  uvec2: "#06b6d4",
  uvec3: "#06b6d4",
  uvec4: "#06b6d4",
  bvec2: "#f97316",
  bvec3: "#f97316",
  bvec4: "#f97316",
  mat3: "#ec4899",
  mat4: "#ec4899",
  color: "#f59e0b",
  texture: "#e11d48",
  sampler2D: "#a855f7",
  any: "#a1a1aa",
};
export const DEFAULT_HANDLE_COLOR = "#71717a";

export function typeColor(type: string | undefined): string {
  return (type && TYPE_COLORS[type]) || DEFAULT_HANDLE_COLOR;
}

/** Number of scalar components for a type (1 for scalars, 4 for unknown). */
export function componentCount(type: string): number {
  if (type === "float" || type === "int" || type === "uint" || type === "bool") return 1;
  if (type === "color") return 3;
  const m = /^[biu]?vec([2-4])$/.exec(type);
  return m ? Number(m[1]) : 4;
}

const SWIZZLE = ["x", "y", "z", "w"];
/** Split node: only show component outputs that exist on the incoming type. */
export function visibleSplitOutputs(keys: string[], inType: string): string[] {
  const n = componentCount(inType);
  return keys.filter((k) => {
    if (n === 1 && k === "out") return false;
    const i = SWIZZLE.indexOf(k);
    return i === -1 || i < n;
  });
}
