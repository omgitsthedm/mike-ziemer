/**
 * Deckspace — Auth routes
 *
 * GET  /login          — login form
 * POST /login          — process login
 * GET  /register       — register form
 * POST /register       — process registration
 * GET  /logout         — destroy session + redirect
 */

import { Hono } from 'hono';
import { getDb, q, getSailing } from '../lib/db.js';
import {
  createSession, setSessionCookie, clearSessionCookie,
  destroySession, verifyTurnstile, verifyPassword, hashPassword,
  isSailingAccessible, resolveSession
} from '../lib/auth.js';
import { layout, flash, esc } from '../templates/layout.js';

const auth = new Hono();

/* ============================================================
   LOGIN
   ============================================================ */
auth.get('/login', async (c) => {
  const existingUser = await resolveSession(c.env, c.req.raw);
  if (existingUser) return c.redirect('/');

  const next = c.req.query('next') || '/';
  return c.html(layout({
    title: 'Sign In',
    body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY }),
  }));
});

auth.post('/login', async (c) => {
  const db = getDb(c.env);
  const form = await c.req.formData();
  const username = (form.get('username') || '').toString().trim().toLowerCase();
  const password = (form.get('password') || '').toString();
  const turnstileToken = (form.get('cf-turnstile-response') || '').toString();
  const next = (form.get('next') || '/').toString();
  const sailingId = c.env.SAILING_ID;

  const ip = c.req.header('cf-connecting-ip') || '';

  // Turnstile check
  const turnstileOk = await verifyTurnstile(c.env, turnstileToken, ip);
  if (!turnstileOk) {
    return c.html(layout({
      title: 'Sign In',
      body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY, error: 'Please complete the verification challenge.' }),
    }), 400);
  }

  // Fetch user
  const { data: user } = await db.from('users')
    .select('id, username, display_name, password_hash, account_status, activation_status, sailing_id')
    .eq('sailing_id', sailingId)
    .ilike('username', username)
    .single();

  const invalid = () => c.html(layout({
    title: 'Sign In',
    body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY, error: 'Invalid username or password.' }),
  }), 401);

  if (!user) return invalid();
  if (user.account_status === 'banned') {
    return c.html(layout({
      title: 'Sign In',
      body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY, error: 'This account has been suspended.' }),
    }), 403);
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) return invalid();

  // Check sailing access window
  const sailing = await getSailing(db, sailingId).catch(() => null);
  if (sailing && !isSailingAccessible(sailing)) {
    return c.html(layout({
      title: 'Sign In',
      body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY, error: 'Deckspace is not currently active for this sailing.' }),
    }), 403);
  }

  // Activate account if pending (first login)
  if (user.activation_status === 'pending') {
    await db.from('users').update({ activation_status: 'active' }).eq('id', user.id);
  }

  const { token, expiresAt } = await createSession(c.env, user.id, c.req.raw);

  const redirectUrl = next.startsWith('/') ? next : '/';
  const res = c.redirect(redirectUrl);
  setSessionCookie(res, token, expiresAt);
  return res;
});

/* ============================================================
   REGISTER
   ============================================================ */
auth.get('/register', async (c) => {
  const existingUser = await resolveSession(c.env, c.req.raw);
  if (existingUser) return c.redirect('/');

  return c.html(layout({
    title: 'Create Account',
    body: registerForm({ siteKey: c.env.TURNSTILE_SITE_KEY }),
  }));
});

