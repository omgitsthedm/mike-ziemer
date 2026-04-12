/**
 * Deckspace — Events routes
 *
 * GET  /events                   — events list (today, upcoming, official, user)
 * GET  /events/create            — create event form
 * POST /events/create            — create event
 * GET  /events/:id               — event detail page
 * GET  /events/:id/edit          — edit event form
 * POST /events/:id/edit          — save event edits
 * POST /events/:id/rsvp          — toggle RSVP
 * POST /events/:id/comment       — add comment
 * POST /events/:id/comment/:cid/delete — delete comment
 */

import { Hono } from 'hono';
import { getDb, getEvents, getEventById, getEventComments, getUserRsvp, getSailing, createNotification, q } from '../lib/db.js';
import { requireAuth, resolveSession, isSailingReadOnly } from '../lib/auth.js';
import { layout, layoutCtx, esc, fmtDate, relTime, csrfField } from '../templates/layout.js';
import { module, eventCard, commentEntry, paginator, absUrl, pixelAvatarImg, isLegacyAvatarUrl } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const events = new Hono();

/* ============================================================
   EVENTS LIST — Shattered Shores MySpace-style schedule
   ============================================================ */
const EVENT_CATEGORIES = ['karaoke','trivia','dinner','deck','social','excursion','drinks','poker','theme','music','other'];
const EVENT_VIEWS = ['all', 'official', 'community', 'popular', 'late'];

events.get('/events', async (c) => {
  const viewer   = await resolveSession(c.env, c.req.raw);
  const db       = getDb(c.env);
  const sailing  = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const category = (c.req.query('category') || '').toLowerCase().trim();
  const rawView = (c.req.query('view') || '').toLowerCase().trim();
  const view = EVENT_VIEWS.includes(rawView) ? rawView : 'all';

  // Fetch all visible public events for the sailing, ordered by time
  let evQuery = db.from('events')
    .select('id, title, location, start_at, category, event_type, rsvp_count, description, cover_image_url')
    .eq('sailing_id', c.env.SAILING_ID)
    .eq('moderation_status', 'visible')
    .eq('visibility', 'public')
    .order('start_at', { ascending: true })
    .limit(200);

  if (category && EVENT_CATEGORIES.includes(category)) {
    evQuery = evQuery.eq('category', category);
  }

  const { data: allEventsRaw } = await evQuery;
  const allEvents = filterEventsForView(allEventsRaw || [], view);
  const eventIds = allEvents.map((event) => event.id);
  let attendeeRows = [];
  if (eventIds.length) {
    const { data } = await db.from('event_rsvps')
      .select('event_id, users!event_rsvps_user_id_fkey(username, display_name, profiles(avatar_thumb_url))')
      .in('event_id', eventIds)
      .eq('status', 'going')
      .limit(600);
    attendeeRows = data || [];
  }
  const attendeesByEvent = {};
  attendeeRows.forEach((row) => {
    if (!attendeesByEvent[row.event_id]) attendeesByEvent[row.event_id] = [];
    if (attendeesByEvent[row.event_id].length < 5) attendeesByEvent[row.event_id].push(row.users);
  });

  // Group by calendar date
  const dayMap = new Map();
  for (const ev of allEvents) {
    const d = ev.start_at.slice(0, 10);
    if (!dayMap.has(d)) dayMap.set(d, []);
    dayMap.get(d).push(ev);
  }
  const days = [...dayMap.entries()];
  const userFilter = (c.req.query('user') || '').trim();
  const title = category
    ? `Cruise Events: ${category}`
    : view !== 'all'
    ? `Cruise Events: ${view}`
    : userFilter
    ? `Cruise Events by ${userFilter}`
    : 'Cruise Events and Plans';

  const body = eventsSchedulePage({ viewer, sailing, days, activeCategory: category, activeView: view, attendeesByEvent, cdnBase: c.env.R2_PUBLIC_URL || '' });

  return c.html(layoutCtx(c, {
    title,
    description: category
      ? `Browse public ${category} events on Deckspace for this sailing.`
      : view === 'official'
      ? 'Browse official Deckspace ship programming for this sailing.'
      : view === 'community'
      ? 'Browse public passenger-made Deckspace plans for this sailing.'
      : view === 'popular'
      ? 'Browse the most active Deckspace events by RSVP count for this sailing.'
      : view === 'late'
      ? 'Browse after-dark Deckspace events for this sailing.'
      : userFilter
      ? `Browse Deckspace events connected to ${userFilter} on this sailing.`
      : 'Browse public Deckspace events for this sailing, including official programming, passenger plans, and RSVP counts.',
    user: viewer,
    sailing,
    activeNav: 'events',
    body,
  }));
});

/* ============================================================
   CREATE EVENT
   ============================================================ */
events.get('/events/create', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const readOnly = sailing ? isSailingReadOnly(sailing) : false;

  if (readOnly) return c.redirect('/events');

  return c.html(layoutCtx(c, {
    title: 'Create a Deckspace Event',
    description: 'Create a public Deckspace event for this sailing so other passengers can find it, RSVP, and join in.',
    user,
    sailing,
    body: createEventForm({ csrfToken: c.get('csrfToken') || '' }),
  }));
});

