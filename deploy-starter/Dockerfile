# kraftwerk-ui — inspector web UI (runs, workflows, chat) for a kraftwerk
# consumer repo. kraftwerk is installed from npm; your repo is mounted at
# /work by compose.yml. Pin the version via build arg:
#
#   docker compose build --build-arg KRAFTWERK_VERSION=0.5.0

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash git curl ca-certificates openssh-client procps jq ripgrep \
    && rm -rf /var/lib/apt/lists/*

# The framework + the agent CLIs: workflow harnesses (claude -p,
# codex exec, pi) and the chat backends.
ARG KRAFTWERK_VERSION=latest
RUN npm install -g --no-fund --no-audit \
      @netnodeag/kraftwerk@${KRAFTWERK_VERSION} \
      @anthropic-ai/claude-code \
      @openai/codex \
      @earendil-works/pi-coding-agent

COPY entrypoint.sh /usr/local/bin/kraftwerk-entrypoint
RUN chmod +x /usr/local/bin/kraftwerk-entrypoint

# Agent auth/config lives under $HOME (.claude.json, .codex, .pi) — the
# compose file mounts a volume here so logins survive restarts.
ENV HOME=/root
WORKDIR /work
EXPOSE 1981

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://localhost:1981/api/runs > /dev/null || exit 1

ENTRYPOINT ["kraftwerk-entrypoint"]
