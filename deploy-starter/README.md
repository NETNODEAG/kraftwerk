# kraftwerk deploy starter

Copy this folder into your kraftwerk consumer repo (the repo with your
`src/workflows/`) as `deploy/`, and you get the inspector web UI — runs,
workflows, chat with claude/codex/pi — as a Docker service serving that
repo. kraftwerk is installed from npm inside the image; your repo is
bind-mounted at `/work`, so runs and chats persist to your `output/`.

```
your-repo/
  kraftwerk.yml
  src/workflows/...
  output/                  # runs + chats land here
  deploy/                  # <- this folder
    Dockerfile
    entrypoint.sh
    compose.yml            # base: localhost only
    compose.traefik.yml    # server override: traefik + basic-auth
    .env.example
```

## Local / SSH tunnel

```bash
cd deploy
cp .env.example .env       # ANTHROPIC_API_KEY, OPENAI_API_KEY
docker compose up -d --build
# -> http://127.0.0.1:1981   (on a VPS: ssh -L 1981:127.0.0.1:1981 you@vps)
```

## Behind traefik

Fill `KRAFTWERK_HOST` and `KRAFTWERK_BASIC_AUTH` (htpasswd, `$` doubled)
in `.env`, check the entrypoint/certresolver/network names in
`compose.traefik.yml` against your traefik install, then:

```bash
docker compose -f compose.yml -f compose.traefik.yml up -d --build
```

Basic-auth is not optional: the UI has no authentication of its own and
its chat runs coding agents with full access to the mounted repo.

## Notes

- Pin the framework: `docker compose build --build-arg KRAFTWERK_VERSION=x.y.z`
  (default `latest`). Chat requires >= 0.5.0.
- Agent auth: API keys via `.env`, or log in once inside the container
  (`docker compose exec ui codex login`) — persisted in the `agent-home`
  volume.
- SSE (chat streaming) passes through traefik defaults untouched.
