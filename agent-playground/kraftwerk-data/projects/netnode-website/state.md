# Current state

Last updated 2026-11-07 (kraftwerk-chat/claude).

## Done
- Repositories enabled in kraftwerk.yml (`repos: {}`, default root `repos/`, git-ignored).
- `frontend.netnode.ch` cloned over SSH (bitbucket.org/NETNODEAG, branch main) into `repos/frontend.netnode.ch` and linked to this project. HTTPS clone fails in the chat (no credential prompt) — use the SSH remote.
- my.netnode.ch record corrected: the website workspace is **1** "netnode.ch/netnode.ai Content/Marketing/Sales" (Team Blau, agent Nora AI Assistentin). It registers the repositories frontend.netnode.ch (id 2) and ai.netnode.ch (id 3). Workspace 4 is the "Test" workspace and was wrong.

- Knowledge bundle `netnode-website` created (9 concepts: overview, stack/frontend, stack/hosting-and-deploy, stack/cms-nodehive, seo/redirects-and-canonical, seo/competitors, operations/routines, roadmap/snapshot-2026-09-09, lessons/engineering) and linked to the project. Start there for context; refresh the roadmap snapshot monthly (stale_after 2026-10-09).
- Finding: canonical host is `https://netnode.ch` (www redirects). Brief and project.yml still say www — propose the change to Lukas.
- Content pipeline retro after task 4 (2026-11-07, five rounds, three drafts, three returns from a human): the house rules now live in the board text (`boards/content/board.md` — one round per reviewer, the newest human instruction beats task.md, a task sent back from Review re-enters at Writing, a new version is a new file, the last draft is a CMS package, count what you claim, check instead of adopt, a QA/SEO goal conflict is documented not resolved) and the system prompts of Nora, Rita and Sven were rewritten around them. Sven's wrong meta rules are fixed (it said 50–60 characters and og:image 1200×630; on netnode.ch the budget is 47 characters and og:image is an automatic screenshot), and SEO findings that change the text are `changes requested` now instead of being deferred to the CMS step — a human had to pull task 4 back into Writing for exactly that.
- Content pipeline has an SEO stage (2026-11-07): new agent **Sven** (📈, `kraftwerk-data/agents/sven`) and a new column **SEO** between QA and Review on the `content` board. Rita hands an approved text to Sven, Sven writes `seo.md` with CMS-ready meta title, meta description, slug and H1 plus the on-page and GEO findings, then hands the task to the humans — or back to Writing and to Nora when something must change. Rita's and Nora's system prompts were adjusted for the new hand-overs.

## Open
- No baseline yet: no check workflow has run. First candidates: website-check and lighthouse-trend against https://www.netnode.ch.
- Workspace 1 has 0 open helpdesk tickets and 72 roadmap items (2026-09-09); run helpdesk-check with request "1" when tickets appear.
- The project log has no entry for the repo link or the workspace fix yet (the log command was declined in the session); add one with `npx kraftwerk projects log netnode-website ...` when wanted.
- ai.netnode.ch (bitbucket.org/NETNODEAG/ai.netnode.ch) is registered in workspace 1 but not cloned here; link it if the project should cover netnode.ai too.
- Task 4 (BehiG blogpost) waits for a human in Review: `draft-v3.md` is Rita's recommendation to publish, v1 and v2 stay approved beside it. Open decisions are du-form vs. Sie-form and five rules vs. seven points; open for the CMS step are the Stand date at six places in the body, the backlink from `/de/blog/barrierefreie-museums-website`, and an `accessibility-audit` run (last one 17.9.2026 — the post has a section about exactly that routine). Two points belong to Web: the missing accessibility benefit on `/de/programme/website-check` and two self-canonical Website-Check pages.
- Sven's meta-title question from his first run is answered and no longer open: netnode.ch has no meta-title field, the node title is `<title>` and H1 at once plus ` | NETNODE AG`, so the budget is 47 characters. `/de/blog/<slug>` is confirmed as the section.

## Decided
- Content changes go through NodeHive CMS, never the repository (brief).
- helpdesk-check takes workspace ids from the run request; nothing in the workflows hardcodes a workspace.
- SEO is checked on the finished text, not written as a briefing before it: Nora writes freely, Sven optimises after Rita's facts-and-tone review.
- Meta title, meta description and slug belong to Sven. Nora leaves them to him, Rita does not request changes for findability — one owner per concern, one round per gate.
- Learnings go into the board text and the system prompts, not only into the agents' journals: a journal is one agent's memory, `board.md` is read by everyone who touches the board.
- A goal conflict between QA (reader) and SEO (search) is not a defect. Neither agent resolves it; both reasons go into the log and the decision to a human. Length on task 4 was the first case.
- Facts beat the commissioned angle: if a deadline or figure does not survive the primary-source check, the draft is written on the provable counter-hook and the angle decision goes to a human with options — never an empty hand-back.
