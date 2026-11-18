---
title: test
template: default
layout: title
---
# netnode.ch

::subtitle::
Stack, rules and routines — 2026-11-09

---
layout: content
---
# What the site is

- Public site of NETNODE AG, a Swiss B2B digital agency in Lucerne, founded 2003
- Positioning: websites, digital experience platforms, digital products and AI applications
- Focus: Drupal, the in-house NodeHive headless CMS, and Next.js
- German is the primary language, English secondary
- Project goal: keep netnode.ch fast, accessible and ahead of the competition

---
layout: two-column
---
# Architecture in one line

::left::
**Frontend — frontend.netnode.ch**
- Next.js 16 / React 19, App Router, TypeScript
- Tailwind, Vercel AI SDK ("Frag Paul" chat)
- Matomo analytics, Playwright tests

::right::
**Backend — netnode.nodehive.app**
- NodeHive on Drupal, JSON:API via nodehive-js
- Content types: pages, articles, news, events, case studies, employees
- Content changes go through the CMS, never the repository

---
layout: content
---
# Hosting and deploy

::eyebrow::
Deployment

::body::
- Production container `frontend-netnode-ch` serves five hosts: netnode.ch, www.netnode.ch, beta.netnode.ch and two internal aliases
- Push to `main` → Bitbucket Pipelines → ssh as root → `git pull` → `deploy.sh` rebuilds and swaps the container
- No staging branch — `beta.netnode.ch` runs the same container
- Rule: no push to production without a green accessibility audit

---
layout: table
---
# Operating routines

::eyebrow::
Operations

::table::
| Promise | Workflow | Cadence |
|---|---|---|
| Site meta checks green | website-check | weekly |
| Accessibility gate before prod | accessibility-audit | before every push, weekly otherwise |
| Performance trend | lighthouse-trend | weekly |
| Competitor review | competitor-watch | weekly |
| Helpdesk within one working day | helpdesk-check | daily |

---
layout: content
---
# Positioning and competitors

::eyebrow::
Market

::body::
- Audience: SMEs, associations, institutions and public bodies in German-speaking Switzerland
- Differentiators: 20+ years of Drupal, own product NodeHive, fixed-price programmes, AI-first delivery
- "KI" keyword variants beat "AI" variants by an order of magnitude in Switzerland
- Tracked competitors: Liip AG, Unic AG — more candidates on the draft longlist

---
layout: statement
---
# No push to production without a green accessibility audit.

::eyebrow::
Constraint

::note::
Marketing owns the content, the web team owns the stack — content changes always go through NodeHive, never through the repository.

---
layout: content
---
# Where we stand

::eyebrow::
Open

::body::
- No check workflow has run yet — no baseline for website-check or lighthouse-trend
- Canonical host is `netnode.ch` without www — brief and project.yml still say www, needs a decision
- Competitor set beyond Liip and Unic is still a draft longlist to confirm
