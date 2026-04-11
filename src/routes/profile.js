/**
 * Deckspace — Profile routes
 *
 * GET  /profile/:username            — view profile
 * GET  /profile/edit                 — edit own profile form
 * POST /profile/edit                 — save profile edits
 * POST /wall/:profileUserId          — post on wall
 * POST /wall/:postId/delete          — delete wall post
 * POST /profile/avatar               — upload avatar
 * POST /profile/top-friends          — update top friends ordering
 */

import { Hono } from 'hono';
import { getDb, getUserByUsername, getProfileByUserId, getProfilePage, getWallPosts, getSailing, createNotification, logAudit, q } from '../lib/db.js';
import { requireAuth, resolveSession, isSailingReadOnly } from '../lib/auth.js';
import { processPhotoUpload, cdnUrl, pickUploadedFile } from '../lib/media.js';
import { layout, layoutCtx, esc, relTime, fmtDate, csrfField } from '../templates/layout.js';
import { ic } from '../templates/icons.js';
import {
  module, profilePhotoBlock, contactBox, detailsTable, songModule,
  vibeTagsModule, friendSpaceModule, wallModule, paginator
} from '../templates/components.js';

const profile = new Hono();

/* ============================================================
   EDIT PROFILE  (must be registered BEFORE /profile/:username
   so "edit" isn't treated as a username)
   ============================================================ */
profile.get('/profile/edit', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const prof    = await getProfileByUserId(db, user.id).catch(() => ({}));

  const readOnly = sailing ? isSailingReadOnly(sailing) : false;
  if (readOnly) return c.redirect('/profile/' + user.username);

  return c.html(layoutCtx(c, {
    title: 'Edit Your Deckspace Profile',
    description: 'Update your Deckspace profile details, vibe tags, status, profile song, and public sailing identity.',
    user,
    sailing,
    body: editProfileForm({ user, profile: prof, siteKey: c.env.TURNSTILE_SITE_KEY, csrfToken: c.get('csrfToken') || '' })
  }));
});

profile.post('/profile/edit', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const readOnly = sailing ? isSailingReadOnly(sailing) : false;
  if (readOnly) return c.redirect('/profile/' + user.username);

  const form = c.get('parsedForm') || await c.req.formData();

  const displayName  = (form.get('display_name') || '').toString().trim().slice(0, 50);
  const aboutMe      = (form.get('about_me') || '').toString().trim().slice(0, 3000);
  const hometown     = (form.get('hometown') || '').toString().trim().slice(0, 100);
  const vibeTags     = (form.get('vibe_tags') || '').toString().split(',').map(t => t.trim()).filter(Boolean).slice(0, 10);
  const whoMeet      = (form.get('who_id_like_to_meet') || '').toString().trim().slice(0, 500);
  const intent       = (form.get('social_intent') || '').toString().trim().slice(0, 200);
  const statusText   = (form.get('status_text') || '').toString().trim().slice(0, 120);
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
    status_text: statusText || null,
    theme_id: themeId || 'classic',
    song_title: songTitle || null,
    song_artist: songArtist || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });

  return c.redirect('/profile/' + user.username + '?saved=1');
});

