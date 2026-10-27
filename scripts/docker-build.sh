#!/usr/bin/env bash
#
# docker-build.sh - Build a Docker image for the tsl-editor project
#
# Reads DOCKER_IMAGE_NAME, DOCKER_IMAGE_VERSION, DOCKER_IMAGE_REPO from .env,
# falling back to package.json (version, name, dockerRepository).
# Tags: <repo>/<name>:<version> and <repo>/<name>:latest
# --push: push image to repository
# --help: show usage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ── Helper: print usage ──
usage() {
  cat <<'EOF'
Usage: docker-build.sh [--push] [--help]

Build and optionally push a Docker image for this project.

The Dockerfile uses a multi-stage build:
  install phase:  pnpm install (cached layer)
  build phase:    pnpm run build
  runtime phase:  minimal production image

Image is tagged with version and 'latest'.

Options:
  --push    Push the built image to the container registry
  --help    Show this help message and exit
EOF
}

# ── Parse arguments ──
PUSH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# ── Read values from .env, fallback to package.json ──
DOCKER_IMAGE_NAME="${DOCKER_IMAGE_NAME:-}"
DOCKER_IMAGE_VERSION="${DOCKER_IMAGE_VERSION:-}"
DOCKER_IMAGE_REPO="${DOCKER_IMAGE_REPO:-}"

# Try to read .env file
if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env
fi

# ── Fallback to package.json ──
if [[ -z "$DOCKER_IMAGE_NAME" ]]; then
  DOCKER_IMAGE_NAME="$(grep '"name"' package.json | head -1 | sed 's/.*"\(.*\)".*/\1/')"
fi

if [[ -z "$DOCKER_IMAGE_VERSION" ]]; then
  DOCKER_IMAGE_VERSION="$(grep '"version"' package.json | head -1 | sed 's/.*"\(.*\)".*/\1/')"
fi

if [[ -z "$DOCKER_IMAGE_REPO" ]]; then
  DOCKER_IMAGE_REPO="$(grep '"dockerRepository"' package.json | head -1 | sed 's/.*"\(.*\)".*/\1/')"
fi

# ── Validate all required values ──
MISSING=0

if [[ -z "$DOCKER_IMAGE_NAME" ]]; then
  echo "ERROR: DOCKER_IMAGE_NAME not found. Set it in .env or package.json (name)." >&2
  MISSING=1
fi

if [[ -z "$DOCKER_IMAGE_VERSION" ]]; then
  echo "ERROR: DOCKER_IMAGE_VERSION not found. Set it in .env or package.json (version)." >&2
  MISSING=1
fi

if [[ -z "$DOCKER_IMAGE_REPO" ]]; then
  echo "ERROR: DOCKER_IMAGE_REPO not found. Set it in .env or package.json (dockerRepository)." >&2
  MISSING=1
fi

if [[ "$MISSING" -eq 1 ]]; then
  exit 1
fi

# ── Build the image tags ──
IMAGE_TAG_VERSION="${DOCKER_IMAGE_REPO}/${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_VERSION}"
IMAGE_TAG_LATEST="${DOCKER_IMAGE_REPO}/${DOCKER_IMAGE_NAME}:latest"

echo "Building Docker image:"
echo "  Name:       $DOCKER_IMAGE_NAME"
echo "  Version:    $DOCKER_IMAGE_VERSION"
echo "  Repo:       $DOCKER_IMAGE_REPO"
echo "  Tag (ver):  $IMAGE_TAG_VERSION"
echo "  Tag (lst):  $IMAGE_TAG_LATEST"

# ── Build Docker image ──
echo ""
echo "=== Building Docker image ==="
docker build -t "$IMAGE_TAG_VERSION" -t "$IMAGE_TAG_LATEST" .

# ── Push if requested ──
if [[ "$PUSH" -eq 1 ]]; then
  echo ""
  echo "=== Pushing Docker image ==="
  docker push "$IMAGE_TAG_VERSION"
  docker push "$IMAGE_TAG_LATEST"
  echo "Pushed: $IMAGE_TAG_VERSION and $IMAGE_TAG_LATEST"
fi

echo ""
echo "Done! Image tags: $IMAGE_TAG_VERSION, $IMAGE_TAG_LATEST"