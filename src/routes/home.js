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
import { module, eventCard, photoThumb, personRow } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const home = new Hono();

home.get('/', async (c) => {
  const user    = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';

  // Unauthenticated: show OG MySpace-style landing page
  if (!user) {
    const newPeople = await browsePeople(db, c.env.SAILING_ID, { limit: 8 }).catch(() => []);
    return c.html(layoutCtx(c, {
      title: 'Deckspace — A Place for Friends on the High Seas',
      body: landingPage({ sailing, cdnBase, newPeople }),
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
    user, sailing, cdnBase,
    tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers, bulletin
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
   HOME PAGE TEMPLATE
   ============================================================ */
function homePage({ user, sailing, cdnBase, tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity, onlineUsers, bulletin }) {
  // Tonight's events module
  const tonightHtml = tonightEvents.length
    ? tonightEvents.map(e => eventCard({ event: e, cdnBase })).join('')
    : `<div class="ds-empty-state">No events scheduled for tonight. <a href="/events/create">Create one!</a></div>`;

  const tonightModule = module({
    header: "Tonight's Events",
    headerRight: `<a href="/events">All Events</a>`,
    body: `<div class="event-list">${tonightHtml}</div>`
  });

  // Upcoming events module
  const upcomingHtml = upcomingEvents.length
    ? upcomingEvents.map(e => eventCard({ event: e, cdnBase })).join('')
    : `<div class="ds-empty-state">No upcoming events yet.</div>`;

  const upcomingModule = module({
    header: 'Upcoming',
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
    header: 'Social Activity',
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
    header: 'New Members',
    headerRight: `<a href="/people">Browse All</a>`,
    body: `<div class="home-member-grid">${peopleHtml}</div>`
  });

  // Recent photos module
  const photosHtml = recentPhotos.length
    ? `<div class="photo-grid">${recentPhotos.map(p => photoThumb({ photo: p, cdnBase })).join('')}</div>`
    : `<div class="ds-empty-state">No photos yet. <a href="/photos">Upload some!</a></div>`;

  const photosModule = module({
    header: 'Recent Photos',
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
    header: 'Online Now',
    headerRight: `<a href="/people">Browse All</a>`,
    body: onlineHtml
  });

  // Sailing info notice (first-time feel)
  const sailingNotice = sailing ? `<div class="ds-flash info" style="margin-bottom:8px">
    <strong>Welcome to ${esc(sailing.name)} on ${esc(sailing.ship_name)}!</strong>
    Set up your profile and start meeting your fellow passengers.
  </div>` : '';

  return `${bulletinHtml}${sailingNotice}
<div class="home-grid">
  <div>
    ${tonightModule}
    ${activityModule}
    ${photosModule}
  </div>
  <div>
    ${upcomingModule}
    ${onlineModule}
    ${peopleModule}
  </div>
</div>`;
}

/* ============================================================
   LANDING PAGE (unauthenticated visitors)
   OG MySpace layout: 60% left (hero + How It Works + Cool New People), 40% right (login + signup)
   ============================================================ */
function landingPage({ sailing, cdnBase, newPeople }) {
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
      <span class="landing-howto-num">1</span>
      <div>
        <strong>Create your profile</strong>
        <span>Pick a username, upload a photo, add your vibe. Takes 60 seconds.</span>
      </div>
    </div>
    <div class="landing-howto-step">
      <span class="landing-howto-num">2</span>
      <div>
        <strong>Find your people</strong>
        <span>Browse passengers, add friends, post on walls, RSVP to events.</span>
      </div>
    </div>
    <div class="landing-howto-step">
      <span class="landing-howto-num">3</span>
      <div>
        <strong>Keep the memories</strong>
        <span>Photos, posts, and moments &mdash; saved as a scrapbook after you dock.</span>
      </div>
    </div>
  </div>

  <div class="ds-module landing-people-module">
    <div class="ds-module-header">Cool New People</div>
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
            <td style="padding-top:6px"><button type="submit" class="ds-btn ds-btn-primary landing-login-btn" data-loading-text="Signing in...">Sign In</button></td>
          </tr>
        </table>
      </form>
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

</div>`;

  return `<div class="landing-wrap">${leftCol}${rightCol}</div>`;
}

export default home;
