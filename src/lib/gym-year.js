/**
 * Pure helpers for the GitHub-style gym year grid on /now. Shared by the
 * page's client script and the node tests, so no DOM and no Date locale:
 * every date is a 'YYYY-MM-DD' string handled in UTC.
 */
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);

/** Monday on or before the given day. */
export function mondayOf(dateStr) {
  const d = parse(dateStr);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
}

/** Gym days in the Monday-anchored week containing `dateStr`. */
export function weekCount(dates, dateStr) {
  const start = mondayOf(dateStr);
  const end = iso(new Date(parse(start).valueOf() + 6 * DAY));
  return dates.filter((d) => d >= start && d <= end).length;
}

/** Years to offer in the picker: earliest data year through the current one. */
export function yearRange(dates, currentYear) {
  const years = dates.map((d) => Number(d.slice(0, 4))).filter((y) => y < currentYear);
  const first = years.length ? Math.min(...years) : currentYear;
  return Array.from({ length: currentYear - first + 1 }, (_, i) => first + i);
}

/**
 * Lay out one calendar year as columns of Monday-to-Sunday weeks. Cells
 * outside the year are null so the grid can leave them blank.
 */
export function buildYear(dates, year) {
  const on = new Set(dates.filter((d) => d.startsWith(`${year}-`)));
  const first = parse(mondayOf(`${year}-01-01`));
  const lastDay = parse(`${year}-12-31`);
  const weeks = [];
  const months = MONTHS.map((label) => ({ label, col: -1, count: 0 }));
  for (let cur = new Date(first); cur <= lastDay; cur.setUTCDate(cur.getUTCDate() + 7)) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(cur.valueOf() + i * DAY);
      if (day.getUTCFullYear() !== year) {
        week.push(null);
        continue;
      }
      const date = iso(day);
      const m = months[day.getUTCMonth()];
      if (day.getUTCDate() === 1) m.col = weeks.length;
      if (on.has(date)) m.count++;
      week.push({ date, on: on.has(date) });
    }
    weeks.push(week);
  }
  return { year, total: on.size, weeks, months };
}
