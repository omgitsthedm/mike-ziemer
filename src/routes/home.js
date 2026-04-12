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
import { getDb, getEvents, getRecentPhotos, browsePeople, getSailing, getOnlineUsers } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { layout, layoutCtx, esc, fmtDate, relTime } from '../templates/layout.js';
import { module, eventCard, photoThumb, absUrl, pixelAvatarImg, isLegacyAvatarUrl } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const home = new Hono();

/* ============================================================
   DEMO DATA — shown on preview/unconfigured deployments and
   as fallback when the DB has no sailing / no events yet.
   ============================================================ */
const DEMO_SAILING = {
  ship_name: 'Norwegian Sun',
  name:      'Eastern Caribbean Getaway',
};

const DEMO_EVENTS = [
  { time: '7:00 PM',  title: 'Caribbean Deck Party',         location: 'Pool Deck' },
  { time: '8:30 PM',  title: 'Live Music: Coral Reef Trio',  location: 'Atrium Stage' },
  { time: '9:00 PM',  title: 'Comedy Showcase',              location: 'Stardust Theater' },
  { time: '11:00 PM', title: 'Late Night DJ & Dancing',      location: 'Sugarcane Bar' },
];

const DEMO_VENUES = [
  { name: 'The Garden Café (Buffet)',  hours: '6:00 AM – Midnight' },
  { name: 'Main Dining Room',          hours: '7–9 AM · Noon–2 PM · 6–9:30 PM' },
  { name: 'Pool Bar',                  hours: '10:00 AM – 11:00 PM' },
  { name: 'Spa & Fitness Center',      hours: '6:00 AM – 10:00 PM' },
  { name: 'Casino',                    hours: '8:00 PM – 2:00 AM' },
  { name: 'Shore Excursions Desk',     hours: '7:00–9:00 AM · 5:00–7:00 PM' },
];

const DEMO_ITINERARY = [
  { date: 'Fri', port: 'Miami, FL',          note: 'Embarkation',    sea: false },
  { date: 'Sat', port: 'At Sea',             note: '',                sea: true  },
  { date: 'Sun', port: 'Nassau, Bahamas',    note: '8 AM – 5 PM',    sea: false },
  { date: 'Mon', port: 'Great Stirrup Cay', note: 'Private Island',  sea: false },
  { date: 'Tue', port: 'Miami, FL',          note: 'Disembarkation', sea: false },
];

