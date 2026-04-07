/**
 * Deckspace — Media / R2 helpers
 *
 * All uploads go to Cloudflare R2.
 * We generate three sizes: thumb (150x150), medium (800w), original.
 * Images are compressed aggressively. No video in v1.
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB hard limit
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Validate an uploaded file.
 * Returns { ok: true } or { ok: false, error: string }
 */
export function validateUpload(file) {
  if (!file || typeof file.size !== 'number') {
    return { ok: false, error: 'No file provided.' };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: 'Only JPEG, PNG, GIF, and WebP images are allowed.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'Image must be under 8 MB.' };
  }
  return { ok: true };
}

/**
 * Generate a deterministic storage key for a photo.
 * Format: photos/{sailingId}/{userId}/{uuid}.{ext}
 */
export function storageKey(sailingId, userId, id, ext = 'jpg') {
  return `photos/${sailingId}/${userId}/${id}.${ext}`;
}

export function thumbKey(sailingId, userId, id, ext = 'jpg') {
  return `thumbs/${sailingId}/${userId}/${id}_t.${ext}`;
}

export function mediumKey(sailingId, userId, id, ext = 'jpg') {
  return `medium/${sailingId}/${userId}/${id}_m.${ext}`;
}

/**
 * Upload a file buffer to R2.
 * @param {R2Bucket} bucket  CF R2 bucket binding
 * @param {string} key
 * @param {ArrayBuffer} body
 * @param {string} contentType
 */
export async function uploadToR2(bucket, key, body, contentType) {
  await bucket.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { uploadedAt: new Date().toISOString() }
  });
}

/**
 * Build a public CDN URL for a stored object.
 * R2 public URL comes from the bound R2_PUBLIC_URL env var.
 */
export function cdnUrl(env, key) {
  if (!key) return null;
  const base = env.R2_PUBLIC_URL || '';
  return base ? `${base}/${key}` : null;
}

/**
 * Delete a key from R2 (fire-and-forget safe).
 */
export async function deleteFromR2(bucket, key) {
  if (!key) return;
  try {
    await bucket.delete(key);
  } catch (_) {
    // non-fatal
  }
}

/**
 * Parse a multipart/form-data body and return file + fields.
 * CF Workers support request.formData() natively.
 */
export async function parseUpload(request) {
  const form = await request.formData();
  return {
    file: form.get('photo') || form.get('file') || form.get('avatar'),
    caption: (form.get('caption') || '').toString().trim().slice(0, 300),
    albumId: (form.get('album_id') || '').toString() || null,
    eventId: (form.get('event_id') || '').toString() || null
  };
}

/**
 * Process an image upload end-to-end:
 *  1. validate
 *  2. upload original, thumb placeholder, medium placeholder to R2
 *     (real resizing would happen in a Durable Object / queued Worker;
 *      for v1 we upload original once and serve it at limited size via
 *      Cloudflare Image Resizing if available, or direct URL)
 *  3. return storage keys
 *
 * Returns: { storageKey, thumbKey, mediumKey, width, height, fileSizeBytes }
 *   or throws on validation failure.
 */
export async function processPhotoUpload(env, bucket, { file, sailingId, userId, photoId }) {
  const valid = validateUpload(file);
  if (!valid.ok) throw new Error(valid.error);

  const ext = extensionForType(file.type);
  const sk = storageKey(sailingId, userId, photoId, ext);
  const tk = thumbKey(sailingId, userId, photoId, ext);
  const mk = mediumKey(sailingId, userId, photoId, ext);

  const buf = await file.arrayBuffer();

  // Upload original
  await uploadToR2(bucket, sk, buf, file.type);

  // For v1: thumb and medium keys point to same object.
  // CF Image Resizing (if enabled on the zone) handles resizing at CDN edge
  // via URL params. If not available, serve original with CSS max-width.
  // In a later phase, add a background Worker to generate actual resized copies.

  // v1: no server-side resizing. thumb/medium keys are null so callers
  // fall back to storageKey. CF Image Resizing (if enabled on the zone)
  // can handle resizing at CDN edge via URL params.
  return {
    storageKey: sk,
    thumbKey: null,
    mediumKey: null,
    fileSizeBytes: buf.byteLength
  };
}

function extensionForType(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/gif':  'gif',
    'image/webp': 'webp'
  };
  return map[mimeType] || 'jpg';
}

/**
 * Build avatar URL with fallback.
 */
export function avatarUrl(env, profile, size = 'thumb') {
  const key = size === 'thumb' ? profile?.avatar_thumb_url : profile?.avatar_url;
  return cdnUrl(env, key) || null;
}
