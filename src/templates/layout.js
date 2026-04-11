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
 * @param {string}  [opts.description] — meta description
 * @param {string}  [opts.canonicalUrl] — canonical absolute URL
 * @param {string}  [opts.ogImageUrl]  — Open Graph image absolute URL
 * @param {string}  [opts.currentUrl]  — current absolute request URL
 * @param {string}  [opts.pageHeading] — page H1 text
 * @param {boolean} [opts.showPageHeading] — whether to render layout H1
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
  description = '',
  canonicalUrl = '',
  ogImageUrl = '',
  currentUrl = '',
  pageHeading = '',
  showPageHeading = true,
}) {
  const pageTitle = title
    ? (/\bDeckspace\b/i.test(title) ? title : `${title} | Deckspace`)
    : 'Deckspace';
  const themeId = user?.profiles?.theme_id || 'classic';
  const bodyClass = ['theme-' + themeId, themeClass].filter(Boolean).join(' ');
  const origin = currentUrl ? new URL(currentUrl).origin : '';
  const canonicalHref = canonicalUrl || currentUrl || '';
  const socialImage = ogImageUrl || (origin ? `${origin}/images/deckspace-social.svg` : '/images/deckspace-social.svg');
  const metaDescription = description || defaultMetaDescription(title, sailing);
  const heading = pageHeading || title || 'Deckspace';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#003399">
  <meta name="description" content="${esc(metaDescription)}">
  ${csrfToken ? `<meta name="csrf-token" content="${esc(csrfToken)}">` : ''}
  <title>${esc(pageTitle)}</title>
  ${canonicalHref ? `<link rel="canonical" href="${esc(canonicalHref)}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Deckspace">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="${esc(metaDescription)}">
  ${canonicalHref ? `<meta property="og:url" content="${esc(canonicalHref)}">` : ''}
  <meta property="og:image" content="${esc(socialImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(pageTitle)}">
  <meta name="twitter:description" content="${esc(metaDescription)}">
  <meta name="twitter:image" content="${esc(socialImage)}">
  <link rel="stylesheet" href="/css/deckspace.css">
  <link rel="icon" type="image/png" sizes="64x64" href="/images/deckspace-favicon.png">
  <link rel="apple-touch-icon" href="/images/deckspace-apple-touch.png">
</head>
<body class="${bodyClass}">

<a href="#main-content" class="skip-link">Skip to main content</a>
${renderNav(user, activeNav, notifCount, csrfToken)}
${sailing ? renderSailingBar(sailing, readOnly) : ''}

<main id="main-content" class="ds-main" tabindex="-1">
<div id="ds-page">
  ${showPageHeading ? `<h1 class="sr-only">${esc(heading)}</h1>` : ''}
  ${flash ? flash : ''}
  ${readOnly ? renderArchiveBanner(sailing) : ''}
  ${body}
</div>
</main>
${renderFooter()}

<script src="/js/app.js" defer></script>
</body>
</html>`;
}

/* ============================================================
   TOP NAVIGATION
   ============================================================ */
function renderNav(user, activeNav, notifCount, csrfToken = '') {
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

  const mobileLinks = user
    ? [
        {
          href: '/notifications',
          label: notifCount > 0 ? `${notifCount} Alerts` : 'Alerts',
          icon: ic.bell(13),
          className: notifCount > 0 ? 'nav-mobile-only nav-mobile-highlight' : 'nav-mobile-only',
        },
        {
          href: `/profile/${esc(user.username)}`,
          label: 'Profile',
          icon: ic.user(13),
          className: 'nav-mobile-only',
        },
        ...(user.role === 'admin' || user.role === 'moderator'
          ? [{
              href: '/admin',
              label: 'Admin',
              icon: ic.shield(13),
              className: 'nav-mobile-only nav-mobile-admin',
            }]
          : []),
        {
          href: '/logout',
          label: 'Log Out',
          icon: ic.logOut(13),
          className: 'nav-mobile-only',
          isPost: true,
        }
      ]
    : [{
        href: '/login',
        label: 'Sign In to Deckspace',
        icon: ic.logIn(13),
        className: 'nav-mobile-only nav-mobile-signin',
      }];

  const mobileExtras = mobileLinks.length
    ? `<div class="nav-mobile-divider" aria-hidden="true"></div>${mobileLinks.map(link => link.isPost
        ? `<form method="POST" action="${link.href}" class="nav-mobile-form">
            ${csrfField(csrfToken)}
            <button type="submit" class="${link.className} nav-mobile-button">${link.icon}${link.label}</button>
          </form>`
        : `<a href="${link.href}" class="${link.className}">${link.icon}${link.label}</a>`).join('')}`
    : '';

  const rightSide = user
    ? `<div id="ds-nav-right">
        <span class="nav-user-name">Hi, <strong>${esc(user.display_name)}</strong></span>
        ${notifCount > 0
          ? `<a href="/notifications" class="nav-notif-badge">${ic.bell(12)} ${notifCount}</a>`
          : `<a href="/notifications" class="nav-link-subtle">${ic.bell(12)} Alerts</a>`}
        <a href="/profile/${esc(user.username)}" class="nav-link-subtle">${ic.user(12)} Profile</a>
        ${user.role === 'admin' || user.role === 'moderator' ? `<a href="/admin" class="nav-link-admin">${ic.shield(12)} Admin</a>` : ''}
        <form method="POST" action="/logout" class="nav-inline-form">
          ${csrfField(csrfToken)}
          <button type="submit" class="nav-link-subtle nav-link-button">${ic.logOut(12)} Out</button>
        </form>
      </div>`
    : `<div id="ds-nav-right">
        <a href="/login" class="nav-link-signin">Sign In to Deckspace</a>
      </div>`;

  return `<nav id="ds-nav" role="navigation" aria-label="Main navigation">
  <div id="ds-nav-inner">
    <a href="/" id="ds-logo" aria-label="Deckspace home">
      <img src="/images/deckspace-mark.png" alt="" class="ds-brand-wordmark" width="28" height="28">
      <span class="ds-brand-lockup">
        <span class="ds-brand-name">DeckSpace</span>
        <span class="ds-brand-tag">Cruise Social</span>
      </span>
    </a>
    <button id="nav-toggle" type="button" aria-label="Toggle navigation" aria-controls="ds-nav-links" aria-expanded="false">${ic.menu(18)}</button>
    <div id="ds-nav-links">${links}${mobileExtras}</div>
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
  ${ic.ferry(12)} <strong>${esc(sailing.ship_name)}</strong> &mdash; ${ic.shipWheel(11)} ${esc(sailing.name)}${status}
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
    currentUrl: c.req.url,
    ...opts
  });
}

function defaultMetaDescription(title, sailing) {
  if (sailing?.name && sailing?.ship_name) {
    return `Deckspace is the public-by-design cruise intranet for ${sailing.name} on ${sailing.ship_name}. Meet passengers, follow events, share photos, and keep a short post-cruise scrapbook.`;
  }
  if (title) {
    return `${title} on Deckspace, the public-by-design cruise intranet for meeting passengers, following events, sharing photos, and keeping a short voyage scrapbook.`;
  }
  return 'Deckspace is the public-by-design cruise intranet for meeting passengers, following events, sharing photos, and keeping a short voyage scrapbook.';
}

function renderFooter() {
  return `<footer class="ds-footer">
  <div class="ds-footer-inner">
    <div class="ds-footer-brand">
      <div class="ds-footer-brand-row">
        <a href="/" class="ds-footer-logo-link" aria-label="Deckspace home">
          <img src="/images/deckspace-mark.png" alt="" class="ds-footer-logo" width="24" height="24">
        </a>
        <div class="ds-footer-copy">
          Deckspace is just for this sailing. After the trip, the scrapbook sticks around a little longer, then the lights go out.
        </div>
      </div>
      <a href="https://littlefightnyc.com" class="ds-footer-credit" target="_blank" rel="noreferrer">Designed and Built by Little Fight NYC</a>
    </div>
    <div class="ds-footer-links">
      <a href="/voyage">Voyage</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms &amp; Usage</a>
      <a href="/sitemap">Sitemap</a>
    </div>
  </div>
</footer>`;
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
