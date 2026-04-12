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
import { processPhotoUpload, cdnUrl, pickUploadedFile } from '../lib/media.js';
import { layout, layoutCtx, esc, relTime, fmtDate, csrfField } from '../templates/layout.js';
import { ic } from '../templates/icons.js';
import { module, photoThumb, commentEntry, paginator, absUrl } from '../templates/components.js';

const photos = new Hono();
const PHOTO_VIEWS = ['all', 'events', 'captions'];

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
  const rawView = (c.req.query('view') || '').toLowerCase().trim();
  const view = PHOTO_VIEWS.includes(rawView) ? rawView : 'all';
  const limit   = 24;
  const offset  = (page - 1) * limit;

  let photoQuery = db.from('photos')
    .select('id, thumb_key, storage_key, caption, created_at, user_id, event_id, users!photos_user_id_fkey(username, display_name), events!photos_event_id_fkey(id, title)')
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
  if (view === 'events') photoQuery = photoQuery.not('event_id', 'is', null);
  if (view === 'captions') photoQuery = photoQuery.not('caption', 'is', null);

  const [{ data: photoList }, totalPhotosRes, linkedPhotosRes] = await Promise.all([
    photoQuery,
    db.from('photos').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).eq('moderation_status', 'visible'),
    db.from('photos').select('id', { count: 'exact', head: true }).eq('sailing_id', c.env.SAILING_ID).eq('moderation_status', 'visible').not('event_id', 'is', null),
  ]);
  const hasMore = (photoList || []).length === limit;
  const totalPhotos = totalPhotosRes.count || 0;
  const linkedPhotos = linkedPhotosRes.count || 0;
  const captionedPhotos = (photoList || []).filter((p) => p.caption).length;
  const featured = (photoList || []).slice(0, 3);

  const uploadBtn = viewer && !isSailingReadOnly(sailing)
    ? `<a href="/photos/upload" class="ds-btn ds-btn-orange photo-board-upload">+ Upload Photos</a>`
    : '';

  const gridHtml = (photoList || []).length
    ? `<div class="photo-board-grid">${(photoList || []).map((p, index) => photoBoardCard({ photo: p, cdnBase, eager: index < 6 })).join('')}</div>`
    : `<div class="ds-empty-state">No photos yet. ${viewer ? `<a href="/photos/upload">Upload the first one.</a>` : 'Check back after the first photos are shared.'}</div>`;

  const pager = paginator(page, hasMore, '/photos', userFilter ? `&user=${encodeURIComponent(userFilter)}` : '');
  const title = userFilter ? `Photos by ${userFilter}` : 'Shared Cruise Photos';
  const boardHeader = userFilter ? `Photos by ${esc(userFilter)}` : 'Shared Photo Board';
  const canonicalUrl = new URL('/photos', c.req.url).toString();
  const isFiltered = Boolean(userFilter || view !== 'all' || page > 1);
  const spotlight = featured.length
    ? `<section class="photo-board-spotlights">
        ${featured.map((p) => photoSpotlightCard({ photo: p, cdnBase })).join('')}
      </section>`
    : '';
  const viewPills = `<div class="photo-board-pills">
    ${PHOTO_VIEWS.map((pill) => `<a href="${photoQueryHref({ userFilter, view: pill })}" class="photo-board-pill${view === pill ? ' active' : ''}">${esc(photoViewLabel(pill))}</a>`).join('')}
  </div>`;
  const summary = `<section class="photo-board-shell">
    <div class="photo-board-copy">
      <div class="photo-board-kicker">${ic.camera(13)} DeckSpace Photo Board</div>
      <h2 class="photo-board-title">${boardHeader}</h2>
      <p class="photo-board-sub">${esc(photoViewDescription(view, userFilter))}</p>
      ${viewPills}
    </div>
    <div class="photo-board-stats">
      <div class="photo-board-stat"><strong>${totalPhotos}</strong><span>public drops</span></div>
      <div class="photo-board-stat"><strong>${linkedPhotos}</strong><span>linked to events</span></div>
      <div class="photo-board-stat"><strong>${captionedPhotos}</strong><span>captioned on this page</span></div>
      <div class="photo-board-stat action">${uploadBtn || '<span>Browse the photo board</span>'}</div>
    </div>
  </section>`;

  const body = `${summary}${spotlight}${module({
    header: userFilter ? `${ic.camera(12)} ${esc(userFilter)}'s Photo Roll` : `${ic.camera(12)} Photo Roll`,
    headerRight: `<a href="/photos">All Photos</a>`,
    body: `${gridHtml}${pager}`
  })}`;

  return c.html(layoutCtx(c, {
    title,
    description: userFilter
      ? `Browse public DeckSpace photos shared by ${userFilter} on this sailing.`
      : view === 'events'
      ? 'Browse DeckSpace photos linked to public events on this sailing.'
      : view === 'captions'
      ? 'Browse captioned DeckSpace photos from this sailing.'
      : 'Browse recent DeckSpace photos from the sailing, linked events, and public passenger uploads.',
    user: viewer,
    sailing,
    activeNav: 'photos',
    body,
    canonicalUrl,
    noIndex: isFiltered,
    structuredData: photoListStructuredData(c.req.url, canonicalUrl, photoList || [], { userFilter, view, page, isFiltered }),
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
    <div class="ds-module-header">${ic.camera(12)} Upload Photos</div>
    <div class="ds-module-body">
      <p class="text-small text-muted mb-8">Up to 8 MB each. JPEG, PNG, GIF, and WebP all work.</p>
      <form method="POST" action="/photos/upload" enctype="multipart/form-data" class="ds-form" data-retry="true">
        ${csrfField(c.get('csrfToken') || '')}
        <div class="ds-form-row">
          <label for="ph-file">Photo *</label>
          <input id="ph-file" name="photo" type="file" accept="image/*" data-preview="ph-preview">
          <div class="hint">Pick one from your phone or computer.</div>
        </div>
        <div class="ds-form-row">
          <label for="ph-camera">Take a new photo</label>
          <input id="ph-camera" name="photo_camera" type="file" accept="image/*" capture="environment" data-preview="ph-preview">
          <div class="hint">On iPhone this opens the camera so you can snap one right away.</div>
          <div id="ph-preview" style="margin-top:6px"></div>
        </div>
        <div class="ds-form-row">
          <label for="ph-caption">Caption <span style="font-weight:normal;color:#999">(optional)</span></label>
          <input id="ph-caption" name="caption" type="text" class="ds-input" maxlength="300" placeholder="Add a short caption">
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

  return c.html(layoutCtx(c, {
    title: 'Upload a Cruise Photo',
    description: 'Upload a photo to DeckSpace, add a caption, and optionally link it to an event on the sailing.',
    user,
    sailing,
    activeNav: 'photos',
    body
  }));
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
    return c.html(layoutCtx(c, {
      title: 'Photo Upload Error',
      user,
      sailing,
      body: `<div class="ds-flash error">Media storage is not configured. Please try again later.</div><a href="/photos" class="ds-btn">Back to Photos</a>`
    }), 503);
  }

  try {
    const form     = c.get('parsedForm') || await c.req.formData();
    const file     = pickUploadedFile(form, ['photo_camera', 'photo']);
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
    return c.html(layoutCtx(c, {
      title: 'Photo Upload Error',
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
    return c.html(layoutCtx(c, { title: 'Photo Not Found', user: viewer, sailing, body: '<div class="ds-empty-state">That photo is not here anymore.</div>' }), 404);
  }

  const { data: comments } = await db.from('photo_comments')
    .select('id, body, created_at, author_user_id, users!photo_comments_author_user_id_fkey(id, username, display_name, profiles(avatar_thumb_url))')
    .eq('photo_id', photo.id)
    .eq('moderation_status', 'visible')
    .order('created_at', { ascending: true });

  const mediumKey = photo.medium_key || photo.storage_key;
  const mediumUrl = mediumKey
    ? absUrl(cdnBase, mediumKey)
    : null;

  const avatarKey = photo.users?.profiles?.avatar_thumb_url;
  const uploaderThumbUrl = avatarKey
    ? absUrl(cdnBase, avatarKey)
    : null;

  const csrf = c.get('csrfToken') || '';

  const commentListHtml = (comments || []).length
    ? (comments || []).map(cm => commentEntry({
        authorUser: cm.users, body: cm.body, time: cm.created_at, id: cm.id,
        viewerUser: viewer,
        deleteAction: `/photos/${photo.id}/comment/${cm.id}/delete`,
        canDelete: viewer && (cm.author_user_id === viewer.id || ['admin','moderator'].includes(viewer.role)),
        cdnBase,
        targetType: 'photo_comment',
        redirectTo: `/photos/${photo.id}`,
        csrfToken: csrf,
      })).join('')
    : `<div class="ds-empty-state">No comments yet. Say something nice first.</div>`;

  const commentForm = viewer && !readOnly
    ? `<div class="comment-form">
        <form method="POST" action="/photos/${esc(photo.id)}/comment" data-retry="true">
          ${csrfField(csrf)}
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
        ${csrfField(csrf)}
        <button type="submit" class="ds-btn ds-btn-danger ds-btn-sm" data-confirm="Delete this photo?">Delete Photo</button>
       </form>`
    : '';

  const reportLink = viewer && !isOwner
    ? `<a href="/report?type=photo&id=${esc(photo.id)}" class="ds-btn ds-btn-sm" style="margin-left:4px;color:#999">Report</a>`
    : '';

  const body = `<div class="ds-module">
  <div class="ds-module-header blue">${ic.camera(12)} Photo</div>
  <div class="photo-view-shell">
    <div class="photo-view-img">
      ${mediumUrl
        ? `<img src="${esc(mediumUrl)}" alt="${esc(photo.caption || `Photo uploaded by ${photo.users?.display_name || 'a passenger'}`)}" width="800" height="600" decoding="async">`
        : `<div class="ds-empty-state photo-view-unavailable">This image is not available right now.</div>`}
    </div>
    <div class="photo-view-side">
      <div class="photo-view-meta-card">
        <div class="photo-view-overline">${ic.camera(11)} Shared ${relTime(photo.created_at)}</div>
        <div class="photo-view-caption">${esc(photo.caption || 'A little shipboard evidence with no caption attached.')}</div>
        <div class="photo-view-facts">
          <div><span>By</span><strong><a href="/profile/${esc(photo.users?.username || '')}">${esc(photo.users?.display_name || 'Unknown')}</a></strong></div>
          <div><span>When</span><strong>${fmtDate(photo.created_at, { time: true })}</strong></div>
          <div><span>Event</span><strong>${photo.events ? `<a href="/events/${esc(photo.events.id)}">${esc(photo.events.title)}</a>` : 'Open ship moment'}</strong></div>
        </div>
        <div class="photo-view-actions">${deleteBtn}${reportLink}</div>
      </div>
    </div>
  </div>
