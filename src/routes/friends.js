/**
 * Deckspace — Friend management routes
 *
 * GET  /friends                    — incoming requests + friends list
 * GET  /friends/manage-top         — manage top friends
 * POST /friends/:userId/request    — send friend request
 * POST /friends/:friendshipId/accept   — accept request
 * POST /friends/:friendshipId/decline  — decline request
 * POST /friends/:userId/block      — block user
 * POST /friends/:friendshipId/remove  — remove friendship
 */

import { Hono } from 'hono';
import { getDb, getFriendRequests, getFriends, getSailing, createNotification, q } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { layout, layoutCtx, esc, relTime, csrfField } from '../templates/layout.js';
import { module, avatar, absUrl, pixelAvatarImg, isLegacyAvatarUrl } from '../templates/components.js';

const friends = new Hono();

friends.use('/friends*', requireAuth);

/* ============================================================
   FRIENDS LIST + REQUESTS
   ============================================================ */
friends.get('/friends', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const csrf    = c.get('csrfToken') || '';

  const [incoming, outgoing, friendsList] = await Promise.all([
    getFriendRequests(db, user.id),
    q(db.from('friendships')
        .select('id, status, created_at, addressee_id, users!friendships_addressee_id_fkey(id, username, display_name, profiles(avatar_thumb_url))')
        .eq('requester_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })),
    getFriends(db, user.id)
  ]);

  const incomingHtml = incoming.length
    ? incoming.map(f => {
        const u = f.users;
        const thumbUrl = absUrl(cdnBase, u?.profiles?.avatar_thumb_url);
        const img = thumbUrl && !isLegacyAvatarUrl(thumbUrl)
          ? `<img src="${esc(thumbUrl)}" width="40" height="40" alt="${esc(u?.display_name || 'Passenger')}" loading="lazy" style="border:1px solid #ccc">`
          : pixelAvatarImg(u?.display_name || 'Passenger', u?.username || u?.display_name || '', 40, 'friends-pixel-avatar');
        return `<div class="person-row">
  <a href="/profile/${esc(u?.username || '')}" aria-label="View ${esc(u?.display_name || 'this passenger')}'s profile">${img}</a>
  <div class="person-info">
    <a href="/profile/${esc(u?.username || '')}" class="person-name">${esc(u?.display_name || 'Unknown')}</a>
    <div class="person-meta">Sent ${relTime(f.created_at)}</div>
  </div>
  <div class="person-action" style="display:flex;gap:4px">
    <form method="POST" action="/friends/${esc(f.id)}/accept">
      ${csrfField(csrf)}
      <button type="submit" class="ds-btn ds-btn-primary ds-btn-sm">Accept</button>
    </form>
    <form method="POST" action="/friends/${esc(f.id)}/decline">
      ${csrfField(csrf)}
      <button type="submit" class="ds-btn ds-btn-sm">Decline</button>
    </form>
  </div>
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No pending friend requests.</div>`;

  const outgoingHtml = outgoing.length
    ? outgoing.map(f => {
        const u = f.users;
        return `<div class="person-row">
  <div class="person-info">
    <a href="/profile/${esc(u?.username || '')}" class="person-name">${esc(u?.display_name || 'Unknown')}</a>
    <div class="person-meta">Pending</div>
  </div>
  <div class="person-action">
    <form method="POST" action="/friends/${esc(f.id)}/remove">
      ${csrfField(csrf)}
      <button type="submit" class="ds-btn ds-btn-sm" data-confirm="Cancel this request?">Cancel</button>
    </form>
  </div>
</div>`;
      }).join('')
    : '';

  const friendsHtml = friendsList.length
    ? friendsList.map(f => {
        const u = (f.users || f.users_addressee);
        const thumbUrl = absUrl(cdnBase, u?.profiles?.avatar_thumb_url);
        const img = thumbUrl && !isLegacyAvatarUrl(thumbUrl)
          ? `<img src="${esc(thumbUrl)}" width="40" height="40" alt="${esc(u?.display_name || 'Passenger')}" loading="lazy" style="border:1px solid #ccc">`
          : pixelAvatarImg(u?.display_name || 'Passenger', u?.username || u?.display_name || '', 40, 'friends-pixel-avatar');
        return `<div class="person-row">
  <a href="/profile/${esc(u?.username || '')}" aria-label="View ${esc(u?.display_name || 'this passenger')}'s profile">${img}</a>
  <div class="person-info">
    <a href="/profile/${esc(u?.username || '')}" class="person-name">${esc(u?.display_name || 'Unknown')}</a>
  </div>
  <div class="person-action">
    <form method="POST" action="/friends/${esc(f.id)}/remove">
      ${csrfField(csrf)}
      <button type="submit" class="ds-btn ds-btn-sm ds-btn-danger" data-confirm="Remove this friend?" style="font-size:10px">Remove</button>
    </form>
  </div>
</div>`;
      }).join('')
    : `<div class="ds-empty-state">No friends yet. <a href="/people">Find some!</a></div>`;

  const body = [
    module({ header: 'Friend Requests', headerRight: `${incoming.length} pending`, body: `<div class="people-list">${incomingHtml}</div>` }),
    outgoing.length ? module({ header: 'Outgoing Requests', body: `<div class="people-list">${outgoingHtml}</div>` }) : '',
    module({ header: `My Friends (${friendsList.length})`, headerRight: `<a href="/friends/manage-top">Manage Top Friends</a>`, body: `<div class="people-list">${friendsHtml}</div>` })
  ].join('');

  return c.html(layoutCtx(c, {
    title: 'Friends & Requests',
    description: 'Manage your Deckspace friends, incoming requests, outgoing requests, and public Friend Space selections for this sailing.',
    user,
    sailing,
    body,
  }));
});

/* ============================================================
   MANAGE TOP FRIENDS
   ============================================================ */
friends.get('/friends/manage-top', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const csrf    = c.get('csrfToken') || '';

  const [topFriends, allFriends] = await Promise.all([
    q(db.from('top_friends')
        .select('position, friend_user_id, users!top_friends_friend_user_id_fkey(id, username, display_name)')
        .eq('user_id', user.id)
        .order('position', { ascending: true })),
    getFriends(db, user.id)
  ]);

  const topIds = new Set(topFriends.map(tf => tf.friend_user_id));

  const eligibleFriends = allFriends.filter(f => {
    const u = f.users || f.users_addressee;
    return u && !topIds.has(u.id);
  });

  const currentTopHtml = topFriends.length
    ? topFriends.map((tf, i) => `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #eee">
  <span style="font-size:11px;color:#666;width:16px">${i+1}.</span>
  <a href="/profile/${esc(tf.users?.username || '')}" style="font-size:12px">${esc(tf.users?.display_name || '?')}</a>
  <input type="hidden" name="friend_ids[]" value="${esc(tf.friend_user_id)}">
</div>`).join('')
    : `<div class="ds-empty-state">No top friends set.</div>`;

  const addableHtml = eligibleFriends.length
    ? eligibleFriends.map(f => {
        const u = f.users || f.users_addressee;
        return `<div class="ds-check-row">
  <input type="checkbox" name="friend_ids[]" value="${esc(u?.id || '')}" id="tf-${esc(u?.id || '')}">
  <label for="tf-${esc(u?.id || '')}" style="font-size:12px">${esc(u?.display_name || '?')}</label>
</div>`;
      }).join('')
    : `<div class="ds-empty-state text-small">All friends already in Top 8, or you have no friends yet.</div>`;

  const body = `<div style="max-width:400px;margin:0 auto">
  <div class="ds-module">
    <div class="ds-module-header">Manage Top Friends</div>
    <div class="ds-module-body">
      <p class="text-small text-muted mb-8">Select up to 8 friends to display in your Friend Space.</p>
      <form method="POST" action="/profile/top-friends" class="ds-form">
        ${csrfField(csrf)}
        <div class="ds-form-row">
          <label class="text-bold">Current Top Friends</label>
          ${currentTopHtml}
        </div>
        <div class="ds-form-row">
          <label class="text-bold">Add Friends</label>
          ${addableHtml}
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-primary">Save Top Friends</button>
          <a href="/profile/${esc(user.username)}" class="ds-btn" style="margin-left:6px">Cancel</a>
        </div>
      </form>
    </div>
  </div>
</div>`;

  return c.html(layoutCtx(c, {
    title: 'Manage Top Friends',
    description: 'Choose which friends appear in your Deckspace Friend Space and Top 8-style profile section.',
    user,
    sailing,
    body
  }));
});

/* ============================================================
   SEND FRIEND REQUEST
   ============================================================ */
friends.post('/friends/:userId/request', requireAuth, async (c) => {
  const requester = c.get('user');
  const targetId  = c.req.param('userId');
  const db        = getDb(c.env);

  if (requester.id === targetId) return c.redirect(c.req.header('referer') || '/');

  // Check not already friends/blocked
  const { data: existing } = await db.from('friendships')
    .select('id, status')
    .or(`and(requester_id.eq.${requester.id},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${requester.id})`)
    .maybeSingle();

  if (existing) return c.redirect(c.req.header('referer') || '/');

  await q(db.from('friendships').insert({
    requester_id: requester.id,
    addressee_id: targetId,
    status: 'pending'
  }));

  await createNotification(db, {
    userId: targetId,
    type: 'friend_request',
    objectType: 'user',
    objectId: requester.id,
    actorId: requester.id,
    message: 'wants to be your friend.'
  });

  return c.redirect(c.req.header('referer') || '/');
});

/* ============================================================
   ACCEPT / DECLINE / REMOVE
   ============================================================ */
friends.post('/friends/:fid/accept', requireAuth, async (c) => {
  const user = c.get('user');
  const db   = getDb(c.env);
  const fid  = c.req.param('fid');

  const { data: f } = await db.from('friendships').select('*').eq('id', fid).single();
  if (!f || f.addressee_id !== user.id) return c.text('Forbidden', 403);

  await db.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', fid);

  await createNotification(db, {
    userId: f.requester_id,
    type: 'friend_accepted',
    objectType: 'user',
    objectId: user.id,
    actorId: user.id,
    message: 'accepted your friend request.'
  });

  return c.redirect('/friends');
});

friends.post('/friends/:fid/decline', requireAuth, async (c) => {
  const user = c.get('user');
  const db   = getDb(c.env);
  const fid  = c.req.param('fid');

  const { data: f } = await db.from('friendships').select('*').eq('id', fid).single();
  if (!f || (f.addressee_id !== user.id && f.requester_id !== user.id)) return c.text('Forbidden', 403);

  await db.from('friendships').update({ status: 'declined', responded_at: new Date().toISOString() }).eq('id', fid);

  return c.redirect('/friends');
});

friends.post('/friends/:fid/remove', requireAuth, async (c) => {
  const user = c.get('user');
  const db   = getDb(c.env);
  const fid  = c.req.param('fid');

  const { data: f } = await db.from('friendships').select('*').eq('id', fid).single();
  if (!f || (f.addressee_id !== user.id && f.requester_id !== user.id)) return c.text('Forbidden', 403);

  await db.from('friendships').delete().eq('id', fid);

  return c.redirect('/friends');
});

/* ============================================================
   BLOCK
   ============================================================ */
friends.post('/friends/:userId/block', requireAuth, async (c) => {
  const user     = c.get('user');
  const targetId = c.req.param('userId');
  const db       = getDb(c.env);

  // Upsert a blocked record
  await db.from('friendships').upsert({
    requester_id: user.id,
    addressee_id: targetId,
    status: 'blocked'
  }, { onConflict: 'requester_id,addressee_id' });

  return c.redirect('/people');
});

export default friends;
