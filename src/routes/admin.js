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
import { requireAuth, requireAdmin, hashPassword } from '../lib/auth.js';
import { layout, layoutCtx, esc, relTime, fmtDate, csrfField } from '../templates/layout.js';
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

  const [pendingReports, recentActions, activeUsers, totalEvents, totalPhotos, voyageDays, bulletinJson, weatherJson] = await Promise.all([
    db.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(({ count }) => count || 0),
    q(db.from('moderation_actions')
        .select('id, action_type, target_type, target_id, created_at, notes, users!moderation_actions_admin_user_id_fkey(username, display_name)')
        .order('created_at', { ascending: false })
        .limit(10)),
    db.from('users').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).eq('account_status', 'active').then(({ count }) => count || 0),
    db.from('events').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).then(({ count }) => count || 0),
    db.from('photos').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).then(({ count }) => count || 0),
    db.from('voyage_days').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).then(({ count }) => count || 0),
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null),
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null),
  ]);

  const bulletin = bulletinJson ? JSON.parse(bulletinJson) : null;
  const weather = weatherJson ? JSON.parse(weatherJson) : null;

  const statsHtml = `<div class="admin-stat-grid">
    ${[
      ['Active Users', activeUsers],
      ['Events', totalEvents],
      ['Photos', totalPhotos],
      ['Pending Reports', pendingReports],
    ].map(([label, count]) =>
      `<div class="admin-stat-card">
        <div class="admin-stat-value">${count}</div>
        <div class="admin-stat-label">${esc(label)}</div>
      </div>`
    ).join('')}
  </div>`;

  const actionsHtml = recentActions.length
    ? recentActions.map(a =>
        `<div class="admin-action-item">
          <strong>${esc(a.users?.display_name || '?')}</strong>
          ${esc(a.action_type)} on ${esc(a.target_type)}
          <span class="text-muted">${relTime(a.created_at)}</span>
          ${a.notes ? `<div class="text-muted">${esc(a.notes)}</div>` : ''}
        </div>`
      ).join('')
    : `<div class="ds-empty-state">No recent actions.</div>`;

  const navLinks = `<div class="admin-quick-links">
    <a href="/admin/reports" class="ds-btn ds-btn-primary ds-btn-sm">Reports Queue (${pendingReports})</a>
    <a href="/admin/users" class="ds-btn ds-btn-sm">User Lookup</a>
    <a href="/admin/bulletin" class="ds-btn ds-btn-sm">Bulletin Board</a>
    <a href="/admin/weather" class="ds-btn ds-btn-sm">Weather</a>
    <a href="/admin/voyage" class="ds-btn ds-btn-sm">Voyage Schedule</a>
    <a href="/admin/demo" class="ds-btn ds-btn-sm" style="border-color:#cc9900;color:#886600">Demo Setup</a>
  </div>`;

  const bridgeHtml = `<section class="admin-bridge">
    <div class="admin-bridge-copy">
      <div class="admin-bridge-kicker">Bridge Board</div>
      <h2 class="admin-bridge-title">${esc(sailing?.name || 'Current sailing')} is live.</h2>
      <p class="admin-bridge-sub">This is the staff control room for guest-facing polish: bulletin, weather, moderation, demo reset, and the pieces that make the ship feel active.</p>
    </div>
    <div class="admin-bridge-flags">
      <div class="admin-bridge-flag${pendingReports ? ' hot' : ''}"><strong>${pendingReports}</strong><span>${pendingReports ? 'items need review' : 'reports under control'}</span></div>
      <div class="admin-bridge-flag"><strong>${activeUsers}</strong><span>active guest accounts</span></div>
      <div class="admin-bridge-flag"><strong>${totalEvents + totalPhotos}</strong><span>live guest-facing moments</span></div>
    </div>
  </section>`;

  const liveStatusHtml = `<div class="admin-live-status">
    <div class="admin-live-row">
      <span class="admin-live-label">Sailing</span>
      <strong>${esc(sailing?.name || 'Current sailing')}</strong>
      <span>${esc(sailing?.ship_name || 'Deckspace')}</span>
    </div>
    <div class="admin-live-row">
      <span class="admin-live-label">Bulletin</span>
      <strong>${bulletin ? 'Live on home page' : 'Not posted yet'}</strong>
      <span>${bulletin ? `${esc(bulletin.author)} • ${relTime(bulletin.created_at)}` : 'Post one from Bulletin Board'}</span>
    </div>
    <div class="admin-live-row">
      <span class="admin-live-label">Weather</span>
      <strong>${weather ? `${weather.temp_f}°F • ${esc(weather.conditions)}` : 'Demo fallback showing'}</strong>
      <span>${weather ? `${esc(weather.location || 'At Sea')} • ${esc(weather.wave_ft || '')} ft waves` : 'Update from Weather admin'}</span>
    </div>
    <div class="admin-live-row">
      <span class="admin-live-label">Voyage</span>
      <strong>${voyageDays} day${voyageDays === 1 ? '' : 's'} published</strong>
      <span>${voyageDays ? 'Schedule is visible to guests' : 'Add itinerary before demo'}</span>
    </div>
  </div>`;

  const playbookHtml = `<ol class="admin-playbook">
    <li>Post the ship bulletin first so the home page feels alive.</li>
    <li>Set weather and voyage details so the intranet reads as current.</li>
    <li>Use Demo Setup only when you need to refresh presentation data.</li>
    <li>Check Reports Queue before the client demo so moderation looks calm.</li>
  </ol>`;

  const actionDeckHtml = `<div class="admin-action-deck">
    <a href="/admin/bulletin" class="admin-action-card">
      <strong>Update Bulletin</strong>
      <span>Push the headline guests see on home.</span>
    </a>
    <a href="/admin/weather" class="admin-action-card">
      <strong>Refresh Weather</strong>
      <span>Make the sailing feel current.</span>
    </a>
    <a href="/admin/voyage" class="admin-action-card">
      <strong>Tune Voyage</strong>
      <span>Check port names, timing, and notes.</span>
    </a>
    <a href="/admin/reports" class="admin-action-card">
      <strong>Review Reports</strong>
      <span>Keep the public spaces calm.</span>
    </a>
  </div>`;

  const body = `<div class="admin-dashboard">
${bridgeHtml}
${navLinks}
${module({ header: 'Fast Actions', body: actionDeckHtml })}
${module({ header: 'Live Sailing Status', body: liveStatusHtml })}
${module({ header: 'Community Stats', body: statsHtml })}
${module({ header: 'Staff Playbook', body: playbookHtml })}
${bulletin ? module({ header: 'Current Bulletin', body: `<p class="admin-bulletin-copy">${esc(bulletin.text)}</p><p class="text-small text-muted">Posted by ${esc(bulletin.author)} &mdash; ${relTime(bulletin.created_at)}</p>` }) : ''}
${module({ header: 'Recent Moderation Actions', body: actionsHtml })}
</div>`;

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
  const csrf    = c.get('csrfToken') || '';

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
      ${csrfField(csrf)}
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
  const csrf    = c.get('csrfToken') || '';

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
        ? `<form method="POST" action="/admin/users/${esc(u.id)}/suspend" style="display:inline">${csrfField(csrf)}<button type="submit" class="ds-btn ds-btn-sm" style="font-size:10px">Suspend</button></form>`
        : `<form method="POST" action="/admin/users/${esc(u.id)}/unsuspend" style="display:inline">${csrfField(csrf)}<button type="submit" class="ds-btn ds-btn-sm" style="font-size:10px">Unsuspend</button></form>`}
      <form method="POST" action="/admin/users/${esc(u.id)}/ban" style="display:inline">
        ${csrfField(csrf)}
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
  const csrf    = c.get('csrfToken') || '';

  const weatherJson = await c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null);
  const w = weatherJson ? JSON.parse(weatherJson) : null;

  const currentHtml = w
    ? `<div style="padding:8px;background:#f0f5ff;border:1px solid #aabbdd;margin-bottom:10px;font-size:12px">
        <strong>Live:</strong> ${esc(w.conditions)}, ${w.temp_f}&deg;F / ${w.temp_c}&deg;C &mdash;
        ${w.wind_knots} kts ${esc(w.wind_dir || '')} &mdash;
        ${esc(w.wave_ft)} ft waves &mdash; ${esc(w.location || '')}
        <span class="text-muted" style="margin-left:6px">icon: ${esc(w.icon)}</span>
        <form method="POST" action="/admin/weather/clear" style="margin-top:6px;display:inline">
          ${csrfField(csrf)}
          <button type="submit" class="ds-btn ds-btn-sm" data-confirm="Clear weather? Demo fallback will show.">Clear</button>
        </form>
      </div>`
    : `<div class="ds-empty-state text-small" style="margin-bottom:10px">No weather set &mdash; demo fallback (84&deg;F, Partly Cloudy) is showing.</div>`;

  const formHtml = `<form method="POST" action="/admin/weather" class="ds-form">
    ${csrfField(csrf)}
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
   DEMO SETUP — reversible Shattered Shores client demo
   ============================================================ */
const DEMO_CREW_USERNAME = 'shattered_shores_crew';
const DEMO_PASSWORD = 'demo1234';
const DEMO_META_VERSION = 'shattered-shores-2027-v2';
const DEMO_PROMO_IMAGES = [
  'https://www.edmtunes.com/wp-content/uploads/2026/02/5111.png',
  'https://booking.whettravel.com/Booking/Styles/WhetTravel/images/GC_EMO2.jpg',
];

function demoSeedKey(sailingId) {
  return `sailing:${sailingId}:demo_meta`;
}

function demoBaseDate() {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return base;
}

function isoForDemo(base, dayOffset, hour, minute = 0) {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dateForDemo(base, dayOffset) {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

function buildCoreDemoPassengers() {
  return [
    { username: 'sarah_k', display_name: 'Sarah K.', hometown: 'Miami, FL', vibe_tags: ['pool','dancing','music'], status_text: 'already on deck before noon', about_me: 'Miami local, heavy on pool time and late sets. Usually with an iced coffee and a running list of who is going where.', who_id_like_to_meet: 'People who want to go out and people who know where the quiet deck is after.', social_intent: 'Meet people, go to the big events, and keep the page active.', song_title: 'Ocean Avenue', song_artist: 'Yellowcard', theme_id: 'classic' },
    { username: 'marco_v', display_name: 'Marco Villanueva', hometown: 'Austin, TX', vibe_tags: ['trivia','poker','nightlife'], status_text: 'building a trivia team by dinner', about_me: 'Austin guy, solid at trivia, better at meeting people once the first drink kicks in. I am here for the full week.', who_id_like_to_meet: 'Trivia people, poker people, and anybody who is still awake after midnight.', social_intent: 'Stay social and fill the board with plans.', song_title: 'The Middle', song_artist: 'Jimmy Eat World', theme_id: 'night' },
    { username: 'jenna_b', display_name: 'Jenna Bridges', hometown: 'Nashville, TN', vibe_tags: ['karaoke','music','comedy'], status_text: 'yes, i signed up for karaoke already', about_me: 'Nashville songwriter on vacation. I will absolutely drag people to karaoke and I make no apologies for that.', who_id_like_to_meet: 'Karaoke volunteers, acoustic set people, and anyone with a song request.', social_intent: 'Make fast friends and keep the music side busy.', song_title: 'Hands Down', song_artist: 'Dashboard Confessional', theme_id: 'retro-pink' },
    { username: 'derek_w', display_name: 'Derek Walsh', hometown: 'Chicago, IL', vibe_tags: ['gym','adventure','sea day'], status_text: 'already found the gym and the quiet coffee spot', about_me: 'Chicago guy. I like a packed itinerary during the day and a slower deck hang at night.', who_id_like_to_meet: 'Excursion people and anyone who wants to plan around the port stops.', social_intent: 'Keep moving and meet people along the way.', song_title: 'Sugar, We’re Goin Down', song_artist: 'Fall Out Boy', theme_id: 'ocean' },
    { username: 'tasha_m', display_name: 'Tasha Monroe', hometown: 'Atlanta, GA', vibe_tags: ['dancing','nightlife','foodie'], status_text: 'already picked out tonight’s outfit', about_me: 'ATL energy. I like the big party stuff, the themed nights, and finding the best late food on the ship.', who_id_like_to_meet: 'Dance floor people, dinner plans people, and anyone with good timing.', social_intent: 'Keep the late-night side of the cruise moving.', song_title: 'Misery Business', song_artist: 'Paramore', theme_id: 'sunset' },
    { username: 'kevin_r', display_name: 'Kevin Reyes', hometown: 'Los Angeles, CA', vibe_tags: ['photos','pool','music'], status_text: 'camera charged, finally', about_me: 'LA photographer on break. I will probably end up documenting half the trip whether I mean to or not.', who_id_like_to_meet: 'People who want photos, sunset deck people, and anyone with a good eye for details.', social_intent: 'Capture the trip and keep up with the board.', song_title: 'Only One', song_artist: 'Yellowcard', theme_id: 'classic' },
    { username: 'amber_h', display_name: 'Amber Howell', hometown: 'Denver, CO', vibe_tags: ['excursion','adventure','sea day'], status_text: 'snorkeling sign-up complete', about_me: 'Colorado person who signed up for the active stuff first. I like port days, planning ahead, and being outside whenever possible.', who_id_like_to_meet: 'People doing shore days and anyone who wants a walk instead of another lounge.', social_intent: 'See the ports and keep the trip moving.', song_title: 'Check Yes Juliet', song_artist: 'We The Kings', theme_id: 'ocean' },
    { username: 'carlos_p', display_name: 'Carlos Perez', hometown: 'Houston, TX', vibe_tags: ['poker','trivia','comedy'], status_text: 'currently accepting trivia ringers', about_me: 'Houston native. I like poker tables, comedy sets, and any conversation that turns into a group plan.', who_id_like_to_meet: 'Trivia teams, card-table regulars, and comedy-night people.', social_intent: 'Stay busy and keep the message board useful.', song_title: 'Cute Without the E', song_artist: 'Taking Back Sunday', theme_id: 'classic' },
    { username: 'lisa_ng', display_name: 'Lisa Ng', hometown: 'San Francisco, CA', vibe_tags: ['foodie','music','chill'], status_text: 'keeping notes on the menus', about_me: 'SF foodie and music person. I like the slower corners of a cruise just as much as the louder ones.', who_id_like_to_meet: 'Dinner-table people, acoustic set people, and anyone who wants to compare notes.', social_intent: 'Take it all in without rushing.', song_title: 'Vindicated', song_artist: 'Dashboard Confessional', theme_id: 'sunset' },
    { username: 'tyler_j', display_name: 'Tyler James', hometown: 'Dallas, TX', vibe_tags: ['karaoke','dancing','nightlife'], status_text: 'if there’s a mic, i’m there', about_me: 'Dallas born, very social once the night gets going. Karaoke, dance floor, repeat.', who_id_like_to_meet: 'Outgoing people, bar crowd regulars, and anyone who wants a loud night.', social_intent: 'Make the party side feel full.', song_title: 'I Write Sins Not Tragedies', song_artist: 'Panic! At The Disco', theme_id: 'retro-pink' },
    { username: 'maya_s', display_name: 'Maya Singh', hometown: 'New York, NY', vibe_tags: ['chill','sea day','music'], status_text: 'reading by the rail for a bit', about_me: 'NYC lawyer taking an actual vacation. I like the quiet windows between the big events.', who_id_like_to_meet: 'People who like real conversations and a slower pace.', social_intent: 'Meet a few good people and skip the noise when needed.', song_title: 'The Quiet Things That No One Ever Knows', song_artist: 'Brand New', theme_id: 'night' },
    { username: 'ben_f', display_name: 'Ben Forsyth', hometown: 'Boston, MA', vibe_tags: ['trivia','poker','comedy'], status_text: 'still confident about trivia', about_me: 'Boston guy. Quick to join a group plan, quicker to overestimate my trivia skills.', who_id_like_to_meet: 'Competitive people who still know how to keep it fun.', social_intent: 'Keep something on the schedule every day.', song_title: 'A Decade Under the Influence', song_artist: 'Taking Back Sunday', theme_id: 'classic' },
    { username: 'rachel_t', display_name: 'Rachel Torres', hometown: 'Orlando, FL', vibe_tags: ['dancing','pool','excursion'], status_text: 'birthday week energy', about_me: 'On board for a birthday trip and fully committed to making the most of it.', who_id_like_to_meet: 'People who say yes to plans quickly and mean it.', social_intent: 'Keep the group plans lively.', song_title: 'Grand Theft Autumn', song_artist: 'Fall Out Boy', theme_id: 'retro-pink' },
    { username: 'jake_m', display_name: 'Jake Miller', hometown: 'Seattle, WA', vibe_tags: ['adventure','excursion','sea day'], status_text: 'trying to do every port stop right', about_me: 'Pacific Northwest outdoors person. I like the deck, the port days, and a plan with a start time.', who_id_like_to_meet: 'People who want to explore and actually show up on time.', social_intent: 'Make the shore-day side easy to follow.', song_title: 'Swing, Swing', song_artist: 'The All-American Rejects', theme_id: 'ocean' },
    { username: 'priya_v', display_name: 'Priya Varma', hometown: 'Phoenix, AZ', vibe_tags: ['foodie','music','chill'], status_text: 'already ranking the snack options', about_me: 'Phoenix foodie and amateur chef. I like comparing notes, finding the good stuff, and letting the week unfold.', who_id_like_to_meet: 'Good dinner company, low-pressure people, and music lovers.', social_intent: 'Keep things social without overdoing it.', song_title: 'Ocean Breathes Salty', song_artist: 'Modest Mouse', theme_id: 'sunset' },
  ];
}

function buildGeneratedDemoPassengers(count = 50) {
  const firstNames = ['Avery','Mason','Harper','Julian','Nina','Evan','Paige','Leo','Brooke','Adrian','Skylar','Logan','Naomi','Owen','Mila','Gavin','Chloe','Elias','Sophie','Miles','Ruby','Connor','Jade','Wes','Ariana'];
  const lastNames = ['Mercer','Vale','Torres','Holloway','Bennett','Rowe','Sinclair','Ramirez','Dawson','Quinn','Parker','Wilder','Santos','Marlow','Ellis','Cruz','Monroe','Flynn','Reyes','Barlow','Griffin','Nolan','Hayes','Morales','Vega'];
  const hometowns = ['Brooklyn, NY','Tempe, AZ','Tampa, FL','Austin, TX','Columbus, OH','San Diego, CA','Raleigh, NC','Detroit, MI','Newark, NJ','Richmond, VA','Louisville, KY','Madison, WI','Portland, ME','Long Beach, CA','Burlington, VT'];
  const tagSets = [
    ['music','late-night','deck'],
    ['pool','photos','nightlife'],
    ['karaoke','friends','drinks'],
    ['trivia','comedy','coffee'],
    ['excursion','adventure','port day'],
    ['acoustic','lyrics','quiet deck'],
    ['tattoos','photos','people watching'],
    ['dancing','nightlife','pool'],
    ['food','music','sea day'],
    ['sunset','deck','conversation'],
  ];
  const statusOptions = [
    'currently deciding between pool deck and lounge',
    'already found the photo spots',
    'looking for tonight’s plan',
    'just made it to the top deck',
    'keeping it simple and staying out late',
    'signed up for more than one thing already',
    'running on coffee and a playlist',
    'trying not to miss the sunset set',
  ];
  const aboutTemplates = [
    'Here for the week, keeping things social, and trying not to miss the good sets.',
    'Mostly interested in meeting people, finding the right events, and getting off my phone a little.',
    'I like a mix of loud nights and quiet deck time, ideally with good conversation in both.',
    'Using Deckspace the right way: making plans early and following through later.',
    'Happy to join group plans, especially if they involve music, photos, or a late walk around the ship.',
  ];
  const meetTemplates = [
    'People who are easy to make plans with.',
    'Anybody into music, late-night walks, or deck time.',
    'Friendly people who actually use the event board.',
    'Good dinner company and people who show up on time.',
    'Anyone who wants a full week instead of staying in one lane.',
  ];
  const intentTemplates = [
    'Meet people and keep the week moving.',
    'Use the board for plans instead of guessing.',
    'Balance quiet time with the bigger events.',
    'Stay social, keep things easy, and see where the week goes.',
    'Find the right group and make the most of the sailing.',
  ];
  const songs = [
    ['Helena', 'My Chemical Romance'],
    ['Ocean Avenue', 'Yellowcard'],
    ['MakeDamnSure', 'Taking Back Sunday'],
    ['Sugar, We’re Goin Down', 'Fall Out Boy'],
    ['The Great Escape', 'Boys Like Girls'],
    ['Everything Is Alright', 'Motion City Soundtrack'],
    ['Until the Day I Die', 'Story of the Year'],
    ['Hands Down', 'Dashboard Confessional'],
    ['Dear Maria, Count Me In', 'All Time Low'],
    ['Ohio Is for Lovers', 'Hawthorne Heights'],
  ];
  const themes = ['classic', 'ocean', 'sunset', 'night', 'retro-pink'];

  return Array.from({ length: count }, (_, index) => {
    const first = firstNames[index % firstNames.length];
    const last = lastNames[Math.floor(index / firstNames.length) % lastNames.length];
    const username = `${first.toLowerCase()}_${last.toLowerCase()}${index + 1}`;
    const vibe_tags = tagSets[index % tagSets.length];
    const [song_title, song_artist] = songs[index % songs.length];
    return {
      username,
      display_name: `${first} ${last}`,
      hometown: hometowns[index % hometowns.length],
      vibe_tags,
      status_text: statusOptions[index % statusOptions.length],
      about_me: `${aboutTemplates[index % aboutTemplates.length]} Usually somewhere between ${vibe_tags[0]} and ${vibe_tags[1]} mode.`,
      who_id_like_to_meet: meetTemplates[index % meetTemplates.length],
      social_intent: intentTemplates[index % intentTemplates.length],
      song_title,
      song_artist,
      theme_id: themes[index % themes.length],
    };
  });
}

function buildDemoPassengers() {
  return [...buildCoreDemoPassengers(), ...buildGeneratedDemoPassengers(50)];
}

function buildDemoVoyageDays(base) {
  return [
    { day_date: dateForDemo(base, 0), port_name: 'Miami, Florida', day_type: 'embarkation', arrive_time: null, depart_time: '17:00', sort_order: 1, notes: 'Embarkation day for the Shattered Shores client demo.' },
    { day_date: dateForDemo(base, 1), port_name: 'At Sea', day_type: 'sea', arrive_time: null, depart_time: null, sort_order: 2, notes: 'Full sea day with onboard sets, meetups, and late-night programming.' },
    { day_date: dateForDemo(base, 2), port_name: 'Havana, Cuba', day_type: 'port', arrive_time: '09:00', depart_time: '23:00', sort_order: 3, notes: 'Port day in Havana for the client demo itinerary.' },
    { day_date: dateForDemo(base, 3), port_name: 'At Sea', day_type: 'sea', arrive_time: null, depart_time: null, sort_order: 4, notes: 'Return-to-sea day focused on events, photos, and wall activity.' },
    { day_date: dateForDemo(base, 4), port_name: 'At Sea', day_type: 'sea', arrive_time: null, depart_time: null, sort_order: 5, notes: 'Sea day built around social events and public group plans.' },
    { day_date: dateForDemo(base, 5), port_name: 'At Sea', day_type: 'sea', arrive_time: null, depart_time: null, sort_order: 6, notes: 'Final full day before return to Miami.' },
    { day_date: dateForDemo(base, 6), port_name: 'Miami, Florida', day_type: 'disembarkation', arrive_time: '07:00', depart_time: null, sort_order: 7, notes: 'Return to Miami and disembarkation morning.' },
  ];
}

function buildOfficialDemoEvents(base) {
  const templates = [
    { day: 0, hour: 16, minute: 0, category: 'social', title: 'Boarding Check-In & Deckspace Welcome', location: 'Port Terminal', description: 'Check in, get settled, and start meeting people before sail away.', cover_image_url: DEMO_PROMO_IMAGES[0] },
    { day: 0, hour: 18, minute: 30, category: 'music', title: 'Sail Away Sad Songs', location: 'Pool Deck', description: 'Opening-night music as the ship leaves Miami.' },
    { day: 0, hour: 21, minute: 0, category: 'theme', title: 'Top 8 Originals Mixer', location: 'Atrium Lounge', description: 'Meet early arrivals, compare plans, and get the social board moving.' },
    { day: 0, hour: 23, minute: 30, category: 'karaoke', title: 'Midnight Emo Karaoke', location: 'Moon Pool Stage', description: 'Late-night singalong for the people who are not done yet.' },
    { day: 1, hour: 10, minute: 30, category: 'other', title: 'Coffee & Liner Notes', location: 'Cafe Static', description: 'A slower morning meet-up with coffee and lyric-book energy.' },
    { day: 1, hour: 14, minute: 0, category: 'social', title: 'Blind Faith Mafia Meet-Up', location: 'Top Deck Lounge', description: 'A presale-themed social hour for the early believers.' },
    { day: 1, hour: 17, minute: 30, category: 'trivia', title: 'Former Scene Kid Trivia', location: 'Crow Bar', description: 'Public trivia with a heavy focus on music, internet history, and chaos.' },
    { day: 1, hour: 22, minute: 30, category: 'music', title: 'Acoustic After Dark Set', location: 'Outer Deck', description: 'A quieter late-night set for the people still walking the rails.' },
    { day: 2, hour: 9, minute: 30, category: 'excursion', title: 'Havana Port Meet-Up', location: 'Gangway', description: 'Public meetup for guests heading into Havana together.' },
    { day: 2, hour: 13, minute: 0, category: 'social', title: 'Old Camera Photo Walk', location: 'Havana Waterfront', description: 'A photo-friendly group walk for port-day memories.' },
    { day: 2, hour: 19, minute: 30, category: 'dinner', title: 'Havana Return Dinner', location: 'Main Dining Room', description: 'A shared dinner block for people getting back from port.' },
    { day: 2, hour: 23, minute: 0, category: 'music', title: 'Love Hurts, Waves Heal Main Set', location: 'Main Theater', description: 'The big themed night built around the Shattered Shores visual identity.', cover_image_url: DEMO_PROMO_IMAGES[1] },
    { day: 3, hour: 11, minute: 0, category: 'other', title: 'Deckspace Profile Photo Hour', location: 'Atrium Photo Booth', description: 'Fresh profile photos and quick page updates.' },
    { day: 3, hour: 15, minute: 0, category: 'social', title: 'Friend Space Swap', location: 'Blue Room', description: 'Meet people, add friends, and sort out your Top 8.' },
    { day: 3, hour: 20, minute: 30, category: 'theme', title: 'Black Parade Prom Night', location: 'Grand Ballroom', description: 'The most styled-out night on the schedule.' },
    { day: 3, hour: 23, minute: 45, category: 'deck', title: 'Late Deck Walk', location: 'Forward Deck', description: 'A low-pressure late-night group walk and talk.' },
    { day: 4, hour: 10, minute: 0, category: 'other', title: 'Recovery Brunch', location: 'Garden Cafe', description: 'Coffee, carbs, and a soft landing after the late night.' },
    { day: 4, hour: 13, minute: 30, category: 'social', title: 'Bracelet & Patch Trade', location: 'Promenade', description: 'A casual trade and meet-up for keepsakes and merch.' },
    { day: 4, hour: 18, minute: 0, category: 'theme', title: 'Pool Deck Heartbreak Hour', location: 'Pool Deck', description: 'A themed sunset block with music and open meetups.' },
    { day: 4, hour: 23, minute: 15, category: 'music', title: 'Lyric Swap Late Set', location: 'Aft Lounge', description: 'Pass the mic, trade a lyric, and keep the room going.' },
    { day: 5, hour: 11, minute: 30, category: 'other', title: 'Cabin Door Polaroid Crawl', location: 'Deck 9', description: 'A roaming photo hour that fills the photo board quickly.' },
    { day: 5, hour: 16, minute: 0, category: 'trivia', title: 'Deep Cut Trivia Finals', location: 'Crow Bar', description: 'One more shot at a strong trivia finish.' },
    { day: 5, hour: 20, minute: 30, category: 'theme', title: 'Shattered Shores Formal', location: 'Grand Ballroom', description: 'The biggest dressed-up social night of the sailing.' },
    { day: 5, hour: 23, minute: 59, category: 'deck', title: '3 AM Outer Deck Check-In', location: 'Outer Deck', description: 'For the guests who always end up outside before sleep.' },
    { day: 6, hour: 8, minute: 0, category: 'other', title: 'Farewell Breakfast & Final Wall Notes', location: 'Main Dining Room', description: 'Last notes, last photos, and an easy close to the week.' },
  ];

  return templates.map((item) => ({
    ...item,
    event_type: 'official',
    visibility: 'public',
    moderation_status: 'visible',
    start_at: isoForDemo(base, item.day, item.hour, item.minute),
    end_at: isoForDemo(base, item.day, item.hour + 1, item.minute),
  }));
}

function buildPassengerDemoEvents(base, passengers) {
  const hosts = passengers.slice(0, 18);
  const templates = [
    ['Vinyl Listening Hang', 'music', 'Cabin 9412', 'Bring one track you would actually defend.'],
    ['Pool Deck Eyeliner Repair Station', 'social', 'Pool Deck', 'Not official. Very useful.'],
    ['Photo Wall Caption Workshop', 'other', 'Atrium', 'Turn your best photo into a post people will actually click.'],
    ['Late-Night Lyric Trade', 'music', 'Moon Deck', 'Swap favorite lines and build an accidental group plan.'],
    ['Port Day Coffee Group', 'social', 'Cafe Static', 'Small group, early start, actually leaving on time.'],
    ['Friend Space Refresh', 'social', 'Blue Room', 'Add people, sort your Top 8, and compare notes.'],
    ['After-Hours Piano Bar Run', 'drinks', 'Piano Bar', 'For anyone still up and not ready to call it.'],
    ['Deck Photo Meetup', 'other', 'Forward Deck', 'Golden hour photos and quick profile updates.'],
    ['Poolside Pop-Punk Hang', 'music', 'Pool Deck', 'Easy afternoon group plan with music and no pressure.'],
    ['Merch & Patch Table Meetup', 'theme', 'Promenade', 'Show what you brought or just browse.'],
    ['Cabin Bracelet Circle', 'theme', 'Deck 8 Lounge', 'Low-key craft table and conversation.'],
    ['Open Deck Conversation Group', 'deck', 'Aft Deck', 'No fixed topic. Just public conversation and a good view.'],
    ['Midnight Snack Run', 'social', 'Buffet', 'Meet at the buffet. Keep expectations realistic.'],
    ['Post-Port Story Swap', 'social', 'Atrium Steps', 'Talk through the day and sort the photos.'],
  ];

  return templates.map((template, index) => {
    const [title, category, location, description] = template;
    const host = hosts[index % hosts.length];
    const day = index % 6;
    const hour = [12, 15, 17, 19, 21, 23][index % 6];
    return {
      creator_username: host.username,
      event_type: 'user',
      category,
      title,
      description,
      location,
      visibility: 'public',
      moderation_status: 'visible',
      start_at: isoForDemo(base, day, hour, index % 2 ? 30 : 0),
      end_at: isoForDemo(base, day, hour + 1, index % 2 ? 30 : 0),
    };
  });
}

function demoEventTitles() {
  const base = demoBaseDate();
  const passengers = buildDemoPassengers();
  return [
    ...buildOfficialDemoEvents(base).map((event) => event.title),
    ...buildPassengerDemoEvents(base, passengers).map((event) => event.title),
  ];
}

function buildFriendshipRows(passengers, userMap) {
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < passengers.length; i += 1) {
    for (let offset = 1; offset <= 4; offset += 1) {
      const j = (i + offset) % passengers.length;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = `${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const requester = passengers[a];
      const addressee = passengers[b];
      rows.push({
        requester_id: userMap[requester.username],
        addressee_id: userMap[addressee.username],
        status: 'accepted',
        created_at: new Date(Date.now() - (rows.length + 1) * 3600000).toISOString(),
        responded_at: new Date(Date.now() - (rows.length + 1) * 3000000).toISOString(),
      });
    }
  }
  return rows;
}

