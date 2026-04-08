/**
 * Deckspace — Reactions
 *
 * POST /react  — toggle reaction on any target
 *   body: target_type, target_id, reaction_type, redirect_to
 */

import { Hono } from 'hono';
import { getDb } from '../lib/db.js';
import { requireAuth, isRateLimited } from '../lib/auth.js';

const reactions = new Hono();

const VALID_TYPES   = ['wall_post', 'photo', 'event_comment', 'photo_comment'];
const VALID_REACTS  = ['heart', 'star', 'wave'];

reactions.post('/react', requireAuth, async (c) => {
  const user = c.get('user');
  const db   = getDb(c.env);
  const ip   = c.req.header('cf-connecting-ip') || '';

  if (await isRateLimited(c.env, `react:${user.id}`, 30)) {
    return c.redirect(c.req.header('referer') || '/');
  }

  const form        = c.get('parsedForm') || await c.req.formData().catch(() => null);
  const targetType  = (form?.get('target_type') || '').toString();
  const targetId    = (form?.get('target_id') || '').toString();
  const reactionType = (form?.get('reaction_type') || 'heart').toString();
  const redirectTo  = (form?.get('redirect_to') || '/').toString();

  if (!VALID_TYPES.includes(targetType) || !VALID_REACTS.includes(reactionType) || !targetId) {
    return c.redirect(redirectTo);
  }

  // Toggle: delete if exists, insert if not
  const { data: existing } = await db.from('reactions')
    .select('id')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();

  if (existing) {
    await db.from('reactions').delete().eq('id', existing.id).catch(() => {});
  } else {
    await db.from('reactions').insert({
      user_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reaction_type: reactionType
    }).catch(() => {});
  }

  return c.redirect(redirectTo);
});

export default reactions;
