# DEPLOY.md — Deckspace Deployment Guide

Step-by-step instructions to get Deckspace live on Cloudflare Pages,
Supabase, and Cloudflare R2. No assumed knowledge. Exact field names included.

Estimated time: 30–45 minutes on first deploy.

---

## Prerequisites

- A Cloudflare account (free tier works)
- A Supabase account (free tier works for a sailing)
- Access to the `omgitsthedm/mike-ziemer` GitHub repo
- A terminal with `node` and `npm` installed (for local dev only)

---

## Step 1 — Supabase: Create Project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Name it: `deckspace` (or `deckspace-[sailing-name]`)
3. Set a strong database password — save it somewhere
4. Region: pick closest to where the ship sails
5. Wait for provisioning (~2 min)

### 1a — Run the schema

1. In your Supabase project → **SQL Editor** → **New query**
2. Paste the entire contents of `db/schema.sql`
3. Click **Run** — you should see "Success. No rows returned"

### 1b — Insert your sailing record

In the SQL Editor, run this (edit the values to match your actual sailing):

```sql
insert into sailings (
  id, name, ship_name,
  departs_at, returns_at,
  access_opens_at, access_closes_at, archive_ends_at,
  status
) values (
  gen_random_uuid(),
  'Caribbean Jan 2025',        -- change this
  'MS Deckspace',              -- change to actual ship name
  '2025-01-12 16:00:00+00',   -- departure datetime UTC
  '2025-01-19 08:00:00+00',   -- return datetime UTC
  '2025-01-05 00:00:00+00',   -- when pre-cruise signup opens
  '2025-01-19 08:00:00+00',   -- when writing closes (archive starts)
  '2025-01-26 23:59:00+00',   -- when everything closes
  'upcoming'                   -- change to 'active' when sailing begins
) returning id;
```

**Copy the `id` UUID that comes back — this is your `SAILING_ID`.**

### 1c — (Optional) Load QA fixture

For staging/testing only. Do NOT run on production before a real sailing.

```sql
-- Edit the sailing UUID at the top of the file first:
-- find 'a1000000-0000-0000-0000-000000000001' and replace with your sailing id
```

Then paste and run `db/fixture.sql` contents.

### 1d — Collect Supabase credentials

In your Supabase project → **Settings** → **API**:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | "Project URL" field |
| `SUPABASE_ANON_KEY` | "anon public" key |
| `SUPABASE_SERVICE_KEY` | "service_role secret" key — keep this private |

---

## Step 2 — Cloudflare: R2 Bucket

1. In the Cloudflare dashboard → **R2** → **Create bucket**
2. Name: `deckspace-media` (or `deckspace-[sailing]-media`)
3. Location: default (or closest to sailing region)
4. After creation → **Settings** → enable **Public access**
5. Copy the **Public bucket URL** — format: `https://pub-xxxx.r2.dev`
   This becomes your `R2_PUBLIC_URL`

---

## Step 3 — Cloudflare: Turnstile Widget

1. Cloudflare dashboard → **Turnstile** → **Add site**
2. Site name: `Deckspace`
3. Domain: your Pages URL (e.g. `deckspace.pages.dev`) — add it after Pages is created, or add `localhost` for now
4. Widget type: **Managed**
5. After creation → copy **Site Key** and **Secret Key**

---

## Step 4 — Cloudflare Pages: Create Project

1. Cloudflare dashboard → **Pages** → **Create a project**
2. Select **Connect to Git** → authorize GitHub → select `omgitsthedm/mike-ziemer`
3. Configuration:
   - **Production branch**: `claude/deckspace-pdr-IhYsR`
   - **Build command**: *(leave empty)*
   - **Build output directory**: `public`
