# Deckspace — Project Handoff

**Last updated:** April 2026  
**Status:** Live in production  
**Live URL:** https://deckspace.pages.dev  
**Active branch:** `claude/deckspace-pdr-IhYsR`

---

## What This Is

Deckspace is a private social network for cruise passengers — a near-exact recreation of 2005 MySpace, running on a single ship sailing. Passengers sign up, build profiles, post on walls, add friends, RSVP to events, share photos, and send direct messages. When the sailing ends, the site becomes a read-only scrapbook.

The aesthetic is deliberately dense/retro: orange section headers, blue nav bar, 12px Arial, visible 1px borders everywhere, two-column profile layout. See `DESIGN.md` for the full visual doctrine including the 20-point QA checklist.

---

## Where It Lives

### Hosting

| Thing | Value |
|---|---|
| Platform | Cloudflare Pages |
| Project name | `deckspace` |
| Production URL | https://deckspace.pages.dev |
| Active branch | `claude/deckspace-pdr-IhYsR` |
| Deploy command | `npx wrangler pages deploy . --project-name=deckspace --branch=claude/deckspace-pdr-IhYsR` |

Every push to the active branch **does not** auto-deploy. You must run the deploy command manually (credentials are in `.env.local`).

### Credentials (`.env.local` — gitignored)

```
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
R2_ACCESS_KEY_ID=...
R2_S3_ENDPOINT=...
R2_SECRET_ACCESS_KEY=...
```

All other secrets (Supabase keys, JWT secret, Turnstile keys, SAILING_ID, R2_PUBLIC_URL) live in the **Cloudflare Pages dashboard** under Settings → Environment Variables. They are NOT in the repo or `.env.local`.

### Database