function buildTopFriendsRows(passengers, userMap) {
  const rows = [];
  passengers.forEach((passenger, index) => {
    for (let position = 1; position <= 8; position += 1) {
      const friend = passengers[(index + position) % passengers.length];
      rows.push({
        user_id: userMap[passenger.username],
        friend_user_id: userMap[friend.username],
        position,
        created_at: new Date(Date.now() - position * 7200000).toISOString(),
      });
    }
  });
  return rows;
}

function buildWallPostRows(passengers, userMap) {
  const templates = [
    'Saving you a spot at the later set if you are still going.',
    'Your page looks solid now. Adding you before I forget.',
    'Meet at the pool deck in 20? A few of us are heading up.',
    'Glad you posted that plan because I was going to make the same one.',
    'If you are still doing the port meetup, count me in.',
    'Your Top 8 is already causing conversation in the lounge.',
    'That photo you uploaded is exactly why this board works.',
    'Checking if you are still going to the late-night hang.',
  ];
  const rows = [];
  passengers.forEach((target, index) => {
    const authors = [
      passengers[(index + 1) % passengers.length],
      passengers[(index + 5) % passengers.length],
    ];
    authors.forEach((author, inner) => {
      rows.push({
        profile_user_id: userMap[target.username],
        author_user_id: userMap[author.username],
        body: templates[(index + inner) % templates.length],
        moderation_status: 'visible',
        created_at: new Date(Date.now() - (index * 25 + inner * 8 + 1) * 600000).toISOString(),
      });
    });
  });
  return rows;
}

