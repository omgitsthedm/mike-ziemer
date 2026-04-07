/**
 * Deckspace — Reusable HTML components
 *
 * All components return HTML strings.
 * Visual language: OG MySpace — orange section headers, blue modules,
 * dense table-era layout, utility-heavy left rail.
 */

import { esc, relTime, fmtDate } from './layout.js';

/* ============================================================
   MODULE WRAPPER
   Standard orange-header module box.
   ============================================================ */
export function module({ header, headerRight = '', body, headerStyle = '', id = '' }) {
  return `<div class="ds-module"${id ? ` id="${esc(id)}"` : ''}>
  <div class="ds-module-header${headerStyle ? ' ' + headerStyle : ''}">
    <span>${header}</span>
    ${headerRight ? `<span>${headerRight}</span>` : ''}
  </div>
  <div class="ds-module-body">${body}</div>
</div>`;
}

/* ============================================================
   AVATAR
   ============================================================ */
export function avatar(url, displayName, size = 'thumb', extra = '') {
  const dim = size === 'thumb' ? 40 : (size === 'large' ? 160 : 60);
  if (url) {
    return `<img src="${esc(url)}" alt="${esc(displayName)}" width="${dim}" height="${dim}" loading="lazy"${extra ? ' ' + extra : ''}>`;
  }
  return `<div class="no-photo-xs" style="width:${dim}px;height:${dim}px" aria-label="${esc(displayName)}">?</div>`;
}

/* ============================================================
   PROFILE PHOTO BLOCK (left rail)
   ============================================================ */
export function profilePhotoBlock({ user, profile, isOwn, isOnline, cdnBase }) {
  const avatarUrl = profile?.avatar_url ? `${cdnBase || ''}/${profile.avatar_url}` : null;
  const img = avatarUrl
    ? `<img class="avatar" src="${esc(avatarUrl)}" alt="${esc(user.display_name)}" width="160" height="160" loading="lazy">`
    : `<div class="no-photo" aria-label="No photo">No Photo</div>`;

  const onlineHtml = isOnline
    ? `<span class="online-indicator">Online Now</span>`
    : user.last_active_at
      ? `<span class="profile-status-line">Active ${relTime(user.last_active_at)}</span>`
      : '';

  const editLink = isOwn
    ? `<div class="text-center mt-4"><a href="/profile/edit" class="ds-btn ds-btn-sm">Edit Profile</a></div>`
    : '';

  return `<div class="profile-photo-block">
  ${img}
  <span class="profile-display-name">${esc(user.display_name)}</span>
  <div class="text-small text-muted">@${esc(user.username)}</div>
  ${onlineHtml}
  ${editLink}
</div>`;
}

/* ============================================================
   CONTACT/ACTION BOX (left rail)
   ============================================================ */
export function contactBox({ targetUser, viewerUser, friendStatus }) {
  if (!viewerUser || viewerUser.id === targetUser.id) return '';

  let friendAction = '';
  if (!friendStatus) {
    friendAction = `<form method="POST" action="/friends/${esc(targetUser.id)}/request" data-retry="true">
      <button type="submit" class="contact-btn primary">+ Add Friend</button>
    </form>`;
  } else if (friendStatus.status === 'pending') {
    if (friendStatus.requester_id === viewerUser.id) {
      friendAction = `<span class="contact-btn" style="color:#666;cursor:default">Request Sent</span>`;
    } else {
      friendAction = `<form method="POST" action="/friends/${esc(friendStatus.id)}/accept" data-retry="true">
        <button type="submit" class="contact-btn primary">Accept Friend</button>
      </form>`;
    }
  } else if (friendStatus.status === 'accepted') {
    friendAction = `<span class="contact-btn" style="color:#006600;cursor:default">&#10003; Friends</span>`;
  }

  return `<div class="contact-box">
  <div class="ds-module-header">Contacting ${esc(targetUser.display_name)}</div>
  <div class="contact-actions">
    ${friendAction}
    <a href="#wall-post-form" class="contact-btn">&#128394; Write on Wall</a>
    <a href="#guestbook-form" class="contact-btn">&#128221; Sign Guestbook</a>
    <a href="/report?type=user&id=${esc(targetUser.id)}" class="contact-btn text-small" style="color:#999">Report</a>
    <form method="POST" action="/friends/${esc(targetUser.id)}/block" data-confirm="Block this user?" data-retry="true">
      <button type="submit" class="contact-btn danger text-small">Block</button>
    </form>
  </div>
</div>`;
}

/* ============================================================
   PROFILE DETAILS TABLE (left rail)
   ============================================================ */
