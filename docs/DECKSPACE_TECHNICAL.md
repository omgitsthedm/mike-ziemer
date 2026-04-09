# Deckspace — Technical Reference

## Repository

**GitHub:** `omgitsthedm/mike-ziemer`
**Active branch:** `claude/deckspace-pdr-IhYsR`
**Production deploy:** `https://main.deckspace.pages.dev` (Cloudflare Pages, `main` branch alias)

---

## Directory Structure

```
mike-ziemer/
├── functions/
│   └── [[path]].js          # Cloudflare Pages Functions entry — all HTTP requests land here
├── public/
│   ├── _routes.json         # Tells CF Pages which paths go to the function vs. static files
│   ├── css/
│   │   └── deckspace.css    # All styles — OG MySpace design language
│   ├── js/
│   │   └── app.js           # Vanilla JS progressive enhancement (<8KB)
│   └── images/
│       └── placeholder.gif  # 1x1 transparent GIF fallback
├── src/
│   ├── lib/
│   │   ├── auth.js          # Sessions, passwords, CSRF, Turnstile, rate limiting
│   │   ├── db.js            # Supabase client factory + all query helpers
│   │   └── media.js         # R2 upload, validation, magic byte checks
│   ├── routes/
│   │   ├── auth.js          # /login /register /onboarding /logout
│   │   ├── home.js          # / (landing + authenticated dashboard)
│   │   ├── profile.js       # /profile/:username /profile/edit /wall
│   │   ├── people.js        # /people (browse + search)
│   │   ├── events.js        # /events /events/:id /events/create
│   │   ├── photos.js        # /photos /photos/upload /photos/:id
│   │   ├── friends.js       # /friends (requests, list, top friends)
│   │   ├── notifications.js # /notifications
│   │   ├── voyage.js        # /voyage (itinerary page)
│   │   ├── reactions.js     # /react (heart/star/wave toggle)
│   │   ├── admin.js         # /admin (dashboard, reports, users, bulletin, weather)
│   │   └── setup.js         # /setup (first-run bootstrap, only when 0 users exist)
│   └── templates/
│       ├── layout.js        # Base HTML shell, nav, helpers: esc(), relTime(), fmtDate()
│       ├── components.js    # Reusable HTML components: module(), photoThumb(), etc.
│       └── icons.js         # Inline SVG icon library (stroke-based, 24×24 viewBox)
├── db/
│   ├── schema.sql           # Full PostgreSQL schema — run this first in Supabase
│   ├── seed_demo.sql        # SQL seed for Shattered Shores demo data
│   ├── fixture.sql          # QA fixture for profile page golden testing
│   └── run_seed.mjs         # Node script to run seed via Supabase Management API
├── supabase/
│   └── migrations/
│       └── 002_phase2.sql   # Phase 2 migration: status_text, reactions, voyage_days
├── docs/                    # This documentation
├── wrangler.toml            # Cloudflare Workers/Pages config
├── package.json             # Dependencies: hono, @supabase/supabase-js, wrangler
├── .dev.vars.example        # Template for local dev environment variables
└── DEPLOY.md                # Step-by-step deployment guide
```

---

## Stack

### Cloudflare Pages + Workers
Every HTTP request hits `functions/[[path]].js`. This is a Cloudflare Pages Function — it runs as a Worker at the edge. Static files in `/public/` are served directly by the CDN (CSS, JS, images). Everything else goes through the Worker.

The framework is **Hono v4**, a lightweight edge-first router. Routes are split across modules and mounted at `/` in the main entry point.

### Supabase (PostgreSQL)
All data lives in Supabase. The database uses a dedicated `deckspace` schema — everything is namespaced, so multiple apps can share one Supabase project without collision.

**The Worker always uses the service role key**, which bypasses Row Level Security. RLS is enabled on all tables but the Worker is the only entry point — the anon key is never exposed to browsers.

The Supabase client is configured with `db: { schema: 'deckspace' }` so all queries default to the right schema without prefixing.

### Cloudflare R2
Photo uploads go to an R2 bucket (`deckspace-media`). Files are stored with deterministic keys:
```
photos/{sailingId}/{userId}/{uuid}.{ext}    ← original
thumbs/{sailingId}/{userId}/{uuid}_t.{ext}  ← thumbnail (v1: null, falls back to original)
medium/{sailingId}/{userId}/{uuid}_m.{ext}  ← medium (v1: null, falls back to original)
```
In v1, resizing is not done server-side. The original is stored once and served at CSS-constrained size. Phase 2 would add a background Worker for actual resize.

**In the demo**, the R2 bucket is empty. Demo photos use `picsum.photos` absolute URLs stored directly in the `storage_key` field.

### Cloudflare KV
Used for:
- Rate limiting (login attempts, registration, reactions) — keys expire after 120s
- Ship bulletins — JSON blob, 7-day TTL
- Weather widget — JSON blob, set by admin

