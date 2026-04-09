/**
 * Deckspace — First-Run Admin Setup
 *
 * GET  /setup  — show bootstrap form (only when no users exist)
 * POST /setup  — create admin account + seed 15 demo passengers + log in
 *
 * Only accessible when zero users exist for the current SAILING_ID.
 * Once any user exists, both routes redirect to /login.
 */

import { Hono } from 'hono';
import { getDb } from '../lib/db.js';
import { hashPassword, createSession, setSessionCookie } from '../lib/auth.js';
import { layoutCtx, esc } from '../templates/layout.js';
import { ic } from '../templates/icons.js';

const setup = new Hono();

const DEMO_PASSENGERS = [
  { username: 'sarah_k',   display_name: 'Sarah K.',         hometown: 'Miami, FL',         vibe_tags: ['dancing','pool','foodie'],         status_text: 'living for this Caribbean sun',       about_me: "Miami girl born and raised! This is my 4th cruise and I never get tired of it. Find me at the pool or on the dance floor way too late." },
  { username: 'marco_v',   display_name: 'Marco Villanueva', hometown: 'Austin, TX',        vibe_tags: ['trivia','poker','nightlife'],       status_text: 'trivia night champion (self-titled)',  about_me: "Came for the poker tables, staying for the sunsets. Ask me about the best BBQ in Texas. I will talk about it for too long." },
  { username: 'jenna_b',   display_name: 'Jenna Bridges',    hometown: 'Nashville, TN',     vibe_tags: ['karaoke','music','comedy'],         status_text: 'mic drop incoming',                   about_me: "Nashville songwriter on vacation (sort of). I will 100% challenge you to karaoke. You have been warned." },
  { username: 'derek_w',   display_name: 'Derek Walsh',      hometown: 'Chicago, IL',       vibe_tags: ['gym','adventure','sea day'],        status_text: 'already found the gym on this ship',  about_me: "Chicago guy. Personal trainer by day, cruise person by also day. Looking to explore every port stop on this trip." },
  { username: 'tasha_m',   display_name: 'Tasha Monroe',     hometown: 'Atlanta, GA',       vibe_tags: ['dancing','nightlife','foodie'],     status_text: 'this buffet is undefeated',            about_me: "ATL in the house! Event planner in real life so I take cruise activities very seriously. Let's actually have fun out here." },
  { username: 'kevin_r',   display_name: 'Kevin Reyes',      hometown: 'Los Angeles, CA',   vibe_tags: ['chill','pool','music'],             status_text: 'golden hour photos > everything',     about_me: "LA photographer on a much-needed break from screens. Except my camera. But that's it." },
  { username: 'amber_h',   display_name: 'Amber Howell',     hometown: 'Denver, CO',        vibe_tags: ['excursion','adventure','sea day'],  status_text: 'snorkeling tomorrow I am SO ready',   about_me: "Colorado girl who needs her adventure fix even on vacation. First cruise ever — I have signed up for every single excursion." },
  { username: 'carlos_p',  display_name: 'Carlos Perez',     hometown: 'Houston, TX',       vibe_tags: ['poker','trivia','comedy'],          status_text: 'offline (finally)',                   about_me: "Houston native. Software engineer who deleted Slack for this trip. The comedy show last night was actually really good." },
  { username: 'lisa_ng',   display_name: 'Lisa Ng',          hometown: 'San Francisco, CA', vibe_tags: ['foodie','chill','music'],           status_text: 'the ceviche in Nassau was unreal',    about_me: "SF foodie and music nerd. Cruise goal: eat everything, hear everything, stress about nothing. So far so good." },
  { username: 'tyler_j',   display_name: 'Tyler James',      hometown: 'Dallas, TX',        vibe_tags: ['karaoke','dancing','nightlife'],    status_text: 'just closed down the karaoke bar',    about_me: "Dallas born, always late to the party but I make up for it. Karaoke is my love language. Yes I know all the words to everything." },
  { username: 'maya_s',    display_name: 'Maya Singh',       hometown: 'New York, NY',      vibe_tags: ['chill','sea day','music'],          status_text: 'do not disturb',                      about_me: "NYC lawyer finally taking a real vacation. My plan is to do nothing. Nothing at all. Thank you for understanding." },
  { username: 'ben_f',     display_name: 'Ben Forsyth',      hometown: 'Boston, MA',        vibe_tags: ['trivia','poker','comedy'],          status_text: 'found 3 other Sox fans on board',     about_me: "Boston guy. Red Sox fan. Yes I brought a jersey. No I am not sorry. Let's play trivia — I actually know things." },
  { username: 'rachel_t',  display_name: 'Rachel Torres',    hometown: 'Orlando, FL',       vibe_tags: ['dancing','pool','excursion'],       status_text: 'birthday cruise lets gooo',            about_me: "Orlando local here with my sister for a birthday trip! First real vacation in two years. Very ready for this." },
  { username: 'jake_m',    display_name: 'Jake Miller',      hometown: 'Seattle, WA',       vibe_tags: ['adventure','excursion','sea day'],  status_text: 'it is 84 degrees and I am losing it', about_me: "Pacific Northwest hiking guy on his first Caribbean trip. How is the weather this good? I do not understand and I love it." },
  { username: 'priya_v',   display_name: 'Priya Varma',      hometown: 'Phoenix, AZ',       vibe_tags: ['foodie','music','chill'],           status_text: 'eating my way through the Caribbean', about_me: "Phoenix foodie and amateur chef. I am taking notes on every dish I eat on this ship. The buffet selection is my new religion." },
];

