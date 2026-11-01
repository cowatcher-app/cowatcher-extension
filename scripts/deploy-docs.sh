#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# CoWatcher Documentation Deployment Script (GitHub Pages)
# ==============================================================================
# Usage:
#   npm run docs:deploy                 # Deploy to 'origin' (default)
#   npm run docs:deploy -- upstream     # Deploy to 'upstream'
#   ./scripts/deploy-docs.sh [remote]   # Direct script execution
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET_REMOTE="${1:-origin}"
BRANCH="gh-pages"

# Resolve target remote URL
REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url "$TARGET_REMOTE" 2>/dev/null || echo "")
if [ -z "$REMOTE_URL" ]; then
  echo "❌ Error: Git remote '$TARGET_REMOTE' does not exist in this repository!" >&2
  echo "Available remotes:"
  git -C "$REPO_ROOT" remote -v
  exit 1
fi

# Auto-detect target repository name to set exact base path unless explicitly overridden
if [ -z "${VITEPRESS_BASE:-}" ]; then
  REPO_NAME=$(basename -s .git "$REMOTE_URL" 2>/dev/null || echo "")
  if [ -n "$REPO_NAME" ]; then
    export VITEPRESS_BASE="/${REPO_NAME}/"
  else
    export VITEPRESS_BASE="/cowatcher-extension/"
  fi
fi

echo "==> 📦 1/3: Building VitePress documentation (Base: ${VITEPRESS_BASE})..."
npm run docs:build

DIST_DIR="$REPO_ROOT/docs/.vitepress/dist"
if [ ! -d "$DIST_DIR" ]; then
  echo "❌ Error: Build output directory $DIST_DIR not found!" >&2
  exit 1
fi

echo "==> 📁 2/3: Preparing deployment artifacts..."
DEPLOY_DIR=$(mktemp -d)
trap 'rm -rf "$DEPLOY_DIR"' EXIT

# Copy built site to root
cp -r "$DIST_DIR"/* "$DEPLOY_DIR"/

# Also copy to docs/ folder for backward-compatibility with GitHub Pages "/docs" source setting
mkdir -p "$DEPLOY_DIR/docs"
cp -r "$DIST_DIR"/* "$DEPLOY_DIR/docs"/

# Prevent GitHub Pages from ignoring files starting with an underscore (e.g. VitePress chunks)
touch "$DEPLOY_DIR/.nojekyll"
touch "$DEPLOY_DIR/docs/.nojekyll"

# Copy CNAME if present in repo root or docs/public
if [ -f "$REPO_ROOT/CNAME" ]; then
  cp "$REPO_ROOT/CNAME" "$DEPLOY_DIR/"
  cp "$REPO_ROOT/CNAME" "$DEPLOY_DIR/docs/"
elif [ -f "$REPO_ROOT/docs/public/CNAME" ]; then
  cp "$REPO_ROOT/docs/public/CNAME" "$DEPLOY_DIR/"
  cp "$REPO_ROOT/docs/public/CNAME" "$DEPLOY_DIR/docs/"
fi

# Initialize isolated git repository in the deployment directory
cd "$DEPLOY_DIR"
git init -q
git checkout -B "$BRANCH" -q

# Inherit git author identity from parent repository
USER_NAME=$(git -C "$REPO_ROOT" config user.name || echo "CoWatcher Bot")
USER_EMAIL=$(git -C "$REPO_ROOT" config user.email || echo "bot@cowatcher.local")
git config user.name "$USER_NAME"
git config user.email "$USER_EMAIL"

git add -A
COMMIT_HASH=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
git commit -q -m "deploy(docs): update documentation [skip ci] (${COMMIT_HASH})"

echo "==> 📤 3/3: Pushing to $TARGET_REMOTE ($REMOTE_URL) on branch '$BRANCH'..."
git push -f "$REMOTE_URL" "$BRANCH"

echo ""
echo "🎉 Successfully deployed documentation to $TARGET_REMOTE/$BRANCH!"
