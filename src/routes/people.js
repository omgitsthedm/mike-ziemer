/**
 * Deckspace — People browse/search route
 *
 * GET /people  — browse + search all passengers
 */

import { Hono } from 'hono';
import { getDb, browsePeople, getSailing, q } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { layout, layoutCtx, esc } from '../templates/layout.js';
import { ic } from '../templates/icons.js';
import { module, personRow, paginator } from '../templates/components.js';

const people = new Hono();

// Common interest tags for the pill strip
const COMMON_VIBES = ['karaoke','trivia','poker','dancing','foodie','music','nightlife','chill','adventure','sea day','excursion','comedy','pool','gym'];

people.get('/people', async (c) => {
  const viewer  = await resolveSession(c.env, c.req.raw);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const page    = Math.min(Math.max(1, parseInt(c.req.query('page') || '1', 10)), 500);
  const search  = (c.req.query('q') || '').trim().slice(0, 100);
  const vibeTag = (c.req.query('vibe') || '').trim().slice(0, 50);

  const users = await browsePeople(db, c.env.SAILING_ID, {
    search: search || null,
    vibeTag: vibeTag || null,
    page,
    limit: 30
  });
  const duplicateCounts = users.reduce((acc, u) => {
    const key = u.display_name || '';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

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
    cdnBase,
    csrfToken: c.get('csrfToken') || '',
    displayLabel: duplicateCounts[u.display_name] > 1 ? `${u.display_name} (@${u.username})` : u.display_name
  })).join('');

  const vibePills = `<div class="vibe-filter-strip">
    ${vibeTag ? `<a href="/people" class="vibe-pill active-pill">All</a>` : ''}
    ${COMMON_VIBES.map(v =>
      `<a href="/people?vibe=${encodeURIComponent(v)}" class="vibe-pill${vibeTag === v ? ' active-pill' : ''}">${esc(v)}</a>`
    ).join('')}
  </div>`;

  const searchForm = `<form method="GET" action="/people" class="ds-form" style="display:flex;gap:4px;margin-bottom:6px;align-items:center">
    <label for="people-search" class="sr-only">Search people by name</label>
    <input id="people-search" name="q" type="search" class="ds-input" value="${esc(search)}" placeholder="Search for a name..." style="flex:1">
    ${vibeTag ? `<input type="hidden" name="vibe" value="${esc(vibeTag)}">` : ''}
    <button type="submit" class="ds-btn ds-btn-primary">Search</button>
    ${search || vibeTag ? `<a href="/people" class="ds-btn">Clear</a>` : ''}
  </form>
  ${vibePills}`;

  const listHtml = users.length
    ? rows
    : `<div class="ds-empty-state">No people found${search ? ` for "${esc(search)}"` : ''}${vibeTag ? ` with the interest "${esc(vibeTag)}"` : ''}. Try another search or clear the filter.</div>`;

  const extraParams = [
    search  ? `q=${encodeURIComponent(search)}`   : '',
    vibeTag ? `vibe=${encodeURIComponent(vibeTag)}` : ''
  ].filter(Boolean).join('&');

  const pager = paginator(page, users.length === 30, '/people', extraParams ? `&${extraParams}` : '');

  const header = vibeTag ? `${ic.star(12)} Interest: ${esc(vibeTag)}` : search ? `${ic.users(12)} Search: "${esc(search)}"` : `${ic.users(12)} Everyone on This Sailing`;

  const body = `${searchForm}${module({
    header,
    body: `<div class="people-list">${listHtml}</div>${pager}`
  })}`;

  const pageTitle = vibeTag
    ? `People by Interest: ${vibeTag}`
    : search
    ? `People Search: ${search}`
    : 'People on This Sailing';
  const canonicalUrl = new URL('/people', c.req.url).toString();
  const isFiltered = Boolean(search || vibeTag || page > 1);

  return c.html(layoutCtx(c, {
    title: pageTitle,
    description: search || vibeTag
      ? `Browse DeckSpace passengers for this sailing${search ? ` matching ${search}` : ''}${vibeTag ? ` with the interest ${vibeTag}` : ''}.`
      : 'Browse DeckSpace passengers on this sailing, discover shared interests, follow profile activity, and connect through public profiles.',
    user: viewer,
    sailing,
    activeNav: 'people',
    body,
    canonicalUrl,
    noIndex: isFiltered,
    structuredData: peopleListStructuredData(c.req.url, canonicalUrl, users, { search, vibeTag, page, isFiltered }),
  }));
});

export default people;

function peopleListStructuredData(url, canonicalUrl, users, { search, vibeTag, page, isFiltered }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    url: new URL(url).toString(),
    name: search
      ? `DeckSpace people search for ${search}`
      : vibeTag
      ? `DeckSpace people with interest ${vibeTag}`
      : page > 1
      ? `DeckSpace people page ${page}`
      : 'DeckSpace people directory',
    description: isFiltered
      ? 'Filtered DeckSpace people results for this sailing.'
      : 'Public passenger directory for this sailing on DeckSpace.',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: users.slice(0, 12).map((user, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: new URL(`/profile/${user.username}`, canonicalUrl).toString(),
        name: user.display_name,
      })),
    },
  };
}
