# kraftwerk-runner — sandbox image for isolated workflow runs.
#
# Build (from the framework directory):
#   kraftwerk runner build          # or:
#   docker build -t kraftwerk-runner -f runner/Dockerfile .
#
# One container per run: the runner mounts the workflow folder read-only,
# bind-mounts the host run directory, injects env vars, and executes
# `kraftwerk run` inside. See src/runner/docker.ts.

# node >= 24: workflows may ship TypeScript MCP servers that node runs
# directly (native type stripping).
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash python3 curl ca-certificates openssh-client git procps jq \
    && rm -rf /var/lib/apt/lists/*

# Agent harness CLIs used by workflows (headless: claude -p, codex exec).
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# The framework itself, installed from the build context. Ships the
# compiled dist/ (tsx is a devDependency and not installed here) — run
# `npm run build` before building the image from a dev checkout.
WORKDIR /opt/kraftwerk
COPY package.json ./
RUN npm install --omit=dev
COPY bin ./bin
COPY schema ./schema
COPY dist ./dist
RUN ln -s /opt/kraftwerk/bin/kraftwerk.js /usr/local/bin/kraftwerk \
    && chmod +x /opt/kraftwerk/bin/kraftwerk.js

# Consumer project skeleton: the runner mounts the workflow folder into
# src/workflows/<name> and the run dir into output/<run-id>. The MCP SDK +
# zod are preinstalled so workflow-local MCP servers (mcp/*.ts) resolve
# their imports, mirroring the consumer's node_modules.
WORKDIR /work
RUN mkdir -p src/workflows output \
    && printf '{"name":"kraftwerk-sandbox","private":true}\n' > package.json \
    && npm install --no-fund --no-audit @modelcontextprotocol/sdk zod

ENV HOME=/root