export function detailsTable({ profile, user }) {
  const rows = [];
  if (profile?.hometown)   rows.push(['Hometown', esc(profile.hometown)]);
  if (profile?.interests)  rows.push(['Interests', esc(profile.interests)]);
  if (user?.created_at)    rows.push(['Member since', fmtDate(user.created_at)]);

  if (!rows.length) return '';

  const trs = rows.map(([label, val]) =>
    `<tr><td class="label">${label}:</td><td class="value">${val}</td></tr>`
  ).join('');

  return module({
    header: 'Details',
    body: `<table class="details-table">${trs}</table>`
  });
}

/* ============================================================
   PROFILE SONG MODULE (left rail)
   ============================================================ */
export function songModule(profile) {
  if (!profile?.song_title) return '';
  return module({
    header: 'Profile Song',
    body: `<div class="song-player">
  <span class="song-title">${esc(profile.song_title)}</span>
  <span class="song-artist">${esc(profile.song_artist || '')}</span>
  ${profile.song_url
    ? `<button class="song-play-btn" data-song-url="${esc(profile.song_url)}" type="button">&#9658; Play</button>
       <p class="text-small text-muted mt-4">(tap to play &mdash; no autoplay)</p>`
    : ''}
</div>`
  });
}

/* ============================================================
   VIBE TAGS MODULE
   ============================================================ */
export function vibeTagsModule(profile) {
  const tags = profile?.vibe_tags;
  if (!tags || !tags.length) return '';
  const chips = tags.map(t => `<span class="vibe-tag">${esc(t)}</span>`).join('');
  return module({
    header: 'Vibes',
    body: `<div class="vibe-tags">${chips}</div>`
  });
}

/* ============================================================
   FRIEND SPACE / TOP FRIENDS GRID
   ============================================================ */
export function friendSpaceModule({ topFriends, friendCount, cdnBase }) {
  const countLine = `<div class="friend-count-line">${friendCount || 0} friend${friendCount === 1 ? '' : 's'}</div>`;

  if (!topFriends || !topFriends.length) {
    return module({
      header: 'Friend Space',
      body: `${countLine}<div class="ds-empty-state">No top friends yet.</div>`
    });
  }

  const gridItems = topFriends.map(tf => {
    const friend = tf.users;
    const thumbUrl = friend?.profiles?.avatar_thumb_url
      ? `${cdnBase || ''}/${friend.profiles.avatar_thumb_url}`
      : null;
    const imgHtml = thumbUrl
      ? `<img src="${esc(thumbUrl)}" alt="${esc(friend.display_name)}" width="60" height="60" loading="lazy">`
      : `<div class="no-photo-thumb">${esc((friend?.display_name || '?').charAt(0))}</div>`;
    return `<div class="friend-grid-item">
  <a href="/profile/${esc(friend?.username || '')}">${imgHtml}</a>
  <a href="/profile/${esc(friend?.username || '')}" class="friend-name">${esc(friend?.display_name || '?')}</a>
</div>`;
  }).join('');

  return module({
    header: 'Friend Space',
    headerRight: `<a href="/friends">View All</a>`,
    body: `${countLine}<div class="friend-grid">${gridItems}</div>`
  });
}

/* ============================================================
   WALL POSTS MODULE
   ============================================================ */
export function wallModule({ posts, profileUser, viewerUser, readOnly, page, hasMore }) {
  const canPost = viewerUser && !readOnly && viewerUser.id !== profileUser.id;
  const postForm = canPost ? wallPostForm(profileUser.id) : '';

  const postList = posts && posts.length
    ? posts.map(post => commentEntry({
        authorUser: post.users,
        body: post.body,
        time: post.created_at,
        id: post.id,
        viewerUser,
        deleteAction: `/wall/${post.id}/delete`,
        canDelete: viewerUser && (viewerUser.id === post.author_user_id || viewerUser.id === profileUser.id || ['admin','moderator'].includes(viewerUser.role))
      })).join('')
    : `<div class="ds-empty-state">No wall posts yet. Be the first!</div>`;

  const pager = paginator(page || 1, hasMore, `/profile/${profileUser.username}`);

  return module({
    header: 'Wall Posts',
    id: 'wall-posts',
    body: `${postList}${pager}${postForm}`
  });
}

function wallPostForm(profileUserId) {
  return `<div class="comment-form" id="wall-post-form">
  <form method="POST" action="/wall/${esc(profileUserId)}" data-retry="true">
    <div class="ds-form-row">
      <label for="wall-body" class="sr-only">Write on wall</label>
      <textarea id="wall-body" name="body" class="ds-textarea" placeholder="Write something on their wall..." required maxlength="2000"></textarea>
    </div>
    <div class="form-row">
      <button type="submit" class="ds-btn ds-btn-primary ds-btn-sm" data-loading-text="Posting...">Post</button>
    </div>
  </form>
</div>`;
}

