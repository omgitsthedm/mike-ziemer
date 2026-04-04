# DESIGN.md — Deckspace Visual Doctrine

**This document is authoritative. It supersedes personal taste, design trends, and "improvements."**

---

## The One-Sentence Test

Open a Deckspace profile page. If a person who used MySpace in 2004–2007 does not immediately think *"this is basically old MySpace on a cruise,"* the build has failed.

If that test passes, everything else is negotiable. If it fails, nothing else matters.

---

## What We Are Building

Deckspace is a near-exact visual recreation of OG MySpace — not a modern app with vintage accents, not a "retro-inspired" UI, not a design system that nods to the past. It is the real thing, adapted for:

- mobile screens (responsive, not redesigned)
- bad internet (technical implementation only — the visual language stays)
- safety and moderation (behavioral differences only)

The product should feel like someone found a time machine, drove it to 2006, abducted MySpace, and put it on a cruise ship.

---

## The Five Non-Negotiables

These are not preferences. These are pass/fail criteria.

### 1. Blue navigation bar

The top nav must be **deep blue** — `#003399` to `#002277` gradient, 2px border on the bottom. White text links at 11px. No exceptions. No gray nav. No transparent nav. No dark-mode nav.

If the nav bar is any color other than deep blue, it is wrong.

```
#ds-nav { background: linear-gradient(to bottom, #003399 0%, #002277 100%); }
```

### 2. Orange section headers

Every content module must have an **orange gradient header bar** — `#ff7722` to `#dd5500`. White bold uppercase text. No exceptions. No gray headers. No blue headers on profile modules (blue header variant is only for event detail headers). No borderless section labels.

If a module looks like a modern "card component," it is wrong.

```
.ds-module-header { background: linear-gradient(to bottom, #ff7722 0%, #dd5500 100%); }
```

### 3. Two-column profile layout

The profile page must have the **exact OG MySpace column structure**:
- Left column: ~200px — profile photo, contact box, details, links
- Right column: everything else

On mobile: left column collapses to a compact strip at the top, right column goes full width beneath it. The column structure is not abandoned on mobile — it is compressed.

If a profile page looks like a single-column layout on desktop, it is wrong.

### 4. Dense, compact spacing

The original MySpace had almost no dead space. Everything was packed. The font was 12px. Boxes were tight. Borders were visible everywhere.

Deckspace spacing rules:
- Module margin-bottom: `8px` (max)
- Module internal padding: `6px`
- Border: `1px solid #cccccc` on every module
- Font size: `12px` body, `11px` secondary, `10px` tertiary
- Gap between friend grid items: `4px`

**If it looks airy, it is wrong. If it looks "clean," it is wrong. If someone describes it as "modern," it is wrong.**

### 5. Visible borders and boxes

Everything is boxed. The original MySpace was built on HTML tables and visible borders. We replicate that feeling with CSS — explicit borders on every module, every box, every table cell.

No borderless sections. No "floating card" shadows. No soft gray containers without explicit 1px borders.

---

## Profile Page Anatomy

This is the most important page in the product. It must match this anatomy exactly.

```
┌─────────────────────────────────────────────────────────────┐
│  BLUE NAV BAR (sticky)                                       │
│  [Logo] [Home] [People] [Events] [Photos]    [Hi, Name] [+] │
├─────────────────────────────────────────────────────────────┤
│  SAILING BAR (ship name, sailing name)                       │
├──────────────────────────┬──────────────────────────────────┤
│  LEFT COLUMN (200px)     │  RIGHT COLUMN (remaining)        │
│                          │                                   │
│  ┌────────────────────┐  │  ┌──────────────────────────┐    │
│  │  [PHOTO 160x160]   │  │  │ ORANGE: About Me         │    │
│  │  Display Name      │  │  │ bio text here...         │    │
│  │  @username         │  │  └──────────────────────────┘    │
│  │  ● Online Now      │  │                                   │
│  └────────────────────┘  │  ┌──────────────────────────┐    │
│                          │  │ ORANGE: Who I'd Like to  │    │
│  ┌────────────────────┐  │  │ Meet                     │    │
│  │ ORANGE: Contacting │  │  │ text here...             │    │
│  │ [+ Add Friend]     │  │  └──────────────────────────┘    │
│  │ [Write on Wall]    │  │                                   │
│  │ [Sign Guestbook]   │  │  ┌──────────────────────────┐    │
│  └────────────────────┘  │  │ ORANGE: Friend Space     │    │
│                          │  │ [23 friends] [View All]  │    │
│  ┌────────────────────┐  │  │ [img][img][img][img]     │    │
│  │ ORANGE: Links      │  │  │ [img][img][img][img]     │    │
│  │ View My Photos     │  │  └──────────────────────────┘    │
│  │ My Events          │  │                                   │
│  │ URL: /profile/xyz  │  │  ┌──────────────────────────┐    │
│  └────────────────────┘  │  │ ORANGE: Wall Posts       │    │
│                          │  │ [avatar] Name: text...   │    │
│  ┌────────────────────┐  │  │ [avatar] Name: text...   │    │
│  │ ORANGE: Details    │  │  │ ──────────────────────── │    │
│  │ Hometown: ...      │  │  │ [post form]              │    │
│  │ Interests: ...     │  │  └──────────────────────────┘    │
│  │ Member since: ...  │  │                                   │
│  └────────────────────┘  │  ┌──────────────────────────┐    │
│                          │  │ ORANGE: Guestbook        │    │
│  ┌────────────────────┐  │  │ [avatar] Name: text...   │    │
│  │ ORANGE: Profile    │  │  └──────────────────────────┘    │
│  │ Song               │  │                                   │
│  │ Song Title         │  │                                   │
│  │ Artist Name        │  │                                   │
│  │ [▶ Play]           │  │                                   │
│  └────────────────────┘  │                                   │
│                          │                                   │
│  ┌────────────────────┐  │                                   │
│  │ ORANGE: Vibes      │  │                                   │
│  │ [karaoke][trivia]  │  │                                   │
│  └────────────────────┘  │                                   │
└──────────────────────────┴──────────────────────────────────┘
```