4. Click **Save and Deploy** — first deploy will fail (no env vars yet — that's fine)

---

## Step 5 — Cloudflare Pages: Environment Variables

In your Pages project → **Settings** → **Environment variables** → **Add variable** for each:

| Variable name | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | From Step 1d |
| `SUPABASE_ANON_KEY` | `eyJ...` | From Step 1d |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | From Step 1d — mark as **Secret** |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Mark as **Secret** |
| `JWT_SECRET` | random 40+ char string | Generate: `openssl rand -hex 20` |
| `TURNSTILE_SITE_KEY` | `0x...` | From Step 3 |
| `TURNSTILE_SECRET_KEY` | `0x...` | From Step 3 — mark as **Secret** |
| `SAILING_ID` | UUID from Step 1b | The sailing record UUID |
| `R2_PUBLIC_URL` | `https://pub-xxxx.r2.dev` | From Step 2 (no trailing slash) |
| `ENVIRONMENT` | `production` | Controls error detail visibility |

Set all variables for **both** Production and Preview environments.

---

## Step 6 — Cloudflare Pages: R2 Bucket Binding

This is separate from env vars — it's a Worker binding.

1. Pages project → **Settings** → **Functions**
2. Scroll to **R2 bucket bindings** → **Add binding**
3. Variable name: `MEDIA_BUCKET` ← must be exactly this
4. R2 bucket: select `deckspace-media`
5. Save

---

## Step 7 — Trigger Redeploy

1. Pages project → **Deployments** → find the most recent (failed) deploy
2. Click the **...** menu → **Retry deployment**
3. Or push any commit to `claude/deckspace-pdr-IhYsR` — Pages redeploys automatically

Deployment takes ~30 seconds. Your site will be live at:
`https://deckspace.pages.dev` (or your custom domain)

---

## Step 8 — Create First Admin Account

1. Go to your live site → `/register`
2. Create an account with your username
3. In Supabase SQL Editor, promote it to admin:

```sql
update users
set role = 'admin'
where username = 'your-username'
and sailing_id = 'your-sailing-id';
```

4. Sign in → you now have access to `/admin`

---

## Step 9 — Update Sailing Status

When the pre-cruise window opens, update the sailing to active:

```sql
update sailings
set status = 'active'
where id = 'your-sailing-id';
```

Change to `'archive'` after the ship docks.

---

## Local Development

```bash
# Install dependencies
npm install

# Create local env file
cp .dev.vars.example .dev.vars
# Fill in your values

# Run dev server (requires wrangler)
npm run dev
# → http://localhost:8788
```

`.dev.vars` (never commit this):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
JWT_SECRET=local-dev-secret-change-in-production
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SAILING_ID=your-sailing-uuid
R2_PUBLIC_URL=https://pub-xxxx.r2.dev
ENVIRONMENT=development
```

For Turnstile in local dev, use Cloudflare's always-pass test keys:
- Site key: `1x00000000000000000000AA`
- Secret key: `1x0000000000000000000000000000000AA`

---

## Custom Domain (Optional)

1. Pages project → **Custom domains** → **Set up a custom domain**
2. Enter your domain (e.g. `sail.yourdomain.com`)
3. Follow DNS instructions
4. After domain is live, go back to Turnstile → add the real domain to your widget

---

## Checklist Before Passengers Access It

- [ ] Schema applied successfully (no errors)
- [ ] Sailing record inserted, status = `active`
- [ ] All 9 environment variables set
- [ ] R2 bucket binding set to `MEDIA_BUCKET`
- [ ] Turnstile widget domain matches live URL
- [ ] Admin account created and verified at `/admin`
- [ ] Test registration as a new user
- [ ] Test profile creation and photo upload
- [ ] Test wall post and guestbook
- [ ] Test event create and RSVP
- [ ] Load the site on a throttled mobile connection (Chrome DevTools → Slow 3G)
- [ ] Verify profile page passes the 20-point DESIGN.md QA checklist

---

## Lifecycle Operations

### Activate pre-cruise window
```sql
update sailings set status = 'active' where id = 'your-id';
```

### Move to archive after docking
```sql
update sailings set status = 'archive' where id = 'your-id';
```

### Fully close after archive window ends
```sql
update sailings set status = 'closed' where id = 'your-id';
```

### Suspend a user
```sql
update users set account_status = 'suspended' where username = 'bad-actor';
```
Or use the admin dashboard at `/admin/users`.

---

## Troubleshooting

**Deployment fails with "Module not found"**
→ Check that `functions/[[path]].js` imports resolve correctly.
→ Run `npm install` locally and verify `node_modules/hono` exists.

**"Invalid session" on every request**
→ `JWT_SECRET` env var is missing or empty.

**Photos not uploading**
→ Check that the R2 binding name is exactly `MEDIA_BUCKET`.
→ Verify `R2_PUBLIC_URL` has no trailing slash.

**Turnstile verification always fails**
→ Use the always-pass test keys locally.
→ In production, confirm the domain in Turnstile widget matches exactly.

**Supabase 401 errors**
→ `SUPABASE_SERVICE_KEY` is the service_role key, not the anon key.
→ Confirm RLS is enabled — the service key bypasses it, which is correct.

**"Sailing not found" errors**
→ `SAILING_ID` env var doesn't match any row in the `sailings` table.
→ Check the UUID for typos (copy directly from Supabase SQL output).
