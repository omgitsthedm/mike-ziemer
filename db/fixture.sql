-- =============================================================
-- DECKSPACE — Profile QA Fixture
-- =============================================================
-- Purpose: Populate a local/staging Supabase instance with
--   enough data to render a "golden" profile page for visual
--   comparison against OG MySpace reference screenshots.
--
-- Usage:
--   1. Run schema.sql first
--   2. Set SAILING_ID in your .dev.vars to the UUID below
--   3. Run this file: psql <connection_string> -f db/fixture.sql
--
-- All UUIDs are fixed so the fixture is idempotent.
-- =============================================================

-- -------------------------------------------------------
-- SAILING
-- -------------------------------------------------------
insert into sailings (id, name, ship_name, departs_at, returns_at,
  access_opens_at, access_closes_at, archive_ends_at, status)
values (
  'a1000000-0000-0000-0000-000000000001',
  'Caribbean Jan 2025',
  'MS Deckspace',
  '2025-01-12 16:00:00+00',
  '2025-01-19 08:00:00+00',
  '2025-01-05 00:00:00+00',
  '2025-01-19 08:00:00+00',
  '2025-01-26 23:59:00+00',
  'active'
)
on conflict (id) do nothing;

-- -------------------------------------------------------
-- USERS (8 people = full Top 8)
-- -------------------------------------------------------

-- Primary profile subject — the one we're QA'ing
insert into users (id, sailing_id, username, display_name, email,
  password_hash, account_status, activation_status, role,
  last_active_at, created_at)
values (
  'b1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'jessicakay',
  'Jessica Kay',
  'jessica@example.com',
  'pbkdf2:000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000',
  'active', 'active', 'passenger',
  now() - interval '2 minutes',
  now() - interval '5 days'
) on conflict (id) do nothing;

-- 7 friends to fill Top 8
insert into users (id, sailing_id, username, display_name,
  password_hash, account_status, activation_status, role, last_active_at, created_at)
values
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'tomanders0n', 'Tom Anderson', 'pbkdf2:0:0', 'active', 'active', 'passenger', now() - interval '1 hour', now() - interval '5 days'),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'brianh', 'Brian H.', 'pbkdf2:0:0', 'active', 'active', 'passenger', now() - interval '3 hours', now() - interval '4 days'),
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'sarahb', 'Sarah B.', 'pbkdf2:0:0', 'active', 'active', 'passenger', now() - interval '4 hours', now() - interval '4 days'),
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'mikejones', 'Mike Jones', 'pbkdf2:0:0', 'active', 'active', 'passenger', now() - interval '6 hours', now() - interval '3 days'),
  ('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', 'amandal', 'Amanda L.', 'pbkdf2:0:0', 'active', 'active', 'passenger', now() - interval '8 hours', now() - interval '3 days'),
  ('b1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000001', 'chrisrock7', 'Chris R.', 'pbkdf2:0:0', 'active', 'active', 'passenger', now() - interval '12 hours', now() - interval '2 days'),
  ('b1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000001', 'dannyb', 'Danny B.', 'pbkdf2:0:0', 'active', 'active', 'passenger', now() - interval '1 day', now() - interval '2 days')
on conflict (id) do nothing;

-- -------------------------------------------------------
-- PROFILES
-- -------------------------------------------------------

insert into profiles (user_id, about_me, hometown, interests,
  vibe_tags, who_id_like_to_meet, social_intent,
  song_title, song_artist, theme_id, created_at, updated_at)
values (
  'b1000000-0000-0000-0000-000000000001',
  'Hey! I''m Jessica from Austin, TX. First big cruise ever and I am SO ready. Looking to make some new friends, hit every karaoke night, and eat an embarrassing amount of food at the buffet.

I''m a kindergarten teacher IRL so I''m basically already used to managing chaos. This should be easy.

Find me at the pool bar or the trivia table. I''m easy to spot — I''m the one who already knows all the words.',
  'Austin, TX',
  'karaoke, trivia, travel, reading, cooking, bad puns',
  '{karaoke,trivia,nightlife,"pool days","foodie"}',
  'Fellow karaoke people who aren''t afraid to take the mic. Also: anyone who wants to do the midnight buffet run without judgment.',
  'Here for all of it — nightlife, sunshine, new friends, and whatever weird stuff is on the itinerary.',
  'Total Eclipse of the Heart',
  'Bonnie Tyler',
  'classic',
  now() - interval '4 days',
  now() - interval '2 hours'
) on conflict (user_id) do nothing;

