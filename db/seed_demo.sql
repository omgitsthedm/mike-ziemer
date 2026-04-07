-- =============================================================
-- DECKSPACE — Demo Seed: Shattered Shores Cruise
-- Paste this into Supabase Dashboard → SQL Editor → Run
-- =============================================================
-- Creates:
--   • 1 crew/official account (for hosting official events)
--   • 10 demo passenger accounts (display-only; no passwords)
--   • Demo profiles for all accounts
--   • 32 official events across 4 days (April 7–10, 2026)
--   • Wall posts between demo passengers
--   • Friendship connections
--
-- Safe to re-run: uses ON CONFLICT DO NOTHING for users/profiles,
-- deletes + re-inserts official events on each run.
-- =============================================================

SET search_path TO deckspace, public;

DO $$
DECLARE
  sail_id    UUID;
  crew_id    UUID;
  uid_1      UUID;  -- kaitlyn_darkwater
  uid_2      UUID;  -- sidepartsurvivor
  uid_3      UUID;  -- lowercaseforever
  uid_4      UUID;  -- bleedingheartblake
  uid_5      UUID;  -- portsideghost
  uid_6      UUID;  -- cringe_archivist
  uid_7      UUID;  -- stairwellacoustic
  uid_8      UUID;  -- top8disaster
  uid_9      UUID;  -- missedcallmorgn
  uid_10     UUID;  -- awaymessageguru
