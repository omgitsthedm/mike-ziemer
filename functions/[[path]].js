/**
 * Deckspace — Cloudflare Pages Functions entry point
 *
 * All dynamic requests are handled here.
 * Static files in /public/ are served directly by Pages CDN.
 *
 * Stack: Hono v4 on Cloudflare Workers runtime
 */

import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getDb, getUnreadNotifCount, getSailing } from '../src/lib/db.js';
import { loadSession } from '../src/lib/auth.js';

// Route modules
import authRoutes          from '../src/routes/auth.js';
import homeRoutes          from '../src/routes/home.js';
import profileRoutes       from '../src/routes/profile.js';
import peopleRoutes        from '../src/routes/people.js';
import eventsRoutes        from '../src/routes/events.js';
import photosRoutes        from '../src/routes/photos.js';
import friendsRoutes       from '../src/routes/friends.js';
import notificationsRoutes from '../src/routes/notifications.js';
import adminRoutes         from '../src/routes/admin.js';

const app = new Hono();

/* ============================================================
   GLOBAL MIDDLEWARE
   ============================================================ */

// Load session on every request, attach unread notif count
app.use('*', loadSession);

app.use('*', async (c, next) => {
  // Inject unread notification count into context for nav rendering
  const user = c.get('user');
  if (user) {
    try {
      const db    = getDb(c.env);
      const count = await getUnreadNotifCount(db, user.id);
      c.set('notifCount', count);
    } catch (_) {
      c.set('notifCount', 0);
    }
  } else {
    c.set('notifCount', 0);
  }
  return next();
});

/* ============================================================
   SECURITY HEADERS
   ============================================================ */
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  c.res.headers.set('Referrer-Policy', 'same-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP — tight; allow Turnstile and our CDN only
  const cspParts = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${c.env.R2_PUBLIC_URL || ''}`,
    "frame-src https://challenges.cloudflare.com",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ];
  c.res.headers.set('Content-Security-Policy', cspParts.join('; '));
});

/* ============================================================
   ROUTES
   ============================================================ */
app.route('/', authRoutes);
app.route('/', homeRoutes);
app.route('/', profileRoutes);
app.route('/', peopleRoutes);
app.route('/', eventsRoutes);
app.route('/', photosRoutes);
app.route('/', friendsRoutes);
app.route('/', notificationsRoutes);
app.route('/', adminRoutes);

/* ============================================================
   REPORT FORM (available to all authenticated users)
   ============================================================ */
app.get('/report', loadSession, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const type    = c.req.query('type') || '';
  const id      = c.req.query('id') || '';

  if (!user) return c.redirect('/login?next=/report');

  const { layout, esc } = await import('../src/templates/layout.js');
  const { module } = await import('../src/templates/components.js');

  const body = module({
    header: 'Report Content',
    body: `<div class="ds-module-body">
  <form method="POST" action="/report" class="ds-form">
    <input type="hidden" name="target_type" value="${esc(type)}">
    <input type="hidden" name="target_id" value="${esc(id)}">
    <div class="ds-form-row">
      <label for="reason">Reason for report</label>
      <textarea id="reason" name="reason" class="ds-textarea" rows="4" required maxlength="1000" placeholder="Describe the issue..."></textarea>
    </div>
    <div class="ds-form-row mt-8">
      <button type="submit" class="ds-btn ds-btn-primary">Submit Report</button>
      <a href="javascript:history.back()" class="ds-btn" style="margin-left:6px">Cancel</a>
    </div>
  </form>
</div>`
  });

  return c.html(layout({ title: 'Report Content', user, sailing, body }));
});

app.post('/report', loadSession, async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const db       = getDb(c.env);
  const form     = await c.req.formData();
  const type     = (form.get('target_type') || '').toString();
  const id       = (form.get('target_id') || '').toString();
  const reason   = (form.get('reason') || '').toString().trim().slice(0, 1000);

  if (reason && type && id) {
    await db.from('reports').insert({
      reporter_user_id: user.id,
      target_type: type,
      target_id: id,
      reason
    });
  }

  return c.redirect('back');
});

/* ============================================================
   HEALTH CHECK
   ============================================================ */
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

/* ============================================================
   404 FALLBACK
   ============================================================ */
app.notFound(async (c) => {
  const { layout } = await import('../src/templates/layout.js');
  const user = c.get('user');
  return c.html(layout({
    title: 'Not Found',
    user,
    body: `<div style="max-width:400px;margin:30px auto;text-align:center">
      <div class="ds-module">
        <div class="ds-module-header">Page Not Found</div>
        <div class="ds-module-body">
          <p style="font-size:13px;margin-bottom:10px">This page doesn't exist or has been removed.</p>
          <a href="/" class="ds-btn ds-btn-primary">Go Home</a>
        </div>
      </div>
    </div>`
  }), 404);
});

/* ============================================================
   ERROR HANDLER
   ============================================================ */
app.onError(async (err, c) => {
  console.error('[Deckspace Error]', err);
  const { layout } = await import('../src/templates/layout.js');
  const user = c.get('user');

  const isDev = c.env.ENVIRONMENT === 'development';
  const message = isDev ? err.message : 'Something went wrong. Please try again.';

  return c.html(layout({
    title: 'Error',
    user,
    body: `<div style="max-width:400px;margin:30px auto">
      <div class="ds-module">
        <div class="ds-module-header">Error</div>
        <div class="ds-module-body">
          <div class="ds-flash error">${message}</div>
          <a href="/" class="ds-btn">Go Home</a>
          ${isDev ? `<pre style="font-size:10px;margin-top:8px;overflow:auto">${err.stack || ''}</pre>` : ''}
        </div>
      </div>
    </div>`
  }), 500);
});

/* ============================================================
   EXPORT for Cloudflare Pages Functions
   ============================================================ */
export const onRequest = handle(app);
