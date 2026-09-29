# TSL Graph (Solid 2 clone)

A node-based editor for [Three.js TSL](https://threejs.org/docs/#api/en/nodes/TSL) shaders — a close clone of
[tsl-graph.xyz](https://www.tsl-graph.xyz), rebuilt with **Solid 2.0** and an **MCP server** so agents can build and debug
shaders in your open editor.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:5173  (editor + API + MCP on one port)
```

`pnpm build && pnpm start` serves the production build. Projects are stored as JSON in `./data/projects`
(override with `TSL_DATA_DIR`).

## Features

- **Landing, sign-in (guest), dashboard, node docs** (`/docs/nodes`) with templates, search, rename/duplicate/import/export.
- **Editor**: 330+ nodes (math, noise, easing, SDF, TSL Textures, post FX…), typed/coloured ports, pan/zoom, box select,
  drag-to-connect with snapping, quick-add picker (double-click, or drop a wire on empty canvas), undo/redo, copy/paste,
  groups, comments (Markdown), find notes, auto layout, image export.
- **Material + Post graphs** compiled to standard TSL: live WebGPU preview (WebGL2 fallback), geometry/environment/
  instancing settings, snapshot, per-node debug thumbnails, runtime shader errors surfaced in the preview.
- **Code nodes** (TSL or WGSL), **subgraphs** (project or browser library), **loops**, **locals**, **globals**
  (uniform/const/varying, bulk import), **portals**, **multi-op** nodes, live-updating **uniforms**.
- **Export**: one-click, self-contained Three.js module (inline utils, correct imports).

Keyboard shortcuts match the original (Help → Keyboard Shortcuts).

## Agents (MCP)

The dev server exposes MCP over Streamable HTTP at `http://localhost:5173/mcp`. When a project is open in a browser tab,
tool calls act on the **live editor**: changes appear instantly, go through undo history, and the agent can read runtime
shader errors and screenshots. Without an open tab, tools edit the saved project file.

```bash
claude mcp add --transport http tsl-graph http://localhost:5173/mcp
```

This repo also ships a `.mcp.json`, so Claude Code picks it up automatically here. For stdio-only clients:
`pnpm mcp:stdio` (proxies to the running server; set `TSL_GRAPH_URL` if it's not on 5173).

Tools: `list_projects`, `create_project`, `open_project`, `rename_project`, `list_node_types`, `get_node_type`,
`get_graph`, `add_node`, `connect_nodes`, `disconnect`, `update_node`, `delete_nodes`, `apply_operations` (batched, with
`$ref` names), `auto_layout`, `clear_graph`, `add_global`, `update_preview_settings`, `compile_graph`, `validate_graph`,
`capture_preview`. Omit `projectId` to target the project currently open in the editor.

`scripts/mcp-smoke.ts` drives a full agent session against a running editor.

## Layout

```
src/core/      framework-free graph model, node registry, commands, TSL compiler, layout (shared with the server)
src/runtime/   TSL evaluation scope + WebGPU preview renderer
src/app/       Solid 2 UI (pages, editor, UI kit)
server/        HTTP server: Vite middleware, REST API, editor bridge (WebSocket), MCP endpoint
tests/         vitest (compiler, templates, commands)
```

The node catalog (`src/core/catalog.json`) mirrors the public node reference of the original site.
