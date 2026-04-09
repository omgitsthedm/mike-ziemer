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
import { layout, layoutCtx, esc, relTime, fmtDate } from '../templates/layout.js';
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

  // Current bulletin
  const bulletinJson = await c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null);
  const bulletin = bulletinJson ? JSON.parse(bulletinJson) : null;

  const navLinks = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    <a href="/admin/reports" class="ds-btn ds-btn-primary ds-btn-sm">Reports Queue (${pendingReports})</a>
    <a href="/admin/users" class="ds-btn ds-btn-sm">User Lookup</a>
    <a href="/admin/bulletin" class="ds-btn ds-btn-sm">Bulletin Board</a>
    <a href="/admin/weather" class="ds-btn ds-btn-sm">Weather</a>
    <a href="/admin/voyage" class="ds-btn ds-btn-sm">Voyage Schedule</a>
    <a href="/admin/demo" class="ds-btn ds-btn-sm" style="border-color:#cc9900;color:#886600">Demo Setup</a>
  </div>`;

  const body = `${navLinks}
${module({ header: 'Community Stats', body: statsHtml })}
${bulletin ? module({ header: 'Current Bulletin', body: `<div class="ds-module-body"><p style="font-size:12px">${esc(bulletin.text)}</p><p class="text-small text-muted">Posted by ${esc(bulletin.author)} &mdash; ${relTime(bulletin.created_at)}</p></div>` }) : ''}
${module({ header: 'Recent Moderation Actions', body: actionsHtml })}`;

  return c.html(layoutCtx(c, { title: 'Admin', user, sailing, body }));
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

  return c.html(layoutCtx(c, { title: 'Reports Queue', user, sailing, body }));
});

admin.post('/admin/reports/:id/resolve', async (c) => {
  const user      = c.get('user');
  const reportId  = c.req.param('id');
  const db        = getDb(c.env);
  const form      = c.get('parsedForm') || await c.req.formData();
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
    // Sanitize: strip PostgREST filter metacharacters before string interpolation
    const safeSearch = search.replace(/[(),]/g, '');
    const { data } = await db.from('users')
      .select('id, username, display_name, account_status, activation_status, role, created_at, last_active_at, email')
      .eq('sailing_id', c.env.SAILING_ID)
      .or(`username.ilike.%${safeSearch}%,display_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`)
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

  return c.html(layoutCtx(c, { title: 'User Lookup', user, sailing, body }));
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

/* ============================================================
   BULLETIN BOARD
   ============================================================ */
admin.get('/admin/bulletin', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const csrf    = c.get('csrfToken') || '';

  const bulletinJson = await c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null);
  const bulletin = bulletinJson ? JSON.parse(bulletinJson) : null;

  const currentHtml = bulletin
    ? `<div style="background:#fffde7;border:1px solid #f0c040;padding:8px;margin-bottom:10px;font-size:12px">
        <strong>Current bulletin:</strong> ${esc(bulletin.text)}
        <div class="text-small text-muted">Posted ${relTime(bulletin.created_at)}</div>
        <form method="POST" action="/admin/bulletin/clear" style="margin-top:6px">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <button type="submit" class="ds-btn ds-btn-sm" data-confirm="Clear the bulletin?">Clear Bulletin</button>
        </form>
      </div>`
    : `<div class="ds-empty-state text-small">No active bulletin.</div>`;

  const body = module({
    header: 'Ship Bulletin Board',
    body: `<div class="ds-module-body">
      ${currentHtml}
      <form method="POST" action="/admin/bulletin" class="ds-form">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <div class="ds-form-row">
          <label>New Bulletin <span class="text-muted text-small">(replaces existing, shown on home page, expires in 7 days)</span></label>
          <textarea name="text" class="ds-textarea" rows="3" maxlength="500" placeholder="Tonight: Deck 9 Karaoke at 9pm • Tomorrow: Cozumel port day..." required></textarea>
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-primary" data-loading-text="Posting...">Post Bulletin</button>
          <a href="/admin" class="ds-btn" style="margin-left:6px">Cancel</a>
        </div>
      </form>
    </div>`
  });

  return c.html(layoutCtx(c, { title: 'Bulletin Board', user, sailing, body }));
});

admin.post('/admin/bulletin', async (c) => {
  const user = c.get('user');
  const form = c.get('parsedForm') || await c.req.formData().catch(() => null);
  const text = (form?.get('text') || '').toString().trim().slice(0, 500);
  if (!text) return c.redirect('/admin/bulletin');

  const bulletin = { text, author: user.display_name, created_at: new Date().toISOString() };
  await c.env.KV?.put(`sailing:${c.env.SAILING_ID}:bulletin`, JSON.stringify(bulletin), { expirationTtl: 86400 * 7 }).catch(() => {});

  return c.redirect('/admin/bulletin');
});

admin.post('/admin/bulletin/clear', async (c) => {
  await c.env.KV?.delete(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => {});
  return c.redirect('/admin/bulletin');
});

/* ============================================================
   VOYAGE SCHEDULE MANAGEMENT
   ============================================================ */
admin.get('/admin/voyage', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const csrf    = c.get('csrfToken') || '';

  const { data: days } = await db.from('voyage_days')
    .select('*')
    .eq('sailing_id', c.env.SAILING_ID)
    .order('day_date', { ascending: true })
    .catch(() => ({ data: [] }));

  const daysHtml = (days || []).length
    ? (days || []).map(d => `<div style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px;display:flex;justify-content:space-between;align-items:center">
        <span><strong>${esc(d.day_date)}</strong> &mdash; ${esc(d.port_name)} (${esc(d.day_type)})</span>
        <form method="POST" action="/admin/voyage/${esc(d.id)}/delete" style="display:inline">
          <input type="hidden" name="_csrf" value="${esc(csrf)}">
          <button type="submit" class="ds-btn ds-btn-sm" data-confirm="Delete this day?" style="font-size:10px">Del</button>
        </form>
      </div>`).join('')
    : `<div class="ds-empty-state">No voyage days yet.</div>`;

  const body = module({
    header: 'Voyage Schedule',
    body: `<div class="ds-module-body">
      <div style="margin-bottom:10px">${daysHtml}</div>
      <form method="POST" action="/admin/voyage/add" class="ds-form">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px">
          <div><label style="font-size:10px">Date</label><input name="day_date" type="date" class="ds-input" required></div>
          <div><label style="font-size:10px">Port / Location</label><input name="port_name" type="text" class="ds-input" required maxlength="100" placeholder="Nassau, Bahamas"></div>
          <div><label style="font-size:10px">Type</label>
            <select name="day_type" class="ds-select">
              <option value="sea">Sea Day</option>
              <option value="port">Port Day</option>
              <option value="embarkation">Embarkation</option>
              <option value="disembarkation">Disembarkation</option>
            </select>
          </div>
          <div><label style="font-size:10px">Arrive</label><input name="arrive_time" type="time" class="ds-input"></div>
          <div><label style="font-size:10px">Depart</label><input name="depart_time" type="time" class="ds-input"></div>
          <div><label style="font-size:10px">Notes</label><input name="notes" type="text" class="ds-input" maxlength="500"></div>
        </div>
        <button type="submit" class="ds-btn ds-btn-primary ds-btn-sm">Add Day</button>
        <a href="/admin" class="ds-btn ds-btn-sm" style="margin-left:6px">Back</a>
      </form>
    </div>`
  });

  return c.html(layoutCtx(c, { title: 'Voyage Schedule', user, sailing, body }));
});

admin.post('/admin/voyage/add', async (c) => {
  const db   = getDb(c.env);
  const form = c.get('parsedForm') || await c.req.formData().catch(() => null);

  await db.from('voyage_days').insert({
    sailing_id:  c.env.SAILING_ID,
    day_date:    (form?.get('day_date') || '').toString(),
    port_name:   (form?.get('port_name') || 'At Sea').toString().trim().slice(0, 100),
    day_type:    (form?.get('day_type') || 'sea').toString(),
    arrive_time: (form?.get('arrive_time') || null)?.toString() || null,
    depart_time: (form?.get('depart_time') || null)?.toString() || null,
    notes:       (form?.get('notes') || null)?.toString().trim().slice(0, 500) || null,
  }).catch(() => {});

  return c.redirect('/admin/voyage');
});

admin.post('/admin/voyage/:id/delete', async (c) => {
  const db  = getDb(c.env);
  const id  = c.req.param('id');
  await db.from('voyage_days').delete()
    .eq('id', id).eq('sailing_id', c.env.SAILING_ID).catch(() => {});
  return c.redirect('/admin/voyage');
});

/* ============================================================
   WEATHER — KV-backed "At Sea" widget
   ============================================================ */
const WEATHER_ICON_OPTS = ['sun','sunrise','sunset','moon','cloud','rain','wind','storm'];

admin.get('/admin/weather', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const weatherJson = await c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null);
  const w = weatherJson ? JSON.parse(weatherJson) : null;

  const currentHtml = w
    ? `<div style="padding:8px;background:#f0f5ff;border:1px solid #aabbdd;margin-bottom:10px;font-size:12px">
        <strong>Live:</strong> ${esc(w.conditions)}, ${w.temp_f}&deg;F / ${w.temp_c}&deg;C &mdash;
        ${w.wind_knots} kts ${esc(w.wind_dir || '')} &mdash;
        ${esc(w.wave_ft)} ft waves &mdash; ${esc(w.location || '')}
        <span class="text-muted" style="margin-left:6px">icon: ${esc(w.icon)}</span>
        <form method="POST" action="/admin/weather/clear" style="margin-top:6px;display:inline">
          <button type="submit" class="ds-btn ds-btn-sm" data-confirm="Clear weather? Demo fallback will show.">Clear</button>
        </form>
      </div>`
    : `<div class="ds-empty-state text-small" style="margin-bottom:10px">No weather set &mdash; demo fallback (84&deg;F, Partly Cloudy) is showing.</div>`;

  const formHtml = `<form method="POST" action="/admin/weather" class="ds-form">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 10px">
      <div class="ds-form-row">
        <label>Temperature &deg;F</label>
        <input name="temp_f" type="number" class="ds-input" value="${w?.temp_f ?? 84}" min="40" max="115">
      </div>
      <div class="ds-form-row">
        <label>Temperature &deg;C</label>
        <input name="temp_c" type="number" class="ds-input" value="${w?.temp_c ?? 29}" min="5" max="45">
      </div>
    </div>
    <div class="ds-form-row">
      <label>Conditions <span style="font-weight:normal;color:#999">(shown as text)</span></label>
      <input name="conditions" type="text" class="ds-input" value="${esc(w?.conditions ?? 'Partly Cloudy')}" maxlength="60" placeholder="Partly Cloudy, Clear, Breezy...">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 10px">
      <div class="ds-form-row">
        <label>Wind (knots)</label>
        <input name="wind_knots" type="number" class="ds-input" value="${w?.wind_knots ?? 12}" min="0" max="120">
      </div>
      <div class="ds-form-row">
        <label>Wind Direction</label>
        <input name="wind_dir" type="text" class="ds-input" value="${esc(w?.wind_dir ?? 'ENE')}" maxlength="10" placeholder="ENE, SE...">
      </div>
      <div class="ds-form-row">
        <label>Wave Height</label>
        <input name="wave_ft" type="text" class="ds-input" value="${esc(w?.wave_ft ?? '2\u20133')}" maxlength="20" placeholder="2\u20133 ft">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:0 10px">
      <div class="ds-form-row">
        <label>Location <span style="font-weight:normal;color:#999">(shown under widget)</span></label>
        <input name="location" type="text" class="ds-input" value="${esc(w?.location ?? 'Caribbean Sea')}" maxlength="60">
      </div>
      <div class="ds-form-row">
        <label>Icon</label>
        <select name="icon" class="ds-select">
          ${WEATHER_ICON_OPTS.map(i => `<option value="${i}"${(w?.icon ?? 'cloud') === i ? ' selected' : ''}>${i}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="ds-form-row mt-8">
      <button type="submit" class="ds-btn ds-btn-primary">Update Weather</button>
    </div>
  </form>`;

  const body = module({ header: 'At Sea — Weather Widget', body: currentHtml + formHtml });
  return c.html(layoutCtx(c, { title: 'Weather — Admin', user, sailing, body }));
});