</div>
${module({
  header: `${ic.msgSquare(12)} Comments`,
  body: `<div class="comment-list">${commentListHtml}</div>${commentForm}`
})}`;

  return c.html(layoutCtx(c, {
    title: photo.caption ? `Photo: ${photo.caption.slice(0, 50)}` : `Photo by ${photo.users?.display_name || 'Passenger'}`,
    description: photo.caption
      ? `${photo.caption} on DeckSpace, shared publicly during this sailing.`
      : `A public DeckSpace photo shared by ${photo.users?.display_name || 'a passenger'} during this sailing.`,
    user: viewer,
    sailing,
    activeNav: 'photos',
    body,
    ogImageUrl: mediumUrl || undefined,
    structuredData: photoStructuredData(c.req.url, photo, mediumUrl),
  }));
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

  const form = c.get('parsedForm') || await c.req.formData();
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

function photoListStructuredData(url, canonicalUrl, photos, { userFilter, view, page, isFiltered }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    url: new URL(url).toString(),
    name: userFilter
      ? `DeckSpace photos by ${userFilter}`
      : view === 'events'
      ? 'DeckSpace event photos'
      : view === 'captions'
      ? 'DeckSpace captioned photos'
      : page > 1
      ? `DeckSpace photos page ${page}`
      : 'DeckSpace photo board',
    description: isFiltered
      ? 'Filtered public DeckSpace photo results for this sailing.'
      : 'Public DeckSpace photo board for the sailing.',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: photos.slice(0, 12).map((photo, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: new URL(`/photos/${photo.id}`, canonicalUrl).toString(),
        name: photo.caption || `DeckSpace photo ${index + 1}`,
      })),
    },
  };
}

function photoStructuredData(url, photo, imageUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    url: new URL(url).toString(),
    name: photo.caption ? `DeckSpace photo: ${photo.caption.slice(0, 80)}` : `DeckSpace photo by ${photo.users?.display_name || 'a passenger'}`,
    description: photo.caption || `Public DeckSpace photo shared by ${photo.users?.display_name || 'a passenger'}.`,
    contentUrl: imageUrl || undefined,
    creator: photo.users?.display_name ? {
      '@type': 'Person',
      name: photo.users.display_name,
    } : undefined,
    datePublished: photo.created_at,
  };
}

function photoQueryHref({ userFilter = null, view = 'all' }) {
  const params = new URLSearchParams();
  if (userFilter) params.set('user', userFilter);
  if (view && view !== 'all') params.set('view', view);
  const qs = params.toString();
  return qs ? `/photos?${qs}` : '/photos';
}

function photoViewLabel(view) {
  const labels = {
    all: 'All Photos',
    events: 'Event Photos',
    captions: 'Captioned',
  };
  return labels[view] || 'All Photos';
}

function photoViewDescription(view, userFilter) {
  if (userFilter) return `A cleaner view of the public photos shared by ${userFilter}.`;
  if (view === 'events') return 'Just the photos tied directly to events and planned moments.';
  if (view === 'captions') return 'Photos with captions so people can tell what the moment actually was.';
  return 'Recent public photos from this sailing, organized to make them easier to browse.';
}

function photoCardImageUrl(photo, cdnBase) {
  const key = photo.thumb_key || photo.storage_key;
  if (!key) return null;
  return absUrl(cdnBase, key);
}

function photoBoardCard({ photo, cdnBase, eager = false }) {
  const url = photoCardImageUrl(photo, cdnBase);
  if (!url) return '';
  return `<article class="photo-board-card">
  <a href="/photos/${esc(photo.id)}" class="photo-board-media">
    <img src="${esc(url)}" alt="${esc(photo.caption || `Photo shared by ${photo.users?.display_name || 'a passenger'}`)}" width="320" height="320" loading="${eager ? 'eager' : 'lazy'}" decoding="async">
  </a>
  <div class="photo-board-meta">
    <div class="photo-board-tags">
      <span>${photo.events ? 'Event-linked' : 'Shared photo'}</span>
      <span>${relTime(photo.created_at)}</span>
    </div>
    <a href="/photos/${esc(photo.id)}" class="photo-board-card-title">${esc((photo.caption || 'Untitled photo').slice(0, 70))}</a>
    <div class="photo-board-card-byline">by ${esc(photo.users?.display_name || 'Unknown')}${photo.events ? ` &middot; <a href="/events/${esc(photo.events.id)}">${esc(photo.events.title)}</a>` : ''}</div>
  </div>
</article>`;
}

function photoSpotlightCard({ photo, cdnBase }) {
  const url = photoCardImageUrl(photo, cdnBase);
  if (!url) return '';
  return `<article class="photo-spotlight-card">
  <a href="/photos/${esc(photo.id)}" class="photo-spotlight-image">
    <img src="${esc(url)}" alt="${esc(photo.caption || `Photo shared by ${photo.users?.display_name || 'a passenger'}`)}" width="480" height="320" loading="lazy" decoding="async">
  </a>
  <div class="photo-spotlight-copy">
    <div class="photo-spotlight-tag">${photo.events ? 'Linked to event' : 'Recent upload'}</div>
    <a href="/photos/${esc(photo.id)}" class="photo-spotlight-title">${esc((photo.caption || 'Photo shared on DeckSpace').slice(0, 80))}</a>
    <div class="photo-spotlight-meta">${esc(photo.users?.display_name || 'Unknown')}${photo.events ? ` &middot; ${esc(photo.events.title)}` : ''}</div>
  </div>
</article>`;
}