const WALL_POSTS = [
  { from: 'marco_v',  to: 'sarah_k',  body: "Great meeting you at the pool! Still can't believe you beat me at shuffleboard 😅" },
  { from: 'sarah_k',  to: 'marco_v',  body: "Practice makes perfect!! You coming to trivia tonight?" },
  { from: 'jenna_b',  to: 'tyler_j',  body: "That karaoke set last night was incredible. We are doing a duet tonight and that's final." },
  { from: 'tyler_j',  to: 'jenna_b',  body: "Already picked the song. Don't let me down, Nashville 🎤" },
  { from: 'derek_w',  to: 'amber_h',  body: "Nice meeting you at the excursion desk! The snorkeling is gonna be amazing." },
  { from: 'amber_h',  to: 'derek_w',  body: "SO pumped!! Don't judge me if I scream into my mask a little bit" },
  { from: 'carlos_p', to: 'ben_f',    body: "Trivia rematch tonight. I looked up everything I got wrong last time 📚" },
  { from: 'ben_f',    to: 'carlos_p', body: "I have been studying 90s movies since 2PM. Come prepared." },
  { from: 'tasha_m',  to: 'rachel_t', body: "Happy early birthday!! Meet by the main stage at 9 — trust me 🎉" },
  { from: 'rachel_t', to: 'tasha_m',  body: "You are literally the nicest person on this whole ship omg 😭 YES 9PM!!" },
  { from: 'lisa_ng',  to: 'priya_v',  body: "Someone told me you're a chef?? I need your honest rating of the sushi situation on this ship" },
  { from: 'priya_v',  to: 'lisa_ng',  body: "Solid 7/10 given we are in the middle of the ocean. The ceviche however? Absolutely undefeated." },
  { from: 'maya_s',   to: 'kevin_r',  body: "Those photos you posted from Nassau are stunning!! What camera do you use?" },
  { from: 'kevin_r',  to: 'maya_s',   body: "Thanks!! Sony A7 IV. Happy to give you a quick lesson — I am usually at the pool deck in the AM." },
  { from: 'jake_m',   to: 'derek_w',  body: "Fellow outdoor person spotted 🙌 You doing the Great Stirrup Cay beach thing?" },
  { from: 'derek_w',  to: 'jake_m',   body: "100% in — meeting at the gangway at 8:30. The more the merrier!" },
  { from: 'priya_v',  to: 'tasha_m',  body: "The spicy tuna roll at the sushi counter is SO worth the wait by the way. Just saying." },
  { from: 'marco_v',  to: 'carlos_p', body: "Poker room, 10PM tonight. I need to win back my dignity from last night." },
];

async function seedDemoPassengers(db, sailingId) {
  const demoHash = await hashPassword('demo1234');

  await db.from('users').insert(
    DEMO_PASSENGERS.map(u => ({
      sailing_id:        sailingId,
      username:          u.username,
      display_name:      u.display_name,
      password_hash:     demoHash,
      account_status:    'active',
      activation_status: 'active',
      role:              'passenger',
    }))
  ).catch(() => {}); // ignore duplicates

  const { data: allDemo } = await db.from('users')
    .select('id, username')
    .eq('sailing_id', sailingId)
    .in('username', DEMO_PASSENGERS.map(u => u.username));
  const userMap = Object.fromEntries((allDemo || []).map(u => [u.username, u.id]));

  // Profiles
  const profileRows = DEMO_PASSENGERS.map(u => ({
    user_id:     userMap[u.username],
    about_me:    u.about_me    || null,
    hometown:    u.hometown    || null,
    vibe_tags:   u.vibe_tags   || null,
    status_text: u.status_text || null,
    theme_id:    'classic',
  })).filter(r => r.user_id);
  if (profileRows.length) {
    await db.from('profiles').upsert(profileRows, { onConflict: 'user_id' }).catch(() => {});
  }

  // Wall posts staggered over last 48 hours
  const wallRows = WALL_POSTS.map((p, i) => {
    const authorId  = userMap[p.from];
    const profileId = userMap[p.to];
    if (!authorId || !profileId) return null;
    const msAgo = (WALL_POSTS.length - i) * 90 * 60 * 1000;
    return {
      author_user_id:    authorId,
      profile_user_id:   profileId,
      body:              p.body,
      created_at:        new Date(Date.now() - msAgo).toISOString(),
      moderation_status: 'visible',
    };
  }).filter(Boolean);
  if (wallRows.length) {
    await db.from('wall_posts').insert(wallRows).catch(() => {});
  }
}

