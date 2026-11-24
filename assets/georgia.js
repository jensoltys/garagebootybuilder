// SPDX-License-Identifier: MIT
// Copyright (C) 2026 the Garage Booty Builder authors. See LICENSE.
// Georgia the peach, the Garage Booty Builder mascot. Five stages, by level:
// Fresh Peach 1 / Warmed-Up 4 / Toned 8 / Strong 13 / Legendary 20.
//   Georgia.svg(level)   draws her for a level (sweatband at stage 2, dumbbells at 3,
//                        bigger grin at 4, crown + arms up + sparkles at 5)
//   Georgia.stage(level) gives { index: 1..5, name, at }
//   Georgia.iris(level)  is her eye color, which changes with level
// Parts carry classes so the page can animate them with CSS: .georgia-eyes blinks,
// .georgia-leaf flutters, .georgia-spark twinkles. .georgia-grin (her big celebrating grin)
// is hidden by its own attribute, so she draws correctly with no CSS at all. The page shows
// it, and hides .georgia-mouth, by putting .grin on her wrapper.
(function () {
  var STAGES = [
    { at: 1, name: 'Fresh Peach' },
    { at: 4, name: 'Warmed-Up Peach' },
    { at: 8, name: 'Toned Peach' },
    { at: 13, name: 'Strong Peach' },
    { at: 20, name: 'Legendary Peach' }
  ];
  var uid = 0;

  function stage(level) {
    var lv = Number(level) || 1, i = 0;
    for (var n = 0; n < STAGES.length; n++) { if (lv >= STAGES[n].at) i = n; }
    return { index: i + 1, name: STAGES[i].name, at: STAGES[i].at };
  }
  function iris(level) {
    var lv = Number(level) || 1;
    return lv >= 13 ? '#b06fd8' : lv >= 8 ? '#2e8b7a' : lv >= 4 ? '#a3622e' : '#5a3a2c';
  }
  function sparkle(x, y, q, i) {
    return '<path class="georgia-spark" style="animation-delay:' + (i * 0.4) + 's" fill="#FFE9A6" d="M' + x + ' ' + (y - q) + 'l' + (q * 0.3) + ' ' + (q * 0.7) + 'l' + (q * 0.7) + ' ' + (q * 0.3) + 'l-' + (q * 0.7) + ' ' + (q * 0.3) + 'l-' + (q * 0.3) + ' ' + (q * 0.7) + 'l-' + (q * 0.3) + ' -' + (q * 0.7) + 'l-' + (q * 0.7) + ' -' + (q * 0.3) + 'l' + (q * 0.7) + ' -' + (q * 0.3) + 'z"/>';
  }
  function dumbbell(x, y, rot) {
    return '<g transform="rotate(' + rot + ' ' + x + ' ' + y + ')"><rect x="' + (x - 20) + '" y="' + (y - 4) + '" width="40" height="8" rx="4" fill="#C9CED9"/><rect x="' + (x - 26) + '" y="' + (y - 11) + '" width="10" height="22" rx="4" fill="#4A5060"/><rect x="' + (x + 16) + '" y="' + (y - 11) + '" width="10" height="22" rx="4" fill="#4A5060"/></g>';
  }
  function mouthPath(r, x, y) {
    return ['M' + (x - 8) + ' ' + (y + 22) + 'q8 5 16 0', 'M' + (x - 9) + ' ' + (y + 21) + 'q9 8 18 0', 'M' + (x - 10) + ' ' + (y + 20) + 'q10 11 20 0',
      'M' + (x - 11) + ' ' + (y + 20) + 'q11 13 22 0', 'M' + (x - 12) + ' ' + (y + 19) + 'q12 17 24 0z'][r];
  }
  function face(x, y, r, eye) {
    var s = '<g class="georgia-eyes"><circle cx="' + (x - 18) + '" cy="' + y + '" r="11" fill="#fff"/><circle cx="' + (x + 18) + '" cy="' + y + '" r="11" fill="#fff"/>' +
      '<circle class="georgia-iris" cx="' + (x - 16.5) + '" cy="' + (y + 1) + '" r="6.5" fill="' + eye + '"/><circle class="georgia-iris" cx="' + (x + 19.5) + '" cy="' + (y + 1) + '" r="6.5" fill="' + eye + '"/>' +
      '<circle cx="' + (x - 14.5) + '" cy="' + (y - 1.5) + '" r="2.6" fill="#fff"/><circle cx="' + (x + 21.5) + '" cy="' + (y - 1.5) + '" r="2.6" fill="#fff"/></g>';
    // Her everyday mouth for the stage, and the big open grin she wears while celebrating.
    s += '<path class="georgia-mouth" d="' + mouthPath(r, x, y) + '" stroke="#5A2A1C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="' + (r === 4 ? '#7A2A44' : 'none') + '"/>';
    s += '<path class="georgia-grin" display="none" d="' + mouthPath(4, x, y) + '" stroke="#5A2A1C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="#7A2A44"/>';
    return s;
  }

  function svg(level) {
    var st = stage(level), r = st.index - 1, id = 'ge' + (uid++), s = '', up = r === 4;
    s += '<defs><radialGradient id="' + id + 'g" cx="36%" cy="26%" r="82%"><stop offset="0" stop-color="#FFD3BD"/><stop offset=".5" stop-color="#FF9B7A"/><stop offset="1" stop-color="#D9603F"/></radialGradient></defs>';
    s += '<ellipse cx="100" cy="198" rx="62" ry="7" fill="#000" opacity=".25"/>';
    s += '<path d="M100 46q-2 -14 6 -22" stroke="#7A4A2A" stroke-width="5" stroke-linecap="round" fill="none"/><path class="georgia-leaf" d="M106 30q22 -14 36 4q-22 12 -36 -4z" fill="#7CC27A" stroke="#3F8A45" stroke-width="2"/>';
    s += '<ellipse cx="34" cy="' + (up ? 92 : 140) + '" rx="12" ry="24" fill="#F0825F" transform="rotate(' + (up ? -30 : 22) + ' 34 ' + (up ? 92 : 140) + ')"/><ellipse cx="166" cy="' + (up ? 92 : 140) + '" rx="12" ry="24" fill="#F0825F" transform="rotate(' + (up ? 30 : -22) + ' 166 ' + (up ? 92 : 140) + ')"/>';
    s += '<path d="M100 44c48 0 72 34 72 78s-28 76-72 76s-72 -32 -72 -76s24 -78 72 -78z" fill="url(#' + id + 'g)"/><path d="M100 48q-8 30 0 60" stroke="#D9603F" stroke-width="3" fill="none" opacity=".5"/>';
    s += '<ellipse cx="78" cy="78" rx="26" ry="13" fill="#fff" opacity=".28"/>';
    if (r >= 1) s += '<path d="M34 92q66 -22 132 0v14q-66 -22 -132 0z" fill="#B58CE0" stroke="#7E55B8" stroke-width="2"/>';
    s += face(100, 124, r, iris(level));
    s += '<ellipse cx="58" cy="146" rx="10" ry="6" fill="#FF6F8E" opacity=".5"/><ellipse cx="142" cy="146" rx="10" ry="6" fill="#FF6F8E" opacity=".5"/>';
    if (r >= 2) s += dumbbell(up ? 22 : 26, up ? 70 : 166, up ? -30 : -20) + dumbbell(up ? 178 : 174, up ? 70 : 166, up ? 30 : 20);
    if (r >= 4) s += '<path d="M0 20L4 4L13 13L21 0L29 13L38 4L42 20Z" fill="#FFC46B" stroke="#B5791C" stroke-width="1.6" transform="translate(79 2)"/>' + sparkle(26, 40, 8, 0) + sparkle(176, 36, 9, 1);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 210" data-stage="' + st.index + '" aria-hidden="true">' + s + '</svg>';
  }

  var api = { STAGES: STAGES, stage: stage, iris: iris, svg: svg };
  if (typeof window !== 'undefined') window.Georgia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