events.post('/events/create', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const readOnly = sailing ? isSailingReadOnly(sailing) : false;
  if (readOnly) return c.text('Archive mode', 403);

  const form = c.get('parsedForm') || await c.req.formData();
  const title    = (form.get('title') || '').toString().trim().slice(0, 200);
  const desc     = (form.get('description') || '').toString().trim().slice(0, 5000);
  const location = (form.get('location') || '').toString().trim().slice(0, 200);
  const startAt  = (form.get('start_at') || '').toString();
  const endAt    = (form.get('end_at') || '').toString();
  const category = (form.get('category') || 'other').toString();

  const errs = [];
  if (!title)   errs.push('Title is required.');
  if (!startAt) errs.push('Start time is required.');

  if (errs.length) {
    return c.html(layoutCtx(c, {
      title: 'Create a Deckspace Event',
      description: 'Create a public Deckspace event for this sailing so other passengers can find it, RSVP, and join in.',
      user,
      sailing,
      body: createEventForm({ error: errs.join(' '), values: { title, desc, location, startAt, endAt, category }, csrfToken: c.get('csrfToken') || '' })
    }), 400);
  }

  const { data: newEvent, error: insertErr } = await db.from('events').insert({
    sailing_id: c.env.SAILING_ID,
    creator_user_id: user.id,
    event_type: 'user',
    category,
    title,
    description: desc || null,
    location: location || null,
    start_at: new Date(startAt).toISOString(),
    end_at: endAt ? new Date(endAt).toISOString() : null,
    visibility: 'public',
    moderation_status: 'visible'
  }).select('id').single();

  if (insertErr || !newEvent) {
    return c.html(layoutCtx(c, {
      title: 'Create a Deckspace Event', description: 'Create a public Deckspace event for this sailing so other passengers can find it, RSVP, and join in.', user, sailing,
      body: createEventForm({ error: 'Could not create event. Please try again.', values: { title, desc, location, startAt, endAt, category }, csrfToken: c.get('csrfToken') || '' })
    }), 500);
  }

  return c.redirect('/events/' + newEvent.id);
});

/* ============================================================
   EVENT DETAIL
   ============================================================ */
events.get('/events/:id', async (c) => {
  const viewer  = await resolveSession(c.env, c.req.raw);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const page    = parseInt(c.req.query('page') || '1', 10);

  let event;
  try {
    event = await getEventById(db, c.req.param('id'));
  } catch (_) {
    return c.html(layoutCtx(c, { title: 'Event Not Found', user: viewer, sailing, body: '<div class="ds-empty-state">That event is not here anymore.</div>' }), 404);
  }

  if (event.moderation_status !== 'visible') {
    return c.html(layoutCtx(c, { title: 'Event Unavailable', user: viewer, sailing, body: '<div class="ds-empty-state">This event is not open right now.</div>' }), 410);
  }

  const [comments, userRsvp, attendees] = await Promise.all([
    getEventComments(db, event.id, page),
    viewer ? getUserRsvp(db, event.id, viewer.id) : Promise.resolve(null),
    db.from('event_rsvps')
      .select('user_id, status, users!event_rsvps_user_id_fkey(username, display_name, profiles(avatar_thumb_url))')
      .eq('event_id', event.id)
      .eq('status', 'going')
      .limit(20)
      .then(({ data }) => data || [])
  ]);

  const readOnly = sailing ? isSailingReadOnly(sailing) : false;
  const isCreator = viewer?.id === event.creator_user_id;

  const csrf = c.get('csrfToken') || '';
  const body = eventDetailPage({ event, comments, userRsvp, attendees, viewer, sailing, readOnly, isCreator, page, hasMore: comments.length === 30, cdnBase, csrfToken: csrf });

  return c.html(layoutCtx(c, {
    title: `${event.title} | Cruise Event`,
    description: event.description
      ? `${event.description.slice(0, 150)}`
      : `View details for ${event.title} on Deckspace, including time, location, RSVPs, and public comments.`,
    user: viewer,
    sailing,
    activeNav: 'events',
    body,
  }));
});

/* ============================================================
   RSVP
   ============================================================ */
events.post('/events/:id/rsvp', requireAuth, async (c) => {
  const user    = c.get('user');
  const eventId = c.req.param('id');
  const db      = getDb(c.env);
  const form    = c.get('parsedForm') || await c.req.formData();
  const status  = (form.get('status') || 'going').toString();
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  if (sailing && isSailingReadOnly(sailing)) return c.redirect('/events/' + eventId);

  await db.from('event_rsvps').upsert({
    event_id: eventId,
    user_id: user.id,
    status
  }, { onConflict: 'event_id,user_id' });

  // Keep rsvp_count in sync (belt-and-suspenders alongside DB trigger)
  const { count } = await db.from('event_rsvps')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'going');
  await db.from('events').update({ rsvp_count: count || 0 }).eq('id', eventId);

  // Notify event creator
  const { data: ev } = await db.from('events').select('creator_user_id, title').eq('id', eventId).single();
  if (ev && ev.creator_user_id !== user.id) {
    await createNotification(db, {
      userId: ev.creator_user_id,
      type: 'rsvp',
      objectType: 'event',
      objectId: eventId,
      actorId: user.id,
      message: `RSVPed to your event: ${ev.title}`
    });
  }

  return c.redirect('/events/' + eventId);
});

/* ============================================================
   EVENT COMMENTS
   ============================================================ */