Every element in this diagram must be present on a complete profile. None are optional decorations — they are all required anatomy.

---

## Color System

These values are locked. Do not change them. Do not "harmonize" them with a modern palette.

| Role | Value | Notes |
|---|---|---|
| Nav bar (dark) | `#003399` | Top gradient stop |
| Nav bar (light) | `#002277` | Bottom gradient stop |
| Secondary blue | `#336699` | Sailing bar, blue module headers |
| Light blue bg | `#dce9f5` | Vibe tag backgrounds, input focus |
| Section header (orange, light) | `#ff7722` | Top gradient stop |
| Section header (orange, dark) | `#dd5500` | Bottom gradient stop |
| Body background | `#f5f5f5` | Page background |
| Module background | `#ffffff` | Inside every module |
| Border | `#cccccc` | Module and element borders |
| Border dark | `#999999` | Avatar borders, input borders |
| Body text | `#333333` | Primary copy |
| Secondary text | `#666666` | Timestamps, hints |
| Link | `#003399` | Blue links everywhere |
| Link hover | `#cc5200` | Orange hover (MySpace classic) |
| Online indicator | `#00aa00` | Green dot |
| Error | `#cc0000` | Form errors |
| Success | `#006600` | Success states |

---

## Typography

| Context | Size | Weight | Color |
|---|---|---|---|
| Body | 12px | normal | `#333` |
| Module headers | 11px | bold | `#ffffff` |
| Nav links | 11px | normal | `#ccddff` |
| Display names | 14px | bold | `#000000` |
| Timestamps | 10px | normal | `#666666` |
| Vibe tags | 10px | normal | `#003399` |
| Comment author | 11px | bold | `#003399` |
| Comment body | 12px | normal | `#333` |

Font: `Arial, Helvetica, sans-serif` — always. No Google Fonts. No system-ui. No custom typefaces.

---

## Module Anatomy (required structure)

Every content section uses this structure without exception:

```html
<div class="ds-module">
  <div class="ds-module-header">
    <span>Section Title</span>
    <span><a href="...">Optional right link</a></span>
  </div>
  <div class="ds-module-body">
    <!-- content -->
  </div>
</div>
```

No section may appear without an orange header bar. No section may have an invisible or borderless container. A bare `<div>` with a title is not a module — it is drift.

---

## What "Drift" Looks Like

Drift is when the product gradually stops looking like OG MySpace and starts looking like a modern social app. It happens through small, individually defensible decisions that collectively ruin the aesthetic.

**Drift patterns to catch and reverse:**

| What you see | What it really is | Fix |
|---|---|---|
| Rounded corners on modules | Modern card UI | Remove `border-radius`. Modules are square. |
| Large line-height (1.6+) | Modern readability standards | Cap at 1.4 |
| Box shadows instead of borders | Material Design / card trend | Remove shadows, add explicit `1px solid #ccc` |
| Generous padding (16px+) | Bootstrap-era defaults | Max 8px padding in modules, 6px preferred |
| "Clean" nav without visible links | Modern minimal nav | Add more visible nav links, not fewer |
| Avatar with rounded corners | iOS/modern avatar styling | Square avatars with `border: 1px solid #ccc` |
| Progress bars, badges, level indicators | Gamification | Not in scope |
| Gradient-on-gradient backgrounds | Design trend | Background is flat `#f5f5f5` |
| Full-width section containers | Stripe/SaaS aesthetic | Max 960px, two-column |
| Toast notifications | Modern web app pattern | Use `ds-flash` only |
| Icons replacing text links | Icon-first design | Text links are the default, icons are supplements |
| Empty states with large illustrations | Empty state design trend | Short italic text only |
| Skeleton loading states | Perceived performance theater | Not in v1. Show content or nothing. |
| Infinite scroll | Feed engine behavior | Hard pagination with prev/next links |

