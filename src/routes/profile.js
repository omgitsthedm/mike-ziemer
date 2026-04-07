/**
 * Deckspace — Profile routes
 *
 * GET  /profile/:username            — view profile
 * GET  /profile/edit                 — edit own profile form
 * POST /profile/edit                 — save profile edits
 * POST /wall/:profileUserId          — post on wall
 * POST /wall/:postId/delete          — delete wall post
 * POST /guestbook/:profileUserId     — sign guestbook
 * POST /guestbook/:entryId/delete    — delete guestbook entry
 * POST /profile/avatar               — upload avatar
 * POST /profile/top-friends          — update top friends ordering
 */

import { Hono } from 'hono';
import { getDb, getUserByUsername, getProfileByUserId, getProfilePage, getWallPosts, getGuestbookEntries, getSailing, createNotification, logAudit, q } from '../lib/db.js';
import { requireAuth, resolveSession, isSailingReadOnly } from '../lib/auth.js';
import { processPhotoUpload, cdnUrl } from '../lib/media.js';
import { layout, flash, esc, relTime, fmtDate } from '../templates/layout.js';
import {
  module, profilePhotoBlock, contactBox, detailsTable, songModule,
  vibeTagsModule, friendSpaceModule, wallModule, guestbookModule, paginator
} from '../templates/components.js';

const profile = new Hono();

/* ============================================================
   VIEW PROFILE
   ============================================================ */
profile.get('/profile/:username', async (c) => {
  const db       = getDb(c.env);
  const viewer   = await resolveSession(c.env, c.req.raw);
  const sailing  = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase  = c.env.R2_PUBLIC_URL || '';
  const page     = parseInt(c.req.query('page') || '1', 10);

  // Resolve username → user
  let target;
  try {
    target = await getUserByUsername(db, c.env.SAILING_ID, c.req.param('username'));
  } catch (_) {
    return c.html(layout({ title: 'Not Found', user: viewer, sailing, body: '<div class="ds-empty-state">Profile not found.</div>' }), 404);
  }

  const { topFriends, friendCount, friendStatus } = await getProfilePage(db, target.id, viewer?.id);
  const profile = target.profiles;

  const [wallPosts, guestbook] = await Promise.all([
    getWallPosts(db, target.id, page),
    getGuestbookEntries(db, target.id, 1, 5)
  ]);

  // Profile views increment (fire-and-forget, skip own views)
  if (viewer && viewer.id !== target.id) {
    db.from('profiles').update({ profile_views: (profile?.profile_views || 0) + 1 }).eq('user_id', target.id)
      .then(() => {}).catch(() => {});
  }

  const isOwn      = viewer?.id === target.id;
  const readOnly   = sailing ? isSailingReadOnly(sailing) : false;
  const isOnline   = target.last_active_at && (Date.now() - new Date(target.last_active_at).getTime()) < 5 * 60 * 1000;

  const body = profilePage({
    target, profile, viewer, topFriends, friendCount, friendStatus,
    wallPosts, guestbook, isOwn, isOnline, readOnly,
    page, hasMoreWall: wallPosts.length === 20,
    cdnBase, sailing
  });

  return c.html(layout({
    title: target.display_name + "'s Profile",
    user: viewer,
    sailing,
    activeNav: isOwn ? 'profile' : '',
    body,
  }));
});

/* ============================================================
   EDIT PROFILE
   ============================================================ */
profile.get('/profile/edit', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const prof    = await getProfileByUserId(db, user.id).catch(() => ({}));

  const readOnly = sailing ? isSailingReadOnly(sailing) : false;
  if (readOnly) return c.redirect('/profile/' + user.username);

  return c.html(layout({
    title: 'Edit Profile',
    user,
    sailing,
    body: editProfileForm({ user, profile: prof, siteKey: c.env.TURNSTILE_SITE_KEY })
  }));
});

