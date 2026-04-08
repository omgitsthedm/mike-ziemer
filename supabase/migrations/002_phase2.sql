-- =============================================================
-- Deckspace Phase 2 — DB Migration
-- Run this in Supabase SQL Editor (deckspace schema)
-- =============================================================

-- ------------------------------------------------------------
-- 1. Profile status/mood line
-- ------------------------------------------------------------
ALTER TABLE deckspace.profiles
  ADD COLUMN IF NOT EXISTS status_text TEXT CHECK (length(status_text) <= 120);

-- ------------------------------------------------------------
-- 2. Direct messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deckspace.messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sailing_id      UUID        NOT NULL REFERENCES deckspace.sailings(id) ON DELETE CASCADE,
  from_user_id    UUID        NOT NULL REFERENCES deckspace.users(id) ON DELETE CASCADE,
  to_user_id      UUID        NOT NULL REFERENCES deckspace.users(id) ON DELETE CASCADE,
  body            TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  moderation_status TEXT      NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible','removed'))
);

CREATE INDEX IF NOT EXISTS messages_to_user_idx    ON deckspace.messages(to_user_id,   created_at DESC);
CREATE INDEX IF NOT EXISTS messages_from_user_idx  ON deckspace.messages(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_thread_idx     ON deckspace.messages(sailing_id, LEAST(from_user_id, to_user_id), GREATEST(from_user_id, to_user_id), created_at DESC);

-- ------------------------------------------------------------
-- 3. Reactions (heart / star / wave on wall posts, photos, comments)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deckspace.reactions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES deckspace.users(id) ON DELETE CASCADE,
  target_type   TEXT        NOT NULL CHECK (target_type IN ('wall_post','photo','event_comment','photo_comment')),
  target_id     UUID        NOT NULL,
  reaction_type TEXT        NOT NULL DEFAULT 'heart' CHECK (reaction_type IN ('heart','star','wave')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS reactions_target_idx ON deckspace.reactions(target_type, target_id);

-- Helper view: reaction counts per target
CREATE OR REPLACE VIEW deckspace.reaction_counts AS
  SELECT target_type, target_id,
    COUNT(*) FILTER (WHERE reaction_type = 'heart') AS hearts,
    COUNT(*) FILTER (WHERE reaction_type = 'star')  AS stars,
    COUNT(*) FILTER (WHERE reaction_type = 'wave')  AS waves,
    COUNT(*)                                         AS total
  FROM deckspace.reactions
  GROUP BY target_type, target_id;

-- ------------------------------------------------------------
-- 4. Voyage / itinerary days
--    (admins can populate via /admin/voyage or direct SQL)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deckspace.voyage_days (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sailing_id    UUID        NOT NULL REFERENCES deckspace.sailings(id) ON DELETE CASCADE,
  day_date      DATE        NOT NULL,
  port_name     TEXT        NOT NULL DEFAULT 'At Sea',
  day_type      TEXT        NOT NULL DEFAULT 'sea' CHECK (day_type IN ('embarkation','sea','port','disembarkation')),
  arrive_time   TIME,
  depart_time   TIME,
  notes         TEXT CHECK (length(notes) <= 500),
  sort_order    INT         NOT NULL DEFAULT 0,
  UNIQUE (sailing_id, day_date)
);

CREATE INDEX IF NOT EXISTS voyage_days_sailing_idx ON deckspace.voyage_days(sailing_id, day_date);

-- ------------------------------------------------------------
-- 5. Grant access to service role (already has full access via RLS bypass)
-- ------------------------------------------------------------
-- No additional grants needed — Worker uses service role key which bypasses RLS.
