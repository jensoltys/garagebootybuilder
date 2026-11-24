// SPDX-License-Identifier: MIT
// Copyright (C) 2026 the Garage Booty Builder authors. See LICENSE.
'use strict';
/* =============== Garage Booty Builder ===============
   A recovery-first home strength tracker. Everything saves in this browser (see the
   storage section below). The program rails live in buildSession/progression here and in
   assets/gbb-today.js (week, deload, rotation, sets, rests): stop before failure, low-battery
   days at full credit, a check on how you felt the next day, deloads, no streaks, and
   weeks 1-6 are about showing up and recovering. The exercises live in program.js. */

const PROGRAM = window.GBB_PROGRAM;
const STILL = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const STANDALONE = !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
const XP_SESSION = 50, XP_WARM = 10, XP_COOL = 10, XP_MEASURE = 30, XP_MOVE = 15, XP_MAT = 25, XP_PIECE = 25;
const XP_PER_LEVEL = 150;
const QUESTS_SHOWN = 3;
const WARMUP = PROGRAM.warmup;
const MAT_DAY = PROGRAM.matDay;
const TRASH_TALK = [
  'Squats? In THIS economy? Fine, hip thrusts then.',
  'I grew on a tree. You’re growing a booty. Same energy.',
  'Rest days are part of the plan. I checked. I wrote the plan.',
  'The bar doesn’t know it’s only Tuesday.',
  'Two reps in the tank. Always. Coach’s orders.',
  'Peaches bruise when they rush. So do people.',
  'A 15-minute session still counts. It ALL counts.',
  'Strong gets built one boring good set at a time.',
  'You lift heavy things so I can wear this crown one day.',
  'Stop poking me. Or don’t. This is the most action I get.'
];
const NUDGES = [
  { text: 'A short easy walk after lifting is a gentle way to wind down.', cta: null, link: null },
  { text: 'Tape measurements every 2-4 weeks tell the real story. The scale is just gossip.', cta: null, link: null },
  { text: 'Your log lives in this browser only. Save a backup from the Progress tab now and then.', cta: null, link: null }
];

/* ---------- safe output ----------
   Nothing from storage or a restored backup goes into the page as raw HTML. Strings are
   escaped (quotes too, so they're safe inside attributes), numbers are forced with
   Number at load, dates must look like dates, and links must be https. */
const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const numOr = (v, d) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const isoOr = (v, d) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T12:00').getTime()) ? v : d;
const strOr = (v, d) => typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.name === 'string') ? v.name : d;
const recId = v => typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v) ? v : '';
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

/* ---------- data layer: this browser's storage ----------
   Rows keep an { id, fields } shape, one list per table, all in one localStorage key.
   The exercises come from program.js and are never stored. Every write re-reads storage
   first, so two open tabs don't wipe each other's rows. */