profile.post('/profile/edit', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const readOnly = sailing ? isSailingReadOnly(sailing) : false;
  if (readOnly) return c.redirect('/profile/' + user.username);

  const form = await c.req.formData();

  const displayName  = (form.get('display_name') || '').toString().trim().slice(0, 50);
  const aboutMe      = (form.get('about_me') || '').toString().trim().slice(0, 3000);
  const hometown     = (form.get('hometown') || '').toString().trim().slice(0, 100);
  const vibeTags     = (form.get('vibe_tags') || '').toString().split(',').map(t => t.trim()).filter(Boolean).slice(0, 10);
  const whoMeet      = (form.get('who_id_like_to_meet') || '').toString().trim().slice(0, 500);
  const intent       = (form.get('social_intent') || '').toString().trim().slice(0, 200);
  const themeId      = (form.get('theme_id') || 'classic').toString();
  const songTitle    = (form.get('song_title') || '').toString().trim().slice(0, 100);
  const songArtist   = (form.get('song_artist') || '').toString().trim().slice(0, 100);

  if (displayName && displayName.length >= 2) {
    await db.from('users').update({ display_name: displayName }).eq('id', user.id);
  }

  await db.from('profiles').upsert({
    user_id: user.id,
    about_me: aboutMe || null,
    hometown: hometown || null,
    vibe_tags: vibeTags.length ? vibeTags : null,
    who_id_like_to_meet: whoMeet || null,
    social_intent: intent || null,
    theme_id: themeId || 'classic',
    song_title: songTitle || null,
    song_artist: songArtist || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });

  return c.redirect('/profile/' + user.username + '?saved=1');
});

/* ============================================================
   AVATAR UPLOAD
   ============================================================ */
