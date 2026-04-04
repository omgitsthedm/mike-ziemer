/**
 * Deckspace — People browse/search route
 *
 * GET /people  — browse + search all passengers
 */

import { Hono } from 'hono';
import { getDb, browsePeople, getSailing, q } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { layout, esc } from '../templates/layout.js';
import { module, personRow, paginator } from '../templates/components.js';

const people = new Hono();

people.get('/people', async (c) => {
  const viewer  = await resolveSession(c.env, c.req.raw);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const page    = parseInt(c.req.query('page') || '1', 10);
  const search  = (c.req.query('q') || '').trim().slice(0, 100);
  const vibeTag = (c.req.query('vibe') || '').trim();

  const users = await browsePeople(db, c.env.SAILING_ID, {
    search: search || null,
    vibeTag: vibeTag || null,
    page,
    limit: 30
  });

  // If viewer is logged in, batch fetch friendship statuses
  let friendStatuses = {};
  if (viewer && users.length) {
    const userIds = users.map(u => u.id).filter(id => id !== viewer.id);
    if (userIds.length) {
      const { data: fships } = await db.from('friendships')
        .select('id, requester_id, addressee_id, status')
        .or(
          userIds.map(id =>
            `and(requester_id.eq.${viewer.id},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${viewer.id})`
          ).join(',')
        );
      for (const f of fships || []) {
        const otherId = f.requester_id === viewer.id ? f.addressee_id : f.requester_id;
        friendStatuses[otherId] = f;
      }
    }
  }

  const rows = users.map(u => personRow({
    user: u,
    profile: u.profiles,
    viewerUser: viewer,
    friendStatus: friendStatuses[u.id] || null,
    cdnBase
  })).join('');

  const searchForm = `<form method="GET" action="/people" class="ds-form" style="display:flex;gap:4px;margin-bottom:8px;align-items:center">
    <input name="q" type="search" class="ds-input" value="${esc(search)}" placeholder="Search by name..." style="flex:1">
    <button type="submit" class="ds-btn ds-btn-primary">Search</button>
    ${search ? `<a href="/people" class="ds-btn">Clear</a>` : ''}
  </form>`;

  const listHtml = users.length
    ? rows
    : `<div class="ds-empty-state">No passengers found${search ? ` for "${esc(search)}"` : ''}.</div>`;

  const pager = paginator(page, users.length === 30, '/people', search ? `&q=${encodeURIComponent(search)}` : '');

  const body = `${searchForm}${module({
    header: search ? `Search: "${esc(search)}"` : 'All Passengers',
    body: `<div class="people-list">${listHtml}</div>${pager}`
  })}`;

  return c.html(layout({
    title: 'People',
    user: viewer,
    sailing,
    activeNav: 'people',
    body,
  }));
});

export default people;
