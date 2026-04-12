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
  const questions = [
    {
      question: 'What is DeckSpace?',
      answer: 'DeckSpace is a public sailing page for events, photos, profiles, wall posts, and short-term trip archives.'
    },
    {
      question: 'Why is activity public?',
      answer: 'The platform is built to be easier to follow, easier to moderate, and easier for passengers and staff to understand during a live trip.'
    },
    {
      question: 'How long does a sailing page stay up?',
      answer: 'The page stays active during the sailing and may remain in read-only mode for a short archive period after the trip.'
    }
  ];

  const body = pageShell({
    intro: introCard({
      kicker: `${ic.shipWheel(12)} About DeckSpace`,
      title: 'A temporary cruise community site built for one shared trip.',
      body: 'DeckSpace gives passengers one public place to keep up with events, meet people, share photos, and leave public notes while the sailing is still happening. It is meant to be useful first, social second, and easy to understand on a phone.'
    }),
    sections: [
      module({
        header: `${ic.users(12)} What DeckSpace Covers`,
        body: bulletList([
          'Public passenger profiles and Friend Space connections',
          'Official programming and passenger-made plans',
          'Shared photo drops tied to the sailing',
          'Public wall notes, comments, and activity',
          'A short read-only archive after the trip ends'
        ])
      }),
      module({
        header: `${ic.shield(12)} Why It Stays Public`,
        body: bulletList([
          'Passengers can see what is happening without learning a hidden messaging system.',
          'Crew and moderators can review public activity more quickly when something needs attention.',
          'Shared visibility makes the platform easier to manage during a live event.',
          'The focus stays on plans, shared moments, and trip context instead of private threads.'
        ])
      }),
      faqModule(`${ic.info(12)} Quick Answers`, questions)
    ]
  });

  return c.html(layoutCtx(c, {
    title: 'About DeckSpace',
    description: 'Learn what DeckSpace is, how the public sailing page works, and why profiles, events, photos, and trip archives are organized around one shared cruise experience.',
    canonicalUrl: new URL('/about', c.req.url).toString(),
    user,
    sailing,
    body,
    structuredData: [
      pageTypeSchema(c.req.url, 'AboutPage'),
      faqSchema(c.req.url, questions),
    ],
  }));
});

site.get('/contact', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const shipName = sailing?.ship_name || 'your ship';
  const questions = [
    {
      question: 'Where should I go first for help during a sailing?',
      answer: `Start with Guest Services or the onboard team supporting ${shipName}. They are usually the fastest path for live trip issues.`
    },
    {
      question: 'What should I report through DeckSpace tools?',
      answer: 'Report login trouble, wrong voyage information, public-content issues, and safety concerns that need moderator review.'
    },
    {
      question: 'Can I request content removal?',
      answer: 'Yes. Public content can be reviewed and removed when it violates policy, needs moderation, or should not stay on the page.'
    }
  ];

  const body = pageShell({
    intro: introCard({
      kicker: `${ic.mail(12)} Help & Support`,
      title: 'Clear support paths for account, safety, and content issues.',
      body: `If you are on ${esc(shipName)}, start with the onboard team for live sailing help. Use DeckSpace report tools when you need account help, content review, or a second look from moderation staff.`
    }),
    sections: [
      module({
        header: `${ic.info(12)} What We Can Help With`,
        body: bulletList([
          'Sign-in and account setup problems',
          'Wrong voyage, weather, or event information',
          'Public content review and moderation requests',
          'Questions about archives, retention, or page availability',
          'Accessibility feedback for mobile or desktop use'
        ])
      }),
      module({
        header: `${ic.flag(12)} Safety & Reporting`,
        body: bulletList([
          'Use report links on profiles, events, photos, and comments when something needs review.',
          'For urgent onboard safety matters, contact ship staff directly before using DeckSpace.',
          'Moderators may remove content, pause access, or preserve records while a report is reviewed.'
        ])
      }),
      module({
        header: `${ic.clock(12)} What To Expect`,
        body: `<div class="site-copy-stack">
          <p>Live trip issues should go through onboard staff first.</p>
          <p>Platform reports are reviewed as quickly as practical during the sailing and during the short archive period after it ends.</p>
          <p>DeckSpace is designed to keep support paths simple: public reporting, clear moderation, and no hidden messaging layer.</p>
        </div>`
      }),
      faqModule(`${ic.bookOpen(12)} Quick Answers`, questions)
    ]
  });

  return c.html(layoutCtx(c, {
    title: 'DeckSpace Help and Support',
    description: 'Get DeckSpace help for sign-in issues, moderation requests, safety reporting, voyage corrections, archive questions, and accessibility feedback during a sailing.',
    canonicalUrl: new URL('/contact', c.req.url).toString(),
    user,
    sailing,
    body,
    structuredData: [
      pageTypeSchema(c.req.url, 'ContactPage'),
      faqSchema(c.req.url, questions),
    ],
  }));
});