KV is optional — if not configured, rate limiting is skipped (fail-open) and bulletins/weather are unavailable.

---

## Authentication

### Sessions
- Random 32-byte hex token generated on login
- SHA-256 hash stored in `sessions` table (never the raw token)
- Cookie: `ds_session`, HttpOnly, Secure, SameSite=Lax, 14-day expiry
- On each request: cookie → hash → DB lookup → user object injected into context

### Passwords
PBKDF2 with SHA-256, 100,000 iterations, random 16-byte salt.
Format stored in DB: `pbkdf2:{saltHex}:{hashHex}`

### CSRF
Stateless HMAC-SHA256 tokens. Token = `base64(HMAC(sessionTokenHash + ":" + 30minWindow))`.
Valid for current and previous 30-minute window. Injected as `<input name="_csrf">` in all forms. Skipped for: login, register, onboarding, logout, setup, and multipart (file upload) forms.

### Turnstile (Bot Detection)
Cloudflare Turnstile widget on login and register forms. If `TURNSTILE_SECRET_KEY` is not set, verification is skipped (fail-open). Test keys for local dev are in `.dev.vars.example`.

### Access Windows
Each sailing has `access_opens_at`, `access_closes_at`, and `archive_ends_at` timestamps.
- Before `access_opens_at` → registration blocked
- After `access_closes_at` → read-only archive mode (no posting)
- After `archive_ends_at` → fully closed

For the demo sailing, all dates are permissive (effectively always active).

---

## Database Schema

All tables live in the `deckspace` schema.

### Core Tables

| Table | Purpose |
|---|---|
| `sailings` | One row per voyage. Everything is scoped to a sailing via `sailing_id`. |
| `users` | One account per guest per sailing. Has `role` (passenger/moderator/admin). |
| `sessions` | Server-side session tokens (hashed). |
| `profiles` | Public identity: avatar, about me, hometown, vibe_tags, status_text, theme. |

### Social Tables

| Table | Purpose |
|---|---|
| `friendships` | Bidirectional connections with status: pending/accepted/declined/blocked |
| `top_friends` | Ordered list (position 1–8) of highlighted friends per user |
| `wall_posts` | Public notes left on a user's profile page |
| `guestbook_entries` | Lighter-weight notes (500 char max) — "thanks for the add" style |

### Content Tables

| Table | Purpose |
|---|---|
| `events` | Onboard events. `event_type`: official or user-created. Has RSVP count trigger. |
| `event_rsvps` | Guest RSVPs (going/interested/not_going). Trigger keeps `events.rsvp_count` in sync. |
| `event_comments` | Comments on events |
| `albums` | Photo album containers |
| `photos` | Individual photos with storage keys, captions. Has album photo_count trigger. |
| `photo_comments` | Comments on photos |

### Engagement / Admin Tables

| Table | Purpose |
|---|---|
| `reactions` | Heart/star/wave reactions on wall posts, photos, comments |
| `reaction_counts` | View: aggregated reaction counts per target |
| `notifications` | In-app notifications (friend request, wall post, comment, etc.) |
| `reports` | Guest-submitted content reports |
| `moderation_actions` | Log of every admin action taken |
| `audit_logs` | Immutable security log |
| `voyage_days` | Itinerary rows: date, port, arrive/depart times, notes |

### Key Views
- `accepted_friendships` — accepted friendships from either direction
- `reaction_counts` — hearts/stars/waves aggregated per target

### Phase 2 Migration (`002_phase2.sql`)
Adds three things not in the original schema:
1. `profiles.status_text` — 120-char mood/status line shown on profiles
2. `reactions` table + `reaction_counts` view
3. `voyage_days` table

**This migration must be run after `schema.sql` on any fresh install.**

---

## Environment Variables

Set via `wrangler pages secret put <KEY> --project-name=deckspace` (survives deploys).
**Never use the Cloudflare dashboard plain_text type — those get wiped on every `wrangler pages deploy`.**

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | `https://{ref}.supabase.co` |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key (JWT) |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key — used for all DB ops |
| `JWT_SECRET` | Yes | Random 40+ char string for session signing |
| `TURNSTILE_SITE_KEY` | Yes | Cloudflare Turnstile site key (rendered in forms) |
| `TURNSTILE_SECRET_KEY` | Yes | Cloudflare Turnstile secret key (verified server-side) |
| `SAILING_ID` | Yes | UUID of the active sailing row in the database |
| `R2_PUBLIC_URL` | Yes | Public CDN URL for the R2 bucket, no trailing slash |
| `ENVIRONMENT` | No | `development` shows stack traces; `production` hides them |

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in values.
Use Turnstile test keys for local dev (always-pass):
- Site key: `1x00000000000000000000AA`
- Secret key: `1x0000000000000000000000000000000AA`