auth.post('/register', async (c) => {
  const db = getDb(c.env);
  const form = await c.req.formData();
  const sailingId = c.env.SAILING_ID;
  const ip = c.req.header('cf-connecting-ip') || '';

  const turnstileToken = (form.get('cf-turnstile-response') || '').toString();
  const turnstileOk = await verifyTurnstile(c.env, turnstileToken, ip);
  if (!turnstileOk) {
    return c.html(layout({
      title: 'Create Account',
      body: registerForm({ siteKey: c.env.TURNSTILE_SITE_KEY, error: 'Please complete the verification challenge.' }),
    }), 400);
  }

  const displayName = (form.get('display_name') || '').toString().trim().slice(0, 50);
  const username    = (form.get('username') || '').toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  const email       = (form.get('email') || '').toString().trim().toLowerCase().slice(0, 200);
  const password    = (form.get('password') || '').toString();
  const password2   = (form.get('password2') || '').toString();

  const errs = [];
  if (!displayName || displayName.length < 2)    errs.push('Display name must be at least 2 characters.');
  if (!username || username.length < 3)           errs.push('Username must be at least 3 characters.');
  if (!/^[a-z0-9_]+$/.test(username))            errs.push('Username can only contain letters, numbers, and underscores.');
  if (!password || password.length < 8)           errs.push('Password must be at least 8 characters.');
  if (password !== password2)                     errs.push('Passwords do not match.');

  if (errs.length) {
    return c.html(layout({
      title: 'Create Account',
      body: registerForm({
        siteKey: c.env.TURNSTILE_SITE_KEY,
        error: errs.join(' '),
        values: { displayName, username, email }
      }),
    }), 400);
  }

  // Check sailing exists and is accessible
  const sailing = await getSailing(db, sailingId).catch(() => null);
  if (!sailing || !isSailingAccessible(sailing)) {
    return c.html(layout({
      title: 'Create Account',
      body: registerForm({ siteKey: c.env.TURNSTILE_SITE_KEY, error: 'Deckspace is not currently accepting new registrations.' }),
    }), 403);
  }

  // Username uniqueness check
  const { data: existing } = await db.from('users')
    .select('id')
    .eq('sailing_id', sailingId)
    .ilike('username', username)
    .maybeSingle();

  if (existing) {
    return c.html(layout({
      title: 'Create Account',
      body: registerForm({
        siteKey: c.env.TURNSTILE_SITE_KEY,
        error: 'That username is already taken.',
        values: { displayName, username, email }
      }),
    }), 400);
  }

  const passwordHash = await hashPassword(password);

  const { data: newUser, error: insertErr } = await db.from('users').insert({
    sailing_id: sailingId,
    username,
    display_name: displayName,
    email: email || null,
    password_hash: passwordHash,
    account_status: 'active',
    activation_status: 'active',
    role: 'passenger'
  }).select('id').single();

  if (insertErr || !newUser) {
    return c.html(layout({
      title: 'Create Account',
      body: registerForm({ siteKey: c.env.TURNSTILE_SITE_KEY, error: 'Could not create account. Please try again.' }),
    }), 500);
  }

  // Create empty profile
  await db.from('profiles').insert({ user_id: newUser.id });

  const { token, expiresAt } = await createSession(c.env, newUser.id, c.req.raw);

  const res = c.redirect('/onboarding');
  setSessionCookie(res, token, expiresAt);
  return res;
});

/* ============================================================
   ONBOARDING (profile setup after registration)
   ============================================================ */
auth.get('/onboarding', async (c) => {
  const user = await resolveSession(c.env, c.req.raw);
  if (!user) return c.redirect('/login');

  return c.html(layout({
    title: 'Set Up Your Profile',
    user,
    body: onboardingForm(),
  }));
});

auth.post('/onboarding', async (c) => {
  const user = await resolveSession(c.env, c.req.raw);
  if (!user) return c.redirect('/login');

  const db = getDb(c.env);
  const form = await c.req.formData();

  const aboutMe  = (form.get('about_me') || '').toString().trim().slice(0, 3000);
  const hometown = (form.get('hometown') || '').toString().trim().slice(0, 100);
  const vibeTags = (form.get('vibe_tags') || '').toString()
    .split(',').map(t => t.trim()).filter(Boolean).slice(0, 10);
  const whoMeet  = (form.get('who_id_like_to_meet') || '').toString().trim().slice(0, 500);
  const intent   = (form.get('social_intent') || '').toString().trim().slice(0, 200);

  await db.from('profiles').upsert({
    user_id: user.id,
    about_me: aboutMe || null,
    hometown: hometown || null,
    vibe_tags: vibeTags.length ? vibeTags : null,
    who_id_like_to_meet: whoMeet || null,
    social_intent: intent || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });

  return c.redirect('/profile/' + user.username);
});

/* ============================================================
   LOGOUT
   ============================================================ */
auth.get('/logout', async (c) => {
  await destroySession(c.env, c.req.raw);
  const res = c.redirect('/login');
  clearSessionCookie(res);
  return res;
});

/* ============================================================
   HTML TEMPLATES
   ============================================================ */
function loginForm({ next, siteKey, error }) {
  return `<div class="access-page">
  <div class="access-logo">
    <div class="big-logo">Deck<span class="logo-space">space</span></div>
  </div>
  <div class="access-tagline">The cruise social network &mdash; OG MySpace style</div>
  ${error ? `<div class="ds-flash error">${esc(error)}</div>` : ''}
  <div class="ds-module">
    <div class="ds-module-header">Sign In to Deckspace</div>
    <div class="ds-module-body">
      <form method="POST" action="/login" class="ds-form" data-retry="true">
        <input type="hidden" name="next" value="${esc(next)}">
        <div class="ds-form-row">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" class="ds-input" autocomplete="username" autofocus required>
        </div>
        <div class="ds-form-row">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" class="ds-input" autocomplete="current-password" required>
        </div>
        ${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="light"></div>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-primary w-full" data-loading-text="Signing in...">Sign In</button>
        </div>
      </form>
      <p class="text-small text-muted mt-8 text-center">
        New passenger? <a href="/register">Create an account</a>
      </p>
    </div>
  </div>
</div>`;
}

