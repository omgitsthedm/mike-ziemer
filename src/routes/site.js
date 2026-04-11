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
      body: `<p style="margin-bottom:8px">Deckspace is a public-by-design cruise intranet with a temporary social layer. It gives one sailing a shared place to see what is happening, meet other passengers, post on each other&rsquo;s pages, RSVP to events, and share photos while the trip is still alive.</p>
      <p style="margin-bottom:8px">The nostalgia is intentional. Deckspace borrows the energy of 2006 social web culture, then applies it to a safer cruise setting: no private messages, no hidden backchannels, and no algorithmic feed.</p>
      <p>It is designed to be useful first, social second, and short-lived by default. After the voyage, the site shifts into a read-only scrapbook for a limited time before it closes.</p>`
    }),
    module({
      header: `${ic.shield(12)} Why It Is Public`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>Everyone on the sailing can see the same community activity.</li>
        <li>Crew and moderators can spot issues quickly.</li>
        <li>Passengers do not need to learn a private messaging system to participate.</li>
        <li>The product stays lightweight, social, and easier to operate safely.</li>
      </ul>`
    })
  ].join('');

  return c.html(layoutCtx(c, {
    title: 'About the Deckspace Cruise Network',
    description: 'Learn what Deckspace is: a temporary cruise social network for events, profiles, photos, and a short post-cruise scrapbook.',
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
      body: `<p style="margin-bottom:8px">If you are on <strong>${esc(shipName)}</strong> and need help with Deckspace, start with Guest Services or the onboard team managing the sailing bulletin, weather, and event board.</p>
      <p style="margin-bottom:8px">For account lookup, moderation concerns, or content issues, use the built-in report tools on profiles, photos, and other public content wherever available.</p>
      <p>Deckspace is intended to be run as part of a sailing experience, so the fastest help usually comes from staff already supporting the voyage.</p>`
    }),
    module({
      header: `${ic.info(12)} What Support Covers`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>Account access and registration issues</li>
        <li>Public-content moderation and safety concerns</li>
        <li>Incorrect sailing bulletin, weather, or voyage information</li>
        <li>Questions about how long the archive will remain visible after the trip</li>
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
      body: `<p style="margin-bottom:8px"><strong>Deckspace is public to the sailing by design.</strong> Profiles, wall posts, event RSVPs, and shared photos are intended to be visible to other passengers on the same voyage.</p>
      <p style="margin-bottom:8px">Deckspace does not provide private messaging. The product is designed around open activity so moderation and onboard safety are easier to manage.</p>
      <p>Basic account details, profile content, photos, and activity are stored only for the sailing experience and its short read-only archive window unless the operator removes them sooner.</p>`
    }),
    module({
      header: `${ic.bookOpen(12)} Retention & Archive`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>Deckspace stays active during the sailing.</li>
        <li>After the trip, the site may remain available in read-only mode for a limited archive period.</li>
        <li>Once the archive closes, the sailing community is expected to be taken offline.</li>
        <li>Reportable content can be reviewed or removed by staff during the active or archive window.</li>
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
      body: `<p style="margin-bottom:8px">Deckspace is intended for the active sailing community attached to this voyage. By using the site, you agree to keep your participation public, respectful, and tied to the shared onboard experience.</p>
      <p style="margin-bottom:8px">Profiles, wall notes, RSVPs, comments, and photos are meant to be visible to other passengers and staff supporting the sailing. The product is not designed for private messaging or hidden side channels.</p>
      <p>Operators may remove content, suspend access, or place the site into read-only mode when needed for safety, moderation, archive handling, or the end of the voyage.</p>`
    }),
    module({
      header: `${ic.shield(12)} Acceptable Use`,
      body: `<ul style="margin-left:18px;line-height:1.6">
        <li>No harassment, threats, impersonation, or targeted abuse.</li>
        <li>No posting of explicit, illegal, or non-consensual content.</li>
        <li>No spam, scam behavior, or repeated unwanted promotion.</li>
        <li>No attempts to disrupt the sailing bulletin, event board, or moderation tools.</li>
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