- **Platform:** Supabase (same project as "The Green Room")
- **Schema:** `deckspace` (isolated from other projects via Postgres schema)
- **Credentials:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` in CF Pages dashboard
- **Client:** Created per-request in `src/lib/db.js` using service-role key (bypasses RLS — the Worker is the only entry point)

### Storage

- **Platform:** Cloudflare R2
- **Bucket:** `deckspace-media`
- **Binding name:** `MEDIA_BUCKET` (in `wrangler.toml`)
- **Public URL:** `R2_PUBLIC_URL` env var (no trailing slash) — set in CF Pages dashboard

### KV (Cloudflare Workers KV)

Used for:
- Rate limiting: `login:{ip}`, `register:{ip}`, `react:{userId}`, `msg:{userId}`
- Admin bulletin board: `sailing:{SAILING_ID}:bulletin`
- Weather widget: `sailing:{SAILING_ID}:weather`

Binding name: `KV` (set in CF Pages dashboard, not in `wrangler.toml`)

---

## Repository Structure

```
/
├── functions/
│   └── [[path]].js          ← SINGLE ENTRY POINT for all dynamic requests
│                               (Cloudflare Pages Functions catch-all)
│                               Contains: global middleware, CSRF logic,
│                               security headers, route registration
│
├── src/
│   ├── lib/
│   │   ├── auth.js           ← Session management, password hashing,
│   │   │                       CSRF tokens (HMAC-SHA256), rate limiting,
│   │   │                       Turnstile verification, sailing access checks
│   │   ├── db.js             ← Supabase client factory + all DB queries
│   │   │                       (40+ exported query functions)
│   │   └── media.js          ← Image upload: resize, format conversion,
│   │                           R2 upload, magic byte validation
│   │
│   ├── routes/
│   │   ├── auth.js           ← GET/POST /login, /register, /onboarding, /logout
│   │   ├── home.js           ← GET / (landing for guests, dashboard for members)
│   │   ├── profile.js        ← GET/POST /profile/:username, /profile/edit,
│   │   │                       /profile/avatar, /profile/top-friends
│   │   ├── people.js         ← GET /people (browse + search + vibe filter)
│   │   ├── events.js         ← GET /events, /events/:id, /events/create,
│   │   │                       POST RSVP and comments
│   │   ├── photos.js         ← GET /photos, /photos/:id, POST upload/comment/delete
│   │   ├── friends.js        ← POST /friends/request, /accept, /decline, /remove
│   │   ├── messages.js       ← GET /messages (inbox), /messages/:username (thread),
│   │   │                       POST send message
│   │   ├── reactions.js      ← POST /react (toggle heart/star/wave on any content)
│   │   ├── voyage.js         ← GET /voyage (sailing itinerary page)
│   │   ├── notifications.js  ← GET /notifications, POST mark-read
│   │   ├── admin.js          ← All /admin/* routes (see Admin section below)
│   │
│   └── templates/
│       ├── layout.js         ← layout(), layoutCtx(), csrfField(), esc(),
│       │                       relTime(), fmtDate() — page shell + utilities
│       ├── components.js     ← All reusable HTML components:
│       │                       module(), avatar(), profilePhotoBlock(),
│       │                       contactBox(), detailsTable(), songModule(),
│       │                       vibeTagsModule(), friendSpaceModule(),
│       │                       wallModule(), guestbookModule(), commentEntry(),
│       │                       eventCard(), photoThumb(), personRow(),
│       │                       notifItem(), paginator(), reactionBar()
│       └── icons.js          ← ic.* — 30+ stroke SVG icons as JS functions
│                               e.g. ic.user(16), ic.camera(12), ic.logIn(13)
│
├── public/
│   ├── css/
│   │   └── deckspace.css     ← ALL styles (2800+ lines, heavily commented)
│   ├── js/
│   │   └── app.js            ← Client JS: initCsrf(), initNavToggle(),
│   │                           tag-chip inputs, loading button states,
│   │                           photo lazy load, inline PW validation
│   ├── images/
│   │   └── placeholder.gif
│   └── _routes.json          ← CF Pages routing: /api/* → functions, else static
│
├── supabase/
│   └── migrations/
│       └── 002_phase2.sql    ← *** MUST RUN IN SUPABASE SQL EDITOR ***
│                               Creates: messages, reactions, reaction_counts view,
│                               voyage_days tables + profiles.status_text column
│
├── wrangler.toml             ← CF Pages config + R2 binding
├── DESIGN.md                 ← Visual doctrine, 20-point QA checklist, color system
└── .env.local                ← Local dev credentials (gitignored)
```

---

## How It Works (Request Flow)

```
Browser request
    ↓
Cloudflare Pages CDN
    ↓ (dynamic routes)
functions/[[path]].js  ← Hono v4 router, Workers runtime
    ↓
Global middleware (runs on every request):
  1. loadSession()       — reads session cookie, sets c.get('user')
  2. notif + msg counts  — sets c.get('notifCount'), c.get('unreadMessages')
  3. CSRF token gen      — sets c.get('csrfToken') from session hash
  4. CSRF validation     — on all POSTs except /login, /register, /onboarding
  5. Security headers    — CSP, X-Frame-Options, etc.
    ↓
Route handler (one of 12 route modules)
    ↓
layoutCtx(c, opts)     — auto-injects notifCount, unreadMessages, csrfToken
                          into the layout template
    ↓
layout({ title, user, sailing, body, ... })
    ↓
HTML response
```

### Key Pattern: `layoutCtx`

Almost every route returns:
```js
return c.html(layoutCtx(c, {
  title: 'Page Title',
  user,          // optional — controls nav state
  sailing,       // optional — shows sailing bar
  activeNav: 'home',
  body: someHtmlString,
}));
```

`layoutCtx` reads `notifCount`, `unreadMessages`, and `csrfToken` from the Hono context (set by global middleware) so routes don't have to pass them manually.

### Key Pattern: Form Handling

The CSRF middleware reads the request body first (consuming the stream), then stores the parsed form in context. All POST handlers must use this pattern:
```js
const form = c.get('parsedForm') || await c.req.formData();
```
**Never** use just `await c.req.formData()` in a POST handler — the stream has already been consumed by CSRF middleware.

Exception: multipart forms (file uploads) skip CSRF middleware entirely — they can call `c.req.formData()` directly.

### Key Pattern: CSRF Protection

- CSRF tokens are HMAC-SHA256 stateless tokens rotating every 30 minutes
- Generated from the session token hash: `generateCsrfToken(sessionTokenHash)`
- Injected into forms two ways:
  1. **Server-side:** `csrfField(csrfToken)` returns `<input type="hidden" name="_csrf" value="...">`
  2. **Client-side:** `initCsrf()` in `app.js` reads `<meta name="csrf-token">` and auto-injects `_csrf` into all non-multipart forms via MutationObserver
- Skipped on: `/login`, `/register`, `/onboarding`, `/logout`, multipart uploads

---

## Database Schema (Supabase `deckspace` schema)

### Core Tables

| Table | Purpose |
|---|---|
| `sailings` | One row per sailing — ship_name, name, start_date, end_date, access_before_days, archive_after_days |
| `users` | Accounts — username, display_name, email, password_hash, role (passenger/moderator/admin), account_status, activation_status, sailing_id |
| `profiles` | Extended profile data — about_me, hometown, vibe_tags (array), who_id_like_to_meet, social_intent, status_text, avatar_url, avatar_thumb_url, profile_song_* |
| `wall_posts` | Wall/guestbook posts — author_user_id, profile_user_id, body, moderation_status |
| `photo_albums` | Photo albums — owner_user_id, title |
| `photos` | Photos — album_id, r2_key, thumb_r2_key, caption, moderation_status |
| `photo_comments` | Comments on photos |
| `events` | Events — sailing_id, title, description, location, start_at, end_at, event_type, category, rsvp_count, cover_image_url |
| `event_rsvps` | Event RSVPs — event_id, user_id, status (going/maybe/not_going) |
| `event_comments` | Comments on events |
| `friend_requests` | Friend requests — requester_id, requestee_id, status (pending/accepted/declined) |
| `notifications` | In-app notifications — user_id, type, object_type, object_id, actor_id, message, read_at |
| `audit_log` | Admin action log |
| `reports` | User content reports |

### Phase 2 Tables (in `002_phase2.sql` — must be run manually)

| Table | Purpose |
|---|---|
| `messages` | Direct messages — sender_id, recipient_id, body, sailing_id |
| `reactions` | Reactions — user_id, target_type, target_id, reaction (heart/star/wave) |
| `reaction_counts` | VIEW — aggregated counts per target |
| `voyage_days` | Sailing itinerary — sailing_id, day_date, port_name, day_type, arrival_time, departure_time, notes |

### Column Added by Phase 2

- `profiles.status_text` — short mood/status line shown on profile

---

## Authentication & Sessions

- Sessions stored in `sessions` table in Supabase
- Session token: random 32-byte hex, stored as SHA-256 hash in DB
- Cookie: `ds_session`, HttpOnly, SameSite=Lax, Secure
- Session expires: 30 days
- On every request: `loadSession()` middleware checks cookie → DB lookup → attaches user to context
- First login activates pending accounts (`activation_status: 'pending' → 'active'`)
- Sailing access window enforced: `isSailingAccessible(sailing)` checks start/end dates with buffer days

### Rate Limiting

Uses KV with sliding window (per-minute):
- Login: 5 attempts/min per IP
- Register: 3 attempts/min per IP  
- Messages: 10/min per user
- Reactions: 30/min per user

---

## Environment Variables (set in CF Pages dashboard)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (admin — never expose to browser) |
| `JWT_SECRET` | 32+ char random string for session token signing |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (shown in HTML) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret (server-side verification) |
| `SAILING_ID` | UUID of the active `sailings` row in Supabase |
| `R2_PUBLIC_URL` | Public URL of R2 bucket, no trailing slash |
| `KV` | KV namespace binding (rate limiting, bulletin, weather) |

---

## All Routes

### Public (no auth required)
| Route | Handler |
|---|---|
| `GET /` | Landing page (or home if logged in) |
| `GET /login` | Login form |
| `POST /login` | Process login |
| `GET /register` | Register form |
| `POST /register` | Create account → redirect to /onboarding |
| `GET /onboarding` | Profile setup (auth required) |
| `POST /onboarding` | Save onboarding data |
| `GET /logout` | Destroy session |

### Member Pages (auth required)
| Route | Handler |
|---|---|
| `GET /profile/:username` | Profile page |
| `POST /profile/:username/wall` | Post on wall |
| `POST /profile/:username/wall/:id/delete` | Delete wall post |
| `POST /profile/:username/guestbook` | Guestbook entry |
| `GET /profile/edit` | Edit own profile |
| `POST /profile/edit` | Save profile edits |
| `POST /profile/avatar` | Upload avatar (multipart) |
| `POST /profile/top-friends` | Update top friends |
| `GET /people` | Browse passengers (search + vibe filter) |
| `GET /events` | Events schedule (with category filter) |
| `GET /events/:id` | Event detail + comments |
| `GET /events/create` | Create event form |
| `POST /events/create` | Submit event |
| `POST /events/:id/rsvp` | RSVP to event |
| `POST /events/:id/comment` | Comment on event |
| `GET /photos` | Photo grid |
| `GET /photos/:id` | Photo detail + comments |
| `POST /photos/upload` | Upload photo (multipart) |
| `POST /photos/:id/comment` | Comment on photo |
| `POST /photos/:id/delete` | Delete photo |
| `POST /friends/request` | Send friend request |
| `POST /friends/accept` | Accept request |
| `POST /friends/decline` | Decline request |
| `POST /friends/remove` | Remove friend |
| `GET /messages` | Message inbox |
| `GET /messages/:username` | Message thread |
| `POST /messages/:username` | Send message |
| `POST /react` | Toggle reaction (heart/star/wave) |
| `GET /voyage` | Sailing itinerary |
| `GET /notifications` | Notification inbox |
| `POST /notifications/read` | Mark notifications read |

### Admin (role=admin required)
| Route | Handler |
|---|---|
| `GET /admin` | Admin dashboard |
| `GET /admin/reports` | Content reports |
| `POST /admin/reports/:id/resolve` | Resolve report |
| `GET /admin/users` | User management |
| `POST /admin/users/:id/suspend` | Suspend user |
| `POST /admin/users/:id/unsuspend` | Unsuspend user |
| `POST /admin/users/:id/ban` | Ban user |
| `POST /admin/content/:type/:id/remove` | Remove content |
| `POST /admin/content/:type/:id/restore` | Restore content |
| `GET /admin/bulletin` | Manage bulletin board |
| `POST /admin/bulletin` | Post bulletin |
| `POST /admin/bulletin/clear` | Clear bulletin |
| `GET /admin/voyage` | Manage voyage days |
| `POST /admin/voyage/add` | Add voyage day |
| `POST /admin/voyage/:id/delete` | Delete voyage day |
| `GET /admin/weather` | Manage weather widget |
| `POST /admin/weather` | Update weather |
| `POST /admin/weather/clear` | Clear weather |
| `GET /admin/demo` | Demo data seeder |
| `POST /admin/demo/seed` | Seed demo data |

---

## CSS Architecture (`public/css/deckspace.css`)

Single file, ~2900 lines, organized with `/* === SECTION === */` comments:

1. **CSS Variables** — color palette, all values locked (see `DESIGN.md`)
2. **Reset & Base** — box-sizing, body, links, font
3. **Navigation** — `#ds-nav`, `#ds-nav-inner`, hamburger toggle
4. **Sailing Bar** — `#ds-sailing-bar`
5. **Page Layout** — `#ds-page`, `#ds-wrap`, `#ds-sidebar`
6. **Module System** — `.ds-module`, `.ds-module-header`, `.ds-module-body`
7. **Forms** — `.ds-form`, `.ds-input`, `.ds-textarea`, `.ds-btn` variants
8. **Flash Messages** — `.ds-flash` error/success/info states
9. **Profile Page** — two-column layout, photo block, contact box, details table
10. **Friend Grid** — 4-column thumbnail grid
11. **Wall Posts** — `.wall-post`, `.comment-author`, `.comment-text`
12. **Events** — `.event-card`, `.event-cat-icon-block`, category pills
13. **Photos** — `.photo-grid`, `.photo-thumb`
14. **People Browse** — `.person-row`, vibe pills
15. **Home Page** — `.home-grid`, online widget, bulletin board
16. **Messages** — `.message-thread`, `.message-bubble`
17. **Voyage** — `.voyage-day`, `.voyage-today`
18. **Reactions** — `.reaction-bar`, `.reaction-btn`
19. **Landing Page** — `.landing-wrap`, events preview, how-it-works steps
20. **Login Page** — `.access-page`, `.login-instructions`, `.login-help-text`
21. **Register Page** — `.reg-wrap`, `.reg-privacy-badge`, `.reg-time-note`
22. **Admin Pages** — `.admin-*`
23. **Icons** — `.ds-ic` SVG alignment
24. **Themes** — `.theme-ocean`, `.theme-sunset`, `.theme-night`, `.theme-retro-pink`
25. **Animations** — page entrance fade, flash slide, online pulse, transitions
26. **Responsive** — `@media (max-width: 768px)`, `(max-width: 640px)`, `(max-width: 400px)`

