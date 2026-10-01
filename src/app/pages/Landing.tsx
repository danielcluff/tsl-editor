import { For, Show, createSignal } from "solid-js";
import { ArrowRight, ChevronDown, Maximize2, Minimize2, Moon, Sun } from "lucide-static";
import { A } from "../lib/router";
import { theme, toggleTheme } from "../lib/theme";
import { Button, Icon } from "tsl-graph/ui";
import { Logo } from "./shared";

const FEATURES: [string, string][] = [
  ["Visual Node Editor", "Drag-and-drop interface for building Three.js TSL shaders without writing GLSL."],
  ["TSL Code Export", "One-click export of the entire graph as clean, standard Three.js JavaScript code."],
  ["Real-time Preview", "See shader updates live on a 3D model with a fast feedback loop."],
  ["Rich Node Library", "Over 300 built-in nodes covering math, textures, and geometry, with more being added."],
  ["Code Nodes", "Write raw TSL or WGSL code snippets directly inside the graph for ultimate flexibility."],
  ["Subgraph Nodes", "Group complex chunks of node logic into a single, clean reusable block to keep graphs organized."],
  ["Post-Processing & MRT", "Prototype complete VFX pipelines using full-screen quads and multiple render targets."],
  ["Local Variables", "Define and reuse variables with proper scoping for cleaner, powerful graph logic."],
  ["Smart UX & Routing", "Intelligent edge connections, full undo/redo stack, and rapid node search palette."],
  ["Debug & Inspect", "Debug individual nodes to see their values in real-time."],
  ["Organization Tools", "Add floating comments, utilize pan/zoom controls, and organize large graphs effortlessly."],
  ["Agent Ready (MCP)", "Connect Claude or any MCP client and let an agent build and debug graphs in your open editor."],
];

const FAQ: [string, string][] = [
  [
    "What is TSL?",
    "TSL (Three.js Shading Language) is the node-based shading language of Three.js. You compose shaders from JavaScript functions and Three.js compiles them to WGSL for WebGPU or GLSL for WebGL.",
  ],
  ["Is it free to use?", "Yes. It runs locally on your machine and is completely free."],
  [
    "Can I use the exported code anywhere?",
    "Yes. The export is plain Three.js code importing from three/webgpu and three/tsl, so it drops into any Three.js WebGPU project.",
  ],
  [
    "Do I need an account?",
    "No. Continue as a guest — projects are stored as JSON files on the machine running the editor.",
  ],
];

export function Landing() {
  const [open, setOpen] = createSignal<number | null>(null);
  const [full, setFull] = createSignal(false);
  return (
    <div class="min-h-screen bg-background text-foreground">
      <header class="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <A href="/">
            <Logo size="md" />
          </A>
          <div class="flex items-center gap-3">
            <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={toggleTheme}>
              <Icon svg={theme() === "dark" ? Sun : Moon} class="size-4" />
            </Button>
            <A href="/dashboard">
              <Button variant="outline" size="sm" class="font-mono text-xs dark:bg-white dark:text-black dark:hover:bg-white/90">
                Launch Editor <Icon svg={ArrowRight} class="size-3.5" />
              </Button>
            </A>
          </div>
        </div>
      </header>

      <main>
        <section class="flex flex-col items-center px-6 pt-24 pb-14 text-center">
          <h1 class="text-7xl font-black leading-none tracking-tight sm:text-8xl">TSL</h1>
          <div class="mt-3 text-2xl font-bold tracking-[0.6em] text-muted-foreground sm:text-3xl">GRAPH</div>
          <p class="mt-10 text-muted-foreground">Node-based editor for Three.js shaders</p>
        </section>

        <section class="mx-auto max-w-6xl px-6">
          <div
            class={[
              "relative overflow-hidden rounded-xl border bg-card shadow-2xl",
              full() ? "fixed inset-2 z-50 max-w-none" : "h-[640px]",
            ]}
          >
            <iframe src="/editor/demo?embed=1" title="TSL Graph editor demo" class="h-full w-full" />
            <button
              type="button"
              aria-label={full() ? "Exit fullscreen" : "Enter fullscreen"}
              class="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-md border bg-card/80 text-muted-foreground hover:text-foreground"
              onClick={() => setFull(!full())}
            >
              <Icon svg={full() ? Minimize2 : Maximize2} class="size-3.5" />
            </button>
          </div>
        </section>

        <section class="mx-auto mt-24 max-w-4xl border-t px-6 pt-16">
          <h2 class="text-3xl font-semibold">Features</h2>
          <ul class="mt-8 space-y-5">
            <For each={FEATURES}>
              {([title, text]) => (
                <li class="flex gap-3 text-sm">
                  <span class="font-mono text-muted-foreground">[*]</span>
                  <span>
                    <span class="font-semibold">{title}</span> <span class="text-muted-foreground">{text}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>

        <section class="mx-auto mt-20 max-w-2xl border-t px-6 pt-16 pb-24">
          <h2 class="text-center text-2xl font-semibold">Frequently Asked Questions</h2>
          <div class="mt-8">
            <For each={FAQ}>
              {([q, a], i) => (
                <div class="border-b">
                  <button
                    type="button"
                    class="flex w-full items-center justify-between py-4 text-left text-sm font-medium hover:underline"
                    onClick={() => setOpen(open() === i() ? null : i())}
                  >
                    {q}
                    <Icon
                      svg={ChevronDown}
                      class={["size-4 text-muted-foreground transition-transform", { "rotate-180": open() === i() }]}
                    />
                  </button>
                  <Show when={open() === i()}>
                    <p class="pb-4 text-sm text-muted-foreground">{a}</p>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </section>
      </main>

      <footer class="border-t py-8 text-center text-xs text-muted-foreground">
        <div>
          Built with Solid 2.0 · inspired by{" "}
          <a class="font-semibold text-foreground" href="https://www.tsl-graph.xyz" target="_blank" rel="noreferrer">
            TSL Graph
          </a>{" "}
          by Bhushan Wagh
        </div>
        <div class="mt-2">© {new Date().getFullYear()} TSL Graph Editor.</div>
      </footer>
    </div>
  );
}
