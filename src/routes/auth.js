/**
 * Deckspace — Auth routes
 *
 * GET  /login          — login form
 * POST /login          — process login
 * GET  /register       — register form
 * POST /register       — process registration
 * POST /logout         — destroy session + redirect
 */

import { Hono } from 'hono';
import { getDb, q, getSailing } from '../lib/db.js';
import {
  createSession, setSessionCookie, clearSessionCookie,
  destroySession, verifyTurnstile, verifyPassword, hashPassword,
  isSailingAccessible, resolveSession, isRateLimited
} from '../lib/auth.js';
import { layout, layoutCtx, esc, csrfField } from '../templates/layout.js';
import { ic } from '../templates/icons.js';

const auth = new Hono();

function turnstileErrorMessage(result) {
  return result?.reason === 'verification_unavailable'
    ? 'The quick safety check is down for a moment. Please try again in a minute.'
    : 'Please finish the quick safety check.';
}

/* ============================================================
   LOGIN
   ============================================================ */
auth.get('/login', async (c) => {
  const existingUser = await resolveSession(c.env, c.req.raw);
  if (existingUser) return c.redirect('/');

  const next = c.req.query('next') || '/';
  const flash = c.req.query('registered') === '1'
    ? 'Your account is ready. Sign in with your new username and password.'
    : null;
  return c.html(layoutCtx(c, {
    title: 'Sign In to Your Deckspace Sailing',
    description: 'Sign in to Deckspace to view your sailing community, browse passenger profiles, check events, post on walls, and share photos during the voyage.',
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
    title: 'Sign In to Your Deckspace Sailing',
    description: 'Sign in to Deckspace to view your sailing community, browse passenger profiles, check events, post on walls, and share photos during the voyage.',
    body: loginForm({ next, siteKey: c.env.TURNSTILE_SITE_KEY, error }),
  }), status);

  try {
    // Rate limit: 5 attempts per IP per minute
    if (await isRateLimited(c.env, `login:${ip}`, 5)) {
      return showLogin('Too many tries too fast. Please wait a minute and try again.', 429);
    }

    // Turnstile check
    const turnstile = await verifyTurnstile(c.env, turnstileToken, ip);
    if (!turnstile.ok) return showLogin(turnstileErrorMessage(turnstile), turnstile.reason === 'verification_unavailable' ? 503 : 400);

    // Fetch user — maybeSingle so missing user returns null instead of throwing
    const { data: user } = await db.from('users')
      .select('id, username, display_name, password_hash, account_status, activation_status, sailing_id')
      .eq('sailing_id', sailingId)
      .ilike('username', username)
      .maybeSingle();

    if (!user) return showLogin('We could not find that username. Need a page? Make one first.', 401);
    if (user.account_status === 'banned') return showLogin('This page has been turned off.', 403);

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) return showLogin('That password did not match. Try again.', 401);

    // Check sailing access window
    const sailing = await getSailing(db, sailingId).catch(() => null);
    if (sailing && !isSailingAccessible(sailing)) {
      return showLogin('Deckspace is not open for this sailing right now.', 403);
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
    return showLogin('Something went wrong on our side. Please try again.', 500);
  }
});

/* ============================================================
   REGISTER
   ============================================================ */
