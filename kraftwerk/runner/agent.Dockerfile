# kraftwerk-agent — sandbox image for chat agents.
#
# Build:
#   kraftwerk sandbox build            # or:
#   docker build -t kraftwerk-agent -f runner/agent.Dockerfile runner/
#
# One long-lived container per agent (`sleep infinity`); each ACP session
# enters it with `docker exec -i` and speaks the protocol over that pipe.
# The inspector stays the ACP client on the host — nothing in here writes
# the transcript. See src/runner/agent-sandbox.ts.
#
# What it holds: the ACP adapter binaries, the harness CLIs they drive, and
# the kraftwerk CLI — an agent runs its granted workflows itself, inside its
# own sandbox, rather than asking the host to run them outside it.

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash git curl ca-certificates openssh-client procps jq ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*

# The ACP adapters (their package `bin` names land on PATH as
# claude-agent-acp / codex-acp) and the harness CLIs they drive.
ARG CLAUDE_ACP_VERSION=latest
ARG CODEX_ACP_VERSION=latest
RUN npm install -g --no-fund --no-audit \
      @agentclientprotocol/claude-agent-acp@${CLAUDE_ACP_VERSION} \
      @agentclientprotocol/codex-acp@${CODEX_ACP_VERSION} \
      @anthropic-ai/claude-code \
      @openai/codex

# kraftwerk itself: from npm by default, or from a tarball packed out of this
# checkout (`kraftwerk sandbox build --local`). The local path exists because
# anything the sandbox runs — the egress proxy, `kraftwerk run` — is only
# testable once the image carries the version being worked on.
ARG KRAFTWERK_VERSION=latest
ARG KRAFTWERK_SRC=npm
COPY . /ctx/
RUN if [ "$KRAFTWERK_SRC" = "local" ]; then \
      npm install -g --no-fund --no-audit /ctx/*.tgz; \
    else \
      npm install -g --no-fund --no-audit @netnodeag/kraftwerk@${KRAFTWERK_VERSION}; \
    fi \
    && rm -rf /ctx

# Workflow-local MCP servers (mcp/*.ts next to a workflow) import these,
# mirroring what the consumer project has in its own node_modules.
RUN mkdir -p /opt/wf && cd /opt/wf \
    && printf '{"name":"kraftwerk-agent-deps","private":true}\n' > package.json \
    && npm install --no-fund --no-audit @modelcontextprotocol/sdk zod
ENV NODE_PATH=/opt/wf/node_modules

# Agent state (CLI logins, adapter session store) — the sandbox mounts a
# named volume here so it survives a container replacement.
ENV HOME=/root

# The workspace is bind-mounted at its own host path at run time; git
# refuses to touch a repo owned by another uid without this.
RUN git config --global --add safe.directory '*'

# A non-root identity for the agent's own processes. `docker exec --user`
# names the host's uid so bind-mounted files keep working; this user exists
# so the image is usable as-is when the host runs as uid 1000.
RUN useradd --uid 1000 --create-home --shell /bin/bash agent 2>/dev/null || true

# PID 1 applies the per-agent policy (command allowlist, volume ownership)
# and then just stays alive; the real work arrives via `docker exec`.
COPY kw-sandbox-init /usr/local/bin/kw-sandbox-init
RUN chmod 755 /usr/local/bin/kw-sandbox-init
CMD ["/usr/local/bin/kw-sandbox-init"]