function registerForm({ siteKey, error, values = {} }) {
  return `<div class="access-page">
  <div class="access-logo">
    <div class="big-logo">Deck<span class="logo-space">space</span></div>
  </div>
  <div class="access-tagline">Create your cruise profile</div>
  <div class="access-explainer">
    Deckspace is a private social network for passengers on this sailing.
    Create a profile, add friends, plan events, and share photos.
  </div>
  ${error ? `<div class="ds-flash error">${esc(error)}</div>` : ''}
  <div class="ds-module">
    <div class="ds-module-header">Join Deckspace</div>
    <div class="ds-module-body">
      <form method="POST" action="/register" class="ds-form" data-retry="true">
        <div class="ds-form-row">
          <label for="display_name">Display Name</label>
          <input id="display_name" name="display_name" type="text" class="ds-input" value="${esc(values.displayName || '')}" required maxlength="50" placeholder="How others will see you">
        </div>
        <div class="ds-form-row">
          <label for="reg-username">Username</label>
          <input id="reg-username" name="username" type="text" class="ds-input" value="${esc(values.username || '')}" required maxlength="30" pattern="[a-zA-Z0-9_]+" placeholder="letters, numbers, underscores">
          <div class="hint">Your profile URL will be /profile/username</div>
        </div>
        <div class="ds-form-row">
          <label for="email">Email <span style="font-weight:normal;color:#999">(optional)</span></label>
          <input id="email" name="email" type="email" class="ds-input" value="${esc(values.email || '')}" maxlength="200">
        </div>
        <div class="ds-form-row">
          <label for="reg-password">Password</label>
          <input id="reg-password" name="password" type="password" class="ds-input" required minlength="8" autocomplete="new-password">
        </div>
        <div class="ds-form-row">
          <label for="password2">Confirm Password</label>
          <input id="password2" name="password2" type="password" class="ds-input" required minlength="8" autocomplete="new-password">
        </div>
        ${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="light" style="margin:8px 0"></div>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-primary w-full" data-loading-text="Creating account...">Create Account</button>
        </div>
      </form>
      <p class="text-small text-muted mt-8 text-center">
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </div>
  </div>
</div>`;
}

function onboardingForm() {
  return `<div style="max-width:540px;margin:0 auto">
  <div class="ds-module">
    <div class="ds-module-header">Set Up Your Deckspace Profile</div>
    <div class="ds-module-body">
      <p class="text-small text-muted mb-8">You can always edit these later. Fill in what you like now.</p>
      <form method="POST" action="/onboarding" class="ds-form">
        <div class="ds-form-row">
          <label for="ob-about">About Me</label>
          <textarea id="ob-about" name="about_me" class="ds-textarea" rows="4" maxlength="3000" placeholder="Tell people about yourself..."></textarea>
        </div>
        <div class="ds-form-row">
          <label for="ob-hometown">Hometown / Where you're from</label>
          <input id="ob-hometown" name="hometown" type="text" class="ds-input" maxlength="100" placeholder="City, State or Country">
        </div>
        <div class="ds-form-row">
          <label>Vibes &amp; Interests</label>
          <div data-tag-input>
            <input type="hidden" name="vibe_tags" value="">
            <div class="vibe-tags tag-chips" style="min-height:28px;border:1px solid #ccc;padding:3px;background:#fff;margin-bottom:4px"></div>
            <input type="text" class="ds-input" placeholder="Type a vibe and press Enter (karaoke, trivia, chill...)" style="margin-top:2px">
          </div>
          <div class="hint">What are you here for on this cruise?</div>
        </div>
        <div class="ds-form-row">
          <label for="ob-who">Who I'd Like to Meet</label>
          <textarea id="ob-who" name="who_id_like_to_meet" class="ds-textarea" rows="2" maxlength="500" placeholder="Trivia partners, karaoke people, fellow foodies..."></textarea>
        </div>
        <div class="ds-form-row">
          <label for="ob-intent">Cruise Vibe</label>
          <input id="ob-intent" name="social_intent" type="text" class="ds-input" maxlength="200" placeholder="Nightlife, relaxation, adventure, all of the above...">
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-orange w-full">Save &amp; View My Profile &raquo;</button>
        </div>
        <div class="text-center mt-4">
          <a href="/" class="text-small text-muted">Skip for now</a>
        </div>
      </form>
    </div>
  </div>
</div>`;
}

export default auth;
