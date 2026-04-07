/**
 * Deckspace — Admin / Moderation routes
 *
 * All routes require admin or moderator role.
 *
 * GET  /admin                     — dashboard overview
 * GET  /admin/reports             — reports queue
 * POST /admin/reports/:id/resolve — resolve report + take action
 * GET  /admin/users               — user lookup
 * POST /admin/users/:id/suspend   — suspend user
 * POST /admin/users/:id/unsuspend — unsuspend user
 * POST /admin/users/:id/ban       — ban user
 * POST /admin/content/:type/:id/remove  — remove content
 * POST /admin/content/:type/:id/restore — restore content
 */

import { Hono } from 'hono';
import { getDb, getReports, getSailing, q, logAudit } from '../lib/db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { layout, esc, relTime, fmtDate } from '../templates/layout.js';
import { module, paginator } from '../templates/components.js';

const admin = new Hono();

admin.use('/admin*', requireAuth, requireAdmin);

/* ============================================================
   DASHBOARD
   ============================================================ */
admin.get('/admin', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const [pendingReports, recentActions, activeUsers, totalEvents, totalPhotos] = await Promise.all([
    db.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(({ count }) => count || 0),
    q(db.from('moderation_actions')
        .select('id, action_type, target_type, target_id, created_at, notes, users!moderation_actions_admin_user_id_fkey(username, display_name)')
        .order('created_at', { ascending: false })
        .limit(10)),
    db.from('users').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).eq('account_status', 'active').then(({ count }) => count || 0),
    db.from('events').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).then(({ count }) => count || 0),
    db.from('photos').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).then(({ count }) => count || 0),
  ]);

  const statsHtml = `<div style="display:flex;gap:12px;flex-wrap:wrap;padding:6px">
    ${[
      ['Active Users', activeUsers],
      ['Events', totalEvents],
      ['Photos', totalPhotos],
      ['Pending Reports', pendingReports],
    ].map(([label, count]) =>
      `<div style="background:#f0f5ff;border:1px solid #aabbdd;padding:8px 12px;min-width:100px;text-align:center">
        <div style="font-size:22px;font-weight:bold;color:#003399">${count}</div>
        <div style="font-size:10px;color:#666">${esc(label)}</div>
      </div>`
    ).join('')}
  </div>`;

  const actionsHtml = recentActions.length
    ? recentActions.map(a =>
        `<div style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px">
          <strong>${esc(a.users?.display_name || '?')}</strong>
          ${esc(a.action_type)} on ${esc(a.target_type)}
          <span class="text-muted">${relTime(a.created_at)}</span>
          ${a.notes ? `<div class="text-muted">${esc(a.notes)}</div>` : ''}
        </div>`
      ).join('')
    : `<div class="ds-empty-state">No recent actions.</div>`;

  const navLinks = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    <a href="/admin/reports" class="ds-btn ds-btn-primary ds-btn-sm">Reports Queue (${pendingReports})</a>
    <a href="/admin/users" class="ds-btn ds-btn-sm">User Lookup</a>
  </div>`;

  const body = `${navLinks}
${module({ header: 'Community Stats', body: statsHtml })}
${module({ header: 'Recent Moderation Actions', body: actionsHtml })}`;

  return c.html(layout({ title: 'Admin', user, sailing, body }));
});

/* ============================================================
   REPORTS QUEUE
   ============================================================ */
admin.get('/admin/reports', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const status  = c.req.query('status') || 'pending';
  const page    = parseInt(c.req.query('page') || '1', 10);

  const reports = await getReports(db, { status, page });

  const statusTabs = ['pending','reviewed','resolved','dismissed'].map(s =>
    `<a href="/admin/reports?status=${s}" style="padding:3px 8px;font-size:11px;background:${status===s?'#003399':'#e8f0f8'};color:${status===s?'#fff':'#003399'};text-decoration:none;border:1px solid #ccc;margin-right:2px">${s}</a>`
  ).join('');

  const reportsHtml = reports.length
    ? reports.map(r => `<div class="report-item">
  <div class="report-meta">
    <strong>Reporter:</strong> ${esc(r.users?.display_name || '?')} &mdash;
    <strong>Target:</strong> ${esc(r.target_type)} / <code style="font-size:10px">${esc(r.target_id)}</code> &mdash;
    ${relTime(r.created_at)}
  </div>
  <div class="report-reason">${esc(r.reason)}</div>
  <div class="report-actions">
    <form method="POST" action="/admin/reports/${esc(r.id)}/resolve" style="display:inline-flex;gap:4px;flex-wrap:wrap">
      <select name="action" class="ds-select" style="width:auto;font-size:11px;padding:2px 4px">
        <option value="remove">Remove Content</option>
        <option value="warn">Warn + Dismiss</option>
        <option value="dismiss">Dismiss</option>
        <option value="suspend">Suspend User</option>
      </select>
      <input name="notes" type="text" class="ds-input" style="width:200px;font-size:11px" placeholder="Notes (optional)">
      <button type="submit" class="ds-btn ds-btn-primary ds-btn-sm">Resolve</button>
    </form>
    <a href="/admin/content/${esc(r.target_type)}/${esc(r.target_id)}/view" class="ds-btn ds-btn-sm" style="font-size:10px">View Content</a>
  </div>
