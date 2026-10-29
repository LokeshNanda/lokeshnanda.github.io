import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildYear, yearRange, mondayOf, weekCount } from '../src/lib/gym-year.js';

test('mondayOf anchors any day to its Monday', () => {
  assert.equal(mondayOf('2026-10-29'), '2026-10-26'); // Thu
  assert.equal(mondayOf('2026-10-26'), '2026-10-26'); // Mon
  assert.equal(mondayOf('2026-11-01'), '2026-10-26'); // Sun
});

test('buildYear lays out full weeks from the Monday before Jan 1', () => {
  const y = buildYear(['2026-01-01', '2026-01-02', '2026-12-31'], 2026);
  assert.equal(y.year, 2026);
  assert.equal(y.total, 3);
  // 2026-01-01 is a Thursday, so the first column starts Mon 2025-12-29
  assert.equal(y.weeks[0][0], null);
  assert.equal(y.weeks[0][2], null);
  assert.deepEqual(y.weeks[0][3], { date: '2026-01-01', on: true });
  assert.deepEqual(y.weeks[0][4], { date: '2026-01-02', on: true });
  assert.deepEqual(y.weeks[0][5], { date: '2026-01-03', on: false });
  // last column ends Sun 2027-01-03; 2026-12-31 is a Thursday
  const last = y.weeks.at(-1);
  assert.deepEqual(last[3], { date: '2026-12-31', on: true });
  assert.equal(last[4], null);
  assert.equal(y.weeks.length, 53);
  for (const w of y.weeks) assert.equal(w.length, 7);
});

test('buildYear ignores dates outside the year and counts per month', () => {
  const y = buildYear(['2025-12-31', '2026-03-01', '2026-03-15', '2026-03-31', '2027-01-01'], 2026);
  assert.equal(y.total, 3);
  assert.equal(y.months.length, 12);
  assert.deepEqual(y.months[2], { label: 'Mar', col: 8, count: 3 });
  assert.deepEqual(y.months[0], { label: 'Jan', col: 0, count: 0 });
});

test('yearRange spans earliest data year to the current year', () => {
  assert.deepEqual(yearRange(['2025-06-01', '2026-02-02'], 2026), [2025, 2026]);
  assert.deepEqual(yearRange([], 2026), [2026]);
  assert.deepEqual(yearRange(['2026-02-02'], 2026), [2026]);
  // future-dated junk never extends past the current year
  assert.deepEqual(yearRange(['2030-01-01'], 2026), [2026]);
});

test('weekCount counts dates in the Monday-anchored week of a day', () => {
  const dates = ['2026-10-26', '2026-10-28', '2026-11-02'];
  assert.equal(weekCount(dates, '2026-10-29'), 2);
  assert.equal(weekCount(dates, '2026-11-01'), 2);
  assert.equal(weekCount(dates, '2026-11-02'), 1);
});
