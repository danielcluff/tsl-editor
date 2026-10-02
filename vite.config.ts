import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  // tsl-graph and its canvas (solid-graph) are workspace packages: one Solid for all
  resolve: { dedupe: ["solid-js", "@solidjs/web"] },
  build: { target: "esnext", chunkSizeWarningLimit: 4000 },
});