const STORE_KEY = 'gbb-data-v1';
const TABLES = ['Workout Sessions', 'Workout Sets', 'Workout Measurements', 'Workout Game State'];
// Far more rows than a lifetime of training. A restore file can't hand the page more than
// this, so no file can make a screen too heavy to draw. The newest rows are the ones kept.
const ROW_CAP = { 'Workout Sessions': 10000, 'Workout Sets': 150000, 'Workout Measurements': 2000, 'Workout Game State': 1 };
let STORE = null;
function readStore(raw) {
  let d = raw;
  if (d === undefined) { try { d = JSON.parse(lsGet(STORE_KEY)); } catch (e) { d = null; } }
  const out = {};
  TABLES.forEach(t => {
    const list = d && typeof d === 'object' && Array.isArray(d[t]) ? d[t] : [];
    out[t] = list.filter(r => r && typeof r === 'object' && recId(r.id) && r.fields && typeof r.fields === 'object' && !Array.isArray(r.fields))
      .slice(-ROW_CAP[t]).map(r => ({ id: r.id, fields: { ...r.fields } }));
  });
  if (!out['Workout Game State'].length) out['Workout Game State'] = [{ id: 'game', fields: {} }];
  return out;
}
function saveStore(next) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); }
  catch (e) { throw new Error('this browser wouldn’t save (storage full, or a private window)'); }
  STORE = next;
}
function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
function exerciseRows() {
  return (PROGRAM.exercises || []).map(e => ({ id: e.id, fields: {
    Name: e.name, Day: e.day, Slot: e.slot, Sets: e.sets, 'Rep Low': e.repLow, 'Rep High': e.repHigh, 'Rep Text': e.repText,
    'Start Weight (lb)': e.startWeight, 'Weight Step (lb)': e.weightStep, 'Video URL': e.videoUrl, Cue: e.cue,
    'Per Side': e.perSide === true, 'Time Based': e.timeBased === true, 'In Low Session': e.inLowSession === true, 'Key Lift': e.keyLift === true
  } }));
}
async function at(table) {
  if (table === 'Workout Exercises') return exerciseRows();
  if (!STORE) STORE = readStore();
  return JSON.parse(JSON.stringify(STORE[table] || []));
}
async function atWrite(table, records, mode) {
  if (!TABLES.includes(table)) throw new Error('unknown table');
  const next = readStore();
  const rows = next[table], out = [];
  records.forEach(r => {
    if (mode === 'update') {
      const row = rows.find(x => x.id === r.id);
      if (!row) throw new Error('that row is gone (changed in another tab?)');
      Object.assign(row.fields, r.fields);
      out.push(row);
    } else {
      const row = { id: newId(), fields: { ...r.fields } };
      rows.push(row);
      out.push(row);
    }
  });
  saveStore(next);
  return { records: JSON.parse(JSON.stringify(out)) };
}
function backupData() {
  const data = readStore();
  const blob = new Blob([JSON.stringify({ app: 'garage-booty-builder', version: 1, saved: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'garage-booty-builder-backup-' + todayISO() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup saved to your downloads.');
}
// A backup is this app's own file: the right name, and at least one of its tables as a list.
// Anything else is refused before it can replace a real log with an empty one.
function isBackup(parsed) {
  return !!(parsed && typeof parsed === 'object' && parsed.app === 'garage-booty-builder' && parsed.data && typeof parsed.data === 'object'
    && !Array.isArray(parsed.data) && TABLES.some(t => Array.isArray(parsed.data[t])));
}
async function restoreData(file) {
  const bad = () => toast('That file isn’t a Garage Booty Builder backup.');
  if (!file || file.size > 5e6) return bad();
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch (e) { return bad(); }
  if (!isBackup(parsed)) return bad();
  if (!confirm('Replace everything in this browser with this backup? This can’t be undone.')) return;
  try { saveStore(readStore(parsed.data)); } catch (e) { toast('Restore failed: ' + e.message); return; }
  clearDraft(); S.coach = null;
  await loadAll();
  try { updateCharacter(); } catch (e) { /* the screen's own guard reports it */ }
  render(true);
  toast('Backup restored.');
}

const S = { exercises: [], sessions: [], sets: [], measurements: [], game: null, view: 'home', coach: null, restTimer: null, pendingDay: null, pendingOne: null, questsOpen: false };

// Every row is rebuilt field by field with a known type. Unknown fields are dropped.
const links = v => Array.isArray(v) ? v.map(recId).filter(Boolean) : [];
function cleanExercise(r) {
  const f = r.fields || {};
  return { id: recId(r.id), Name: strOr(f.Name, ''), Day: strOr(f.Day, ''), Cue: strOr(f.Cue, ''), 'Rep Text': strOr(f['Rep Text'], ''),
    'Video URL': strOr(f['Video URL'], ''), Slot: numOr(f.Slot, undefined), Sets: numOr(f.Sets, undefined),
    'Rep Low': numOr(f['Rep Low'], undefined), 'Rep High': numOr(f['Rep High'], undefined),
    'Start Weight (lb)': numOr(f['Start Weight (lb)'], undefined), 'Weight Step (lb)': numOr(f['Weight Step (lb)'], undefined),
    'Per Side': f['Per Side'] === true, 'Time Based': f['Time Based'] === true, 'In Low Session': f['In Low Session'] === true, 'Key Lift': f['Key Lift'] === true };
}
function cleanSession(r) {
  const f = r.fields || {};
  return { id: recId(r.id), Session: strOr(f.Session, ''), Date: isoOr(f.Date, ''), 'Day Type': strOr(f['Day Type'], ''), Status: strOr(f.Status, ''),
    Notes: strOr(f.Notes, ''), Battery: numOr(f.Battery, undefined), 'Duration (min)': numOr(f['Duration (min)'], undefined),
    'Program Week': numOr(f['Program Week'], undefined), 'Next-Day Energy': numOr(f['Next-Day Energy'], undefined),
    'Warm-up Done': f['Warm-up Done'] === true, 'Cool-down Done': f['Cool-down Done'] === true, Deload: f.Deload === true, Crash: f.Crash === true };
}
function cleanSet(r) {
  const f = r.fields || {};
  return { id: recId(r.id), Session: links(f.Session), Exercise: links(f.Exercise), 'Weight (lb)': numOr(f['Weight (lb)'], undefined),
    Reps: numOr(f.Reps, undefined), Seconds: numOr(f.Seconds, undefined), Effort: strOr(f.Effort, '') };
}
function cleanMeasurement(r) {
  const f = r.fields || {};
  const o = { id: recId(r.id), Date: isoOr(f.Date, '') };
  ['Hips', 'Glutes', 'Waist', 'Shoulders', 'Arm', 'Bodyweight (lb)'].forEach(k => { const n = numOr(f[k], undefined); if (n !== undefined) o[k] = n; });
  return o;
}
function cleanGame(r) {
  const f = r.fields || {};
  return { id: recId(r.id), 'Program Start Date': isoOr(f['Program Start Date'], ''), 'Deload Until': isoOr(f['Deload Until'], ''), 'Quests Celebrated': strOr(f['Quests Celebrated'], '') };
}
async function loadAll() {
  STORE = readStore();
  const [ex, se, st, me, ga] = await Promise.all([
    at('Workout Exercises'), at('Workout Sessions'), at('Workout Sets'), at('Workout Measurements'), at('Workout Game State')
  ]);
  S.exercises = ex.map(cleanExercise).sort((a, b) => (a.Slot || 0) - (b.Slot || 0));
  S.sessions = se.map(cleanSession).sort((a, b) => (a.Date || '').localeCompare(b.Date || ''));
  S.sets = st.map(cleanSet);
  S.measurements = me.map(cleanMeasurement).sort((a, b) => (a.Date || '').localeCompare(b.Date || ''));
  S.game = ga[0] ? cleanGame(ga[0]) : null;
}

/* ---------- derivations (the program brain) ----------
   Week, deload, rotation, sets and rests come from assets/gbb-today.js. */
const todayISO = () => GBB.todayISO();
const daysBetween = GBB.daysBetween;
const completed = () => S.sessions.filter(s => s.Status === 'Completed');
const liftSessions = () => completed().filter(s => ['A', 'B', 'C', 'Low'].includes(s['Day Type']));
const moveSessions = () => completed().filter(s => ['Walk', 'Other', 'Mat'].includes(s['Day Type']));
const today = () => GBB.decide({ sessions: S.sessions, game: S.game, exercises: S.exercises, today: todayISO() });
// Orchard clock: distinct Mon-based calendar weeks holding >=1 lift session.
// Independent of Program Start Date and streak-free: missed weeks add nothing
// and take nothing away.
function weekKey(dateISO) { const d = new Date(dateISO + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function trainedWeeks() { return [...new Set(liftSessions().filter(s => s.Date).map(s => weekKey(s.Date)))].sort(); }

function programWeek() { return GBB.programWeek(S.game, todayISO()); }
function inDeload() { return GBB.inDeload(S.game, todayISO()); }
function nextDayLetter() { return GBB.nextDayLetter(S.sessions); }
function crashesInWindow(days = 14) {
  const t = todayISO();
  return completed().filter(s => s.Crash && s.Date && daysBetween(s.Date, t) <= days).length;
}
function lastCrashed() {
  const ls = liftSessions();
  return ls.length ? !!ls[ls.length - 1].Crash : false;
}
function setsFor(exId) {
  const byDate = [];
  const sessById = {};
  completed().forEach(s => { sessById[s.id] = s; });
  S.sets.filter(x => (x.Exercise || [])[0] === exId).forEach(x => {
    const sess = sessById[(x.Session || [])[0]];
    if (!sess || !sess.Date) return;
    byDate.push({ date: sess.Date, deload: !!sess.Deload, weight: x['Weight (lb)'] || 0, reps: x.Reps || 0, seconds: x.Seconds || 0, effort: x.Effort });
  });
  byDate.sort((a, b) => a.date.localeCompare(b.date));
  return byDate;
}
function lastSessionsOf(exId, n) {
  const groups = {};
  setsFor(exId).forEach(s => { if (!s.deload) (groups[s.date] = groups[s.date] || []).push(s); });
  return Object.keys(groups).sort().slice(-n).map(d => groups[d]);
}
function roundToStep(w, step) { const st = step || 2.5; return Math.max(0, Math.round(w / st) * st); }

// Suggested weight per the progression rules. NEVER suggests grinding:
// double progression only fires after two clean top-of-range sessions.
function suggestWeight(ex, week, deload) {
  if (!ex['Start Weight (lb)']) return null;
  const hist = lastSessionsOf(ex.id, 2);
  let base = hist.length ? hist[hist.length - 1][0].weight : ex['Start Weight (lb)'];
  if (week <= 2 && !hist.length) base = ex['Start Weight (lb)'];
  if (lastCrashed() && hist.length >= 2) base = hist[0][0].weight; // crash: repeat prior week's load
  else if (week >= 5 && hist.length === 2 && !lastCrashed()) {
    const clean = hist.every(sess => sess.every(s => s.reps >= (ex['Rep High'] || Infinity) && s.effort !== 'Too Hard'));
    if (clean && ex['Rep High']) base = base + (ex['Weight Step (lb)'] || 2.5);
  }
  if (deload) base = base * 0.7;
  return roundToStep(base, ex['Weight Step (lb)']);
}
function targetSets(ex, week, battery, deload) { return GBB.targetSets(ex, week, battery, deload); }
function buildSession(battery, forceDay) {
  const week = programWeek();
  const deload = inDeload();
  const low = battery <= 2;
  const day = forceDay || nextDayLetter();
  const pool = low ? S.exercises.filter(e => e['In Low Session']) : S.exercises.filter(e => e.Day === day);
  const exs = pool.map(ex => ({
    ex, sets: targetSets(ex, week, battery, deload),
    weight: low ? roundToStep((suggestWeight(ex, week, false) || 0) * 0.9, ex['Weight Step (lb)']) : suggestWeight(ex, week, deload),
    done: []
  }));
  return { day, dayType: low ? 'Low' : day, battery, week, deload, low, exs, warmDone: false, coolDone: false, startedAt: Date.now(), exIdx: 0, phase: 'warmup', one: false };
}

/* ---------- XP / quests / game ---------- */
function totalXP() {
  let xp = 0;
  completed().forEach(s => {
    const lift = ['A', 'B', 'C', 'Low'].includes(s['Day Type']);
    xp += (lift ? XP_SESSION : s['Day Type'] === 'Mat' ? XP_MAT : XP_MOVE) + (s['Warm-up Done'] ? XP_WARM : 0) + (s['Cool-down Done'] ? XP_COOL : 0);
  });
  xp += S.measurements.length * XP_MEASURE;
  xp += trainedWeeks().length * XP_PIECE; // one orchard piece per trained week
  quests().forEach(q => { if (q.done) xp += q.xp; });
  return xp;
}
function level(xp) { return Math.floor(xp / XP_PER_LEVEL) + 1; }
function stageFor(lv) { return Georgia.stage(lv); }
function stageIndex(lv) { return Georgia.stage(lv).index; }

function sessionsInSameWeek() {
  const start = S.game && S.game['Program Start Date'];
  if (!start) return 0;
  const byWeek = {};
  liftSessions().forEach(s => { const w = Math.floor(daysBetween(start, s.Date) / 7); byWeek[w] = (byWeek[w] || 0) + 1; });
  return Math.max(0, ...Object.values(byWeek));
}
function consecCrashFree() {
  let best = 0, run = 0;
  liftSessions().forEach(s => { if (s.Crash) run = 0; else { run++; best = Math.max(best, run); } });
  return best;
}
function maxWeightFor(nameFrag) {
  let m = 0;
  S.exercises.filter(e => (e.Name || '').includes(nameFrag)).forEach(e => setsFor(e.id).forEach(s => { m = Math.max(m, s.weight); }));
  return m;
}
function quests() {
  const week = programWeek();
  const lifts = liftSessions().length;
  const loadLocked = week < 7;
  return [
    { id: 'first-session', name: 'First Rep of the Rest of My Life', desc: 'Complete 1 session', xp: 50, done: lifts >= 1 },
    { id: 'full-week', name: 'Full Week', desc: '3 sessions inside one program week', xp: 100, done: sessionsInSameWeek() >= 3 },
    { id: 'ten-sessions', name: 'Regular', desc: '10 total sessions', xp: 150, done: lifts >= 10 },
    { id: 'four-crash-free', name: 'Recovery Pro', desc: '4 sessions in a row with no rough next day', xp: 100, done: consecCrashFree() >= 4 },
    { id: 'deload-honored', name: 'Deload Honored', desc: 'Complete a deload session when the plan calls for one', xp: 150, done: completed().some(s => s.Deload) },
    { id: 'first-tape', name: 'Tape Time', desc: 'Log the first measurements', xp: 50, done: S.measurements.length >= 1 },
    { id: 'warm-8', name: 'Well Oiled', desc: '8 warm-ups done', xp: 75, done: completed().filter(s => s['Warm-up Done']).length >= 8 },
    { id: 'cool-8', name: 'Cool Customer', desc: '8 cool-down walks done', xp: 75, done: completed().filter(s => s['Cool-down Done']).length >= 8 },
    { id: 'hip-thrust-100', name: 'Century Thrust', desc: 'Hip thrust 100 lb', xp: 200, done: !loadLocked && maxWeightFor('Hip Thrust') >= 100, locked: loadLocked },
    { id: 'rdl-100', name: 'Hundred Hinge', desc: 'Romanian deadlift 100 lb', xp: 200, done: !loadLocked && maxWeightFor('Romanian') >= 100, locked: loadLocked },
    { id: 'ohp-25', name: 'Sky Shoulders', desc: 'Overhead press 25 lb per hand', xp: 150, done: !loadLocked && maxWeightFor('Overhead Press') >= 25, locked: loadLocked }
  ];
}
function celebratedIds() { try { const a = JSON.parse((S.game && S.game['Quests Celebrated']) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
let celebrating = false;
async function checkQuestCelebrations() {
  if (!S.game || celebrating) return;
  const seen = celebratedIds();
  const queue = [];
  quests().filter(q => q.done && !seen.includes(q.id)).forEach(q => {
    queue.push({ title: 'Quest complete: ' + q.name, msg: q.desc + '. +' + q.xp + ' XP for the peach fund.', size: 'med' });
    seen.push(q.id);
  });
  // Orchard: one celebration per newly trained week, in order. Milestone
  // pieces (every 4th) get the big confetti.
  const pieces = trainedWeeks().length;
  const orchardSeen = seen.filter(id => typeof id === 'string' && id.startsWith('orchard-')).length;
  for (let n = orchardSeen + 1; n <= pieces; n++) {
    const p = pieceAt(n - 1);
    queue.push({ title: 'The orchard grew: ' + p.name, msg: 'Trained week #' + n + ' adds a piece to Georgia’s Orchard. +' + XP_PIECE + ' XP.', size: n % 4 === 0 ? 'big' : 'med' });
    seen.push('orchard-' + n);
  }
  if (!queue.length) return;
  celebrating = true;
  try {
    // The bookmark is saved before anything is shown, so a closed tab never replays them.
    await atWrite('Workout Game State', [{ id: S.game.id, fields: { 'Quests Celebrated': JSON.stringify(seen) } }], 'update');
    S.game['Quests Celebrated'] = JSON.stringify(seen);
    for (const c of queue) await celebrate(c);
  } catch (e) { /* not saved: they come round again after the next thing you log */ }
  celebrating = false;
}

/* ---------- Georgia's Orchard ----------
   Fully DERIVED from logged rows: one piece per distinct trained week
   (trainedWeeks()). No streaks, no decay. A missed week just doesn't
   add a piece. Only the celebration bookmarks persist (Quests
   Celebrated JSON, 'orchard-N' entries). Zero emoji glyphs: SVG art. */
const OP = { trunk: '#8a5a3b', leaf: '#7ec97a', leafDark: '#5aa856', peach: '#ff9b7a', gold: '#ffc46b', pink: '#ff7a95', lav: '#c793e6', teal: '#6fd0c1', wood: '#a8764f', woodDark: '#7c5233', stone: '#9c8d92' };
const ODRAW = {
  tree: p => {
    const canopy = p.v === 'crown' || p.v === 'golden' ? OP.gold : OP.leaf;
    if (p.v === 'sapling') return `<rect x="-2.5" y="-16" width="5" height="16" rx="2" fill="${OP.trunk}"/><circle cx="0" cy="-22" r="11" fill="${OP.leaf}"/><circle cx="-6" cy="-18" r="7" fill="${OP.leafDark}"/><circle cx="4" cy="-25" r="3" fill="${OP.peach}"/>`;
    return `<rect x="-4" y="-26" width="8" height="26" rx="3" fill="${OP.trunk}"/>
      <circle cx="0" cy="-38" r="20" fill="${canopy}"/><circle cx="-15" cy="-30" r="13" fill="${p.v ? OP.gold : OP.leafDark}"/><circle cx="15" cy="-31" r="13" fill="${p.v ? OP.gold : OP.leafDark}"/>
      <circle cx="-8" cy="-36" r="4" fill="${OP.peach}"/><circle cx="9" cy="-42" r="4" fill="${OP.peach}"/><circle cx="2" cy="-28" r="4" fill="${OP.peach}"/>
      ${p.v === 'crown' ? '<path d="M-11 -62 L-8 -72 L-3 -65 L0 -75 L3 -65 L8 -72 L11 -62 Z" fill="#ffc46b" stroke="#d99a35" stroke-width="1.2"/>' : ''}`;
  },
  flower: p => `<line x1="0" y1="0" x2="0" y2="-13" stroke="${OP.leafDark}" stroke-width="2"/><ellipse cx="3.5" cy="-6" rx="4" ry="2" fill="${OP.leaf}" transform="rotate(-25 3.5 -6)"/>` +
    [0, 72, 144, 216, 288].map(a => `<circle cx="${(Math.sin(a * Math.PI / 180) * 4.6).toFixed(1)}" cy="${(-17 + Math.cos(a * Math.PI / 180) * 4.6).toFixed(1)}" r="3" fill="${p.c}"/>`).join('') +
    `<circle cx="0" cy="-17" r="2.6" fill="${OP.gold}"/>`,
  bush: () => `<ellipse cx="0" cy="-7" rx="15" ry="9" fill="${OP.leaf}"/><ellipse cx="-6" cy="-5" rx="8" ry="6" fill="${OP.leafDark}"/><circle cx="4" cy="-9" r="2" fill="${OP.pink}"/><circle cx="-3" cy="-11" r="2" fill="${OP.pink}"/><circle cx="9" cy="-5" r="2" fill="${OP.pink}"/>`,
  bench: () => `<rect x="-16" y="-4" width="3" height="4" fill="${OP.woodDark}"/><rect x="13" y="-4" width="3" height="4" fill="${OP.woodDark}"/><rect x="-18" y="-8" width="36" height="4" rx="1.5" fill="${OP.wood}"/><rect x="-18" y="-18" width="36" height="3.4" rx="1.5" fill="${OP.wood}"/><rect x="-16" y="-15" width="3" height="7" fill="${OP.woodDark}"/><rect x="13" y="-15" width="3" height="7" fill="${OP.woodDark}"/>`,
  pond: () => `<ellipse cx="0" cy="0" rx="32" ry="9" fill="${OP.teal}" opacity=".85"/><ellipse cx="-6" cy="-1.5" rx="16" ry="4" fill="#9fe2d6" opacity=".7"/><circle cx="12" cy="-1" r="3.4" fill="${OP.leaf}"/><circle cx="14" cy="-3" r="1.6" fill="${OP.pink}"/>`,
  hive: () => `<rect x="-9" y="-7" width="18" height="7" rx="2.5" fill="${OP.gold}"/><rect x="-7.5" y="-13" width="15" height="6" rx="2.5" fill="#f3b556"/><rect x="-5.5" y="-18" width="11" height="5" rx="2.5" fill="${OP.gold}"/><circle cx="0" cy="-3.4" r="1.8" fill="${OP.woodDark}"/>`,
  fence: () => [0, 12, 24, 36].map(x => `<rect x="${x - 18}" y="-13" width="3.4" height="13" rx="1.6" fill="${OP.wood}"/>`).join('') + `<rect x="-20" y="-11" width="42" height="2.4" fill="${OP.woodDark}"/><rect x="-20" y="-5.5" width="42" height="2.4" fill="${OP.woodDark}"/>`,
  birdhouse: () => `<rect x="-1.6" y="-20" width="3.2" height="20" fill="${OP.woodDark}"/><rect x="-7" y="-31" width="14" height="12" rx="2" fill="${OP.wood}"/><path d="M-8.5 -31 L0 -38 L8.5 -31 Z" fill="${OP.pink}"/><circle cx="0" cy="-25" r="2.4" fill="#3a2418"/>`,
  lantern: () => `<rect x="-1.6" y="-22" width="3.2" height="22" fill="${OP.woodDark}"/><circle cx="0" cy="-26" r="5" fill="${OP.gold}"/><circle cx="0" cy="-26" r="8.5" fill="${OP.gold}" opacity=".25"/>`,
  swing: () => `<path d="M-14 0 L-8 -26 L-2 0" fill="none" stroke="${OP.wood}" stroke-width="3"/><path d="M14 0 L8 -26 L2 0" fill="none" stroke="${OP.wood}" stroke-width="3"/><rect x="-10" y="-28" width="20" height="3" rx="1.5" fill="${OP.woodDark}"/><line x1="-4" y1="-25" x2="-4" y2="-9" stroke="#d9c9a3" stroke-width="1.4"/><line x1="4" y1="-25" x2="4" y2="-9" stroke="#d9c9a3" stroke-width="1.4"/><rect x="-6.5" y="-9" width="13" height="2.6" rx="1.3" fill="${OP.wood}"/>`,
  arch: () => `<path d="M-14 0 L-14 -20 A 14 14 0 0 1 14 -20 L14 0" fill="none" stroke="${OP.wood}" stroke-width="4"/>` + [-13, -6, 3, 11].map((x, i) => `<circle cx="${x}" cy="${[-22, -31, -31, -23][i]}" r="2.6" fill="${[OP.pink, OP.lav, OP.pink, OP.lav][i]}"/>`).join(''),
  well: () => `<ellipse cx="0" cy="0" rx="12" ry="4" fill="${OP.stone}"/><rect x="-12" y="-9" width="24" height="9" rx="2" fill="#b5a6ab"/><rect x="-10" y="-22" width="2.6" height="13" fill="${OP.woodDark}"/><rect x="7.4" y="-22" width="2.6" height="13" fill="${OP.woodDark}"/><path d="M-13 -21 L0 -29 L13 -21 Z" fill="${OP.pink}"/><rect x="-2.6" y="-16" width="5.2" height="4.6" rx="1" fill="${OP.gold}"/>`,
  basket: () => `<path d="M-11 -9 L11 -9 L8 0 L-8 0 Z" fill="${OP.wood}"/><path d="M-11 -9 L11 -9" stroke="${OP.woodDark}" stroke-width="2"/><circle cx="-4" cy="-11" r="3.4" fill="${OP.peach}"/><circle cx="3" cy="-12" r="3.4" fill="${OP.peach}"/><circle cx="0" cy="-8.6" r="3.4" fill="#ff8f6b"/>`,
  sign: () => `<rect x="-2" y="-20" width="4" height="20" fill="${OP.woodDark}"/><rect x="-34" y="-32" width="68" height="14" rx="4" fill="${OP.wood}" stroke="${OP.woodDark}" stroke-width="1.6"/><text x="0" y="-21.6" text-anchor="middle" font-size="8" font-weight="800" fill="#3a2418" textLength="58" lengthAdjust="spacingAndGlyphs">Georgia&#8217;s Orchard</text>`,
  bunting: () => `<path d="M-170 0 Q0 26 170 0" fill="none" stroke="#d9c9a3" stroke-width="1.6"/>` + [-150, -110, -70, -30, 10, 50, 90, 130].map((x, i) => { const y = 26 * (1 - Math.pow(x / 170, 2)) - 1; return `<path d="M${x} ${y.toFixed(1)} l10 ${1.2} l-4.6 9 Z" fill="${[OP.peach, OP.gold, OP.teal, OP.lav, OP.pink][i % 5]}"/>`; }).join(''),
  bed: () => `<ellipse cx="0" cy="0" rx="20" ry="6" fill="#5c4033" opacity=".55"/>` + [-12, -4, 4, 12].map((x, i) => `<g transform="translate(${x} -1) scale(.8)">${ODRAW.flower({ c: [OP.pink, OP.gold, OP.lav, OP.teal][i] })}</g>`).join('')
};
const PIECES = [
  { name: 'First peach sapling', t: 'tree', v: 'sapling', x: 150, y: 255 },
  { name: 'Pink blossom', t: 'flower', c: '#ff7a95', x: 200, y: 265 },
  { name: 'Golden blossom', t: 'flower', c: '#ffc46b', x: 120, y: 270 },
  { name: 'The orchard sign', t: 'sign', x: 300, y: 262 },
  { name: 'Peach tree', t: 'tree', x: 430, y: 250 },
  { name: 'Berry bush', t: 'bush', x: 500, y: 265 },
  { name: 'Lavender blossom', t: 'flower', c: '#c793e6', x: 365, y: 270 },
  { name: 'Rest bench', t: 'bench', x: 245, y: 268 },
  { name: 'Hillside sapling', t: 'tree', v: 'sapling', x: 80, y: 220 },
  { name: 'Teal blossom', t: 'flower', c: '#6fd0c1', x: 530, y: 255 },
  { name: 'Berry bush', t: 'bush', x: 170, y: 235 },
  { name: 'The pond', t: 'pond', x: 470, y: 285 },
  { name: 'Peach tree', t: 'tree', x: 560, y: 230 },
  { name: 'Pink blossom', t: 'flower', c: '#ff7a95', x: 60, y: 265 },
  { name: 'Garden fence', t: 'fence', x: 100, y: 285 },
  { name: 'The beehive', t: 'hive', x: 395, y: 235 },
  { name: 'Peach tree', t: 'tree', x: 220, y: 215 },
  { name: 'Golden blossom', t: 'flower', c: '#ffc46b', x: 300, y: 230 },
  { name: 'Birdhouse', t: 'birdhouse', x: 40, y: 240 },
  { name: 'The swing', t: 'swing', x: 520, y: 205 },
  { name: 'Young sapling', t: 'tree', v: 'sapling', x: 340, y: 205 },
  { name: 'Berry bush', t: 'bush', x: 590, y: 250 },
  { name: 'Lavender blossom', t: 'flower', c: '#c793e6', x: 255, y: 240 },
  { name: 'The rose arch', t: 'arch', x: 300, y: 296 },
  { name: 'Peach tree', t: 'tree', x: 120, y: 195 },
  { name: 'Pink blossom', t: 'flower', c: '#ff7a95', x: 450, y: 220 },
  { name: 'Garden fence', t: 'fence', x: 540, y: 285 },
  { name: 'The wishing well', t: 'well', x: 180, y: 290 },
  { name: 'Peach tree', t: 'tree', x: 50, y: 190 },
  { name: 'Teal blossom', t: 'flower', c: '#6fd0c1', x: 390, y: 260 },
  { name: 'Berry bush', t: 'bush', x: 280, y: 205 },
  { name: 'The golden tree', t: 'tree', v: 'golden', x: 470, y: 190 },
  { name: 'Golden blossom', t: 'flower', c: '#ffc46b', x: 160, y: 215 },
  { name: 'Birdhouse', t: 'birdhouse', x: 600, y: 225 },
  { name: 'Peach basket', t: 'basket', x: 330, y: 275 },
  { name: 'Party bunting', t: 'bunting', x: 310, y: 128 },
  { name: 'Young sapling', t: 'tree', v: 'sapling', x: 250, y: 185 },
  { name: 'Lavender blossom', t: 'flower', c: '#c793e6', x: 90, y: 245 },
  { name: 'Berry bush', t: 'bush', x: 420, y: 200 },
  { name: 'The lantern', t: 'lantern', x: 350, y: 290 },
  { name: 'Peach tree', t: 'tree', x: 585, y: 185 },
  { name: 'Pink blossom', t: 'flower', c: '#ff7a95', x: 510, y: 235 },
  { name: 'Peach basket', t: 'basket', x: 70, y: 285 },
  { name: 'The flower bed', t: 'bed', x: 220, y: 285 },
  { name: 'Young sapling', t: 'tree', v: 'sapling', x: 400, y: 180 },
  { name: 'Teal blossom', t: 'flower', c: '#6fd0c1', x: 608, y: 270 },
  { name: 'Berry bush', t: 'bush', x: 30, y: 270 },
  { name: 'The crown tree', t: 'tree', v: 'crown', x: 310, y: 178 }
];
function pieceAt(i) {
  if (i < PIECES.length) return PIECES[i];
  // Past piece 48 the orchard keeps blooming: deterministic wildflowers.
  const n = i - PIECES.length;
  return { name: 'Wildflower patch', t: 'flower', c: ['#ff7a95', '#ffc46b', '#c793e6', '#6fd0c1'][n % 4], x: 24 + (n * 97) % 575, y: 208 + (n * 53) % 84 };
}
function orchardScene(count) {
  count = Number(count) || 0;
  const items = Array.from({ length: count }, (_, i) => pieceAt(i)).sort((a, b) => a.y - b.y);
  return `<svg viewBox="0 0 620 310" role="img" aria-label="Georgia's Orchard, ${count} pieces grown" style="width:100%;height:auto;display:block;border-radius:14px">
    <defs><linearGradient id="oSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1c33"/><stop offset="1" stop-color="#43284a"/></linearGradient></defs>
    <rect width="620" height="310" fill="url(#oSky)"/>
    <circle cx="548" cy="52" r="22" fill="#ffc46b" opacity=".9"/><circle cx="548" cy="52" r="34" fill="#ffc46b" opacity=".14"/>
    <circle cx="120" cy="46" r="1.6" fill="#fff" opacity=".7"/><circle cx="210" cy="70" r="1.2" fill="#fff" opacity=".5"/><circle cx="330" cy="40" r="1.4" fill="#fff" opacity=".6"/><circle cx="450" cy="80" r="1.2" fill="#fff" opacity=".4"/><circle cx="60" cy="90" r="1.2" fill="#fff" opacity=".5"/>
    <path d="M0 190 Q160 150 340 178 T620 168 L620 310 L0 310 Z" fill="#3c5136"/>
    <path d="M0 236 Q200 200 420 226 T620 214 L620 310 L0 310 Z" fill="#4a6340"/>
    <path d="M292 310 Q300 260 322 214 Q330 196 328 182 L338 182 Q340 200 332 220 Q314 262 310 310 Z" fill="#8a7a5c" opacity=".65"/>
    ${items.map(p => `<g transform="translate(${p.x} ${p.y})${p.s ? ' scale(' + p.s + ')' : ''}">${ODRAW[p.t](p)}</g>`).join('')}
    ${count === 0 ? '<text x="310" y="160" text-anchor="middle" font-size="15" fill="#c9bfc4">An empty hillside, for now.</text>' : ''}
  </svg>`;
}

/* ---------- character ---------- */
const $ = id => document.getElementById(id);
let georgiaKey = '';
function currentLevel() { return level(totalXP()); }
function updateCharacter() {
  const xp = totalXP(), lv = level(xp);
  // Redraw only when her stage or eye color changes, so her idle sway never restarts mid-step.
  const key = stageIndex(lv) + '|' + Georgia.iris(lv);
  if (key !== georgiaKey) {
    georgiaKey = key;
    $('charWrap').innerHTML = Georgia.svg(lv);
    $('tile').innerHTML = Georgia.svg(lv);
  }
  $('stageName').textContent = stageFor(lv).name;
  $('xpText').textContent = 'Lv ' + lv + ' · ' + xp + ' XP';
  $('xpFill').style.width = ((xp % XP_PER_LEVEL) / XP_PER_LEVEL * 100).toFixed(0) + '%';
  const n = liftSessions().length;
  $('pillCount').textContent = n;
  $('pillWord').textContent = n === 1 ? 'session' : 'sessions';
}
function speak(txt) { $('bubble').textContent = txt; }
let moodTimer = null;
function georgiaState(st, ms) {
  const g = $('charWrap');
  ['idle', 'pleased', 'celebrating'].forEach(k => g.classList.toggle('mood-' + k, k === st));
  clearTimeout(moodTimer);
  if (ms) moodTimer = setTimeout(() => georgiaState('idle'), ms);
}
function mouthGrin(on) { $('charWrap').classList.toggle('grin', !!on); }
function progressLine() {
  const n = liftSessions().length, wk = programWeek();
  if (!n) return 'Day one is the whole game. Tap Start when you’re ready.';
  if (inDeload()) return 'Deload week. Lighter on purpose. Still counts, still XP.';
  if (wk <= 6) return 'Week ' + wk + '. The win is still: train, then feel fine tomorrow. ' + n + (n === 1 ? ' session' : ' sessions') + ' banked.';
  return 'Week ' + wk + ', ' + n + ' sessions in. PR quests are open. Politely menace the barbell.';
}

/* ---------- effects ---------- */
const FX_COLORS = ['#ff9b7a', '#ffc46b', '#c793e6', '#6fd0c1', '#ff7a95'];
function burst(x, y, count = 12) {
  if (STILL) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const ang = (i / count) * Math.PI * 2 + Math.random() * .5, dist = 50 + Math.random() * 70;
    p.style.cssText = `left:${x}px;top:${y}px;background:${FX_COLORS[i % FX_COLORS.length]};--tx:${Math.cos(ang) * dist}px;--ty:${Math.sin(ang) * dist}px;--dur:${.6 + Math.random() * .5}s;--rot:${Math.random() * 360}deg`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}
let confettiRun = 0;
function fireConfetti(count = 80, frameCap = 170) {
  if (STILL) return;
  const cv = $('confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = [...FX_COLORS, '#8fd08a'];
  const ps = Array.from({ length: count }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .4, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, c: colors[Math.floor(Math.random() * colors.length)], vy: 2 + Math.random() * 3.2, vx: -1.4 + Math.random() * 2.8, r: Math.random() * Math.PI, vr: -.1 + Math.random() * .2, o: 1 }));
  let frames = 0;
  const run = ++confettiRun;
  (function tick() {
    if (run !== confettiRun) return; // a newer burst owns the canvas
    ctx.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; if (frames > frameCap - 80) p.o -= .02; ctx.save(); ctx.globalAlpha = Math.max(0, p.o); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); });
    if (++frames < frameCap) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
let audioCtx;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, audioCtx.currentTime + i * .18);
      g.gain.linearRampToValueAtTime(.14, audioCtx.currentTime + i * .18 + .04);
      g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + i * .18 + .7);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * .18); o.stop(audioCtx.currentTime + i * .18 + .8);
    });
  } catch (e) { /* audio blocked: timer still shows visually */ }
}

let celebResolve = null;
// size: small | med | big | party. "party" is the first-ever session: once, and much bigger.
function celebrate({ title, msg, size = 'small', bubble }) {
  return new Promise(res => {
    const party = size === 'party';
    openOverlay(`
      ${party && bubble ? `<div class="bubble" id="partyBubble">${esc(bubble)}</div>` : ''}
      <div class="celeb-icon">${Georgia.svg(currentLevel())}</div>
      <div class="celeb-title">${esc(title)}</div>
      <div class="celeb-msg">${esc(msg)}</div>
      ${party ? '' : nudgeHTML()}
      <button class="btn${party ? ' big gold' : ''}" id="${party ? 'partyClose' : 'celebClose'}">Heck yes</button>
    `, false, party ? 'party' : '');
    celebResolve = res;
    georgiaState('celebrating', party ? 5200 : size === 'big' ? 2600 : 1400);
    mouthGrin(true); setTimeout(() => mouthGrin(false), party ? 5200 : 2600);
    if (bubble) speak(bubble);
    if (party) {
      fireConfetti(320, 420);
      [200, 650, 1100, 1700].forEach((ms, i) => setTimeout(() => burst(innerWidth * [.5, .22, .78, .5][i], innerHeight * [.3, .4, .4, .6][i], 22), ms));
    } else {
      fireConfetti(size === 'big' ? 140 : size === 'med' ? 90 : 55);
      if (size !== 'small') setTimeout(() => burst(innerWidth / 2, innerHeight / 3, 14), 250);
    }
    $(party ? 'partyClose' : 'celebClose').onclick = () => closeOverlay(true);
  });
}
function nudgeHTML() {
  const n = NUDGES[Math.floor(Math.random() * NUDGES.length)];
  return `<div class="tip-card"><div>${esc(n.text)}</div>${n.link ? `<a href="${esc(n.link)}">${esc(n.cta)} &rarr;</a>` : ''}</div>`;
}

/* ---------- overlay + history ----------
   Every overlay pushes one history entry on the way in. Back closes it and
   leaves the view underneath untouched. */
let overlayOpen = false;
// The control that opened an overlay, as a selector, so focus can go back to it even after
// the screen underneath has been redrawn.
let overlayOpener = '';
function openerKey() {
  const a = document.activeElement;
  if (!a || a === document.body) return '';
  if (a.id) return '#' + a.id;
  return a.dataset && ['A', 'B', 'C'].includes(a.dataset.preview) ? '[data-preview="' + a.dataset.preview + '"]' : '';
}
function openOverlay(innerHTML, viaHistory, extraClass) {
  const opener = openerKey() || overlayOpener;
  closeOverlayDOM();
  overlayOpener = opener;
  const ov = document.createElement('div');
  ov.className = 'overlay' + (extraClass ? ' ' + extraClass : ''); ov.id = 'overlay';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="overlay-box" tabindex="-1">${innerHTML}</div>`;
  const title = ov.querySelector('.celeb-title');
  if (title) { title.id = 'overlayTitle'; ov.setAttribute('aria-labelledby', 'overlayTitle'); }
  ov.addEventListener('click', e => { if (e.target === ov) closeOverlay(true); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(true); });
  document.body.appendChild(ov);
  document.querySelector('.shell').inert = true;
  ov.firstChild.focus({ preventScroll: true });
  overlayOpen = true;
  if (!viaHistory) history.pushState({ view: S.view, overlay: true }, '');
}
function closeOverlayDOM() {
  const ov = $('overlay'); if (ov) ov.remove();
  const wasOpen = overlayOpen; overlayOpen = false;
  document.querySelector('.shell').inert = false;
  // After the screen underneath has redrawn, and only if nothing else opened in the meantime.
  if (wasOpen) setTimeout(() => {
    if (overlayOpen) return;
    const back = overlayOpener && document.querySelector(overlayOpener);
    overlayOpener = '';
    if (back) back.focus({ preventScroll: true });
  }, 0);
  if (celebResolve) { const r = celebResolve; celebResolve = null; r(); }
  return wasOpen;
}
function closeOverlay(viaUser) { if (viaUser && overlayOpen) history.back(); else closeOverlayDOM(); }
// One real step back, finished before anything else opens. Used when an action has used up
// the screen you're on (a saved form, a saved session), so no dead entry is left behind
// for the Back button to trip over.
function backOnce() {
  return new Promise(res => {
    let t;
    const done = () => { window.removeEventListener('popstate', done); clearTimeout(t); res(); };
    window.addEventListener('popstate', done);
    t = setTimeout(done, 800);
    history.back();
  });
}

function go(view, viaHistory) {
  if (!viaHistory) history.pushState({ view }, '');
  S.view = view;
  render(viaHistory);
}
window.addEventListener('popstate', e => {
  const st = e.state || { view: 'home' };
  if (closeOverlayDOM() && st.overlay !== true) { /* overlay closed by Back */ }
  if (st.overlay) return; // still on same view underneath
  S.view = st.view || 'home';
  render(true);
});

/* ---------- views ---------- */
function render(viaHistory) {
  stopRestTimer();
  const m = $('main');
  try {
    if (S.view === 'session') renderSession(m);
    else if (S.view === 'progress') renderProgress(m);
    else if (S.view === 'orchard') renderOrchard(m);
    else renderHome(m);
  } catch (e) { renderBroken(m); }
  window.scrollTo(0, 0);
}
// A screen that can't draw (damaged saved data) says so and offers the ways out, so nobody
// is left with a dead page that only clearing browser data could fix.
function renderBroken(m) {
  if (S.view === 'session') { clearDraft(); S.coach = null; }
  $('subtitle').textContent = 'Something needs a fix';
  m.innerHTML = tabsHTML(S.view === 'session' ? 'home' : S.view) + `
    <section class="card" id="brokenCard">
      <h2>This screen couldn’t load</h2>
      <div class="note">Something in the saved log tripped it up. Your log is still in this browser. Save a backup file first. Then restore an older backup, or erase this browser’s log and start fresh.</div>
      <div class="btns" style="margin-top:.8rem">
        <button class="btn small" type="button" id="brokenBackup">Save a backup file</button>
        <button class="btn small outline" type="button" id="brokenRestore">Restore from a backup</button>
        <button class="btn small outline" type="button" id="brokenErase">Erase this browser’s log</button>
        <input type="file" id="brokenFile" accept="application/json,.json" hidden>
      </div>
    </section>`;
  wireTabs(m);
  $('brokenBackup').onclick = backupData;
  $('brokenRestore').onclick = () => $('brokenFile').click();
  $('brokenFile').onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) restoreData(f); };
  $('brokenErase').onclick = () => {
    if (!confirm('Erase everything Garage Booty Builder saved in this browser? This can’t be undone.')) return;
    lsDel(STORE_KEY); clearDraft(); location.reload();
  };
}
function tabsHTML(active) {
  const t = (k, label) => `<button class="tab ${active === k ? 'active' : ''}" role="tab" aria-selected="${active === k}" data-go="${k}" type="button">${label}</button>`;
  return `<div class="tabs" role="tablist" aria-label="Sections">${t('home', 'Home')}${t('progress', 'Progress')}${t('orchard', 'Orchard')}</div>`;
}
function wireTabs(m) { m.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (b.dataset.go !== S.view) go(b.dataset.go); }); }

function weekStripHTML() {
  // No days are pinned to a lift: the A-B-C order moves on by sessions you actually do.
  // The strip shows what got logged this week, Monday to Sunday.
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const jsDay = new Date().getDay();
  const byDate = {};
  completed().forEach(s => { if (s.Date) (byDate[s.Date] = byDate[s.Date] || []).push(s['Day Type']); });
  const word = t => ['A', 'B', 'C'].includes(t) ? 'Lift ' + t : t === 'Low' ? 'Low day' : t === 'Mat' ? 'Mat' : t === 'Walk' ? 'Walk' : 'Moved';
  return '<div class="week-strip">' + days.map((d, i) => {
    const dt = new Date(); dt.setDate(dt.getDate() - ((jsDay + 6) % 7) + i);
    const types = byDate[GBB.todayISO(dt)] || [];
    const lift = types.find(t => GBB.LIFT.includes(t));
    const w = lift ? word(lift) : types.length ? word(types[0]) : '·';
    return `<div class="day-chip ${i === (jsDay + 6) % 7 ? 'today' : ''} ${types.length ? 'done' : ''}"><div class="d">${d}</div><div class="w">${esc(w)}</div></div>`;
  }).join('') + '</div>'
  + '<div class="quiet-row" style="justify-content:flex-start;gap:.5rem;margin-top:.5rem">' + ['A', 'B', 'C'].map(l => `<button class="effort-btn" type="button" data-preview="${l}">See Day ${l}</button>`).join('') + '</div>'
  + '<p class="hint">Lift days rotate A, B, C by the sessions you actually do, so a missed day never gets skipped. Rest a day between lifts. Tap See Day A, B or C for the exercises and how-to videos.</p>';
}

function questHTML(q) {
  return `<div class="quest ${q.done ? 'done' : ''} ${q.locked ? 'locked' : ''}">
    <div class="qi"><div class="qn">${esc(q.name)}</div><div class="qd">${q.locked ? 'Unlocks week 7. Consistency first, PRs after.' : esc(q.desc)}</div></div>
    <div class="qx">${q.done ? 'DONE' : q.locked ? 'LOCKED' : '+' + q.xp}</div>
  </div>`;
}

function renderHome(m) {
  const wk = programWeek(), deload = inDeload();
  const T = today();
  const qs = quests();
  const doneQ = qs.filter(q => q.done).length;
  // The short board: the next quests still open. Locked week-7 quests only fill the
  // list when nothing else is left, and they stay marked locked.
  const open = qs.filter(q => !q.done && !q.locked), locked = qs.filter(q => !q.done && q.locked);
  const shortList = [...open, ...locked].slice(0, QUESTS_SHOWN);
  const showAll = S.questsOpen || shortList.length === qs.length;
  const shown = showAll ? qs : shortList;
  // Latest LIFT session only: a Walk/Other row logged afterwards must not
  // swallow the crash follow-up for the lift before it.
  const latest = [...liftSessions()].sort((a, b) => (b.Date || '').localeCompare(a.Date || ''))[0];
  const needsFollowUp = latest && latest.Date && latest.Date < todayISO() && latest['Next-Day Energy'] == null;
  const proposeDeload = !deload && crashesInWindow(14) >= 2;
  const showPhone = !STANDALONE && lsGet('gbb-phone-hide') !== '1';
  // A workout left mid-way (Back, a phone call, a closed tab) is saved for 4 hours.
  // Say so on Home instead of leaving it hidden behind the Start button.
  const draftNow = loadDraft();
  const inProgress = draftNow && draftNow.phase !== 'preview' ? draftNow : null;
  $('subtitle').textContent = 'Week ' + wk + (deload ? ' · deload week' : '') + ' · 3 lift days a week';
  m.innerHTML = tabsHTML('home') + `
    <section class="card">
      <h2>This week</h2>
      ${weekStripHTML()}
      ${deload ? '<div class="nudge-card"><div class="t">Deload week</div>Weights come down 30% and sets drop to 2. That’s the plan working. Full XP.</div>' : ''}
      ${needsFollowUp ? `
      <div class="nudge-card" id="followUp">
        <div class="t">Quick check: how was the day AFTER your ${esc(latest.Date)} session?</div>
        <div class="rate-row">${[1, 2, 3, 4, 5].map(n => `<button class="rate-btn" type="button" data-nd="${n}" aria-label="Energy ${n} of 5">${n}</button>`).join('')}</div>
        <p class="hint">1 = wiped out, 5 = great. Two rough next days inside two weeks and the plan suggests a lighter week.</p>
      </div>` : ''}
      ${proposeDeload ? `
      <div class="nudge-card">
        <div class="t">Two rough next days inside 14 days. The plan says: deload week.</div>
        <div style="margin-bottom:10px">Lighter weights, fewer sets, all the credit. This is the tool doing its one job.</div>
        <button class="btn gold" type="button" id="acceptDeload">Accept deload week (+quest)</button>
      </div>` : ''}
    </section>
    <section class="card" id="todayCard">
      ${inProgress ? `
      <div class="nudge-card" id="resumeCard" style="margin-top:0"><div class="t">Workout in progress: ${inProgress.low ? 'low-battery session' : 'Day ' + esc(inProgress.day)}</div>
      <div style="margin-bottom:10px">${(n => n === 0 ? 'Warm-up stage, no sets logged yet.' : n + (n === 1 ? ' set' : ' sets') + ' logged so far.')(inProgress.exs.reduce((n, e) => n + e.done.length, 0))} Your place is saved.</div>
      <button class="btn big" type="button" id="resumeBtn">Pick up where I left off</button>
      <div class="quiet-row" style="justify-content:flex-start"><button class="quiet-link" type="button" id="tossDraft">toss it and start fresh</button></div></div>` : ''}
      ${T.state === 'rest' ? `
      <div class="nudge-card" id="restCard" style="margin-top:0"><div class="t">Rest day. You lifted yesterday.</div>
      <div>The program puts a rest day after every session. ${esc(T.label)} is next. Georgia is napping.</div></div>
      <div class="quiet-row"><button class="quiet-link" type="button" id="startBtn">I know, train anyway</button></div>` : `
      <h2 id="todayHead">${T.state === 'lift' ? 'Today' : 'Next up'}: ${esc(T.label)}${T.about ? ` <small>${esc(T.about)}${deload ? ' · deload week' : ''}</small>` : ''}</h2>
      <div class="btns">
        <button class="btn big" type="button" id="startBtn">Start today’s session</button>
        <button class="btn big outline" type="button" id="oneBtn">Just one exercise</button>
      </div>
      <p class="hint">Just one exercise still counts as a session. Stop after it or keep going.</p>`}
      <div class="quiet-row"><button class="quiet-link" type="button" id="printPeek">or print the checklist instead</button><button class="quiet-link" type="button" id="moveLog">log a walk / something else</button><button class="quiet-link" type="button" id="matLink">Mat Day routine</button></div>
    </section>
    <div>
      <div class="stat-row">
        <div class="stat"><div class="k">Sessions</div><div class="v">${liftSessions().length}</div></div>
        <div class="stat"><div class="k">Total XP</div><div class="v">${totalXP()}</div></div>
        <div class="stat"><div class="k">Quests</div><div class="v">${doneQ}/${qs.length}</div></div>
        <div class="stat"><div class="k">Orchard pieces</div><div class="v">${trainedWeeks().length}</div></div>
      </div>
    </div>
    <section class="card">
      <div class="card-head">
        <h2>Quest Board <small id="questCount">${showAll ? 'all ' + qs.length : 'next ' + shown.length + ' of ' + qs.length}</small></h2>
        ${shortList.length < qs.length ? `<button class="quiet-link" type="button" id="questMore" aria-expanded="${showAll}" aria-controls="questGrid">${showAll ? 'Show fewer' : 'Show all ' + qs.length}</button>` : ''}
      </div>
      <div class="quest-grid" id="questGrid">${shown.map(questHTML).join('')}</div>
      <p class="hint">No streaks anywhere. Missed days don’t exist as far as Georgia is concerned.</p>
    </section>
    ${showPhone ? `
    <section class="card" id="phoneCard">
      <h2>Put this on your phone</h2>
      <ol class="steps">
        <li>Open this page on your phone.</li>
        <li>Tap Share.</li>
        <li>Tap Add to Home Screen.</li>
      </ol>
      <p class="hint">It opens full screen like an app. Each browser keeps its own copy of your log, so add it from the browser you’ll use.</p>
      <div class="quiet-row" style="justify-content:flex-start"><button class="quiet-link" type="button" id="phoneHide">Got it, hide this</button></div>
    </section>` : ''}`;
  wireTabs(m);
  const begin = one => { S.coach = null; S.pendingDay = null; S.pendingOne = one; go('session'); };
  const sb = $('startBtn');
  if (sb) sb.onclick = () => begin(false);
  // Same path as Start: battery check, plan, warm-up. Only the stop point differs.
  const ob = $('oneBtn');
  if (ob) ob.onclick = () => begin(true);
  const pp = $('printPeek');
  if (pp) pp.onclick = () => { printChecklist(buildSession(3)); };
  const ml = $('moveLog');
  if (ml) ml.onclick = () => openMoveModal();
  const rb = $('resumeBtn');
  if (rb) rb.onclick = () => { S.coach = null; S.pendingDay = null; S.pendingOne = null; go('session'); };
  const td = $('tossDraft');
  if (td) td.onclick = () => { clearDraft(); S.coach = null; render(true); };
  const mlk = $('matLink');
  if (mlk) mlk.onclick = () => openMatModal();
  const qm = $('questMore');
  if (qm) qm.onclick = () => { S.questsOpen = !S.questsOpen; const y = window.scrollY; render(true); window.scrollTo(0, y); const b = $('questMore'); if (b) b.focus(); };
  const ph = $('phoneHide');
  if (ph) ph.onclick = () => { lsSet('gbb-phone-hide', '1'); $('phoneCard').remove(); };
  m.querySelectorAll('[data-preview]').forEach(ch => {
    const open = () => openDayPreview(ch.dataset.preview);
    ch.onclick = open;
    ch.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  m.querySelectorAll('[data-nd]').forEach(b => b.onclick = async () => {
    const v = +b.dataset.nd;
    b.closest('.nudge-card').style.opacity = .5;
    try {
      await atWrite('Workout Sessions', [{ id: latest.id, fields: { 'Next-Day Energy': v, 'Crash': v <= 2 } }], 'update');
      latest['Next-Day Energy'] = v; latest.Crash = v <= 2;
      toast(v <= 2 ? 'Logged. Sorry it was a rough one. The plan adapts.' : 'Logged. Recovery win.');
      render(true);
      checkQuestCelebrations();
    } catch (e) { toast('Save failed: ' + e.message); }
  });
  const ad = $('acceptDeload');
  if (ad) ad.onclick = async () => {
    const until = new Date(); until.setDate(until.getDate() + 6);
    const iso = until.getFullYear() + '-' + String(until.getMonth() + 1).padStart(2, '0') + '-' + String(until.getDate()).padStart(2, '0');
    try {
      await atWrite('Workout Game State', [{ id: S.game.id, fields: { 'Deload Until': iso } }], 'update');
      S.game['Deload Until'] = iso;
      await celebrate({ title: 'Deload accepted', msg: 'Smartest lift of the week. Light loads through ' + iso + ', full credit.', size: 'med' });
      render(true);
    } catch (e) { toast('Save failed: ' + e.message); }
  };
  speak(progressLine());
}

const DAY_TITLES = PROGRAM.dayTitles;
// Pinned video from program.js (https only), else a YouTube form search. Never a guessed link.
function videoHref(ex) {
  const v = ex['Video URL'];
  if (typeof v === 'string' && v.startsWith('https://')) return v;
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(ex.Name + ' proper form');
}
function videoLink(ex, label) {
  return `<a class="vlink" href="${esc(videoHref(ex))}" target="_blank" rel="noopener noreferrer">${esc(label || 'watch form video')}</a>`;
}
// Warm-up and Mat Day moves are plain text. The video search uses the move's name, the
// part before the first comma, through the same videoHref rules (search, never a guess).
function moveVideo(text) { return videoLink({ Name: String(text).split(',')[0] }, 'video'); }
function moveListHTML(list) { return `<ul class="warm-list" style="text-align:left">${list.map(w => `<li><span>${esc(w)} · ${moveVideo(w)}</span></li>`).join('')}</ul>`; }
function warmupBlockHTML() {
  return `<div class="label" style="text-align:left;margin-top:.4rem">First: 4-minute warm-up</div>${moveListHTML(WARMUP)}
    <div class="label" style="text-align:left">Then the lifts</div>`;
}
function planItemHTML(e) {
  return `<div class="plan-item"><span>${esc(e.ex.Name)}<br>${videoLink(e.ex, 'video')}</span><span class="pw">${Number(e.sets)} × ${esc(e.ex['Rep Text'])}${e.weight ? ' · ' + Number(e.weight) + ' lb' : ''}</span></div>`;
}
function openDayPreview(letter) {
  if (!DAY_TITLES[letter]) return;
  const plan = buildSession(3, letter); // battery 3 = the standard full plan for that day
  openOverlay(`
    <div class="celeb-title">Day ${letter} · ${DAY_TITLES[letter]}</div>
    <div class="celeb-msg" style="margin-bottom:.5rem">Week ${plan.week}${plan.deload ? ' · deload: lighter on purpose' : ''} · weights are today's suggestions and update as you log.</div>
    ${warmupBlockHTML()}
    <div class="plan-list">${plan.exs.map(planItemHTML).join('')}</div>
    <div class="label" style="text-align:left;margin-bottom:.8rem">Last: 3-5 minute easy cool-down walk</div>
    <button class="btn big" type="button" id="trainThisDay">Train Day ${letter} now</button>
    <div class="quiet-row">
      <button class="quiet-link" type="button" id="printThisDay">print this checklist</button>
      <button class="quiet-link" type="button" id="closePrev">close</button>
    </div>
  `);
  const ttd = $('trainThisDay');
  if (ttd) ttd.onclick = async () => {
    await backOnce(); // closes this preview properly, then the coach opens on top of Home
    S.coach = null; clearDraft(); S.pendingDay = letter; S.pendingOne = false;
    go('session');
  };
  const ptd = $('printThisDay');
  if (ptd) ptd.onclick = () => printChecklist(plan);
  $('closePrev').onclick = () => closeOverlay(true);
}

/* ---------- coach mode ---------- */
const DRAFT_KEY = 'gbb-draft-v1';
function saveDraft() { if (S.coach) lsSet(DRAFT_KEY, JSON.stringify(S.coach)); }
function clearDraft() { lsDel(DRAFT_KEY); }
// A saved draft is your own typing, but it is still rebuilt against the live exercise list
// and anything that isn't a known exercise is dropped.
function loadDraft() {
  try {
    const d = JSON.parse(lsGet(DRAFT_KEY));
    if (!d || typeof d !== 'object' || typeof d.startedAt !== 'number' || !Array.isArray(d.exs)) return null;
    const age = Date.now() - d.startedAt;
    if (!(age > -300000 && age < 4 * 3600000)) return null;
    const exs = [];
    d.exs.slice(0, 40).forEach(e => {
      const ex = e && e.ex && S.exercises.find(x => x.id === e.ex.id);
      if (!ex) return;
      exs.push({ ex, sets: Math.min(20, Math.max(1, Math.round(numOr(e.sets, 2)))), weight: e.weight == null ? null : numOr(e.weight, 0),
        done: (Array.isArray(e.done) ? e.done : []).filter(s => s && typeof s === 'object').slice(0, 20)
          .map(s => ({ weight: numOr(s.weight, 0), reps: numOr(s.reps, 0), seconds: numOr(s.seconds, 0), effort: ['Easy', 'Right', 'Too Hard'].includes(s.effort) ? s.effort : 'Right' })) });
    });
    if (!exs.length) return null;
    const day = ['A', 'B', 'C'].includes(d.day) ? d.day : 'A';
    const low = d.low === true;
    const phase = ['preview', 'warmup', 'lift', 'rest', 'onemore', 'cooldown', 'summary'].includes(d.phase) ? d.phase : 'preview';
    return { day, dayType: low ? 'Low' : day, battery: Math.min(5, Math.max(1, numOr(d.battery, 3))), week: numOr(d.week, 1), deload: d.deload === true, low, exs,
      warmDone: d.warmDone === true, coolDone: d.coolDone === true, startedAt: d.startedAt, exIdx: Math.max(0, numOr(d.exIdx, 0)), phase,
      one: d.one === true, restFor: d.restFor === 'next exercise' ? 'next exercise' : 'set ' + (parseInt(String(d.restFor || '').replace('set ', ''), 10) || 2), restSecs: [150, 180].includes(d.restSecs) ? d.restSecs : 150 };
  } catch (e) { return null; }
}

function renderSession(m) {
  if (!S.coach) {
    const draft = loadDraft();
    if (draft) {
      // Whichever button was pressed decides how this session stops.
      if (S.pendingOne != null && draft.phase !== 'cooldown' && draft.phase !== 'summary') draft.one = !!S.pendingOne;
      S.pendingOne = null;
      S.coach = draft;
    }
  }
  if (!S.coach) return renderBattery(m);
  const c = S.coach;
  if (c.phase === 'battery') return renderBattery(m);
  if (c.phase === 'preview') return renderPreview(m);
  if (c.phase === 'warmup') return renderWarmup(m);
  if (c.phase === 'lift') return renderLift(m);
  if (c.phase === 'rest') return renderRest(m);
  if (c.phase === 'onemore') return renderOneMore(m);
  if (c.phase === 'cooldown') return renderCooldown(m);
  if (c.phase === 'summary') return renderSummary(m);
  return renderBattery(m);
}
function renderBattery(m) {
  $('subtitle').textContent = 'Battery check first. Honesty beats heroics.';
  m.innerHTML = tabsHTML('home') + `
    <section class="card">
      <h2>How’s the battery, actually?</h2>
      <div class="note">Low days get a short session that counts 100%. That’s the deal and it isn’t negotiable.</div>
      <div class="battery-row">
        ${[1, 2, 3, 4, 5].map(n => `<button class="batt-btn" type="button" data-batt="${n}" aria-label="Battery ${n} of 5">
          <div class="batt-pips">${[1, 2, 3, 4, 5].map(p => `<div class="batt-pip" style="${p <= n ? 'background:' + (n <= 2 ? 'var(--sun)' : 'var(--good)') : ''}"></div>`).join('')}</div>
          <div class="bl">${['Toast', 'Low', 'Meh', 'Good', 'Full'][n - 1]}</div>
        </button>`).join('')}
      </div>
      <button class="btn ghost" type="button" id="cancelSess">Never mind, back home</button>
    </section>`;
  wireTabs(m);
  speak('No wrong answers here. A 1 still earns XP.');
  $('cancelSess').onclick = () => history.back();
  m.querySelectorAll('[data-batt]').forEach(b => b.onclick = () => {
    S.coach = buildSession(+b.dataset.batt, S.pendingDay);
    S.coach.one = !!S.pendingOne;
    S.pendingDay = null; S.pendingOne = null;
    S.coach.phase = 'preview';
    saveDraft();
    renderPreview(m);
  });
}
function renderPreview(m) {
  const c = S.coach;
  $('subtitle').textContent = (c.low ? 'Low-battery session' : 'Day ' + c.day) + ' · week ' + c.week + (c.deload ? ' · deload' : '');
  m.innerHTML = tabsHTML('home') + `
    <section class="card">
      <h2>${c.low ? 'Short + light. Full credit.' : 'Day ' + c.day + ' · ' + DAY_TITLES[c.day]}</h2>
      ${c.one && c.exs[0] ? `<div class="nudge-card" id="oneNote" style="margin-top:0"><div class="t">Just one exercise: ${esc(c.exs[0].ex.Name)}</div>After it you pick. One more, or finish. Finishing still counts as a session.</div>` : ''}
      ${warmupBlockHTML()}
      <div class="plan-list">${c.exs.map(planItemHTML).join('')}</div>
      <div class="label" style="text-align:left;margin-bottom:.8rem">Last: 3-5 minute easy cool-down walk</div>
      <div class="note" style="margin-bottom:1rem">Every set stops 2-3 reps before failure. Rest 2-3 minutes between sets. The timer nags so you don’t have to count.</div>
      <button class="btn big" type="button" id="beginBtn">Warm up + begin</button>
      <div class="quiet-row">
        <button class="quiet-link" type="button" id="printBtn">Print this as a checklist</button>
        <button class="quiet-link" type="button" id="bailBtn">Back home</button>
      </div>
    </section>`;
  wireTabs(m);
  speak(c.low ? 'Tiny session, full XP. Showing up on a low day is the flex.' : c.deload ? 'Deload day. We lift light and act smug about it.' : 'Loads are pre-picked from last time. Zero decisions required.');
  $('beginBtn').onclick = () => { c.phase = 'warmup'; saveDraft(); render(true); };
  $('printBtn').onclick = () => printChecklist(c);
  $('bailBtn').onclick = () => { S.coach = null; clearDraft(); history.back(); };
}
function renderWarmup(m) {
  const c = S.coach;
  m.innerHTML = tabsHTML('home') + `
    <section class="card">
      <div class="coach-head"><h2>4-minute opener</h2><span class="coach-prog">balance work included on purpose</span></div>
      ${moveListHTML(WARMUP)}
      <p class="hint">Heel drops: add a few each week you feel fine, up to 50.</p>
      <button class="btn big" type="button" id="warmDone">Warm-up done (+${XP_WARM} XP)</button>
      <div class="quiet-row"><button class="quiet-link" type="button" id="skipWarm">skip it this once</button></div>
    </section>`;
  wireTabs(m);
  speak('Wake the glutes, steady the balance. Then we lift.');
  $('warmDone').onclick = () => { c.warmDone = true; c.phase = 'lift'; saveDraft(); georgiaState('pleased', 1100); render(true); };
  $('skipWarm').onclick = () => { c.phase = 'lift'; saveDraft(); render(true); };
}
function renderLift(m) {
  const c = S.coach;
  const cur = c.exs[c.exIdx];
  if (!cur) { c.phase = 'cooldown'; saveDraft(); return render(true); }
  const setNo = cur.done.length + 1;
  if (setNo > cur.sets) { c.exIdx++; saveDraft(); return renderLift(m); }
  const timeBased = cur.ex['Time Based'];
  const wStep = cur.ex['Weight Step (lb)'] || 2.5;
  const initW = cur.done.length ? cur.done[cur.done.length - 1].weight : (cur.weight || 0);
  const initR = timeBased ? 30 : (cur.ex['Rep High'] || cur.ex['Rep Low'] || 10);
  $('subtitle').textContent = 'Exercise ' + (c.exIdx + 1) + ' of ' + c.exs.length + ' · set ' + setNo + ' of ' + cur.sets;
  m.innerHTML = `
    <section class="card">
      <div class="coach-head"><span class="coach-prog">${c.low ? 'LOW-BATTERY' : 'DAY ' + c.day}${c.deload ? ' · DELOAD' : ''}${c.one ? ' · ONE AT A TIME' : ''}</span><span class="coach-prog">${c.exIdx + 1}/${c.exs.length}</span></div>
      <div class="ex-name">${esc(cur.ex.Name)}</div>
      <div class="ex-target">${Number(cur.sets)} × ${esc(cur.ex['Rep Text'])}${cur.ex['Per Side'] ? ' (each side)' : ''}${cur.weight ? ' · suggested ' + Number(cur.weight) + ' lb' : ''}</div>
      <div class="ex-cue">${esc(cur.ex.Cue)} ${videoLink(cur.ex)}</div>
      <div class="set-dots">${Array.from({ length: cur.sets }, (_, i) => `<div class="set-dot ${i < cur.done.length ? 'done' : ''} ${i === cur.done.length ? 'now' : ''}"></div>`).join('')}</div>
      <div class="stepper-row">
        ${cur.ex['Start Weight (lb)'] || initW ? `<div class="stepper"><div class="sk">Weight (lb)</div><div class="sv" id="wVal">${Number(initW)}</div>
          <div class="step-btns"><button class="step-btn" type="button" data-w="-1" aria-label="less weight">&minus;</button><button class="step-btn" type="button" data-w="1" aria-label="more weight">+</button></div></div>` : ''}
        <div class="stepper"><div class="sk">${timeBased ? 'Seconds / steps' : 'Reps'}</div><div class="sv" id="rVal">${Number(initR)}</div>
          <div class="step-btns"><button class="step-btn" type="button" data-r="-1" aria-label="fewer">&minus;</button><button class="step-btn" type="button" data-r="1" aria-label="more">+</button></div></div>
      </div>
      <div class="label" style="margin-bottom:5px">How did that set feel?</div>
      <div class="effort-row">
        <button class="effort-btn" type="button" data-e="Easy">Easy</button>
        <button class="effort-btn sel" type="button" data-e="Right">Right</button>
        <button class="effort-btn" type="button" data-e="Too Hard">Too hard</button>
      </div>
      <button class="btn big" type="button" id="logSet">Log set ${setNo}</button>
      <div class="quiet-row">
        <button class="quiet-link" type="button" id="skipEx">skip exercise</button>
        <button class="quiet-link" type="button" id="endEarly">end session early</button>
      </div>
    </section>`;
  let effort = 'Right';
  let w = initW, r = initR;
  m.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { w = Math.max(0, w + (+b.dataset.w) * wStep); $('wVal').textContent = w; });
  m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { r = Math.max(0, r + (+b.dataset.r) * (timeBased ? 5 : 1)); $('rVal').textContent = r; });
  m.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { effort = b.dataset.e; m.querySelectorAll('[data-e]').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
  speak(TRASH_TALK[Math.floor(Math.random() * TRASH_TALK.length)]);
  $('logSet').onclick = e => {
    cur.done.push({ weight: cur.ex['Start Weight (lb)'] || initW ? w : 0, reps: timeBased ? 0 : r, seconds: timeBased ? r : 0, effort });
    georgiaState('pleased', 900);
    const rect = e.target.getBoundingClientRect();
    burst(rect.left + rect.width / 2, rect.top, 10);
    if (effort === 'Too Hard') toast('Noted. Next time stays at this weight. No grinding allowed.');
    const lastOfEx = cur.done.length >= cur.sets;
    const lastOfAll = lastOfEx && c.exIdx >= c.exs.length - 1;
    if (lastOfAll) { c.phase = 'cooldown'; }
    // "Just one exercise": every finished exercise asks before the next one starts.
    else if (lastOfEx && c.one) { c.phase = 'onemore'; }
    else { c.phase = 'rest'; c.restFor = lastOfEx ? 'next exercise' : 'set ' + (cur.done.length + 1); c.restSecs = GBB.restSecs(cur.ex); }
    saveDraft(); render(true);
  };
  $('skipEx').onclick = () => { c.exIdx++; saveDraft(); render(true); };
  $('endEarly').onclick = () => { c.phase = 'cooldown'; saveDraft(); render(true); };
}
// "One more?" Carrying on goes through the normal rest timer first. Finishing goes to the
// cool-down walk, the same as any other session.
function renderOneMore(m) {
  const c = S.coach;
  const cur = c.exs[c.exIdx], next = c.exs[c.exIdx + 1];
  if (!cur || !next) { c.phase = 'cooldown'; saveDraft(); return render(true); }
  const doneCount = c.exs.filter(e => e.done.length).length;
  $('subtitle').textContent = doneCount + ' of ' + c.exs.length + ' exercises logged';
  m.innerHTML = `
    <section class="card" id="oneMoreCard">
      <div class="coach-head"><span class="coach-prog">${c.low ? 'LOW-BATTERY' : 'DAY ' + c.day}${c.deload ? ' · DELOAD' : ''}</span><span class="coach-prog">${doneCount}/${c.exs.length}</span></div>
      <h2>One more?</h2>
      <div class="note">${esc(cur.ex.Name)} is logged. Next would be:</div>
      <div class="next-up"><b>${esc(next.ex.Name)}</b><span>${Number(next.sets)} × ${esc(next.ex['Rep Text'])}${next.weight ? ' · ' + Number(next.weight) + ' lb' : ''}</span></div>
      <div class="stack">
        <button class="btn big" type="button" id="oneMoreYes">One more</button>
        <button class="btn big outline" type="button" id="oneMoreNo">Finish here</button>
      </div>
      <p class="hint">Finishing here saves a session at full credit.${c.low ? '' : ' Day ' + c.day + ' stays next, so nothing gets skipped.'} The cool-down walk comes first either way.</p>
    </section>`;
  speak('That one counts. One more, or call it?');
  $('oneMoreYes').onclick = () => { c.phase = 'rest'; c.restFor = 'next exercise'; c.restSecs = GBB.restSecs(cur.ex); saveDraft(); render(true); };
  $('oneMoreNo').onclick = () => { c.phase = 'cooldown'; saveDraft(); render(true); };
}
let restInterval = null;
function stopRestTimer() { if (restInterval) { clearInterval(restInterval); restInterval = null; } }
function renderRest(m) {
  const c = S.coach;
  let left = c.restSecs;
  m.innerHTML = `
    <section class="card">
      <div class="timer-wrap">
        <div class="label">Rest, then ${esc(c.restFor)}</div>
        <div class="timer-num" id="tNum">${fmtT(left)}</div>
        <div class="timer-ring"><div class="timer-fill" id="tFill" style="width:100%"></div></div>
        <div class="timer-cap">Long rests keep every set honest. Sit down. Pet a dog. Scroll nothing.</div>
        <button class="btn big" type="button" id="restDone">I’m ready, next set</button>
      </div>
    </section>`;
  speak('Resting IS the workout. The muscle is taking notes.');
  restInterval = setInterval(() => {
    left--;
    if (left <= 0) { stopRestTimer(); chime(); $('tNum').textContent = '0:00'; $('tFill').style.width = '0%'; speak('Ding. Whenever you’re ready.'); return; }
    $('tNum').textContent = fmtT(left);
    $('tFill').style.width = (left / c.restSecs * 100) + '%';
  }, 1000);
  $('restDone').onclick = () => { stopRestTimer(); c.phase = 'lift'; saveDraft(); render(true); };
}
const fmtT = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
function renderCooldown(m) {
  const c = S.coach;
  const total = GBB.COOL_SECS;
  let left = total;
  m.innerHTML = `
    <section class="card">
      <div class="timer-wrap">
        <div class="label">Cool-down walk</div>
        <div class="timer-num" id="tNum">${fmtT(left)}</div>
        <div class="timer-ring"><div class="timer-fill" id="tFill" style="width:100%"></div></div>
        <div class="timer-cap">3-5 easy minutes to wind down before the rest of your day.</div>
        <button class="btn big" type="button" id="coolDone">Walk done (+${XP_COOL} XP)</button>
        <div class="quiet-row"><button class="quiet-link" type="button" id="skipCool">skip the walk</button></div>
      </div>
    </section>`;
  speak('Slow lap around the driveway. Victory parade pace.');
  restInterval = setInterval(() => {
    left--;
    if (left <= 0) { stopRestTimer(); chime(); $('tNum').textContent = '0:00'; $('tFill').style.width = '0%'; return; }
    $('tNum').textContent = fmtT(left); $('tFill').style.width = (left / total * 100) + '%';
  }, 1000);
  $('coolDone').onclick = () => { stopRestTimer(); c.coolDone = true; c.phase = 'summary'; saveDraft(); render(true); };
  $('skipCool').onclick = () => { stopRestTimer(); c.phase = 'summary'; saveDraft(); render(true); };
}
function renderSummary(m) {
  const c = S.coach;
  const logged = c.exs.filter(e => e.done.length);
  const mins = Math.max(1, Math.round((Date.now() - c.startedAt) / 60000));
  const xp = XP_SESSION + (c.warmDone ? XP_WARM : 0) + (c.coolDone ? XP_COOL : 0);
  // Stopped early in "Just one exercise": full credit, and the unfinished day stays next.
  const short = !!c.one && logged.length < c.exs.length;
  const shortNote = GBB.SHORT_MARK + '. ' + logged.length + ' of ' + c.exs.length + ' exercises. ' + (c.low ? 'The rotation stays where it was.' : 'Day ' + c.day + ' is still next.');
  m.innerHTML = `
    <section class="card">
      <h2>Session done. Save it?</h2>
      <div class="plan-list">
        ${logged.map(e => `<div class="plan-item"><span>${esc(e.ex.Name)}</span><span class="pw">${e.done.map(d => (d.weight ? Number(d.weight) + '×' : '') + (d.reps ? Number(d.reps) : Number(d.seconds) + 's')).join(', ')}</span></div>`).join('') || '<div class="empty-note">No sets logged. Saving still counts the showing up.</div>'}
      </div>
      <div class="note" style="margin-bottom:1rem">${mins} min · battery ${Number(c.battery)}/5 · +${xp} XP${c.deload ? ' · deload honored' : ''}${short ? ' · short session, full credit' : ''}</div>
      ${short && !c.low ? `<div class="note" id="shortNote" style="margin-bottom:1rem">Day ${c.day} is still next, so nothing gets skipped.</div>` : ''}
      <button class="btn big gold" type="button" id="saveSess">Save session (+${xp} XP)</button>
      <div class="quiet-row"><button class="quiet-link" type="button" id="tossSess">toss it, don’t save</button></div>
    </section>`;
  speak('Look at you. Trained AND planning to feel fine tomorrow.');
  $('saveSess').onclick = async () => {
    $('saveSess').disabled = true;
    try {
      const before = liftSessions().length;
      const sessName = todayISO() + ' · ' + (c.low ? 'Low day' : 'Day ' + c.day) + (short ? ' · short' : '');
      const res = await atWrite('Workout Sessions', [{ fields: {
        'Session': sessName, 'Date': todayISO(), 'Day Type': c.dayType, 'Battery': c.battery,
        'Status': 'Completed', 'Duration (min)': mins, 'Warm-up Done': c.warmDone, 'Cool-down Done': c.coolDone,
        'Deload': c.deload, 'Program Week': c.week, 'XP Earned': xp,
        ...(short ? { 'Notes': shortNote } : {})
      } }]);
      const sessId = res.records[0].id;
      const setRows = [];
      logged.forEach(e => e.done.forEach((d, i) => setRows.push({ fields: {
        'Set': todayISO() + ' · ' + e.ex.Name + ' · S' + (i + 1),
        'Session': [sessId], 'Exercise': [e.ex.id], 'Set Number': i + 1,
        'Weight (lb)': d.weight || null, 'Reps': d.reps || null, 'Seconds': d.seconds || null, 'Effort': d.effort
      } })));
      if (setRows.length) await atWrite('Workout Sets', setRows);
      if (S.game && !S.game['Program Start Date']) {
        await atWrite('Workout Game State', [{ id: S.game.id, fields: { 'Program Start Date': todayISO() } }], 'update');
      }
      clearDraft(); S.coach = null;
      await loadAll();
      updateCharacter();
      const total = liftSessions().length;
      // The coach screen is used up. Step back to Home under it before celebrating, so
      // Back from Home never reopens a finished session.
      if (history.state && history.state.view === 'session' && !history.state.overlay) await backOnce();
      if (S.view !== 'home') { history.replaceState({ view: 'home' }, ''); S.view = 'home'; }
      render(true);
      let partyLine = '';
      if (before === 0 && total === 1) {
        partyLine = short ? 'One exercise. That counts. Day one, done.' : 'Day one, done. That was the hard one.';
        // The first session ever: the one big party. It can only happen once.
        await celebrate({ title: 'Day one, done', size: 'party',
          msg: (c.low ? 'Low day, full credit. ' : short ? 'One exercise, full credit. ' : '') + 'Your first session is saved. That was the hard one.',
          bubble: partyLine });
      } else {
        await celebrate({ title: c.low ? 'Low day, full credit' : short ? 'Short session, full credit' : 'Session banked', msg: 'That’s ' + total + ' sessions total. The peach approves of your recovery-first lifestyle.', size: 'big' });
      }
      if (partyLine) speak(partyLine);
      checkQuestCelebrations();
    } catch (e) {
      const b = $('saveSess'); if (b) b.disabled = false;
      toast('Save failed: ' + e.message + '. Nothing lost, try again.');
    }
  };
  $('tossSess').onclick = () => { if (confirm('Toss this session? Nothing will be saved.')) { clearDraft(); S.coach = null; history.back(); } };
}

/* ---------- print checklist ---------- */
function printChecklist(c) {
  const sheet = $('printSheet');
  sheet.innerHTML = `
    <h1>Garage Booty Builder · ${c.low ? 'Low-Battery Session' : 'Day ' + c.day + ' · ' + DAY_TITLES[c.day]}</h1>
    <div class="p-sub">Week ${Number(c.week)}${c.deload ? ' · DELOAD (light on purpose)' : ''} · date: ______________ · battery: ___/5</div>
    <div class="p-block"><strong>Warm-up (4 min):</strong><div class="p-warm">${WARMUP.map(w => '<div><span class="p-check"></span>' + w + '</div>').join('')}</div></div>
    <table>
      <tr><th>Exercise</th><th>Target</th><th>Weight</th>${Array.from({ length: 3 }, (_, i) => '<th>Set ' + (i + 1) + '</th>').join('')}</tr>
      ${c.exs.map(e => `<tr><td>${esc(e.ex.Name)}<br><span class="p-cue">${esc(e.ex.Cue)}</span></td><td>${Number(e.sets)} × ${esc(e.ex['Rep Text'])}</td><td>${e.weight ? Number(e.weight) + ' lb' : '<span class="p-line"></span>'}</td>${Array.from({ length: 3 }, (_, i) => '<td>' + (i < e.sets ? '<span class="p-line"></span>' : '') + '</td>').join('')}</tr>`).join('')}
    </table>
    <div class="p-block"><span class="p-check"></span> Cool-down walk, 3-5 easy minutes</div>
    <div class="p-note">Rules of the garage: stop every set 2-3 reps before failure. Rest 2-3 minutes between sets. If the battery says 2 or less, do the short version and take the win. Heel drops: add a few each week you feel fine, up to 50. No streaks, no guilt.</div>`;
  window.print();
}

/* ---------- progress view ---------- */
// One fixed color per series, checked for contrast against the card surface #1d1523.
// Keep the order.
const CHART_COLORS = { hips: '#d95926', glutes: '#199e70', waist: '#9085e9', shoulders: '#d55181', arm: '#c98500', ratio: '#c98500', lift: '#d95926', bw: '#9c8d92' };
function lineChart({ series, height = 190, yFmt = v => v, id }) {
  const all = series.flatMap(s => s.pts);
  if (!all.length) return '<div class="empty-note">No data yet. It’ll show up here as it happens.</div>';
  const dates = [...new Set(all.map(p => p.x))].sort();
  const W = 620, H = height, padL = 40, padR = 66, padT = 12, padB = 24;
  const ys = all.map(p => p.y);
  let yMin = ys.reduce((a, b) => Math.min(a, b), Infinity), yMax = ys.reduce((a, b) => Math.max(a, b), -Infinity);
  if (yMin === yMax) { const pad = Math.abs(yMin) * 0.08 || 1; yMin -= pad; yMax += pad; }
  const span = yMax - yMin; yMin -= span * .12; yMax += span * .12;
  const xFor = d => padL + (dates.length === 1 ? (W - padL - padR) / 2 : (dates.indexOf(d) / (dates.length - 1)) * (W - padL - padR));
  const yFor = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const gridLines = 4;
  let g = '';
  for (let i = 0; i <= gridLines; i++) {
    const v = yMin + (i / gridLines) * (yMax - yMin), y = yFor(v);
    g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,.07)" stroke-width="1"/>
          <text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="#9c8d92">${esc(yFmt(Math.round(v * 100) / 100))}</text>`;
  }
  let paths = '';
  series.forEach(s => {
    if (!s.pts.length) return;
    const pts = [...s.pts].sort((a, b) => a.x.localeCompare(b.x));
    const d = pts.map((p, i) => (i ? 'L' : 'M') + xFor(p.x).toFixed(1) + ' ' + yFor(p.y).toFixed(1)).join(' ');
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="4 4"' : ''}/>`;
    pts.forEach(p => { paths += `<circle cx="${xFor(p.x).toFixed(1)}" cy="${yFor(p.y).toFixed(1)}" r="3.4" fill="${s.color}" stroke="#1d1523" stroke-width="2" data-tip="${esc(s.name + ' ' + yFmt(p.y) + ' · ' + p.x)}"/>`; });
    const last = pts[pts.length - 1];
    paths += `<text x="${xFor(last.x) + 8}" y="${yFor(last.y) + 3}" font-size="10" font-weight="800" fill="${s.color}">${esc(s.name)}</text>`;
  });
  const xLabels = dates.filter((_, i) => dates.length <= 6 || i % Math.ceil(dates.length / 6) === 0 || i === dates.length - 1)
    .map(d => `<text x="${xFor(d)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#9c8d92">${esc(d.slice(5))}</text>`).join('');
  return `<div class="chart-box" data-chart="${esc(id)}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">${g}${paths}${xLabels}</svg><div class="chart-tip"></div></div>`;
}
function wireChartTips(m) {
  m.querySelectorAll('.chart-box').forEach(box => {
    const tip = box.querySelector('.chart-tip');
    const dots = [...box.querySelectorAll('circle')];
    box.addEventListener('pointermove', e => {
      const r = box.getBoundingClientRect();
      let best = null, bd = 1e9;
      dots.forEach(d => {
        const dr = d.getBoundingClientRect();
        const dx = e.clientX - (dr.left + dr.width / 2), dy = e.clientY - (dr.top + dr.height / 2);
        const dist = dx * dx + dy * dy;
        if (dist < bd) { bd = dist; best = d; }
      });
      if (best && bd < 2600 && best.dataset.tip) {
        const dr = best.getBoundingClientRect();
        tip.style.display = 'block';
        tip.textContent = best.dataset.tip || '';
        tip.style.left = Math.min(Math.max(0, r.width - tip.offsetWidth), Math.max(0, dr.left - r.left + 10)) + 'px';
        tip.style.top = (dr.top - r.top - 34) + 'px';
      } else tip.style.display = 'none';
    });
    box.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  });
}
function e1rm(w, reps) { return w * (1 + reps / 30); }
function renderProgress(m) {
  $('subtitle').textContent = 'Tape + lifts + one quiet line. No photos, no scale goals.';
  const meas = S.measurements;
  const measSeries = [
    { key: 'Hips', name: 'Hips', color: CHART_COLORS.hips },
    { key: 'Glutes', name: 'Glutes', color: CHART_COLORS.glutes },
    { key: 'Waist', name: 'Waist', color: CHART_COLORS.waist },
    { key: 'Shoulders', name: 'Shoulders', color: CHART_COLORS.shoulders },
    { key: 'Arm', name: 'Arm', color: CHART_COLORS.arm }
  ].map(s => ({ ...s, pts: meas.filter(r => r[s.key] != null && r.Date).map(r => ({ x: r.Date, y: r[s.key] })) }));
  const ratioPts = meas.filter(r => r.Waist && r.Hips && r.Date).map(r => ({ x: r.Date, y: Math.round(r.Waist / r.Hips * 1000) / 1000 }));
  const bwPts = meas.filter(r => r['Bodyweight (lb)'] && r.Date).map(r => ({ x: r.Date, y: r['Bodyweight (lb)'] }));
  const keyLifts = S.exercises.filter(e => e['Key Lift']);
  const lastMeas = meas.filter(r => r.Date).slice(-1)[0];
  const daysSince = lastMeas ? daysBetween(lastMeas.Date, todayISO()) : null;
  m.innerHTML = tabsHTML('progress') + `
    <section class="card">
      <div class="card-head">
        <h2>Tape measurements</h2>
        <button class="btn small" type="button" id="addMeas">Log tape</button>
      </div>
      ${daysSince == null ? '<div class="empty-note">First measurement unlocks the charts (and a quest).</div>' : daysSince >= 14 ? '<div class="nudge-card" style="margin:.2rem 0 .8rem"><div class="t">Tape check is due (' + Number(daysSince) + ' days since last). Every 2-4 weeks keeps the story honest.</div></div>' : ''}
      <div class="legend" id="measLegend">${measSeries.map((s, i) => `<button class="leg-item" type="button" data-si="${i}" aria-pressed="true"><span class="leg-swatch" style="background:${s.color}"></span>${s.name}</button>`).join('')}</div>
      <div id="measChart">${lineChart({ series: measSeries, id: 'meas', yFmt: v => v + '"' })}</div>
    </section>
    <section class="card">
      <h2>Waist-to-hip ratio</h2>
      <div class="note" style="margin-bottom:.4rem">Waist divided by hips. Moves slowly. That’s normal.</div>
      ${lineChart({ series: [{ name: 'W:H', color: CHART_COLORS.ratio, pts: ratioPts }], id: 'ratio', height: 150 })}
    </section>
    <section class="card">
      <div class="card-head">
        <h2>Lift strength (e1RM)</h2>
        <select id="liftSel" aria-label="Pick a lift">${keyLifts.map(e => `<option value="${esc(e.id)}">${esc(e.Name)}</option>`).join('')}</select>
      </div>
      <div id="liftChart"></div>
      <p class="hint">Estimated one-rep max from logged sets (Epley). Weeks 1-6 this line is ALLOWED to be flat. The win is recovery.</p>
    </section>
    <section class="card">
      <h2>Bodyweight, just along for the ride</h2>
      <div class="note" style="margin-bottom:.4rem">Not a goal, not a game input. Muscle weighs something. A slow climb here while the tape improves means it’s WORKING.</div>
      ${lineChart({ series: [{ name: 'lb', color: CHART_COLORS.bw, pts: bwPts, dashed: true }], id: 'bw', height: 120 })}
    </section>
    <section class="card">
      <h2>Session history</h2>
      ${[...completed()].reverse().slice(0, 12).map(s => `<div class="hist-item"><span>${esc(s.Session || s.Date)}</span><span class="hd">${[s.Battery ? 'battery ' + Number(s.Battery) : '', s['Duration (min)'] ? Number(s['Duration (min)']) + ' min' : '', s.Crash ? 'rough next day' : '', s.Deload ? 'deload' : ''].filter(Boolean).join(' · ')}</span></div>`).join('') || '<div class="empty-note">No sessions yet.</div>'}
    </section>
    <section class="card" id="dataCard">
      <h2>Your data</h2>
      <div class="note">Everything you log lives in this browser only. Nobody else can see it, and clearing your browser data erases it. Save a backup now and then.</div>
      <div class="btns" style="margin-top:.8rem">
        <button class="btn small" type="button" id="backupBtn">Save a backup file</button>
        <button class="btn small outline" type="button" id="restoreBtn">Restore from a backup</button>
        <input type="file" id="restoreFile" accept="application/json,.json" hidden>
      </div>
    </section>`;
  wireTabs(m);
  const measBox = $('measChart');
  const legend = $('measLegend');
  const visible = measSeries.map(() => true);
  legend.querySelectorAll('.leg-item').forEach(li => li.onclick = () => {
    const i = +li.dataset.si;
    visible[i] = !visible[i];
    li.classList.toggle('off', !visible[i]);
    li.setAttribute('aria-pressed', String(visible[i]));
    measBox.innerHTML = lineChart({ series: measSeries.filter((_, n) => visible[n]), id: 'meas', yFmt: v => v + '"' });
    wireChartTips(measBox);
  });
  const am = $('addMeas');
  if (am) am.onclick = () => openMeasModal();
  $('backupBtn').onclick = backupData;
  $('restoreBtn').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) restoreData(f); };
  const drawLift = () => {
    const ex = S.exercises.find(e => e.id === $('liftSel').value);
    if (!ex) return;
    const byDate = {};
    setsFor(ex.id).forEach(s => { if (s.weight && s.reps) byDate[s.date] = Math.max(byDate[s.date] || 0, e1rm(s.weight, s.reps)); });
    const pts = Object.keys(byDate).sort().map(d => ({ x: d, y: Math.round(byDate[d]) }));
    $('liftChart').innerHTML = lineChart({ series: [{ name: 'e1RM', color: CHART_COLORS.lift, pts }], id: 'lift', height: 160, yFmt: v => v + ' lb' });
    wireChartTips($('liftChart'));
  };
  if (keyLifts.length) { $('liftSel').onchange = drawLift; drawLift(); }
  wireChartTips(m);
  speak(meas.length ? 'Numbers don’t lie, but they do take their sweet time.' : 'Grab the tape once and I start drawing pretty lines.');
}
function openMeasModal() {
  openOverlay(`
    <div class="celeb-title">Log tape measurements</div>
    <div class="celeb-msg" style="margin-bottom:.4rem">Inches, widest point (waist: narrowest). Bodyweight optional, judgment-free.</div>
    <div class="form-grid" style="text-align:left">
      <label><div class="label">Date</div><input type="date" id="mDate" value="${todayISO()}"></label>
      <label><div class="label">Bodyweight (lb, optional)</div><input type="number" step="0.1" id="mBw" inputmode="decimal"></label>
      <label><div class="label">Hips</div><input type="number" step="0.25" id="mHips" inputmode="decimal"></label>
      <label><div class="label">Glutes</div><input type="number" step="0.25" id="mGlutes" inputmode="decimal"></label>
      <label><div class="label">Waist</div><input type="number" step="0.25" id="mWaist" inputmode="decimal"></label>
      <label><div class="label">Shoulders</div><input type="number" step="0.25" id="mShoulders" inputmode="decimal"></label>
      <label><div class="label">Arm (widest)</div><input type="number" step="0.25" id="mArm" inputmode="decimal"></label>
    </div>
    <button class="btn big" type="button" id="mSave">Save (+${XP_MEASURE} XP)</button>
  `);
  $('mSave').onclick = async () => {
    const f = { 'Date': $('mDate').value };
    const map = { mHips: 'Hips', mGlutes: 'Glutes', mWaist: 'Waist', mShoulders: 'Shoulders', mArm: 'Arm', mBw: 'Bodyweight (lb)' };
    Object.entries(map).forEach(([id, key]) => { const v = parseFloat($(id).value); if (!isNaN(v)) f[key] = v; });
    if (!f.Date || Object.keys(f).length < 2) { toast('Need a date plus at least one number.'); return; }
    $('mSave').disabled = true;
    try {
      await atWrite('Workout Measurements', [{ fields: f }]);
      await loadAll();
      updateCharacter();
      // Step back out of the form first, and wait for it, so the celebration that
      // opens next is never closed by that Back.
      if (overlayOpen) await backOnce();
      await celebrate({ title: 'Tape logged', msg: 'Another point on the charts. +' + XP_MEASURE + ' XP.', size: 'med' });
      render(true);
      checkQuestCelebrations();
    } catch (e) { const b = $('mSave'); if (b) b.disabled = false; toast('Save failed: ' + e.message); }
  };
}

