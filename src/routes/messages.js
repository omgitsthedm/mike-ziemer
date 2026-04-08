/**
 * Deckspace — Direct Messages
 *
 * GET  /messages                 — inbox (thread list)
 * GET  /messages/:username       — conversation with user
 * POST /messages/:username       — send a message
 */

import { Hono } from 'hono';
import { getDb, getSailing, getThread, getUnreadMessageCount, createNotification, q } from '../lib/db.js';
import { requireAuth, isRateLimited } from '../lib/auth.js';
import { layout, layoutCtx, esc, relTime, csrfField } from '../templates/layout.js';
import { module } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const messages = new Hono();

messages.use('/messages*', requireAuth);

/* ============================================================
   INBOX
   ============================================================ */
messages.get('/messages', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const csrf    = c.get('csrfToken') || '';

  // Get recent conversations: most recent message per partner
  // Fallback to raw query if RPC not available
  const { data: recentMsgs } = await db.from('messages')
    .select('id, from_user_id, to_user_id, body, read_at, created_at, sender:users!messages_from_user_id_fkey(username, display_name), recipient:users!messages_to_user_id_fkey(username, display_name)')
    .eq('sailing_id', c.env.SAILING_ID)
    .eq('moderation_status', 'visible')
    .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(100)
    .catch(() => ({ data: [] }));

  // Deduplicate to one entry per conversation partner
  const seen = new Set();
  const threads = [];
  for (const msg of recentMsgs || []) {
    const otherId = msg.from_user_id === user.id ? msg.to_user_id : msg.from_user_id;
    if (!seen.has(otherId)) {
      seen.add(otherId);
      const other = msg.from_user_id === user.id ? msg.recipient : msg.sender;
      threads.push({ msg, other, isUnread: !msg.read_at && msg.to_user_id === user.id });
    }
  }

  const threadHtml = threads.length
    ? threads.map(({ msg, other, isUnread }) => `<div class="msg-thread-row${isUnread ? ' unread' : ''}">
  <div class="msg-thread-name">
    <a href="/messages/${esc(other?.username || '')}">${esc(other?.display_name || 'Unknown')}</a>
    ${isUnread ? `<span class="msg-unread-dot"></span>` : ''}
  </div>
  <div class="msg-thread-preview">${esc((msg.body || '').slice(0, 80))}${msg.body?.length > 80 ? '…' : ''}</div>
  <div class="msg-thread-time">${relTime(msg.created_at)}</div>
</div>`).join('')
    : `<div class="ds-empty-state">No messages yet. Visit someone&rsquo;s profile to send the first one.</div>`;

  const body = module({
    header: `${ic.mail(12)} Messages`,
    body: `<div class="msg-thread-list">${threadHtml}</div>`
  });

  return c.html(layoutCtx(c, {
    title: 'Messages',
    user,
    sailing,
    activeNav: 'messages',
    body,
    csrfToken: csrf,
  }));
});

/* ============================================================
   CONVERSATION THREAD
   ============================================================ */
messages.get('/messages/:username', async (c) => {
  const user      = c.get('user');
  const db        = getDb(c.env);
  const sailing   = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const username  = c.req.param('username');
  const csrf      = c.get('csrfToken') || '';

  const { data: other } = await db.from('users')
    .select('id, username, display_name')
    .eq('sailing_id', c.env.SAILING_ID)
    .ilike('username', username)
    .eq('account_status', 'active')
    .maybeSingle();

  if (!other) return c.redirect('/messages');
  if (other.id === user.id) return c.redirect('/messages');

  // Mark incoming messages as read
  await db.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sailing_id', c.env.SAILING_ID)
    .eq('from_user_id', other.id)
    .eq('to_user_id', user.id)
    .is('read_at', null)
    .catch(() => {});

  const thread = await getThread(db, c.env.SAILING_ID, user.id, other.id);

  const msgHtml = thread.length
    ? thread.map(m => {
        const isMine = m.from_user_id === user.id;
        return `<div class="msg-bubble${isMine ? ' mine' : ' theirs'}">
  <div class="msg-body">${esc(m.body)}</div>
  <div class="msg-meta">${relTime(m.created_at)}</div>
</div>`;
      }).join('')
    : `<div class="ds-empty-state">Start the conversation below.</div>`;

  const form = `<form method="POST" action="/messages/${esc(other.username)}" class="msg-compose-form" data-retry="true">
  ${csrfField(csrf)}
  <textarea name="body" class="ds-textarea msg-textarea" placeholder="Write a message..." required maxlength="2000" rows="3"></textarea>
  <button type="submit" class="ds-btn ds-btn-primary" data-loading-text="Sending...">${ic.send(13)} Send</button>
</form>`;

  const body = `<div class="msg-thread-header">
  <a href="/messages" class="ds-btn ds-btn-sm">&laquo; Inbox</a>
  <strong style="margin-left:8px">Conversation with <a href="/profile/${esc(other.username)}">${esc(other.display_name)}</a></strong>
</div>
${module({ header: `${ic.mail(12)} Conversation`, body: `<div class="msg-bubble-list">${msgHtml}</div>${form}` })}`;

  return c.html(layoutCtx(c, {
    title: `Messages — ${other.display_name}`,
    user,
    sailing,
    activeNav: 'messages',
    body,
    csrfToken: csrf,
  }));
});

/* ============================================================
   SEND MESSAGE
   ============================================================ */
messages.post('/messages/:username', async (c) => {
  const user     = c.get('user');
  const db       = getDb(c.env);
  const username = c.req.param('username');
  const ip       = c.req.header('cf-connecting-ip') || '';

  if (await isRateLimited(c.env, `msg:${user.id}`, 10)) {
    return c.redirect('/messages/' + encodeURIComponent(username));
  }

  const { data: other } = await db.from('users')
    .select('id, username, display_name')
    .eq('sailing_id', c.env.SAILING_ID)
    .ilike('username', username)
    .eq('account_status', 'active')
    .maybeSingle();

  if (!other || other.id === user.id) return c.redirect('/messages');

  const form = c.get('parsedForm') || await c.req.formData().catch(() => null);
  const body = (form?.get('body') || '').toString().trim().slice(0, 2000);
  if (!body) return c.redirect('/messages/' + encodeURIComponent(username));

  await q(db.from('messages').insert({
    sailing_id: c.env.SAILING_ID,
    from_user_id: user.id,
    to_user_id: other.id,
    body
  })).catch(() => {});

  // Notify recipient
  await createNotification(db, {
    userId: other.id,
    type: 'message',
    objectType: 'user',
    objectId: user.id,
    actorId: user.id,
    message: 'sent you a message.'
  }).catch(() => {});

  return c.redirect('/messages/' + encodeURIComponent(other.username));
});

export default messages;
