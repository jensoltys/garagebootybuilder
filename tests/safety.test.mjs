// SPDX-License-Identifier: MIT
// Copyright (C) 2026 the Garage Booty Builder authors. See LICENSE.
// Hostile-input checks. The only outside data the page ever reads is its own storage and a
// restore file, so these feed it bad versions of both. app.js runs here against a stand-in
// for the browser: every element is a do-nothing stub that records the HTML written to it.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MARKUP = `"><img src=x onerror="window.pwned=1"><script>window.pwned=1</script>'`;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// Boots the app with the given storage contents. Returns { run, html, storage }.
async function boot(stored = {}) {
  const storage = new Map(Object.entries(stored).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const html = [];
  const stub = () => new Proxy(function () {}, {
    get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub(),
    set: (t, k, v) => { if (k === 'innerHTML') html.push(String(v)); return true; },
    apply: () => stub()
  });
  const box = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, innerWidth: 390, innerHeight: 844,
    document: stub(), matchMedia: () => ({ matches: true }), navigator: {}, addEventListener() {}, scrollTo() {}, print() {},
    confirm: () => true, requestAnimationFrame() {}, location: { reload() {} },
    history: { state: null, pushState() {}, replaceState() {}, back() {} },
    localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => { storage.set(k, String(v)); }, removeItem: k => { storage.delete(k); } }
  };
  box.window = box;
  const ctx = vm.createContext(box);
  for (const f of ['program.js', 'assets/gbb-today.js', 'assets/georgia.js', 'app.js']) vm.runInContext(read(f), ctx, { filename: f });
  await new Promise(r => setImmediate(r));   // let the app's own boot finish
  return { run: code => vm.runInContext(code, ctx), html, storage };
}
const session = (id, fields) => ({ id, fields: { Date: today(), 'Day Type': 'A', Status: 'Completed', ...fields } });
const draft = extra => ({ day: 'A', battery: 4, week: 1, startedAt: Date.now() - 60000, exIdx: 0, phase: 'lift', exs: [{ ex: { id: 'a1-hip-thrust' }, sets: 2, weight: 45, done: [] }], ...extra });

test('markup in a restored row reaches the page as text, never as HTML', async () => {
  const data = {
    'Workout Sessions': [session('s1', { Session: MARKUP, Notes: MARKUP, Battery: MARKUP }), session('s2', { Session: { name: MARKUP }, 'Day Type': MARKUP })],
    'Workout Sets': [{ id: 't1', fields: { Session: ['s1'], Exercise: ['a1-hip-thrust'], 'Weight (lb)': 100, Reps: 8, Effort: MARKUP } }],
    'Workout Measurements': [{ id: 'm1', fields: { Date: today(), Hips: 40, Waist: 30, Arm: MARKUP } }],
    'Workout Game State': [{ id: 'game', fields: { 'Quests Celebrated': JSON.stringify([MARKUP]), 'Deload Until': MARKUP } }]
  };
  const app = await boot({ 'gbb-data-v1': data });
  for (const view of ['home', 'progress', 'orchard']) app.run(`S.view = '${view}'; render(true)`);
  app.run(`S.pendingDay = null; S.view = 'session'; S.coach = buildSession(4); S.coach.phase = 'preview'; render(true); printChecklist(S.coach)`);
  const page = app.html.join('\n');
  assert.ok(page.includes('&lt;img src=x'), 'the session name should be on the page, escaped');
  assert.ok(!page.includes('<img src=x'), 'raw markup reached the page');
  assert.ok(!page.includes('<script>'), 'a script tag reached the page');
  assert.ok(!page.includes('brokenCard'), 'a screen failed to draw');
});

test('rows with unsafe ids or the wrong shape are dropped, and nothing leaks into Object.prototype', async () => {
  const app = await boot();
  const raw = `{"__proto__":{"polluted":1},"Workout Sessions":[
    {"id":"ok-1","fields":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"Date":"${today()}"}},
    {"id":"<b>","fields":{}},{"id":"has space","fields":{}},{"id":7,"fields":{}},{"id":"no-fields"},{"id":"list-fields","fields":[]},null,5,"x",[]]}`;
  const out = JSON.parse(app.run(`JSON.stringify(readStore(JSON.parse(${JSON.stringify(raw)})))`));
  assert.deepEqual(out['Workout Sessions'].map(r => r.id), ['ok-1']);
  assert.equal(app.run('({}).polluted'), undefined);
  assert.equal(app.run('Object.prototype.polluted'), undefined);
  assert.equal(out['Workout Game State'].length, 1, 'a game row always exists');
});

test('a restore file has to be a real backup before it can replace the log', async () => {
  const app = await boot();
  const ok = v => app.run(`isBackup(${JSON.stringify(v)})`);
  assert.equal(ok({ app: 'garage-booty-builder', data: { 'Workout Sessions': [] } }), true);
  assert.equal(ok({ app: 'garage-booty-builder', data: [] }), false, 'data as a list');
  assert.equal(ok({ app: 'garage-booty-builder', data: { hello: 1 } }), false, 'no known table');
  assert.equal(ok({ app: 'garage-booty-builder', data: { 'Workout Sessions': 'x' } }), false, 'table that is not a list');
  assert.equal(ok({ app: 'garage-booty-builder', data: 'x' }), false);
  assert.equal(ok({ app: 'something-else', data: { 'Workout Sessions': [] } }), false);
  assert.equal(ok(null), false);
  assert.equal(ok('garage-booty-builder'), false);
});