/* ---------- orchard view ---------- */
function renderOrchard(m) {
  const weeks = trainedWeeks();
  const n = weeks.length;
  const next = pieceAt(n);
  const thisWeekTrained = weeks.includes(weekKey(todayISO()));
  $('subtitle').textContent = 'One piece per trained week. It only ever grows.';
  m.innerHTML = tabsHTML('orchard') + `
    <section class="card">
      <div class="card-head">
        <h2>Georgia&rsquo;s Orchard</h2>
        <span class="coach-prog">${n} piece${n === 1 ? '' : 's'} grown</span>
      </div>
      <div class="orchard-scene">${orchardScene(n)}</div>
      <div class="nudge-card" style="margin-top:12px">
        ${thisWeekTrained
          ? `<div class="t">This week&rsquo;s piece is in the ground.</div><div>Next trained week adds: <strong>${esc(next.name)}</strong>. No rush. The orchard waits, it never wilts.</div>`
          : `<div class="t">Train once this week and the orchard grows: ${esc(next.name)}.</div><div>One session is all a week needs. Low-battery days count in full.</div>`}
      </div>
      ${n ? `<p class="hint">Latest pieces: ${Array.from({ length: Math.min(n, 4) }, (_, i) => esc(pieceAt(n - 1 - i).name)).join(' · ')}</p>` : ''}
      <p class="hint">Every 4th piece is a landmark. Nothing here ever expires, decays, or judges a quiet week.</p>
    </section>`;
  wireTabs(m);
  speak(n === 0 ? 'Empty hillside. First trained week plants the first sapling. I have OPINIONS about where it goes.'
    : thisWeekTrained ? 'The orchard grew this week. I supervised.' : 'The hillside is patient. So am I. Mostly.');
}