home.get('/', async (c) => {
  // Guard: no Supabase config → show full demo landing page (works on preview deploys)
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_KEY) {
    return c.html(layout({
      title: 'Deckspace — A Place for Friends on the High Seas',
      description: 'Deckspace is the cruise social site for meeting passengers, checking what is happening tonight, sharing photos, and keeping a short post-cruise scrapbook.',
      body:  landingPage({ sailing: DEMO_SAILING, cdnBase: '', newPeople: [], weather: null, tonightEvents: [], siteKey: c.env.TURNSTILE_SITE_KEY || '' }),
      notifCount: 0,
      csrfToken:  '',
      currentUrl: c.req.url,
      showPageHeading: false,
    }));
  }

  const user    = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';

  // Fetch weather from KV (admin-updated) or use demo data
  const weatherJson = await c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null);
  const weather = weatherJson ? JSON.parse(weatherJson) : null;

  // Unauthenticated: show OG MySpace-style landing page
  if (!user) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const [newPeople, tonightEvents] = await Promise.all([
      browsePeople(db, c.env.SAILING_ID, { limit: 8 }).catch(() => []),
      db.from('events')
        .select('id, title, location, start_at, event_type, category')
        .eq('sailing_id', c.env.SAILING_ID)
        .eq('moderation_status', 'visible')
        .eq('visibility', 'public')
        .gte('start_at', todayStart.toISOString())
        .lte('start_at', todayEnd.toISOString())
        .order('start_at', { ascending: true })
        .limit(4)
        .then(({ data }) => data || [])
        .catch(() => [])
    ]);

    return c.html(layoutCtx(c, {
      title: 'Deckspace — A Place for Friends on the High Seas',
      description: `Join Deckspace for ${sailing?.name || 'your sailing'} on ${sailing?.ship_name || 'your ship'} to meet passengers, follow tonight's events, and share photos during the trip.`,
      body: landingPage({ sailing, cdnBase, newPeople, weather, tonightEvents, siteKey: c.env.TURNSTILE_SITE_KEY || '' }),
      showPageHeading: false,
    }));
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Fetch bulletin from KV (admin-posted, short-lived)
  const bulletinJson = await c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null);
  const bulletin = bulletinJson ? JSON.parse(bulletinJson) : null;

  // Parallel fetch of all home page data
  const [tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers] =
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
      getOnlineUsers(db, c.env.SAILING_ID, 10, 8).catch(() => [])
    ]);

  const body = homePage({
    user, sailing, cdnBase, weather,
    tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers, bulletin
  });

  return c.html(layoutCtx(c, {
    title: 'Home',
    description: `Check tonight's events, social activity, photos, and who's online right now for ${sailing?.name || 'this sailing'} on Deckspace.`,
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
   HOME PAGE TEMPLATE
   ============================================================ */
function homePage({ user, sailing, cdnBase, weather, tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers, bulletin }) {
  const firstName = (user?.display_name || 'friend').split(/\s+/)[0];
  const nextEvent = tonightEvents[0] || upcomingEvents[0] || null;
  const activePeopleCount = Math.max(onlineUsers.length, recentPeople.length);
  const photoCount = recentPhotos.length;
  const activityCount = recentActivity.length;

  const commandDeck = `<section class="home-command-deck">
  <div class="home-command-copy">
    <div class="home-command-kicker">${ic.shipWheel(13)} Welcome back, ${esc(firstName)}</div>
    <div class="home-command-brandline">Deckspace on deck for ${esc(sailing?.ship_name || 'the sailing')}</div>
    <h2 class="home-command-title">Everything happening on ${esc(sailing?.ship_name || 'the ship')}, without the scramble.</h2>
    <p class="home-command-sub">Check tonight&rsquo;s plans, see who is around, catch wall notes, and keep up with fresh photo drops in one place.</p>
    <div class="home-command-links">
      <a href="/events">${ic.calendar(12)} Find tonight's move</a>
      <a href="/photos/upload">${ic.camera(12)} Drop a photo</a>
      <a href="/people">${ic.users(12)} Meet your people</a>
      <a href="/voyage">${ic.ship(12)} Check the itinerary</a>
    </div>
  </div>
  <div class="home-command-stats">
    <div class="home-command-stat"><strong>${tonightEvents.length}</strong><span>happening tonight</span></div>
    <div class="home-command-stat"><strong>${activePeopleCount}</strong><span>faces in the mix</span></div>
    <div class="home-command-stat"><strong>${photoCount}</strong><span>new photo drops</span></div>
    <div class="home-command-stat"><strong>${activityCount}</strong><span>new wall notes</span></div>
  </div>
</section>`;

  const plannerStrip = `<section class="home-spotlight-strip">
  <article class="home-spotlight-card">
    <div class="home-spotlight-label">${ic.clock(12)} Next Pull</div>
    ${nextEvent
      ? `<a href="/events/${esc(nextEvent.id)}" class="home-spotlight-title">${esc(nextEvent.title)}</a>
         <div class="home-spotlight-meta">${fmtDate(nextEvent.start_at, { time: true })}${nextEvent.location ? ` &middot; ${esc(nextEvent.location)}` : ''}</div>`
      : `<div class="home-spotlight-empty">The board is quiet for a second. That probably won't last.</div>`}
  </article>
  <article class="home-spotlight-card">
    <div class="home-spotlight-label">${ic.users(12)} Crowd Radar</div>
    <div class="home-spotlight-title">${onlineUsers.length ? `${onlineUsers.length} people active now` : 'Quiet right now'}</div>
    <div class="home-spotlight-meta">${onlineUsers.length ? 'Jump into profiles, wall notes, and tonight&rsquo;s plans while people are still around.' : 'Quiet for the moment. Good time to look around before the crowd shows up.'}</div>
  </article>
  <article class="home-spotlight-card">
    <div class="home-spotlight-label">${ic.camera(12)} Scrapbook Pulse</div>
    <div class="home-spotlight-title">${recentPhotos.length ? `${recentPhotos.length} recent photos` : 'No new photos yet'}</div>
    <div class="home-spotlight-meta">${recentPhotos.length ? 'Fresh shots are already landing on the photo board.' : 'The camera roll is quiet for now.'}</div>
  </article>
</section>`;

  const tonightHtml = tonightEvents.length
    ? tonightEvents.map(e => eventCard({ event: e, cdnBase })).join('')
    : `<div class="ds-empty-state">Tonight is still open. <a href="/events/create">Post a plan.</a></div>`;

  const tonightModule = module({
    header: `${ic.calendar(12)} Tonight's Pull`,
    headerRight: `<a href="/events">All Events</a>`,
    body: `<div class="event-list">${tonightHtml}</div>`
  });

  // Upcoming events module
  const upcomingHtml = upcomingEvents.length
    ? upcomingEvents.map(e => eventCard({ event: e, cdnBase })).join('')
    : `<div class="ds-empty-state">Nothing else is on the board yet.</div>`;

  const upcomingModule = module({
    header: `${ic.clock(12)} Coming Up`,
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
    : `<div class="ds-empty-state">The wall is quiet right now. <a href="/people">Go meet some people.</a></div>`;

  const activityModule = module({
    header: `${ic.msgSquare(12)} Wall Chatter`,
    body: activityHtml
  });

  // New members module
  const peopleHtml = recentPeople.length
    ? recentPeople.slice(0, 6).map(p => {
        const thumbUrl = absUrl(cdnBase, p.profiles?.avatar_thumb_url);
        const img = thumbUrl && !isLegacyAvatarUrl(thumbUrl)
          ? `<img src="${esc(thumbUrl)}" width="44" height="44" alt="${esc(p.display_name)}" loading="lazy">`
          : pixelAvatarImg(p.display_name || '?', p.username || p.display_name || '', 44, 'home-member-pixel-avatar');
        return `<div class="home-member-item">
  <a href="/profile/${esc(p.username)}" aria-label="View ${esc(p.display_name || 'this passenger')}'s profile">${img}</a>
  <a href="/profile/${esc(p.username)}" class="home-member-name">${esc(p.display_name)}</a>
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No one has joined yet.</div>`;

  const peopleModule = module({
    header: `${ic.users(12)} Fresh Faces`,
    headerRight: `<a href="/people">Browse All</a>`,
    body: `<div class="home-member-grid">${peopleHtml}</div>`
  });

  // Recent photos module
  const photosHtml = recentPhotos.length
    ? `<div class="photo-grid">${recentPhotos.map(p => photoThumb({ photo: p, cdnBase })).join('')}</div>`
    : `<div class="ds-empty-state">No photos yet. <a href="/photos">Start the scrapbook.</a></div>`;

  const photosModule = module({
    header: `${ic.camera(12)} Scrapbook Drops`,
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
        const thumb = absUrl(cdnBase, u.profiles?.avatar_thumb_url);
        return `<a href="/profile/${esc(u.username)}" title="${esc(u.display_name)}" aria-label="View ${esc(u.display_name || 'this passenger')}'s profile">
          ${thumb && !isLegacyAvatarUrl(thumb)
            ? `<img src="${esc(thumb)}" width="28" height="28" alt="${esc(u.display_name)}" loading="lazy">`
            : pixelAvatarImg(u.display_name || '?', u.username || u.display_name || '', 28, 'online-face-pixel-avatar')}
        </a>`;
      }).join('')}</div>
      <div class="online-count">${onlineUsers.length} active in the last 10 min</div>`
    : `<div class="ds-empty-state">No one is active right now.</div>`;

  const onlineModule = module({
    header: `${ic.user(12)} Online Right Now`,
    headerRight: `<a href="/people">Browse All</a>`,
    body: onlineHtml
  });

  // Sailing info notice (first-time feel)
  const sailingNotice = sailing ? `<div class="home-sailing-note">
    ${ic.shipWheel(13)} <strong>${esc(sailing.name)}</strong> on ${esc(sailing.ship_name)} is live. Build your page, join plans, and leave a paper trail worth keeping.
  </div>` : '';

  const wx = weatherWidget(weather);

  return `${bulletinHtml}${commandDeck}${plannerStrip}${sailingNotice}
<div class="home-grid home-grid-shell">
  <div class="home-column-main">
    ${tonightModule}
    ${activityModule}
    ${photosModule}
  </div>
  <div class="home-column-side">
    ${wx}
    ${upcomingModule}
    ${onlineModule}
    ${peopleModule}
  </div>
</div>`;
}

/* ============================================================
   LANDING PAGE (unauthenticated visitors)
   OG MySpace layout: 60% left, 40% right
   ============================================================ */
function landingPage({ sailing, cdnBase, newPeople, weather, tonightEvents = [], siteKey = '' }) {
  const s        = sailing || DEMO_SAILING;
  const shipName = s.ship_name;
  const sailName = s.name;
  const tonightCount = tonightEvents.length || DEMO_EVENTS.length;
  const peopleCount = newPeople.length || 8;
  const stopCount = DEMO_ITINERARY.length;

  // Tonight's Events — real if available, demo otherwise
  const eventsToShow = tonightEvents.length
    ? tonightEvents.map(e => ({
        time:     e.start_at ? new Date(e.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
        title:    e.title,
        location: e.location || '',
      }))
    : DEMO_EVENTS;
  const eventsIsDemo = !tonightEvents.length;

  const eventsPreviewHtml = `<div class="ds-module landing-events-module">
    <div class="ds-module-header">${ic.calendar(12)} Tonight on ${esc(shipName)} <span class="landing-events-more"><a href="/register">all events &raquo;</a></span></div>
    <div class="ds-module-body">
      <div class="landing-events-list">
        ${eventsToShow.map(e => `<div class="landing-event-item">
          <span class="landing-event-time">${esc(e.time)}</span>
          <a href="/register" class="landing-event-title">${esc(e.title)}</a>
          ${e.location ? `<span class="landing-event-loc">${esc(e.location)}</span>` : ''}
        </div>`).join('')}
      </div>
      ${eventsIsDemo ? '<div class="landing-demo-note">Sample events — real schedule varies by sailing</div>' : ''}
      <div class="landing-events-cta"><a href="/register">Sign up to RSVP to events! &raquo;</a></div>
    </div>
  </div>`;

  // Venue Hours
  const venueHtml = `<div class="ds-module">
    <div class="ds-module-header">${ic.clock(12)} What&rsquo;s Open &amp; When <span class="landing-events-more">Ship Time (ET)</span></div>
    <div class="ds-module-body">
      <table class="landing-venue-table" aria-label="Ship venue hours">
        <caption class="sr-only">Venue hours on the sailing</caption>
        <thead class="sr-only">
          <tr><th scope="col">Venue</th><th scope="col">Hours</th></tr>
        </thead>
        <tbody>
        ${DEMO_VENUES.map(v => `<tr>
          <td class="landing-venue-name">${esc(v.name)}</td>
          <td class="landing-venue-hours">${esc(v.hours)}</td>
        </tr>`).join('')}
        </tbody>
      </table>
      <div class="landing-demo-note">Hours vary by sailing — check daily newsletter for updates</div>
    </div>
  </div>`;

  // Cool New People grid: up to 8, 60×60 square photos
  const duplicateCounts = newPeople.reduce((acc, person) => {
    acc[person.display_name] = (acc[person.display_name] || 0) + 1;
    return acc;
  }, {});

  const peopleHtml = newPeople.length
    ? newPeople.map(p => {
        const thumbUrl = absUrl(cdnBase, p.profiles?.avatar_thumb_url);
        const label = duplicateCounts[p.display_name] > 1 ? `${p.display_name} (@${p.username})` : p.display_name;
        const img = thumbUrl && !isLegacyAvatarUrl(thumbUrl)
          ? `<img src="${esc(thumbUrl)}" width="60" height="60" alt="${esc(label)}" loading="lazy">`
          : pixelAvatarImg(label || '?', p.username || label || '', 60, 'landing-person-pixel-avatar');
        return `<div class="landing-person-item">
  <a href="/profile/${esc(p.username)}" aria-label="View ${esc(label || 'this passenger')}'s profile">${img}</a>
  <a href="/profile/${esc(p.username)}" class="landing-person-name">${esc(label)}</a>
</div>`;
      }).join('')
    : `<div style="font-size:11px;color:#666;padding:8px 0">No one is here yet &mdash; be the first.</div>`;

  const leftCol = `<div class="landing-left">

  <section class="landing-marquee">
    <div class="landing-hero">
      <div class="landing-hero-eyebrow">${ic.shipWheel(13)} Welcome aboard <strong>${esc(shipName)}</strong></div>
      <h1 class="landing-hero-title">A Place for Friends<br>on the High Seas</h1>
      <p class="landing-hero-sub">${esc(sailName)} &mdash; your public cruise social network</p>
      <p class="landing-hero-copy">
        Meet the people on this cruise, see what&rsquo;s happening tonight, share photos from every stop,
        and leave notes on each other&rsquo;s pages. When the trip ends, Deckspace hangs around like a short scrapbook.
      </p>
      <div class="landing-hero-actions">
        <a href="/register" class="ds-btn ds-btn-orange">Join the Cruise &rarr;</a>
        <a href="/login" class="landing-hero-secondary">Already a member? Sign in</a>
      </div>
    </div>
    <div class="landing-signal-strip" aria-label="Deckspace quick facts">
      <div class="landing-signal-item">
        <strong>${esc(String(tonightCount))}</strong>
        <span>things happening tonight</span>
      </div>
      <div class="landing-signal-item">
        <strong>${esc(String(peopleCount))}</strong>
        <span>faces already on deck</span>
      </div>
      <div class="landing-signal-item">
        <strong>${esc(String(stopCount))}</strong>
        <span>voyage stops to keep up with</span>
      </div>
    </div>
  </section>

  <div class="landing-support-grid">
    ${eventsPreviewHtml}
    ${venueHtml}
  </div>

  <div class="landing-howto">
    <div class="landing-howto-step">
      <span class="landing-howto-num" aria-hidden="true">${ic.user(14)}</span>
      <div>
        <strong>Make your page</strong>
        <span>Pick a username, add a photo, and show your vibe. It takes about a minute.</span>
      </div>
    </div>
    <div class="landing-howto-step">
      <span class="landing-howto-num" aria-hidden="true">${ic.users(14)}</span>
      <div>
        <strong>Find your people</strong>
        <span>Browse everyone on the ship, add friends, post on their pages, and RSVP to parties.</span>
      </div>
    </div>
    <div class="landing-howto-step">
      <span class="landing-howto-num" aria-hidden="true">${ic.bookOpen(14)}</span>
      <div>
        <strong>Keep the memories</strong>
        <span>Photos and posts stick around like a short scrapbook after you get home.</span>
      </div>
    </div>
  </div>

  <div class="ds-module landing-people-module">
    <div class="ds-module-header">${ic.users(12)} People on the Ship</div>
    <div class="ds-module-body">
      <div class="landing-people-grid">${peopleHtml}</div>
      <div class="landing-people-cta"><a href="/register">Sign up to see everyone! &raquo;</a></div>
    </div>
  </div>

</div>`;

  const rightCol = `<div class="landing-right">

  <section class="landing-boarding-panel">
    <div class="landing-logo-wrap">
      <img src="/images/deckspace-logo.png" alt="Deckspace" class="landing-brand-logo" width="120" height="120">
      <div class="landing-logo-sub">your cruise, your crew, your page</div>
    </div>
    <p class="landing-boarding-copy">
      Make your page, find tonight&rsquo;s plans, and keep up with the ship while everyone is actually on board.
    </p>
    <div class="landing-boarding-points">
      <span>Open to your sailing</span>
      <span>No email needed</span>
      <span>Built for this sailing</span>
    </div>

    <div class="landing-login-shell">
      <div class="landing-login-title">Already a member? Sign in.</div>
      <div class="login-instructions">
        Type your username and password below and you&rsquo;re in.
      </div>
      <form method="POST" action="/login" class="landing-login-form" data-retry="true">
        <div class="landing-login-table">
          <div class="landing-login-row">
            <div class="landing-login-label"><label for="l-username">Username:</label></div>
            <div class="landing-login-input"><input id="l-username" name="username" type="text" class="ds-input" autocomplete="username" autofocus required></div>
          </div>
          <div class="landing-login-row">
            <div class="landing-login-label"><label for="l-password">Password:</label></div>
            <div class="landing-login-input"><input id="l-password" name="password" type="password" class="ds-input" autocomplete="current-password" required></div>
          </div>
          <div class="landing-login-row">
            <div></div>
            <div class="landing-login-input" style="padding-top:6px">
              ${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="light" style="margin-bottom:6px"></div>
              <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
              <button type="submit" class="ds-btn ds-btn-primary landing-login-btn" data-loading-text="Signing in...">Log In &rarr;</button>
            </div>
          </div>
        </div>
      </form>
      <div class="login-help-text">
        <strong>Forgot your login?</strong> Guest Services can help you find it.
      </div>
    </div>

    <div class="landing-signup-box">
      <div class="landing-signup-header">New here?</div>
      <p class="landing-signup-copy">
        Make a free profile and connect with everyone on <strong>${esc(shipName)}</strong>.
        Takes about two minutes.
      </p>
      <a href="/register" class="ds-btn ds-btn-orange landing-signup-btn">Join the Cruise &rarr;</a>
    </div>
  </section>

  <div class="landing-side-stack">
  <div class="ds-module landing-side-module">
    <div class="ds-module-header">${ic.ferry(12)} ${esc(shipName)} &mdash; Voyage</div>
    <div class="ds-module-body">
      <div class="landing-voyage-tagline">${esc(sailName)}</div>
      <table class="landing-itin-table" aria-label="Voyage itinerary">
        <caption class="sr-only">Voyage itinerary for the sailing</caption>
        <thead class="sr-only">
          <tr><th scope="col">Day</th><th scope="col">Port</th><th scope="col">Notes</th></tr>
        </thead>
        <tbody>
        ${DEMO_ITINERARY.map(d => `<tr class="${d.sea ? 'landing-itin-sea' : ''}">
          <td class="landing-itin-date">${esc(d.date)}</td>
          <td class="landing-itin-port">${esc(d.port)}</td>
          <td class="landing-itin-note">${esc(d.note)}</td>
        </tr>`).join('')}
        </tbody>
      </table>
      <div class="landing-tz">${ic.clock(10)} All times: Eastern Time (ET, UTC&minus;5)</div>
    </div>
  </div>

  <div class="landing-side-module landing-weather-shell">${weatherWidget(weather)}</div>
  </div>

</div>`;

  return `<div class="landing-wrap">${leftCol}${rightCol}</div>`;
}

export default home;