admin.post('/admin/weather', async (c) => {
  const form = c.get('parsedForm') || await c.req.formData();
  const weather = {
    temp_f:     parseInt((form.get('temp_f') || '84').toString(), 10),
    temp_c:     parseInt((form.get('temp_c') || '29').toString(), 10),
    conditions: (form.get('conditions') || 'Partly Cloudy').toString().trim().slice(0, 60),
    wind_knots: parseInt((form.get('wind_knots') || '12').toString(), 10),
    wind_dir:   (form.get('wind_dir') || 'ENE').toString().trim().slice(0, 10),
    wave_ft:    (form.get('wave_ft') || '2\u20133').toString().trim().slice(0, 20),
    location:   (form.get('location') || 'Caribbean Sea').toString().trim().slice(0, 60),
    icon:       WEATHER_ICON_OPTS.includes((form.get('icon') || '').toString()) ? form.get('icon').toString() : 'cloud',
    updated_at: new Date().toISOString(),
  };
  await c.env.KV?.put(`sailing:${c.env.SAILING_ID}:weather`, JSON.stringify(weather), { expirationTtl: 86400 * 3 }).catch(() => {});
  return c.redirect('/admin/weather');
});

admin.post('/admin/weather/clear', async (c) => {
  await c.env.KV?.delete(`sailing:${c.env.SAILING_ID}:weather`).catch(() => {});
  return c.redirect('/admin/weather');
});

