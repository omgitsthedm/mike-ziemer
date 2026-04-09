/**
 * Deckspace — First-Run Admin Setup
 *
 * GET  /setup  — show bootstrap form (only when no users exist)
 * POST /setup  — create admin account + log in
 *
 * This route is ONLY accessible when zero users exist for the current
 * SAILING_ID. Once any user is created it redirects to /login forever.
 */

import { Hono } from 'hono';
import { getDb } from '../lib/db.js';
import { hashPassword, createSession, setSessionCookie } from '../lib/auth.js';
import { layoutCtx, esc } from '../templates/layout.js';
import { ic } from '../templates/icons.js';

const setup = new Hono();

async function isFirstRun(db, sailingId) {
  const { count } = await db.from('users')
    .select('id', { count: 'exact', head: true })
    .eq('sailing_id', sailingId);
  return (count || 0) === 0;
}

setup.get('/setup', async (c) => {
  const db = getDb(c.env);
  if (!(await isFirstRun(db, c.env.SAILING_ID))) return c.redirect('/login');

  const body = `<div style="max-width:400px;margin:40px auto">
  <div class="ds-module">
    <div class="ds-module-header">${ic.shield(12)} First-Run Setup</div>
    <div class="ds-module-body">
      <p style="font-size:12px;margin-bottom:12px;line-height:1.5">
        No accounts exist yet. Create your admin account to get started.
        This page disappears once an account exists.
      </p>
      <form method="POST" action="/setup" class="ds-form">
        <div class="ds-form-row">
          <label for="s-name">Your Name *</label>
          <input id="s-name" name="display_name" type="text" class="ds-input" required maxlength="50" placeholder="e.g. Captain Mike">
        </div>
        <div class="ds-form-row">
          <label for="s-user">Username *</label>
          <input id="s-user" name="username" type="text" class="ds-input" required maxlength="30" placeholder="letters, numbers, underscores" data-validate-username>
        </div>
        <div class="ds-form-row">
          <label for="s-pass">Password *</label>
          <input id="s-pass" name="password" type="password" class="ds-input" required minlength="8" data-pw-source placeholder="at least 8 characters">
        </div>
        <div class="ds-form-row">
          <label for="s-pass2">Confirm Password *</label>
          <input id="s-pass2" name="password2" type="password" class="ds-input" required minlength="8" data-pw-confirm>
          <div class="pw-match-hint" style="display:none;font-size:11px;margin-top:3px"></div>
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-primary" data-loading-text="Creating...">Create Admin Account</button>
        </div>
      </form>
    </div>
  </div>
</div>`;

  return c.html(layoutCtx(c, { title: 'Setup', body }));
});

setup.post('/setup', async (c) => {
  const db = getDb(c.env);
  if (!(await isFirstRun(db, c.env.SAILING_ID))) return c.redirect('/login');

  const form = await c.req.formData();
  const displayName = (form.get('display_name') || '').toString().trim().slice(0, 50);
  const username    = (form.get('username') || '').toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  const password    = (form.get('password') || '').toString();
  const password2   = (form.get('password2') || '').toString();

  const errs = [];
  if (!displayName || displayName.length < 2) errs.push('Name must be at least 2 characters.');
  if (!username || username.length < 3)       errs.push('Username must be at least 3 characters.');
  if (!password || password.length < 8)       errs.push('Password must be at least 8 characters.');
  if (password !== password2)                 errs.push('Passwords do not match.');

  if (errs.length) {
    return c.html(layoutCtx(c, {
      title: 'Setup',
      body: `<div style="max-width:400px;margin:40px auto">
        <div class="ds-flash error">${errs.map(esc).join('<br>')}</div>
        <p style="font-size:12px"><a href="/setup">Try again</a></p>
      </div>`
    }), 400);
  }

  const passwordHash = await hashPassword(password);

  const { data: newUser, error: insertErr } = await db.from('users').insert({
    sailing_id:        c.env.SAILING_ID,
    username,
    display_name:      displayName,
    password_hash:     passwordHash,
    account_status:    'active',
    activation_status: 'active',
    role:              'admin',
  }).select('id').single();

  if (insertErr || !newUser) {
    return c.html(layoutCtx(c, {
      title: 'Setup Error',
      body: `<div style="max-width:400px;margin:40px auto">
        <div class="ds-flash error">Could not create account. Check Supabase connection and try again.</div>
        <p style="font-size:12px"><a href="/setup">Try again</a></p>
      </div>`
    }), 500);
  }

  await db.from('profiles').upsert({ user_id: newUser.id }, { onConflict: 'user_id' }).catch(() => {});

  const { token, expiresAt } = await createSession(c.env, newUser.id, c.req.raw);
  const res = c.redirect('/admin');
  setSessionCookie(res, token, expiresAt);
  return res;
});

export default setup;
