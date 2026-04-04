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
import { getDb, getEvents, getRecentPhotos, browsePeople, getSailing } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { layout, esc, fmtDate, relTime } from '../templates/layout.js';
import { module, eventCard, photoThumb, personRow } from '../templates/components.js';

const home = new Hono();

home.use('/', requireAuth);

home.get('/', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Parallel fetch of all home page data
  const [tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity] =
    await Promise.all([
      // Tonight's events (today only)
      getDb(c.env).from('events')
        .select('id, title, location, start_at, event_type, category, rsvp_count, cover_image_url')
        .eq('sailing_id', c.env.SAILING_ID)
        .eq('moderation_status', 'visible')
        .eq('visibility', 'public')
        .gte('start_at', todayStart.toISOString())
        .lte('start_at', todayEnd.toISOString())
        .order('start_at', { ascending: true })
        .limit(6)
        .then(({ data }) => data || []),

      // Upcoming events (next 3 days beyond today)
      getDb(c.env).from('events')
        .select('id, title, location, start_at, event_type, category, rsvp_count, cover_image_url')
        .eq('sailing_id', c.env.SAILING_ID)
        .eq('moderation_status', 'visible')
        .eq('visibility', 'public')
        .gt('start_at', todayEnd.toISOString())
        .order('start_at', { ascending: true })
        .limit(4)
        .then(({ data }) => data || []),

      // Recently active people
      browsePeople(db, c.env.SAILING_ID, { limit: 8 }),

      // Recent photos
      getRecentPhotos(db, c.env.SAILING_ID, 8),

      // Recent wall posts (social pulse)
      getDb(c.env).from('wall_posts')
        .select('id, body, created_at, profile_user_id, author_user_id, users!wall_posts_author_user_id_fkey(username, display_name), profiles_user!wall_posts_profile_user_id_fkey(username, display_name)')
        .eq('moderation_status', 'visible')
        .order('created_at', { ascending: false })
        .limit(5)
        .then(({ data }) => data || [])
    ]);

  const body = homePage({
    user, sailing, cdnBase,
    tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity
  });

  return c.html(layout({
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
function homePage({ user, sailing, cdnBase, tonightEvents, upcomingEvents, recentPeople, recentPhotos, recentActivity }) {
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
        const actor = post.users;
        const target = post.profiles_user;
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
          ? `<img src="${esc(thumbUrl)}" width="44" height="44" loading="lazy" style="border:1px solid #ccc">`
          : `<div style="width:44px;height:44px;background:#e8e8e8;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:11px;color:#aaa">${esc((p.display_name || '?').charAt(0))}</div>`;
        return `<div style="display:inline-block;text-align:center;margin:3px;vertical-align:top;width:64px">
  <a href="/profile/${esc(p.username)}">${img}</a>
  <a href="/profile/${esc(p.username)}" style="font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.display_name)}</a>
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No members yet.</div>`;

  const peopleModule = module({
    header: 'New Members',
    headerRight: `<a href="/people">Browse All</a>`,
    body: `<div style="padding:4px">${peopleHtml}</div>`
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

  // Sailing info notice (first-time feel)
  const sailingNotice = sailing ? `<div class="ds-flash info" style="margin-bottom:8px">
    <strong>Welcome to ${esc(sailing.name)} on ${esc(sailing.ship_name)}!</strong>
    Set up your profile and start meeting your fellow passengers.
  </div>` : '';

  return `${sailingNotice}
<div class="home-grid">
  <div>
    ${tonightModule}
    ${activityModule}
    ${photosModule}
  </div>
  <div>
    ${upcomingModule}
    ${peopleModule}
  </div>
</div>`;
}

export default home;
