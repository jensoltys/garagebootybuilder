// SPDX-License-Identifier: MIT
// Copyright (C) 2026 the Garage Booty Builder authors. See LICENSE.
// Garage Booty Builder: "what is today?" in ONE place.
// app.js calls GBB.decide() for the day, the week, the deload and which lift is next.
// Everything here is a pure function of the rows passed in: no fetches, no storage, no DOM,
// so it also runs under Node for the tests. Rows may be { id, fields } records or flat rows.
//
// PROGRAM RAILS live here too (week, deload, rotation, sets, rests). They're the
// recovery-first part of the app, so change them on purpose.
(function () {
  var LIFT = ['A', 'B', 'C', 'Low'];
  var WARM_MIN = 4;      // the "4-minute opener"
  var COOL_SECS = 240;   // the cool-down walk timer
  // A session that stopped early through "Just one exercise" carries this at the start of
  // its Notes. It is a full-credit lift session everywhere (XP, quests, orchard, crash
  // follow-up, rest day). The ONLY thing it changes: it does not move the A-B-C rotation
  // on, so the day you didn't finish is still next.
  var SHORT_MARK = 'Short session';
  function weekStart(isoDate) { var d = new Date(isoDate + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return todayISO(d); }

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000); }
  function flat(r) { return r && r.fields && typeof r.fields === 'object' ? r.fields : (r || {}); }
  function rows(list) { return Array.isArray(list) ? list.map(flat) : []; }
  function sel(v) { return v && typeof v === 'object' && v.name ? v.name : v; }
  function iso(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T12:00').getTime()) ? v : ''; }

  function completed(sessions) { return rows(sessions).filter(function (s) { return s.Status === 'Completed'; }); }
  function liftSessions(sessions) { return completed(sessions).filter(function (s) { return LIFT.indexOf(sel(s['Day Type'])) !== -1; }); }
  function isShort(s) { s = flat(s); return typeof s.Notes === 'string' && s.Notes.indexOf(SHORT_MARK) === 0; }

  function programWeek(game, today) {
    var start = game && iso(flat(game)['Program Start Date']);
    if (!start) return 1;
    return Math.max(1, Math.floor(daysBetween(start, today || todayISO()) / 7) + 1);
  }
  function inDeload(game, today) {
    today = today || todayISO();
    var week = programWeek(game, today);
    if (week > 1 && week % 7 === 0) return true;
    var du = game && iso(flat(game)['Deload Until']);
    return !!(du && today <= du);
  }
  // Show-up-based rotation: every completed lift session (A, B, C or Low) moves it on one.
  // Short sessions are the one exception (see SHORT_MARK).
  function nextDayLetter(sessions) {
    var n = liftSessions(sessions).filter(function (s) { return !isShort(s); }).length;
    return ['A', 'B', 'C'][n % 3];
  }
  function targetSets(ex, week, battery, deload) {
    ex = flat(ex);
    if (battery <= 2) return 2;
    if (deload) return 2;
    if (week <= 2) return 2;
    return ex.Sets || 3;
  }
  function restSecs(ex) { ex = flat(ex); return (ex.Slot || 3) <= 2 ? 180 : 150; }

  function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }
  // How long the day takes. Your own logged sessions of that day win (middle of the last
  // three, same deload setting). With none logged yet it is the plan's own clocks added up:
  // the 4-minute opener, every rest timer, the cool-down walk. Rounded to 5 minutes.
  function planMinutes(exercises, day, week, deload) {
    var pool = rows(exercises).filter(function (e) { return sel(e.Day) === day; })
      .sort(function (a, b) { return (a.Slot || 0) - (b.Slot || 0); });
    if (!pool.length) return null;
    var secs = 0, last = 0;
    pool.forEach(function (e) {
      var n = Number(targetSets(e, week, 3, deload)) || 0;
      secs += n * restSecs(e); if (n > 0) last = restSecs(e);
    });
    secs -= last; // no rest timer after the final set
    return round5(WARM_MIN + secs / 60 + COOL_SECS / 60);
  }
  function loggedMinutes(sessions, day, deload) {
    var mins = liftSessions(sessions).filter(function (s) {
      var m = Number(s['Duration (min)']);
      return sel(s['Day Type']) === day && !isShort(s) && !!s.Deload === !!deload && m >= 5 && m <= 180;
    }).sort(function (a, b) { return String(a.Date || '').localeCompare(String(b.Date || '')); })
      .slice(-3).map(function (s) { return Number(s['Duration (min)']); }).sort(function (a, b) { return a - b; });
    if (!mins.length) return null;
    return round5(mins[Math.floor((mins.length - 1) / 2)]);
  }

  // input: { sessions, game, exercises, today? }  (today defaults to the browser's local date)
  function decide(input) {
    input = input || {};
    var today = input.today || todayISO();
    var game = Array.isArray(input.game) ? input.game[0] : input.game;
    var lifts = liftSessions(input.sessions);
    var week = programWeek(game, today), deload = inDeload(game, today);
    var nextDay = nextDayLetter(input.sessions);
    var liftedToday = lifts.some(function (s) { return s.Date === today; });
    var liftedYesterday = lifts.some(function (s) { return iso(s.Date) && daysBetween(s.Date, today) === 1; });
    // done: a lift is already logged today. rest: the day after a lift. lift: a normal lift day.
    var state = liftedToday ? 'done' : liftedYesterday ? 'rest' : 'lift';
    var minutes = loggedMinutes(input.sessions, nextDay, deload);
    var minutesFrom = minutes == null ? 'plan' : 'log';
    if (minutes == null) minutes = planMinutes(input.exercises, nextDay, week, deload);
    return {
      today: today, week: week, deload: deload, nextDay: nextDay, liftCount: lifts.length,
      liftedToday: liftedToday, liftedYesterday: liftedYesterday, state: state, label: 'Lift ' + nextDay,
      minutes: minutes || null, minutesFrom: minutes ? minutesFrom : null, about: minutes ? 'about ' + minutes + ' minutes' : ''
    };
  }

  var api = {
    LIFT: LIFT, WARM_MIN: WARM_MIN, COOL_SECS: COOL_SECS, SHORT_MARK: SHORT_MARK, weekStart: weekStart,
    todayISO: todayISO, daysBetween: daysBetween, completed: completed, liftSessions: liftSessions, isShort: isShort,
    programWeek: programWeek, inDeload: inDeload, nextDayLetter: nextDayLetter, targetSets: targetSets, restSecs: restSecs,
    planMinutes: planMinutes, loggedMinutes: loggedMinutes, decide: decide
  };
  if (typeof window !== 'undefined') window.GBB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