auth.get('/register', async (c) => {
  const existingUser = await resolveSession(c.env, c.req.raw);
  if (existingUser) return c.redirect('/');

  return c.html(layoutCtx(c, {
    title: 'Create Your Deckspace Sailing Account',
    description: 'Create a Deckspace account for your sailing to meet people, RSVP to plans, share photos, and join the shared ship page.',
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
    title: 'Create Your Deckspace Sailing Account',
    description: 'Create a Deckspace account for your sailing to meet people, RSVP to plans, share photos, and join the shared ship page.',
    body: registerForm({ siteKey: c.env.TURNSTILE_SITE_KEY, error, values: { displayName, username, email } }),
  }), status);

  try {
    // Rate limit: 3 registrations per IP per minute
    if (await isRateLimited(c.env, `register:${ip}`, 3)) {
      return showRegister('Too many tries too fast. Please wait a minute and try again.', 429);
    }

    const turnstileToken = (form.get('cf-turnstile-response') || '').toString();
    const turnstile = await verifyTurnstile(c.env, turnstileToken, ip);
    if (!turnstile.ok) return showRegister(turnstileErrorMessage(turnstile), turnstile.reason === 'verification_unavailable' ? 503 : 400);

    const errs = [];
    if (!displayName || displayName.length < 2) errs.push('Your name needs at least 2 characters.');
    if (!username || username.length < 3)        errs.push('Your username needs at least 3 characters.');
    if (!/^[a-z0-9_]+$/.test(username))         errs.push('Usernames can use letters, numbers, and underscores only.');
    if (!password || password.length < 8)        errs.push('Your password needs at least 8 characters.');
    if (password !== password2)                  errs.push('Those passwords do not match.');
    if (errs.length) return showRegister(errs.join(' '));

    // Check sailing access — only block if sailing explicitly restricts (not if missing)
    const sailing = await getSailing(db, sailingId).catch(() => null);
    if (sailing && !isSailingAccessible(sailing)) {
      return showRegister('New sign-ups are closed for this sailing right now.', 403);
    }

    // Username uniqueness
    const { data: existing } = await db.from('users')
      .select('id')
      .eq('sailing_id', sailingId)
      .ilike('username', username)
      .maybeSingle();
    if (existing) return showRegister('That username is taken. Try another one.');

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
      return showRegister('We could not make your account yet. Please try again.', 500);
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
    return showRegister('Something went wrong on our side. Please try again.', 500);
  }
});

/* ============================================================
   ONBOARDING (profile setup after registration)
   ============================================================ */