/* ---------- quick movement log (Walk / Other) ---------- */
function openMoveModal() {
  openOverlay(`
    <div class="celeb-title">Log a walk or something else</div>
    <div class="celeb-msg" style="margin-bottom:.4rem">Moving counts even when it isn’t a lift day. Small XP, zero obligations.</div>
    <div class="effort-row" style="justify-content:center;margin-bottom:.7rem">
      <button class="effort-btn sel" type="button" data-mt="Walk">Walk</button>
      <button class="effort-btn" type="button" data-mt="Other">Something else</button>
    </div>
    <div class="form-grid" style="text-align:left">
      <label><div class="label">Date</div><input type="date" id="mvDate" value="${todayISO()}"></label>
      <label><div class="label">Minutes (optional)</div><input type="number" step="1" id="mvMins" inputmode="numeric"></label>
      <label id="mvWhatWrap" style="display:none;grid-column:1/-1"><div class="label">What was it?</div><input type="text" id="mvWhat" maxlength="80" placeholder="vibration plate, bike ride, yard work..."></label>
    </div>
    <button class="btn big" type="button" id="mvSave">Log it (+${XP_MOVE} XP)</button>
    <p class="hint">Walks and other movement cheer the week strip on, but only lift days grow the orchard.</p>
  `);
  let mtype = 'Walk';
  document.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => {
    mtype = b.dataset.mt;
    document.querySelectorAll('[data-mt]').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    $('mvWhatWrap').style.display = mtype === 'Other' ? '' : 'none';
  });
  $('mvSave').onclick = async () => {
    const date = $('mvDate').value;
    if (!date) { toast('Pick a date.'); return; }
    const what = ($('mvWhat').value || '').trim();
    if (mtype === 'Other' && !what) { toast('One word about what it was.'); return; }
    const mins = parseInt($('mvMins').value, 10);
    $('mvSave').disabled = true;
    try {
      await atWrite('Workout Sessions', [{ fields: {
        'Session': date + ' · ' + (mtype === 'Walk' ? 'Walk' : what.slice(0, 40)),
        'Date': date, 'Day Type': mtype, 'Status': 'Completed',
        ...(isNaN(mins) ? {} : { 'Duration (min)': mins }),
        ...(what ? { 'Notes': what } : {}), 'XP Earned': XP_MOVE
      } }]);
      await loadAll();
      updateCharacter();
      // Same as the tape form: step back out of it first, then celebrate.
      if (overlayOpen) await backOnce();
      await celebrate({ title: 'Movement logged', msg: (mtype === 'Walk' ? 'A walk' : what.slice(0, 40)) + ' on ' + date + '. +' + XP_MOVE + ' XP. The peach respects cardio she doesn’t have to do.', size: 'small' });
      render(true);
      checkQuestCelebrations();
    } catch (e) { const b = $('mvSave'); if (b) b.disabled = false; toast('Save failed: ' + e.message); }
  };
}