BEGIN

  -- -------------------------------------------------------
  -- 0. Get the sailing
  -- -------------------------------------------------------
  SELECT id INTO sail_id FROM sailings LIMIT 1;
  IF sail_id IS NULL THEN
    RAISE EXCEPTION 'No sailing found. Create a sailing record first.';
  END IF;

  -- -------------------------------------------------------
  -- 1. Crew / official host account
  -- -------------------------------------------------------
  INSERT INTO users (sailing_id, username, display_name, account_status, activation_status, role)
  VALUES (sail_id, 'shattered_shores_crew', 'Shattered Shores Crew', 'active', 'active', 'moderator')
  ON CONFLICT (sailing_id, username) DO NOTHING;
  SELECT id INTO crew_id FROM users WHERE sailing_id = sail_id AND username = 'shattered_shores_crew';

  INSERT INTO profiles (user_id, about_me, social_intent)
  VALUES (crew_id, 'Your official cruise host account. All announcements, schedules, and chaos coordination go through here.', 'Herding cats on a ship')
  ON CONFLICT (user_id) DO NOTHING;

  -- -------------------------------------------------------
  -- 2. Demo passenger accounts
  -- -------------------------------------------------------
  INSERT INTO users (sailing_id, username, display_name, account_status, activation_status, role, created_at) VALUES
    (sail_id, 'kaitlyn_darkwater',    'kaitlyn darkwater',   'active', 'active', 'passenger', now() - interval '2 days'),
    (sail_id, 'sidepartsurvivor',     'Jesse Calvert',       'active', 'active', 'passenger', now() - interval '2 days'),
    (sail_id, 'lowercaseforever',     'maya (lowercase)',    'active', 'active', 'passenger', now() - interval '2 days'),
    (sail_id, 'bleedingheartblake',   'Blake Harmon',        'active', 'active', 'passenger', now() - interval '1 day'),
    (sail_id, 'portsideghost',        'jamie',               'active', 'active', 'passenger', now() - interval '1 day'),
    (sail_id, 'cringe_archivist',     'Devon Mitchell',      'active', 'active', 'passenger', now() - interval '1 day'),
    (sail_id, 'stairwellacoustic',    'Alex (stairwell)',    'active', 'active', 'passenger', now() - interval '3 hours'),
    (sail_id, 'top8disaster',         'Sam Top8',            'active', 'active', 'passenger', now() - interval '3 hours'),
    (sail_id, 'missedcallmorgn',      'Morgan',              'active', 'active', 'passenger', now() - interval '1 hour'),
    (sail_id, 'awaymessageguru',      'taylor :: away',      'active', 'active', 'passenger', now() - interval '30 minutes')
  ON CONFLICT (sailing_id, username) DO NOTHING;

  SELECT id INTO uid_1  FROM users WHERE sailing_id = sail_id AND username = 'kaitlyn_darkwater';
  SELECT id INTO uid_2  FROM users WHERE sailing_id = sail_id AND username = 'sidepartsurvivor';
  SELECT id INTO uid_3  FROM users WHERE sailing_id = sail_id AND username = 'lowercaseforever';
  SELECT id INTO uid_4  FROM users WHERE sailing_id = sail_id AND username = 'bleedingheartblake';
  SELECT id INTO uid_5  FROM users WHERE sailing_id = sail_id AND username = 'portsideghost';
  SELECT id INTO uid_6  FROM users WHERE sailing_id = sail_id AND username = 'cringe_archivist';
  SELECT id INTO uid_7  FROM users WHERE sailing_id = sail_id AND username = 'stairwellacoustic';
  SELECT id INTO uid_8  FROM users WHERE sailing_id = sail_id AND username = 'top8disaster';
  SELECT id INTO uid_9  FROM users WHERE sailing_id = sail_id AND username = 'missedcallmorgn';
  SELECT id INTO uid_10 FROM users WHERE sailing_id = sail_id AND username = 'awaymessageguru';

  -- -------------------------------------------------------
  -- 3. Demo profiles
  -- -------------------------------------------------------
  INSERT INTO profiles (user_id, about_me, hometown, who_id_like_to_meet, social_intent, vibe_tags) VALUES
    (uid_1,  'here for the music and whatever''s honest. probably on the outer deck.',
             'Portland, OR', 'people who still have strong opinions about album art', 'late nights, real conversations', ARRAY['emo','acoustic','ocean','overthinking']),
    (uid_2,  'survived the side part era. still processing it. hair game: wind-resistant.',
             'Austin, TX', 'trivia partners and anyone who has the acoustic set rumor', 'trivia, social chaos', ARRAY['trivia','scene','karaoke','snacks']),
    (uid_3,  'lowercase commitment is a lifestyle not a phase. do not capitalize my name.',
             'brooklyn', 'people who understand that everything means something', 'vibe quietly, connect loudly', ARRAY['lowercase','poetry','post-rock','silence']),
    (uid_4,  'brought three black outfits and a journal. very normal amount of feelings.',
             'Chicago, IL', 'anyone who''s been to the missed call booth more than once', 'music, ocean air, closure', ARRAY['emo','creative','journal','nightlife']),
    (uid_5,  'ghost mode but make it social. yes i''m here, no i''m not announcing it.',
             'Seattle, WA', 'the kind of people you find at 3am on a top deck', 'quiet chaos', ARRAY['introvert','deck','midnight','ocean']),
    (uid_6,  'i have screenshots of things that should not have existed. archivist mode.',
             'Los Angeles, CA', 'anyone who had a neopets page and isn''t over it', 'documentation and mild embarrassment', ARRAY['archive','cringe','nostalgia','humor']),
    (uid_7,  'will play an acoustic set in literally any stairwell. no set list. no apologies.',
             'Nashville, TN', 'people who want to hear a song at an inappropriate time', 'spontaneous sets and good acoustics', ARRAY['acoustic','guitar','stairwell','folk']),
    (uid_8,  'my top 8 has been in crisis since 2007 and nothing has changed.',
             'Denver, CO', 'anyone who takes top 8 seriously enough to feel betrayed by it', 'friendship dramatics', ARRAY['top8','social','drama','karaoke']),
    (uid_9,  'left three messages already. working on the fourth. no i will not explain.',
             'Miami, FL', 'whoever is running missed call confessional, we need to talk', 'confessing things to inanimate phones', ARRAY['confessional','feelings','ocean','phone']),
    (uid_10, 'away message: crafting this bio. back never.',
             'Minneapolis, MN', 'people who still think away messages are an art form', 'absence as communication', ARRAY['away','passive','aesthetic','nostalgia'])
  ON CONFLICT (user_id) DO NOTHING;

  -- -------------------------------------------------------
  -- 4. Official events — clear & re-seed
  -- -------------------------------------------------------
  DELETE FROM events WHERE sailing_id = sail_id AND event_type = 'official';

  INSERT INTO events (sailing_id, creator_user_id, event_type, category, title, description, location, start_at, visibility, moderation_status, rsvp_count) VALUES

  -- DAY 1: April 7, 2026 — Embarkation
  (sail_id, crew_id, 'official', 'social',
    'Port Check-In & Personal Lore Intake',
    'Board the ship, get your wristband, and quietly decide whether you''re here for closure, chaos, or both.',
    'Terminal Entrance', '2026-04-07 17:00:00+00', 'public', 'visible', 47),

  (sail_id, crew_id, 'official', 'social',
    'Cabin Key Pickup + Mirror Check Spiral',
    'First official moment to stare at yourself in terrible lighting and think, "interesting."',
    'Cabin Decks', '2026-04-07 19:00:00+00', 'public', 'visible', 89),

  (sail_id, crew_id, 'official', 'social',
    'Welcome Aboard: Add Me or Don''t Mixer',
    'A low-stakes social mixer for making friends, avoiding eye contact, and deciding who seems emotionally unsafe in an exciting way.',
    'Top 8 Lounge', '2026-04-07 20:30:00+00', 'public', 'visible', 134),

  (sail_id, crew_id, 'official', 'other',
    'Safety Drill But Make It Dramatic',
    'Yes, this is mandatory. Try not to make it your whole personality.',
    'Main Deck', '2026-04-07 22:00:00+00', 'public', 'visible', 312),

  (sail_id, crew_id, 'official', 'karaoke',
    'Sail Away Set: Sad Songs, Open Water',
    'The ship leaves port. The band starts. Everyone pretends they are in a music video for at least six minutes.',
    'Pool Stage', '2026-04-07 23:30:00+00', 'public', 'visible', 201),

  (sail_id, crew_id, 'official', 'social',
    'Default Profile Picture Crisis Center',
    'Take the worst possible flash photo of yourself on purpose. Choose one image to emotionally represent you for the rest of the cruise.',
    'Photo Booth Lounge', '2026-04-08 01:00:00+00', 'public', 'visible', 98),

  (sail_id, crew_id, 'official', 'other',
    'Missed Call Confessional Opens',
    'Pick up the phone. Hear the prompt. Leave the message you should probably keep to yourself.',
    'Offline Deck Phone Booths', '2026-04-08 02:30:00+00', 'public', 'visible', 77),

  (sail_id, crew_id, 'official', 'deck',
    'Late Night Deck Drift',
    'No official programming. Just wind, salt air, side conversations, and suspiciously honest eye contact.',
    'Outer Deck', '2026-04-08 03:45:00+00', 'public', 'visible', 55),

  -- DAY 2: April 8, 2026 — Full Ship Descent
  (sail_id, crew_id, 'official', 'other',
    'Coffee, Concealer, Recovery Hour',
    'A gentle start for those who made too many choices last night. Hydrate. Reassemble. Re-enter society.',
    'Buffet / Pool Deck', '2026-04-08 14:00:00+00', 'public', 'visible', 143),

  (sail_id, crew_id, 'official', 'other',
    'Away Message Workshop',
    'Write the most cryptic and emotionally loaded away message possible. Extra respect for lowercase only and implied interpersonal conflict.',
    'Internet Graveyard Cafe', '2026-04-08 15:30:00+00', 'public', 'visible', 67),

  (sail_id, crew_id, 'official', 'social',
    'Battle of the Side Parts',
    'A live contest celebrating architectural hair decisions that should not survive ocean wind but somehow do.',
    'Atrium Stage', '2026-04-08 17:00:00+00', 'public', 'visible', 188),

  (sail_id, crew_id, 'official', 'other',
    'The ''It''s Not a Phase'' Panel',
    'A fake-serious panel on aesthetic permanence, lyric memory, and what exactly happened to all of us.',
    'Shoreline Theater', '2026-04-08 18:30:00+00', 'public', 'visible', 211),

  (sail_id, crew_id, 'official', 'social',
    'Comment for Comment IRL',
    'You compliment someone, they must compliment you back. No one leaves unchanged.',
    'Promenade', '2026-04-08 20:00:00+00', 'public', 'visible', 156),

  (sail_id, crew_id, 'official', 'other',
    'Merch Table Social Dynamics Simulator',
    'An interactive comedy event about awkward band-merch encounters, unnecessary small talk, and post-purchase social confusion.',
    'Black Parade Hall', '2026-04-08 21:30:00+00', 'public', 'visible', 89),

  (sail_id, crew_id, 'official', 'karaoke',
    'Main Stage Live Set',
    'Big energy. Big chorus moments. Several people point dramatically at the sky for reasons they cannot explain.',
    'Pool Stage', '2026-04-08 23:00:00+00', 'public', 'visible', 287),

  (sail_id, crew_id, 'official', 'social',
    'Breakup Letter Swap Meet',
    'Anonymous breakup letters are drawn and performed aloud by strangers who commit far too hard.',
    'Heart-Shaped Wreck Room', '2026-04-09 01:30:00+00', 'public', 'visible', 122),

  (sail_id, crew_id, 'official', 'other',
    'Cringe Archive Screening',
    'A late-night screening of old profile pages, cursed promo photos, forgotten edits, and internet artifacts that should have stayed buried at sea.',
    'Screening Lounge', '2026-04-09 03:59:00+00', 'public', 'visible', 91),

  -- DAY 3: April 9, 2026 — Peak Cruise Delusion
  (sail_id, crew_id, 'official', 'other',
    'Overthinkers Anonymous (Live)',
    'Guests publicly share what they''ve overanalyzed. Crowd response determines whether it was a valid spiral or an avoidable one.',
    'Small Theater', '2026-04-09 14:30:00+00', 'public', 'visible', 178),

  (sail_id, crew_id, 'official', 'other',
    'Lyric Notebook Exhibition',
    'A display of old journals, unfinished lyrics, abandoned band names, and painfully sincere writing that aged better than expected.',
    'Gallery Hall', '2026-04-09 16:00:00+00', 'public', 'visible', 99),

  (sail_id, crew_id, 'official', 'social',
    'Top 8 Reshuffle Hour',
    'Publicly reorder your cruise friendships based on vibes, betrayal, and who made you laugh at breakfast.',
    'MySpace Terminal Zone', '2026-04-09 17:30:00+00', 'public', 'visible', 245),

  (sail_id, crew_id, 'official', 'karaoke',
    'Acoustic Set You Weren''t Ready For',
    'This event appears without warning somewhere on the ship. If you find it, act like you were always meant to.',
    '??? / Unlisted', '2026-04-09 19:00:00+00', 'public', 'visible', 133),

  (sail_id, crew_id, 'official', 'other',
    'Stay in Your Cabin & Spiral',
    'A scheduled anti-event. No activities. No forced fun. Just you, the porthole, and whatever''s been catching up to you.',
    'Your Cabin', '2026-04-09 20:30:00+00', 'public', 'visible', 312),

  (sail_id, crew_id, 'official', 'deck',
    'RIP My Old Self Ceremony',
    'Write down something you''re leaving behind and release it in a controlled, symbolic, cruise-safe way.',
    'Sunset Deck', '2026-04-09 22:30:00+00', 'public', 'visible', 267),

  (sail_id, crew_id, 'official', 'other',
    'Silent Disco: Internal Monologue Edition',
    'Three channels: emo anthems, soft acoustic damage, and spoken-word thoughts you should maybe journal instead.',
    'Moonlit Deck', '2026-04-10 00:00:00+00', 'public', 'visible', 198),

  (sail_id, crew_id, 'official', 'deck',
    'The Deck at 3:17 AM (Early Gathering)',
    'People start showing up way too early because everyone knows this becomes the real event whether anyone schedules it or not.',
    'Outer Deck', '2026-04-10 03:00:00+00', 'public', 'visible', 77),

  (sail_id, crew_id, 'official', 'deck',
    'The Deck at 3:17 AM',
    'No host. No lineup. Just ocean wind, confessions, accidental bonding, and somebody staring into the dark like they''re in a video treatment.',
    'Outer Deck', '2026-04-10 03:17:00+00', 'public', 'visible', 148),

  -- DAY 4: April 10, 2026 — Disembarkation
  (sail_id, crew_id, 'official', 'dinner',
    'Brunch of Regret',
    'Coffee, carbs, and the realization that you now know far too much about several strangers.',
    'Main Dining Room', '2026-04-10 13:30:00+00', 'public', 'visible', 234),

  (sail_id, crew_id, 'official', 'social',
    'Profile Comments: Final Day Edition',
    'Leave one final fake MySpace-style comment for someone you met on board. Sweet, weird, evasive, or devastatingly sincere.',
    'Promenade Kiosks', '2026-04-10 15:00:00+00', 'public', 'visible', 189),

  (sail_id, crew_id, 'official', 'other',
    'Missed Call Confessional Playback',
    'The most dramatic, funniest, and most alarmingly intimate anonymous confessions are played back for the crowd.',
    'Shoreline Theater', '2026-04-10 16:30:00+00', 'public', 'visible', 301),

  (sail_id, crew_id, 'official', 'social',
    'Group Photo for People Who Hate Group Photos',
    'One last badly organized photo with too many sunglasses, too much sun, and exactly the right amount of emotional residue.',
    'Pool Stage', '2026-04-10 18:00:00+00', 'public', 'visible', 276),

  (sail_id, crew_id, 'official', 'karaoke',
    'Closing Set: Last Song Before Shore',
    'The final set. Big sing-alongs. Real feelings. Someone absolutely cries and tries to play it off as wind.',
    'Main Stage', '2026-04-10 20:00:00+00', 'public', 'visible', 312),

  (sail_id, crew_id, 'official', 'other',
    'Disembarkation Prep / Emotional Customs',
    'Pack your bag, steal one last hallway moment, and prepare to become internet mutuals with people who now know your whole deal.',
    'Cabin Decks', '2026-04-10 22:00:00+00', 'public', 'visible', 178);

  -- -------------------------------------------------------
  -- 5. Friendships
  -- -------------------------------------------------------
  INSERT INTO friendships (requester_id, addressee_id, status) VALUES
    (uid_1, uid_2, 'accepted'),
    (uid_1, uid_4, 'accepted'),
    (uid_1, uid_7, 'accepted'),
    (uid_2, uid_3, 'accepted'),
    (uid_2, uid_5, 'accepted'),
    (uid_3, uid_9, 'accepted'),
    (uid_4, uid_6, 'accepted'),
    (uid_4, uid_8, 'accepted'),
    (uid_5, uid_7, 'accepted'),
    (uid_6, uid_10,'accepted'),
    (uid_7, uid_9, 'accepted'),
    (uid_8, uid_10,'accepted'),
    (uid_9, uid_1, 'pending'),
    (uid_10,uid_3, 'pending')
  ON CONFLICT DO NOTHING;

  -- -------------------------------------------------------
  -- 6. Wall posts
  -- -------------------------------------------------------
  INSERT INTO wall_posts (author_user_id, profile_user_id, body, moderation_status) VALUES
    (uid_2, uid_1, 'whoever scheduled "stay in your cabin & spiral" is sick for that. i rsvp''d immediately', 'visible'),
    (uid_1, uid_2, 'battle of the side parts changed my life and my center of gravity. see you there', 'visible'),
    (uid_3, uid_4, 'missed call confessional should legally count as therapy. i''ve been three times', 'visible'),
    (uid_4, uid_3, 'i came here for the music and left with 4 new mutuals and one unresolved situation', 'visible'),
    (uid_5, uid_7, 'heard the stairwell set. did not act casual. could not act casual. incredible.', 'visible'),
    (uid_7, uid_5, 'porthole view, 3am, the deck is calling. see you there or not. either way.', 'visible'),
    (uid_6, uid_8, 'my top 8 has been in crisis since i boarded. currently ranked: ocean 1, feelings 2, you 3', 'visible'),
    (uid_8, uid_6, 'cringe archive screening was the most healing and most devastating thing i''ve witnessed', 'visible'),
    (uid_9, uid_10,'left a message at the confessional for you specifically. hope you find it. or don''t.', 'visible'),
    (uid_10,uid_9, 'away message: processing. back when i figure it out. (do not hold your breath)', 'visible'),
    (uid_1, uid_5, 'saw you at deck drift last night. you looked like you had something to say', 'visible'),
    (uid_3, uid_7, 'can you please warn me next time before the stairwell set, i was not emotionally ready', 'visible'),
    (uid_2, uid_6, 'the lyric notebook exhibition genuinely ruined me in the best possible way', 'visible'),
    (uid_4, uid_9, 'rip my old self ceremony > therapy. i left something behind and felt it leave', 'visible');

  RAISE NOTICE 'Seed complete. Sailing ID: %', sail_id;
END $$;
