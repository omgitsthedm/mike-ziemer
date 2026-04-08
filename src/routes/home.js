/**
 * Deckspace — Home page route
 *
 * GET /
 *
 * The home page is a social bulletin board, not a feed engine.
 * Shows: tonight's events, recent activity snapshot, featured profiles, photos.
 * Must remain lean and fast.
 */

import { Hono } from 'hono';
import { getDb, getEvents, getRecentPhotos, browsePeople, getSailing, getOnlineUsers, getVoyageDays } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { layout, layoutCtx, esc, fmtDate, relTime } from '../templates/layout.js';
import { module, eventCard, photoThumb, personRow } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const home = new Hono();

home.get('/', async (c) => {
  const user    = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';

  // Fetch weather from KV (admin-updated) or use demo data
  const weatherJson = await c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null);
  const weather = weatherJson ? JSON.parse(weatherJson) : null;

  // Unauthenticated: show OG MySpace-style landing page
  if (!user) {
    const [newPeople, publicEvents, voyageDays, bulletinJson, diningJson] = await Promise.all([
      browsePeople(db, c.env.SAILING_ID, { limit: 8 }).catch(() => []),
      db.from('events')
        .select('id, title, location, start_at, event_type, category, rsvp_count')
        .eq('sailing_id', c.env.SAILING_ID)
        .eq('moderation_status', 'visible')
        .eq('visibility', 'public')
        .gte('start_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(10)
        .then(({ data }) => data || [])
        .catch(() => []),
      getVoyageDays(db, c.env.SAILING_ID).catch(() => []),
      c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null),
      c.env.KV?.get(`sailing:${c.env.SAILING_ID}:dining`).catch(() => null),
    ]);

    const bulletin  = bulletinJson  ? JSON.parse(bulletinJson)  : null;
    const dining    = diningJson    ? JSON.parse(diningJson)    : null;

    return c.html(layoutCtx(c, {
      title: 'Deckspace — A Place for Friends on the High Seas',
      body: landingPage({ sailing, cdnBase, newPeople, weather, siteKey: c.env.TURNSTILE_SITE_KEY,
                          publicEvents, voyageDays, bulletin, dining }),
    }));
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Fetch bulletin from KV (admin-posted, short-lived)
  const [bulletinJson, diningJson] = await Promise.all([
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null),
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:dining`).catch(() => null),
  ]);
  const bulletin = bulletinJson ? JSON.parse(bulletinJson) : null;
  const dining   = diningJson   ? JSON.parse(diningJson)   : null;

  // Parallel fetch of all home page data
  const [tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers, voyageDays] =
    await Promise.all([
      // Tonight's events (today only)
      db.from('events')
        .select('id, title, location, start_at, event_type, category, rsvp_count, cover_image_url')
        .eq('sailing_id', c.env.SAILING_ID)
        .eq('moderation_status', 'visible')
        .eq('visibility', 'public')
        .gte('start_at', todayStart.toISOString())
        .lte('start_at', todayEnd.toISOString())
        .order('start_at', { ascending: true })
        .limit(6)
        .then(({ data }) => data || [])
        .catch(() => []),

      // Upcoming events (next 3 days beyond today)
      db.from('events')
        .select('id, title, location, start_at, event_type, category, rsvp_count, cover_image_url')
        .eq('sailing_id', c.env.SAILING_ID)
        .eq('moderation_status', 'visible')
        .eq('visibility', 'public')
        .gt('start_at', todayEnd.toISOString())
        .order('start_at', { ascending: true })
        .limit(4)
        .then(({ data }) => data || [])
        .catch(() => []),

      // Recently active people
      browsePeople(db, c.env.SAILING_ID, { limit: 8 }).catch(() => []),

      // Recent photos
      getRecentPhotos(db, c.env.SAILING_ID, 8).catch(() => []),

      // Recent wall posts (social pulse)
      db.from('wall_posts')
        .select('id, body, created_at, author:users!wall_posts_author_user_id_fkey(username, display_name), target:users!wall_posts_profile_user_id_fkey(username, display_name)')
        .eq('moderation_status', 'visible')
        .order('created_at', { ascending: false })
        .limit(5)
        .then(({ data }) => data || [])
        .catch(() => []),

      // Online now
      getOnlineUsers(db, c.env.SAILING_ID, 10, 8).catch(() => []),

      // Voyage itinerary (for port countdown)
      getVoyageDays(db, c.env.SAILING_ID).catch(() => [])
    ]);

  const body = homePage({
    user, sailing, cdnBase, weather,
    tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers, bulletin, voyageDays, dining
  });

  return c.html(layoutCtx(c, {
    title: 'Home',
    user,
    sailing,
    activeNav: 'home',
    body,
  }));
});

/* ============================================================
   WEATHER WIDGET
   Rendered as a compact module. Data comes from KV or falls back
   to Caribbean demo values so the widget is never empty.
   ============================================================ */
const DEMO_WEATHER = {
  temp_f: 84, temp_c: 29,
  conditions: 'Partly Cloudy',
  wind_knots: 12, wind_dir: 'ENE',
  wave_ft: '2–3',
  icon: 'cloud',
  location: 'Caribbean Sea',
};

const WEATHER_ICON_MAP = {
  sun:       ic.sun,
  sunrise:   ic.sunrise,
  sunset:    ic.sunset,
  cloud:     ic.cloud,
  rain:      ic.cloudRain,
  wind:      ic.wind,
  moon:      ic.moon,
  storm:     ic.cloudRain,
};

function weatherWidget(weather) {
  const w = weather || DEMO_WEATHER;
  const iconFn = WEATHER_ICON_MAP[w.icon] || ic.cloud;

  return module({
    header: `${ic.waves(12)} At Sea`,
    body: `<div class="weather-widget">
  <div class="weather-main">
    <div class="weather-icon-big" aria-hidden="true">${iconFn(28)}</div>
    <div class="weather-temps">
      <span class="weather-temp-f">${w.temp_f}&deg;F</span>
      <span class="weather-temp-c">${w.temp_c}&deg;C</span>
    </div>
  </div>
  <div class="weather-conditions">${esc(w.conditions)}</div>
  <div class="weather-meta">
    <span>${ic.wind(10)} ${w.wind_knots} kts ${esc(w.wind_dir || '')}</span>
    <span>${ic.waves(10)} ${esc(w.wave_ft)} ft</span>
    ${w.location ? `<span>${ic.mapPin(10)} ${esc(w.location)}</span>` : ''}
  </div>
  ${!weather ? `<div class="weather-demo-note">Demo data &mdash; admin can update via Ship Bulletin</div>` : ''}
</div>`
  });
}

/* ============================================================
   DINING & BARS SCHEDULE
   Admin-editable via KV (sailing:ID:dining). Falls back to
   DEMO_DINING modeled on an Icon/Harmony-class mega ship.
   ============================================================ */

// Based on Royal Caribbean Icon-class (5,610 cabins, 20 decks, 40+ dining venues)
const DEMO_DINING = {
  sections: [
    {
      title: 'Dining',
      icon: 'utensils',
      items: [
        { name: 'Main Buffet (Deck 15)',           hours: '6:30am – Midnight' },
        { name: 'Breakfast – Main Dining Room',    hours: '7:30am – 9:30am' },
        { name: 'Lunch – Main Dining Room',        hours: '12:00pm – 1:30pm', note: 'Sea days only' },
        { name: 'Dinner Early Seating',            hours: '5:30pm – 7:00pm' },
        { name: 'Dinner Late Seating',             hours: '8:00pm – 9:30pm' },
        { name: 'Café Promenade',                  hours: '24 hours' },
        { name: 'Room Service',                    hours: '24 hours' },
      ]
    },
    {
      title: 'Bars & Lounges',
      icon: 'glass',
      items: [
        { name: 'Pool Bar (Lido Deck 15)',         hours: '10:00am – 11:00pm' },
        { name: 'Sky Lounge (Deck 17)',            hours: '11:00am – 2:00am',  lastcall: '1:30am' },
        { name: 'Schooner Bar (Deck 5)',           hours: '4:00pm – 2:00am',   lastcall: '1:30am' },
        { name: 'Casino Royale Bar (Deck 4)',      hours: '7:00pm – 3:00am',   lastcall: '2:30am' },
        { name: 'Boleros Latin Bar (Deck 4)',      hours: '6:00pm – 2:00am',   lastcall: '1:30am' },
      ]
    }
  ],
  note: 'Times may vary at sea. Check the Daily Program placed in your cabin each evening.',
};

function diningWidget(dining) {
  const d = dining || DEMO_DINING;

  const sectionsHtml = d.sections.map(section => {
    const rows = section.items.map(item => {
      const lastCallHtml = item.lastcall
        ? `<span class="dining-lastcall">last call ${esc(item.lastcall)}</span>`
        : '';
      const noteHtml = item.note
        ? `<span class="dining-note">${esc(item.note)}</span>`
        : '';
      return `<tr>
  <td class="dining-name">${esc(item.name)}</td>
  <td class="dining-hours">${esc(item.hours)}${lastCallHtml}${noteHtml}</td>
</tr>`;
    }).join('');
    return `<div class="dining-section">
  <div class="dining-section-title">${esc(section.title)}</div>
  <table class="dining-table">${rows}</table>
</div>`;
  }).join('');

  const noteHtml = d.note
    ? `<div class="dining-note-footer">${esc(d.note)}</div>`
    : '';

  return `<div class="dining-widget">${sectionsHtml}${noteHtml}</div>`;
}

/* ============================================================
   PORT COUNTDOWN WIDGET
   Shows the next port stop from voyage_days. Hidden if no data.
   ============================================================ */
function portCountdownWidget(voyageDays) {
  if (!voyageDays || !voyageDays.length) return '';

  const now = new Date();
  // Find the next port day (port_name present, in the future or today)
  const nextPort = voyageDays.find(d => {
    if (!d.port_name) return false;
    const dayDate = new Date(d.day_date + 'T06:00:00'); // arrival ~ 6am
    return dayDate >= now;
  });

  if (!nextPort) return '';

  const arrival = new Date(nextPort.day_date + 'T06:00:00');
  const diffMs  = arrival - now;
  const diffH   = Math.floor(diffMs / 3600000);
  const diffM   = Math.floor((diffMs % 3600000) / 60000);

  let countdownStr;
  if (diffMs <= 0) {
    countdownStr = 'We&rsquo;re here!';
  } else if (diffH < 1) {
    countdownStr = `${diffM}m away`;
  } else if (diffH < 24) {
    countdownStr = `${diffH}h ${diffM}m away`;
  } else {
    const days = Math.floor(diffH / 24);
    const hrs  = diffH % 24;
    countdownStr = `${days}d ${hrs}h away`;
  }

  const descHtml = nextPort.description
    ? `<div class="port-desc">${esc(nextPort.description.slice(0, 120))}</div>`
    : '';

  return module({
    header: `${ic.anchor(12)} Next Port`,
    body: `<div class="port-countdown">
  <div class="port-name">${esc(nextPort.port_name)}</div>
  <div class="port-timer">${ic.clock(14)} ${countdownStr}</div>
  ${descHtml}
  <a href="/voyage" class="port-itinerary-link">View full itinerary &raquo;</a>
</div>`
  });
}

/* ============================================================
   HOME PAGE TEMPLATE
   ============================================================ */
function homePage({ user, sailing, cdnBase, weather, tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers, bulletin, voyageDays, dining }) {
  // Tonight's events module
  const tonightHtml = tonightEvents.length
    ? tonightEvents.map(e => eventCard({ event: e, cdnBase })).join('')
    : `<div class="ds-empty-state">No events scheduled for tonight. <a href="/events/create">Create one!</a></div>`;

  const tonightModule = module({
    header: `${ic.calendar(12)} Tonight's Events`,
    headerRight: `<a href="/events">All Events</a>`,
    body: `<div class="event-list">${tonightHtml}</div>`
  });

  // Upcoming events module
  const upcomingHtml = upcomingEvents.length
    ? upcomingEvents.map(e => eventCard({ event: e, cdnBase })).join('')
    : `<div class="ds-empty-state">No upcoming events yet.</div>`;

  const upcomingModule = module({
    header: `${ic.clock(12)} Upcoming`,
    headerRight: `<a href="/events">Browse All</a>`,
    body: `<div class="event-list">${upcomingHtml}</div>`
  });

  // Social pulse module
  const activityHtml = recentActivity.length
    ? recentActivity.map(post => {
        const actor = post.author;
        const target = post.target;
        return `<div class="activity-item">
  <div class="activity-body">
    <a href="/profile/${esc(actor?.username || '')}">${esc(actor?.display_name || 'Someone')}</a>
    posted on
    <a href="/profile/${esc(target?.username || '')}">${esc(target?.display_name || "someone")}'s</a> wall
    <div class="activity-time">${relTime(post.created_at)}</div>
  </div>
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No activity yet. <a href="/people">Find some friends!</a></div>`;

  const activityModule = module({
    header: `${ic.msgSquare(12)} Social Activity`,
    body: activityHtml
  });

  // New members module
  const peopleHtml = recentPeople.length
    ? recentPeople.slice(0, 4).map(p => {
        const thumbUrl = p.profiles?.avatar_thumb_url ? `${cdnBase}/${p.profiles.avatar_thumb_url}` : null;
        const img = thumbUrl
          ? `<img src="${esc(thumbUrl)}" width="44" height="44" loading="lazy">`
          : `<div class="home-member-thumb-placeholder">${esc((p.display_name || '?').charAt(0))}</div>`;
        return `<div class="home-member-item">
  <a href="/profile/${esc(p.username)}">${img}</a>
  <a href="/profile/${esc(p.username)}" class="home-member-name">${esc(p.display_name)}</a>
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No members yet.</div>`;

  const peopleModule = module({
    header: `${ic.users(12)} New Members`,
    headerRight: `<a href="/people">Browse All</a>`,
    body: `<div class="home-member-grid">${peopleHtml}</div>`
  });

  // Recent photos module
  const photosHtml = recentPhotos.length
    ? `<div class="photo-grid">${recentPhotos.map(p => photoThumb({ photo: p, cdnBase })).join('')}</div>`
    : `<div class="ds-empty-state">No photos yet. <a href="/photos">Upload some!</a></div>`;

  const photosModule = module({
    header: `${ic.camera(12)} Recent Photos`,
    headerRight: `<a href="/photos">All Photos</a>`,
    body: photosHtml
  });

  // Admin bulletin board
  const bulletinHtml = bulletin ? `<div class="ds-bulletin">
    <div class="ds-bulletin-header">${ic.flag(12)} Ship Bulletin</div>
    <div class="ds-bulletin-body">${esc(bulletin.text)}</div>
    <div class="ds-bulletin-meta">Posted by ${esc(bulletin.author)} &mdash; ${relTime(bulletin.created_at)}</div>
  </div>` : '';

  // Who's online now
  const onlineHtml = onlineUsers.length
    ? `<div class="online-faces">${onlineUsers.map(u => {
        const thumb = u.profiles?.avatar_thumb_url ? `${cdnBase}/${u.profiles.avatar_thumb_url}` : null;
        return `<a href="/profile/${esc(u.username)}" title="${esc(u.display_name)}">
          ${thumb
            ? `<img src="${esc(thumb)}" width="28" height="28" loading="lazy">`
            : `<span class="online-face-placeholder">${esc((u.display_name||'?').charAt(0))}</span>`}
        </a>`;
      }).join('')}</div>
      <div class="online-count">${onlineUsers.length} active in the last 10 min</div>`
    : `<div class="ds-empty-state">No one active right now.</div>`;

  const onlineModule = module({
    header: `${ic.user(12)} Online Now`,
    headerRight: `<a href="/people">Browse All</a>`,
    body: onlineHtml
  });

  // Sailing info notice (first-time feel)
  const sailingNotice = sailing ? `<div class="ds-flash info" style="margin-bottom:8px">
    <strong>Welcome to ${esc(sailing.name)} on ${esc(sailing.ship_name)}!</strong>
    Set up your profile and start meeting your fellow passengers.
  </div>` : '';

  const wx = weatherWidget(weather);
  const portCountdown = portCountdownWidget(voyageDays);

  // Bottom info band: combined events (tonight + upcoming) + dining + port
  const bottomEvents = [...tonightEvents, ...upcomingEvents].slice(0, 10);
  const bottomEventsHtml = bottomEvents.length
    ? bottomEvents.map(e => {
        const h = new Date(e.start_at).getHours();
        const todIcon = h < 12 ? ic.sunrise(11) : h < 18 ? ic.sun(11) : h < 21 ? ic.sunset(11) : ic.moon(11);
        const timeStr = new Date(e.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `<div class="landing-event-row">
  <span class="landing-event-tod">${todIcon}</span>
  <span class="landing-event-time">${timeStr}</span>
  <span class="landing-event-name"><a href="/events/${esc(e.id)}">${esc(e.title)}</a></span>
  ${e.location ? `<span class="landing-event-loc">${ic.mapPin(9)} ${esc(e.location)}</span>` : ''}
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No upcoming events.</div>`;

  const bottomEventsModule = module({
    header: `${ic.calendar(12)} Events Schedule`,
    headerRight: `<a href="/events">All Events</a>`,
    body: `<div class="landing-events-list">${bottomEventsHtml}</div>`
  });

  const bottomDiningModule = module({
    header: `${ic.utensils(12)} Dining &amp; Bars`,
    headerRight: `<a href="/voyage">Itinerary</a>`,
    body: diningWidget(dining)
  });

  const bottomPortModule = portCountdownWidget(voyageDays) ||
    `<div class="ds-module"><div class="ds-module-header">${ic.anchor(12)} At Sea</div>
     <div class="ds-module-body"><div class="port-countdown"><div class="port-name">Enjoying the voyage</div></div></div></div>`;

  return `${bulletinHtml}${sailingNotice}
<div class="home-grid">
  <div>
    ${tonightModule}
    ${activityModule}
    ${photosModule}
  </div>
  <div>
    ${portCountdown}
    ${wx}
    ${upcomingModule}
    ${onlineModule}
    ${peopleModule}
  </div>
</div>
<div class="landing-info-band home-info-band">
  <div class="landing-info-grid">
    <div class="landing-info-col-port">${bottomPortModule}</div>
    <div class="landing-info-col-events">${bottomEventsModule}</div>
    <div class="landing-info-col-dining">${bottomDiningModule}</div>
  </div>
</div>`;
}

/* ============================================================
   LANDING PAGE (unauthenticated visitors)
   OG MySpace layout: 60% left (hero + How It Works + Cool New People), 40% right (login + signup)
   ============================================================ */
function landingPage({ sailing, cdnBase, newPeople, weather, siteKey, publicEvents, voyageDays, bulletin, dining }) {
  const shipName = sailing?.ship_name || 'Your Ship';
  const sailName = sailing?.name      || 'This Sailing';

  // Cool New People grid: up to 8, 60×60 square photos
  const peopleHtml = newPeople.length
    ? newPeople.map(p => {
        const thumbUrl = p.profiles?.avatar_thumb_url ? `${cdnBase}/${p.profiles.avatar_thumb_url}` : null;
        const img = thumbUrl
          ? `<img src="${esc(thumbUrl)}" width="60" height="60" alt="${esc(p.display_name)}">`
          : `<div class="landing-person-placeholder">${esc((p.display_name || '?').charAt(0))}</div>`;
        return `<div class="landing-person-item">
  <a href="/profile/${esc(p.username)}">${img}</a>
  <a href="/profile/${esc(p.username)}" class="landing-person-name">${esc(p.display_name)}</a>
</div>`;
      }).join('')
    : `<div style="font-size:11px;color:#666;padding:8px 0">No members yet &mdash; be the first!</div>`;

  const leftCol = `<div class="landing-left">

  <div class="landing-hero">
    <div class="landing-hero-eyebrow">Welcome aboard <strong>${esc(shipName)}</strong></div>
    <h1 class="landing-hero-title">A Place for Friends<br>on the High Seas</h1>
    <p class="landing-hero-sub">${esc(sailName)} &mdash; Your private cruise social network</p>
    <p class="landing-hero-copy">
      Think of it like MySpace, but just for this ship. Browse fellow passengers,
      plan your nights, share photos from every port, and post on each other&rsquo;s walls.
      When the sailing ends, your Deckspace becomes a permanent scrapbook of the trip.
      <strong>Your people are already here.</strong>
    </p>
  </div>

  <div class="landing-howto">
    <div class="landing-howto-step">
      <span class="landing-howto-num" aria-hidden="true">${ic.user(14)}</span>
      <div>
        <strong>Create your profile</strong>
        <span>Pick a username, upload a photo, add your vibe. Takes 60 seconds.</span>
      </div>
    </div>
    <div class="landing-howto-step">
      <span class="landing-howto-num" aria-hidden="true">${ic.users(14)}</span>
      <div>
        <strong>Find your people</strong>
        <span>Browse passengers, add friends, post on walls, RSVP to events.</span>
      </div>
    </div>
    <div class="landing-howto-step">
      <span class="landing-howto-num" aria-hidden="true">${ic.bookOpen(14)}</span>
      <div>
        <strong>Keep the memories</strong>
        <span>Photos, posts, and moments &mdash; saved as a scrapbook after you dock.</span>
      </div>
    </div>
  </div>

  <div class="ds-module landing-people-module">
    <div class="ds-module-header">${ic.users(12)} Cool New People</div>
    <div class="ds-module-body">
      <div class="landing-people-grid">${peopleHtml}</div>
      <div style="margin-top:8px;font-size:11px"><a href="/register">Join to see everyone &raquo;</a></div>
    </div>
  </div>

</div>`;

  const rightCol = `<div class="landing-right">

  <div class="landing-logo-wrap">
    <div class="landing-logo">Deck<span class="landing-logo-accent">space</span></div>
    <div class="landing-logo-sub">a space for friends at sea</div>
  </div>

  <div class="ds-module landing-login-module">
    <div class="ds-module-header">Already a Member? Sign In</div>
    <div class="ds-module-body">
      <p class="landing-login-context">Enter the username and password you chose when you joined.</p>
      <form method="POST" action="/login" class="landing-login-form" data-retry="true">
        <table class="landing-login-table">
          <tr>
            <td class="landing-login-label"><label for="l-username">Username:</label></td>
            <td class="landing-login-input"><input id="l-username" name="username" type="text" class="ds-input" autocomplete="username" autofocus required></td>
          </tr>
          <tr>
            <td class="landing-login-label"><label for="l-password">Password:</label></td>
            <td class="landing-login-input"><input id="l-password" name="password" type="password" class="ds-input" autocomplete="current-password" required></td>
          </tr>
          <tr>
            <td></td>
            <td style="padding-top:6px">
              ${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="light" style="margin-bottom:6px"></div>` : ''}
              <button type="submit" class="ds-btn ds-btn-primary landing-login-btn" data-loading-text="Signing in...">${ic.logIn(13)} Sign In</button>
            </td>
          </tr>
        </table>
      </form>
      ${siteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
    </div>
  </div>

  <div class="landing-signup-box">
    <div class="landing-signup-header">New Passenger?</div>
    <p class="landing-signup-copy">
      Create your free Deckspace profile and connect with everyone on <strong>${esc(shipName)}</strong>.
      It takes about 60 seconds.
    </p>
    <a href="/register" class="ds-btn ds-btn-orange landing-signup-btn">Sign Up &mdash; It&rsquo;s Free!</a>
  </div>

  ${sailing ? `<div class="landing-voyage-box">
    <div class="landing-voyage-label">Current Sailing</div>
    <div class="landing-voyage-ship">${esc(sailing.ship_name)}</div>
    <div class="landing-voyage-name">${esc(sailing.name)}</div>
  </div>` : ''}

  ${weatherWidget(weather)}

</div>`;

  // ── Ship bulletin (above info band if set) ──────────────────
  const bulletinBand = bulletin ? `<div class="landing-bulletin">
  <span class="landing-bulletin-label">${ic.flag(12)} Ship Bulletin</span>
  ${esc(bulletin.text)}
</div>` : '';

  // ── Port countdown (compact inline) ─────────────────────────
  const portBox = portCountdownWidget(voyageDays);

  // ── Next 10 upcoming events ──────────────────────────────────
  const eventsHtml = publicEvents && publicEvents.length
    ? publicEvents.map(e => {
        const h = new Date(e.start_at).getHours();
        const todIcon = h < 12 ? ic.sunrise(11) : h < 18 ? ic.sun(11) : h < 21 ? ic.sunset(11) : ic.moon(11);
        const timeStr = new Date(e.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `<div class="landing-event-row">
  <span class="landing-event-tod">${todIcon}</span>
  <span class="landing-event-time">${timeStr}</span>
  <span class="landing-event-name">${esc(e.title)}</span>
  ${e.location ? `<span class="landing-event-loc">${ic.mapPin(9)} ${esc(e.location)}</span>` : ''}
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No upcoming events scheduled.</div>`;

  const eventsBox = module({
    header: `${ic.calendar(12)} Upcoming Events`,
    headerRight: `<a href="/login">RSVP &raquo;</a>`,
    body: `<div class="landing-events-list">${eventsHtml}</div>`
  });

  // ── Dining & bar hours ───────────────────────────────────────
  const diningBox = module({
    header: `${ic.utensils(12)} Dining &amp; Bars`,
    body: diningWidget(dining)
  });

  const infoBand = `<div class="landing-info-band">
  ${bulletinBand}
  <div class="landing-info-grid">
    <div class="landing-info-col-port">${portBox || `<div class="ds-empty-state">${ic.anchor(13)} At sea &mdash; enjoy the voyage!</div>`}</div>
    <div class="landing-info-col-events">${eventsBox}</div>
    <div class="landing-info-col-dining">${diningBox}</div>
  </div>
</div>`;

  return `<div class="landing-wrap">${leftCol}${rightCol}</div>${infoBand}`;
}

export default home;
