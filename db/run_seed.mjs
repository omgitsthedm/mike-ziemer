/**
 * Deckspace — Demo seed runner
 * Runs via: node db/run_seed.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gvnktiljqzhjcgxiijlk.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bmt0aWxqcXpoamNneGlpamxrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDQxMzU0NCwiZXhwIjoyMDg5OTg5NTQ0fQ.bg_mjmjbFPtpAbpckqkDE4MinGUKq0KfmqHovpHvfgI';
const SAILING_ID   = 'e8fd7444-7d5e-4506-b20f-a2abab7af938';

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'deckspace' },
  auth: { persistSession: false }
});

async function q(promise, label) {
  const { data, error } = await promise;
  if (error) { console.error(`❌ ${label}:`, error.message); return null; }
  console.log(`✓ ${label}`);
  return data;
}

async function upsertUser({ username, display_name, role = 'passenger', daysAgo = 1 }) {
  // Try insert, ignore conflict, then fetch
  await db.from('users').insert({
    sailing_id: SAILING_ID,
    username,
    display_name,
    account_status: 'active',
    activation_status: 'active',
    role,
    created_at: new Date(Date.now() - daysAgo * 86400000).toISOString()
  }).select('id');
  const { data } = await db.from('users')
    .select('id')
    .eq('sailing_id', SAILING_ID)
    .eq('username', username)
    .single();
  return data?.id;
}

async function main() {
  console.log('🚢 Seeding Shattered Shores demo data...\n');

  // ── 1. Crew account ──────────────────────────────────────────────────────
  const crewId = await upsertUser({ username: 'shattered_shores_crew', display_name: 'Shattered Shores Crew', role: 'moderator', daysAgo: 3 });
  console.log(`✓ Crew user: ${crewId}`);

  await db.from('profiles').upsert({
    user_id: crewId,
    about_me: 'Your official cruise host account. All announcements, schedules, and chaos coordination go through here.',
    social_intent: 'Herding cats on a ship'
  }, { onConflict: 'user_id' });
  console.log('✓ Crew profile');

  // ── 2. Passenger accounts ────────────────────────────────────────────────
  const passengers = [
    { username: 'kaitlyn_darkwater',  display_name: 'kaitlyn darkwater',  daysAgo: 2 },
    { username: 'sidepartsurvivor',   display_name: 'Jesse Calvert',      daysAgo: 2 },
    { username: 'lowercaseforever',   display_name: 'maya (lowercase)',   daysAgo: 2 },
    { username: 'bleedingheartblake', display_name: 'Blake Harmon',       daysAgo: 1 },
    { username: 'portsideghost',      display_name: 'jamie',              daysAgo: 1 },
    { username: 'cringe_archivist',   display_name: 'Devon Mitchell',     daysAgo: 1 },
    { username: 'stairwellacoustic',  display_name: 'Alex (stairwell)',   daysAgo: 0.2 },
    { username: 'top8disaster',       display_name: 'Sam Top8',           daysAgo: 0.2 },
    { username: 'missedcallmorgn',    display_name: 'Morgan',             daysAgo: 0.1 },
    { username: 'awaymessageguru',    display_name: 'taylor :: away',     daysAgo: 0.05 },
  ];

  const uids = {};
  for (const p of passengers) {
    uids[p.username] = await upsertUser(p);
    console.log(`✓ User: ${p.username} → ${uids[p.username]}`);
  }

  // ── 3. Profiles ──────────────────────────────────────────────────────────
  const profiles = [
    { username: 'kaitlyn_darkwater',  about_me: "here for the music and whatever's honest. probably on the outer deck.", hometown: 'Portland, OR', who_id_like_to_meet: 'people who still have strong opinions about album art', social_intent: 'late nights, real conversations', vibe_tags: ['emo','acoustic','ocean','overthinking'] },
    { username: 'sidepartsurvivor',   about_me: "survived the side part era. still processing it. hair game: wind-resistant.", hometown: 'Austin, TX', who_id_like_to_meet: 'trivia partners and anyone who has the acoustic set rumor', social_intent: 'trivia, social chaos', vibe_tags: ['trivia','scene','karaoke','snacks'] },
    { username: 'lowercaseforever',   about_me: "lowercase commitment is a lifestyle not a phase. do not capitalize my name.", hometown: 'brooklyn', who_id_like_to_meet: 'people who understand that everything means something', social_intent: 'vibe quietly, connect loudly', vibe_tags: ['lowercase','poetry','post-rock','silence'] },
    { username: 'bleedingheartblake', about_me: "brought three black outfits and a journal. very normal amount of feelings.", hometown: 'Chicago, IL', who_id_like_to_meet: "anyone who's been to the missed call booth more than once", social_intent: 'music, ocean air, closure', vibe_tags: ['emo','creative','journal','nightlife'] },
    { username: 'portsideghost',      about_me: "ghost mode but make it social. yes i'm here, no i'm not announcing it.", hometown: 'Seattle, WA', who_id_like_to_meet: 'the kind of people you find at 3am on a top deck', social_intent: 'quiet chaos', vibe_tags: ['introvert','deck','midnight','ocean'] },
    { username: 'cringe_archivist',   about_me: "i have screenshots of things that should not have existed. archivist mode.", hometown: 'Los Angeles, CA', who_id_like_to_meet: "anyone who had a neopets page and isn't over it", social_intent: 'documentation and mild embarrassment', vibe_tags: ['archive','cringe','nostalgia','humor'] },
    { username: 'stairwellacoustic',  about_me: "will play an acoustic set in literally any stairwell. no set list. no apologies.", hometown: 'Nashville, TN', who_id_like_to_meet: 'people who want to hear a song at an inappropriate time', social_intent: 'spontaneous sets and good acoustics', vibe_tags: ['acoustic','guitar','stairwell','folk'] },
    { username: 'top8disaster',       about_me: "my top 8 has been in crisis since 2007 and nothing has changed.", hometown: 'Denver, CO', who_id_like_to_meet: 'anyone who takes top 8 seriously enough to feel betrayed by it', social_intent: 'friendship dramatics', vibe_tags: ['top8','social','drama','karaoke'] },
    { username: 'missedcallmorgn',    about_me: "left three messages already. working on the fourth. no i will not explain.", hometown: 'Miami, FL', who_id_like_to_meet: "whoever is running missed call confessional, we need to talk", social_intent: 'confessing things to inanimate phones', vibe_tags: ['confessional','feelings','ocean','phone'] },
    { username: 'awaymessageguru',    about_me: "away message: crafting this bio. back never.", hometown: 'Minneapolis, MN', who_id_like_to_meet: 'people who still think away messages are an art form', social_intent: 'absence as communication', vibe_tags: ['away','passive','aesthetic','nostalgia'] },
  ];

  for (const p of profiles) {
    const uid = uids[p.username];
    if (!uid) continue;
    await db.from('profiles').upsert({
      user_id: uid,
      about_me: p.about_me,
      hometown: p.hometown,
      who_id_like_to_meet: p.who_id_like_to_meet,
      social_intent: p.social_intent,
      vibe_tags: p.vibe_tags
    }, { onConflict: 'user_id' });
    console.log(`✓ Profile: ${p.username}`);
  }

  // ── 4. Events ────────────────────────────────────────────────────────────
  console.log('\n📅 Seeding events...');

  // Clear existing official events first
  await db.from('events').delete().eq('sailing_id', SAILING_ID).eq('event_type', 'official');
  console.log('✓ Cleared old official events');

  const events = [
    // DAY 1 — April 7
    { title: 'Port Check-In & Personal Lore Intake', category: 'social', location: 'Terminal Entrance', start_at: '2026-04-07T17:00:00Z', rsvp_count: 47, description: "Board the ship, get your wristband, and quietly decide whether you're here for closure, chaos, or both." },
    { title: 'Cabin Key Pickup + Mirror Check Spiral', category: 'social', location: 'Cabin Decks', start_at: '2026-04-07T19:00:00Z', rsvp_count: 89, description: 'First official moment to stare at yourself in terrible lighting and think, "interesting."' },
    { title: "Welcome Aboard: Add Me or Don't Mixer", category: 'social', location: 'Top 8 Lounge', start_at: '2026-04-07T20:30:00Z', rsvp_count: 134, description: 'A low-stakes social mixer for making friends, avoiding eye contact, and deciding who seems emotionally unsafe in an exciting way.' },
    { title: 'Safety Drill But Make It Dramatic', category: 'other', location: 'Main Deck', start_at: '2026-04-07T22:00:00Z', rsvp_count: 312, description: "Yes, this is mandatory. Try not to make it your whole personality." },
    { title: 'Sail Away Set: Sad Songs, Open Water', category: 'karaoke', location: 'Pool Stage', start_at: '2026-04-07T23:30:00Z', rsvp_count: 201, description: 'The ship leaves port. The band starts. Everyone pretends they are in a music video for at least six minutes.' },
    { title: 'Default Profile Picture Crisis Center', category: 'social', location: 'Photo Booth Lounge', start_at: '2026-04-08T01:00:00Z', rsvp_count: 98, description: 'Take the worst possible flash photo of yourself on purpose. Choose one image to emotionally represent you for the rest of the cruise.' },
    { title: 'Missed Call Confessional Opens', category: 'other', location: 'Offline Deck Phone Booths', start_at: '2026-04-08T02:30:00Z', rsvp_count: 77, description: "Pick up the phone. Hear the prompt. Leave the message you should probably keep to yourself." },
    { title: 'Late Night Deck Drift', category: 'deck', location: 'Outer Deck', start_at: '2026-04-08T03:45:00Z', rsvp_count: 55, description: 'No official programming. Just wind, salt air, side conversations, and suspiciously honest eye contact.' },
    // DAY 2 — April 8
    { title: 'Coffee, Concealer, Recovery Hour', category: 'other', location: 'Buffet / Pool Deck', start_at: '2026-04-08T14:00:00Z', rsvp_count: 143, description: 'A gentle start for those who made too many choices last night. Hydrate. Reassemble. Re-enter society.' },
    { title: 'Away Message Workshop', category: 'other', location: 'Internet Graveyard Cafe', start_at: '2026-04-08T15:30:00Z', rsvp_count: 67, description: 'Write the most cryptic and emotionally loaded away message possible. Extra respect for lowercase only and implied interpersonal conflict.' },
    { title: 'Battle of the Side Parts', category: 'social', location: 'Atrium Stage', start_at: '2026-04-08T17:00:00Z', rsvp_count: 188, description: 'A live contest celebrating architectural hair decisions that should not survive ocean wind but somehow do.' },
    { title: "The 'It's Not a Phase' Panel", category: 'other', location: 'Shoreline Theater', start_at: '2026-04-08T18:30:00Z', rsvp_count: 211, description: 'A fake-serious panel on aesthetic permanence, lyric memory, and what exactly happened to all of us.' },
    { title: 'Comment for Comment IRL', category: 'social', location: 'Promenade', start_at: '2026-04-08T20:00:00Z', rsvp_count: 156, description: 'You compliment someone, they must compliment you back. No one leaves unchanged.' },
    { title: 'Merch Table Social Dynamics Simulator', category: 'other', location: 'Black Parade Hall', start_at: '2026-04-08T21:30:00Z', rsvp_count: 89, description: 'An interactive comedy event about awkward band-merch encounters, unnecessary small talk, and post-purchase social confusion.' },
    { title: 'Main Stage Live Set', category: 'karaoke', location: 'Pool Stage', start_at: '2026-04-08T23:00:00Z', rsvp_count: 287, description: 'Big energy. Big chorus moments. Several people point dramatically at the sky for reasons they cannot explain.' },
    { title: 'Breakup Letter Swap Meet', category: 'social', location: 'Heart-Shaped Wreck Room', start_at: '2026-04-09T01:30:00Z', rsvp_count: 122, description: 'Anonymous breakup letters are drawn and performed aloud by strangers who commit far too hard.' },
    { title: 'Cringe Archive Screening', category: 'other', location: 'Screening Lounge', start_at: '2026-04-09T03:59:00Z', rsvp_count: 91, description: 'A late-night screening of old profile pages, cursed promo photos, forgotten edits, and internet artifacts that should have stayed buried at sea.' },
    // DAY 3 — April 9
    { title: 'Overthinkers Anonymous (Live)', category: 'other', location: 'Small Theater', start_at: '2026-04-09T14:30:00Z', rsvp_count: 178, description: "Guests publicly share what they've overanalyzed. Crowd response determines whether it was a valid spiral or an avoidable one." },
    { title: 'Lyric Notebook Exhibition', category: 'other', location: 'Gallery Hall', start_at: '2026-04-09T16:00:00Z', rsvp_count: 99, description: 'A display of old journals, unfinished lyrics, abandoned band names, and painfully sincere writing that aged better than expected.' },
    { title: 'Top 8 Reshuffle Hour', category: 'social', location: 'MySpace Terminal Zone', start_at: '2026-04-09T17:30:00Z', rsvp_count: 245, description: 'Publicly reorder your cruise friendships based on vibes, betrayal, and who made you laugh at breakfast.' },
    { title: "Acoustic Set You Weren't Ready For", category: 'karaoke', location: '??? / Unlisted', start_at: '2026-04-09T19:00:00Z', rsvp_count: 133, description: 'This event appears without warning somewhere on the ship. If you find it, act like you were always meant to.' },
    { title: 'Stay in Your Cabin & Spiral', category: 'other', location: 'Your Cabin', start_at: '2026-04-09T20:30:00Z', rsvp_count: 312, description: "A scheduled anti-event. No activities. No forced fun. Just you, the porthole, and whatever's been catching up to you." },
    { title: 'RIP My Old Self Ceremony', category: 'deck', location: 'Sunset Deck', start_at: '2026-04-09T22:30:00Z', rsvp_count: 267, description: "Write down something you're leaving behind and release it in a controlled, symbolic, cruise-safe way." },
    { title: 'Silent Disco: Internal Monologue Edition', category: 'other', location: 'Moonlit Deck', start_at: '2026-04-10T00:00:00Z', rsvp_count: 198, description: 'Three channels: emo anthems, soft acoustic damage, and spoken-word thoughts you should maybe journal instead.' },
    { title: 'The Deck at 3:17 AM (Early Gathering)', category: 'deck', location: 'Outer Deck', start_at: '2026-04-10T03:00:00Z', rsvp_count: 77, description: 'People start showing up way too early because everyone knows this becomes the real event whether anyone schedules it or not.' },
    { title: 'The Deck at 3:17 AM', category: 'deck', location: 'Outer Deck', start_at: '2026-04-10T03:17:00Z', rsvp_count: 148, description: "No host. No lineup. Just ocean wind, confessions, accidental bonding, and somebody staring into the dark like they're in a video treatment." },
    // DAY 4 — April 10
    { title: 'Brunch of Regret', category: 'dinner', location: 'Main Dining Room', start_at: '2026-04-10T13:30:00Z', rsvp_count: 234, description: 'Coffee, carbs, and the realization that you now know far too much about several strangers.' },
    { title: 'Profile Comments: Final Day Edition', category: 'social', location: 'Promenade Kiosks', start_at: '2026-04-10T15:00:00Z', rsvp_count: 189, description: "Leave one final fake MySpace-style comment for someone you met on board. Sweet, weird, evasive, or devastatingly sincere." },
    { title: 'Missed Call Confessional Playback', category: 'other', location: 'Shoreline Theater', start_at: '2026-04-10T16:30:00Z', rsvp_count: 301, description: 'The most dramatic, funniest, and most alarmingly intimate anonymous confessions are played back for the crowd.' },
    { title: 'Group Photo for People Who Hate Group Photos', category: 'social', location: 'Pool Stage', start_at: '2026-04-10T18:00:00Z', rsvp_count: 276, description: 'One last badly organized photo with too many sunglasses, too much sun, and exactly the right amount of emotional residue.' },
    { title: 'Closing Set: Last Song Before Shore', category: 'karaoke', location: 'Main Stage', start_at: '2026-04-10T20:00:00Z', rsvp_count: 312, description: 'The final set. Big sing-alongs. Real feelings. Someone absolutely cries and tries to play it off as wind.' },
    { title: 'Disembarkation Prep / Emotional Customs', category: 'other', location: 'Cabin Decks', start_at: '2026-04-10T22:00:00Z', rsvp_count: 178, description: "Pack your bag, steal one last hallway moment, and prepare to become internet mutuals with people who now know your whole deal." },
  ];

  const { error: evErr } = await db.from('events').insert(
    events.map(e => ({
      sailing_id: SAILING_ID,
      creator_user_id: crewId,
      event_type: 'official',
      visibility: 'public',
      moderation_status: 'visible',
      ...e
    }))
  );
  if (evErr) console.error('❌ Events:', evErr.message);
  else console.log(`✓ Inserted ${events.length} events`);

  // ── 5. Friendships ───────────────────────────────────────────────────────
  console.log('\n🤝 Seeding friendships...');
  const friendPairs = [
    ['kaitlyn_darkwater', 'sidepartsurvivor'],
    ['kaitlyn_darkwater', 'bleedingheartblake'],
    ['kaitlyn_darkwater', 'stairwellacoustic'],
    ['sidepartsurvivor',  'lowercaseforever'],
    ['sidepartsurvivor',  'portsideghost'],
    ['lowercaseforever',  'missedcallmorgn'],
    ['bleedingheartblake','cringe_archivist'],
    ['bleedingheartblake','top8disaster'],
    ['portsideghost',     'stairwellacoustic'],
    ['cringe_archivist',  'awaymessageguru'],
    ['stairwellacoustic', 'missedcallmorgn'],
    ['top8disaster',      'awaymessageguru'],
  ];
  for (const [a, b] of friendPairs) {
    const { error } = await db.from('friendships').insert({
      requester_id: uids[a], addressee_id: uids[b], status: 'accepted'
    });
    if (error && !error.message.includes('duplicate')) console.error(`  ❌ ${a}→${b}:`, error.message);
    else console.log(`  ✓ ${a} ↔ ${b}`);
  }

  // ── 6. Wall posts ────────────────────────────────────────────────────────
  console.log('\n📝 Seeding wall posts...');
  const wallPosts = [
    { author: 'sidepartsurvivor',   target: 'kaitlyn_darkwater',  body: "whoever scheduled \"stay in your cabin & spiral\" is sick for that. i rsvp'd immediately" },
    { author: 'kaitlyn_darkwater',  target: 'sidepartsurvivor',   body: "battle of the side parts changed my life and my center of gravity. see you there" },
    { author: 'lowercaseforever',   target: 'bleedingheartblake', body: "missed call confessional should legally count as therapy. i've been three times" },
    { author: 'bleedingheartblake', target: 'lowercaseforever',   body: "i came here for the music and left with 4 new mutuals and one unresolved situation" },
    { author: 'portsideghost',      target: 'stairwellacoustic',  body: "heard the stairwell set. did not act casual. could not act casual. incredible." },
    { author: 'stairwellacoustic',  target: 'portsideghost',      body: "porthole view, 3am, the deck is calling. see you there or not. either way." },
    { author: 'cringe_archivist',   target: 'top8disaster',       body: "my top 8 has been in crisis since i boarded. currently ranked: ocean 1, feelings 2, you 3" },
    { author: 'top8disaster',       target: 'cringe_archivist',   body: "cringe archive screening was the most healing and most devastating thing i've witnessed" },
    { author: 'missedcallmorgn',    target: 'awaymessageguru',    body: "left a message at the confessional for you specifically. hope you find it. or don't." },
    { author: 'awaymessageguru',    target: 'missedcallmorgn',    body: "away message: processing. back when i figure it out. (do not hold your breath)" },
    { author: 'kaitlyn_darkwater',  target: 'portsideghost',      body: "saw you at deck drift last night. you looked like you had something to say" },
    { author: 'lowercaseforever',   target: 'stairwellacoustic',  body: "can you please warn me next time before the stairwell set, i was not emotionally ready" },
    { author: 'sidepartsurvivor',   target: 'cringe_archivist',   body: "the lyric notebook exhibition genuinely ruined me in the best possible way" },
    { author: 'bleedingheartblake', target: 'missedcallmorgn',    body: "rip my old self ceremony > therapy. i left something behind and felt it leave" },
  ];
  for (const wp of wallPosts) {
    const { error } = await db.from('wall_posts').insert({
      author_user_id: uids[wp.author],
      profile_user_id: uids[wp.target],
      body: wp.body,
      moderation_status: 'visible'
    });
    if (error) console.error(`  ❌ ${wp.author}→${wp.target}:`, error.message);
    else console.log(`  ✓ ${wp.author} → ${wp.target}`);
  }

  console.log('\n✅ Seed complete! Shattered Shores is ready for demo.');
}

main().catch(console.error);
