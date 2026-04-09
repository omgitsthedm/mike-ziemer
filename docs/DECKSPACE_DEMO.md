# Deckspace — Demo State

Current state of the live demo at `https://main.deckspace.pages.dev`.

---

## Access

**URL:** https://main.deckspace.pages.dev
**Admin login:** `iamdavidmarsh` / `hollywood123`
**Or:** Register a new account directly at the URL

---

## Infrastructure

| Service | Project/Resource | Details |
|---|---|---|
| Cloudflare Pages | `deckspace` | Production branch: `main` → `main.deckspace.pages.dev` |
| Supabase | `gvnktiljqzhjcgxiijlk` | Project: "The Green Room" |
| Supabase schema | `deckspace` | All tables live here |
| R2 Bucket | `deckspace-media` | Bound as `MEDIA_BUCKET` — currently empty |
| CF Account ID | `9fdf312160242e1cbd2c85c34618fcba` | |

---

## Sailing Record

```
ID:         e8fd7444-7d5e-4506-b20f-a2abab7af938
Name:       Deckspace Sailing
Ship:       MS Deckspace
Status:     active
```

---

## Demo Users (12 accounts)

All passwords: `hollywood123`

| Username | Display Name | Role |
|---|---|---|
| `iamdavidmarsh` | iamdavidmarsh | admin |
| `shattered_shores_crew` | Shattered Shores Crew | moderator |
| `kaitlyn_darkwater` | kaitlyn darkwater | passenger |
| `jesse_calvert` | Jesse Calvert | passenger |
| `maya_lowercase` | maya (lowercase) | passenger |
| `blake_harmon` | Blake Harmon | passenger |
| `jamie` | jamie | passenger |
| `devon_mitchell` | Devon Mitchell | passenger |
| `alex_stairwell` | Alex (stairwell) | passenger |
| `sam_top8` | Sam Top8 | passenger |
| `morgan` | Morgan | passenger |
| `taylor_away` | taylor :: away | passenger |

Avatars: `ui-avatars.com` colored letter tiles (blue/orange/red depending on user).

---

## Seeded Content

### Events (32 total)
All events have `picsum.photos` cover images. Themed to Shattered Shores emo cruise concept.
Spread across 4-5 days (April 8–12, 2026).

Categories represented: social, karaoke, deck, dinner, other.

Top 8 events (hardcoded in sidebar, linked to event pages):
1. Missed Call Confessional
2. Battle of the Side Parts
3. Breakup Letter Swap Meet
4. Silent Disco: Internal Monologue Edition
5. Cringe Archive Screening
6. Acoustic Set You Weren't Ready For
7. Away Message Workshop
8. The Deck at 3:17 AM

### Photos (5 total)
All use `picsum.photos` seed URLs (no R2 files). Cruise ship themed:
- Pool/spa deck
- Central Park atrium interior
- Promenade at night
- Water slides
- Aqua Theater

### Voyage Days (5 total)

| Date | Port | Type |
|---|---|---|
| Apr 8, 2026 | Miami, FL | Embarkation (depart 4pm) |
| Apr 9, 2026 | At Sea | Sea Day |
| Apr 10, 2026 | Nassau, Bahamas | Port (8am–5pm) |
| Apr 11, 2026 | Great Stirrup Cay, Bahamas | Port (8am–4pm) |
| Apr 12, 2026 | Miami, FL | Disembarkation (arrive 7am) |

### Wall Posts
18 wall posts between demo users, staggered over the past 48 hours. Conversational — meeting at pool, trivia rematches, karaoke duets, excursion plans.

---

## What Works

- Login and registration
- Home dashboard (Online Now, New Members, recent photos, events)
- All 12 user profiles with avatars
- Events page — icons, cover images, Top 8 sidebar with working links, category filter pills
- Event detail pages with RSVP
- Photos page with 5 demo photos
- Photo detail with comments
- Voyage/itinerary page
- People browser
- Profile editing
- Wall posts
- Friend requests
- Notifications
- Reactions (heart/star/wave)
- Admin panel (dashboard, reports, user management, bulletin, weather, voyage editor)
- Report content flow
- CSRF protection on all forms
- Turnstile bot protection on login/register

---

## What Requires Real Setup

- **Photo uploads**: R2 bucket is empty. Uploads work but display broken until R2 `R2_PUBLIC_URL` is configured and bucket has content.
- **Actual avatars**: Currently using `ui-avatars.com` letter tiles. Real avatars need R2.
- **Weather widget**: Requires KV namespace binding + admin to set it.
- **Ship bulletin**: Requires KV namespace binding.
- **Rate limiting**: Requires KV namespace binding.

---

## Demo Image Strategy

Since the R2 bucket is empty, the demo uses:
- **Avatars:** `https://ui-avatars.com/api/?name={Name}&background={hex}&color=ffffff&bold=true&size={N}`
- **Event covers:** `https://picsum.photos/seed/{slug}/600/300`
- **Photos:** `https://picsum.photos/seed/{slug}/800/600`

These are stored as absolute URLs directly in the database fields that normally hold R2 keys. The `absUrl()` helper in `components.js` detects `http`-prefixed values and passes them through unchanged.

---

## Credentials Summary (Keep Secure)

```
Supabase URL:          https://gvnktiljqzhjcgxiijlk.supabase.co
Supabase Management:   sbp_8b782a8fadd3016c9369f0f207e2c09593b51b80
CF API Token (primary): cfat_X4Wo9k2efjSMZAZn45HXUB3Migm4gMwD9UNxWwief0efbce7
CF Account ID:         9fdf312160242e1cbd2c85c34618fcba
Sailing ID:            e8fd7444-7d5e-4506-b20f-a2abab7af938
```