function buildPhotoRows(passengers, userMap, sailingId, eventRows) {
  const photos = [];
  for (let i = 0; i < 30; i += 1) {
    const passenger = passengers[i % passengers.length];
    const event = eventRows[i % eventRows.length] || null;
    const seed = `shattered-shores-${i + 1}`;
    photos.push({
      user_id: userMap[passenger.username],
      sailing_id: sailingId,
      event_id: i % 2 === 0 ? event?.id || null : null,
      storage_key: `https://picsum.photos/seed/${seed}/1200/900`,
      thumb_key: `https://picsum.photos/seed/${seed}/400/400`,
      medium_key: `https://picsum.photos/seed/${seed}/900/700`,
      width: 1200,
      height: 900,
      file_size_bytes: 450000 + i * 2300,
      caption: [
        'Late set on deck.',
        'Pool deck before sunset.',
        'Group photo before dinner.',
        'Havana port day.',
        'Atrium lights looked too good not to post.',
        'Proof that people actually showed up.',
      ][i % 6],
      moderation_status: 'visible',
      created_at: new Date(Date.now() - (i + 1) * 2700000).toISOString(),
    });
  }
  return photos;
}

function buildEventRsvpRows(passengers, userMap, eventRows) {
  const rows = [];
  eventRows.forEach((event, eventIndex) => {
    const attendeeCount = event.event_type === 'official' ? 14 + (eventIndex % 8) : 7 + (eventIndex % 4);
    for (let i = 0; i < attendeeCount; i += 1) {
      const passenger = passengers[(eventIndex * 3 + i) % passengers.length];
      rows.push({
        event_id: event.id,
        user_id: userMap[passenger.username],
        status: i < attendeeCount - 2 ? 'going' : 'interested',
        created_at: new Date(Date.now() - (eventIndex + i + 1) * 1800000).toISOString(),
      });
    }
  });
  return rows;
}