site.get('/privacy', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const questions = [
    {
      question: 'Who can see my DeckSpace activity?',
      answer: 'DeckSpace is meant to be public to the sailing, so profiles, wall posts, RSVPs, and shared photos can be seen by other passengers and staff supporting the trip.'
    },
    {
      question: 'How long does my content stay up?',
      answer: 'Content stays available during the sailing and may remain visible during a short read-only archive window after the trip.'
    },
    {
      question: 'Does DeckSpace offer private messaging?',
      answer: 'No. The platform is intentionally public and does not include private messaging.'
    }
  ];

  const body = pageShell({
    intro: introCard({
      kicker: `${ic.lock(12)} Privacy`,
      title: 'DeckSpace is public to the sailing by design.',
      body: 'Profiles, photos, RSVPs, wall posts, and comments are built to be visible to other passengers on the same trip. The platform is designed this way to keep participation simple and moderation easier to manage.'
    }),
    sections: [
      module({
        header: `${ic.list(12)} Information Used On The Site`,
        body: bulletList([
          'Basic account details such as display name, username, and profile information',
          'Public activity such as RSVPs, comments, wall notes, and shared photos',
          'Trip-specific content such as event attendance and profile updates',
          'Moderation and reporting records when content needs review'
        ])
      }),
      module({
        header: `${ic.user(12)} Visibility & Retention`,
        body: bulletList([
          'DeckSpace stays active during the sailing.',
          'After the trip, the page may remain available in read-only mode for a short archive period.',
          'When the archive window closes, the sailing page is taken down from normal public access.',
          'Reported or moderated content may be reviewed during the live and archive periods.'
        ])
      }),
      module({
        header: `${ic.user(12)} Your Choices`,
        body: `<div class="site-copy-stack">
          <p>You can update your profile, change what you post, and remove some of your own content while the sailing is active.</p>
          <p>If you need a content review or removal request, use the reporting tools or contact support through the help page.</p>
          <p>DeckSpace is not designed to hide participation from the rest of the sailing, so think of it as a shared trip board rather than a private account space.</p>
        </div>`
      }),
      faqModule(`${ic.info(12)} Quick Answers`, questions)
    ]
  });

  return c.html(layoutCtx(c, {
    title: 'DeckSpace Privacy Policy',
    description: 'Read how DeckSpace handles public trip activity, profile visibility, content retention, archive timing, moderation review, and privacy choices for a sailing community.',
    canonicalUrl: new URL('/privacy', c.req.url).toString(),
    user,
    sailing,
    body,
    structuredData: [
      pageTypeSchema(c.req.url, 'WebPage'),
      faqSchema(c.req.url, questions),
    ],
  }));
});

