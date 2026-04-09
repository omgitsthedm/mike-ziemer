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
  isSailingAccessible, resolveSession, isRateLimited
} from '../lib/auth.js';
import { layout, layoutCtx, esc } from '../templates/layout.js';
import { ic } from '../templates/icons.js';

const auth = new Hono();

/* ============================================================
   LOGIN
   ============================================================ */
auth.get('/login', async (c) => {
  const existingUser = await resolveSession(c.env, c.req.raw);
  if (existingUser) return c.redirect('/');

  const next = c.req.query('next') || '/';
  const flash = c.req.query('registered') === '1'
    ? 'Account created! Sign in with your new username and password.'
    : null;
  return c.html(layoutCtx(c, {
    title: 'Sign In',
    body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY, flash }),
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

  const showLogin = (error, status = 400) => c.html(layoutCtx(c, {
    title: 'Sign In',
    body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY, error }),
  }), status);

  try {
    // Rate limit: 5 attempts per IP per minute
    if (await isRateLimited(c.env, `login:${ip}`, 5)) {
      return showLogin('Too many login attempts. Please wait a minute and try again.', 429);
    }

    // Turnstile check
    const turnstileOk = await verifyTurnstile(c.env, turnstileToken, ip);
    if (!turnstileOk) return showLogin('Please complete the verification challenge.');

    // Fetch user — maybeSingle so missing user returns null instead of throwing
    const { data: user } = await db.from('users')
      .select('id, username, display_name, password_hash, account_status, activation_status, sailing_id')
      .eq('sailing_id', sailingId)
      .ilike('username', username)
      .maybeSingle();

    if (!user) return showLogin('No account found with that username. Not signed up yet?', 401);
    if (user.account_status === 'banned') return showLogin('This account has been suspended.', 403);

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) return showLogin('Wrong password — give it another try!', 401);

    // Check sailing access window
    const sailing = await getSailing(db, sailingId).catch(() => null);
    if (sailing && !isSailingAccessible(sailing)) {
      return showLogin('Deckspace is not currently active for this sailing.', 403);
    }

    // Activate account if pending (first login)
    if (user.activation_status === 'pending') {
      await db.from('users').update({ activation_status: 'active' }).eq('id', user.id).catch(() => {});
    }

    const { token, expiresAt } = await createSession(c.env, user.id, c.req.raw);
    const redirectUrl = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const res = c.redirect(redirectUrl);
    setSessionCookie(res, token, expiresAt);
    return res;
  } catch (err) {
    console.error('[Login Error]', err);
    return showLogin('Something went wrong. Please try again.', 500);
  }
});

/* ============================================================
   REGISTER
   ============================================================ */
auth.get('/register', async (c) => {
  const existingUser = await resolveSession(c.env, c.req.raw);
  if (existingUser) return c.redirect('/');

  return c.html(layoutCtx(c, {
    title: 'Create Account',
    body: registerForm({ siteKey: c.env.TURNSTILE_SITE_KEY }),
  }));
});

auth.post('/register', async (c) => {
  const db = getDb(c.env);
  const form = await c.req.formData();
  const sailingId = c.env.SAILING_ID;
  const ip = c.req.header('cf-connecting-ip') || '';

  const displayName = (form.get('display_name') || '').toString().trim().slice(0, 50);
  const username    = (form.get('username') || '').toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  const email       = (form.get('email') || '').toString().trim().toLowerCase().slice(0, 200);
  const password    = (form.get('password') || '').toString();
  const password2   = (form.get('password2') || '').toString();

  const showRegister = (error, status = 400) => c.html(layoutCtx(c, {
    title: 'Create Account',
    body: registerForm({ siteKey: c.env.TURNSTILE_SITE_KEY, error, values: { displayName, username, email } }),
  }), status);

  try {
    // Rate limit: 3 registrations per IP per minute
    if (await isRateLimited(c.env, `register:${ip}`, 3)) {
      return showRegister('Too many attempts. Please wait a minute and try again.', 429);
    }

    const turnstileToken = (form.get('cf-turnstile-response') || '').toString();
    const turnstileOk = await verifyTurnstile(c.env, turnstileToken, ip);
    if (!turnstileOk) return showRegister('Please complete the verification challenge.');

    const errs = [];
    if (!displayName || displayName.length < 2) errs.push('Display name must be at least 2 characters.');
    if (!username || username.length < 3)        errs.push('Username must be at least 3 characters.');
    if (!/^[a-z0-9_]+$/.test(username))         errs.push('Username can only contain letters, numbers, and underscores.');
    if (!password || password.length < 8)        errs.push('Password must be at least 8 characters.');
    if (password !== password2)                  errs.push('Passwords do not match.');
    if (errs.length) return showRegister(errs.join(' '));

    // Check sailing access — only block if sailing explicitly restricts (not if missing)
    const sailing = await getSailing(db, sailingId).catch(() => null);
    if (sailing && !isSailingAccessible(sailing)) {
      return showRegister('Deckspace is not currently accepting new registrations.', 403);
    }

    // Username uniqueness
    const { data: existing } = await db.from('users')
      .select('id')
      .eq('sailing_id', sailingId)
      .ilike('username', username)
      .maybeSingle();
    if (existing) return showRegister('That username is already taken.');

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
      console.error('[Register insert error]', insertErr);
      return showRegister('Could not create account. Please try again.', 500);
    }

    // Create empty profile (upsert so duplicate is safe)
    await db.from('profiles').upsert({ user_id: newUser.id }, { onConflict: 'user_id' }).catch(() => {});

    // Create session — if this fails, account exists so redirect to login
    try {
      const { token, expiresAt } = await createSession(c.env, newUser.id, c.req.raw);
      const res = c.redirect('/onboarding');
      setSessionCookie(res, token, expiresAt);
      return res;
    } catch (_sessionErr) {
      console.error('[Register session error]', _sessionErr);
      return c.redirect('/login?registered=1');
    }
  } catch (err) {
    console.error('[Register Error]', err);
    return showRegister('Something went wrong. Please try again.', 500);
  }
});

