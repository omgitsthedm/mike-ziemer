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

  const scheduleHtml = days.length
    ? days.map(day => {
        const isToday = day.day_date === today;
        const typeLbl = DAY_TYPE_LABEL[day.day_type] || day.day_type;
        const typeIcon = DAY_TYPE_ICON[day.day_type] ? DAY_TYPE_ICON[day.day_type]() : '';
        const timeHtml = (day.arrive_time || day.depart_time)
          ? `<div class="voyage-times">
              ${day.arrive_time ? `${ic.anchor(11)} Arrive ${day.arrive_time}` : ''}
              ${day.arrive_time && day.depart_time ? ' &mdash; ' : ''}
              ${day.depart_time ? `Depart ${day.depart_time} ${ic.ship(11)}` : ''}
            </div>` : '';
        return `<div class="voyage-day${isToday ? ' voyage-today' : ''}">
  <div class="voyage-day-date">${isToday ? '<strong>TODAY &mdash; </strong>' : ''}${fmtDate(day.day_date)}</div>
  <div class="voyage-day-port">${typeIcon} <strong>${esc(day.port_name)}</strong> <span class="voyage-day-type">${esc(typeLbl)}</span></div>
  ${timeHtml}
  ${day.notes ? `<div class="voyage-day-notes">${esc(day.notes)}</div>` : ''}
</div>`;
      }).join('')
    : `<div class="ds-empty-state">
        The voyage schedule hasn't been published yet. Check back soon!
      </div>`;

  const sailingInfo = sailing
    ? `<div class="voyage-header">
        <div class="voyage-ship">${ic.ship(16)} ${esc(sailing.ship_name)}</div>
        <div class="voyage-name">${esc(sailing.name)}</div>
      </div>` : '';

  const body = `${sailingInfo}
${module({
  header: `${ic.shipWheel(12)} Voyage Schedule`,
  body: `<div class="voyage-schedule">${scheduleHtml}</div>`
})}`;

  return c.html(layoutCtx(c, {
    title: 'Voyage',
    user: viewer,
    sailing,
    activeNav: 'voyage',
    body,
  }));
});

export default voyage;