function buildNotificationRows(wallPosts, eventRows, rsvps) {
  const rows = [];
  wallPosts.slice(0, 60).forEach((post) => {
    if (post.profile_user_id === post.author_user_id) return;
    rows.push({
      user_id: post.profile_user_id,
      type: 'wall_post',
      object_type: 'wall_post',
      object_id: null,
      actor_id: post.author_user_id,
      message: 'posted on your wall.',
      created_at: post.created_at,
    });
  });

  const eventById = Object.fromEntries(eventRows.map((event) => [event.id, event]));
  rsvps.slice(0, 80).forEach((rsvp) => {
    const event = eventById[rsvp.event_id];
    if (!event || event.creator_user_id === rsvp.user_id) return;
    rows.push({
      user_id: event.creator_user_id,
      type: 'rsvp',
      object_type: 'event',
      object_id: event.id,
      actor_id: rsvp.user_id,
      message: `RSVPed to your event: ${event.title}`,
      created_at: rsvp.created_at,
    });
  });

  return rows;
}

async function clearDemoState(db, env, sailingId, expectedUsernames = []) {
  let meta = null;
  const metaJson = await env.KV?.get(demoSeedKey(sailingId)).catch(() => null);
  if (metaJson) {
    try { meta = JSON.parse(metaJson); } catch (_) {}
  }

  const usernames = [...new Set([DEMO_CREW_USERNAME, ...expectedUsernames, ...(meta?.usernames || [])])];
  if (usernames.length) {
    const { data: demoUsers } = await db.from('users')
      .select('id, username')
      .eq('sailing_id', sailingId)
      .in('username', usernames);
    const ids = (demoUsers || []).map((user) => user.id);

    if (ids.length) {
      await db.from('notifications').delete().in('actor_id', ids).catch(() => {});
      await db.from('audit_logs').delete().in('actor_user_id', ids).catch(() => {});
      await db.from('reports').delete().in('reporter_user_id', ids).catch(() => {});
      await db.from('users').delete().in('id', ids).catch(() => {});
    }
  }

  if (meta?.voyageDates?.length) {
    await db.from('voyage_days')
      .delete()
      .eq('sailing_id', sailingId)
      .in('day_date', meta.voyageDates)
      .catch(() => {});
  }

  const titles = demoEventTitles();
  if (titles.length) {
    await db.from('events')
      .delete()
      .eq('sailing_id', sailingId)
      .in('title', titles)
      .catch(() => {});
  }

  const fallbackVoyageDates = buildDemoVoyageDays(demoBaseDate()).map((day) => day.day_date);
  await db.from('voyage_days')
    .delete()
    .eq('sailing_id', sailingId)
    .in('day_date', fallbackVoyageDates)
    .catch(() => {});

  await Promise.all([
    env.KV?.delete(`sailing:${sailingId}:weather`).catch(() => {}),
    env.KV?.delete(`sailing:${sailingId}:bulletin`).catch(() => {}),
    env.KV?.delete(demoSeedKey(sailingId)).catch(() => {}),
  ]);
}

