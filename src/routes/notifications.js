/**
 * Deckspace — Notifications routes
 *
 * GET  /notifications          — notifications list
 * POST /notifications/mark-read — mark all read (called by JS on page load)
 */

import { Hono } from 'hono';
import { getDb, getNotifications, getSailing, q } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { layout, layoutCtx, esc, relTime } from '../templates/layout.js';
import { module, notifItem, paginator } from '../templates/components.js';

const notifications = new Hono();

notifications.use('/notifications*', requireAuth);

notifications.get('/notifications', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const page    = parseInt(c.req.query('page') || '1', 10);

  const notifs = await getNotifications(db, user.id, page);

  const listHtml = notifs.length
    ? notifs.map(n => notifItem(n)).join('')
    : `<div class="ds-empty-state">Nothing new right now. When someone adds you, writes on your wall, or comments, it will show up here.</div>`;

  const pager = paginator(page, notifs.length === 30, '/notifications');

  const body = module({
    header: 'Notifications',
    body: `<div class="notif-list" id="notifications-page">${listHtml}</div>${pager}`
  });

  return c.html(layoutCtx(c, {
    title: 'Alerts & Notifications',
    description: 'Review public DeckSpace alerts, friend activity, wall posts, event comments, photo comments, and moderation notices for your sailing.',
    user,
    sailing,
    body,
    notifCount: 0 // already on the page, hide nav badge
  }));
});

notifications.post('/notifications/mark-read', requireAuth, async (c) => {
  const user = c.get('user');
  const db   = getDb(c.env);

  await db.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);

  return c.json({ ok: true });
});

export default notifications;
