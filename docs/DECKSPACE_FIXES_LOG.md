# Deckspace — Fixes & Session Log

Record of every issue found and fixed during the demo build session.

---

## Infrastructure Fixes

### Env vars wiped by deploy
**Problem:** Plain_text env vars set via the Cloudflare dashboard API get erased every time `wrangler pages deploy` runs.
**Fix:** All env vars must be set via `wrangler pages secret put KEY --project-name=deckspace`. Secrets survive deploys. Plain_text does not.

### `main.deckspace.pages.dev` 404 / wrong content
**Problem:** The `main` branch alias was stuck pointing to an old preview deployment (`b5191f7a`).
**Fix:** Deleted the stale deployment with `?force=true` via CF API, changed production branch back to `claude/deckspace-pdr-IhYsR`, deployed to `main` branch, which automatically received the `main.deckspace.pages.dev` alias.

---

## Login / Auth Fixes

### Login always returned "Please complete the verification challenge"
**Problem:** The homepage landing page login form had no Cloudflare Turnstile widget rendered. The server required a Turnstile token (because `TURNSTILE_SECRET_KEY` was set), but the form never sent one.
**Fix:** Added `siteKey` parameter to the `landingPage()` function in `src/routes/home.js`. Passed `siteKey: c.env.TURNSTILE_SITE_KEY` at both call sites. Added Turnstile widget HTML and script inline in the form.

---

## Database Fixes

### `/people` returned 500 error
**Problem:** The `status_text` column was missing from the `profiles` table. The Phase 2 migration (`002_phase2.sql`) had never been run.
**Fix:** Ran the migration via the Supabase Management API. Migration adds `status_text`, `reactions`, `reaction_counts`, and `voyage_days`.

### `iamdavidmarsh` password
**Problem:** The demo account password was unknown.
**Fix:** Generated a new PBKDF2 hash for `hollywood123` using Node.js Web Crypto API and PATCH'd the `password_hash` field directly via Supabase REST API.

---

## UI / Rendering Fixes

### Events page showed raw JavaScript function strings
**Problem:** `CAT_ICONS` in `src/routes/events.js` maps category names to arrow functions. The template used `${icon}` (stringifying the function) instead of `${icon()}` (invoking it). Every icon cell showed text like `() => ic.users(14)`.
**Fix:** Changed all icon usages in the event row template from `${icon}` to `${icon()}`.

### Top 8 events in sidebar not clickable
**Problem:** The Top 8 list in the events page left rail was hardcoded as plain `<li>` text with no links.
**Fix:** Changed `top8Items` from a string array to an object array with `{ title, id }`, and wrapped each item in `<a href="/events/{id}">`.

### Photos page blank
**Problem:** All 5 photos in the database had `thumb_key: null` and `medium_key: null`. The R2 bucket is empty. `photoThumb()` component didn't handle null keys gracefully.
**Fix:** Updated all 5 photo records in the DB to use `picsum.photos` seed URLs as absolute URLs stored in `storage_key`. Updated `photoThumb()` and photo detail view to support absolute URLs.

### Voyage page empty
**Problem:** `voyage_days` table existed (from Phase 2 migration) but had no rows.
**Fix:** Seeded 5 voyage days via Supabase REST API (management API returned 403): Miami embarkation, At Sea, Nassau, Great Stirrup Cay, Miami disembarkation.

---

## Avatar Fixes

### All avatars showed broken image icons
**Problem (round 1):** Profile `avatar_url` and `avatar_thumb_url` fields were null for all users.
**Fix (round 1):** Set all 12 profiles to DiceBear pixel-art SVG URLs (`https://api.dicebear.com/9.x/pixel-art/svg?seed={username}&size=60`). Added DiceBear to CSP `img-src`.

**Problem (round 2):** `home.js`, `friends.js`, and `events.js` were still constructing avatar URLs with raw `${cdnBase}/${key}` string concatenation. When `key` is an absolute URL like `https://api.dicebear.com/...`, this produces `https://pub-xxx.r2.dev/https://api.dicebear.com/...` — a broken URL.
**Fix (round 2):** Exported `absUrl(cdnBase, key)` from `components.js` (was previously a private function). Imported and applied it in `home.js`, `friends.js`, and `events.js`.

**Problem (round 3):** DiceBear SVG API was unreliable — images consistently failed to load.
**Fix (round 3):** Switched all 12 profiles to `ui-avatars.com` letter-tile avatars. Updated CSP to allow `https://ui-avatars.com`. Format: `https://ui-avatars.com/api/?name={Name}&background={hex}&color=ffffff&bold=true&size={N}`.

---

## Event Cover Image Fixes

### Event detail page cover images not loading
**Problem:** `eventDetailPage()` in `src/routes/events.js` constructed the cover image URL with `${cdnBase}/${event.cover_image_url}` directly (not using `absUrl`). Absolute picsum URLs were broken.
**Fix:** Imported `absUrl` into events.js, replaced the raw concatenation with `absUrl(cdnBase, event.cover_image_url)`.

### Attendee avatars on event detail broken
**Problem:** Same issue — `${cdnBase}/${a.users.profiles.avatar_thumb_url}` raw concatenation.
**Fix:** Replaced with `absUrl(cdnBase, a.users?.profiles?.avatar_thumb_url)`.

---

## The `absUrl` Rule

**Any time an image URL is built from a database value, use `absUrl(cdnBase, key)` from `components.js`.**

```js
// WRONG — breaks absolute URLs:
const url = `${cdnBase}/${key}`;

// CORRECT — handles both R2 keys and absolute URLs:
const url = absUrl(cdnBase, key);
```

The function:
```js
export function absUrl(cdnBase, key) {
  if (!key) return null;
  return key.startsWith('http') ? key : `${cdnBase || ''}/${key}`;
}
```

---

## Git History (this session)

```
ac0c46a  Switch avatars to ui-avatars.com; update CSP
bc95c64  Fix broken avatars: use absUrl() in home, friends, events; link Top 8 events
1a3aa9e  Export absUrl helper; fix event cover/avatar URLs to support absolute paths
b0c62a5  Fix icons, photos, avatars; support absolute CDN URLs throughout
3595a8f  Add Turnstile widget to homepage login form
b88fa71  Remove debug output from /setup error handler
8d7e349  Debug: expose actual error in /setup catch block
2a04bc1  Clean up debug code in /setup, show helpful error when DB not configured
639aced  Debug: check SUPABASE_URL and SAILING_ID values
4d64533  Debug env keys
c61f01a  Add error surfacing to /setup for diagnosis
b9cb03f  Fix button visibility + labels; auto-seed demo users on setup
b3954ab  Add first-run admin setup + 15 demo passengers with wall posts
357a478  Fix login errors: specific messages + reliable HTML parsing
76b75f7  Fix: extract flash text from error responses
e6f1140  Add icons to every module header across all pages
96846b0  Desktop sizing, MySpace blues, copy rewrite, + ship icons
```