site.get('/terms', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const questions = [
    {
      question: 'Who may use DeckSpace?',
      answer: 'DeckSpace is for passengers, crew, moderators, and approved staff connected to the sailing or event.'
    },
    {
      question: 'What content is not allowed?',
      answer: 'Harassment, threats, impersonation, non-consensual content, illegal material, scams, spam, and attempts to disrupt the platform are not allowed.'
    },
    {
      question: 'Can staff remove content or close access?',
      answer: 'Yes. Staff may remove content, restrict features, or pause access when needed for moderation, safety, operations, or the end of the trip.'
    }
  ];

  const body = pageShell({
    intro: introCard({
      kicker: `${ic.bookOpen(12)} Terms & Usage`,
      title: 'Clear rules for a public trip community.',
      body: 'By using DeckSpace, you agree to use the platform in a way that supports the shared trip, follows crew instructions, and respects other passengers and staff.'
    }),
    sections: [
      module({
        header: `${ic.userCheck(12)} Who This Platform Is For`,
        body: bulletList([
          'Passengers and approved participants on the sailing',
          'Crew, moderators, and staff supporting the event',
          'Guests using the platform for public trip activity rather than private messaging'
        ])
      }),
      module({
        header: `${ic.shield(12)} Acceptable Use`,
        body: bulletList([
          'Be respectful and do not target, threaten, or harass other people.',
          'Do not post explicit, illegal, deceptive, or non-consensual content.',
          'Do not impersonate another person, staff member, or brand.',
          'Do not spam the page, run scams, or repeatedly promote unwanted content.',
          'Do not interfere with moderation tools, sailing data, or the normal operation of the site.'
        ])
      }),
      module({
        header: `${ic.settings(12)} Moderation & Service Operation`,
        body: `<div class="site-copy-stack">
          <p>Staff may hide, remove, or review content when it violates policy or needs a safety check.</p>
          <p>Features may change during the sailing, and the site may move into read-only mode when the trip ends.</p>
          <p>DeckSpace is a live event platform. Availability may vary based on connectivity, ship operations, and moderation needs.</p>
        </div>`
      }),
      faqModule(`${ic.info(12)} Quick Answers`, questions)
    ]
  });

  return c.html(layoutCtx(c, {
    title: 'DeckSpace Terms and Usage',
    description: 'Read the DeckSpace terms covering who may use the platform, acceptable behavior, public-content rules, moderation authority, and trip-based service limits.',
    canonicalUrl: new URL('/terms', c.req.url).toString(),
    user,
    sailing,
    body,
    structuredData: [
      pageTypeSchema(c.req.url, 'WebPage'),
      faqSchema(c.req.url, questions),
    ],
  }));
});

site.get('/accessibility', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const body = pageShell({
    intro: introCard({
      kicker: `${ic.check(12)} Accessibility`,
      title: 'DeckSpace should stay usable on phones, keyboards, and standard browsers.',
      body: 'The platform is built to work on mobile devices first, including common iPhone usage, and to remain understandable for keyboard and screen-reader users where practical.'
    }),
    sections: [
      module({
        header: `${ic.camera(12)} Mobile Use`,
        body: bulletList([
          'Primary actions are designed for small screens and touch targets.',
          'Photo upload, profile editing, events, and navigation are intended to work cleanly on iPhone-sized screens.',
          'Responsive layouts are used so the site stays readable without zooming.'
        ])
      }),
      module({
        header: `${ic.list(12)} Keyboard & Readability`,
        body: bulletList([
          'The site includes a skip link for faster keyboard navigation.',
          'Public pages use headings, labels, alt text, and visible focus treatment where possible.',
          'Design choices are reviewed to keep contrast, spacing, and tap targets workable across devices.'
        ])
      }),
      module({
        header: `${ic.mail(12)} Accessibility Feedback`,
        body: `<div class="site-copy-stack">
          <p>If something is hard to use, missing, or unclear, contact support through the help page.</p>
          <p>Include the page, device, and issue so the team can reproduce it quickly.</p>
        </div>`
      })
    ]
  });

  return c.html(layoutCtx(c, {
    title: 'DeckSpace Accessibility',
    description: 'Review the DeckSpace accessibility approach for mobile-first use, keyboard access, readable layouts, and support for reporting issues that affect access.',
    canonicalUrl: new URL('/accessibility', c.req.url).toString(),
    user,
    sailing,
    body,
    structuredData: pageTypeSchema(c.req.url, 'WebPage'),
  }));
});

site.get('/guidelines', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const body = pageShell({
    intro: introCard({
      kicker: `${ic.heart(12)} Community Guidelines`,
      title: 'Use DeckSpace in a way that keeps the trip welcoming and easy to follow.',
      body: 'DeckSpace works best when people use it to share plans, photos, and public updates without making the platform harder or less safe for everyone else on board.'
    }),
    sections: [
      module({
        header: `${ic.users(12)} Treat People Well`,
        body: bulletList([
          'Be respectful in profiles, comments, and wall notes.',
          'Do not harass, pressure, threaten, or target other passengers.',
          'Do not post private or non-consensual information about someone else.'
        ])
      }),
      module({
        header: `${ic.camera(12)} Share Media Responsibly`,
        body: bulletList([
          'Only upload photos you have a right to share.',
          'Do not post explicit, illegal, or exploitative media.',
          'Use captions and event links in a way that matches what the photo actually shows.'
        ])
      }),
      module({
        header: `${ic.flag(12)} Reports & Moderation`,
        body: bulletList([
          'Use report tools when content needs review.',
          'Moderators may remove content, lock accounts, or preserve records while a report is reviewed.',
          'Repeat abuse, spam, or platform interference may lead to access limits or removal.'
        ])
      })
    ]
  });

  return c.html(layoutCtx(c, {
    title: 'DeckSpace Community Guidelines',
    description: 'Read the DeckSpace community guidelines for respectful public participation, media sharing, reporting, moderation, and healthy sailing-page behavior.',
    canonicalUrl: new URL('/guidelines', c.req.url).toString(),
    user,
    sailing,
    body,
    structuredData: pageTypeSchema(c.req.url, 'WebPage'),
  }));
});

