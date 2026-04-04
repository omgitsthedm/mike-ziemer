/**
 * Deckspace — Photos routes
 *
 * GET  /photos              — photos landing (recent, events, albums)
 * GET  /photos/upload       — upload form
 * POST /photos/upload       — handle upload
 * GET  /photos/:id          — photo detail
 * POST /photos/:id/comment  — add photo comment
 * POST /photos/:id/comment/:cid/delete — delete comment
 * POST /photos/:id/delete   — delete photo
 */

import { Hono } from 'hono';
import { getDb, getRecentPhotos, getSailing, createNotification, q } from '../lib/db.js';
import { requireAuth, resolveSession, isSailingReadOnly } from '../lib/auth.js';
import { processPhotoUpload, cdnUrl } from '../lib/media.js';
import { layout, esc, relTime, fmtDate } from '../templates/layout.js';
import { module, photoThumb, commentEntry, paginator } from '../templates/components.js';

const photos = new Hono();

/* ============================================================
   PHOTOS LANDING
   ============================================================ */
photos.get('/photos', async (c) => {
  const viewer  = await resolveSession(c.env, c.req.raw);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const page    = parseInt(c.req.query('page') || '1', 10);
  const userFilter = c.req.query('user') || null;
  const limit   = 24;
  const offset  = (page - 1) * limit;

  let photoQuery = db.from('photos')
    .select('id, thumb_key, storage_key, caption, created_at, user_id, event_id, users!photos_user_id_fkey(username, display_name)')
    .eq('sailing_id', c.env.SAILING_ID)
    .eq('moderation_status', 'visible')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (userFilter) {
    // Filter by username
    const { data: targetUser } = await db.from('users')
      .select('id').eq('sailing_id', c.env.SAILING_ID).ilike('username', userFilter).single();
    if (targetUser) {
      photoQuery = photoQuery.eq('user_id', targetUser.id);
    }
  }

  const { data: photoList } = await photoQuery;
  const hasMore = (photoList || []).length === limit;

  const uploadBtn = viewer && !isSailingReadOnly(sailing)
    ? `<div style="margin-bottom:8px"><a href="/photos/upload" class="ds-btn ds-btn-orange">+ Upload Photos</a></div>`
    : '';

  const gridHtml = (photoList || []).length
    ? `<div class="photo-grid">${(photoList || []).map(p => photoThumb({ photo: p, cdnBase })).join('')}</div>`
    : `<div class="ds-empty-state">No photos yet. ${viewer ? `<a href="/photos/upload">Upload some!</a>` : ''}</div>`;

  const pager = paginator(page, hasMore, '/photos', userFilter ? `&user=${encodeURIComponent(userFilter)}` : '');

  const body = `${uploadBtn}${module({
    header: userFilter ? `Photos by ${esc(userFilter)}` : 'Recent Photos',
    headerRight: `<a href="/photos">All Photos</a>`,
    body: `${gridHtml}${pager}`
  })}`;

  return c.html(layout({
    title: 'Photos',
    user: viewer,
    sailing,
    activeNav: 'photos',
    body,
  }));
});

/* ============================================================
   UPLOAD FORM
   ============================================================ */
photos.get('/photos/upload', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const readOnly = sailing ? isSailingReadOnly(sailing) : false;

  if (readOnly) return c.redirect('/photos');

  // Get events for association dropdown
  const { data: evList } = await db.from('events')
    .select('id, title, start_at')
    .eq('sailing_id', c.env.SAILING_ID)
    .eq('moderation_status', 'visible')
    .order('start_at', { ascending: false })
    .limit(30);

  const evOptions = (evList || []).map(e =>
    `<option value="${esc(e.id)}">${esc(e.title)} (${fmtDate(e.start_at)})</option>`
  ).join('');

  const body = `<div style="max-width:480px;margin:0 auto">
  <div class="ds-module">
    <div class="ds-module-header">Upload Photos</div>
    <div class="ds-module-body">
      <p class="text-small text-muted mb-8">Max 8 MB per photo. JPEG, PNG, GIF, WebP supported.</p>
      <form method="POST" action="/photos/upload" enctype="multipart/form-data" class="ds-form" data-retry="true">
        <div class="ds-form-row">
          <label for="ph-file">Photo *</label>
          <input id="ph-file" name="photo" type="file" accept="image/*" required data-preview="ph-preview">
          <div id="ph-preview" style="margin-top:6px"></div>
        </div>
        <div class="ds-form-row">
          <label for="ph-caption">Caption <span style="font-weight:normal;color:#999">(optional)</span></label>
          <input id="ph-caption" name="caption" type="text" class="ds-input" maxlength="300" placeholder="What's happening here?">
        </div>
        <div class="ds-form-row">
          <label for="ph-event">Link to Event <span style="font-weight:normal;color:#999">(optional)</span></label>
          <select id="ph-event" name="event_id" class="ds-select">
            <option value="">— No Event —</option>
            ${evOptions}
          </select>
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-orange" data-loading-text="Uploading...">Upload Photo</button>
          <a href="/photos" class="ds-btn" style="margin-left:6px">Cancel</a>
        </div>
      </form>
    </div>
  </div>
</div>`;

  return c.html(layout({ title: 'Upload Photo', user, sailing, activeNav: 'photos', body }));
});