/* ============================================================
   GUESTBOOK MODULE
   ============================================================ */
export function guestbookModule({ entries, profileUser, viewerUser, readOnly }) {
  const canSign = viewerUser && !readOnly && viewerUser.id !== profileUser.id;
  const signForm = canSign ? guestbookForm(profileUser.id) : '';

  const entryList = entries && entries.length
    ? entries.map(e => commentEntry({
        authorUser: e.users,
        body: e.body,
        time: e.created_at,
        id: e.id,
        viewerUser,
        deleteAction: `/guestbook/${e.id}/delete`,
        canDelete: viewerUser && (viewerUser.id === e.author_user_id || viewerUser.id === profileUser.id || ['admin','moderator'].includes(viewerUser.role))
      })).join('')
    : `<div class="ds-empty-state">No guestbook entries yet.</div>`;

  return module({
    header: 'Guestbook',
    id: 'guestbook',
    body: `${entryList}${signForm}`
  });
}

function guestbookForm(profileUserId) {
  return `<div class="comment-form" id="guestbook-form">
  <form method="POST" action="/guestbook/${esc(profileUserId)}" data-retry="true">
    <div class="ds-form-row">
      <label for="gb-body" class="sr-only">Sign guestbook</label>
      <textarea id="gb-body" name="body" class="ds-textarea" placeholder="Leave a message in their guestbook..." required maxlength="500"></textarea>
    </div>
    <div class="form-row">
      <button type="submit" class="ds-btn ds-btn-primary ds-btn-sm" data-loading-text="Signing...">Sign Guestbook</button>
    </div>
  </form>
</div>`;
}

/* ============================================================
   COMMENT ENTRY (shared by wall, guestbook, events, photos)
   ============================================================ */
export function commentEntry({ authorUser, body, time, id, viewerUser, deleteAction, canDelete, cdnBase }) {
  const thumbUrl = authorUser?.profiles?.avatar_thumb_url
    ? `${cdnBase || ''}/${authorUser.profiles.avatar_thumb_url}`
    : null;
  const imgHtml = thumbUrl
    ? `<img src="${esc(thumbUrl)}" alt="${esc(authorUser?.display_name || '')}" width="40" height="40" loading="lazy">`
    : `<div class="no-photo-xs">${esc((authorUser?.display_name || '?').charAt(0))}</div>`;

  const deleteHtml = canDelete
    ? `<form method="POST" action="${esc(deleteAction)}" style="display:inline">
        <button type="submit" class="ds-btn ds-btn-sm" data-confirm="Delete this?" style="font-size:9px;padding:1px 5px;color:#cc0000;background:none;border:none;cursor:pointer">delete</button>
       </form>`
    : '';

  return `<div class="comment-entry">
  <div class="comment-avatar">
    <a href="/profile/${esc(authorUser?.username || '')}">${imgHtml}</a>
  </div>
  <div class="comment-body">
    <a href="/profile/${esc(authorUser?.username || '')}" class="comment-author">${esc(authorUser?.display_name || 'Unknown')}</a>
    <div class="comment-text">${esc(body)}</div>
    <div class="comment-time">${relTime(time)} ${deleteHtml}</div>
  </div>
</div>`;
}

/* ============================================================
   EVENT CARD (for list view)
   ============================================================ */
export function eventCard({ event, cdnBase }) {
  const thumbHtml = event.cover_image_url
    ? `<img src="${esc(`${cdnBase || ''}/${event.cover_image_url}`)}" alt="" width="50" height="50" loading="lazy">`
    : `<div style="font-size:18px;line-height:50px;text-align:center;">${categoryEmoji(event.category)}</div>`;

  const typeBadge = event.event_type === 'official'
    ? `<span class="event-official-badge">Official</span>`
    : '';
  const catBadge = event.category
    ? `<span class="event-category-badge">${esc(event.category)}</span>`
    : '';

  return `<div class="event-card">
  <a href="/events/${esc(event.id)}" class="event-thumb">${thumbHtml}</a>
  <div class="event-info">
    <a href="/events/${esc(event.id)}" class="event-title">${esc(event.title)}${typeBadge}${catBadge}</a>
    <div class="event-meta">${fmtDate(event.start_at, { time: true })}${event.location ? ` &mdash; ${esc(event.location)}` : ''}</div>
    <div class="event-card-rsvp-count">${event.rsvp_count} going</div>
  </div>
</div>`;
}

function categoryEmoji(cat) {
  const map = {
    karaoke: '🎤', trivia: '🧠', dinner: '🍽', deck: '⛵',
    excursion: '🗺', drinks: '🍹', poker: '🃏', theme: '🎭', other: '📅'
  };
  return map[cat] || '📅';
}

