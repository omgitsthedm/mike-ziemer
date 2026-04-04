-- =============================================================
-- DECKSPACE — Database Schema
-- Target: Supabase (PostgreSQL)
-- =============================================================
-- Run this in your Supabase SQL editor or via psql.
-- Extensions used: uuid-ossp, pgcrypto
-- =============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =============================================================
-- SAILINGS
-- Represents a single cruise voyage. Everything is scoped to one.
-- =============================================================
create table if not exists sailings (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,                          -- e.g. "Caribbean Jan 2025"
  ship_name     text not null,
  departs_at    timestamptz not null,
  returns_at    timestamptz not null,
  access_opens_at  timestamptz not null,                -- when pre-cruise activation begins
  access_closes_at timestamptz not null,                -- when archive/read-only starts
  archive_ends_at  timestamptz not null,                -- when everything locks
  status        text not null default 'upcoming'        -- upcoming | active | archive | closed
                  check (status in ('upcoming','active','archive','closed')),
  created_at    timestamptz not null default now()
);

-- =============================================================
-- USERS
-- One account per passenger per sailing.
-- =============================================================
create table if not exists users (
  id                  uuid primary key default uuid_generate_v4(),
  sailing_id          uuid not null references sailings(id) on delete cascade,
  username            text not null,
  display_name        text not null,
  email               text,
  password_hash       text,                             -- bcrypt via pgcrypto
  account_status      text not null default 'active'
                        check (account_status in ('active','suspended','banned')),
  activation_status   text not null default 'pending'
                        check (activation_status in ('pending','active','expired')),
  role                text not null default 'passenger'
                        check (role in ('passenger','moderator','admin')),
  access_window_start timestamptz,
  access_window_end   timestamptz,
  last_active_at      timestamptz,
  created_at          timestamptz not null default now(),

  unique (sailing_id, username),
  unique (sailing_id, email)
);

create index if not exists users_sailing_idx on users(sailing_id);
create index if not exists users_username_idx on users(username);
create index if not exists users_last_active_idx on users(last_active_at desc);

-- =============================================================
-- SESSIONS
-- Lightweight server-side session tokens.
-- =============================================================
create table if not exists sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,                     -- sha256 of the raw token
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  ip_address  text,
  user_agent  text
);

create index if not exists sessions_user_idx on sessions(user_id);
create index if not exists sessions_token_idx on sessions(token_hash);
-- Automatic cleanup of expired sessions
create index if not exists sessions_expires_idx on sessions(expires_at);