-- Minimal profiles for the 7 friends
insert into profiles (user_id, about_me, hometown, vibe_tags, theme_id, created_at, updated_at)
values
  ('b1000000-0000-0000-0000-000000000002', 'OG Deckspace Tom. Everyone starts here.', 'Santa Monica, CA', '{chill,"just vibing"}', 'classic', now() - interval '5 days', now() - interval '5 days'),
  ('b1000000-0000-0000-0000-000000000003', 'Here for the trivia glory.', 'Chicago, IL', '{trivia,poker}', 'classic', now() - interval '4 days', now() - interval '4 days'),
  ('b1000000-0000-0000-0000-000000000004', 'Deck chairs and frozen drinks only.', 'Miami, FL', '{"pool days",cocktails}', 'ocean', now() - interval '4 days', now() - interval '4 days'),
  ('b1000000-0000-0000-0000-000000000005', 'Looking for a trivia team. I''m good at sports and bad at everything else.', 'Denver, CO', '{trivia,sports}', 'classic', now() - interval '3 days', now() - interval '3 days'),
  ('b1000000-0000-0000-0000-000000000006', 'Karaoke queen. Fight me.', 'Nashville, TN', '{karaoke,nightlife}', 'retro-pink', now() - interval '3 days', now() - interval '3 days'),
  ('b1000000-0000-0000-0000-000000000007', 'First cruise. Send help. Or rum.', 'Portland, OR', '{"first cruise",rum}', 'classic', now() - interval '2 days', now() - interval '2 days'),
  ('b1000000-0000-0000-0000-000000000008', 'Professional napper, amateur shuffleboard champion.', 'Phoenix, AZ', '{shuffleboard,napping}', 'sunset', now() - interval '2 days', now() - interval '2 days')
on conflict (user_id) do nothing;

-- -------------------------------------------------------
-- FRIENDSHIPS (all 7 accepted with jessica)
-- -------------------------------------------------------
insert into friendships (id, requester_id, addressee_id, status, created_at, responded_at)
values
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'accepted', now() - interval '4 days', now() - interval '4 days'),
  ('c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 'accepted', now() - interval '3 days', now() - interval '3 days'),
  ('c1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'accepted', now() - interval '3 days', now() - interval '3 days'),
  ('c1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005', 'accepted', now() - interval '2 days', now() - interval '2 days'),
  ('c1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000001', 'accepted', now() - interval '2 days', now() - interval '2 days'),
  ('c1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000007', 'accepted', now() - interval '1 day',  now() - interval '1 day'),
  ('c1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000008', 'b1000000-0000-0000-0000-000000000001', 'accepted', now() - interval '12 hours', now() - interval '12 hours')
on conflict (id) do nothing;

-- -------------------------------------------------------
-- TOP FRIENDS (jessica's Top 8)
-- -------------------------------------------------------
insert into top_friends (user_id, friend_user_id, position, created_at)
values
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 1, now() - interval '4 days'),
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000006', 2, now() - interval '2 days'),
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 3, now() - interval '3 days'),
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 4, now() - interval '3 days'),
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005', 5, now() - interval '2 days'),
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000007', 6, now() - interval '1 day'),
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000008', 7, now() - interval '12 hours'),
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 8, now() - interval '3 days')
on conflict (user_id, position) do nothing;