/* ---------- Mat Day: an easy no-weights routine, any day ---------- */
function openMatModal() {
  openOverlay(`
    <div class="celeb-title">Mat Day</div>
    <div class="celeb-msg" style="margin-bottom:.4rem">About 20 easy minutes. Tap each one as you go. Skipping some still counts.</div>
    <ul class="warm-list" id="matList" style="text-align:left">${MAT_DAY.map((w, i) => `<li><label style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer"><input type="checkbox" data-mi="${i}" style="margin-top:.3rem;width:20px;height:20px;flex:none"><span>${esc(w)} · ${moveVideo(w)}</span></label></li>`).join('')}</ul>
    <button class="btn big" type="button" id="matSave">Mat Day done (+${XP_MAT} XP)</button>
    <p class="hint">Mat Day never counts as a lift, so it never blocks one and never moves the A-B-C order.</p>
  `);
  $('matSave').onclick = async () => {
    const n = document.querySelectorAll('#matList input:checked').length;
    const date = todayISO();
    $('matSave').disabled = true;
    try {
      await atWrite('Workout Sessions', [{ fields: {
        'Session': date + ' · Mat Day', 'Date': date, 'Day Type': 'Mat', 'Status': 'Completed',
        'Duration (min)': 20, 'Notes': 'Mat Day: ' + n + ' of ' + MAT_DAY.length + ' moves', 'XP Earned': XP_MAT
      } }]);
      await loadAll();
      updateCharacter();
      if (overlayOpen) await backOnce();
      await celebrate({ title: 'Mat Day done', msg: n + ' of ' + MAT_DAY.length + ' moves. +' + XP_MAT + ' XP. Balance and posture are the quiet part of strong.', size: 'small' });
      render(true);
      checkQuestCelebrations();
    } catch (e) { const b = $('matSave'); if (b) b.disabled = false; toast('Save failed: ' + e.message); }
  };
}

/* ---------- boot ---------- */
$('charWrap').addEventListener('click', e => {
  speak(TRASH_TALK[Math.floor(Math.random() * TRASH_TALK.length)]);
  georgiaState('pleased', 1000);
  const r = $('charWrap').getBoundingClientRect();
  burst(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2, 9);
});
// The wordmark is the home link. It stays in the app so Back still lands where you just were.
$('brand').addEventListener('click', e => {
  e.preventDefault();
  if (!$('main').firstChild || !S.game && !S.exercises.length) return;
  if (S.view !== 'home') go('home'); else window.scrollTo(0, 0);
});
$('charWrap').innerHTML = Georgia.svg(1);
$('tile').innerHTML = Georgia.svg(1);
(async function boot() {
  history.replaceState({ view: 'home' }, '');
  try {
    await loadAll();
  } catch (e) {
    $('main').innerHTML = '<section class="card"><h2>Couldn’t load the garage</h2><div class="empty-note" id="bootErr"></div></section>';
    $('bootErr').textContent = e.message + '. Refresh to retry.';
    return;
  }
  try { updateCharacter(); } catch (e) { /* the screen's own guard reports it */ }
  render(true);
})();