site.get('/sitemap', async (c) => {
  const user = await resolveSession(c.env, c.req.raw).catch(() => null);
  const db = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);

  const sections = [
    {
      header: `${ic.shipWheel(12)} Main Pages`,
      links: [
        ['/', 'Home'],
        ['/people', 'People'],
        ['/events', 'Events'],
        ['/photos', 'Photos'],
        ['/voyage', 'Voyage'],
      ]
    },
    {
      header: `${ic.info(12)} Help & Company`,
      links: [
        ['/about', 'About'],
        ['/contact', 'Help'],
        ['/accessibility', 'Accessibility'],
      ]
    },
    {
      header: `${ic.bookOpen(12)} Policies`,
      links: [
        ['/privacy', 'Privacy'],
        ['/terms', 'Terms & Usage'],
        ['/guidelines', 'Community Guidelines'],
        ['/sitemap.xml', 'XML Sitemap'],
      ]
    },
    {
      header: `${ic.user(12)} Account`,
      links: [
        ['/login', 'Sign In'],
        ['/register', 'Join DeckSpace'],
      ]
    }
  ];

  const body = pageShell({
    intro: introCard({
      kicker: `${ic.list(12)} Sitemap`,
      title: 'A simple index of the main public pages on DeckSpace.',
      body: 'Use this page to jump to the major product, help, and policy pages. Search engines can use the XML sitemap for crawl discovery.'
    }),
    sections: sections.map((section) => module({
      header: section.header,
      body: linkList(section.links)
    }))
  });

  return c.html(layoutCtx(c, {
    title: 'DeckSpace Sitemap',
    description: 'Browse the main DeckSpace product pages, help pages, policy pages, and XML sitemap for the sailing site.',
    canonicalUrl: new URL('/sitemap', c.req.url).toString(),
    user,
    sailing,
    body,
    structuredData: pageTypeSchema(c.req.url, 'CollectionPage'),
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
    { loc: '/people', lastmod: now },
    { loc: '/events', lastmod: now },
    { loc: '/photos', lastmod: now },
    { loc: '/voyage', lastmod: now },
    { loc: '/about', lastmod: now },
    { loc: '/contact', lastmod: now },
    { loc: '/privacy', lastmod: now },
    { loc: '/terms', lastmod: now },
    { loc: '/accessibility', lastmod: now },
    { loc: '/guidelines', lastmod: now },
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

function pageShell({ intro, sections }) {
  return `<div class="site-page-shell">
    ${intro}
    <div class="site-page-grid">
      ${sections.join('')}
    </div>
  </div>`;
}

function introCard({ kicker, title, body }) {
  return `<section class="site-intro-card">
    <div class="site-intro-kicker">${kicker}</div>
    <h2 class="site-intro-title">${title}</h2>
    <p class="site-intro-body">${body}</p>
  </section>`;
}

function bulletList(items) {
  return `<ul class="site-list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function linkList(items) {
  return `<ul class="site-link-list">${items.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>`;
}

function faqModule(header, items) {
  return module({
    header,
    body: `<dl class="site-faq-list">${items.map((item) => `<div class="site-faq-item"><dt>${item.question}</dt><dd>${item.answer}</dd></div>`).join('')}</dl>`
  });
}

function pageTypeSchema(url, type) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    url: new URL(url).toString(),
    name: type === 'CollectionPage' ? 'DeckSpace Sitemap' : undefined,
  };
}

function faqSchema(url, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: new URL(url).toString(),
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export default site;
