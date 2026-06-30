# SOURCE_OF_TRUTH.md — {PROJECT NAME}

Last verified: {YYYY-MM-DD} by {who}.

**GitHub `main` is canonical and the site deploys from `main`.** Local clones are disposable.

## Production linkage
- Host: {Netlify/Vercel} · site name: {…} · site id: {…}
- Build command: `{cmd}`
- Publish dir: `{dir}`
- **Deploy mechanism: push `main` → {host} auto-build → auto-publish.** (No manual deploys.)
- Live URL: {https://…}

## Source layout
- Edit: `{app/src, etc.}`
- Build output (gitignored, don't hand-edit): `{dist, etc.}`

## Secrets
- `.env*` gitignored. Real values set in {host env / 1Password}. Commit only `.env.example`.

## Branches / archives
- `main` = canonical. Old/superseded states preserved as `archive/*` (never hard-deleted).
- Backups: {paths, if any}.

## Notes / history
- {anything the next person must know — incidents, gotchas, pending items}
