// SPDX-License-Identifier: MIT
// Copyright (C) 2026 the Garage Booty Builder authors. See LICENSE.
// Garage Booty Builder: the training program.
//
// This is the file to edit if you want a different program. The app reads everything
// below and never changes it. Your logged sessions, sets and measurements live in your
// browser's storage, keyed by each exercise's `id`.
//
// Rules for editing:
// - Never reuse or rename an `id` once you've logged sets with it. Set history is keyed
//   by id, so a new exercise gets a new id. Ids are letters, numbers and dashes.
// - `day` is 'A', 'B' or 'C'. The app rotates A, B, C by sessions you actually do,
//   not by the calendar, so a missed day never gets skipped.
// - `slot` is the order inside a day. Slots 1 and 2 get a 3-minute rest timer, the rest 2.5.
// - `sets` is the full set count. Weeks 1-2, deloads and low-battery days use 2.
// - `repLow` / `repHigh` drive weight increases: after two clean sessions at the top of
//   the range, from week 5 on, the suggested weight goes up by `weightStep`.
// - `startWeight` is in pounds. Leave it out for bodyweight moves. Suggested weights are
//   rounded to the nearest `weightStep`, so make `startWeight` a multiple of it.
// - `inLowSession: true` puts the move in the short low-battery session.
// - `keyLift: true` gives it a strength chart on the Progress tab.
// - `videoUrl` (https only) pins a form video. Without one, the app links a YouTube search.
//
// Not medical advice. Check with your doctor before starting a new exercise program.
(function () {
  var exercises = [
    // Day A: glutes + push
    { id: 'a1-hip-thrust', name: 'Barbell Hip Thrust', day: 'A', slot: 1, sets: 3, repLow: 8, repHigh: 10, repText: '8–10', startWeight: 45, weightStep: 5, inLowSession: true, keyLift: true,
      cue: 'Pad the bar. Squeeze at the top and stop 2-3 reps before you could do another.' },
    { id: 'a2-split-squat', name: 'DB Bulgarian Split Squat', day: 'A', slot: 2, sets: 3, repLow: 8, repHigh: 8, repText: '8 /leg', startWeight: 15, weightStep: 5, perSide: true,
      cue: 'Long stride with a slight forward lean. Swap in reverse lunges for the first few weeks if balance is shaky.' },
    { id: 'a3-overhead-press', name: 'Seated DB Overhead Press', day: 'A', slot: 3, sets: 3, repLow: 8, repHigh: 10, repText: '8–10', startWeight: 12.5, weightStep: 2.5, inLowSession: true, keyLift: true,
      cue: 'Back against the bench, press straight up. Weight is per hand.' },
    { id: 'a4-hip-abduction', name: 'Side-Lying Hip Abduction', day: 'A', slot: 4, sets: 2, repLow: 12, repHigh: 15, repText: '12–15 /side', perSide: true,
      cue: 'Top leg straight, lift slow, toes pointed slightly down. Rest a light dumbbell on your thigh once it gets easy.' },
    { id: 'a5-triceps-extension', name: 'Seated DB Overhead Triceps Extension', day: 'A', slot: 5, sets: 2, repLow: 12, repHigh: 15, repText: '12–15', startWeight: 10, weightStep: 2.5,
      cue: 'Both hands on one dumbbell, elbows by your ears. Light and smooth.' },

    // Day B: hinge + push + pull
    { id: 'b1-romanian-deadlift', name: 'Barbell Romanian Deadlift', day: 'B', slot: 1, sets: 3, repLow: 8, repHigh: 8, repText: '8', startWeight: 55, weightStep: 5, keyLift: true,
      cue: 'Hinge at the hips, soft knees, keep the bar close to your legs.' },
    { id: 'b2-one-arm-row', name: 'Single-Arm DB Row', day: 'B', slot: 2, sets: 3, repLow: 10, repHigh: 10, repText: '10 /side', startWeight: 20, weightStep: 5, perSide: true, inLowSession: true, keyLift: true,
      cue: 'One hand and knee on a bench. Pull your elbow back toward your hip.' },
    { id: 'b3-floor-press', name: 'DB Floor Press', day: 'B', slot: 3, sets: 3, repLow: 8, repHigh: 10, repText: '8–10', startWeight: 15, weightStep: 2.5,
      cue: 'Lie on the floor, knees bent. Lower until your upper arms touch the floor, then press. Weight is per hand.' },
    { id: 'b4-side-plank', name: 'Side Plank', day: 'B', slot: 4, sets: 2, repText: '20–30s /side', perSide: true, timeBased: true,
      cue: 'Stack your shoulders and hips in one line. Drop to your knees if you need to.' },
    { id: 'b5-dead-bug', name: 'Dead Bug', day: 'B', slot: 5, sets: 2, repLow: 8, repHigh: 8, repText: '8 /side', perSide: true,
      cue: 'Ribs down, low back pressed into the floor, slow.' },
    { id: 'b6-fire-hydrant', name: 'Fire Hydrant', day: 'B', slot: 6, sets: 2, repLow: 12, repHigh: 12, repText: '12 /side', perSide: true,
      cue: 'On hands and knees, keep the knee bent and lift it out to the side without tipping your hips. Slow up, slow down.' },

    // Day C: glutes + upper mix
    { id: 'c1-paused-hip-thrust', name: 'Paused Barbell Hip Thrust', day: 'C', slot: 1, sets: 3, repLow: 8, repHigh: 8, repText: '8 (2s pause)', startWeight: 45, weightStep: 5, keyLift: true,
      cue: 'Hold a 2-second squeeze at the top. Same lift, harder per pound.' },
    { id: 'c2-step-up', name: 'DB Step-Up', day: 'C', slot: 2, sets: 3, repLow: 8, repHigh: 8, repText: '8 /leg', startWeight: 10, weightStep: 2.5, perSide: true,
      cue: 'Knee-height step. Push through your heel.' },
    { id: 'c3-chest-supported-row', name: 'Chest-Supported DB Row', day: 'C', slot: 3, sets: 3, repLow: 10, repHigh: 10, repText: '10', startWeight: 15, weightStep: 2.5,
      cue: 'Lie face down on an incline bench and pull both elbows back toward your hips. Weight is per hand.' },
    { id: 'c4-lateral-raise', name: 'DB Lateral Raise', day: 'C', slot: 4, sets: 3, repLow: 12, repHigh: 15, repText: '12–15', startWeight: 7.5, weightStep: 2.5,
      cue: 'Soft elbows, lift to shoulder height, no swinging.' },
    { id: 'c5-farmer-carry', name: 'Farmer Carry', day: 'C', slot: 5, sets: 2, repText: '40 steps', startWeight: 25, weightStep: 5, timeBased: true,
      cue: 'Tall spine, slow steps. Weight is per hand.' },
    { id: 'c6-fire-hydrant', name: 'Fire Hydrant', day: 'C', slot: 6, sets: 2, repLow: 12, repHigh: 12, repText: '12 /side', perSide: true,
      cue: 'On hands and knees, keep the knee bent and lift it out to the side without tipping your hips. Slow up, slow down.' }
  ];

  window.GBB_PROGRAM = {
    exercises: exercises,
    dayTitles: { A: 'Glutes + Push', B: 'Hinge + Push + Pull', C: 'Glutes + Upper Mix' },
    // The 4-minute opener before every lift session.
    warmup: [
      'Cat-cow, 5 slow rounds',
      'Bodyweight glute bridge, 10 reps',
      'Side-lying leg lift, 10 each side',
      'Single-leg balance stand, 30s each side',
      'Bodyweight squat, 10 reps',
      'Heel drops, 10 (up on your toes, drop onto your heels, knees soft)'
    ],
    // Mat Day: an easy no-weights routine you can open any day. It never counts as a lift,
    // so it never blocks one and never moves the A-B-C order.
    matDay: [
      'Cat-cow, 8 slow rounds',
      'Single-leg balance, 30s each side (fingertips on a wall is fine)',
      'Bird dog, 8 each side, slow',
      'Glute bridge, 12',
      'Side-lying inner-thigh lift, 10 each side (top foot planted in front, bottom leg lifts)',
      'Side-lying outer-hip leg lift, 12 each side (top leg straight, lift slow, toes slightly down)',
      'Face-down back lift, 8 gentle reps, 2s hold',
      'Dead bug, 6 each side',
      'Stretch: hips, hamstrings, chest, about 3 minutes'
    ]
  };
})();