</div>`).join('')
    : `<div class="ds-empty-state">No ${esc(status)} reports.</div>`;

  const pager = paginator(page, reports.length === 30, '/admin/reports', `&status=${status}`);

  const body = `<div style="margin-bottom:8px">${statusTabs}</div>
${module({ header: `Reports — ${esc(status)}`, body: `${reportsHtml}${pager}` })}`;

  return c.html(layout({ title: 'Reports Queue', user, sailing, body }));
});

admin.post('/admin/reports/:id/resolve', async (c) => {
  const user      = c.get('user');
  const reportId  = c.req.param('id');
  const db        = getDb(c.env);
  const form      = await c.req.formData();
  const action    = (form.get('action') || 'dismiss').toString();
  const notes     = (form.get('notes') || '').toString().trim().slice(0, 2000);

  const { data: report } = await db.from('reports').select('*').eq('id', reportId).single();
  if (!report) return c.text('Not found', 404);

  // Take action
  if (action === 'remove') {
    await db.from(tableForType(report.target_type))
      .update({ moderation_status: 'removed' })
      .eq('id', report.target_id);
  } else if (action === 'suspend') {
    // Find user from the content if possible
    const userId = await getUserFromTarget(db, report.target_type, report.target_id);
    if (userId) {
      await db.from('users').update({ account_status: 'suspended' }).eq('id', userId);
    }
  }

  const newStatus = action === 'dismiss' ? 'dismissed' : 'resolved';
  await db.from('reports').update({ status: newStatus }).eq('id', reportId);

  await q(db.from('moderation_actions').insert({
    admin_user_id: user.id,
    action_type: action,
    target_type: report.target_type,
    target_id: report.target_id,
    report_id: reportId,
    notes: notes || null
  }));

  await logAudit(db, {
    actorUserId: user.id,
    actionType: 'moderation_' + action,
    objectType: report.target_type,
    objectId: report.target_id,
    metadata: { report_id: reportId, notes },
    ipAddress: c.req.header('cf-connecting-ip')
  });

  return c.redirect('/admin/reports');
});

/* ============================================================
   USER LOOKUP
   ============================================================ */
admin.get('/admin/users', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const search  = (c.req.query('q') || '').trim();

  let users = [];
  if (search) {
    const { data } = await db.from('users')
      .select('id, username, display_name, account_status, activation_status, role, created_at, last_active_at, email')
      .eq('sailing_id', c.env.SAILING_ID)
      .or(`username.ilike.%${search}%,display_name.ilike.%${search}%,email.ilike.%${search}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    users = data || [];
  }

  const userRows = users.map(u => `<tr>
    <td style="padding:4px"><a href="/profile/${esc(u.username)}">${esc(u.display_name)}</a> <span class="text-muted text-small">@${esc(u.username)}</span></td>
    <td style="padding:4px;font-size:11px">${esc(u.account_status)}</td>
    <td style="padding:4px;font-size:11px">${esc(u.role)}</td>
    <td style="padding:4px;font-size:11px">${relTime(u.last_active_at)}</td>
    <td style="padding:4px">
      ${u.account_status === 'active'
        ? `<form method="POST" action="/admin/users/${esc(u.id)}/suspend" style="display:inline"><button type="submit" class="ds-btn ds-btn-sm" style="font-size:10px">Suspend</button></form>`
        : `<form method="POST" action="/admin/users/${esc(u.id)}/unsuspend" style="display:inline"><button type="submit" class="ds-btn ds-btn-sm" style="font-size:10px">Unsuspend</button></form>`}
      <form method="POST" action="/admin/users/${esc(u.id)}/ban" style="display:inline">
        <button type="submit" class="ds-btn ds-btn-danger ds-btn-sm" style="font-size:10px" data-confirm="Permanently ban this user?">Ban</button>
      </form>
    </td>
  </tr>`).join('');

  const tableHtml = users.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="background:#f0f0f0"><th align="left" style="padding:4px">User</th><th align="left" style="padding:4px">Status</th><th align="left" style="padding:4px">Role</th><th align="left" style="padding:4px">Last Active</th><th style="padding:4px">Actions</th></tr>
        ${userRows}
      </table>`
    : search ? `<div class="ds-empty-state">No users found for "${esc(search)}"</div>` : `<div class="ds-empty-state">Enter a search term.</div>`;

  const searchForm = `<form method="GET" action="/admin/users" class="ds-form" style="display:flex;gap:4px;margin-bottom:8px">
    <input name="q" type="search" class="ds-input" value="${esc(search)}" placeholder="Search by name, username, or email..." style="flex:1">
    <button type="submit" class="ds-btn ds-btn-primary">Search</button>
  </form>`;

  const body = `${searchForm}${module({ header: 'User Lookup', body: tableHtml })}`;

  return c.html(layout({ title: 'User Lookup', user, sailing, body }));
});

admin.post('/admin/users/:id/suspend', async (c) => {
  const admin   = c.get('user');
  const userId  = c.req.param('id');
  const db      = getDb(c.env);
  await db.from('users').update({ account_status: 'suspended' }).eq('id', userId);
  await logModerationAction(db, admin.id, 'suspend', 'user', userId, c.req.header('cf-connecting-ip'));
  return c.redirect('/admin/users');
});

admin.post('/admin/users/:id/unsuspend', async (c) => {
  const admin   = c.get('user');
  const userId  = c.req.param('id');
  const db      = getDb(c.env);
  await db.from('users').update({ account_status: 'active' }).eq('id', userId);
  await logModerationAction(db, admin.id, 'unsuspend', 'user', userId, c.req.header('cf-connecting-ip'));
  return c.redirect('/admin/users');
});

admin.post('/admin/users/:id/ban', async (c) => {
  const admin   = c.get('user');
  const userId  = c.req.param('id');
  const db      = getDb(c.env);
  await db.from('users').update({ account_status: 'banned' }).eq('id', userId);
  await logModerationAction(db, admin.id, 'ban', 'user', userId, c.req.header('cf-connecting-ip'));
  return c.redirect('/admin/users');
});

/* ============================================================
   CONTENT MODERATION DIRECT ACTIONS
   ============================================================ */
admin.post('/admin/content/:type/:id/remove', async (c) => {
  const admin      = c.get('user');
  const targetType = c.req.param('type');
  const targetId   = c.req.param('id');
  const db         = getDb(c.env);
  const table      = tableForType(targetType);
  if (!table) return c.text('Unknown type', 400);
  await db.from(table).update({ moderation_status: 'removed' }).eq('id', targetId);
  await logModerationAction(db, admin.id, 'remove', targetType, targetId, c.req.header('cf-connecting-ip'));
  return c.redirect('/admin');
});

admin.post('/admin/content/:type/:id/restore', async (c) => {
  const admin      = c.get('user');
  const targetType = c.req.param('type');
  const targetId   = c.req.param('id');
  const db         = getDb(c.env);
  const table      = tableForType(targetType);
  if (!table) return c.text('Unknown type', 400);
  await db.from(table).update({ moderation_status: 'visible' }).eq('id', targetId);
  await logModerationAction(db, admin.id, 'restore', targetType, targetId, c.req.header('cf-connecting-ip'));
  return c.redirect('/admin');
});

/* ============================================================
   HELPERS
   ============================================================ */
function tableForType(type) {
  const map = {
    user: 'users',
    wall_post: 'wall_posts',
    guestbook_entry: 'guestbook_entries',
    event: 'events',
    event_comment: 'event_comments',
    photo: 'photos',
    photo_comment: 'photo_comments',
  };
  return map[type] || null;
}

async function getUserFromTarget(db, targetType, targetId) {
  const table = tableForType(targetType);
  if (!table || targetType === 'user') return targetType === 'user' ? targetId : null;
  const userCol = targetType.endsWith('_comment') ? 'author_user_id' : 'user_id';
  const { data } = await db.from(table).select(userCol).eq('id', targetId).single();
  return data?.[userCol] || null;
}

async function logModerationAction(db, adminUserId, actionType, targetType, targetId, ip) {
  await q(db.from('moderation_actions').insert({
    admin_user_id: adminUserId,
    action_type: actionType,
    target_type: targetType,
    target_id: targetId
  }));
  logAudit(db, {
    actorUserId: adminUserId,
    actionType: 'admin_' + actionType,
    objectType: targetType,
    objectId: targetId,
    ipAddress: ip
  });
}

export default admin;