events.post('/events/:id/comment', requireAuth, async (c) => {
  const user    = c.get('user');
  const eventId = c.req.param('id');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  if (sailing && isSailingReadOnly(sailing)) return c.redirect('/events/' + eventId);

  const form = c.get('parsedForm') || await c.req.formData();
  const body = (form.get('body') || '').toString().trim().slice(0, 1000);
  if (!body) return c.redirect('/events/' + eventId);

  await q(db.from('event_comments').insert({
    event_id: eventId,
    author_user_id: user.id,
    body
  }));

  return c.redirect('/events/' + eventId);
});

events.post('/events/:id/comment/:cid/delete', requireAuth, async (c) => {
  const user      = c.get('user');
  const commentId = c.req.param('cid');
  const eventId   = c.req.param('id');
  const db        = getDb(c.env);

  const { data: comment } = await db.from('event_comments').select('*').eq('id', commentId).single();
  if (!comment) return c.text('Not found', 404);

  const canDelete = comment.author_user_id === user.id || ['admin','moderator'].includes(user.role);
  if (!canDelete) return c.text('Forbidden', 403);

  await db.from('event_comments').update({ moderation_status: 'removed' }).eq('id', commentId);

  return c.redirect('/events/' + eventId);
});

/* ============================================================
   EDIT EVENT
   ============================================================ */
events.get('/events/:id/edit', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  let event;
  try { event = await getEventById(db, c.req.param('id')); } catch (_) { return c.text('Not found', 404); }

  const canEdit = event.creator_user_id === user.id || ['admin','moderator'].includes(user.role);
  if (!canEdit) return c.text('Forbidden', 403);

  return c.html(layoutCtx(c, {
    title: `Edit Event: ${event.title}`,
    description: `Update details for the event ${event.title} on Deckspace.`,
    user,
    sailing,
    body: createEventForm({ values: {
      title: event.title, desc: event.description, location: event.location,
      startAt: event.start_at, endAt: event.end_at, category: event.category
    }, eventId: event.id, csrfToken: c.get('csrfToken') || '' })
  }));
});

events.post('/events/:id/edit', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const eventId = c.req.param('id');
  const { data: event } = await db.from('events').select('*').eq('id', eventId).single();
  if (!event) return c.text('Not found', 404);

  const canEdit = event.creator_user_id === user.id || ['admin','moderator'].includes(user.role);
  if (!canEdit) return c.text('Forbidden', 403);

  const form     = c.get('parsedForm') || await c.req.formData();
  const title    = (form.get('title') || '').toString().trim().slice(0, 200);
  const desc     = (form.get('description') || '').toString().trim().slice(0, 5000);
  const location = (form.get('location') || '').toString().trim().slice(0, 200);
  const startAt  = (form.get('start_at') || '').toString();
  const endAt    = (form.get('end_at') || '').toString();
  const category = (form.get('category') || 'other').toString();

  await db.from('events').update({
    title: title || event.title,
    description: desc || null,
    location: location || null,
    start_at: startAt ? new Date(startAt).toISOString() : event.start_at,
    end_at: endAt ? new Date(endAt).toISOString() : null,
    category,
    updated_at: new Date().toISOString()
  }).eq('id', eventId);

  return c.redirect('/events/' + eventId);
});

/* ============================================================
   SCHEDULE PAGE TEMPLATE
   ============================================================ */
const DAY_HEADERS = [
  { label: 'Day 1', sub: 'Embarkation Day' },
  { label: 'Day 2', sub: 'At Sea' },
  { label: 'Day 3', sub: 'Port Day' },
  { label: 'Day 4', sub: 'Final Day' },
];

const CAT_ICONS = {
  karaoke:   () => ic.mic(14),
  trivia:    () => ic.lightbulb(14),
  dinner:    () => ic.utensils(14),
  deck:      () => ic.ship(14),
  social:    () => ic.users(14),
  excursion: () => ic.compass(14),
  drinks:    () => ic.glass(14),
  poker:     () => ic.diamond(14),
  theme:     () => ic.star(14),
  music:     () => ic.music(14),
  other:     () => ic.calendar(14),
};

function fmtTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isLateNightEvent(dateStr) {
  if (!dateStr) return false;
  const hour = new Date(dateStr).getHours();
  return hour >= 22 || hour < 2;
}

function filterEventsForView(events, view = 'all') {
  const items = [...events];
  switch (view) {
    case 'official':
      return items.filter((ev) => ev.event_type === 'official');
    case 'community':
      return items.filter((ev) => ev.event_type !== 'official');
    case 'late':
      return items.filter((ev) => isLateNightEvent(ev.start_at));
    case 'popular':
      return items.sort((a, b) => {
        const diff = (b.rsvp_count || 0) - (a.rsvp_count || 0);
        if (diff !== 0) return diff;
        return new Date(a.start_at) - new Date(b.start_at);
      });
    default:
      return items;
  }
}

