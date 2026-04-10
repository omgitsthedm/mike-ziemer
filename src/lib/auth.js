/**
 * Deckspace — Auth helpers
 *
 * Session-based auth using a server-side sessions table.
 * Token is a random 32-byte hex string stored as a cookie.
 * DB stores sha256 of token (never the raw value).
 */

import { getDb, q } from './db.js';

const SESSION_COOKIE = 'ds_session';
const SESSION_DURATION_DAYS = 14;

/* ============================================================
   TOKEN UTILS
   ============================================================ */
function hex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return hex(buf);
}

export async function hashToken(token) {
  const encoded = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return hex(buf);
}

export async function hashPassword(password) {
  // Use a PBKDF2 derivation. In production, bcrypt via Supabase edge function
  // is preferred. This is a portable alternative for CF Workers.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key, 256
  );
  return `pbkdf2:${hex(salt)}:${hex(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [algo, saltHex, hashHex] = parts;
  if (algo !== 'pbkdf2' || !saltHex || !hashHex) return false;
  try {
    const enc = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
      key, 256
    );
    return hex(bits) === hashHex;
  } catch {
    return false;
  }
}

/* ============================================================
   SESSION MANAGEMENT
   ============================================================ */
export async function createSession(env, userId, request) {
  const db = getDb(env);
  const token = await generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 86400 * 1000);

  await q(db.from('sessions').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    ip_address: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for'),
    user_agent: request.headers.get('user-agent')
  }));

  return { token, expiresAt };
}

export function setSessionCookie(response, token, expiresAt) {
  const expires = expiresAt.toUTCString();
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}; Secure`
  );
}

export function clearSessionCookie(response) {
  response.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
  );
}

export function getSessionToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * Resolve session token to a user record.
 * Returns null if no valid session.
 */
export async function resolveSession(env, request) {
  const token = getSessionToken(request);
  if (!token) return null;

  const db = getDb(env);
  const tokenHash = await hashToken(token);

  const session = await db.from('sessions')
    .select('id, user_id, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
    .then(({ data }) => data);

  if (!session) return null;

  const user = await db.from('users')
    .select('id, username, display_name, role, account_status, sailing_id, profiles(avatar_thumb_url, theme_id)')
    .eq('id', session.user_id)
    .eq('account_status', 'active')
    .maybeSingle()
    .then(({ data }) => data);

  if (!user) return null;

  // Update last_active_at (fire-and-forget, max once per 5 min worth of requests)
  db.from('users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', user.id)
    .then(() => {}).catch(() => {});

  return user;
}

export async function destroySession(env, request) {
  const token = getSessionToken(request);
  if (!token) return;
  const db = getDb(env);
  const tokenHash = await hashToken(token);
  await db.from('sessions').delete().eq('token_hash', tokenHash);
}

/* ============================================================
   TURNSTILE VERIFICATION
   ============================================================ */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true, reason: 'disabled' }; // Skip when unconfigured
  if (!token) return { ok: false, reason: 'missing_token' };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip || ''
      })
    });
    const data = await res.json();
    return data.success === true
      ? { ok: true, reason: 'verified' }
      : { ok: false, reason: 'challenge_failed' };
  } catch {
    return { ok: false, reason: 'verification_unavailable' }; // Fail closed if Turnstile API is unreachable
  }
}

/* ============================================================
   ACCESS WINDOW VALIDATION
   ============================================================ */
export function isSailingAccessible(sailing) {
  if (sailing.status === 'closed') return false;
  const now = new Date();
  // Treat null dates as no restriction (demo/unconfigured sailings are always accessible)
  if (sailing.access_opens_at && new Date(sailing.access_opens_at) > now) return false;
  if (sailing.archive_ends_at && new Date(sailing.archive_ends_at) < now) return false;
  return true;
}

export function isSailingReadOnly(sailing) {
  const now = new Date();
  return (
    sailing.status === 'archive' ||
    (new Date(sailing.access_closes_at) < now && new Date(sailing.archive_ends_at) >= now)
  );
}

/* ============================================================
   MIDDLEWARE HELPERS
   ============================================================ */

/**
 * Require authenticated session. Redirects to /login if not present.
 */
export async function requireAuth(c, next) {
  const user = await resolveSession(c.env, c.req.raw);
  if (!user) {
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path));
  }
  c.set('user', user);
  return next();
}

/**
 * Require admin or moderator role.
 */
export async function requireAdmin(c, next) {
  const user = c.get('user');
  if (!user || !['admin', 'moderator'].includes(user.role)) {
    return c.text('Forbidden', 403);
  }
  return next();
}

/**
 * Load session optionally (don't redirect if missing).
 */
export async function loadSession(c, next) {
  const user = await resolveSession(c.env, c.req.raw);
  c.set('user', user || null);
  return next();
}

/**
 * Rate-limit helper — simple IP-based counter using CF KV or
 * falling back to request count per Worker invocation (best-effort).
 * Returns true if request should be blocked.
 */
export async function isRateLimited(env, key, maxPerMinute = 20) {
  if (!env.KV) return false; // No KV configured, skip
  const now = Math.floor(Date.now() / 60000);
  const kvKey = `rl:${key}:${now}`;
  const current = parseInt(await env.KV.get(kvKey) || '0', 10);
  if (current >= maxPerMinute) return true;
  await env.KV.put(kvKey, String(current + 1), { expirationTtl: 120 });
  return false;
}

/* ============================================================
   CSRF — HMAC-based stateless tokens
   Token = base64(HMAC-SHA256(sessionTokenHash + ":" + roundedMinute))
   Valid for a 30-minute window.
   ============================================================ */

/**
 * Generate a CSRF token tied to the current session.
 * Valid for 30 minutes; rotates every 30 minutes.
 */
export async function generateCsrfToken(sessionTokenHash) {
  if (!sessionTokenHash) return '';
  const window = Math.floor(Date.now() / (30 * 60 * 1000));
  const msg = `${sessionTokenHash}:${window}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(msg), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('csrf'));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}

/**
 * Verify a CSRF token. Checks current and previous 30-min window.
 */
export async function verifyCsrfToken(sessionTokenHash, formToken) {
  if (!sessionTokenHash || !formToken) return false;
  for (let offset = 0; offset <= 1; offset++) {
    const window = Math.floor(Date.now() / (30 * 60 * 1000)) - offset;
    const msg = `${sessionTokenHash}:${window}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(msg), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('csrf'));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
    if (expected === formToken) return true;
  }
  return false;
}