-- =============================================================
-- PROFILES
-- The public identity layer. One per user.
-- =============================================================
create table if not exists profiles (
  user_id             uuid primary key references users(id) on delete cascade,
  avatar_url          text,                             -- R2 CDN URL
  avatar_thumb_url    text,                             -- 100x100 thumb
  banner_url          text,                             -- R2 CDN URL
  about_me            text,
  hometown            text,
  interests           text,
  vibe_tags           text[],                           -- e.g. {karaoke, trivia, chill}
  who_id_like_to_meet text,
  social_intent       text,                             -- free-form cruise vibe
  theme_id            text default 'classic',           -- preset theme identifier
  song_title          text,
  song_artist         text,
  song_url            text,                             -- tap-to-play only
  comments_enabled    boolean not null default true,
  guestbook_enabled   boolean not null default true,
  profile_views       integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- =============================================================
-- FRIENDSHIPS
-- Bidirectional social connections.
-- =============================================================
create table if not exists friendships (
  id            uuid primary key default uuid_generate_v4(),
  requester_id  uuid not null references users(id) on delete cascade,
  addressee_id  uuid not null references users(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending','accepted','declined','blocked')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,

  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index if not exists friendships_requester_idx on friendships(requester_id);
create index if not exists friendships_addressee_idx on friendships(addressee_id);
create index if not exists friendships_status_idx on friendships(status);

-- Helper view: accepted friendships from either direction
create or replace view accepted_friendships as
  select
    f.id,
    f.requester_id as user_a_id,
    f.addressee_id as user_b_id,
    f.created_at,
    f.responded_at
  from friendships f
  where f.status = 'accepted';

-- =============================================================
-- TOP FRIENDS
-- MySpace-style ordered top friends list (up to 8).
-- =============================================================
create table if not exists top_friends (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  friend_user_id  uuid not null references users(id) on delete cascade,
  position        smallint not null check (position between 1 and 8),
  created_at      timestamptz not null default now(),

  unique (user_id, friend_user_id),
  unique (user_id, position)
);

-- =============================================================
-- WALL POSTS
-- Public notes left on a profile page.
-- =============================================================
create table if not exists wall_posts (
  id                uuid primary key default uuid_generate_v4(),
  profile_user_id   uuid not null references users(id) on delete cascade,
  author_user_id    uuid not null references users(id) on delete cascade,
  body              text not null check (length(body) between 1 and 2000),
  moderation_status text not null default 'visible'
                      check (moderation_status in ('visible','hidden','removed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists wall_posts_profile_idx on wall_posts(profile_user_id, created_at desc);
create index if not exists wall_posts_author_idx  on wall_posts(author_user_id);

-- =============================================================
-- GUESTBOOK ENTRIES
-- Lightweight public "thanks for the add" style notes.
-- =============================================================
create table if not exists guestbook_entries (
  id                uuid primary key default uuid_generate_v4(),
  profile_user_id   uuid not null references users(id) on delete cascade,
  author_user_id    uuid not null references users(id) on delete cascade,
  body              text not null check (length(body) between 1 and 500),
  moderation_status text not null default 'visible'
                      check (moderation_status in ('visible','hidden','removed')),
  created_at        timestamptz not null default now()
);

create index if not exists guestbook_profile_idx on guestbook_entries(profile_user_id, created_at desc);

-- =============================================================
-- EVENTS
-- User-created and official onboard plans.
-- =============================================================
create table if not exists events (
  id                uuid primary key default uuid_generate_v4(),
  sailing_id        uuid not null references sailings(id) on delete cascade,
  creator_user_id   uuid not null references users(id) on delete cascade,
  event_type        text not null default 'user'
                      check (event_type in ('user','official')),
  category          text,                              -- karaoke | trivia | dinner | deck | excursion | drinks | poker | theme | other
  title             text not null check (length(title) between 1 and 200),
  description       text check (length(description) <= 5000),
  location          text check (length(location) <= 200),
  start_at          timestamptz not null,
  end_at            timestamptz,
  visibility        text not null default 'public'
                      check (visibility in ('public','private')),
  cover_image_url   text,
  rsvp_count        integer not null default 0,
  moderation_status text not null default 'visible'
                      check (moderation_status in ('visible','hidden','removed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists events_sailing_idx    on events(sailing_id, start_at asc);
create index if not exists events_creator_idx    on events(creator_user_id);
create index if not exists events_start_idx      on events(start_at asc);
create index if not exists events_type_idx       on events(event_type);

-- =============================================================
-- EVENT RSVPs
-- =============================================================
create table if not exists event_rsvps (
  id          uuid primary key default uuid_generate_v4(),
  event_id    uuid not null references events(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  status      text not null default 'going'
                check (status in ('going','interested','not_going')),
  created_at  timestamptz not null default now(),

  unique (event_id, user_id)
);

create index if not exists event_rsvps_event_idx on event_rsvps(event_id, status);
create index if not exists event_rsvps_user_idx  on event_rsvps(user_id);

-- Trigger: keep events.rsvp_count in sync
create or replace function sync_rsvp_count() returns trigger language plpgsql as $$
begin
  update events
  set rsvp_count = (
    select count(*) from event_rsvps
    where event_id = coalesce(new.event_id, old.event_id)
    and status = 'going'
  )
  where id = coalesce(new.event_id, old.event_id);
  return coalesce(new, old);
end;
$$;

create trigger event_rsvps_sync_count
  after insert or update or delete on event_rsvps
  for each row execute function sync_rsvp_count();

-- =============================================================
-- EVENT COMMENTS
-- =============================================================
create table if not exists event_comments (
  id                uuid primary key default uuid_generate_v4(),
  event_id          uuid not null references events(id) on delete cascade,
  author_user_id    uuid not null references users(id) on delete cascade,
  body              text not null check (length(body) between 1 and 1000),
  moderation_status text not null default 'visible'
                      check (moderation_status in ('visible','hidden','removed')),
  created_at        timestamptz not null default now()
);

create index if not exists event_comments_event_idx on event_comments(event_id, created_at desc);

-- =============================================================
-- ALBUMS
-- Simple photo collections.
-- =============================================================
create table if not exists albums (
  id              uuid primary key default uuid_generate_v4(),
  owner_user_id   uuid not null references users(id) on delete cascade,
  title           text not null check (length(title) between 1 and 100),
  description     text check (length(description) <= 500),
  visibility      text not null default 'public'
                    check (visibility in ('public','private')),
  cover_photo_id  uuid,                               -- set after photo creation
  photo_count     integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists albums_owner_idx on albums(owner_user_id);

-- =============================================================
-- PHOTOS
-- Profile and event photos with multi-resolution support.
-- =============================================================
create table if not exists photos (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references users(id) on delete cascade,
  sailing_id        uuid not null references sailings(id) on delete cascade,
  event_id          uuid references events(id) on delete set null,
  album_id          uuid references albums(id) on delete set null,
  storage_key       text not null,                    -- R2 object key (original)
  thumb_key         text,                             -- R2 key for 150px thumb
  medium_key        text,                             -- R2 key for 800px medium
  width             integer,
  height            integer,
  file_size_bytes   integer,
  caption           text check (length(caption) <= 300),
  moderation_status text not null default 'visible'
                      check (moderation_status in ('visible','hidden','removed')),
  created_at        timestamptz not null default now()
);

create index if not exists photos_user_idx    on photos(user_id, created_at desc);
create index if not exists photos_sailing_idx on photos(sailing_id, created_at desc);
create index if not exists photos_event_idx   on photos(event_id, created_at desc);
create index if not exists photos_album_idx   on photos(album_id, created_at desc);

-- FK for album cover
alter table albums add constraint albums_cover_photo_fk
  foreign key (cover_photo_id) references photos(id) on delete set null
  deferrable initially deferred;

-- Trigger: keep albums.photo_count in sync
create or replace function sync_album_photo_count() returns trigger language plpgsql as $$
begin
  if coalesce(new.album_id, old.album_id) is not null then
    update albums
    set photo_count = (
      select count(*) from photos
      where album_id = coalesce(new.album_id, old.album_id)
      and moderation_status = 'visible'
    )
    where id = coalesce(new.album_id, old.album_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger photos_sync_album_count
  after insert or update or delete on photos
  for each row execute function sync_album_photo_count();

-- =============================================================
-- PHOTO COMMENTS
-- =============================================================
create table if not exists photo_comments (
  id                uuid primary key default uuid_generate_v4(),
  photo_id          uuid not null references photos(id) on delete cascade,
  author_user_id    uuid not null references users(id) on delete cascade,
  body              text not null check (length(body) between 1 and 500),
  moderation_status text not null default 'visible'
                      check (moderation_status in ('visible','hidden','removed')),
  created_at        timestamptz not null default now()
);

create index if not exists photo_comments_photo_idx on photo_comments(photo_id, created_at desc);

-- =============================================================
-- NOTIFICATIONS
-- In-app notification center. No realtime dependency.
-- =============================================================
create table if not exists notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id) on delete cascade,
  type        text not null,                          -- friend_request | wall_post | guestbook | event_comment | photo_comment | rsvp | admin_notice | friend_accepted
  object_type text,                                   -- user | wall_post | event | photo | guestbook_entry
  object_id   uuid,
  actor_id    uuid references users(id) on delete set null,
  message     text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx     on notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx   on notifications(user_id, read_at) where read_at is null;

-- =============================================================
-- REPORTS
-- Content moderation reports.
-- =============================================================
create table if not exists reports (
  id                uuid primary key default uuid_generate_v4(),
  reporter_user_id  uuid not null references users(id) on delete cascade,
  target_type       text not null
                      check (target_type in ('user','wall_post','guestbook_entry','event','event_comment','photo','photo_comment')),
  target_id         uuid not null,
  reason            text not null check (length(reason) between 1 and 1000),
  status            text not null default 'pending'
                      check (status in ('pending','reviewed','resolved','dismissed')),
  created_at        timestamptz not null default now()
);

create index if not exists reports_status_idx on reports(status, created_at asc);
create index if not exists reports_reporter_idx on reports(reporter_user_id);

-- =============================================================
-- MODERATION ACTIONS
-- Log of every moderator action.
-- =============================================================
create table if not exists moderation_actions (
  id            uuid primary key default uuid_generate_v4(),
  admin_user_id uuid not null references users(id) on delete cascade,
  action_type   text not null,                        -- remove | hide | restore | suspend | unsuspend | ban | dismiss_report
  target_type   text not null,
  target_id     uuid not null,
  report_id     uuid references reports(id) on delete set null,
  notes         text check (length(notes) <= 2000),
  created_at    timestamptz not null default now()
);

create index if not exists mod_actions_admin_idx  on moderation_actions(admin_user_id);
create index if not exists mod_actions_target_idx on moderation_actions(target_type, target_id);

-- =============================================================
-- AUDIT LOGS
-- Immutable event log for security-sensitive actions.
-- =============================================================
create table if not exists audit_logs (
  id              uuid primary key default uuid_generate_v4(),
  actor_user_id   uuid references users(id) on delete set null,
  action_type     text not null,
  object_type     text,
  object_id       uuid,
  metadata        jsonb,
  ip_address      text,
  created_at      timestamptz not null default now()
);

create index if not exists audit_logs_actor_idx  on audit_logs(actor_user_id);
create index if not exists audit_logs_action_idx on audit_logs(action_type);
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================
-- Enable RLS on all tables (anon key cannot bypass)
alter table sailings          enable row level security;
alter table users             enable row level security;
alter table sessions          enable row level security;
alter table profiles          enable row level security;
alter table friendships       enable row level security;
alter table top_friends       enable row level security;
alter table wall_posts        enable row level security;
alter table guestbook_entries enable row level security;
alter table events            enable row level security;
alter table event_rsvps       enable row level security;
alter table event_comments    enable row level security;
alter table albums            enable row level security;
alter table photos            enable row level security;
alter table photo_comments    enable row level security;
alter table notifications     enable row level security;
alter table reports           enable row level security;
alter table moderation_actions enable row level security;
alter table audit_logs        enable row level security;

-- Service role bypasses RLS entirely — all backend ops use service key.
-- The anon key is never exposed; all requests go through our Worker.

-- =============================================================
-- SEED: Default theme presets (stored in code but defined here for ref)
-- =============================================================
-- Themes are applied via CSS class on the profile container:
--   classic     — OG MySpace blue/orange (default)
--   ocean       — Deep navy + teal
--   sunset      — Warm amber + coral
--   night       — Dark with purple accents
--   retro-pink  — Hot pink + black (scene kid era)
-- =============================================================
