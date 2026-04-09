# Deckspace — Rebuild Guide

How to stand up a fresh instance from scratch. Follow in order.

---

## Prerequisites

- Node.js 18+ and npm installed locally
- A Cloudflare account (free tier works)
- A Supabase account (free tier works)
- Access to the `omgitsthedm/mike-ziemer` GitHub repo
- Wrangler CLI: `npm install -g wrangler`

---

## Step 1 — Clone the Repo

```bash
git clone https://github.com/omgitsthedm/mike-ziemer.git
cd mike-ziemer
npm install
```

---

## Step 2 — Supabase: Create Project

1. Go to [supabase.com](https://supabase.com) → New project
2. Name: `deckspace` (or `deckspace-{sailing-name}`)
3. Set a strong DB password — save it
4. Pick region closest to where guests will be
5. Wait for provisioning (~2 min)

### 2a — Get your API keys

In your Supabase project → **Settings → API**:
- Copy **Project URL** → this is `SUPABASE_URL`
- Copy **anon/public** key → this is `SUPABASE_ANON_KEY`
- Copy **service_role** key → this is `SUPABASE_SERVICE_KEY`

### 2b — Run the schema

In Supabase → **SQL Editor → New query**:
1. Paste the entire contents of `db/schema.sql`
2. Click **Run** — should succeed with no rows returned

### 2c — Run the Phase 2 migration

Still in the SQL Editor → New query:
1. Paste the entire contents of `supabase/migrations/002_phase2.sql`
2. Click **Run**

This adds: `profiles.status_text`, `reactions` table, `reaction_counts` view, `voyage_days` table.

### 2d — Create the sailing record

In the SQL Editor, run this (edit values for the actual sailing):

```sql
INSERT INTO deckspace.sailings (
  name, ship_name,
  departs_at, returns_at,
  access_opens_at, access_closes_at, archive_ends_at,
  status
) VALUES (
  'Caribbean Jan 2026',           -- sailing name
  'MS Deckspace',                 -- ship name shown to guests
  '2026-01-22 16:00:00+00',       -- departure (UTC)
  '2026-01-26 08:00:00+00',       -- return (UTC)
  '2026-01-10 00:00:00+00',       -- when pre-cruise signup opens
  '2026-01-26 08:00:00+00',       -- when posting closes (archive starts)
  '2026-02-02 23:59:00+00',       -- when archive fully closes
  'active'
) RETURNING id;
```

**Copy the UUID that comes back — this is your `SAILING_ID`.**

For a demo with no date restrictions, use dates far in the future for `access_closes_at` and `archive_ends_at`.

---

## Step 3 — Cloudflare: Create Pages Project

### 3a — Connect the repo

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create**
2. Select **Pages → Connect to Git**
3. Authorize GitHub, select `omgitsthedm/mike-ziemer`
4. Framework preset: **None**
5. Build command: *(leave empty)*
6. Build output directory: `public`
7. Click **Save and Deploy**

This creates the Pages project. The first deploy will succeed but have no env vars set yet — that's fine.

### 3b — Set the production branch

In Pages project → **Settings → Builds & deployments**:
- Set production branch to: `main`

This gives you `{project-name}.pages.dev` as the production URL.

---

## Step 4 — Set Environment Variables

**Critical:** Use `wrangler pages secret put` for ALL variables. The Cloudflare dashboard's plain_text type gets wiped on every deploy. Secrets survive.

```bash
# Authenticate wrangler first
npx wrangler login

# Set all required secrets
npx wrangler pages secret put SUPABASE_URL --project-name=deckspace
npx wrangler pages secret put SUPABASE_ANON_KEY --project-name=deckspace
npx wrangler pages secret put SUPABASE_SERVICE_KEY --project-name=deckspace
npx wrangler pages secret put JWT_SECRET --project-name=deckspace
npx wrangler pages secret put TURNSTILE_SITE_KEY --project-name=deckspace
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=deckspace
npx wrangler pages secret put SAILING_ID --project-name=deckspace
npx wrangler pages secret put R2_PUBLIC_URL --project-name=deckspace
npx wrangler pages secret put ENVIRONMENT --project-name=deckspace
```

Each command prompts for the value interactively.

For `JWT_SECRET`, generate a random string:
```bash
openssl rand -hex 20
```

For `ENVIRONMENT`, use `production` for live or `development` to show stack traces.

---

## Step 5 — Cloudflare Turnstile

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile**
2. Click **Add Site**
3. Name: `Deckspace`
4. Domain: your Pages URL (e.g. `deckspace.pages.dev`)
5. Widget type: **Managed**
6. Copy **Site Key** → `TURNSTILE_SITE_KEY`
7. Copy **Secret Key** → `TURNSTILE_SECRET_KEY`

For local dev only, use these always-pass test keys:
- Site key: `1x00000000000000000000AA`
- Secret key: `1x0000000000000000000000000000000AA`

---

## Step 6 — Cloudflare R2 (Photo Storage)

1. In Cloudflare → **R2 → Create bucket**
2. Name: `deckspace-media`
3. After creation → **Settings → Public access → Allow**
4. Copy the **Public bucket URL** (format: `https://pub-xxxx.r2.dev`) → `R2_PUBLIC_URL`
5. In `wrangler.toml`, the R2 binding is already configured:
   ```toml
   [[r2_buckets]]
   binding = "MEDIA_BUCKET"
   bucket_name = "deckspace-media"
   ```

---

## Step 7 — Cloudflare KV (Optional but Recommended)

KV enables: rate limiting, ship bulletins, weather widget.

1. Cloudflare → **Workers & Pages → KV → Create namespace**
2. Name: `deckspace-kv`
3. In Pages project → **Settings → Functions → KV namespace bindings**
4. Add binding: Variable name = `KV`, KV namespace = `deckspace-kv`

---

## Step 8 — Deploy

```bash
npx wrangler pages deploy public --project-name=deckspace --branch=main
```

Or push to the `main` branch on GitHub — Cloudflare Pages will auto-deploy.

---

## Step 9 — First-Run Setup

Navigate to `https://{your-pages-url}/setup`

This page only appears when the database has zero users for the configured `SAILING_ID`. Fill in:
- Your name (admin display name)
- Username
- Password (8+ chars)

Click **Create Admin + Add Demo Passengers**.

This will:
1. Create your admin account
2. Seed 15 demo passengers with profiles and wall posts
3. Log you in and redirect to `/admin/demo`

---

## Step 10 — Admin Panel

Go to `/admin` to:
- Post a ship bulletin
- Set the weather widget
- Add voyage itinerary days
- Review the reports queue
- Manage users

---

## Seeding Events and Voyage Days

### Events
The fastest way: run `db/seed_demo.sql` in the Supabase SQL Editor. It creates 32 Shattered Shores themed events.

Or create events manually via `/events/create` while logged in.

### Voyage Days

Via Supabase SQL Editor:
```sql
INSERT INTO deckspace.voyage_days 
  (sailing_id, day_date, port_name, day_type, arrive_time, depart_time, notes, sort_order)
VALUES
  ('{SAILING_ID}', '2026-01-22', 'Miami, FL',               'embarkation',    NULL,     '16:00', 'Welcome aboard!', 1),
  ('{SAILING_ID}', '2026-01-23', 'At Sea',                  'sea',            NULL,     NULL,    'Full day at sea.', 2),
  ('{SAILING_ID}', '2026-01-24', 'Nassau, Bahamas',         'port',           '08:00',  '17:00', 'Explore downtown Nassau.', 3),
  ('{SAILING_ID}', '2026-01-25', 'Great Stirrup Cay',       'port',           '08:00',  '16:00', 'Private island day.', 4),
  ('{SAILING_ID}', '2026-01-26', 'Miami, FL',               'disembarkation', '07:00',  NULL,    'All guests ashore by 10am.', 5);
```

Or use the admin voyage editor at `/admin/voyage`.

---

## Local Development

```bash
# Copy env template
cp .dev.vars.example .dev.vars
# Fill in your values in .dev.vars

# Run locally
npm run dev
# → http://localhost:8788
```

Local dev uses Wrangler's miniflare runtime (same as CF Workers). KV and R2 bindings work locally with Wrangler's local emulation.

---

## Common Issues

### "Database not configured" on /setup
The `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, or `SAILING_ID` env vars are not set, or were set as plain_text (which gets wiped on deploy). Re-set them with `wrangler pages secret put`.

### Env vars disappear after deploy
This happens when vars are set as plain_text in the dashboard. Always use `wrangler pages secret put` — secrets are never wiped by deploys.

### Images not loading
Two causes:
1. **CSP**: If you're loading images from an external domain, add it to the `img-src` directive in `functions/[[path]].js`
2. **absUrl**: Always use `absUrl(cdnBase, key)` from `components.js` when building image URLs. Never concatenate `${cdnBase}/${key}` directly — it breaks absolute URLs.

### Login always says "complete verification challenge"
The Turnstile widget is not rendering in the login form. Check that `TURNSTILE_SITE_KEY` is set and that the `<script src="https://challenges.cloudflare.com/...">` tag is loading. The homepage login form passes `siteKey` to `landingPage()` — make sure that prop is being passed.

### /people returns 500
The `status_text` column is missing from `profiles`. Run `supabase/migrations/002_phase2.sql` in the Supabase SQL Editor.

### Events page shows raw function text like `() => ic.users(14)`
`CAT_ICONS` values are arrow functions. Use `icon()` (invoke it), not `${icon}` (stringify it).

---

## Updating an Existing Deploy

After making code changes:

```bash
git add .
git commit -m "description of changes"
git push origin claude/deckspace-pdr-IhYsR

# Deploy to main (production)
CLOUDFLARE_API_TOKEN=your_token npx wrangler pages deploy public --project-name=deckspace --branch=main
```

Env vars set as secrets are preserved across deploys.