test('each table is capped, keeping the newest rows', async () => {
  const app = await boot();
  const n = app.run(`(() => { const rows = Array.from({ length: 2500 }, (_, i) => ({ id: 'm' + i, fields: { Hips: 40 } }));
    const out = readStore({ 'Workout Measurements': rows }); return [out['Workout Measurements'].length, out['Workout Measurements'][0].id, out['Workout Measurements'].pop().id].join(); })()`);
  assert.equal(n, '2000,m500,m2499');
});

test('a chart with 200,000 points draws without overflowing the stack', async () => {
  const app = await boot();
  const len = app.run(`(() => { const pts = Array.from({ length: 200000 }, (_, i) => ({ x: '2026-01-' + String(1 + i % 28).padStart(2, '0'), y: i % 50 }));
    return lineChart({ series: [{ name: 'Hips', color: '#fff', pts }], id: 't' }).length; })()`);
  assert.ok(len > 1000);
});

test('strings that only look like dates are refused', async () => {
  const app = await boot({ 'gbb-data-v1': { 'Workout Sessions': [session('s1', { Date: '2026-99-99' })], 'Workout Game State': [{ id: 'game', fields: { 'Program Start Date': '9999-99-99', 'Deload Until': '0000-00-00' } }] } });
  assert.equal(app.run(`isoOr('9999-99-99', 'no')`), 'no');
  assert.equal(app.run(`isoOr('0000-00-00', 'no')`), 'no');
  assert.equal(app.run(`isoOr('2026-11-24', 'no')`), '2026-11-24');
  assert.equal(app.run(`S.game['Program Start Date'] + '|' + S.game['Deload Until'] + '|' + S.sessions[0].Date`), '||');
  assert.equal(app.run('programWeek()'), 1);
  assert.ok(!app.html.join('').includes('NaN'), 'NaN reached the page');
});

test('a tampered workout draft can never stop the app from loading', async () => {
  const cases = {
    'null in the set list': draft({ exs: [{ ex: { id: 'a1-hip-thrust' }, sets: 2, done: [null, 'x', 7, { weight: 45, reps: 8, effort: 'Right' }] }] }),
    'junk in the exercise list': draft({ exs: [null, 5, 'x', { ex: null }, { ex: { id: 'a1-hip-thrust' }, done: {} }] }),
    'markup everywhere': draft({ day: MARKUP, phase: MARKUP, restFor: MARKUP, battery: MARKUP, week: MARKUP, exs: [{ ex: { id: 'a1-hip-thrust', Name: MARKUP, Cue: MARKUP }, sets: MARKUP, weight: MARKUP, done: [{ weight: MARKUP, reps: MARKUP, effort: MARKUP }] }] }),
    'not JSON': '{oops', 'a bare string': '"hello"', 'a list': '[]', 'exercises as an object': draft({ exs: { length: 3 } })
  };
  for (const [label, d] of Object.entries(cases)) {
    const app = await boot({ 'gbb-draft-v1': d });
    assert.ok(app.html.length > 0 && !app.html.join('').includes('brokenCard'), label + ': Home did not draw');
    const got = app.run('JSON.stringify(loadDraft())');
    assert.ok(!got.includes('<img'), label + ': markup survived in the draft');
    app.run(`S.view = 'session'; S.coach = null; render(true)`);
    assert.ok(!app.html.join('').includes('<img src=x'), label + ': markup reached the coach screen');
  }
  const app = await boot({ 'gbb-draft-v1': cases['null in the set list'] });
  assert.equal(app.run('loadDraft().exs[0].done.length'), 1, 'only the real set survives');
});

test('a draft cannot carry a huge set count or a start time in the future', async () => {
  let app = await boot({ 'gbb-draft-v1': draft({ exs: [{ ex: { id: 'a1-hip-thrust' }, sets: 5e6, done: Array(500).fill({ weight: 1, reps: 1 }) }] }) });
  assert.equal(app.run('loadDraft().exs[0].sets'), 20);
  assert.equal(app.run('loadDraft().exs[0].done.length'), 20);
  app = await boot({ 'gbb-draft-v1': draft({ startedAt: 9e15 }) });
  assert.equal(app.run('loadDraft()'), null, 'a future start time would never expire');
  app = await boot({ 'gbb-draft-v1': draft({ startedAt: String(Date.now()) }) });
  assert.equal(app.run('loadDraft()'), null, 'start time must be a number');
  app = await boot({ 'gbb-draft-v1': draft({ startedAt: Date.now() - 5 * 3600000 }) });
  assert.equal(app.run('loadDraft()'), null, 'older than 4 hours');
  app = await boot({ 'gbb-draft-v1': draft() });
  assert.equal(app.run('loadDraft().exs.length'), 1, 'a normal draft still loads');
});

test('a screen that fails to draw shows the way out instead of a dead page', async () => {
  const app = await boot();
  app.html.length = 0;
  app.run(`renderOrchard = () => { throw new Error('boom'); }; S.view = 'orchard'; render(true)`);
  const page = app.html.join('');
  for (const id of ['brokenCard', 'brokenBackup', 'brokenRestore', 'brokenErase']) assert.ok(page.includes(`id="${id}"`), id + ' is missing');
});

test('the page only runs its own script files', () => {
  const page = read('index.html');
  const policy = (page.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  for (const part of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(policy.includes(part), 'policy is missing ' + part);
  assert.ok(!/script-src[^;]*('unsafe-inline'|'unsafe-eval'|https?:|\*)/.test(policy), 'script-src is too loose');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(page), 'index.html has an inline script');
  for (const f of ['index.html', 'app.js', 'assets/georgia.js']) assert.ok(!/\son[a-z]+\s*=\s*["'`]/.test(read(f)), f + ' has an inline event handler');
  for (const src of [...page.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1])) assert.ok(!/^(https?:)?\/\//.test(src), 'outside script: ' + src);
});