/* ============================================================
   DEMO SETUP — one-click KV seed for presentations
   Seeds weather + ship bulletin with Shattered Shores defaults.
   Safe to re-run; does not touch the database.
   ============================================================ */
admin.get('/admin/demo', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const [wxJson, bulletinJson] = await Promise.all([
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null),
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null),
  ]);

  const statusHtml = `<div style="font-size:11px;margin-bottom:12px;padding:8px;background:#fafafa;border:1px solid #ddd">
    <div style="margin-bottom:4px">${wxJson ? '&#x2713; Weather: set' : '&#x25CB; Weather: using demo fallback'}</div>
    <div>${bulletinJson ? '&#x2713; Bulletin: active' : '&#x25CB; Bulletin: none'}</div>
  </div>`;

  const body = module({
    header: 'Demo Setup',
    body: `${statusHtml}
    <p style="font-size:12px;margin-bottom:10px;line-height:1.5">
      Seeds KV with Shattered Shores demo defaults: Caribbean weather, and a ship bulletin
      announcing tonight&rsquo;s main events. Safe to re-run. Expires after 7 days.
    </p>
    <form method="POST" action="/admin/demo/seed">
      <button type="submit" class="ds-btn ds-btn-orange">Seed Demo Data &raquo;</button>
    </form>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <a href="/admin/weather" class="ds-btn ds-btn-sm">Edit Weather</a>
      <a href="/admin/bulletin" class="ds-btn ds-btn-sm">Edit Bulletin</a>
    </div>`
  });

  return c.html(layoutCtx(c, { title: 'Demo Setup', user, sailing, body }));
});

admin.post('/admin/demo/seed', async (c) => {
  const sailingId = c.env.SAILING_ID;
  const now = new Date().toISOString();

  const weather = {
    temp_f: 84, temp_c: 29,
    conditions: 'Partly Cloudy',
    wind_knots: 12, wind_dir: 'ENE',
    wave_ft: '2\u20133',
    icon: 'cloud',
    location: 'Caribbean Sea',
    updated_at: now,
  };

  const bulletin = {
    text: 'Tonight: Main Stage at 11PM. Missed Call Confessional opens at 2:30AM. The outer deck is open all night \u2014 see you out there.',
    author: 'Shattered Shores Crew',
    created_at: now,
  };

  await Promise.all([
    c.env.KV?.put(`sailing:${sailingId}:weather`, JSON.stringify(weather), { expirationTtl: 86400 * 7 }).catch(() => {}),
    c.env.KV?.put(`sailing:${sailingId}:bulletin`, JSON.stringify(bulletin), { expirationTtl: 86400 * 7 }).catch(() => {}),
  ]);

  return c.redirect('/admin');
});

export default admin;