function eventCategoryLabel(cat) {
  if (!cat) return 'Open Deck';
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function eventCategoryClass(cat) {
  return `cat-${(cat || 'other').replace(/[^a-z0-9_-]/gi, '')}`;
}

function eventMomentLabel(dateStr) {
  if (!dateStr) return 'All day';
  const hour = new Date(dateStr).getHours();
  if (hour < 5) return 'Overnight';
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Late evening';
}

function eventWindowLabel(event) {
  const start = fmtTime(event.start_at);
  if (!event.end_at) return start;
  return `${start} to ${fmtTime(event.end_at)}`;
}

function teaser(text = '', fallback = '') {
  const source = (text || fallback || '').trim();
  if (!source) return '';
  return source.length > 120 ? `${source.slice(0, 117).trim()}...` : source;
}

function viewLabel(view) {
  const labels = {
    all: 'Everything',
    official: 'Ship Schedule',
    community: 'Passenger Plans',
    popular: 'Most RSVPed',
    late: 'Later Today',
  };
  return labels[view] || 'Everything';
}

function viewDescription(view) {
  const labels = {
    official: 'Just the official ship schedule.',
    community: 'Only public passenger-created plans.',
    popular: 'Sorted by RSVP count.',
    late: 'Evening and late-night options.',
    all: 'Official programming and public passenger plans together.',
  };
  return labels[view] || labels.all;
}

function queryHref({ category = '', view = 'all' }) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (view && view !== 'all') params.set('view', view);
  const qs = params.toString();
  return qs ? `/events?${qs}` : '/events';
}