/* ============================================================
   PHOTO THUMBNAIL
   ============================================================ */
export function photoThumb({ photo, cdnBase }) {
  const url = photo.thumb_key || photo.storage_key
    ? `${cdnBase || ''}/${photo.thumb_key || photo.storage_key}`
    : null;

  if (!url) return '';
  return `<div class="photo-thumb-item">
  <a href="/photos/${esc(photo.id)}">
    <img data-src="${esc(url)}" src="/images/placeholder.gif" alt="${esc(photo.caption || '')}" loading="lazy">
    ${photo.caption ? `<div class="photo-caption-overlay">${esc(photo.caption.slice(0, 40))}</div>` : ''}
  </a>
</div>`;
}

/* ============================================================
   PERSON ROW (people browse)
   ============================================================ */
export function personRow({ user, profile, viewerUser, friendStatus, cdnBase }) {
  const thumbUrl = profile?.avatar_thumb_url
    ? `${cdnBase || ''}/${profile.avatar_thumb_url}`
    : null;
  const imgHtml = thumbUrl
    ? `<img class="person-thumb" src="${esc(thumbUrl)}" alt="${esc(user.display_name)}" width="44" height="44" loading="lazy">`
    : `<div class="person-thumb-placeholder">${esc((user.display_name || '?').charAt(0))}</div>`;

  const tags = (profile?.vibe_tags || []).slice(0, 3).map(t =>
    `<span class="vibe-tag">${esc(t)}</span>`
  ).join('');

  let actionHtml = '';
  if (viewerUser && viewerUser.id !== user.id) {
    if (!friendStatus) {
      actionHtml = `<form method="POST" action="/friends/${esc(user.id)}/request">
        <button type="submit" class="ds-btn ds-btn-sm ds-btn-primary">+ Add</button>
      </form>`;
    } else if (friendStatus.status === 'accepted') {
      actionHtml = `<span style="color:#006600;font-size:11px">&#10003; Friends</span>`;
    } else if (friendStatus.status === 'pending') {
      actionHtml = `<span style="color:#666;font-size:10px">Pending</span>`;
    }
  }

  return `<div class="person-row">
  <a href="/profile/${esc(user.username)}">${imgHtml}</a>
  <div class="person-info">
    <a href="/profile/${esc(user.username)}" class="person-name">${esc(user.display_name)}</a>
    <div class="person-meta">${profile?.hometown ? esc(profile.hometown) + ' &mdash; ' : ''}Active ${relTime(user.last_active_at)}</div>
    <div class="vibe-tags" style="padding:2px 0">${tags}</div>
  </div>
  <div class="person-action">${actionHtml}</div>
</div>`;
}

/* ============================================================
   NOTIFICATION ITEM
   ============================================================ */
export function notifItem(n) {
  const icons = {
    friend_request: '👋',
    friend_accepted: '🤝',
    wall_post: '📝',
    guestbook: '📖',
    event_comment: '💬',
    photo_comment: '📷',
    rsvp: '📅',
    admin_notice: '⚠️'
  };
  const icon = icons[n.type] || '🔔';
  const msg = n.message || defaultNotifMessage(n);
  const actor = n.users;

  return `<div class="notif-item${n.read_at ? '' : ' unread'}">
  <div class="notif-icon">${icon}</div>
  <div class="notif-body">
    ${actor ? `<a href="/profile/${esc(actor.username)}">${esc(actor.display_name)}</a> ` : ''}${esc(msg)}
  </div>
  <div class="notif-time">${relTime(n.created_at)}</div>
</div>`;
}

function defaultNotifMessage(n) {
  const msgs = {
    friend_request: 'wants to be your friend.',
    friend_accepted: 'accepted your friend request.',
    wall_post: 'posted on your wall.',
    guestbook: 'signed your guestbook.',
    event_comment: 'commented on an event.',
    photo_comment: 'commented on a photo.',
    rsvp: 'RSVPed to your event.',
    admin_notice: 'Admin notice.'
  };
  return msgs[n.type] || 'sent you a notification.';
}

/* ============================================================
   PAGINATOR (duplicate export for convenience)
   ============================================================ */
export function paginator(page, hasMore, baseUrl, extraParams = '') {
  const sep = baseUrl.includes('?') ? '&' : '?';
  const parts = [];
  if (page > 1) {
    parts.push(`<a href="${baseUrl}${sep}page=${page - 1}${extraParams}">&laquo; Prev</a>`);
  }
  parts.push(`<span class="current">Page ${page}</span>`);
  if (hasMore) {
    parts.push(`<a href="${baseUrl}${sep}page=${page + 1}${extraParams}">Next &raquo;</a>`);
  }
  if (parts.length <= 1) return '';
  return `<div class="ds-pager">${parts.join('')}</div>`;
}
