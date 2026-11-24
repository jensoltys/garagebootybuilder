// SPDX-License-Identifier: MIT
// Copyright (C) 2026 the Garage Booty Builder authors. See LICENSE.
// Program rails in assets/gbb-today.js. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const GBB = createRequire(import.meta.url)('../assets/gbb-today.js');

const lift = (Date, day, extra = {}) => ({ id: 'r' + Date + day, fields: { Date, 'Day Type': day, Status: 'Completed', ...extra } });

test('the A-B-C order moves on by sessions done, not by the calendar', () => {
  assert.equal(GBB.nextDayLetter([]), 'A');
  assert.equal(GBB.nextDayLetter([lift('2026-01-05', 'A')]), 'B');
  assert.equal(GBB.nextDayLetter([lift('2026-01-05', 'A'), lift('2026-01-20', 'B')]), 'C');
  assert.equal(GBB.nextDayLetter([lift('2026-01-05', 'A'), lift('2026-01-07', 'B'), lift('2026-01-09', 'C')]), 'A');
});

test('a low-battery session counts as a lift and moves the order on', () => {
  assert.equal(GBB.nextDayLetter([lift('2026-01-05', 'Low')]), 'B');
});

test('a short "just one exercise" session keeps the unfinished day next', () => {
  assert.equal(GBB.nextDayLetter([lift('2026-01-05', 'A', { Notes: GBB.SHORT_MARK + '. 1 of 5 exercises.' })]), 'A');
});

test('walks, mat days and unsaved sessions never move the order', () => {
  const rows = [lift('2026-01-05', 'Walk'), lift('2026-01-06', 'Mat'), { id: 'x', fields: { Date: '2026-01-07', 'Day Type': 'A', Status: 'Planned' } }];
  assert.equal(GBB.nextDayLetter(rows), 'A');
});

test('today is a rest day after a lift, done on the day of one, a lift day otherwise', () => {
  const sessions = [lift('2026-01-05', 'A')];
  assert.equal(GBB.decide({ sessions, today: '2026-01-05' }).state, 'done');
  assert.equal(GBB.decide({ sessions, today: '2026-01-06' }).state, 'rest');
  assert.equal(GBB.decide({ sessions, today: '2026-01-07' }).state, 'lift');
  assert.equal(GBB.decide({ sessions: [lift('2026-01-05', 'Walk')], today: '2026-01-06' }).state, 'lift');
});

test('program week counts from the first saved session', () => {
  assert.equal(GBB.programWeek(null, '2026-03-01'), 1);
  const game = { fields: { 'Program Start Date': '2026-01-05' } };
  assert.equal(GBB.programWeek(game, '2026-01-11'), 1);
  assert.equal(GBB.programWeek(game, '2026-01-12'), 2);
});

test('a start date that is not a real day counts as no start date', () => {
  assert.equal(GBB.programWeek({ fields: { 'Program Start Date': '9999-99-99' } }, '2026-03-01'), 1);
  assert.equal(GBB.programWeek({ fields: { 'Program Start Date': '0000-00-00' } }, '2026-03-01'), 1);
  assert.equal(GBB.inDeload({ fields: { 'Deload Until': '2026-99-99' } }, '2026-03-01'), false);
});

test('every 7th week is a deload, and an accepted deload runs to its end date', () => {
  const game = { fields: { 'Program Start Date': '2026-01-05' } };
  assert.equal(GBB.inDeload(game, '2026-02-16'), true);   // week 7
  assert.equal(GBB.inDeload(game, '2026-02-23'), false);  // week 8
  const accepted = { fields: { 'Program Start Date': '2026-01-05', 'Deload Until': '2026-01-20' } };
  assert.equal(GBB.inDeload(accepted, '2026-01-20'), true);
  assert.equal(GBB.inDeload(accepted, '2026-01-21'), false);
});

test('set counts drop to 2 on low battery, deloads and the first two weeks', () => {
  const ex = { Sets: 3 };
  assert.equal(GBB.targetSets(ex, 5, 1, false), 2);
  assert.equal(GBB.targetSets(ex, 5, 4, true), 2);
  assert.equal(GBB.targetSets(ex, 2, 4, false), 2);
  assert.equal(GBB.targetSets(ex, 3, 4, false), 3);
});

test('the first two exercises of a day get the longer rest', () => {
  assert.equal(GBB.restSecs({ Slot: 1 }), 180);
  assert.equal(GBB.restSecs({ Slot: 2 }), 180);
  assert.equal(GBB.restSecs({ Slot: 4 }), 150);
});