---

## Mobile Behavior

The profile does not become a single-column SPA on mobile. It compresses but preserves structure.

**Mobile profile adaptations (600px and below):**
- Left column stacks above right column
- Profile photo block goes horizontal (photo left, name/status right) at 80px photo size
- Friend grid stays 4-column but uses percentage widths
- Module bodies reduce padding to 4px
- Nav collapses to horizontal scroll with smaller 10px links
- All buttons remain full-width touch targets (min 44px height)

**What does NOT change on mobile:**
- Orange section headers
- Blue nav bar
- Module structure (header + body)
- Border visibility
- Font sizes (do not bump up to 16px+ "for mobile" — stay dense)
- Two-column profile structure on tablet (768px+)

---

## Performance Constraints (Visual Implications)

Every visual decision must survive these conditions:

- 200ms ping
- 1 Mbps throughput
- 20% packet loss
- 50 concurrent users on the ship network
- Mid-session disconnection with reconnect

**Visual rules that follow from this:**

1. **No background images on modules.** CSS gradients only — no external image assets for UI chrome.
2. **Avatars must load independently of text content.** Profile names and bios must render immediately even if avatar fetch fails.
3. **Photo grid uses `data-src` lazy loading always.** No photo grid should block page render.
4. **Friend grid thumbnails: 60x60px max.** Never larger in the grid view.
5. **Comment sections are paginated.** Never load more than 20 comments on first render.
6. **The page must be readable without any JavaScript executing.** JS is progressive enhancement only.

---

## The Profile Song Rule

Profile song = tap to play, never autoplay.

The music player must:
- Visually exist on all profiles that have a song set
- Be clearly labeled with song title and artist
- Require an explicit user tap/click to start
- Show ▶ Play / ⏸ Pause states
- Include a note: "(tap to play — no autoplay)"
- Never preload the audio file on page load

This is both a UX rule and a bandwidth rule. Ship internet is not your personal Spotify session.

---

## What the Archive Banner Must Communicate

When Deckspace enters archive/read-only mode, the banner must convey:

1. The party is over — the sailing has ended
2. The scrapbook is still open — you can still look at everything
3. There is a closing date — it is specific, not vague
4. Writing is disabled — buttons are gone, not grayed out

The tone should feel like: *"The ship has docked. We're keeping the lights on for one more week."*

Draft copy: **"Deckspace is now in Archive Mode. The sailing has ended, but your memories are still here. This community closes on [date]."**

---

## Theme System Boundaries

Phase 1 themes are color palette swaps only. They may change:
- Module header gradient colors
- Nav bar color
- Link color
- Vibe tag colors

They must **not** change:
- Layout structure
- Font sizes
- Spacing values
- Module anatomy
- Border presence

A theme is a color filter applied over the same structure. It is not a layout change. A user on the `night` theme still has the same two-column profile, the same module headers, the same friend grid — just in different colors.

---

## Reference: OG MySpace Profile Visual Landmarks

When QAing any profile page against this doctrine, verify these specific items exist and look correct:

- [ ] Top nav is blue with white links
- [ ] Profile photo is square, 160x160, in the left column, upper area
- [ ] Display name is bold, 14px, directly below or beside photo
- [ ] Online indicator is visible if user is active
- [ ] Contact/action box is in left column with labeled action buttons
- [ ] Profile URL appears in left column
- [ ] Details table shows hometown / interests in left column
- [ ] "About Me" is an orange-headed module in the right column
- [ ] "Friend Space" is an orange-headed module with a 4x2 thumbnail grid
- [ ] Friend count appears above the friend grid
- [ ] Wall posts have author avatars, author name as a link, and timestamp
- [ ] Wall post form is at the bottom of the wall module
- [ ] Guestbook is a separate orange-headed module below wall posts
- [ ] All module headers are orange gradient
- [ ] All module borders are 1px solid #ccc
- [ ] Font throughout is Arial 12px
- [ ] Page background is light gray (#f5f5f5)
- [ ] Module backgrounds are white (#ffffff)

If any of these are missing or wrong, the profile page has not shipped.

---

## Questions to Ask During Any UI Review

Before merging any visual change, ask:

1. Does the profile page still immediately read as OG MySpace?
2. Did any spacing get more generous without a hard reason?
3. Did any border disappear?
4. Did any module header change from orange?
5. Did the nav bar stay blue?
6. Did any font get bigger or lighter?
7. Does it look "cleaner" than it did before? (If yes: why? Is that justified?)
8. Does it still work with images turned off?
9. Does it still work at 300kbps?
10. Is there any infinite scroll anywhere?

If the answer to question 7 is "because it looks better," that is not sufficient justification. The correct visual target is deliberately dense, borderful, and old-internet in feeling. "Better" by modern standards is drift.

---

*This document lives alongside the code and must be updated when doctrine changes — which should be rare.*

*Last updated: initial build*