/* ============================================================
   HANDLE UPLOAD
   ============================================================ */
photos.post('/photos/upload', requireAuth, async (c) => {
  const user    = c.get('user');
  const db      = getDb(c.env);
  const bucket  = c.env.MEDIA_BUCKET;
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const readOnly = sailing ? isSailingReadOnly(sailing) : false;
  if (readOnly) return c.redirect('/photos');

  if (!bucket) {
    return c.html(layout({
      title: 'Upload Error',
      user,
      sailing,
      body: `<div class="ds-flash error">Media storage is not configured. Please try again later.</div><a href="/photos" class="ds-btn">Back to Photos</a>`
    }), 503);
  }

  try {
    const form     = await c.req.formData();
    const file     = form.get('photo');
    const caption  = (form.get('caption') || '').toString().trim().slice(0, 300);
    const eventId  = (form.get('event_id') || '').toString() || null;

    const crypto = globalThis.crypto;
    const photoId = crypto.randomUUID();

    const { storageKey, thumbKey, mediumKey, fileSizeBytes } = await processPhotoUpload(
      c.env, bucket, { file, sailingId: c.env.SAILING_ID, userId: user.id, photoId }
    );

    const { data: newPhoto } = await db.from('photos').insert({
      id: photoId,
      user_id: user.id,
      sailing_id: c.env.SAILING_ID,
      event_id: eventId || null,
      storage_key: storageKey,
      thumb_key: thumbKey,
      medium_key: mediumKey,
      caption: caption || null,
      file_size_bytes: fileSizeBytes,
      moderation_status: 'visible'
    }).select('id').single();

    return c.redirect('/photos/' + newPhoto.id);
  } catch (err) {
    return c.html(layout({
      title: 'Upload Error',
      user,
      sailing,
      body: `<div class="ds-flash error">${esc(err.message || 'Upload failed.')}</div><a href="/photos/upload" class="ds-btn">Try Again</a>`
    }), 400);
  }
});

/* ============================================================
   PHOTO DETAIL
   ============================================================ */