function eventsSchedulePage({ viewer, sailing, days, activeCategory = '', activeView = 'all', attendeesByEvent = {}, cdnBase = '' }) {
  const shipName = sailing?.ship_name || 'the ship';
  const allEvents = days.flatMap(([, evs]) => evs || []);
  const now = new Date();
  const totalEvents = allEvents.length;
  const officialCount = allEvents.filter((ev) => ev.event_type === 'official').length;
  const passengerCount = totalEvents - officialCount;
  const lateNightCount = allEvents.filter((ev) => isLateNightEvent(ev.start_at)).length;
  const nextUp = allEvents.find((ev) => new Date(ev.start_at) >= now) || allEvents[0] || null;
  const officialSpotlight = allEvents.find((ev) => ev.event_type === 'official' && new Date(ev.start_at) >= now)
    || allEvents.find((ev) => ev.event_type === 'official')
    || null;
  const communitySpotlight = [...allEvents]
    .filter((ev) => ev.event_type !== 'official')
    .sort((a, b) => (b.rsvp_count || 0) - (a.rsvp_count || 0))[0]
    || [...allEvents].sort((a, b) => (b.rsvp_count || 0) - (a.rsvp_count || 0))[0]
    || null;
  const busiestDay = days.reduce((best, current) => {
    if (!best || current[1].length > best[1].length) return current;
    return best;
  }, null);
  const dayJumps = days.map(([date, evs], idx) => {
    const dayInfo = DAY_HEADERS[idx] || { label: `Day ${idx + 1}`, sub: 'Schedule available for this day.' };
    const first = evs[0];
    return {
      anchor: `day-${date}`,
      label: dayInfo.label,
      sub: fmtShortDate(date),
      count: evs.length,
      firstTime: first ? fmtTime(first.start_at) : '',
    };
  });
  const openDayAnchor = nextUp ? `day-${nextUp.start_at.slice(0, 10)}` : dayJumps[0]?.anchor || '';

  // ---- LEFT RAIL ----
  const top8Items = [
    { title: 'Missed Call Confessional',               id: '4031ab55-ce1d-494c-8273-e7c8164b40ec' },
    { title: 'Battle of the Side Parts',               id: 'eae54a72-daae-4c5b-b804-afc85bb420f6' },
    { title: 'Breakup Letter Swap Meet',               id: '3ad94f37-753b-48a9-aeba-901d2b2ae6f2' },
    { title: 'Silent Disco: Internal Monologue Ed.',   id: 'daedb8fb-ae23-4ba3-8b15-bc3febe02ba8' },
    { title: 'Cringe Archive Screening',               id: '0e3f0a3e-2f14-41ad-952a-f45afaf779c0' },
    { title: "Acoustic Set You Weren't Ready For",     id: '3464f083-0c32-4791-9f47-46b7bc990c91' },
    { title: 'Away Message Workshop',                  id: '5ed0fc00-2f23-4462-a73d-3c1b7b42ad9f' },
    { title: 'The Deck at 3:17 AM',                    id: 'ac0dc68f-99ec-4015-8fc2-12f1d81b17a7' },
  ];

  const leftRail = `<aside class="ss-rail">
  <div class="ss-rail-badge">
    <div class="ss-badge-title">Shattered Shores</div>
    <div class="ss-badge-sub">Cruise Events</div>
    <div class="ss-badge-ship">${esc(shipName)}</div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.anchor(12)} Quick Plot</div>
    <div class="ds-module-body">
        <div class="ss-quick-plot">
          <div class="ss-plot-row"><span>Events live</span><strong>${totalEvents}</strong></div>
          <div class="ss-plot-row"><span>Official sets</span><strong>${officialCount}</strong></div>
          <div class="ss-plot-row"><span>Passenger plans</span><strong>${passengerCount}</strong></div>
        <div class="ss-plot-row"><span>Late events</span><strong>${lateNightCount}</strong></div>
        </div>
    </div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.calendar(12)} Jump to a Day</div>
    <div class="ds-module-body">
      ${dayJumps.length
        ? `<ul class="ss-day-jump-list">
            ${dayJumps.map((jump) => `<li><a href="#${jump.anchor}">${esc(jump.label)}</a><span>${esc(jump.sub)}</span><strong>${jump.count}</strong></li>`).join('')}
          </ul>`
        : `<div class="ss-small-copy">Nothing is posted yet.</div>`}
    </div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.star(12)} Top 8 Events</div>
    <div class="ds-module-body">
      <ol class="ss-top8">
        ${top8Items.map(t => `<li><a href="/events/${esc(t.id)}">${esc(t.title)}</a></li>`).join('')}
      </ol>
    </div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.flag(12)} Quick Guide</div>
    <div class="ds-module-body ss-bulletin">
      Start with a browse mode, then open a day. RSVP counts help show which plans are most active.
    </div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.users(12)} Right Now</div>
    <div class="ds-module-body">
      <div class="ss-right-now">
        <div><strong>${nextUp ? esc(fmtTime(nextUp.start_at)) : 'TBD'}</strong><span>next scheduled event</span></div>
        <div><strong>${communitySpotlight ? `${communitySpotlight.rsvp_count || 0} going` : 'Quiet'}</strong><span>most active passenger plan</span></div>
        <div><strong>${busiestDay ? busiestDay[1].length : 0} events</strong><span>${busiestDay ? `${fmtShortDate(busiestDay[0])} has the most events` : 'schedule still loading'}</span></div>
      </div>
    </div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.info(12)} Event Legend</div>
    <div class="ds-module-body">
      <table class="ss-legend-table" aria-label="Event legend">
        <caption class="sr-only">Event legend for icons and labels</caption>
        <tr><th scope="row">${ic.music(13)}</th><td>Live Set</td></tr>
        <tr><th scope="row">${ic.heart(13)}</th><td>Social Event</td></tr>
        <tr><th scope="row">${ic.msgSquare(13)}</th><td>Late Event</td></tr>
        <tr><th scope="row">${ic.mic(13)}</th><td>Interactive</td></tr>
        <tr><th scope="row">${ic.alertTri(13)}</th><td>Important Update</td></tr>
        <tr><th scope="row">${ic.anchor(13)}</th><td>Open Deck</td></tr>
      </table>
    </div>
  </div>

  ${viewer ? `<div class="ss-create-link"><a href="/events/create">+ Create Event</a></div>` : ''}
</aside>`;

  // ---- MAIN CONTENT ----

  const catPills = `<div class="event-cat-pills">
    <a href="${queryHref({ view: activeView })}" class="event-cat-pill${!activeCategory ? ' active' : ''}">All</a>
    ${EVENT_CATEGORIES.map(cat =>
      `<a href="${queryHref({ category: cat, view: activeView })}" class="event-cat-pill${activeCategory === cat ? ' active' : ''}">${CAT_ICONS[cat] ? CAT_ICONS[cat]() : ''}${esc(cat)}</a>`
    ).join('')}
  </div>`;

  const viewPills = `<div class="ss-view-pills">
    ${EVENT_VIEWS.map((view) => `<a href="${queryHref({ category: activeCategory, view })}" class="ss-view-pill${activeView === view ? ' active' : ''}">${esc(viewLabel(view))}</a>`).join('')}
  </div>`;

  const hero = `<section class="ss-banner ss-banner-modern">
  <div class="ss-banner-copy">
    <div class="ss-banner-kicker">${ic.shipWheel(13)} Deckspace Events Board</div>
    <div class="ss-banner-title">Your shipboard calendar and public event board.</div>
    <div class="ss-banner-sub">${esc(viewDescription(activeView))}</div>
  </div>
  <div class="ss-banner-meta">
    <div class="ss-banner-stat"><strong>${totalEvents}</strong><span>events on deck</span></div>
    <div class="ss-banner-stat"><strong>${officialCount}</strong><span>official events</span></div>
    <div class="ss-banner-stat"><strong>${passengerCount}</strong><span>passenger plans</span></div>
    <div class="ss-banner-stat"><strong>${lateNightCount}</strong><span>after-hours options</span></div>
  </div>
</section>`;

  const spotlightStrip = `<section class="ss-highlight-grid">
  <article class="ss-highlight-card">
    <div class="ss-highlight-label">${ic.calendar(12)} Next Up</div>
    ${nextUp
      ? `<a href="/events/${esc(nextUp.id)}" class="ss-highlight-title">${esc(nextUp.title)}</a>
         <div class="ss-highlight-meta">${fmtShortDate(nextUp.start_at)} at ${fmtTime(nextUp.start_at)}${nextUp.location ? ` &middot; ${esc(nextUp.location)}` : ''}</div>`
      : `<div class="ss-highlight-empty">No event is scheduled right now.</div>`}
  </article>
  <article class="ss-highlight-card">
    <div class="ss-highlight-label">${ic.ship(12)} Official Spotlight</div>
    ${officialSpotlight
      ? `<a href="/events/${esc(officialSpotlight.id)}" class="ss-highlight-title">${esc(officialSpotlight.title)}</a>
         <div class="ss-highlight-meta">${fmtShortDate(officialSpotlight.start_at)} at ${fmtTime(officialSpotlight.start_at)}${officialSpotlight.location ? ` &middot; ${esc(officialSpotlight.location)}` : ''}</div>`
      : `<div class="ss-highlight-empty">No official ship plans are posted in this slice yet.</div>`}
  </article>
  <article class="ss-highlight-card">
    <div class="ss-highlight-label">${ic.users(12)} Passenger Plan</div>
    ${communitySpotlight
      ? `<a href="/events/${esc(communitySpotlight.id)}" class="ss-highlight-title">${esc(communitySpotlight.title)}</a>
         <div class="ss-highlight-meta">${communitySpotlight.rsvp_count || 0} going${communitySpotlight.location ? ` &middot; ${esc(communitySpotlight.location)}` : ''}</div>`
      : `<div class="ss-highlight-empty">No passenger plan is highlighted yet.</div>`}
  </article>
</section>`;

  const plannerControls = `<div class="ss-planner-controls">
  <div class="ss-planner-topline">
    <strong>Browse mode:</strong> pick a view first, then narrow by category.
  </div>
  ${viewPills}
  ${catPills}
  ${dayJumps.length ? `<div class="ss-day-jumps-inline">${dayJumps.map((jump) => `<a href="#${jump.anchor}" class="ss-day-jump-pill">${esc(jump.label)} <span>${jump.count}</span><em>${esc(jump.firstTime || 'TBD')}</em></a>`).join('')}</div>` : ''}
</div>`;

  const dayModules = days.map(([date, evs], idx) => {
    const dayInfo = DAY_HEADERS[idx] || { label: `Day ${idx + 1}`, sub: 'Schedule available for this day.' };
    const officialDayCount = evs.filter((ev) => ev.event_type === 'official').length;
    const guestDayCount = evs.length - officialDayCount;
    const peakPull = [...evs].sort((a, b) => (b.rsvp_count || 0) - (a.rsvp_count || 0))[0];
    const rows = evs.map((ev) => {
      const icon = CAT_ICONS[ev.category] || CAT_ICONS.other;
      const tone = ev.event_type === 'official' ? 'official' : 'guest';
      const desc = teaser(ev.description, ev.event_type === 'official'
        ? 'Official ship programming with a cleaner clock and a clearer plan.'
        : 'Passenger-created plan. Public and open to people on this sailing.');
      const cover = ev.cover_image_url
        ? `<img src="${esc(absUrl(cdnBase, ev.cover_image_url))}" alt="Event art for ${esc(ev.title)}" width="96" height="96" class="ss-event-cover-image" loading="lazy">`
        : `<div class="ss-event-cover-fallback ${eventCategoryClass(ev.category)}">${icon()}</div>`;
      const attendeePreview = attendeesByEvent[ev.id] || [];
      const attendeeLead = attendeePreview[0]?.display_name || attendeePreview[0]?.username || '';
      const attendeeCopy = attendeePreview.length
        ? `${esc(attendeeLead)}${ev.rsvp_count > 1 ? ` and ${Math.max((ev.rsvp_count || attendeePreview.length) - 1, 0)} more going` : ' is going'}`
        : `${ev.rsvp_count || 0} going so far`;
      const attendeeFaces = attendeePreview.length
        ? attendeePreview.map((person) => {
            const thumbUrl = absUrl(cdnBase, person?.profiles?.avatar_thumb_url);
            return thumbUrl && !isLegacyAvatarUrl(thumbUrl)
              ? `<img src="${esc(thumbUrl)}" width="24" height="24" alt="${esc(person?.display_name || person?.username || 'Passenger')}" class="ss-event-attendee-face" loading="lazy">`
              : pixelAvatarImg(person?.display_name || 'Passenger', person?.username || person?.display_name || '', 24, 'ss-event-attendee-face ss-event-attendee-pixel');
          }).join('')
        : '';
      return `<article class="ss-event-card ss-event-card-${tone} ${eventCategoryClass(ev.category)}">
  <div class="ss-event-time-block">
    <span class="ss-event-time-main">${fmtTime(ev.start_at)}</span>
    <span class="ss-event-time-sub">${esc(eventMomentLabel(ev.start_at))}</span>
  </div>
  <div class="ss-event-visual">${cover}</div>
  <div class="ss-event-copy">
    <div class="ss-event-chip-row">
      <span class="ss-event-chip ss-event-chip-${tone}">${ev.event_type === 'official' ? 'Official' : 'Passenger Plan'}</span>
      <span class="ss-event-chip ss-event-chip-category">${esc(eventCategoryLabel(ev.category))}</span>
      <span class="ss-event-chip ss-event-chip-rsvp">${ev.rsvp_count || 0} going</span>
    </div>
    <h2 class="ss-event-title"><a href="/events/${esc(ev.id)}">${esc(ev.title)}</a></h2>
    <p class="ss-event-description">${esc(desc)}</p>
    <div class="ss-event-meta-row">
      <span>${ic.mapPin(11)} ${esc(ev.location || 'Location coming soon')}</span>
      <span>${ic.clock(11)} ${esc(eventWindowLabel(ev))}</span>
      <span>${ev.event_type === 'official' ? `${ic.ship(11)} Ship-run` : `${ic.users(11)} Guest-led`}</span>
    </div>
    <div class="ss-event-social-row">
      ${attendeeFaces ? `<div class="ss-event-attendees">${attendeeFaces}</div>` : ''}
      <div class="ss-event-attendance-copy">${attendeeCopy}</div>
    </div>
  </div>
  <div class="ss-event-action">
    <a href="/events/${esc(ev.id)}" class="ss-event-link">Open event</a>
  </div>
</article>`;
    }).join('');

    return `<details class="ds-module ss-day-module ss-day-drawer" id="day-${date}"${openDayAnchor === `day-${date}` ? ' open' : ''}>
  <summary class="ds-module-header ss-day-header">
    <div class="ss-day-heading">
      <span class="ss-day-label">${dayInfo.label}</span>
      <span class="ss-day-date">${esc(fmtShortDate(date))}</span>
      <span class="ss-day-sub">${dayInfo.sub}</span>
    </div>
    <div class="ss-day-summary">
      <span>${evs.length} total</span>
      <span>${officialDayCount} official</span>
      <span>${guestDayCount} guest</span>
      ${peakPull ? `<span>${peakPull.rsvp_count || 0} top RSVP</span>` : ''}
    </div>
  </summary>
  <div class="ds-module-body ss-day-body">
    ${rows}
  </div>
</details>`;
  }).join('');

  const noEventsMsg = days.length === 0
    ? `<div class="ds-empty-state ss-events-empty">No events are up yet. ${viewer ? '<a href="/events/create">Post the first one.</a>' : 'Check back once the board fills in.'}</div>`
    : '';

  const mainContent = `<section class="ss-main">
  ${hero}
  ${spotlightStrip}
  ${plannerControls}
  ${noEventsMsg}
  ${dayModules}
</section>`;

  return `<div class="ss-wrap">${leftRail}${mainContent}</div>`;
}

