import { Hono } from 'hono';
import { getDb, getSailing } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { layoutCtx, esc } from '../templates/layout.js';
import { module } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const site = new Hono();

site.get('/about', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const body = [
    module({
      header: `${ic.shipWheel(12)} About Deckspace`,
      body: `<p style="margin-bottom:8px">Deckspace is the shared social page for one sailing. It gives everyone on the ship a place to see what is happening, meet other passengers, RSVP to events, share photos, and leave wall notes while the trip is still going.</p>
      <p style="margin-bottom:8px">The retro feel is on purpose. Deckspace borrows some 2006 social-web energy, but keeps things simple and easier to manage for a cruise: no private messages and no hidden activity feed.</p>
      <p>When the trip ends, the page may stay up in a short read-only archive before it is removed.</p>`
    }),
    module({
      header: `${ic.shield(12)} Why Everyone Can See It`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>Everyone on the sailing sees the same shared page.</li>
        <li>Crew can review public activity more quickly when needed.</li>
        <li>You do not need to learn a private messaging system to take part.</li>
        <li>The whole system stays simple and easier to manage.</li>
      </ul>`
    })
  ].join('');

  return c.html(layoutCtx(c, {
    title: 'About the Deckspace Cruise Network',
    description: 'Learn what Deckspace is: a temporary cruise community site for events, profiles, photos, and a short post-cruise archive.',
    canonicalUrl: new URL('/about', c.req.url).toString(),
    user,
    sailing,
    body,
  }));
});

site.get('/contact', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const shipName = sailing?.ship_name || 'your ship';

  const body = [
    module({
      header: `${ic.mail(12)} Contact & Support`,
      body: `<p style="margin-bottom:8px">If you are on <strong>${esc(shipName)}</strong> and need help with Deckspace, start with Guest Services or the onboard team handling the ship board, weather, and event page.</p>
      <p style="margin-bottom:8px">For account help, safety concerns, or content that needs a second look, use the report tools on public pages when they are available.</p>
      <p>The fastest help usually comes from the crew already supporting the sailing.</p>`
    }),
    module({
      header: `${ic.info(12)} What We Can Help With`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>Login or sign-up problems</li>
        <li>Public content and safety concerns</li>
        <li>Wrong ship board, weather, or voyage info</li>
        <li>Questions about how long the archive stays up after the trip</li>
      </ul>`
    })
  ].join('');

  return c.html(layoutCtx(c, {
    title: 'Deckspace Help, Support, and Safety',
    description: 'Find Deckspace help for onboard support, moderation concerns, account lookup, and public-content reporting during a sailing.',
    canonicalUrl: new URL('/contact', c.req.url).toString(),
    user,
    sailing,
    body,
  }));
});

site.get('/privacy', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const body = [
    module({
      header: `${ic.lock(12)} Privacy & Data`,
      body: `<p style="margin-bottom:8px"><strong>Deckspace is meant to be public to your sailing.</strong> Profiles, wall posts, RSVPs, and shared photos can be seen by other passengers on the same trip.</p>
      <p style="margin-bottom:8px">There is no private messaging. Keeping things out in the open makes moderation and onboard safety easier.</p>
      <p>Your basic account details, page content, photos, and activity stay up for the sailing and its short read-only archive window unless staff remove them sooner.</p>`
    }),
    module({
      header: `${ic.bookOpen(12)} How Long It Stays Up`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>Deckspace stays active during the sailing.</li>
        <li>After the trip, it may stay up in read-only mode for a short time.</li>
        <li>When that archive window ends, the sailing page is taken down.</li>
        <li>Staff can still review or remove reported content while the page is live.</li>
      </ul>`
    })
  ].join('');

  return c.html(layoutCtx(c, {
    title: 'Deckspace Privacy and Archive Policy',
    description: 'Read how Deckspace handles public sailing activity, profile visibility, moderation, temporary data retention, and the short post-cruise archive period.',
    canonicalUrl: new URL('/privacy', c.req.url).toString(),
    user,
    sailing,
    body,
  }));
});

site.get('/terms', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const body = [
    module({
      header: `${ic.bookOpen(12)} Terms & Usage`,
      body: `<p style="margin-bottom:8px">Deckspace is for the people on this sailing. By using it, you agree to keep things public, respectful, and tied to the shared trip.</p>
      <p style="margin-bottom:8px">Profiles, wall notes, RSVPs, comments, and photos are meant to be visible to other passengers and the staff helping run the sailing. Deckspace is not built for private messaging or hidden communication channels.</p>
      <p>Staff may remove content, pause access, or switch the site into read-only mode when needed for safety, moderation, archive cleanup, or the end of the trip.</p>`
    }),
    module({
      header: `${ic.shield(12)} Acceptable Use`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>No harassment, threats, impersonation, or targeted abuse.</li>
        <li>No posting of explicit, illegal, or non-consensual content.</li>
        <li>No spam, scams, or repeated unwanted promotion.</li>
        <li>No attempts to interfere with the ship board, event page, or moderation tools.</li>
        <li>Respect crew instructions and any onboard policies that apply to the voyage.</li>
      </ul>`
    })
  ].join('');

  return c.html(layoutCtx(c, {
    title: 'Deckspace Terms and Acceptable Usage',
    description: 'Read Deckspace terms, public-usage expectations, acceptable conduct rules, and moderation rights for the sailing community.',
    canonicalUrl: new URL('/terms', c.req.url).toString(),
    user,
    sailing,
    body,
  }));
});

