# Deckspace — Product Overview

## What It Is

Deckspace is a **private cruise intranet with a social layer**. It gives every guest on a sailing one place to find everything they need about the voyage — and each other.

It's not a social media app. It's not a PDF. It's a private website that exists only for the duration of the cruise, only for the people on board.

---

## What It Does

### Cruise Information
- **Voyage itinerary** — day-by-day port schedule with arrival/departure times and notes
- **Live weather widget** — ship conditions, updated by the crew via the admin panel
- **Event schedule** — full onboard calendar with categories, times, locations, and RSVPs
- **Ship bulletins** — crew announcements pushed from the admin panel, visible to all guests

### Social Layer
- **Guest profiles** — display name, hometown, vibe tags, about me, status line
- **Top 8** — MySpace-style ordered friends list, up to 8
- **Wall posts** — public notes left on someone's profile
- **Friend connections** — send/accept/decline friend requests
- **Photo sharing** — upload and browse cruise photos with captions and comments
- **Notifications** — in-app feed for friend requests, wall posts, photo comments, event activity
- **People browser** — browse all guests, filter by vibe tags, search by name

### For Organizers
- **Admin dashboard** — stats, moderation queue, recent actions
- **Reports queue** — guests can flag content; admins action it
- **User management** — suspend, unsuspend, ban accounts
- **Bulletin board** — post ship-wide announcements
- **Voyage schedule editor** — manage itinerary days from the admin panel
- **Weather editor** — update ship weather from the admin panel
- **Demo seeding** — one-click to populate the site with demo passengers and content

---

## How Guests Access It

- Guests get a **URL and a login code** tied to their booking
- No app download. No app store. Works on any phone, tablet, or laptop
- Register once, stay logged in for the duration of the sailing (14-day session)
- When the cruise ends, the site flips to **read-only archive mode** — guests can still browse but can no longer post

---

## The Brand Context (Shattered Shores Demo)

The live demo is themed to **Shattered Shores** — an emo/pop-punk cruise concept in the vein of Groove Cruise's "Taking Back Emo" programming. The MySpace-era visual design (2005 aesthetic: orange module headers, blue nav, dense two-column layout, Top 8) is intentional and on-brand for that audience.

For other clients, the branding, ship name, event schedule, and content are all configurable per sailing.

---

## Live Demo

**URL:** https://main.deckspace.pages.dev

**Login:** Register yourself at the link above, or use the demo account:
- Username: `iamdavidmarsh`
- Password: `hollywood123`

---

## Tech at a Glance

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages |
| Runtime | Cloudflare Workers (edge, serverless) |
| Framework | Hono v4 |
| Database | Supabase (PostgreSQL) |
| Media storage | Cloudflare R2 |
| Rate limiting / KV | Cloudflare KV |
| Bot protection | Cloudflare Turnstile |
| Frontend | Vanilla JS, no framework |

One deployment. No servers to manage. Runs at the edge globally.