/* ============================================================
   ONBOARDING (profile setup after registration)
   ============================================================ */
auth.get('/onboarding', async (c) => {
  const user = await resolveSession(c.env, c.req.raw);
  if (!user) return c.redirect('/login');

  return c.html(layoutCtx(c, {
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

  try {
    await db.from('profiles').upsert({
      user_id: user.id,
      about_me: aboutMe || null,
      hometown: hometown || null,
      vibe_tags: vibeTags.length ? vibeTags : null,
      who_id_like_to_meet: whoMeet || null,
      social_intent: intent || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
  } catch (err) {
    console.error('[Onboarding upsert error]', err);
    // Non-fatal: profile save failed but continue to profile
  }

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
function loginForm({ next, siteKey, error, flash }) {
  return `<div class="access-page">
  <div class="access-logo">
    <div class="big-logo">Deck<span class="logo-space">space</span></div>
  </div>
  <div class="access-tagline">Your cruise. Your crew. Your page.</div>

  ${flash ? `<div class="ds-flash success">${esc(flash)}</div>` : ''}
  ${error ? `<div class="ds-flash error">${esc(error)}</div>` : ''}

  <div class="ds-module">
    <div class="ds-module-header">Welcome Back &mdash; Come Aboard!</div>
    <div class="ds-module-body">
      <div class="login-instructions">
        Type your <strong>username</strong> and <strong>password</strong> to get in.
        First time here? <a href="/register">Make a free account! &raquo;</a>
      </div>
      <form method="POST" action="/login" class="ds-form" data-retry="true">
        <input type="hidden" name="next" value="${esc(next)}">
        <div class="ds-form-row">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" class="ds-input" autocomplete="username" autofocus required placeholder="your username">
        </div>
        <div class="ds-form-row">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" class="ds-input" autocomplete="current-password" required placeholder="your password">
        </div>
        ${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="light"></div>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-primary w-full" data-loading-text="Signing in...">Come Aboard &rarr;</button>
        </div>
      </form>
      <div class="login-help-text">
        <strong>Forgot your login?</strong> No big deal! Head to the Guest Services desk &mdash; they can look you up in seconds.
      </div>
    </div>
  </div>
</div>`;
}

function registerForm({ siteKey, error, values = {} }) {
  const usernameHint = values.username
    ? `Your profile will be <strong>/profile/${esc(values.username)}</strong>`
    : 'Letters, numbers, underscores only &mdash; this becomes your profile URL';

  return `<div class="reg-wrap">
  <div class="reg-left">
    <div class="reg-privacy-badge">
      Only people on your ship can see your profile. Free forever. No ads, no spam, no junk!
    </div>
    <div class="ds-module">
      <div class="ds-module-header">Join the Fun &mdash; It&rsquo;s Free!</div>
      <div class="ds-module-body">
        <div class="reg-time-note">Only takes 2 minutes &bull; Always free &bull; No email needed</div>
        ${error ? `<div class="ds-flash error" style="margin-bottom:8px">${esc(error)}</div>` : ''}
        <form method="POST" action="/register" class="ds-form" data-retry="true">
          <div class="ds-form-row">
            <label for="display_name">Your Name <span class="reg-required">*</span></label>
            <input id="display_name" name="display_name" type="text" class="ds-input" value="${esc(values.displayName || '')}" required maxlength="50" placeholder="How others will see you &mdash; e.g. Jessica M." autofocus>
          </div>
          <div class="ds-form-row">
            <label for="reg-username">Username <span class="reg-required">*</span></label>
            <input id="reg-username" name="username" type="text" class="ds-input" value="${esc(values.username || '')}" required maxlength="30" pattern="[a-zA-Z0-9_]+" placeholder="letters, numbers, underscores" autocomplete="username">
            <div class="hint">${usernameHint}</div>
          </div>
          <div class="ds-form-row">
            <label for="email">Email <span class="reg-optional">(optional)</span></label>
            <input id="email" name="email" type="email" class="ds-input" value="${esc(values.email || '')}" maxlength="200" placeholder="only needed if you want a password reset option">
          </div>
          <div class="ds-form-row">
            <label for="reg-password">Password <span class="reg-required">*</span></label>
            <input id="reg-password" name="password" type="password" class="ds-input" required minlength="8" autocomplete="new-password" placeholder="at least 8 characters">
          </div>
          <div class="ds-form-row">
            <label for="password2">Confirm Password <span class="reg-required">*</span></label>
            <input id="password2" name="password2" type="password" class="ds-input" required minlength="8" autocomplete="new-password">
          </div>
          ${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="light" style="margin:10px 0"></div>
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
          <div class="ds-form-row mt-8">
            <button type="submit" class="ds-btn ds-btn-orange w-full" data-loading-text="Creating account...">Join the Crew &rarr;</button>
          </div>
        </form>
        <p class="text-small text-muted mt-8 text-center">
          Already have an account? <a href="/login">Sign in here</a>
        </p>
      </div>
    </div>
  </div>

  <div class="reg-right">
    <div class="ds-module">
      <div class="ds-module-header">Why Deckspace?</div>
      <div class="ds-module-body reg-why-body">
        <p class="reg-why-intro">
          You&rsquo;re on a cruise! You&rsquo;re going to meet tons of cool people.
          <strong>Deckspace helps you remember everyone and stay in the loop.</strong>
        </p>
        <ul class="reg-why-list">
          <li>${ic.users(11)} <strong>Find your people</strong> &mdash; See who&rsquo;s on the ship and add friends right away.</li>
          <li>${ic.calendar(11)} <strong>Plan your nights</strong> &mdash; Check out what&rsquo;s happening tonight and RSVP to events.</li>
          <li>${ic.camera(11)} <strong>Share photos</strong> &mdash; Post pics from every port and see what everyone else is up to.</li>
          <li>${ic.mail(11)} <strong>Wall posts</strong> &mdash; Write on anyone&rsquo;s page, just like the old MySpace days!</li>
          <li>${ic.bookOpen(11)} <strong>Yours forever</strong> &mdash; Even after the trip ends, everything stays saved as your scrapbook.</li>
        </ul>
        <div class="reg-why-footer">
          Free. Private. Just your ship. No ads. No spam. No weirdos.
        </div>
      </div>
    </div>

    <div class="reg-note-box">
      <strong>Want to keep it easy?</strong>
      <p>Deckspace takes about 60 seconds to join. Fill in only what you feel like &mdash; you can always add more later from the comfort of your deck chair.</p>
    </div>
  </div>
</div>`;
}

function onboardingForm() {
  return `<div style="max-width:540px;margin:0 auto">
  <div class="ds-module">
    <div class="ds-module-header">Set Up Your Profile</div>
    <div class="ds-module-body">
      <div class="onboarding-intro">
        <strong>You&rsquo;re in! Now let&rsquo;s set up your page.</strong><br>
        Everything here is optional &mdash; just fill in what you want. You can always change it later.
      </div>
      <form method="POST" action="/onboarding" class="ds-form">
        <div class="ds-form-row">
          <label for="ob-about">About Me <span class="reg-optional">(optional)</span></label>
          <textarea id="ob-about" name="about_me" class="ds-textarea" rows="4" maxlength="3000"
            placeholder="Where are you from? What do you love? What are you hoping for on this cruise? Anything goes."></textarea>
        </div>
        <div class="ds-form-row">
          <label for="ob-hometown">Hometown <span class="reg-optional">(optional)</span></label>
          <input id="ob-hometown" name="hometown" type="text" class="ds-input" maxlength="100" placeholder="City, State / Country">
          <div class="hint">Helps people you meet know where you&rsquo;re from</div>
        </div>
        <div class="ds-form-row">
          <label>Your Vibes <span class="reg-optional">(optional)</span></label>
          <div data-tag-input>
            <input type="hidden" name="vibe_tags" value="">
            <div class="vibe-tags tag-chips" style="min-height:28px;border:1px solid #ccc;padding:3px;background:#fff;margin-bottom:4px"></div>
            <input type="text" class="ds-input" placeholder="Type a vibe and press Enter &mdash; karaoke, trivia, chill, nightlife...">
          </div>
          <div class="hint">Shows on your profile so people can find you by shared interests</div>
        </div>
        <div class="ds-form-row">
          <label for="ob-who">Who I&rsquo;d Like to Meet <span class="reg-optional">(optional)</span></label>
          <textarea id="ob-who" name="who_id_like_to_meet" class="ds-textarea" rows="2" maxlength="500"
            placeholder="Trivia night partners, late-night bar crowd, fellow foodies..."></textarea>
        </div>
        <div class="ds-form-row">
          <label for="ob-intent">Cruise Vibe <span class="reg-optional">(optional)</span></label>
          <input id="ob-intent" name="social_intent" type="text" class="ds-input" maxlength="200"
            placeholder="Relaxation, nightlife, adventure, all of the above...">
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-orange w-full">Go to My Profile &raquo;</button>
        </div>
        <div class="text-center" style="margin-top:8px">
          <a href="/" class="text-small text-muted">Skip for now &mdash; I&rsquo;ll fill this in later</a>
        </div>
      </form>
    </div>
  </div>
</div>`;
}

export default auth;
