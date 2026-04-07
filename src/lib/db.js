/**
 * Deckspace — Supabase DB client factory
 *
 * We create one client per request using the service-role key so all
 * queries bypass RLS (our Worker is the only entry point).
 * Never expose the service key to the browser.
 */

import { createClient } from '@supabase/supabase-js';

/**
 * @param {object} env  Cloudflare Worker env bindings
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getDb(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'deckspace' },
    global: {
      headers: { 'x-deckspace-version': '1.0' }
    }
  });
}

/* ============================================================
   QUERY HELPERS
   Thin wrappers that throw on Supabase errors so routes don't
   have to check { data, error } everywhere.
   ============================================================ */

/**
 * Run a query builder and throw if error.
 * @param {Promise<{data: any, error: any}>} queryPromise
 * @returns {Promise<any>}
 */
export async function q(queryPromise) {
  const { data, error } = await queryPromise;
  if (error) throw new DbError(error.message, error.code);
  return data;
}

export class DbError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DbError';
    this.code = code;
  }
}

/* ============================================================
   COMMON QUERIES
   ============================================================ */

export async function getUserById(db, userId) {
  return q(db.from('users').select('*').eq('id', userId).single());
}

export async function getUserByUsername(db, sailingId, username) {
  return q(
    db.from('users')
      .select('*, profiles(*)')
      .eq('sailing_id', sailingId)
      .ilike('username', username)
      .eq('account_status', 'active')
      .single()
  );
}

export async function getProfileByUserId(db, userId) {
  return q(
    db.from('profiles').select('*').eq('user_id', userId).single()
  );
}

/**
 * Get a full profile page payload: user + profile + top friends + friend count.
 */
export async function getProfilePage(db, profileUserId, viewerUserId) {
  const [user, topFriends, friendCount, friendStatus] = await Promise.all([
    q(db.from('users')
        .select('id, username, display_name, last_active_at, profiles(*)')
        .eq('id', profileUserId)
        .single()),
    q(db.from('top_friends')
        .select('position, friend_user_id, users!top_friends_friend_user_id_fkey(username, display_name, profiles(avatar_thumb_url))')
        .eq('user_id', profileUserId)
        .order('position', { ascending: true })
        .limit(8)),
    q(db.from('friendships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${profileUserId},addressee_id.eq.${profileUserId}`)
        .eq('status', 'accepted')),
    viewerUserId && viewerUserId !== profileUserId
      ? q(db.from('friendships')
          .select('id, status, requester_id')
          .or(
            `and(requester_id.eq.${viewerUserId},addressee_id.eq.${profileUserId}),` +
            `and(requester_id.eq.${profileUserId},addressee_id.eq.${viewerUserId})`
          )
          .maybeSingle())
      : Promise.resolve(null)
  ]);

  return { user, topFriends, friendCount, friendStatus };
}

export async function getWallPosts(db, profileUserId, page = 1, limit = 20) {
  const from = (page - 1) * limit;
  return q(
    db.from('wall_posts')
      .select('id, body, created_at, author_user_id, users!wall_posts_author_user_id_fkey(username, display_name, profiles(avatar_thumb_url))')
      .eq('profile_user_id', profileUserId)
      .eq('moderation_status', 'visible')
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)
  );
}

export async function getGuestbookEntries(db, profileUserId, page = 1, limit = 20) {
  const from = (page - 1) * limit;
  return q(
    db.from('guestbook_entries')
      .select('id, body, created_at, author_user_id, users!guestbook_entries_author_user_id_fkey(username, display_name, profiles(avatar_thumb_url))')
      .eq('profile_user_id', profileUserId)
      .eq('moderation_status', 'visible')
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)
  );
}

export async function getEvents(db, sailingId, { type, upcoming, limit = 20, page = 1 } = {}) {
  const from = (page - 1) * limit;
  let query = db.from('events')
    .select('id, title, description, location, start_at, end_at, event_type, category, cover_image_url, rsvp_count, creator_user_id, users!events_creator_user_id_fkey(display_name, username)')
    .eq('sailing_id', sailingId)
    .eq('moderation_status', 'visible')
    .eq('visibility', 'public')
    .order('start_at', { ascending: true })
    .range(from, from + limit - 1);

  if (type) query = query.eq('event_type', type);
  if (upcoming) query = query.gte('start_at', new Date().toISOString());

  return q(query);
}