---

## Content Security Policy

Defined in `functions/[[path]].js`. Current policy:

```
default-src 'self'
script-src 'self' https://challenges.cloudflare.com
style-src 'self' 'unsafe-inline'
img-src 'self' data: {R2_PUBLIC_URL} https://ui-avatars.com https://picsum.photos https://fastly.picsum.photos
frame-src https://challenges.cloudflare.com
connect-src 'self'
font-src 'self'
object-src 'none'
base-uri 'self'
form-action 'self'
```

`ui-avatars.com` and `picsum.photos` are in the CSP for demo purposes. In production with real R2-hosted avatars and photos, these can be removed.

---

## Routes Reference

### Public Routes
| Route | Description |
|---|---|
| `GET /` | Landing page (logged out) or dashboard (logged in) |
| `GET /login` | Login form |
| `POST /login` | Authenticate |
| `GET /register` | Registration form |
| `POST /register` | Create account |
| `POST /logout` | Destroy session |
| `GET /onboarding` | Post-registration profile setup |
| `GET /health` | JSON health check `{"ok":true}` |
| `GET /setup` | First-run bootstrap (only when 0 users exist) |

### Authenticated Routes
| Route | Description |
|---|---|
| `GET /profile/:username` | View profile |
| `GET /profile/edit` | Edit own profile |
| `POST /profile/avatar` | Upload avatar (multipart) |
| `GET /people` | Browse/search guests |
| `GET /events` | Events schedule |
| `GET /events/:id` | Event detail + comments + RSVPs |
| `POST /events/:id/rsvp` | Toggle RSVP |
| `GET /photos` | Photo grid |
| `GET /photos/:id` | Photo detail + comments |
| `POST /photos/upload` | Upload photo |
| `GET /voyage` | Voyage itinerary |
| `GET /friends` | Friend requests + friends list |
| `GET /notifications` | Notification center |
| `POST /react` | Toggle reaction |
| `GET /report` | Report content form |
| `POST /report` | Submit report |

### Admin Routes (admin/moderator role only)
| Route | Description |
|---|---|
| `GET /admin` | Dashboard with stats |
| `GET /admin/reports` | Content reports queue |
| `GET /admin/users` | User lookup |
| `POST /admin/users/:id/suspend` | Suspend user |
| `POST /admin/users/:id/ban` | Ban user |
| `GET /admin/bulletin` | Edit ship bulletin |
| `GET /admin/weather` | Edit weather widget |
| `GET /admin/voyage` | Edit voyage schedule |
| `GET /admin/demo` | Demo setup page |

---

## Key Code Patterns

### `absUrl(cdnBase, key)`
Exported from `src/templates/components.js`. Handles both relative R2 keys and absolute URLs (picsum, ui-avatars, etc.):
```js
function absUrl(cdnBase, key) {
  if (!key) return null;
  return key.startsWith('http') ? key : `${cdnBase || ''}/${key}`;
}
```
**Use this everywhere an image URL is constructed. Never use raw `${cdnBase}/${key}` concatenation.**

### `q(queryPromise)`
Thin Supabase error wrapper in `src/lib/db.js`. Throws a `DbError` if the query returns an error, so routes don't need to check `{ data, error }` everywhere.

### CSRF in forms
All POST forms must include `${csrfField(c)}` or a manual `<input type="hidden" name="_csrf" value="${csrf}">`. The CSRF middleware in `functions/[[path]].js` validates it on every non-exempt POST.

### `layoutCtx(c, { title, user, sailing, body, activeNav })`
Renders the full HTML page. Takes the Hono context `c` to pull the CSRF token and notif count automatically.

---

## Deployment

```bash
# Install dependencies
npm install

# Deploy to Cloudflare Pages (main branch = production alias)
CLOUDFLARE_API_TOKEN=your_token npx wrangler pages deploy public --project-name=deckspace --branch=main

# Set a secret env var (survives deploys)
CLOUDFLARE_API_TOKEN=your_token npx wrangler pages secret put SUPABASE_SERVICE_KEY --project-name=deckspace
```

See `DEPLOY.md` for full step-by-step setup including Supabase, R2, and Turnstile.

---

## Known Caveats / V1 Limitations

1. **No server-side image resizing.** Photos are stored as-is. Thumb/medium keys are null; everything falls back to the original. Cloudflare Image Resizing can handle this at CDN level if enabled on the zone.
2. **No email.** Login codes are distributed by the organizer outside the system. There is no forgot-password flow.
3. **No realtime.** Notifications are polled on page load. No WebSocket or SSE.
4. **KV is optional.** Rate limiting, bulletins, and weather require a KV namespace binding. Without it, those features silently no-op.
5. **R2 binding required for uploads.** If `MEDIA_BUCKET` is not bound, the upload endpoint returns a 503 with a clear error message.
