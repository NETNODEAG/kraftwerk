#!/bin/sh
# kraftwerk-ui entrypoint: best-effort install of the mounted project's
# deps (workflow-local MCP servers import from /work/node_modules), then
# start the inspector. The kraftwerk CLI itself is installed globally in
# the image, so a failed install is not fatal.
set -e

# The repo is bind-mounted and owned by the host user; without this git
# refuses to operate on it ("dubious ownership") for the agents.
git config --global --add safe.directory '*' 2>/dev/null || true

if [ -f /work/package.json ] && [ ! -d /work/node_modules ]; then
  echo "kraftwerk-ui: installing project dependencies in /work ..."
  npm install --omit=dev --no-fund --no-audit \
    || echo "kraftwerk-ui: npm install failed — continuing without project node_modules"
fi

exec kraftwerk ui --port "${KRAFTWERK_PORT:-1981}" "$@"
