/**
 * Deckspace — Voyage / Itinerary page
 *
 * GET  /voyage  — public voyage schedule
 */

import { Hono } from 'hono';
import { getDb, getSailing, getVoyageDays } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { layout, layoutCtx, esc, fmtDate } from '../templates/layout.js';
import { module } from '../templates/components.js';
import { ic } from '../templates/icons.js';

const voyage = new Hono();

const DAY_TYPE_ICON = {
  embarkation:    () => ic.anchor(14),
  sea:            () => ic.ship(14),
  port:           () => ic.compass(14),
  disembarkation: () => ic.logOut(14),
};
const DAY_TYPE_LABEL = {
  embarkation:    'Embarkation Day',
  sea:            'Sea Day',
  port:           'Port Day',
  disembarkation: 'Disembarkation Day',
};

voyage.get('/voyage', async (c) => {
  const viewer  = await resolveSession(c.env, c.req.raw);
  const db      = getDb(c.env);
  const sailing = await getSailing(db, c.env.SAILING_ID).catch(() => null);
  const days    = await getVoyageDays(db, c.env.SAILING_ID);

  const today = new Date().toISOString().slice(0, 10);
  const todayIndex = days.findIndex((day) => day.day_date === today);
  const nextPort = days.find((day) => day.day_type === 'port' && day.day_date >= today) || days.find((day) => day.day_type === 'port') || null;
  const seaDays = days.filter((day) => day.day_type === 'sea').length;
  const portDays = days.filter((day) => day.day_type === 'port').length;
  const openAnchor = todayIndex >= 0 ? `voyage-${today}` : (days[0] ? `voyage-${days[0].day_date}` : '');

  const scheduleHtml = days.length
    ? days.map((day, index) => {
        const isToday = day.day_date === today;
        const typeLbl = DAY_TYPE_LABEL[day.day_type] || day.day_type;
        const typeIcon = DAY_TYPE_ICON[day.day_type] ? DAY_TYPE_ICON[day.day_type]() : '';
        const timeHtml = (day.arrive_time || day.depart_time)
          ? `<div class="voyage-times">
              ${day.arrive_time ? `<span>${ic.anchor(11)} In ${day.arrive_time}</span>` : ''}
              ${day.depart_time ? `<span>${ic.ship(11)} Out ${day.depart_time}</span>` : ''}
            </div>` : '<div class="voyage-times"><span>No set times today. Just enjoy the day.</span></div>';
        return `<details class="voyage-day${isToday ? ' voyage-today' : ''}" id="voyage-${day.day_date}"${openAnchor === `voyage-${day.day_date}` ? ' open' : ''}>
  <summary class="voyage-day-summary">
    <div class="voyage-day-step">${index + 1}</div>
    <div class="voyage-day-head">
      <div class="voyage-day-date">${isToday ? '<strong>TODAY</strong> &middot; ' : ''}${fmtDate(day.day_date)}</div>
      <div class="voyage-day-port">${typeIcon} <strong>${esc(day.port_name)}</strong> <span class="voyage-day-type">${esc(typeLbl)}</span></div>
    </div>
    <div class="voyage-day-toggle">${day.arrive_time || day.depart_time ? 'Times' : 'Details'}</div>
  </summary>
  <div class="voyage-day-body">
    ${timeHtml}
    ${day.notes ? `<div class="voyage-day-notes">${esc(day.notes)}</div>` : `<div class="voyage-day-notes">No extra notes for this stop. Let the day reveal itself.</div>`}
  </div>
</details>`;
      }).join('')
    : `<div class="ds-empty-state">
        The voyage plan is not up yet. Stop back soon.
      </div>`;

  const sailingInfo = sailing
    ? `<section class="voyage-command">
        <div class="voyage-command-copy">
          <div class="voyage-ship">${ic.ship(16)} ${esc(sailing.ship_name)}</div>
          <div class="voyage-name">${esc(sailing.name)}</div>
          <p class="voyage-command-sub">Sea days, port stops, and the quick answers everyone ends up needing at least once.</p>
        </div>
        <div class="voyage-command-stats">
          <div class="voyage-command-stat"><strong>${days.length}</strong><span>days on deck</span></div>
          <div class="voyage-command-stat"><strong>${portDays}</strong><span>port calls</span></div>
          <div class="voyage-command-stat"><strong>${seaDays}</strong><span>sea days</span></div>
          <div class="voyage-command-stat"><strong>${nextPort ? esc(nextPort.port_name) : 'TBD'}</strong><span>next port</span></div>
        </div>
      </section>` : '';

  const voyageStrip = days.length
    ? `<div class="voyage-strip">
        ${days.map((day, index) => `<a href="#voyage-${day.day_date}" class="voyage-strip-stop${day.day_date === today ? ' active' : ''}">
          <span>Day ${index + 1}</span>
          <strong>${esc(day.port_name)}</strong>
        </a>`).join('')}
      </div>`
    : '';

  const body = `${sailingInfo}${voyageStrip}
${module({
  header: `${ic.shipWheel(12)} Voyage Schedule`,
  body: `<div class="voyage-schedule">${scheduleHtml}</div>`
})}`;

  return c.html(layoutCtx(c, {
    title: 'Voyage Schedule and Port Planner',
    description: `View the voyage schedule, ports, sea days, arrival times, and daily itinerary for ${sailing?.name || 'this sailing'} on ${sailing?.ship_name || 'the ship'}.`,
    user: viewer,
    sailing,
    activeNav: 'voyage',
    body,
  }));
});

export default voyage;