-- -------------------------------------------------------
-- WALL POSTS (5 posts on jessica's wall)
-- -------------------------------------------------------
insert into wall_posts (id, profile_user_id, author_user_id, body, moderation_status, created_at)
values
  ('d1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002',
   'Jess!! Finally found you on here. Saved you a seat at trivia tonight at 8pm by the Lido deck. Don''t be late!!',
   'visible', now() - interval '6 hours'),
  ('d1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000006',
   'omg your karaoke song choice is everything. Total Eclipse?? ICONIC. I called dibs on Heart of Glass.',
   'visible', now() - interval '8 hours'),
  ('d1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000004',
   'Pool bar at 4pm? I found the good chairs by the waterfall. The ones with the footrests.',
   'visible', now() - interval '10 hours'),
  ('d1000000-0000-0000-0000-000000000004',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000005',
   'Welcome to Deckspace! I saw you at dinner last night and was too nervous to say hi lol. Saved.',
   'visible', now() - interval '1 day'),
  ('d1000000-0000-0000-0000-000000000005',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003',
   'Trivia team name suggestions: "Seas the Day", "Ship Happens", or "We Thought This Was an Open Bar". Vote in comments.',
   'visible', now() - interval '1 day 4 hours')
on conflict (id) do nothing;

-- -------------------------------------------------------
-- GUESTBOOK ENTRIES (3 entries)
-- -------------------------------------------------------
insert into guestbook_entries (id, profile_user_id, author_user_id, body, moderation_status, created_at)
values
  ('e1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000007',
   'Thanks for the add! First cruise and already found good people :) See you at sail-away drinks!',
   'visible', now() - interval '1 day'),
  ('e1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000008',
   'you seem awesome. hope we get to hang at some point. shuffleboard is more fun than it sounds trust me',
   'visible', now() - interval '18 hours'),
  ('e1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002',
   'great to meet you at dinner! see you on here and in real life lol',
   'visible', now() - interval '3 days')
on conflict (id) do nothing;

-- -------------------------------------------------------
-- EVENTS
-- -------------------------------------------------------
insert into events (id, sailing_id, creator_user_id, event_type, category,
  title, description, location, start_at, end_at, visibility,
  moderation_status, rsvp_count, created_at)
values
  -- Tonight's karaoke
  ('f1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000006',
   'user', 'karaoke',
   'Karaoke Night at the Sky Lounge',
   'Come sing your heart out. No talent required. Liquid courage encouraged. I have the song list ready and I AM NOT sharing it because you''ll just take all the good ones. See you there!',
   'Sky Lounge, Deck 14',
   (now() + interval '3 hours')::timestamptz,
   (now() + interval '5 hours')::timestamptz,
   'public', 'visible', 14,
   now() - interval '2 days'),

  -- Tomorrow trivia
  ('f1000000-0000-0000-0000-000000000002',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002',
   'user', 'trivia',
   'Trivia Night — Team "Ship Happens"',
   'Forming a 6-person trivia team for the 8pm game. Looking for 2 more people. Specialties needed: sports, science, anything that is not 90s pop music because we have that covered (aggressively covered).',
   'Lido Bar, Deck 9',
   (now() + interval '1 day 2 hours')::timestamptz,
   (now() + interval '1 day 3 hours 30 minutes')::timestamptz,
   'public', 'visible', 6,
   now() - interval '1 day'),

  -- Sail-away drinks (official)
  ('f1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'official', 'drinks',
   'Sail-Away Deck Party',
   'Official sail-away celebration on the pool deck as we leave port. DJ, drinks, and whatever happens when 3,000 people realize they are stuck together for a week.',
   'Pool Deck, Deck 11',
   (now() - interval '4 hours')::timestamptz,
   (now() - interval '2 hours')::timestamptz,
   'public', 'visible', 89,
   now() - interval '3 days')
on conflict (id) do nothing;

-- -------------------------------------------------------
-- EVENT RSVPs (jessica going to karaoke and trivia)
-- -------------------------------------------------------
insert into event_rsvps (event_id, user_id, status, created_at)
values
  ('f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'going',      now() - interval '2 hours'),
  ('f1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'interested', now() - interval '1 hour'),
  ('f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 'going',      now() - interval '3 hours'),
  ('f1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 'going',      now() - interval '4 hours'),
  ('f1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005', 'going',      now() - interval '5 hours')
on conflict (event_id, user_id) do nothing;

-- -------------------------------------------------------
-- NOTIFICATIONS (for jessica)
-- -------------------------------------------------------
insert into notifications (id, user_id, type, object_type, object_id,
  actor_id, message, read_at, created_at)
values
  ('g1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'wall_post', 'wall_post', 'd1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002',
   'posted on your wall.', null, now() - interval '6 hours'),
  ('g1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000001',
   'friend_request', 'user', 'b1000000-0000-0000-0000-000000000007',
   'b1000000-0000-0000-0000-000000000007',
   'wants to be your friend.', (now() - interval '1 day'), now() - interval '1 day'),
  ('g1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001',
   'guestbook', 'guestbook_entry', 'e1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000007',
   'signed your guestbook.', null, now() - interval '1 day')
on conflict (id) do nothing;

-- =============================================================
-- FIXTURE COMPLETE
--
-- Jessica Kay's profile (/profile/jessicakay) should now show:
--   - Display name, About Me, Who I'd Like to Meet blurbs
--   - Hometown: Austin, TX
--   - Profile song: Total Eclipse of the Heart
--   - Vibe tags: karaoke, trivia, nightlife, pool days, foodie
--   - Top 8 friend grid (7 friends populated)
--   - 5 wall posts with different authors
--   - 3 guestbook entries
--   - 2 unread notifications (wall post + guestbook)
--
-- Events page should show:
--   - Karaoke tonight (14 going)
--   - Trivia tomorrow (6 going)
--   - Sail-away party (past, 89 went)
--
-- Compare rendered profile at /profile/jessicakay against:
--   Reference: https://web.archive.org/web/2005*/http://www.myspace.com/
--   (use Wayback Machine, 2004–2007 range)
--
-- QA checklist is in DESIGN.md.
-- =============================================================
