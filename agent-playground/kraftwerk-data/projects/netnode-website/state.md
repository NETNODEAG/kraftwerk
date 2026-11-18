# Current state

Last updated 2026-09-09 (kraftwerk-chat/claude).

## Done
- Repositories enabled in kraftwerk.yml (`repos: {}`, default root `repos/`, git-ignored).
- `frontend.netnode.ch` cloned over SSH (bitbucket.org/NETNODEAG, branch main) into `repos/frontend.netnode.ch` and linked to this project. HTTPS clone fails in the chat (no credential prompt) — use the SSH remote.
- my.netnode.ch record corrected: the website workspace is **1** "netnode.ch/netnode.ai Content/Marketing/Sales" (Team Blau, agent Nora AI Assistentin). It registers the repositories frontend.netnode.ch (id 2) and ai.netnode.ch (id 3). Workspace 4 is the "Test" workspace and was wrong.

- Knowledge bundle `netnode-website` created (9 concepts: overview, stack/frontend, stack/hosting-and-deploy, stack/cms-nodehive, seo/redirects-and-canonical, seo/competitors, operations/routines, roadmap/snapshot-2026-09-09, lessons/engineering) and linked to the project. Start there for context; refresh the roadmap snapshot monthly (stale_after 2026-10-09).
- Finding: canonical host is `https://netnode.ch` (www redirects). Brief and project.yml still say www — propose the change to Lukas.

## Open
- No baseline yet: no check workflow has run. First candidates: website-check and lighthouse-trend against https://www.netnode.ch.
- Workspace 1 has 0 open helpdesk tickets and 72 roadmap items (2026-09-09); run helpdesk-check with request "1" when tickets appear.
- The project log has no entry for the repo link or the workspace fix yet (the log command was declined in the session); add one with `npx kraftwerk projects log netnode-website ...` when wanted.
- ai.netnode.ch (bitbucket.org/NETNODEAG/ai.netnode.ch) is registered in workspace 1 but not cloned here; link it if the project should cover netnode.ai too.

## Decided
- Content changes go through NodeHive CMS, never the repository (brief).
- helpdesk-check takes workspace ids from the run request; nothing in the workflows hardcodes a workspace.