admin.get('/admin/demo', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const csrf    = c.get('csrfToken') || '';
  const demoPassengers = buildDemoPassengers();
  const demoUsernames = demoPassengers.map((passenger) => passenger.username);

  const [wxJson, bulletinJson, metaJson] = await Promise.all([
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null),
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null),
    c.env.KV?.get(demoSeedKey(c.env.SAILING_ID)).catch(() => null),
  ]);
  let demoMeta = null;
  if (metaJson) {
    try { demoMeta = JSON.parse(metaJson); } catch (_) {}
  }
  const errorMsg = c.req.query('error') || '';

  const { data: demoUsers } = await db.from('users')
    .select('id, username')
    .eq('sailing_id', c.env.SAILING_ID)
    .in('username', [DEMO_CREW_USERNAME, ...demoUsernames]);
  const demoIds = (demoUsers || []).map((entry) => entry.id);
  const demoPassengerIds = (demoUsers || []).filter((entry) => entry.username !== DEMO_CREW_USERNAME).map((entry) => entry.id);

  let demoEventsRes = { count: 0 };
  let demoWallsRes = { count: 0 };
  let demoPhotosRes = { count: 0 };
  if (demoIds.length) {
    [demoEventsRes, demoWallsRes, demoPhotosRes] = await Promise.all([
      db.from('events').select('id', { count: 'exact', head: true }).in('creator_user_id', demoIds),
      db.from('wall_posts').select('id', { count: 'exact', head: true }).or(`author_user_id.in.(${demoIds.join(',')}),profile_user_id.in.(${demoIds.join(',')})`),
      db.from('photos').select('id', { count: 'exact', head: true }).in('user_id', demoPassengerIds.length ? demoPassengerIds : demoIds),
    ]);
  }

  const { count: voyageCount } = await db.from('voyage_days')
    .select('id', { count: 'exact', head: true })
    .eq('sailing_id', c.env.SAILING_ID);

  const demoUserLine = `<div style="margin-bottom:4px">${demoPassengerIds.length > 0 ? `&#x2713; Demo passengers: ${demoPassengerIds.length}/${demoPassengers.length} created` : '&#x25CB; Demo passengers: none'}</div>`;
  const demoEventLine = `<div style="margin-bottom:4px">${demoEventsRes?.count ? `&#x2713; Demo events: ${demoEventsRes.count}` : '&#x25CB; Demo events: none'}</div>`;
  const demoWallLine = `<div style="margin-bottom:4px">${demoWallsRes?.count ? `&#x2713; Wall posts: ${demoWallsRes.count}` : '&#x25CB; Wall posts: none'}</div>`;
  const demoPhotoLine = `<div style="margin-bottom:4px">${demoPhotosRes?.count ? `&#x2713; Demo photos: ${demoPhotosRes.count}` : '&#x25CB; Demo photos: none'}</div>`;
  const demoVoyageLine = `<div style="margin-bottom:4px">${voyageCount ? `&#x2713; Voyage days: ${voyageCount}` : '&#x25CB; Voyage days: none'}</div>`;

  const body = module({
    header: 'Demo Setup',
    body: `<div style="font-size:11px;margin-bottom:12px;padding:8px;background:#fafafa;border:1px solid #ddd">
      <div style="margin-bottom:4px">${wxJson ? '&#x2713; Weather: set' : '&#x25CB; Weather: using demo fallback'}</div>
      <div style="margin-bottom:4px">${bulletinJson ? '&#x2713; Bulletin: active' : '&#x25CB; Bulletin: none'}</div>
      ${demoUserLine}
      ${demoEventLine}
      ${demoWallLine}
      ${demoPhotoLine}
      ${demoVoyageLine}
    </div>
    <p style="font-size:12px;margin-bottom:10px;line-height:1.5">
      Builds a full Shattered Shores client demo: <strong>${demoPassengers.length} demo passengers</strong>,
      seeded friendships, Top 8 lists, wall posts, photos, RSVPs, notifications, and a 7-day Miami to Havana round-trip itinerary.
      Demo login password is <code>${DEMO_PASSWORD}</code>. Re-running resets the demo cohort first so the client demo returns to a known state.
    </p>
    ${demoMeta ? `<p style="font-size:11px;margin:0 0 10px;color:#666">Last seeded ${relTime(demoMeta.seeded_at)} &middot; ${esc(demoMeta.version || DEMO_META_VERSION)}</p>` : ''}
    ${errorMsg ? `<div class="ds-flash error" style="margin:0 0 10px">${esc(errorMsg)}</div>` : ''}
    <form method="POST" action="/admin/demo/seed" style="display:inline-block;margin-right:6px">
      ${csrfField(csrf)}
      <button type="submit" class="ds-btn ds-btn-orange">Reset &amp; Seed Demo &raquo;</button>
    </form>
    <form method="POST" action="/admin/demo/clear" style="display:inline-block" onsubmit="return confirm('Clear all seeded demo passengers, events, photos, and voyage days?');">
      ${csrfField(csrf)}
      <button type="submit" class="ds-btn ds-btn-sm">Clear Demo Data</button>
    </form>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <a href="/admin/weather" class="ds-btn ds-btn-sm">Edit Weather</a>
      <a href="/admin/bulletin" class="ds-btn ds-btn-sm">Edit Bulletin</a>
    </div>`
  });

  return c.html(layoutCtx(c, { title: 'Demo Setup', user, sailing, body }));
});