photos.get('/photos/:id', async (c) => {
  const viewer  = await resolveSession(c.env, c.req.raw);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const cdnBase = c.env.R2_PUBLIC_URL || '';
  const readOnly = sailing ? isSailingReadOnly(sailing) : false;

  const { data: photo } = await db.from('photos')
    .select('*, users!photos_user_id_fkey(id, username, display_name, profiles(avatar_thumb_url)), events!photos_event_id_fkey(id, title)')
    .eq('id', c.req.param('id'))
    .single();

  if (!photo || photo.moderation_status !== 'visible') {
    return c.html(layout({ title: 'Not Found', user: viewer, sailing, body: '<div class="ds-empty-state">Photo not found.</div>' }), 404);
  }

  const { data: comments } = await db.from('photo_comments')
    .select('id, body, created_at, author_user_id, users!photo_comments_author_user_id_fkey(id, username, display_name, profiles(avatar_thumb_url))')
    .eq('photo_id', photo.id)
    .eq('moderation_status', 'visible')
    .order('created_at', { ascending: true });

  const mediumUrl = (photo.medium_key || photo.storage_key)
    ? `${cdnBase}/${photo.medium_key || photo.storage_key}`
    : null;

  const uploaderThumbUrl = photo.users?.profiles?.avatar_thumb_url
    ? `${cdnBase}/${photo.users.profiles.avatar_thumb_url}`
    : null;

  const commentListHtml = (comments || []).length
    ? (comments || []).map(c => commentEntry({ authorUser: c.users, body: c.body, time: c.created_at, id: c.id, viewerUser: viewer, deleteAction: `/photos/${photo.id}/comment/${c.id}/delete`, canDelete: viewer && (c.author_user_id === viewer.id || ['admin','moderator'].includes(viewer.role)), cdnBase })).join('')
    : `<div class="ds-empty-state">No comments yet.</div>`;

  const commentForm = viewer && !readOnly
    ? `<div class="comment-form">
        <form method="POST" action="/photos/${esc(photo.id)}/comment" data-retry="true">
          <div class="ds-form-row">
            <textarea name="body" class="ds-textarea" placeholder="Comment on this photo..." required maxlength="500"></textarea>
          </div>
          <div class="form-row">
            <button type="submit" class="ds-btn ds-btn-primary ds-btn-sm" data-loading-text="Posting...">Post Comment</button>
          </div>
        </form>
       </div>`
    : '';

  const isOwner = viewer?.id === photo.user_id;
  const deleteBtn = isOwner || ['admin','moderator'].includes(viewer?.role || '')
    ? `<form method="POST" action="/photos/${esc(photo.id)}/delete" style="display:inline">
        <button type="submit" class="ds-btn ds-btn-danger ds-btn-sm" data-confirm="Delete this photo?">Delete Photo</button>
       </form>`
    : '';

  const reportLink = viewer && !isOwner
    ? `<a href="/report?type=photo&id=${esc(photo.id)}" class="ds-btn ds-btn-sm" style="margin-left:4px;color:#999">Report</a>`
    : '';

  const body = `<div class="ds-module">
  <div class="ds-module-header blue">Photo</div>
  <div style="text-align:center;background:#111;padding:8px">
    ${mediumUrl
      ? `<img src="${esc(mediumUrl)}" alt="${esc(photo.caption || '')}" style="max-width:100%;max-height:500px;object-fit:contain" loading="lazy">`
      : `<div class="ds-empty-state" style="color:#fff">Image unavailable</div>`}
  </div>
  <div style="padding:8px">
    ${photo.caption ? `<div style="font-size:13px;margin-bottom:6px">${esc(photo.caption)}</div>` : ''}
    <div class="text-small text-muted">
      Uploaded by <a href="/profile/${esc(photo.users?.username || '')}">${esc(photo.users?.display_name || 'Unknown')}</a>
      ${relTime(photo.created_at)}
      ${photo.events ? `&mdash; <a href="/events/${esc(photo.events.id)}">${esc(photo.events.title)}</a>` : ''}
    </div>
    <div style="margin-top:6px">${deleteBtn}${reportLink}</div>
  </div>
</div>
${module({
  header: 'Comments',
  body: `<div class="comment-list">${commentListHtml}</div>${commentForm}`
})}`;

  return c.html(layout({ title: photo.caption || 'Photo', user: viewer, sailing, activeNav: 'photos', body }));
});

/* ============================================================
   PHOTO COMMENTS
   ============================================================ */
photos.post('/photos/:id/comment', requireAuth, async (c) => {
  const user    = c.get('user');
  const photoId = c.req.param('id');
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  if (sailing && isSailingReadOnly(sailing)) return c.redirect('/photos/' + photoId);

  const form = await c.req.formData();
  const body = (form.get('body') || '').toString().trim().slice(0, 500);
  if (!body) return c.redirect('/photos/' + photoId);

  await q(db.from('photo_comments').insert({
    photo_id: photoId,
    author_user_id: user.id,
    body
  }));

  // Notify photo owner
  const { data: photo } = await db.from('photos').select('user_id').eq('id', photoId).single();
  if (photo && photo.user_id !== user.id) {
    await createNotification(db, {
      userId: photo.user_id,
      type: 'photo_comment',
      objectType: 'photo',
      objectId: photoId,
      actorId: user.id,
      message: 'commented on your photo.'
    });
  }

  return c.redirect('/photos/' + photoId);
});

photos.post('/photos/:id/comment/:cid/delete', requireAuth, async (c) => {
  const user    = c.get('user');
  const cid     = c.req.param('cid');
  const photoId = c.req.param('id');
  const db      = getDb(c.env);

  const { data: comment } = await db.from('photo_comments').select('*').eq('id', cid).single();
  if (!comment) return c.text('Not found', 404);

  const canDelete = comment.author_user_id === user.id || ['admin','moderator'].includes(user.role);
  if (!canDelete) return c.text('Forbidden', 403);

  await db.from('photo_comments').update({ moderation_status: 'removed' }).eq('id', cid);

  return c.redirect('/photos/' + photoId);
});

photos.post('/photos/:id/delete', requireAuth, async (c) => {
  const user    = c.get('user');
  const photoId = c.req.param('id');
  const db      = getDb(c.env);

  const { data: photo } = await db.from('photos').select('*').eq('id', photoId).single();
  if (!photo) return c.text('Not found', 404);

  const canDelete = photo.user_id === user.id || ['admin','moderator'].includes(user.role);
  if (!canDelete) return c.text('Forbidden', 403);

  await db.from('photos').update({ moderation_status: 'removed' }).eq('id', photoId);

  return c.redirect('/photos');
});

export default photos;