async function isFirstRun(db, sailingId) {
  const { count } = await db.from('users')
    .select('id', { count: 'exact', head: true })
    .eq('sailing_id', sailingId);
  return (count || 0) === 0;
}

setup.get('/setup', async (c) => {
  const db = getDb(c.env);
  if (!(await isFirstRun(db, c.env.SAILING_ID))) return c.redirect('/login');

  const body = `<div style="max-width:400px;margin:40px auto">
  <div class="ds-module">
    <div class="ds-module-header">${ic.shield(12)} First-Run Setup</div>
    <div class="ds-module-body">
      <p style="font-size:12px;margin-bottom:12px;line-height:1.5">
        No accounts exist yet. Create your admin account below.
        This page disappears the moment an account exists.
        15 demo passengers will be added automatically.
      </p>
      <form method="POST" action="/setup" class="ds-form">
        <div class="ds-form-row">
          <label for="s-name">Your Name *</label>
          <input id="s-name" name="display_name" type="text" class="ds-input" required maxlength="50" placeholder="e.g. Captain Mike">
        </div>
        <div class="ds-form-row">
          <label for="s-user">Username *</label>
          <input id="s-user" name="username" type="text" class="ds-input" required maxlength="30" placeholder="letters, numbers, underscores" data-validate-username>
        </div>
        <div class="ds-form-row">
          <label for="s-pass">Password *</label>
          <input id="s-pass" name="password" type="password" class="ds-input" required minlength="8" data-pw-source placeholder="at least 8 characters">
        </div>
        <div class="ds-form-row">
          <label for="s-pass2">Confirm Password *</label>
          <input id="s-pass2" name="password2" type="password" class="ds-input" required minlength="8" data-pw-confirm>
          <div class="pw-match-hint" style="display:none;font-size:11px;margin-top:3px"></div>
        </div>
        <div class="ds-form-row mt-8">
          <button type="submit" class="ds-btn ds-btn-primary" data-loading-text="Setting up...">Create Admin + Add Demo Passengers</button>
        </div>
      </form>
    </div>
  </div>
</div>`;

  return c.html(layoutCtx(c, { title: 'Setup', body }));
});

setup.post('/setup', async (c) => {
  const db = getDb(c.env);
  if (!(await isFirstRun(db, c.env.SAILING_ID))) return c.redirect('/login');

  const form = await c.req.formData();
  const displayName = (form.get('display_name') || '').toString().trim().slice(0, 50);
  const username    = (form.get('username') || '').toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  const password    = (form.get('password') || '').toString();
  const password2   = (form.get('password2') || '').toString();

  const errs = [];
  if (!displayName || displayName.length < 2) errs.push('Name must be at least 2 characters.');
  if (!username || username.length < 3)       errs.push('Username must be at least 3 characters.');
  if (!password || password.length < 8)       errs.push('Password must be at least 8 characters.');
  if (password !== password2)                 errs.push('Passwords do not match.');

  if (errs.length) {
    return c.html(layoutCtx(c, {
      title: 'Setup',
      body: `<div style="max-width:400px;margin:40px auto">
        <div class="ds-flash error">${errs.map(esc).join('<br>')}</div>
        <p style="font-size:12px"><a href="/setup">Try again</a></p>
      </div>`
    }), 400);
  }

  const passwordHash = await hashPassword(password);

  const { data: newUser, error: insertErr } = await db.from('users').insert({
    sailing_id:        c.env.SAILING_ID,
    username,
    display_name:      displayName,
    password_hash:     passwordHash,
    account_status:    'active',
    activation_status: 'active',
    role:              'admin',
  }).select('id').single();

  if (insertErr || !newUser) {
    return c.html(layoutCtx(c, {
      title: 'Setup Error',
      body: `<div style="max-width:400px;margin:40px auto">
        <div class="ds-flash error">Could not create account. Check Supabase connection and try again.</div>
        <p style="font-size:12px"><a href="/setup">Try again</a></p>
      </div>`
    }), 500);
  }

  await db.from('profiles').upsert({ user_id: newUser.id }, { onConflict: 'user_id' }).catch(() => {});

  // Seed demo passengers synchronously so they're ready on arrival
  await seedDemoPassengers(db, c.env.SAILING_ID);

  const { token, expiresAt } = await createSession(c.env, newUser.id, c.req.raw);
  const res = c.redirect('/admin/demo');
  setSessionCookie(res, token, expiresAt);
  return res;
});

export default setup;