auth.get('/onboarding', async (c) => {
  const user = await resolveSession(c.env, c.req.raw);
  if (!user) return c.redirect('/login');

  return c.html(layoutCtx(c, {
    title: 'Set Up Your Deckspace Profile',
    description: 'Finish your Deckspace profile with your vibe, hometown, interests, and public profile details for the sailing.',
    user,
    body: onboardingForm(c.get('csrfToken') || ''),
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
auth.post('/logout', async (c) => {
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
    <div class="ds-module-header">Welcome Back</div>
    <div class="ds-module-body">
      <div class="login-instructions">
        Use your <strong>username</strong> and <strong>password</strong> to jump back in.
        New here? <a href="/register">Make your page. &raquo;</a>
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
          <button type="submit" class="ds-btn ds-btn-primary w-full" data-loading-text="Signing in...">Sign In &rarr;</button>
        </div>
      </form>
      <div class="login-help-text">
        <strong>Forgot your login?</strong> Stop by Guest Services and they can help you find it fast.
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
      Everyone on your sailing can see it. No ads. No private side chats. No junk.
    </div>
    <div class="ds-module">
      <div class="ds-module-header">Make Your Deckspace Page</div>
      <div class="ds-module-body">
        <div class="reg-time-note">Takes about 2 minutes &bull; Free to join &bull; No email needed</div>
        ${error ? `<div class="ds-flash error" style="margin-bottom:8px">${esc(error)}</div>` : ''}
        <form method="POST" action="/register" class="ds-form" data-retry="true">
          <div class="ds-form-row">
            <label for="display_name">Your Name <span class="reg-required">*</span></label>
            <input id="display_name" name="display_name" type="text" class="ds-input" value="${esc(values.displayName || '')}" required maxlength="50" placeholder="What people on the ship will see" autofocus>
          </div>
          <div class="ds-form-row">
            <label for="reg-username">Username <span class="reg-required">*</span></label>
            <input id="reg-username" name="username" type="text" class="ds-input" value="${esc(values.username || '')}" required maxlength="30" pattern="[a-zA-Z0-9_]+" placeholder="letters, numbers, underscores" autocomplete="username">
            <div class="hint">${usernameHint}</div>
          </div>
          <div class="ds-form-row">
            <label for="email">Email <span class="reg-optional">(optional)</span></label>
            <input id="email" name="email" type="email" class="ds-input" value="${esc(values.email || '')}" maxlength="200" placeholder="Only if you want an easier password reset later">
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
            <button type="submit" class="ds-btn ds-btn-orange w-full" data-loading-text="Creating account...">Make My Page &rarr;</button>
          </div>
        </form>
        <p class="text-small text-muted mt-8 text-center">
          Already have a page? <a href="/login">Sign in to Deckspace</a>
        </p>
      </div>
    </div>
  </div>

  <div class="reg-right">
    <div class="ds-module">
      <div class="ds-module-header">Why Deckspace?</div>
      <div class="ds-module-body reg-why-body">
        <p class="reg-why-intro">
          You&rsquo;re on a cruise. You&rsquo;re about to meet a lot of people.
          <strong>Deckspace helps you keep up without missing the fun.</strong>
        </p>
        <ul class="reg-why-list">
          <li>${ic.users(11)} <strong>Meet people fast</strong> &mdash; See who is on the ship and add friends right away.</li>
          <li>${ic.calendar(11)} <strong>See tonight&rsquo;s plans</strong> &mdash; Check what is happening and RSVP in one tap.</li>
          <li>${ic.camera(11)} <strong>Share the trip</strong> &mdash; Post photos from every stop and see what everyone else is up to.</li>
          <li>${ic.mail(11)} <strong>Leave wall notes</strong> &mdash; Drop a note on someone&rsquo;s page, old-school style.</li>
          <li>${ic.bookOpen(11)} <strong>Keep the scrapbook</strong> &mdash; After the trip, the page sticks around for a short read-only goodbye.</li>
        </ul>
        <div class="reg-why-footer">
          Free. Open to your sailing. No ads. No private side channels. Easy to use.
        </div>
      </div>
    </div>

    <div class="reg-note-box">
      <strong>Keep it easy.</strong>
      <p>Join now, fill in the basics, and add the rest later from your deck chair.</p>
    </div>
  </div>
</div>`;
}

function onboardingForm(csrfToken = '') {
  return `<div style="max-width:540px;margin:0 auto">
  <div class="ds-module">
    <div class="ds-module-header">Set Up Your Page</div>
    <div class="ds-module-body">
      <div class="onboarding-intro">
        <strong>You&rsquo;re in.</strong><br>
        Add a few quick details so people can find you, know your vibe, and say hi. You can change any of this later.
      </div>
      <form method="POST" action="/onboarding" class="ds-form">
        ${csrfField(csrfToken)}
        <div class="ds-form-row">
          <label for="ob-about">About Me <span class="reg-optional">(optional)</span></label>
          <textarea id="ob-about" name="about_me" class="ds-textarea" rows="4" maxlength="3000"
            placeholder="Say a little about yourself. Keep it light, fun, or honest."></textarea>
        </div>
        <div class="ds-form-row">
          <label for="ob-hometown">Hometown <span class="reg-optional">(optional)</span></label>
          <input id="ob-hometown" name="hometown" type="text" class="ds-input" maxlength="100" placeholder="City, State / Country">
          <div class="hint">Helps people place you fast</div>
        </div>
        <div class="ds-form-row">
          <label>Your Vibes <span class="reg-optional">(optional)</span></label>
          <div data-tag-input>
            <input type="hidden" name="vibe_tags" value="">
            <div class="vibe-tags tag-chips" style="min-height:28px;border:1px solid #ccc;padding:3px;background:#fff;margin-bottom:4px"></div>
            <input type="text" class="ds-input" placeholder="Type a vibe and press Enter — karaoke, trivia, chill, nightlife">
          </div>
          <div class="hint">These show on your page so people with the same vibe can find you</div>
        </div>
        <div class="ds-form-row">
          <label for="ob-who">Who I&rsquo;d Like to Meet <span class="reg-optional">(optional)</span></label>
          <textarea id="ob-who" name="who_id_like_to_meet" class="ds-textarea" rows="2" maxlength="500"
            placeholder="Trivia partners, late-night people, fellow foodies..."></textarea>
        </div>
        <div class="ds-form-row">
          <label for="ob-intent">Cruise Vibe <span class="reg-optional">(optional)</span></label>
          <input id="ob-intent" name="social_intent" type="text" class="ds-input" maxlength="200"
            placeholder="Relaxing, nightlife, adventure, all of the above">
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-orange w-full">Save and Show My Page &raquo;</button>
        </div>
        <div class="text-center" style="margin-top:8px">
          <a href="/" class="text-small text-muted">Skip for now — I&rsquo;ll fill this in later</a>
        </div>
      </form>
    </div>
  </div>
</div>`;
}

export default auth;