---

## Client JavaScript (`public/js/app.js`)

Runs after DOM load. All progressive enhancement — site works without JS.

- `initCsrf()` — reads `<meta name="csrf-token">`, injects `_csrf` hidden fields into all non-multipart forms + MutationObserver for dynamic forms
- `initNavToggle()` — hamburger menu open/close on mobile
- `initTagInputs()` — vibe tag chip inputs (type + Enter to add, click × to remove)
- `initLoadingButtons()` — `data-loading-text` on submit buttons shows loading state
- `initLazyPhotos()` — `data-src` lazy loading for photo grids
- `initInlineValidation()` — `data-validate-username`, `data-pw-source`, `data-pw-confirm` real-time hints on register form

---

## Pending: DB Migration

**`supabase/migrations/002_phase2.sql` has NOT been run in production yet.**

Until it is, these features will error:
- Direct messages (`/messages`)
- Reactions (`/react`)
- Voyage itinerary (`/voyage`)
- Profile `status_text` field

**To run:** Go to Supabase dashboard → SQL Editor → paste and run `supabase/migrations/002_phase2.sql`.

---

## How to Deploy

```bash
# Load credentials
source .env.local  # or export them manually

# Deploy to production branch
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> \
  npx wrangler pages deploy . \
  --project-name=deckspace \
  --branch=claude/deckspace-pdr-IhYsR
```