profile.post('/profile/avatar', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const bucket  = c.env.MEDIA_BUCKET;

  if (!bucket) return c.redirect('/profile/edit?error=storage_unavailable');

  const photoId = crypto.randomUUID();

  try {
    const form = await c.req.formData();
    const file = form.get('avatar');
    const { storageKey, thumbKey } = await processPhotoUpload(c.env, bucket, {
      file, sailingId: c.env.SAILING_ID, userId: user.id, photoId
    });
    await db.from('profiles').upsert({
      user_id: user.id,
      avatar_url: storageKey,
      avatar_thumb_url: thumbKey || storageKey,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    return c.redirect('/profile/' + user.username);
  } catch (err) {
    return c.redirect('/profile/edit?error=' + encodeURIComponent(err.message));
  }
});

/* ============================================================
   WALL POSTS
   ============================================================ */
profile.post('/wall/:profileUserId', requireAuth, async (c) => {
  const poster = c.get('user');
  const profileUserId = c.req.param('profileUserId');
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  if (sailing && isSailingReadOnly(sailing)) {
    return c.html(layout({ title: 'Read Only', user: poster, sailing, body: '<div class="ds-flash error">Deckspace is in archive mode.</div>' }), 403);
  }

  const form = await c.req.formData();
  const body = (form.get('body') || '').toString().trim().slice(0, 2000);

  if (!body) {
    return c.redirect('/profile/' + c.req.param('profileUserId') + '?error=empty_post');
  }

  // Verify profile exists and get username for redirect
  const { data: targetUser } = await db.from('users')
    .select('id, username')
    .eq('id', profileUserId)
    .single();
  if (!targetUser) return c.text('Not found', 404);

  await q(db.from('wall_posts').insert({
    profile_user_id: profileUserId,
    author_user_id: poster.id,
    body
  }));

  // Notification
  if (targetUser.id !== poster.id) {
    await createNotification(db, {
      userId: targetUser.id,
      type: 'wall_post',
      objectType: 'wall_post',
      actorId: poster.id,
      message: 'posted on your wall.'
    });
  }

  await logAudit(db, { actorUserId: poster.id, actionType: 'wall_post', objectType: 'user', objectId: targetUser.id, ipAddress: c.req.header('cf-connecting-ip') });

  return c.redirect('/profile/' + targetUser.username);
});

profile.post('/wall/:postId/delete', requireAuth, async (c) => {
  const user   = c.get('user');
  const postId = c.req.param('postId');
  const db     = getDb(c.env);

  const { data: post } = await db.from('wall_posts').select('id, profile_user_id, author_user_id').eq('id', postId).single();
  if (!post) return c.text('Not found', 404);

  // Only author, profile owner, or admin can delete
  const canDelete = post.author_user_id === user.id || post.profile_user_id === user.id || ['admin','moderator'].includes(user.role);
  if (!canDelete) return c.text('Forbidden', 403);

  await db.from('wall_posts').update({ moderation_status: 'removed' }).eq('id', postId);

  // Redirect back to profile
  const { data: profileUser } = await db.from('users').select('username').eq('id', post.profile_user_id).single();
  return c.redirect('/profile/' + (profileUser?.username || ''));
});

/* ============================================================
   GUESTBOOK
   ============================================================ */
profile.post('/guestbook/:profileUserId', requireAuth, async (c) => {
  const signer = c.get('user');
  const profileUserId = c.req.param('profileUserId');
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  if (sailing && isSailingReadOnly(sailing)) return c.text('Archive mode', 403);

  const form = await c.req.formData();
  const body = (form.get('body') || '').toString().trim().slice(0, 500);
  if (!body) return c.redirect(c.req.header('referer') || '/');

  const { data: targetUser } = await db.from('users').select('id, username').eq('id', profileUserId).single();
  if (!targetUser) return c.text('Not found', 404);

  await q(db.from('guestbook_entries').insert({
    profile_user_id: profileUserId,
    author_user_id: signer.id,
    body
  }));

  if (targetUser.id !== signer.id) {
    await createNotification(db, {
      userId: targetUser.id,
      type: 'guestbook',
      objectType: 'guestbook_entry',
      actorId: signer.id,
      message: 'signed your guestbook.'
    });
  }

  return c.redirect('/profile/' + targetUser.username);
});

profile.post('/guestbook/:entryId/delete', requireAuth, async (c) => {
  const user    = c.get('user');
  const entryId = c.req.param('entryId');
  const db      = getDb(c.env);

  const { data: entry } = await db.from('guestbook_entries').select('*').eq('id', entryId).single();
  if (!entry) return c.text('Not found', 404);

  const canDelete = entry.author_user_id === user.id || entry.profile_user_id === user.id || ['admin','moderator'].includes(user.role);
  if (!canDelete) return c.text('Forbidden', 403);

  await db.from('guestbook_entries').update({ moderation_status: 'removed' }).eq('id', entryId);

  const { data: profileUser } = await db.from('users').select('username').eq('id', entry.profile_user_id).single();
  return c.redirect('/profile/' + (profileUser?.username || ''));
});

/* ============================================================
   TOP FRIENDS
   ============================================================ */
profile.post('/profile/top-friends', requireAuth, async (c) => {
  const user = c.get('user');
  const db   = getDb(c.env);
  const form = await c.req.formData();

  // Expect friend_ids[] in order (1–8)
  const ids = form.getAll('friend_ids[]').slice(0, 8).map(id => id.toString());

  // Delete existing and replace
  await db.from('top_friends').delete().eq('user_id', user.id);

  if (ids.length) {
    const rows = ids.map((friendId, i) => ({
      user_id: user.id,
      friend_user_id: friendId,
      position: i + 1
    }));
    await q(db.from('top_friends').insert(rows));
  }

  return c.redirect('/profile/' + user.username);
});

/* ============================================================
   PROFILE PAGE TEMPLATE
   ============================================================ */
function profilePage({ target, profile, viewer, topFriends, friendCount, friendStatus, wallPosts, guestbook, isOwn, isOnline, readOnly, page, hasMoreWall, cdnBase, sailing }) {
  const savedFlash = (typeof viewer !== 'undefined') ? '' : '';

  // Build left column
  const leftCol = [
    profilePhotoBlock({ user: target, profile, isOwn, isOnline, cdnBase }),
    contactBox({ targetUser: target, viewerUser: viewer, friendStatus }),
    mediaLinksModule(target, profile, cdnBase),
    detailsTable({ profile, user: target }),
    songModule(profile),
    vibeTagsModule(profile),
    isOwn ? editTopFriendsLink() : ''
  ].join('');

  // Build right column
  const aboutMe = profile?.about_me
    ? module({ header: 'About Me', body: `<div class="blurb-body">${esc(profile.about_me)}</div>` })
    : (isOwn ? module({ header: 'About Me', body: `<div class="ds-empty-state"><a href="/profile/edit">Add a bio</a></div>` }) : '');

  const whoMeet = profile?.who_id_like_to_meet
    ? module({ header: "Who I'd Like to Meet", body: `<div class="blurb-body">${esc(profile.who_id_like_to_meet)}</div>` })
    : '';

  const friendSpace = friendSpaceModule({ topFriends, friendCount, cdnBase });

  const wall = wallModule({
    posts: wallPosts, profileUser: target, viewerUser: viewer, readOnly,
    page, hasMore: hasMoreWall
  });

  const gb = guestbookModule({ entries: guestbook, profileUser: target, viewerUser: viewer, readOnly });

  const rightCol = [aboutMe, whoMeet, friendSpace, wall, gb].join('');

  return `<div class="profile-wrap">
  <div class="profile-left">${leftCol}</div>
  <div class="profile-right">${rightCol}</div>
</div>`;
}

function mediaLinksModule(user, profile, cdnBase) {
  const links = [
    `<a href="/photos?user=${esc(user.username)}">View My Photos</a>`,
    `<a href="/events?user=${esc(user.username)}">My Events</a>`,
  ];
  return `<div class="ds-module">
  <div class="ds-module-header" style="font-size:10px">Links</div>
  <div class="ds-module-body" style="padding:5px 6px">
    ${links.map(l => `<div>${l}</div>`).join('')}
    <div class="profile-url-field" style="border-top:0;padding:4px 0 0">
      URL: <a href="/profile/${esc(user.username)}">/profile/${esc(user.username)}</a>
    </div>
  </div>
</div>`;
}

function editTopFriendsLink() {
  return `<div class="ds-module">
  <div class="ds-module-header" style="font-size:10px">Top Friends</div>
  <div class="ds-module-body">
    <a href="/friends/manage-top" class="ds-btn ds-btn-sm w-full" style="display:block;text-align:center">Manage Top Friends</a>
  </div>
</div>`;
}

function editProfileForm({ user, profile, siteKey }) {
  const themes = ['classic', 'ocean', 'sunset', 'night', 'retro-pink'];
  const themeOptions = themes.map(t =>
    `<option value="${t}" ${(profile?.theme_id || 'classic') === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' ')}</option>`
  ).join('');

  return `<div style="max-width:600px;margin:0 auto">
  <div class="ds-module">
    <div class="ds-module-header">Edit My Profile</div>
    <div class="ds-module-body">
      <form method="POST" action="/profile/edit" class="ds-form">
        <div class="ds-form-row">
          <label for="ed-name">Display Name</label>
          <input id="ed-name" name="display_name" type="text" class="ds-input" value="${esc(user.display_name)}" required maxlength="50">
        </div>
        <div class="ds-form-row">
          <label for="ed-about">About Me</label>
          <textarea id="ed-about" name="about_me" class="ds-textarea" rows="5" maxlength="3000">${esc(profile?.about_me || '')}</textarea>
        </div>
        <div class="ds-form-row">
          <label for="ed-hometown">Hometown</label>
          <input id="ed-hometown" name="hometown" type="text" class="ds-input" value="${esc(profile?.hometown || '')}" maxlength="100">
        </div>
        <div class="ds-form-row">
          <label>Vibe Tags</label>
          <div data-tag-input>
            <input type="hidden" name="vibe_tags" value="${esc((profile?.vibe_tags || []).join(','))}">
            <div class="vibe-tags tag-chips" style="min-height:28px;border:1px solid #ccc;padding:3px;background:#fff;margin-bottom:4px">
              ${(profile?.vibe_tags || []).map(t => `<span class="vibe-tag">${esc(t)} <button type="button" style="background:none;border:none;cursor:pointer;font-size:10px;color:#666;padding:0 0 0 3px">✕</button></span>`).join('')}
            </div>
            <input type="text" class="ds-input" placeholder="Add vibes (press Enter)">
          </div>
        </div>
        <div class="ds-form-row">
          <label for="ed-who">Who I'd Like to Meet</label>
          <textarea id="ed-who" name="who_id_like_to_meet" class="ds-textarea" rows="2" maxlength="500">${esc(profile?.who_id_like_to_meet || '')}</textarea>
        </div>
        <div class="ds-form-row">
          <label for="ed-intent">Cruise Vibe</label>
          <input id="ed-intent" name="social_intent" type="text" class="ds-input" value="${esc(profile?.social_intent || '')}" maxlength="200">
        </div>
        <div class="ds-form-row">
          <label for="ed-theme">Profile Theme</label>
          <select id="ed-theme" name="theme_id" class="ds-select">${themeOptions}</select>
        </div>
        <div class="ds-form-row">
          <label for="ed-song-title">Profile Song Title <span style="font-weight:normal;color:#999">(optional)</span></label>
          <input id="ed-song-title" name="song_title" type="text" class="ds-input" value="${esc(profile?.song_title || '')}" maxlength="100">
        </div>
        <div class="ds-form-row">
          <label for="ed-song-artist">Song Artist</label>
          <input id="ed-song-artist" name="song_artist" type="text" class="ds-input" value="${esc(profile?.song_artist || '')}" maxlength="100">
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-orange" data-loading-text="Saving...">Save Profile</button>
          <a href="/profile/${esc(user.username)}" class="ds-btn" style="margin-left:6px">Cancel</a>
        </div>
      </form>
    </div>
  </div>

  <div class="ds-module">
    <div class="ds-module-header">Profile Photo</div>
    <div class="ds-module-body">
      <form method="POST" action="/profile/avatar" enctype="multipart/form-data" class="ds-form">
        <div class="ds-form-row">
          <label for="avatar-file">Upload a new photo</label>
          <input id="avatar-file" name="avatar" type="file" accept="image/*" data-preview="avatar-preview">
          <div id="avatar-preview" style="margin-top:6px"></div>
        </div>
        <div class="ds-form-row">
          <button type="submit" class="ds-btn ds-btn-primary">Upload Photo</button>
        </div>
      </form>
    </div>
  </div>
</div>`;
}

export default profile;
