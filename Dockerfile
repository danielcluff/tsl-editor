# syntax=docker/dockerfile:1
# Multi-stage build: install → build → runtime

# ── Install phase: install pnpm and dependencies ──
FROM node:24-alpine AS install

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy workspace manifests first (for layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tsl-graph/package.json packages/tsl-graph/
COPY packages/tsl-graph/packages/solid-graph/package.json packages/tsl-graph/packages/solid-graph/

# Install dependencies (this layer is cached unless manifests change)
RUN pnpm install --frozen-lockfile

# ── Build phase: build the project ──
FROM install AS build

WORKDIR /app

# Copy source
COPY . .

# Build the project
RUN pnpm run build

# ── Runtime phase: minimal production image ──
FROM node:24-alpine AS runtime

WORKDIR /app

# Copy built artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/server ./server
COPY --from=build /app/index.html ./
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./

# Runtime config
ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0

EXPOSE 5173

# Run the server using tsx (already in node_modules)
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]