/* ============================================================
   TEMPLATES
   ============================================================ */
function eventDetailPage({ event, comments, userRsvp, attendees, viewer, sailing, readOnly, isCreator, page, hasMore, cdnBase, csrfToken }) {
  const creator = event.users;
  const coverImg = event.cover_image_url
    ? `<img src="${esc(absUrl(cdnBase, event.cover_image_url))}" alt="Cover image for ${esc(event.title)}" width="720" height="360" class="event-detail-cover-image">`
    : `<div class="event-detail-cover-fallback ${eventCategoryClass(event.category)}">${(CAT_ICONS[event.category] || CAT_ICONS.other)(34)}</div>`;

  // RSVP state
  let rsvpHtml = '';
  if (viewer && !readOnly) {
    const going = userRsvp?.status === 'going';
    const interested = userRsvp?.status === 'interested';
    rsvpHtml = `<div class="event-action-row">
    <form method="POST" action="/events/${esc(event.id)}/rsvp" class="event-inline-form">
      ${csrfField(csrfToken)}
      <input type="hidden" name="status" value="${going ? 'not_going' : 'going'}">
      <button type="submit" class="rsvp-btn${going ? ' going' : ''}">
        ${going ? `${ic.check(12)} Going` : '+ RSVP Going'}
      </button>
    </form>
    ${!going ? `<form method="POST" action="/events/${esc(event.id)}/rsvp" class="event-inline-form">
      ${csrfField(csrfToken)}
      <input type="hidden" name="status" value="${interested ? 'not_going' : 'interested'}">
      <button type="submit" class="ds-btn ds-btn-sm">${interested ? `${ic.check(12)} Interested` : 'Interested'}</button>
    </form>` : ''}`;
    rsvpHtml += `</div>`;
  }

  // Attendees
  const attendeeHtml = attendees.length
    ? attendees.map(a => {
        const thumbUrl = absUrl(cdnBase, a.users?.profiles?.avatar_thumb_url);
        return `<a href="/profile/${esc(a.users?.username || '')}" title="${esc(a.users?.display_name || '')}" aria-label="View ${esc(a.users?.display_name || 'this passenger')}'s profile">
          ${thumbUrl && !isLegacyAvatarUrl(thumbUrl)
            ? `<img src="${esc(thumbUrl)}" width="32" height="32" alt="${esc(a.users?.display_name || 'Passenger')}" loading="lazy" style="border:1px solid #ccc">`
            : pixelAvatarImg(a.users?.display_name || 'Passenger', a.users?.username || a.users?.display_name || '', 32, 'event-attendee-pixel-avatar')}
        </a>`;
      }).join(' ')
    : `<span class="text-muted text-small">No one has RSVPed yet.</span>`;

  // Comments
  const commentListHtml = comments.length
    ? comments.map(c => commentEntry({
        authorUser: c.users, body: c.body, time: c.created_at, id: c.id, cdnBase,
        viewerUser: viewer,
        deleteAction: `/events/${esc(event.id)}/comment/${esc(c.id)}/delete`,
        canDelete: viewer && (viewer.id === c.author_user_id || ['admin','moderator'].includes(viewer.role)),
        targetType: 'event_comment',
        redirectTo: `/events/${esc(event.id)}`,
        csrfToken,
      })).join('')
    : `<div class="ds-empty-state">No comments yet. Be the first to jump in.</div>`;

  const commentForm = viewer && !readOnly
    ? `<div class="comment-form">
        <form method="POST" action="/events/${esc(event.id)}/comment" data-retry="true">
          ${csrfField(csrfToken)}
          <div class="ds-form-row">
            <textarea name="body" class="ds-textarea" placeholder="Leave a comment..." required maxlength="1000"></textarea>
          </div>
          <div class="form-row">
            <button type="submit" class="ds-btn ds-btn-primary ds-btn-sm" data-loading-text="Posting...">Post Comment</button>
          </div>
        </form>
       </div>`
    : '';

  const editLink = isCreator ? `<a href="/events/${esc(event.id)}/edit" class="ds-btn ds-btn-sm">Edit Event</a>` : '';
  const hostName = creator?.display_name || 'Unknown';
  const hostLink = creator?.username ? `<a href="/profile/${esc(creator.username)}">${esc(hostName)}</a>` : esc(hostName);
  const factList = `<ul class="event-facts-list">
    <li><span>When</span><strong>${esc(fmtDate(event.start_at, { time: true }))}${event.end_at ? ` to ${esc(fmtTime(event.end_at))}` : ''}</strong></li>
    <li><span>Where</span><strong>${esc(event.location || 'Location will show up soon')}</strong></li>
    <li><span>Host</span><strong>${hostLink}</strong></li>
    <li><span>Type</span><strong>${esc(event.event_type === 'official' ? 'Official programming' : 'Passenger plan')}</strong></li>
  </ul>`;

  return `<div class="event-detail-shell">
  <section class="event-detail-header ds-module">
    <div class="ds-module-header blue">${ic.calendar(12)} ${esc(event.event_type === 'official' ? 'Official Event' : 'Open Event')}</div>
    <div class="ds-module-body event-detail-body">
      <div class="event-detail-cover">${coverImg}</div>
      <div class="event-detail-content">
        <div class="event-detail-chip-row">
          <span class="ss-event-chip ss-event-chip-${event.event_type === 'official' ? 'official' : 'guest'}">${event.event_type === 'official' ? 'Official Programming' : 'Passenger Plan'}</span>
          <span class="ss-event-chip ss-event-chip-category">${esc(eventCategoryLabel(event.category))}</span>
          <span class="ss-event-chip ss-event-chip-rsvp">${event.rsvp_count} going</span>
        </div>
        <div class="event-detail-title">${esc(event.title)}</div>
        <div class="event-detail-meta-grid">
          <div class="event-detail-meta-card"><span>${ic.clock(12)} Time</span><strong>${esc(eventWindowLabel(event))}</strong></div>
          <div class="event-detail-meta-card"><span>${ic.mapPin(12)} Location</span><strong>${esc(event.location || 'Location coming soon')}</strong></div>
          <div class="event-detail-meta-card"><span>${ic.user(12)} Host</span><strong>${hostLink}</strong></div>
          <div class="event-detail-meta-card"><span>${ic.info(12)} Time of Day</span><strong>${esc(eventMomentLabel(event.start_at))}</strong></div>
        </div>
        <div class="event-rsvp-count">${event.rsvp_count} going</div>
        <div class="event-rsvp-actions">${rsvpHtml} ${editLink}</div>
        ${event.description
          ? `<div class="event-description">${esc(event.description)}</div>`
          : `<div class="event-description event-description-empty">No host note yet. Check the time, place, and RSVP count for details.</div>`}
      </div>
    </div>
  </section>

  <aside class="event-detail-side">
    ${module({ header: `${ic.users(12)} Who's Going`, body: `<div class="event-attendee-wrap">${attendeeHtml}</div>` })}
    ${module({ header: `${ic.info(12)} Quick Facts`, body: factList })}
  </aside>
</div>

${module({
  header: `${ic.msgSquare(12)} Comments`,
  body: `<div class="comment-list">${commentListHtml}</div>${paginator(page, hasMore, `/events/${event.id}`)}${commentForm}`
})}`;
}

function createEventForm({ error, values = {}, eventId, csrfToken = '' }) {
  const action = eventId ? `/events/${esc(eventId)}/edit` : '/events/create';
  const btnText = eventId ? 'Save Changes' : 'Create Event';
  const categories = ['karaoke','trivia','dinner','deck','excursion','drinks','poker','theme','other'];
  const catOptions = categories.map(cat =>
    `<option value="${cat}" ${(values.category || 'other') === cat ? 'selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`
  ).join('');

  return `<div style="max-width:540px;margin:0 auto">
  ${error ? `<div class="ds-flash error">${esc(error)}</div>` : ''}
  <div class="ds-module">
    <div class="ds-module-header">${ic.calendar(12)} ${eventId ? 'Edit Event' : 'Create a New Event'}</div>
    <div class="ds-module-body">
      <form method="POST" action="${action}" class="ds-form">
        ${csrfField(csrfToken)}
        <div class="ds-form-row">
          <label for="ev-title">Title *</label>
          <input id="ev-title" name="title" type="text" class="ds-input" value="${esc(values.title || '')}" required maxlength="200" placeholder="e.g. Karaoke Night at the Crow Bar">
        </div>
        <div class="ds-form-row">
          <label for="ev-cat">Type / Category</label>
          <select id="ev-cat" name="category" class="ds-select">${catOptions}</select>
        </div>
        <div class="ds-form-row">
          <label for="ev-desc">Description</label>
          <textarea id="ev-desc" name="description" class="ds-textarea" rows="4" maxlength="5000" placeholder="Tell people what this is about...">${esc(values.desc || '')}</textarea>
        </div>
        <div class="ds-form-row">
          <label for="ev-location">Location</label>
          <input id="ev-location" name="location" type="text" class="ds-input" value="${esc(values.location || '')}" maxlength="200" placeholder="Pool deck, Lido Bar, etc.">
        </div>
        <div class="ds-form-row">
          <label for="ev-start">Start Time *</label>
          <input id="ev-start" name="start_at" type="datetime-local" class="ds-input" value="${values.startAt ? values.startAt.slice(0,16) : ''}" required>
        </div>
        <div class="ds-form-row">
          <label for="ev-end">End Time <span style="font-weight:normal;color:#999">(optional)</span></label>
          <input id="ev-end" name="end_at" type="datetime-local" class="ds-input" value="${values.endAt ? values.endAt.slice(0,16) : ''}">
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-orange" data-loading-text="Saving...">${btnText}</button>
          <a href="/events" class="ds-btn" style="margin-left:6px">Cancel</a>
        </div>
      </form>
    </div>
  </div>
</div>`;
}

export default events;
