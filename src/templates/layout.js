import { ic } from './icons.js';

/**
 * Deckspace — Base HTML Layout
 *
 * All pages render through this layout.
 * Keeps the MySpace-era blue nav bar, sailing context bar,
 * and consistent page wrapper.
 */

/**
 * @param {object} opts
 * @param {string}  opts.title
 * @param {string}  opts.body          — inner HTML content
 * @param {object}  [opts.user]        — current authenticated user
 * @param {object}  [opts.sailing]     — current sailing record
 * @param {string}  [opts.activeNav]   — which nav item is active
 * @param {number}  [opts.notifCount]  — unread notification count
 * @param {string}  [opts.flash]       — flash message HTML
 * @param {boolean} [opts.readOnly]    — post-cruise archive mode
 * @param {string}  [opts.themeClass]  — profile theme CSS class
 */
export function layout({
  title,
  body,
  user = null,
  sailing = null,
  activeNav = '',
  notifCount = 0,
  flash = '',
  readOnly = false,
  themeClass = '',
  csrfToken = '',
}) {
  const pageTitle = title ? `${title} | Deckspace` : 'Deckspace';
  const themeId = user?.profiles?.theme_id || 'classic';
  const bodyClass = ['theme-' + themeId, themeClass].filter(Boolean).join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#003399">
  ${csrfToken ? `<meta name="csrf-token" content="${esc(csrfToken)}">` : ''}
  <title>${esc(pageTitle)}</title>
  <link rel="stylesheet" href="/css/deckspace.css?v=3">
  <link rel="icon" href="/favicon.ico" sizes="any">
</head>
<body class="${bodyClass}">

${renderNav(user, activeNav, notifCount)}
${sailing ? renderSailingBar(sailing, readOnly) : ''}

<div id="ds-page">
  ${flash ? flash : ''}
  ${readOnly ? renderArchiveBanner(sailing) : ''}
  ${body}
</div>

<script src="/js/app.js" defer></script>
</body>
</html>`;
}

/* ============================================================
   TOP NAVIGATION
   ============================================================ */
function renderNav(user, activeNav, notifCount) {
  const NAV_ICONS = { home: ic.home, people: ic.users, events: ic.calendar, photos: ic.camera, voyage: ic.ship };
  const navLinks = user
    ? [
        { href: '/',       label: 'Home',    key: 'home' },
        { href: '/people', label: 'People',  key: 'people' },
        { href: '/events', label: 'Events',  key: 'events' },
        { href: '/photos', label: 'Photos',  key: 'photos' },
        { href: '/voyage', label: 'Voyage',  key: 'voyage' },
      ]
    : [];

  const links = navLinks.map(n => {
    const iconFn = NAV_ICONS[n.key];
    return `<a href="${n.href}" class="${activeNav === n.key ? 'active' : ''}">${iconFn ? iconFn(13) : ''}${n.label}</a>`;
  }).join('');

  const rightSide = user
    ? `<div id="ds-nav-right">
        <span class="nav-user-name">Hi, <strong>${esc(user.display_name)}</strong></span>
        ${notifCount > 0
          ? `<a href="/notifications" class="nav-notif-badge">${ic.bell(12)} ${notifCount}</a>`
          : `<a href="/notifications" class="nav-link-subtle">${ic.bell(12)} Alerts</a>`}
        <a href="/profile/${esc(user.username)}" class="nav-link-subtle">${ic.user(12)} Profile</a>
        ${user.role === 'admin' || user.role === 'moderator' ? `<a href="/admin" class="nav-link-admin">${ic.shield(12)} Admin</a>` : ''}
        <a href="/logout" class="nav-link-subtle">${ic.logOut(12)} Out</a>
      </div>`
    : `<div id="ds-nav-right">
        <a href="/login" class="nav-link-signin">Sign In</a>
      </div>`;

  return `<nav id="ds-nav" role="navigation" aria-label="Main navigation">
  <div id="ds-nav-inner">
    <a href="/" id="ds-logo"><span class="logo-deck">Deck</span><span class="logo-space">space</span></a>
    <button id="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">${ic.menu(18)}</button>
    <div id="ds-nav-links">${links}</div>
    ${rightSide}
  </div>
</nav>`;
}

/* ============================================================
   SAILING BAR
   ============================================================ */
function renderSailingBar(sailing, readOnly) {
  const status = readOnly
    ? ` &mdash; ${ic.anchor(11)} <em>The ship has docked.</em>`
    : ` ${ic.waves(11)}`;
  return `<div id="ds-sailing-bar">
  ${ic.ship(12)} <strong>${esc(sailing.ship_name)}</strong> &mdash; ${esc(sailing.name)}${status}
</div>`;
}

/* ============================================================
   ARCHIVE BANNER
   ============================================================ */
function renderArchiveBanner(sailing) {
  if (!sailing) return '';

  // Calculate days remaining until close
  const now      = new Date();
  const closeAt  = new Date(sailing.archive_ends_at);
  const daysLeft = Math.max(0, Math.ceil((closeAt - now) / 86400000));

  const closeDateStr = closeAt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  const countdownLine = daysLeft === 0
    ? 'This is the last day. The lights go off tonight.'
    : daysLeft === 1
    ? 'One day left. Take a last look around.'
    : `The scrapbook closes in <strong>${daysLeft} days</strong> — on ${closeDateStr}.`;

  return `<div class="archive-banner">
  <strong>The sailing has ended.</strong>
  The ship has docked, but your Deckspace is still here &mdash; read-only, just for a little while longer.
  ${countdownLine}
  New posts, wall comments, and RSVPs are closed.
</div>`;
}

/* ============================================================
   FLASH MESSAGE FACTORY
   Icons give non-English speakers and screen readers an immediate
   visual/semantic cue before reading the message text.
   ============================================================ */
export function flash(type, message) {
  const icons = {
    error:   ic.alertTri(13),
    success: ic.check(13),
    info:    ic.info(13),
  };
  const iconHtml = icons[type] ? `<span class="flash-icon" aria-hidden="true">${icons[type]}</span>` : '';
  return `<div class="ds-flash ${esc(type)}" role="alert" data-dismiss="6000">${iconHtml}${message}</div>`;
}

/* ============================================================
   CONTEXT-AWARE LAYOUT WRAPPER
   Call from route handlers to auto-inject notifCount, unread messages, csrf
   ============================================================ */
export function layoutCtx(c, opts) {
  return layout({
    notifCount: c.get('notifCount') || 0,
    csrfToken:  c.get('csrfToken')  || '',
    ...opts
  });
}

/* ============================================================
   CSRF HIDDEN FIELD
   Inject into every form that POSTs state-changing data.
   ============================================================ */
export function csrfField(csrfToken) {
  return csrfToken ? `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">` : '';
}

/* ============================================================
   HTML ESCAPE
   ============================================================ */
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Render a relative time string ("3 min ago", "2 days ago")
 */
export function relTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/**
 * Format a date for display.
 */
export function fmtDate(dateStr, { time = false } = {}) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  if (time) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
  return d.toLocaleDateString('en-US', opts);
}

