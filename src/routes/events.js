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
import { layout, esc, fmtDate, relTime } from '../templates/layout.js';
import { module, eventCard, commentEntry, paginator } from '../templates/components.js';

const events = new Hono();

/* ============================================================
   EVENTS LIST
   ============================================================ */
events.get('/events', async (c) => {
  const viewer  = await resolveSession(c.env, c.req.raw);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const page    = parseInt(c.req.query('page') || '1', 10);
  const tab     = c.req.query('tab') || 'today';

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999);

  let events_data = [];
  if (tab === 'today') {
    const { data } = await db.from('events')
      .select('id, title, location, start_at, end_at, event_type, category, rsvp_count, cover_image_url')
      .eq('sailing_id', c.env.SAILING_ID).eq('moderation_status', 'visible').eq('visibility', 'public')
      .gte('start_at', todayStart.toISOString()).lte('start_at', todayEnd.toISOString())
      .order('start_at', { ascending: true }).limit(30);
    events_data = data || [];
  } else if (tab === 'upcoming') {
    const { data } = await db.from('events')
      .select('id, title, location, start_at, end_at, event_type, category, rsvp_count, cover_image_url')
      .eq('sailing_id', c.env.SAILING_ID).eq('moderation_status', 'visible').eq('visibility', 'public')
      .gt('start_at', todayEnd.toISOString())
      .order('start_at', { ascending: true }).range((page-1)*20, page*20-1);
    events_data = data || [];
  } else if (tab === 'official') {
    const { data } = await db.from('events')
      .select('id, title, location, start_at, end_at, event_type, category, rsvp_count, cover_image_url')
      .eq('sailing_id', c.env.SAILING_ID).eq('moderation_status', 'visible').eq('visibility', 'public')
      .eq('event_type', 'official')
      .order('start_at', { ascending: true }).range((page-1)*20, page*20-1);
    events_data = data || [];
  } else {
    // All user events
    const { data } = await db.from('events')
      .select('id, title, location, start_at, end_at, event_type, category, rsvp_count, cover_image_url')
      .eq('sailing_id', c.env.SAILING_ID).eq('moderation_status', 'visible').eq('visibility', 'public')
      .eq('event_type', 'user')
      .order('start_at', { ascending: false }).range((page-1)*20, page*20-1);
    events_data = data || [];
  }

  const tabs = [
    { key: 'today', label: "Today" },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'official', label: 'Official' },
    { key: 'user', label: 'User-Created' },
  ];

  const tabNav = `<div class="ds-tabs">
    ${tabs.map(t => `<a href="/events?tab=${t.key}" class="ds-tab${tab===t.key?' ds-tab-active':''}">${t.label}</a>`).join('')}
  </div>`;

  const eventListHtml = events_data.length
    ? events_data.map(e => eventCard({ event: e, cdnBase })).join('')
    : `<div class="ds-empty-state">No events here yet. ${viewer ? `<a href="/events/create">Create one!</a>` : ''}</div>`;

  const pager = paginator(page, events_data.length === 20, '/events', `&tab=${tab}`);

  const createBtn = viewer ? `<div style="margin-bottom:8px"><a href="/events/create" class="ds-btn ds-btn-orange">+ Create Event</a></div>` : '';

  const body = `${createBtn}${tabNav}${module({ header: 'Events', body: `<div class="event-list">${eventListHtml}</div>${pager}` })}`;

  return c.html(layout({
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

  return c.html(layout({
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

  const form = await c.req.formData();
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
    return c.html(layout({
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
    return c.html(layout({
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
    return c.html(layout({ title: 'Not Found', user: viewer, sailing, body: '<div class="ds-empty-state">Event not found.</div>' }), 404);
  }

  if (event.moderation_status !== 'visible') {
    return c.html(layout({ title: 'Unavailable', user: viewer, sailing, body: '<div class="ds-empty-state">This event is not available.</div>' }), 410);
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

  const body = eventDetailPage({ event, comments, userRsvp, attendees, viewer, sailing, readOnly, isCreator, page, hasMore: comments.length === 30, cdnBase });

  return c.html(layout({
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
  const form    = await c.req.formData();
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

  const form = await c.req.formData();
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

  return c.html(layout({
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

  const form     = await c.req.formData();
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
   TEMPLATES
   ============================================================ */
function eventDetailPage({ event, comments, userRsvp, attendees, viewer, sailing, readOnly, isCreator, page, hasMore, cdnBase }) {
  const creator = event.users;
  const coverImg = event.cover_image_url
    ? `<img src="${esc(`${cdnBase}/${event.cover_image_url}`)}" alt="" style="max-width:100%;max-height:200px;object-fit:cover;display:block;margin-bottom:8px" loading="lazy">`
    : '';

  // RSVP state
  let rsvpHtml = '';
  if (viewer && !readOnly) {
    const going = userRsvp?.status === 'going';
    const interested = userRsvp?.status === 'interested';
    rsvpHtml = `<form method="POST" action="/events/${esc(event.id)}/rsvp" style="display:inline-flex;gap:4px;align-items:center">
      <input type="hidden" name="status" value="${going ? 'not_going' : 'going'}">
      <button type="submit" class="rsvp-btn${going ? ' going' : ''}">
        ${going ? '&#10003; Going' : '+ RSVP Going'}
      </button>
    </form>
    ${!going ? `<form method="POST" action="/events/${esc(event.id)}/rsvp" style="display:inline;margin-left:4px">
      <input type="hidden" name="status" value="${interested ? 'not_going' : 'interested'}">
      <button type="submit" class="ds-btn ds-btn-sm">${interested ? 'Interested &#10003;' : 'Interested'}</button>
    </form>` : ''}`;
  }

  // Attendees
  const attendeeHtml = attendees.length
    ? attendees.map(a => {
        const thumbUrl = a.users?.profiles?.avatar_thumb_url ? `${cdnBase}/${a.users.profiles.avatar_thumb_url}` : null;
        return `<a href="/profile/${esc(a.users?.username || '')}" title="${esc(a.users?.display_name || '')}">
          ${thumbUrl
            ? `<img src="${esc(thumbUrl)}" width="32" height="32" loading="lazy" style="border:1px solid #ccc">`
            : `<span style="display:inline-block;width:32px;height:32px;background:#e8e8e8;border:1px solid #ccc;text-align:center;line-height:32px;font-size:10px">${esc((a.users?.display_name || '?').charAt(0))}</span>`}
        </a>`;
      }).join(' ')
    : `<span class="text-muted text-small">No RSVPs yet.</span>`;

  // Comments
  const commentListHtml = comments.length
    ? comments.map(c => commentEntry({ authorUser: c.users, body: c.body, time: c.created_at, id: c.id, cdnBase })).join('')
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
  <div class="ds-module-header blue">${esc(event.event_type === 'official' ? 'Official Event' : 'Event')}</div>
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

${module({ header: 'Who\'s Going', body: `<div style="padding:6px">${attendeeHtml}</div>` })}

${module({
  header: 'Comments',
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
    <div class="ds-module-header">${eventId ? 'Edit Event' : 'Create a New Event'}</div>
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