admin.post('/admin/demo/seed', async (c) => {
  try {
    const db        = getDb(c.env);
    const sailingId = c.env.SAILING_ID;
    const now       = new Date().toISOString();
    const baseDate  = demoBaseDate();
    const demoPassengers = buildDemoPassengers();
    const demoUsernames = demoPassengers.map((passenger) => passenger.username);
    const voyageDays = buildDemoVoyageDays(baseDate);

    await clearDemoState(db, c.env, sailingId, demoUsernames);

    const weather = {
      temp_f: 82,
      temp_c: 28,
      conditions: 'Warm Seas',
      wind_knots: 11,
      wind_dir: 'ESE',
      wave_ft: '2-4',
      icon: 'sun',
      location: 'Straits of Florida',
      updated_at: now,
    };
    const bulletin = {
      text: 'Welcome to Shattered Shores. Tonight: Sail Away Sad Songs on the Pool Deck, Top 8 Originals Mixer in the Atrium Lounge, and Midnight Emo Karaoke after hours.',
      author: 'Shattered Shores Crew',
      created_at: now,
    };
    await Promise.all([
      c.env.KV?.put(`sailing:${sailingId}:weather`, JSON.stringify(weather), { expirationTtl: 86400 * 7 }).catch(() => {}),
      c.env.KV?.put(`sailing:${sailingId}:bulletin`, JSON.stringify(bulletin), { expirationTtl: 86400 * 7 }).catch(() => {}),
    ]);

    const demoHash = await hashPassword(DEMO_PASSWORD);

    await db.from('users').upsert([{
      sailing_id: sailingId,
      username: DEMO_CREW_USERNAME,
      display_name: 'Shattered Shores Crew',
      password_hash: demoHash,
      account_status: 'active',
      activation_status: 'active',
      role: 'moderator',
      last_active_at: now,
      created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    }], { onConflict: 'sailing_id,username' });

    await db.from('users').upsert(
      demoPassengers.map((passenger, index) => ({
        sailing_id: sailingId,
        username: passenger.username,
        display_name: passenger.display_name,
        password_hash: demoHash,
        account_status: 'active',
        activation_status: 'active',
        role: 'passenger',
        last_active_at: new Date(Date.now() - (index < 18 ? (index + 1) * 60000 : (index + 4) * 540000)).toISOString(),
        created_at: new Date(Date.now() - ((index % 9) + 1) * 86400000).toISOString(),
      })),
      { onConflict: 'sailing_id,username' }
    );

    const { data: allDemoUsers } = await db.from('users')
      .select('id, username')
      .eq('sailing_id', sailingId)
      .in('username', [DEMO_CREW_USERNAME, ...demoUsernames]);
    const userMap = Object.fromEntries((allDemoUsers || []).map((row) => [row.username, row.id]));
    const crewId = userMap[DEMO_CREW_USERNAME];
    const missingUsers = demoUsernames.filter((username) => !userMap[username]);
    if (!crewId || missingUsers.length) {
      throw new Error(`Demo user provisioning incomplete (${missingUsers.length} passenger accounts missing).`);
    }

    await db.from('profiles').upsert({
      user_id: crewId,
      about_me: 'Official host account for the Shattered Shores client demo. This account posts public bulletins and runs official programming.',
      hometown: 'On Board',
      vibe_tags: ['official','updates','schedule'],
      social_intent: 'Public host account for demo content',
      status_text: 'posting tonight’s update',
      song_title: 'The Sharpest Lives',
      song_artist: 'My Chemical Romance',
      theme_id: 'night',
    }, { onConflict: 'user_id' }).catch(() => {});

    await db.from('profiles').upsert(
      demoPassengers.map((passenger) => ({
        user_id: userMap[passenger.username],
        about_me: passenger.about_me,
        hometown: passenger.hometown,
        vibe_tags: passenger.vibe_tags,
        who_id_like_to_meet: passenger.who_id_like_to_meet,
        social_intent: passenger.social_intent,
        status_text: passenger.status_text,
        song_title: passenger.song_title,
        song_artist: passenger.song_artist,
        theme_id: passenger.theme_id || 'classic',
        updated_at: now,
      })),
      { onConflict: 'user_id' }
    ).catch(() => {});

    await db.from('voyage_days')
      .delete()
      .eq('sailing_id', sailingId)
      .in('day_date', voyageDays.map((day) => day.day_date))
      .catch(() => {});

    await db.from('voyage_days').insert(
      voyageDays.map((day) => ({ sailing_id: sailingId, ...day }))
    ).catch(() => {});

    const friendshipRows = buildFriendshipRows(demoPassengers, userMap);
    if (friendshipRows.length) await db.from('friendships').insert(friendshipRows).catch(() => {});

    const topFriendRows = buildTopFriendsRows(demoPassengers, userMap);
    if (topFriendRows.length) await db.from('top_friends').insert(topFriendRows).catch(() => {});

    const wallPostRows = buildWallPostRows(demoPassengers, userMap);
    if (wallPostRows.length) await db.from('wall_posts').insert(wallPostRows).catch(() => {});

    await db.from('events')
      .delete()
      .eq('sailing_id', sailingId)
      .in('title', demoEventTitles())
      .catch(() => {});

    const officialEvents = buildOfficialDemoEvents(baseDate).map((event) => ({ ...event, sailing_id: sailingId, creator_user_id: crewId }));
    const passengerEvents = buildPassengerDemoEvents(baseDate, demoPassengers).map((event) => ({
      ...event,
      sailing_id: sailingId,
      creator_user_id: userMap[event.creator_username],
    }));
    const allEventsToInsert = [...officialEvents, ...passengerEvents].map(({ creator_username, day, hour, minute, ...event }) => event);
    const { data: createdEvents, error: eventsError } = await db.from('events').insert(allEventsToInsert).select('id, title, creator_user_id, event_type, start_at');
    if (eventsError) throw eventsError;
    const eventRows = createdEvents || [];

    const rsvpRows = buildEventRsvpRows(demoPassengers, userMap, eventRows);
    if (rsvpRows.length) await db.from('event_rsvps').insert(rsvpRows).catch(() => {});

    const photoRows = buildPhotoRows(demoPassengers, userMap, sailingId, eventRows);
    if (photoRows.length) await db.from('photos').insert(photoRows).catch(() => {});

    const notificationRows = buildNotificationRows(wallPostRows, eventRows, rsvpRows);
    if (notificationRows.length) await db.from('notifications').insert(notificationRows).catch(() => {});

    await c.env.KV?.put(demoSeedKey(sailingId), JSON.stringify({
      version: DEMO_META_VERSION,
      seeded_at: now,
      usernames: demoUsernames,
      crew_username: DEMO_CREW_USERNAME,
      voyageDates: voyageDays.map((day) => day.day_date),
      counts: {
        passengers: demoPassengers.length,
        friendships: friendshipRows.length,
        topFriends: topFriendRows.length,
        wallPosts: wallPostRows.length,
        events: allEventsToInsert.length,
        rsvps: rsvpRows.length,
        photos: photoRows.length,
        notifications: notificationRows.length,
      }
    }), { expirationTtl: 86400 * 14 }).catch(() => {});

    return c.redirect('/admin/demo');
  } catch (err) {
    console.error('[Demo Seed Error]', err);
    return c.redirect('/admin/demo?error=' + encodeURIComponent(err?.message || 'Demo seeding failed.'));
  }
});

admin.post('/admin/demo/clear', async (c) => {
  const db = getDb(c.env);
  const demoPassengers = buildDemoPassengers();
  await clearDemoState(db, c.env, c.env.SAILING_ID, demoPassengers.map((passenger) => passenger.username));
  return c.redirect('/admin/demo');
});

export default admin;