profile.post('/profile/avatar', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const bucket  = c.env.MEDIA_BUCKET;

  if (!bucket) return c.redirect('/profile/edit?error=storage_unavailable');

  const photoId = crypto.randomUUID();

  try {
    const form = c.get('parsedForm') || await c.req.formData();
    const file = pickUploadedFile(form, ['avatar_camera', 'avatar']);
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

profile.post('/profile/top-friends', requireAuth, async (c) => {
  const user = c.get('user');
  const db   = getDb(c.env);
  const form = c.get('parsedForm') || await c.req.formData();

  const ids = form.getAll('friend_ids[]').slice(0, 8).map(id => id.toString());

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
    return c.html(layoutCtx(c, { title: 'Profile Not Found', user: viewer, sailing, body: '<div class="ds-empty-state">Profile not found.</div>' }), 404);
  }

  const { topFriends, friendCount, friendStatus } = await getProfilePage(db, target.id, viewer?.id);
  const profile = target.profiles;

  const wallPosts = await getWallPosts(db, target.id, page);

  // Profile views increment (fire-and-forget, skip own views)
  if (viewer && viewer.id !== target.id) {
    db.from('profiles').update({ profile_views: (profile?.profile_views || 0) + 1 }).eq('user_id', target.id)
      .then(() => {}).catch(() => {});
  }

  const isOwn      = viewer?.id === target.id;
  const readOnly   = sailing ? isSailingReadOnly(sailing) : false;
  const isOnline   = target.last_active_at && (Date.now() - new Date(target.last_active_at).getTime()) < 5 * 60 * 1000;

  const csrf = c.get('csrfToken') || '';

  const body = profilePage({
    target, profile, viewer, topFriends, friendCount, friendStatus,
    wallPosts, isOwn, isOnline, readOnly,
    page, hasMoreWall: wallPosts.length === 20,
    cdnBase, sailing, csrfToken: csrf
  });

  return c.html(layoutCtx(c, {
    title: `${target.display_name}'s Deckspace Profile (@${target.username})`,
    description: profile?.about_me
      ? `View ${target.display_name} (@${target.username}) on Deckspace. ${profile.about_me.slice(0, 92)}`
      : `View ${target.display_name} (@${target.username}) on Deckspace, including public wall posts, vibes, and sailing activity.`,
    user: viewer,
    sailing,
    activeNav: isOwn ? 'profile' : '',
    body,
  }));
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
    return c.html(layoutCtx(c, { title: 'Read Only', user: poster, sailing, body: '<div class="ds-flash error">Deckspace is in archive mode.</div>' }), 403);
  }

  const form = c.get('parsedForm') || await c.req.formData();
  const body = (form.get('body') || '').toString().trim().slice(0, 2000);

  // Fetch target first so we can redirect to /profile/username on errors
  const { data: targetUser } = await db.from('users')
    .select('id, username')
    .eq('id', profileUserId)
    .single();
  if (!targetUser) return c.text('Not found', 404);

  if (!body) {
    return c.redirect('/profile/' + targetUser.username + '?error=empty_post');
  }

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
   PROFILE PAGE TEMPLATE
   ============================================================ */
function profilePage({ target, profile, viewer, topFriends, friendCount, friendStatus, wallPosts, isOwn, isOnline, readOnly, page, hasMoreWall, cdnBase, sailing, csrfToken }) {
  const themeClass = profile?.theme_id ? ` theme-${profile.theme_id}` : '';
  const headline = profile?.status_text
    || profile?.social_intent
    || (isOwn ? 'Your page is officially open for business.' : `${target.display_name}'s page is officially open for business.`);
  const cruiseVibe = profile?.social_intent || 'Floating somewhere between mischief, caffeine, and making plans.';
  const storyCards = [
    {
      label: 'Cruise Vibe',
      value: cruiseVibe,
      note: profile?.vibe_tags?.length ? `${profile.vibe_tags.length} vibe tag${profile.vibe_tags.length === 1 ? '' : 's'} on deck` : 'Needs a few more stickers and labels',
    },
    {
      label: 'Hometown Signal',
      value: profile?.hometown || 'Currently claiming the ship as home base.',
      note: userMemberSince(target),
    },
    {
      label: 'Now Playing',
      value: profile?.song_title
        ? `${profile.song_title}${profile?.song_artist ? ` — ${profile.song_artist}` : ''}`
        : 'No profile song set yet.',
      note: profile?.who_id_like_to_meet
        ? `Looking to meet: ${profile.who_id_like_to_meet.slice(0, 60)}${profile.who_id_like_to_meet.length > 60 ? '…' : ''}`
        : 'Wall is open for drive-by notes and introductions',
    },
  ];

  const masthead = `<section class="profile-masthead">
    <div class="profile-masthead-main">
      <div class="profile-masthead-kicker">${ic.star(12)} ${isOwn ? 'Your Deckspace Page' : 'Deckspace Profile'}</div>
      <h2 class="profile-masthead-title">${esc(target.display_name)} <span>@${esc(target.username)}</span></h2>
      <p class="profile-masthead-sub">“${esc(headline)}”</p>
      <div class="profile-meta-pills">
        <span class="profile-meta-pill">${isOnline ? 'Online now' : `Active ${relTime(target.last_active_at || target.created_at)}`}</span>
        <span class="profile-meta-pill">${friendCount} friend${friendCount === 1 ? '' : 's'}</span>
        <span class="profile-meta-pill">${topFriends.length} in the Top Space</span>
        <span class="profile-meta-pill">${profile?.profile_views || 0} profile view${(profile?.profile_views || 0) === 1 ? '' : 's'}</span>
      </div>
      <div class="profile-masthead-links">
        <a href="/photos?user=${esc(target.username)}" class="profile-masthead-link">${ic.camera(12)} Photo Roll</a>
        <a href="/events?user=${esc(target.username)}" class="profile-masthead-link">${ic.calendar(12)} Plans</a>
        <a href="/friends" class="profile-masthead-link">${ic.users(12)} Friend Space</a>
        <a href="${isOwn ? '/profile/edit' : '#wall-post-form'}" class="profile-masthead-link">${isOwn ? `${ic.settings(12)} Edit Page` : `${ic.pencil(12)} Write on Wall`}</a>
      </div>
    </div>
    <div class="profile-stat-strip">
      <div class="profile-stat-card">
        <strong>${friendCount}</strong>
        <span>friends in orbit</span>
      </div>
      <div class="profile-stat-card">
        <strong>${wallPosts.length}</strong>
        <span>wall notes loaded</span>
      </div>
      <div class="profile-stat-card">
        <strong>${profile?.vibe_tags?.length || 0}</strong>
        <span>vibe stickers</span>
      </div>
      <div class="profile-stat-card">
        <strong>${profile?.song_title ? '1' : '0'}</strong>
        <span>profile songs queued</span>
      </div>
    </div>
  </section>`;

  const storyStrip = `<section class="profile-story-strip">
    ${storyCards.map((card) => `<article class="profile-story-card">
      <div class="profile-story-label">${esc(card.label)}</div>
      <div class="profile-story-value">${esc(card.value)}</div>
      <div class="profile-story-note">${esc(card.note)}</div>
    </article>`).join('')}
  </section>`;

  // Build left column
  const leftCol = [
    profilePhotoBlock({ user: target, profile, isOwn, isOnline, cdnBase }),
    contactBox({ targetUser: target, viewerUser: viewer, friendStatus, csrfToken }),
    mediaLinksModule(target, profile, cdnBase),
    detailsTable({ profile, user: target }),
    songModule(profile),
    vibeTagsModule(profile),
    isOwn ? editTopFriendsLink() : ''
  ].join('');

  // Build right column
  const aboutMe = profile?.about_me
    ? module({ header: `${ic.bookOpen(12)} About Me`, body: `<div class="blurb-body">${esc(profile.about_me)}</div>` })
    : (isOwn ? module({ header: `${ic.bookOpen(12)} About Me`, body: `<div class="ds-empty-state"><a href="/profile/edit">Add a bio</a></div>` }) : '');

  const whoMeet = profile?.who_id_like_to_meet
    ? module({ header: `${ic.users(12)} Who I'd Like to Meet`, body: `<div class="blurb-body">${esc(profile.who_id_like_to_meet)}</div>` })
    : '';

  const friendSpace = friendSpaceModule({ topFriends, friendCount, cdnBase });

  const wall = wallModule({
    posts: wallPosts, profileUser: target, viewerUser: viewer, readOnly,
    page, hasMore: hasMoreWall, csrfToken
  });

  const rightCol = [aboutMe, whoMeet, friendSpace, wall].join('');

  return `<div class="profile-page${themeClass}">
  ${masthead}
  ${storyStrip}
  <div class="profile-wrap">
  <div class="profile-left">${leftCol}</div>
  <div class="profile-right">${rightCol}</div>
</div>
</div>`;
}

function mediaLinksModule(user, profile, cdnBase) {
  const links = [
    `<a href="/photos?user=${esc(user.username)}" class="profile-link-row">${ic.camera(12)} View My Photos</a>`,
    `<a href="/events?user=${esc(user.username)}" class="profile-link-row">${ic.calendar(12)} My Events</a>`,
    `<a href="/friends" class="profile-link-row">${ic.users(12)} Friend Space</a>`,
  ];
  return `<div class="ds-module">
  <div class="ds-module-header">${ic.list(12)} Links</div>
  <div class="ds-module-body profile-links-body">
    <div class="profile-link-stack">${links.join('')}</div>
    <div class="profile-url-field profile-url-inline">
      URL: <a href="/profile/${esc(user.username)}">/profile/${esc(user.username)}</a>
    </div>
  </div>
</div>`;
}

function editTopFriendsLink() {
  return `<div class="ds-module">
  <div class="ds-module-header">${ic.heart(12)} Top Friends</div>
  <div class="ds-module-body">
    <a href="/friends/manage-top" class="ds-btn ds-btn-sm w-full" style="display:block;text-align:center">Manage Top Friends</a>
  </div>
</div>`;
}

function editProfileForm({ user, profile, siteKey, csrfToken = '' }) {
  const themes = ['classic', 'ocean', 'sunset', 'night', 'retro-pink'];
  const themeOptions = themes.map(t =>
    `<option value="${t}" ${(profile?.theme_id || 'classic') === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' ')}</option>`
  ).join('');

  return `<div style="max-width:600px;margin:0 auto">
  <div class="ds-module">
    <div class="ds-module-header">${ic.settings(12)} Edit My Profile</div>
    <div class="ds-module-body">
      <form method="POST" action="/profile/edit" class="ds-form">
        ${csrfField(csrfToken)}
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
          <label for="ed-status">Status <span style="font-weight:normal;color:#999">(shows on your profile, max 120 chars)</span></label>
          <input id="ed-status" name="status_text" type="text" class="ds-input" value="${esc(profile?.status_text || '')}" maxlength="120" placeholder="What are you up to? (e.g. 'Plotting something at the pool bar')">
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
    <div class="ds-module-header">${ic.camera(12)} Profile Photo</div>
    <div class="ds-module-body">
      <form method="POST" action="/profile/avatar" enctype="multipart/form-data" class="ds-form">
        ${csrfField(csrfToken)}
        <div class="ds-form-row">
          <label for="avatar-file">Choose a photo</label>
          <input id="avatar-file" name="avatar" type="file" accept="image/*" data-preview="avatar-preview">
          <div class="hint">Pick one from your phone or computer.</div>
        </div>
        <div class="ds-form-row">
          <label for="avatar-camera">Or take one right now</label>
          <input id="avatar-camera" name="avatar_camera" type="file" accept="image/*" capture="user" data-preview="avatar-preview">
          <div class="hint">On iPhone this opens the camera for a quick selfie.</div>
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

function userMemberSince(user) {
  if (!user?.created_at) return 'Fresh to the ship';
  return `Member since ${fmtDate(user.created_at)}`;
}