site.get('/sitemap', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const sections = [
    {
      header: `${ic.shipWheel(12)} Main Deck`,
      links: [
        ['/', 'Home'],
        ['/people', 'People'],
        ['/events', 'Events'],
        ['/photos', 'Photos'],
        ['/voyage', 'Voyage'],
      ]
    },
    {
      header: `${ic.bookOpen(12)} Info & Policies`,
      links: [
        ['/about', 'About'],
        ['/contact', 'Contact'],
        ['/privacy', 'Privacy'],
        ['/terms', 'Terms & Usage'],
        ['/sitemap.xml', 'XML Sitemap'],
      ]
    }
  ];

  const body = sections.map((section) => module({
    header: section.header,
    body: `<ul style="margin-left:18px;line-height:1.7">${section.links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>`
  })).join('');

  return c.html(layoutCtx(c, {
    title: 'Deckspace Sitemap',
    description: 'Browse the major Deckspace pages, policy pages, and the XML sitemap for this sailing site.',
    canonicalUrl: new URL('/sitemap', c.req.url).toString(),
    user,
    sailing,
    body,
  }));
});

site.get('/robots.txt', (c) => {
  const origin = new URL(c.req.url).origin;
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(body);
});

site.get('/sitemap.xml', async (c) => {
  const origin = new URL(c.req.url).origin;
  const now = new Date().toISOString();
  const db = getDb(c.env);

  const [usersRes, eventsRes, photosRes] = await Promise.all([
    db.from('users')
      .select('username, created_at')
      .eq('sailing_id', c.env.SAILING_ID)
      .limit(200),
    db.from('events')
      .select('id, updated_at, created_at')
      .eq('sailing_id', c.env.SAILING_ID)
      .eq('moderation_status', 'visible')
      .eq('visibility', 'public')
      .limit(200),
    db.from('photos')
      .select('id, created_at')
      .eq('sailing_id', c.env.SAILING_ID)
      .eq('moderation_status', 'visible')
      .limit(200),
  ]);

  const urls = [
    { loc: '/', lastmod: now },
    { loc: '/login', lastmod: now },
    { loc: '/register', lastmod: now },
    { loc: '/people', lastmod: now },
    { loc: '/events', lastmod: now },
    { loc: '/photos', lastmod: now },
    { loc: '/voyage', lastmod: now },
    { loc: '/about', lastmod: now },
    { loc: '/contact', lastmod: now },
    { loc: '/privacy', lastmod: now },
    { loc: '/terms', lastmod: now },
    { loc: '/sitemap', lastmod: now },
    ...((usersRes.data || []).map((user) => ({
      loc: `/profile/${user.username}`,
      lastmod: user.created_at || now,
    }))),
    ...((eventsRes.data || []).map((event) => ({
      loc: `/events/${event.id}`,
      lastmod: event.updated_at || event.created_at || now,
    }))),
    ...((photosRes.data || []).map((photo) => ({
      loc: `/photos/${photo.id}`,
      lastmod: photo.created_at || now,
    }))),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((entry) => `  <url>\n    <loc>${esc(new URL(entry.loc, origin).toString())}</loc>\n    <lastmod>${esc(new Date(entry.lastmod).toISOString())}</lastmod>\n  </url>`).join('\n')}\n</urlset>`;

  c.header('Content-Type', 'application/xml; charset=utf-8');
  return c.body(xml);
});

export default site;
