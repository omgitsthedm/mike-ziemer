# AGENTS.md — {PROJECT NAME}

> The shared brain for this repo. **Every tool and human reads this first** (Claude Code, Codex, Kimi, Gemini).
> Part of the Little Fight NYC Agency Operating System (`agency-ops/README.md`).

## What this is
- **Project:** {what it is, who the client is}
- **Live URL:** {https://…}
- **Stack:** {e.g. Vite + React + TS / static HTML / Next.js}

## Source of truth
- **GitHub `main` is canonical.** This repo is the only permanent home. Local clones are disposable.
- Deeper deploy/host facts: see `SOURCE_OF_TRUTH.md`.

## Commands  (keep current — this is the most important section)
- Dev: `{cmd}`
- Build: `{cmd}`
- Lint/format: `{cmd}`
- Deploy: **push `main`.** {host} auto-builds + publishes. **Never deploy by hand.**

## Deploy model
- Host: {Netlify/Vercel} · site id: {…}
- Production deploys **only** from `main` via git. A manual deploy is a bug — don't.

## Secrets
- Real secrets live in {Netlify env / 1Password}, never in the repo.
- `.env*` is gitignored; commit only `.env.example`. The pre-commit hook blocks secret commits.

## Before you START work
1. `git pull` (or re-clone fresh) — never edit a stale copy.
2. Read this file + `SOURCE_OF_TRUTH.md`.
3. `agency-doctor` — make sure the repo is healthy.
4. Make a branch for your change.

## Before you FINISH (Definition of Done — leave the file tidy)
1. Build passes; change verified (preview deploy if live).
2. **Docs updated** — this file, `SOURCE_OF_TRUTH.md`, and any decision log reflect reality.
3. Dead/stale notes pruned; new notes dated.
4. Commit + push; open a PR; `agency-doctor` is green.

## Do NOT touch without asking
- {anything live/risky} · secrets/`.env` · {client-specific landmines}

## Decisions log
| Date | Decision | Why |
|------|----------|-----|
| {YYYY-MM-DD} | {what} | {why} |