The deploy uploads all files in the repo root and `public/` as static assets, and `functions/[[path]].js` as the Worker.

### Local Dev

```bash
npm run dev
# or: npx wrangler pages dev . --compatibility-date=2024-09-23
```

You'll need a `.dev.vars` file with all the env vars listed above for local dev.

---

## Key Design Decisions & Gotchas

1. **Single Supabase schema** — all tables are in the `deckspace` Postgres schema, not `public`. The client is initialized with `db: { schema: 'deckspace' }`.

2. **Service-role key only** — no RLS. The Worker is the sole entry point. Never send `SUPABASE_SERVICE_KEY` to the browser.

3. **ReadableStream consumed once** — Cloudflare Workers request bodies can only be read once. CSRF middleware reads and stores the form as `c.set('parsedForm', form)`. All POST handlers use `c.get('parsedForm') || await c.req.formData()`. Multipart (file upload) routes skip CSRF middleware and read directly.

4. **No `layoutCtx` for unauthenticated routes** — `layoutCtx` is safe for any route (it reads context values set by middleware). It's always preferred over `layout()` directly because it auto-injects notification counts, message counts, and CSRF token.

5. **Supabase JS client on Edge** — `createClient()` is called once per request (no connection pool). This is correct for Workers/edge runtimes.