export async function getEventById(db, eventId) {
  return q(
    db.from('events')
      .select('*, users!events_creator_user_id_fkey(id, username, display_name, profiles(avatar_thumb_url))')
      .eq('id', eventId)
      .single()
  );
}

export async function getEventComments(db, eventId, page = 1, limit = 30) {
  const from = (page - 1) * limit;
  return q(
    db.from('event_comments')
      .select('id, body, created_at, author_user_id, users!event_comments_author_user_id_fkey(username, display_name, profiles(avatar_thumb_url))')
      .eq('event_id', eventId)
      .eq('moderation_status', 'visible')
      .order('created_at', { ascending: true })
      .range(from, from + limit - 1)
  );
}

export async function getUserRsvp(db, eventId, userId) {
  return q(
    db.from('event_rsvps')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle()
  );
}

export async function getRecentPhotos(db, sailingId, limit = 24) {
  return q(
    db.from('photos')
      .select('id, thumb_key, medium_key, caption, user_id, event_id, users!photos_user_id_fkey(username, display_name)')
      .eq('sailing_id', sailingId)
      .eq('moderation_status', 'visible')
      .order('created_at', { ascending: false })
      .limit(limit)
  );
}

export async function getUnreadNotifCount(db, userId) {
  const { count } = await db.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  return count || 0;
}

export async function getNotifications(db, userId, page = 1, limit = 30) {
  const from = (page - 1) * limit;
  return q(
    db.from('notifications')
      .select('id, type, object_type, object_id, message, read_at, created_at, users!notifications_actor_id_fkey(username, display_name, profiles(avatar_thumb_url))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)
  );
}

export async function getFriendRequests(db, userId) {
  return q(
    db.from('friendships')
      .select('id, status, created_at, requester_id, users!friendships_requester_id_fkey(id, username, display_name, profiles(avatar_thumb_url))')
      .eq('addressee_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
  );
}

export async function getFriends(db, userId, limit = 50) {
  const [asFriendOf, asFriendFor] = await Promise.all([
    q(db.from('friendships')
        .select('id, addressee_id, users!friendships_addressee_id_fkey(id, username, display_name, profiles(avatar_thumb_url))')
        .eq('requester_id', userId)
        .eq('status', 'accepted')
        .limit(limit)),
    q(db.from('friendships')
        .select('id, requester_id, users!friendships_requester_id_fkey(id, username, display_name, profiles(avatar_thumb_url))')
        .eq('addressee_id', userId)
        .eq('status', 'accepted')
        .limit(limit))
  ]);
  return [...asFriendOf, ...asFriendFor];
}

export async function browsePeople(db, sailingId, { search, vibeTag, page = 1, limit = 30 } = {}) {
  const from = (page - 1) * limit;
  let query = db.from('users')
    .select('id, username, display_name, last_active_at, profiles(avatar_thumb_url, hometown, vibe_tags, about_me)')
    .eq('sailing_id', sailingId)
    .eq('account_status', 'active')
    .eq('activation_status', 'active')
    .order('last_active_at', { ascending: false, nullsFirst: false })
    .range(from, from + limit - 1);

  if (search) {
    query = query.ilike('display_name', `%${search}%`);
  }

  return q(query);
}

export async function createNotification(db, { userId, type, objectType, objectId, actorId, message }) {
  return q(
    db.from('notifications').insert({
      user_id: userId,
      type,
      object_type: objectType,
      object_id: objectId,
      actor_id: actorId,
      message
    }).select('id').single()
  );
}

export async function logAudit(db, { actorUserId, actionType, objectType, objectId, metadata, ipAddress }) {
  // Fire-and-forget; don't let audit failure block the request
  db.from('audit_logs').insert({
    actor_user_id: actorUserId,
    action_type: actionType,
    object_type: objectType,
    object_id: objectId,
    metadata,
    ip_address: ipAddress
  }).then(() => {}).catch(() => {});
}

export async function getReports(db, { status = 'pending', page = 1, limit = 30 } = {}) {
  const from = (page - 1) * limit;
  return q(
    db.from('reports')
      .select('id, target_type, target_id, reason, status, created_at, users!reports_reporter_user_id_fkey(username, display_name)')
      .eq('status', status)
      .order('created_at', { ascending: true })
      .range(from, from + limit - 1)
  );
}

export async function getSailing(db, sailingId) {
  return q(db.from('sailings').select('*').eq('id', sailingId).single());
}
