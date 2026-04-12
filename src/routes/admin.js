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
   DEMO SETUP — one-click KV seed for presentations
   Seeds weather + ship bulletin with Shattered Shores defaults.
   Safe to re-run; does not touch the database.
   ============================================================ */
admin.get('/admin/demo', async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const csrf    = c.get('csrfToken') || '';

  const [wxJson, bulletinJson] = await Promise.all([
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:weather`).catch(() => null),
    c.env.KV?.get(`sailing:${c.env.SAILING_ID}:bulletin`).catch(() => null),
  ]);

  const { count: demoCount } = await db.from('users')
    .select('id', { count: 'exact', head: true })
    .eq('sailing_id', c.env.SAILING_ID)
    .in('username', ['sarah_k','marco_v','jenna_b','derek_w','tasha_m','kevin_r','amber_h','carlos_p','lisa_ng','tyler_j','maya_s','ben_f','rachel_t','jake_m','priya_v']);

  const demoUserLine = `<div style="margin-bottom:4px">${(demoCount || 0) > 0 ? `&#x2713; Demo passengers: ${demoCount}/15 created` : '&#x25CB; Demo passengers: none'}</div>`;

  const body = module({
    header: 'Demo Setup',
    body: `<div style="font-size:11px;margin-bottom:12px;padding:8px;background:#fafafa;border:1px solid #ddd">
      <div style="margin-bottom:4px">${wxJson ? '&#x2713; Weather: set' : '&#x25CB; Weather: using demo fallback'}</div>
      <div style="margin-bottom:4px">${bulletinJson ? '&#x2713; Bulletin: active' : '&#x25CB; Bulletin: none'}</div>
      ${demoUserLine}
    </div>
    <p style="font-size:12px;margin-bottom:10px;line-height:1.5">
      Seeds the site with Caribbean weather, a ship bulletin, and <strong>15 demo passengers</strong>
      with profiles, interest tags, and wall posts between them. Demo login password is <code>demo1234</code>.
      Safe to re-run &mdash; skips users that already exist.
    </p>
    <form method="POST" action="/admin/demo/seed">
      ${csrfField(csrf)}
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
  const db        = getDb(c.env);
  const sailingId = c.env.SAILING_ID;
  const now       = new Date().toISOString();

  /* ---- KV: weather + bulletin ---- */
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
    text: 'Tonight: Main Stage at 11PM. The outer deck is open all night \u2014 see you out there.',
    author: 'Cruise Crew',
    created_at: now,
  };
  await Promise.all([
    c.env.KV?.put(`sailing:${sailingId}:weather`, JSON.stringify(weather), { expirationTtl: 86400 * 7 }).catch(() => {}),
    c.env.KV?.put(`sailing:${sailingId}:bulletin`, JSON.stringify(bulletin), { expirationTtl: 86400 * 7 }).catch(() => {}),
  ]);

  /* ---- Demo passengers ---- */
  const DEMO_USERS = [
    { username: 'sarah_k',   display_name: 'Sarah K.',         hometown: 'Miami, FL',         vibe_tags: ['dancing','pool','foodie'],         status_text: 'living for this Caribbean sun',    about_me: "Miami girl born and raised! This is my 4th cruise and I never get tired of it. Find me at the pool or on the dance floor way too late." },
    { username: 'marco_v',   display_name: 'Marco Villanueva', hometown: 'Austin, TX',        vibe_tags: ['trivia','poker','nightlife'],       status_text: 'trivia night champion (self-titled)', about_me: "Came for the poker tables, staying for the sunsets. Ask me about the best BBQ in Texas. I will talk about it for too long." },
    { username: 'jenna_b',   display_name: 'Jenna Bridges',    hometown: 'Nashville, TN',     vibe_tags: ['karaoke','music','comedy'],         status_text: 'mic drop incoming',                about_me: "Nashville songwriter on vacation (sort of). I will 100% challenge you to karaoke. You've been warned." },
    { username: 'derek_w',   display_name: 'Derek Walsh',      hometown: 'Chicago, IL',       vibe_tags: ['gym','adventure','sea day'],        status_text: 'already found the gym on this ship', about_me: "Chicago guy. Personal trainer by day, cruise person by also day. Looking to explore every port stop on this trip." },
    { username: 'tasha_m',   display_name: 'Tasha Monroe',     hometown: 'Atlanta, GA',       vibe_tags: ['dancing','nightlife','foodie'],     status_text: 'this buffet is undefeated',         about_me: "ATL in the house! Event planner in real life so I take cruise activities very seriously. Let's actually have fun out here." },
    { username: 'kevin_r',   display_name: 'Kevin Reyes',      hometown: 'Los Angeles, CA',   vibe_tags: ['chill','pool','music'],             status_text: 'golden hour photos > everything',  about_me: "LA photographer on a much-needed break from screens. Except my camera. But that's it." },
    { username: 'amber_h',   display_name: 'Amber Howell',     hometown: 'Denver, CO',        vibe_tags: ['excursion','adventure','sea day'],  status_text: 'snorkeling tomorrow I am SO ready', about_me: "Colorado girl who needs her adventure fix even on vacation. First cruise ever — I've signed up for every single excursion." },
    { username: 'carlos_p',  display_name: 'Carlos Perez',     hometown: 'Houston, TX',       vibe_tags: ['poker','trivia','comedy'],          status_text: 'offline (finally)',                about_me: "Houston native. Software engineer who deleted Slack for this trip. The comedy show last night was actually really good." },
    { username: 'lisa_ng',   display_name: 'Lisa Ng',          hometown: 'San Francisco, CA', vibe_tags: ['foodie','chill','music'],           status_text: 'the ceviche in Nassau was unreal',  about_me: "SF foodie and music nerd. Cruise goal: eat everything, hear everything, stress about nothing. So far so good." },
    { username: 'tyler_j',   display_name: 'Tyler James',      hometown: 'Dallas, TX',        vibe_tags: ['karaoke','dancing','nightlife'],    status_text: 'just closed down the karaoke bar',  about_me: "Dallas born, always late to the party but I make up for it. Karaoke is my love language. Yes I know all the words to everything." },
    { username: 'maya_s',    display_name: 'Maya Singh',       hometown: 'New York, NY',      vibe_tags: ['chill','sea day','music'],          status_text: 'do not disturb',                   about_me: "NYC lawyer finally taking a real vacation. My plan is to do nothing. Nothing at all. Thank you for understanding." },
    { username: 'ben_f',     display_name: 'Ben Forsyth',      hometown: 'Boston, MA',        vibe_tags: ['trivia','poker','comedy'],          status_text: 'found 3 other Sox fans on board',  about_me: "Boston guy. Red Sox fan. Yes I brought a jersey. No I'm not sorry. Let's play trivia — I actually know things." },
    { username: 'rachel_t',  display_name: 'Rachel Torres',    hometown: 'Orlando, FL',       vibe_tags: ['dancing','pool','excursion'],       status_text: 'birthday cruise lets gooo',         about_me: "Orlando local here with my sister for a birthday trip! First real vacation in two years. Very ready for this." },
    { username: 'jake_m',    display_name: 'Jake Miller',      hometown: 'Seattle, WA',       vibe_tags: ['adventure','excursion','sea day'],  status_text: 'it is 84 degrees and I am losing it', about_me: "Pacific Northwest hiking guy on his first Caribbean trip. How is the weather this good? I don't understand and I love it." },
    { username: 'priya_v',   display_name: 'Priya Varma',      hometown: 'Phoenix, AZ',       vibe_tags: ['foodie','music','chill'],           status_text: 'eating my way through the Caribbean', about_me: "Phoenix foodie and amateur chef. I'm taking notes on every dish I eat on this ship. The buffet selection is my new religion." },
  ];

  // Hash the demo password once, reuse for all demo users
  const demoHash = await hashPassword('demo1234');

  // Find which demo usernames already exist for this sailing
  const { data: existing } = await db.from('users')
    .select('username')
    .eq('sailing_id', sailingId)
    .in('username', DEMO_USERS.map(u => u.username));
  const existingSet = new Set((existing || []).map(u => u.username));
  const toCreate = DEMO_USERS.filter(u => !existingSet.has(u.username));

  // Insert new users in one batch
  let createdUsers = [];
  if (toCreate.length) {
    const { data } = await db.from('users').insert(
      toCreate.map(u => ({
        sailing_id:        sailingId,
        username:          u.username,
        display_name:      u.display_name,
        password_hash:     demoHash,
        account_status:    'active',
        activation_status: 'active',
        role:              'passenger',
      }))
    ).select('id, username');
    createdUsers = data || [];
  }

  // Fetch ALL demo user IDs (both newly created and pre-existing)
  const { data: allDemoUsers } = await db.from('users')
    .select('id, username')
    .eq('sailing_id', sailingId)
    .in('username', DEMO_USERS.map(u => u.username));
  const userMap = Object.fromEntries((allDemoUsers || []).map(u => [u.username, u.id]));

  // Upsert profiles for newly created users
  if (createdUsers.length) {
    const profileData = createdUsers.map(u => {
      const demo = DEMO_USERS.find(d => d.username === u.username);
      return {
        user_id:     u.id,
        about_me:    demo?.about_me    || null,
        hometown:    demo?.hometown    || null,
        vibe_tags:   demo?.vibe_tags   || null,
        status_text: demo?.status_text || null,
        theme_id:    'classic',
      };
    });
    await db.from('profiles').upsert(profileData, { onConflict: 'user_id' }).catch(() => {});
  }

  // Wall posts between demo users (only insert if wall is empty)
  const WALL_POSTS = [
    { from: 'marco_v',  to: 'sarah_k',  body: "Great meeting you at the pool! Still can't believe you beat me at shuffleboard 😅" },
    { from: 'sarah_k',  to: 'marco_v',  body: "Practice makes perfect!! You coming to trivia tonight?" },
    { from: 'jenna_b',  to: 'tyler_j',  body: "That karaoke set last night was incredible. We're doing a duet tonight and that's final." },
    { from: 'tyler_j',  to: 'jenna_b',  body: "Already picked the song. Don't let me down, Nashville 🎤" },
    { from: 'derek_w',  to: 'amber_h',  body: "Nice meeting you at the excursion desk! The snorkeling is gonna be amazing." },
    { from: 'amber_h',  to: 'derek_w',  body: "SO pumped!! Don't judge me if I scream into my mask a little bit" },
    { from: 'carlos_p', to: 'ben_f',    body: "Trivia rematch tonight. I looked up everything I got wrong last time 📚" },
    { from: 'ben_f',    to: 'carlos_p', body: "I have been studying 90s movies since 2PM. Come prepared." },
    { from: 'tasha_m',  to: 'rachel_t', body: "Happy early birthday!! Meet by the main stage at 9 — trust me 🎉" },
    { from: 'rachel_t', to: 'tasha_m',  body: "You are literally the nicest person on this whole ship omg 😭 YES 9PM!!" },
    { from: 'lisa_ng',  to: 'priya_v',  body: "Someone told me you're a chef?? I need your honest rating of the sushi situation on this ship" },
    { from: 'priya_v',  to: 'lisa_ng',  body: "Solid 7/10 given we're in the middle of the ocean. The ceviche however? Absolutely undefeated." },
    { from: 'maya_s',   to: 'kevin_r',  body: "Those photos you posted from Nassau are stunning!! What camera do you use?" },
    { from: 'kevin_r',  to: 'maya_s',   body: "Thanks!! Sony A7 IV. Happy to give you a quick lesson if you want — I'm usually at the pool deck in the AM." },
    { from: 'jake_m',   to: 'derek_w',  body: "Fellow outdoor person spotted 🙌 You doing the Great Stirrup Cay beach thing? Looks incredible." },
    { from: 'derek_w',  to: 'jake_m',   body: "100% in — meeting at the gangway at 8:30. The more the merrier!" },
    { from: 'priya_v',  to: 'tasha_m',  body: "The spicy tuna roll at the sushi counter is SO worth the wait by the way. Just saying." },
    { from: 'marco_v',  to: 'carlos_p', body: "Poker room, 10PM tonight. I need to win back my dignity from last night." },
  ];

  // Only post walls for newly created users to avoid duplicates on re-seed
  const newUsernames = new Set(createdUsers.map(u => u.username));
  const wallsToPost = WALL_POSTS.filter(p => newUsernames.has(p.from) || newUsernames.has(p.to));

  if (wallsToPost.length) {
    // Stagger timestamps over the last 48 hours
    const wallRows = wallsToPost.map((p, i) => {
      const authorId  = userMap[p.from];
      const profileId = userMap[p.to];
      if (!authorId || !profileId) return null;
      const msAgo = (wallsToPost.length - i) * 90 * 60 * 1000; // every ~90 min going back
      return {
        author_user_id:  authorId,
        profile_user_id: profileId,
        body:            p.body,
        created_at:      new Date(Date.now() - msAgo).toISOString(),
        moderation_status: 'visible',
      };
    }).filter(Boolean);

    if (wallRows.length) {
      await db.from('wall_posts').insert(wallRows).catch(() => {});
    }
  }

  return c.redirect('/admin/demo');
});

export default admin;