6. **No build step** — the code runs as native ES modules on the Workers runtime. No Webpack, no bundling, no TypeScript compilation. What you write is what runs.

7. **R2 photo keys** — stored as relative keys (e.g. `photos/abc123.webp`). The full URL is `${R2_PUBLIC_URL}/${key}`. Thumbnails are at `thumbs/abc123.webp`.

8. **`SAILING_ID` env var** — this is the single UUID that scopes everything. Change it to point the same codebase at a different sailing. Every DB query uses `eq('sailing_id', c.env.SAILING_ID)`.

9. **Turnstile** — if `TURNSTILE_SITE_KEY` is not set, the Turnstile widget is omitted silently. The server-side check (`verifyTurnstile`) passes if no token is provided and no secret is configured. This means dev environments work without Turnstile.

10. **Weather and bulletin** — KV-backed, admin-managed. Weather data is a JSON blob set by the admin. If KV is not configured or the key doesn't exist, these sections simply don't render.

---

## Feature Status

| Feature | Status |
|---|---|
| User registration + login | Live |
| Profile pages (full MySpace anatomy) | Live |
| Wall posts + guestbook | Live |
| Friend requests | Live |
| Event pages + RSVP | Live |
| Photo upload + gallery | Live |
| People browse + vibe filter | Live |
| Notifications | Live |
| Admin dashboard (reports, users, content moderation) | Live |
| Admin bulletin board | Live |
| Admin weather widget | Live |
| Admin demo data seeder | Live |
| Admin voyage day management | Live |
| Profile themes (ocean, sunset, night, retro-pink) | Live |
| Profile song player | Live |
| Direct messages | **Needs migration 002_phase2.sql** |
| Reactions (heart/star/wave) | **Needs migration 002_phase2.sql** |
| Voyage itinerary page | **Needs migration 002_phase2.sql** |
| Profile status text | **Needs migration 002_phase2.sql** |
| Archive/read-only mode | CSS + copy defined; enforcement via `isSailingReadOnly()` in auth.js |
