// SPDX-License-Identifier: MIT
// Copyright (C) 2026 the Garage Booty Builder authors. See LICENSE.
// Checks program.js after you edit it. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../program.js', import.meta.url), 'utf8'), { window });
const P = window.GBB_PROGRAM;

test('every exercise has a unique, safe id', () => {
  const ids = P.exercises.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  ids.forEach(id => assert.match(id, /^[A-Za-z0-9-]{1,40}$/, `bad id ${id}`));
});

test('every day has exercises, and slots are unique inside a day', () => {
  for (const day of ['A', 'B', 'C']) {
    const slots = P.exercises.filter(e => e.day === day).map(e => e.slot);
    assert.ok(slots.length > 0, `day ${day} is empty`);
    assert.equal(new Set(slots).size, slots.length, `day ${day} repeats a slot`);
    assert.ok(P.dayTitles[day], `day ${day} has no title`);
  }
  P.exercises.forEach(e => assert.ok(['A', 'B', 'C'].includes(e.day), `${e.name}: day must be A, B or C`));
});

test('numbers are numbers and video links are https', () => {
  for (const e of P.exercises) {
    assert.ok(e.name && e.repText && e.cue, `${e.id}: name, repText and cue are required`);
    assert.ok(Number.isInteger(e.sets) && e.sets > 0, `${e.id}: sets`);
    for (const k of ['repLow', 'repHigh', 'startWeight', 'weightStep']) {
      if (e[k] != null) assert.ok(typeof e[k] === 'number' && e[k] > 0, `${e.id}: ${k}`);
    }
    if (e.videoUrl != null) assert.match(e.videoUrl, /^https:\/\//, `${e.id}: videoUrl must be https`);
  }
});

test('start weights are a multiple of the weight step, so the app shows the number you wrote', () => {
  for (const e of P.exercises) {
    if (e.startWeight == null) continue;
    const step = e.weightStep || 2.5;
    assert.equal(Math.round(e.startWeight / step) * step, e.startWeight, `${e.id}: startWeight ${e.startWeight} isn't a multiple of ${step}`);
  }
});

test('there is a low-battery session and a warm-up', () => {
  assert.ok(P.exercises.some(e => e.inLowSession), 'mark at least one exercise inLowSession');
  assert.ok(P.warmup.length > 0 && P.matDay.length > 0);
});
