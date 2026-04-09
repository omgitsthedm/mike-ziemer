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
import { layout, layoutCtx, esc, fmtDate, relTime } from '../templates/layout.js';
import { module, eventCard, commentEntry, paginator, absUrl } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const events = new Hono();

/* ============================================================
   EVENTS LIST — Shattered Shores MySpace-style schedule
   ============================================================ */
const EVENT_CATEGORIES = ['karaoke','trivia','dinner','deck','social','excursion','drinks','poker','theme','music','other'];

events.get('/events', async (c) => {
  const viewer   = await resolveSession(c.env, c.req.raw);
  const db       = getDb(c.env);
  const sailing  = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const category = (c.req.query('category') || '').toLowerCase().trim();

  // Fetch all visible public events for the sailing, ordered by time
  let evQuery = db.from('events')
    .select('id, title, location, start_at, category, event_type, rsvp_count, description')
    .eq('sailing_id', c.env.SAILING_ID)
    .eq('moderation_status', 'visible')
    .eq('visibility', 'public')
    .order('start_at', { ascending: true })
    .limit(200);

  if (category && EVENT_CATEGORIES.includes(category)) {
    evQuery = evQuery.eq('category', category);
  }

  const { data: allEventsRaw } = await evQuery;

  // Group by calendar date
  const dayMap = new Map();
  for (const ev of allEventsRaw || []) {
    const d = ev.start_at.slice(0, 10);
    if (!dayMap.has(d)) dayMap.set(d, []);
    dayMap.get(d).push(ev);
  }
  const days = [...dayMap.entries()];

  const body = eventsSchedulePage({ viewer, sailing, days, activeCategory: category });

  return c.html(layoutCtx(c, {
    title: 'Events',
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
    title: 'Create Event',
    user,
    sailing,
    body: createEventForm({}),
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
      title: 'Create Event',
      user,
      sailing,
      body: createEventForm({ error: errs.join(' '), values: { title, desc, location, startAt, endAt, category } })
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
      title: 'Create Event', user, sailing,
      body: createEventForm({ error: 'Could not create event. Please try again.', values: { title, desc, location, startAt, endAt, category } })
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
    return c.html(layoutCtx(c, { title: 'Not Found', user: viewer, sailing, body: '<div class="ds-empty-state">Event not found.</div>' }), 404);
  }

  if (event.moderation_status !== 'visible') {
    return c.html(layoutCtx(c, { title: 'Unavailable', user: viewer, sailing, body: '<div class="ds-empty-state">This event is not available.</div>' }), 410);
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
    title: event.title,
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
    title: 'Edit Event',
    user,
    sailing,
    body: createEventForm({ values: {
      title: event.title, desc: event.description, location: event.location,
      startAt: event.start_at, endAt: event.end_at, category: event.category
    }, eventId: event.id })
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
  { label: 'Day 1', sub: 'Embarkation / &ldquo;We&rsquo;re Really Doing This&rdquo;' },
  { label: 'Day 2', sub: 'Socially Active, Spiritually Unwell' },
  { label: 'Day 3', sub: 'The Point of No Return' },
  { label: 'Day 4', sub: 'Disembarkation, Denial, and Questionable Closure' },
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

function eventsSchedulePage({ viewer, sailing, days, activeCategory = '' }) {
  const shipName = sailing?.ship_name || 'the ship';

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

  const leftRail = `<div class="ss-rail">
  <div class="ss-rail-badge">
    <div class="ss-badge-title">Shattered Shores</div>
    <div class="ss-badge-sub">Cruise Events</div>
    <div class="ss-badge-ship">${esc(shipName)}</div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.anchor(12)} Now Boarding</div>
    <div class="ds-module-body ss-nowboarding">
      <table class="ss-info-table">
        <tr><td class="ss-info-key">Theme:</td><td>Emo / Rock / Scene</td></tr>
        <tr><td class="ss-info-key">Produced By:</td><td>Whet Travel</td></tr>
        <tr><td class="ss-info-key">Status:</td><td class="ss-status-val">emotionally unstable</td></tr>
        <tr><td class="ss-info-key">Dress Code:</td><td>black, white, striped, dramatic</td></tr>
        <tr><td class="ss-info-key">Vibe Level:</td><td>late-night top-deck honesty</td></tr>
      </table>
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
    <div class="ds-module-header">${ic.flag(12)} Cruise Bulletin</div>
    <div class="ds-module-body ss-bulletin">
      Whoever keeps leaving fully devastating voice messages in Missed Call Confessional needs to either be stopped or given a headlining slot.
    </div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.users(12)} Who&rsquo;s Here</div>
    <div class="ds-module-body">
      <table class="ss-online-table">
        <tr><td class="ss-online-num">148</td><td>guests online now</td></tr>
        <tr><td class="ss-online-num">23</td><td>currently overthinking</td></tr>
        <tr><td class="ss-online-num">11</td><td>reorganizing their Top 8</td></tr>
        <tr><td class="ss-online-num">6</td><td>pretending they &ldquo;don&rsquo;t really dance&rdquo;</td></tr>
        <tr><td class="ss-online-num">1</td><td>definitely in a stairwell crying in a cool way</td></tr>
      </table>
    </div>
  </div>

  <div class="ds-module ss-rail-module">
    <div class="ds-module-header">${ic.info(12)} Event Legend</div>
    <div class="ds-module-body">
      <table class="ss-legend-table">
        <tr><td>${ic.music(13)}</td><td>Live Set</td></tr>
        <tr><td>${ic.heart(13)}</td><td>Social Damage</td></tr>
        <tr><td>${ic.msgSquare(13)}</td><td>Late Night</td></tr>
        <tr><td>${ic.mic(13)}</td><td>Interactive</td></tr>
        <tr><td>${ic.alertTri(13)}</td><td>Emotional Hazard</td></tr>
        <tr><td>${ic.anchor(13)}</td><td>Deck / Unscheduled</td></tr>
      </table>
    </div>
  </div>

  ${viewer ? `<div class="ss-create-link"><a href="/events/create">+ Create Event</a></div>` : ''}
</div>`;

  // ---- MAIN CONTENT ----

  // Status bar
  const statusBar = `<div class="ss-status-bar">
  <span class="ss-status-item"><strong>Mood:</strong> cautiously devastated</span>
  <span class="ss-status-sep">|</span>
  <span class="ss-status-item"><strong>Listening To:</strong> ocean sounds + a song that still has too much power over you</span>
  <span class="ss-status-sep">|</span>
  <span class="ss-status-item"><strong>Status:</strong> on board / emotionally buffering</span>
  <span class="ss-status-sep">|</span>
  <span class="ss-status-item"><strong>Last Updated:</strong> 2:13 AM</span>
</div>`;

  // Category pill filter nav
  const catPills = `<div class="event-cat-pills">
    <a href="/events" class="event-cat-pill${!activeCategory ? ' active' : ''}">All</a>
    ${EVENT_CATEGORIES.map(cat =>
      `<a href="/events?category=${encodeURIComponent(cat)}" class="event-cat-pill${activeCategory === cat ? ' active' : ''}">${CAT_ICONS[cat] ? CAT_ICONS[cat]() : ''}${esc(cat)}</a>`
    ).join('')}
  </div>`;

  // Intro blurb
  const intro = `<div class="ss-intro">
  Welcome aboard <strong>Shattered Shores Cruise</strong>. This is your official-ish guide to what&rsquo;s happening on ${esc(shipName)}.
  Some events are planned. Some just happen. Some should maybe not happen, but here we are.
  Check back often, reshuffle your emotional priorities accordingly, and remember:
  missing an event may haunt you longer than attending it.
</div>
${catPills}`;

  // Day schedule modules
  const dayModules = days.map(([date, evs], idx) => {
    const dayInfo = DAY_HEADERS[idx] || { label: `Day ${idx + 1}`, sub: '' };
    const rows = evs.map(ev => {
      const icon = CAT_ICONS[ev.category] || CAT_ICONS.other;
      const time = fmtTime(ev.start_at);
      return `<tr class="ss-row">
  <td class="ss-time">${time}</td>
  <td class="ss-icon">${icon()}</td>
  <td class="ss-evtitle"><a href="/events/${esc(ev.id)}">${esc(ev.title)}</a></td>
  <td class="ss-loc">${esc(ev.location || '')}</td>
  <td class="ss-rsvp">${ev.rsvp_count > 0 ? `${ev.rsvp_count} going` : ''}</td>
</tr>`;
    }).join('');

    return `<div class="ds-module ss-day-module">
  <div class="ds-module-header ss-day-header">
    <span class="ss-day-label">${dayInfo.label}</span>
    <span class="ss-day-sub">&mdash; ${dayInfo.sub}</span>
  </div>
  <div class="ds-module-body" style="padding:0">
    <table class="ss-schedule">
      <thead><tr>
        <th class="ss-th-time">Time</th>
        <th class="ss-th-icon"></th>
        <th class="ss-th-title">Event</th>
        <th class="ss-th-loc">Location</th>
        <th class="ss-th-rsvp">RSVPs</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
  }).join('');

  // No events fallback
  const noEventsMsg = days.length === 0
    ? `<div class="ds-empty-state">No events scheduled yet. ${viewer ? '<a href="/events/create">Create the first one.</a>' : 'Check back soon.'}</div>`
    : '';

  // Random Incidents
  const incidents = [
    'Found on Deck: one single black Converse, owner unknown.',
    'Flash Poll: best black eyeliner survival technique in ocean humidity.',
    'Emergency Bulletin: someone changed their Top 8 and the ship is still recovering.',
    'Tiny Set Alert: stairwell performance in 10 minutes. act casual.',
    'Weather Report: emotionally overcast with isolated breakthroughs.',
    'Photo Drop: new blurry photos added at the Crisis Center.',
  ];
  const incidentsModule = `<div class="ds-module">
  <div class="ds-module-header">${ic.alertTri(12)} Random Incidents</div>
  <div class="ds-module-body">
    <ul class="ss-incidents">
      ${incidents.map(i => `<li>${i}</li>`).join('')}
    </ul>
  </div>
</div>`;

  // Fake comments
  const fakeComments = [
    { user: 'xX_bleedingxheart_Xx', body: 'whoever scheduled stay in your cabin &amp; spiral is sick for that' },
    { user: 'sidepartsurvivor',      body: 'battle of the side parts changed my life and my center of gravity' },
    { user: 'portsideghost',         body: 'missed call confessional should legally count as therapy' },
    { user: 'lowercaseforever',       body: 'i came here for the music and left with 4 new mutuals and one unresolved situation' },
    { user: 'cringe_archivist',      body: 'the lyric notebook exhibition ruined me in the most healing possible way' },
  ];
  const commentsModule = `<div class="ds-module">
  <div class="ds-module-header">${ic.msgSquare(12)} Comments</div>
  <div class="ds-module-body" style="padding:0">
    ${fakeComments.map(fc => `<div class="ss-fake-comment">
  <span class="ss-fc-user">${fc.user}</span>:
  <span class="ss-fc-body">&ldquo;${fc.body}&rdquo;</span>
</div>`).join('')}
  </div>
</div>`;

  const mainContent = `<div class="ss-main">
  <div class="ss-banner">
    <div class="ss-banner-title">Shattered Shores Cruise &mdash; Events</div>
    <div class="ss-banner-sub">4 days at sea, 37 emotional incidents, 1 smaller ship, no escape.</div>
  </div>
  ${statusBar}
  ${intro}
  ${noEventsMsg}
  ${dayModules}
  ${incidentsModule}
  ${commentsModule}
</div>`;

  return `<div class="ss-wrap">${leftRail}${mainContent}</div>`;
}

/* ============================================================
   TEMPLATES
   ============================================================ */
function eventDetailPage({ event, comments, userRsvp, attendees, viewer, sailing, readOnly, isCreator, page, hasMore, cdnBase, csrfToken }) {
  const creator = event.users;
  const coverImg = event.cover_image_url
    ? `<img src="${esc(absUrl(cdnBase, event.cover_image_url))}" alt="" style="max-width:100%;max-height:200px;object-fit:cover;display:block;margin-bottom:8px" loading="lazy">`
    : '';

  // RSVP state
  let rsvpHtml = '';
  if (viewer && !readOnly) {
    const going = userRsvp?.status === 'going';
    const interested = userRsvp?.status === 'interested';
    rsvpHtml = `<form method="POST" action="/events/${esc(event.id)}/rsvp" style="display:inline-flex;gap:4px;align-items:center">
      <input type="hidden" name="status" value="${going ? 'not_going' : 'going'}">
      <button type="submit" class="rsvp-btn${going ? ' going' : ''}">
        ${going ? `${ic.check(12)} Going` : '+ RSVP Going'}
      </button>
    </form>
    ${!going ? `<form method="POST" action="/events/${esc(event.id)}/rsvp" style="display:inline;margin-left:4px">
      <input type="hidden" name="status" value="${interested ? 'not_going' : 'interested'}">
      <button type="submit" class="ds-btn ds-btn-sm">${interested ? `${ic.check(12)} Interested` : 'Interested'}</button>
    </form>` : ''}`;
  }

  // Attendees
  const attendeeHtml = attendees.length
    ? attendees.map(a => {
        const thumbUrl = absUrl(cdnBase, a.users?.profiles?.avatar_thumb_url);
        return `<a href="/profile/${esc(a.users?.username || '')}" title="${esc(a.users?.display_name || '')}">
          ${thumbUrl
            ? `<img src="${esc(thumbUrl)}" width="32" height="32" loading="lazy" style="border:1px solid #ccc">`
            : `<span style="display:inline-block;width:32px;height:32px;background:#e8e8e8;border:1px solid #ccc;text-align:center;line-height:32px;font-size:10px">${esc((a.users?.display_name || '?').charAt(0))}</span>`}
        </a>`;
      }).join(' ')
    : `<span class="text-muted text-small">No RSVPs yet.</span>`;

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
    : `<div class="ds-empty-state">No comments yet. Be the first!</div>`;

  const commentForm = viewer && !readOnly
    ? `<div class="comment-form">
        <form method="POST" action="/events/${esc(event.id)}/comment" data-retry="true">
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

  return `<div class="event-detail-header ds-module">
  <div class="ds-module-header blue">${ic.calendar(12)} ${esc(event.event_type === 'official' ? 'Official Event' : 'Event')}</div>
  <div class="ds-module-body">
    ${coverImg}
    <div class="event-detail-title">${esc(event.title)}</div>
    <div class="event-detail-meta">
      ${fmtDate(event.start_at, { time: true })}${event.end_at ? ` &mdash; ${fmtDate(event.end_at, { time: true })}` : ''}
      ${event.location ? `<br><strong>Location:</strong> ${esc(event.location)}` : ''}
      <br><strong>Host:</strong> <a href="/profile/${esc(creator?.username || '')}">${esc(creator?.display_name || 'Unknown')}</a>
      ${event.category ? `<br><strong>Type:</strong> ${esc(event.category)}` : ''}
    </div>
    <div class="event-rsvp-count">${event.rsvp_count} going</div>
    <div class="event-rsvp-actions">${rsvpHtml} ${editLink}</div>
    ${event.description ? `<div class="event-description">${esc(event.description)}</div>` : ''}
  </div>
</div>

${module({ header: `${ic.users(12)} Who's Going`, body: `<div style="padding:6px">${attendeeHtml}</div>` })}

${module({
  header: `${ic.msgSquare(12)} Comments`,
  body: `<div class="comment-list">${commentListHtml}</div>${paginator(page, hasMore, `/events/${event.id}`)}${commentForm}`
})}`;
}

function createEventForm({ error, values = {}, eventId }) {
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
