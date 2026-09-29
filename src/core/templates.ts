import { executeCommand, type Command } from "./commands";
import { createProject } from "./graph";
import type { ProjectDoc } from "./types";

export interface Template {
  id: string;
  name: string;
  description: string;
  build: (doc: ProjectDoc) => void;
}

function run(doc: ProjectDoc, ops: Command[]) {
  executeCommand(doc, { op: "batch", ops });
}

const materialId = (doc: ProjectDoc) => doc.graphs.material.nodes.find((n) => n.type.startsWith("material/"))!.id;

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank",
    description: "A MeshStandardMaterial and a pass-through post graph.",
    build: () => {},
  },
  {
    id: "gradient",
    name: "Gradient Sphere",
    description: "Normal-driven linear gradient into the material colour.",
    build: (doc) => {
      const mat = materialId(doc);
      run(doc, [
        { op: "addNode", type: "geo/normalLocal", ref: "n", position: { x: -40, y: 180 } },
        { op: "addNode", type: "utils/linearGradient", ref: "g", position: { x: 180, y: 200 } },
        { op: "connect", source: "$n", sourceHandle: "y", target: "$g", targetHandle: "t" },
        { op: "connect", source: "$g", sourceHandle: "out", target: mat, targetHandle: "colorNode" },
      ]);
    },
  },
  {
    id: "noise-displace",
    name: "Noise Displacement",
    description: "Animated fractal noise pushes vertices along their normals.",
    build: (doc) => {
      const mat = materialId(doc);
      run(doc, [
        { op: "updateSettings", settings: { geometry: "icosahedron", geometryParams: { radius: 1.1, detail: 64 } } },
        { op: "addNode", type: "geo/positionLocal", ref: "p" },
        { op: "addNode", type: "geo/time", ref: "t" },
        { op: "addNode", type: "math/mul", ref: "ts", values: { b: 0.4 } },
        { op: "addNode", type: "math/add", ref: "pt" },
        { op: "addNode", type: "noise/fractal_noise_float", ref: "noise", values: { octaves: 4 } },
        { op: "addNode", type: "geo/normalLocal", ref: "n" },
        { op: "addNode", type: "math/mul", ref: "amp", values: { b: 0.35 } },
        { op: "addNode", type: "math/mul", ref: "off" },
        { op: "addNode", type: "math/add", ref: "pos" },
        { op: "addNode", type: "math/mix", ref: "col", values: { a: "#1e3a8a", b: "#f472b6" } },
        { op: "addNode", type: "math/saturate", ref: "sat" },
        { op: "connect", source: "$t", target: "$ts", targetHandle: "a" },
        { op: "connect", source: "$p", target: "$pt", targetHandle: "a" },
        { op: "connect", source: "$ts", target: "$pt", targetHandle: "b" },
        { op: "connect", source: "$pt", target: "$noise", targetHandle: "position" },
        { op: "connect", source: "$noise", target: "$amp", targetHandle: "a" },
        { op: "connect", source: "$n", target: "$off", targetHandle: "a" },
        { op: "connect", source: "$amp", target: "$off", targetHandle: "b" },
        { op: "connect", source: "$p", target: "$pos", targetHandle: "a" },
        { op: "connect", source: "$off", target: "$pos", targetHandle: "b" },
        { op: "connect", source: "$pos", target: mat, targetHandle: "positionNode" },
        { op: "connect", source: "$noise", target: "$sat", targetHandle: "x" },
        { op: "connect", source: "$sat", target: "$col", targetHandle: "t" },
        { op: "connect", source: "$col", target: mat, targetHandle: "colorNode" },
        { op: "autoLayout", graph: "material" },
      ]);
    },
  },
  {
    id: "fresnel",
    name: "Fresnel Glow",
    description: "Rim light using the fresnel utility driving emissive.",
    build: (doc) => {
      const mat = materialId(doc);
      run(doc, [
        { op: "updateNode", nodeId: mat, activeInputs: ["colorNode", "emissiveNode", "roughnessNode", "positionNode"], values: { colorNode: "#0b1020", roughnessNode: 0.3 } },
        { op: "addNode", type: "utils/fresnel", ref: "f", values: { power: 3 } },
        { op: "addNode", type: "const/color", ref: "c", values: { value: "#38bdf8" } },
        { op: "addNode", type: "math/mul", ref: "m" },
        { op: "connect", source: "$f", target: "$m", targetHandle: "a" },
        { op: "connect", source: "$c", target: "$m", targetHandle: "b" },
        { op: "connect", source: "$m", target: mat, targetHandle: "emissiveNode" },
        { op: "autoLayout", graph: "material" },
      ]);
    },
  },
  {
    id: "marble",
    name: "Marble",
    description: "Procedural marble from the TSL Textures library.",
    build: (doc) => {
      const mat = materialId(doc);
      run(doc, [
        { op: "addNode", type: "tslTextures/marble", ref: "m" },
        { op: "connect", source: "$m", target: mat, targetHandle: "colorNode" },
        { op: "autoLayout", graph: "material" },
      ]);
    },
  },
  {
    id: "bloom",
    name: "Bloom Post",
    description: "Emissive sphere with bloom and chromatic aberration in the post graph.",
    build: (doc) => {
      const mat = materialId(doc);
      const post = doc.graphs.post;
      const input = post.nodes.find((n) => n.type === "post/input")!.id;
      const output = post.nodes.find((n) => n.type === "post/output")!.id;
      run(doc, [
        { op: "updateNode", nodeId: mat, activeInputs: ["colorNode", "emissiveNode", "positionNode"], values: { colorNode: "#111111", emissiveNode: "#ff5a1f" } },
        { op: "addNode", graph: "post", type: "postfx/bloom", ref: "b", values: { strength: 1.2, radius: 0.4 }, position: { x: 260, y: 60 } },
        { op: "addNode", graph: "post", type: "math/add", ref: "sum", position: { x: 520, y: 160 } },
        { op: "connect", graph: "post", source: input, sourceHandle: "color", target: "$b", targetHandle: "input" },
        { op: "connect", graph: "post", source: input, sourceHandle: "color", target: "$sum", targetHandle: "a" },
        { op: "connect", graph: "post", source: "$b", target: "$sum", targetHandle: "b" },
        { op: "connect", graph: "post", source: "$sum", target: output, targetHandle: "color" },
        { op: "updateNode", graph: "post", nodeId: output, position: { x: 760, y: 180 } },
      ]);
    },
  },
];

export function projectFromTemplate(templateId: string, name?: string): ProjectDoc {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const doc = createProject(name ?? (t.id === "blank" ? "Untitled" : t.name));
  t.build(doc);
  return doc;
}
