/* LTA.data — static program content. No logic, no persistence.
 *
 * Exercise = { id, name, category: 'strength'|'accessory'|'rehab'|'conditioning'|'mobility'|'core',
 *              equipment, repRange:[lo,hi], incrementKg, cues:[], subs:[], painGate?:'knee'|'shoulder',
 *              unit?: 'reps'|'seconds' }
 */
window.LTA = window.LTA || {};

LTA.data = (function () {
  'use strict';

  const EX = {};
  function ex(id, name, category, equipment, repRange, incrementKg, cues, subs, extra) {
    EX[id] = Object.assign({ id, name, category, equipment, repRange, incrementKg, cues, subs: subs || [], unit: 'reps' }, extra || {});
  }

  // ---- Main strength ----
  ex('back_squat', 'Back Squat', 'strength', 'barbell + rack', [6, 10], 2.5,
    ['Brace before you descend', 'Knees track over toes', 'Drive the floor away'], ['leg_press', 'goblet_squat']);
  ex('goblet_squat', 'Goblet Squat', 'strength', 'dumbbell', [8, 12], 2,
    ['Elbows inside knees at bottom', 'Chest tall'], ['leg_press']);
  ex('rdl', 'Romanian Deadlift', 'strength', 'barbell', [8, 12], 2.5,
    ['Hips back, soft knees', 'Bar drags the thighs', 'Feel the hamstrings load'], ['db_rdl', 'leg_curl']);
  ex('db_rdl', 'DB Romanian Deadlift', 'strength', 'dumbbells', [8, 12], 2,
    ['Hips back, flat back', 'Dumbbells stay close'], ['leg_curl']);
  ex('leg_press', 'Leg Press', 'strength', 'machine', [10, 15], 5,
    ['Full foot pressure', 'Don’t let knees cave'], ['back_squat']);
  ex('leg_curl', 'Seated Leg Curl', 'accessory', 'machine', [10, 15], 2.5,
    ['Control the return', 'Squeeze at full flexion'], ['db_rdl']);
  ex('calf_raise', 'Standing Calf Raise', 'accessory', 'machine', [10, 15], 2.5,
    ['Pause at stretch', 'Full rise to big toe'], ['sl_calf_raise']);
  ex('trap_bar_dl', 'Trap-Bar Deadlift', 'strength', 'trap bar', [5, 8], 5,
    ['Push the floor away', 'Lats tight, chest proud', 'Stand tall, don’t lean back'], ['rdl', 'leg_press']);
  ex('bss', 'Bulgarian Split Squat', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['Front foot far enough forward', 'Torso slightly forward', 'Drive through mid-foot'], ['split_squat', 'leg_press']);
  ex('split_squat', 'Split Squat', 'strength', 'dumbbells', [8, 12], 2,
    ['Straight down, straight up'], ['leg_press']);
  ex('hip_thrust', 'Hip Thrust', 'strength', 'barbell + bench', [8, 12], 5,
    ['Chin tucked, ribs down', 'Full lockout squeeze'], ['glute_bridge']);
  ex('glute_bridge', 'Glute Bridge', 'strength', 'barbell', [10, 15], 5, ['Squeeze at top'], []);
  ex('sl_rdl', 'Single-Leg RDL', 'strength', 'dumbbell', [8, 10], 2,
    ['Square hips to floor', 'Reach the back heel away'], ['db_rdl']);
  ex('adductor_machine', 'Adductor Machine', 'accessory', 'machine', [12, 15], 2.5,
    ['Slow and controlled', 'Full comfortable range'], []);

  ex('bench_press', 'Bench Press', 'strength', 'barbell + bench', [6, 10], 2.5,
    ['Shoulder blades pinned back', 'Feet driving', 'Bar to lower chest'], ['incline_db_press', 'machine_chest_press']);
  ex('machine_chest_press', 'Machine Chest Press', 'strength', 'machine', [8, 12], 2.5, ['Shoulders back into pad'], []);
  ex('incline_db_press', 'Incline DB Press', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['30–45° bench', 'Elbows ~45° from torso'], ['machine_chest_press']);
  ex('cs_row', 'Chest-Supported Row', 'strength', 'machine or bench', [8, 12], 2.5,
    ['Pull elbows to hips', 'No torso heave'], ['cable_row_1arm', 'lat_pulldown']);
  ex('cable_row_1arm', 'One-Arm Cable Row', 'accessory', 'cable', [10, 12], 2.5,
    ['Long stretch forward', 'Elbow to hip'], ['cs_row']);
  ex('face_pull', 'Face Pull', 'accessory', 'cable + rope', [12, 15], 1.25,
    ['Pull to eyebrows', 'Thumbs point back at the end'], ['prone_t']);
  ex('db_curl', 'DB Curl', 'accessory', 'dumbbells', [10, 15], 2, ['No swing'], []);
  ex('triceps_pressdown', 'Triceps Pressdown', 'accessory', 'cable', [10, 15], 2.5, ['Elbows pinned'], []);
  ex('lat_pulldown', 'Lat Pulldown', 'strength', 'cable', [6, 10], 2.5,
    ['Drive elbows down', 'Chest to the bar'], ['pull_up', 'cs_row']);
  ex('pull_up', 'Pull-Up', 'strength', 'bar (+ belt)', [6, 10], 2.5,
    ['Full hang start', 'Chin over bar'], ['lat_pulldown']);
  ex('lateral_raise', 'DB Lateral Raise', 'accessory', 'dumbbells', [12, 15], 1,
    ['Lead with elbows', 'Pour-the-jug tilt not needed — stay neutral'], ['cable_lateral_raise']);
  ex('cable_lateral_raise', 'Cable Lateral Raise', 'accessory', 'cable', [12, 15], 1.25, ['Lean slightly away'], []);

  // ---- Overhead ladder (all shoulder pain-gated) ----
  ex('landmine_press', 'Half-Kneeling Landmine Press', 'strength', 'landmine/barbell corner', [8, 12], 2.5,
    ['Ribs down, glute of down-knee on', 'Press up and slightly forward', 'Pain-free arc only'], ['incline_db_press'], { painGate: 'shoulder' });
  ex('high_incline_db_press', 'High-Incline DB Press (~60°)', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['Elbows just in front of shoulders', 'Stop shy of a painful arc'], ['landmine_press'], { painGate: 'shoulder' });
  ex('seated_db_press', 'Seated DB Shoulder Press', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['Forearms vertical', 'Press slightly in front of the head'], ['high_incline_db_press'], { painGate: 'shoulder' });
  ex('standing_db_ohp', 'Standing DB Overhead Press', 'strength', 'dumbbells', [8, 12], 2,
    ['Glutes and ribs braced', 'Biceps finish by the ears'], ['seated_db_press'], { painGate: 'shoulder' });
  ex('barbell_ohp', 'Standing Barbell OHP', 'strength', 'barbell', [6, 10], 2.5,
    ['Squeeze glutes, ribs down', 'Head through at lockout'], ['standing_db_ohp'], { painGate: 'shoulder' });
  ex('med_ball_chop', 'Med-Ball Serve Chop', 'accessory', 'medicine ball', [8, 10], 1,
    ['Mimic the serve arc', 'Whip from the hips, not the shoulder'], [], { painGate: 'shoulder' });

  // ---- Shoulder rehab / resilience ----
  ex('side_lying_er', 'Side-Lying External Rotation', 'rehab', 'light dumbbell', [12, 15], 0.5,
    ['Towel under elbow', 'Slow 3-sec lower'], [], { painGate: 'shoulder' });
  ex('cable_er_9090', 'Cable ER at 90/90', 'rehab', 'cable', [12, 15], 1.25,
    ['Elbow stays level with shoulder', 'Rotate, don’t press'], ['side_lying_er'], { painGate: 'shoulder' });
  ex('prone_y', 'Prone Y Raise', 'rehab', 'incline bench, light DBs', [10, 12], 0.5,
    ['Thumbs up', 'Lift from the lower traps, not the neck'], []);
  ex('prone_t', 'Prone T Raise', 'rehab', 'incline bench, light DBs', [10, 12], 0.5,
    ['Squeeze shoulder blades together', 'Neck long and relaxed'], ['face_pull']);
  ex('pushup_plus', 'Push-Up Plus', 'rehab', 'bodyweight', [10, 10], 0,
    ['Push the floor away at the top', 'Round the upper back slightly'], []);
  ex('serratus_wall_slide', 'Serratus Wall Slide', 'rehab', 'wall (+ band)', [10, 10], 0,
    ['Forearms slide up the wall', 'Reach at the top'], []);
  ex('scap_pull_up', 'Scap Pull-Up', 'rehab', 'bar', [8, 8], 0,
    ['Arms straight', 'Pull shoulder blades down only'], []);
  ex('thoracic_ext_roller', 'Thoracic Extension on Roller', 'mobility', 'foam roller', [10, 10], 0,
    ['Support the head', 'Extend over the roller, not the low back'], [], { unit: 'reps' });

  // ---- Knee rehab / resilience ----
  ex('band_lateral_walk', 'Banded Lateral Walk', 'rehab', 'mini band', [15, 15], 0,
    ['Stay low, feet apart', 'Don’t drag the trailing foot'], [], { painGate: 'knee' });
  ex('side_hip_abduction', 'Side-Lying Hip Abduction', 'rehab', 'bodyweight/ankle weight', [12, 15], 0,
    ['Heel leads, toes slightly down', 'Torso still'], [], { painGate: 'knee' });
  ex('tibialis_raise', 'Tibialis Raise', 'rehab', 'wall or tib bar', [15, 20], 0,
    ['Heels planted, lift toes high', 'Slow lower'], [], { painGate: 'knee' });
  ex('sl_calf_raise', 'Single-Leg Calf Raise', 'rehab', 'step', [10, 12], 0,
    ['Full stretch at bottom', 'Straight up, no rolling out'], ['calf_raise'], { painGate: 'knee' });
  ex('hip_airplane', 'Hip Airplane', 'rehab', 'bodyweight', [8, 8], 0,
    ['Hinge on one leg', 'Rotate hips open then closed, slow'], [], { painGate: 'knee' });

  // ---- Core ----
  ex('dead_bug', 'Dead Bug', 'core', 'floor', [8, 8], 0, ['Low back glued down', 'Exhale as limbs extend'], []);
  ex('side_plank', 'Side Plank', 'core', 'floor', [30, 45], 0, ['Straight line head to feet', 'Hips high'], [], { unit: 'seconds' });
  ex('pallof_press', 'Pallof Press', 'core', 'cable/band', [10, 10], 1.25, ['Resist the twist', 'Slow press out'], []);

  // ---- Conditioning & mobility ----
  ex('z2_bike', 'Zone-2 Bike', 'conditioning', 'static bike', [40, 60], 0,
    ['Conversational pace — you can talk in sentences', 'Nose-breathing is a good check'], ['incline_walk'], { unit: 'seconds' });
  ex('incline_walk', 'Incline Treadmill Walk', 'conditioning', 'treadmill', [30, 45], 0,
    ['10–12% incline, no handrails', 'Conversational pace'], ['z2_bike'], { unit: 'seconds', painGate: 'knee' });
  ex('bike_intervals', 'Bike Intervals', 'conditioning', 'static bike', [1, 1], 0,
    ['6 × 2 min hard / 2 min easy', 'Hard = can say words, not sentences'], [], { unit: 'seconds' });
  ex('mobility_flow', 'Mobility Flow', 'mobility', 'mat + roller', [15, 15], 0,
    ['Couch stretch 2×45s/side', '90/90 hip switches ×10', 'Thoracic rotations ×8/side', 'Cross-body shoulder 2×30s'], [], { unit: 'seconds' });

  // ---- Prescriptions helper ----
  function p(exerciseId, sets, repLo, repHi, restSec, progression, notes) {
    return { exerciseId, sets, repLo, repHi, restSec, progression: progression || 'double', notes };
  }

  // ---- Day templates ----
  // priority: higher = protected longer when the week gets crowded by racket sessions.
  const DAYS = {
    lowerA: {
      id: 'lowerA', name: 'Lower A · Strength', kind: 'strength', priority: 6,
      blocks: [
        { title: 'Main lifts', items: [p('back_squat', 3, 6, 10, 150), p('rdl', 3, 8, 12, 120), p('leg_press', 3, 10, 15, 90)] },
        { title: 'Accessories', items: [p('leg_curl', 3, 10, 15, 75), p('calf_raise', 3, 10, 15, 60)] },
        { title: 'Knee resilience A', items: [p('band_lateral_walk', 3, 15, 15, 45, 'rehab'), p('side_hip_abduction', 3, 12, 15, 45, 'rehab'), p('tibialis_raise', 3, 15, 20, 45, 'rehab')] },
        { title: 'Flush', items: [p('z2_bike', 1, 10, 10, 0, 'timed', '10 min easy spin')] },
      ],
    },
    upperA: {
      id: 'upperA', name: 'Upper A · Horizontal', kind: 'strength', priority: 5,
      blocks: [
        { title: 'Main lifts', items: [p('bench_press', 3, 6, 10, 150), p('cs_row', 3, 8, 12, 120), p('incline_db_press', 3, 8, 12, 90), p('cable_row_1arm', 3, 10, 12, 75)] },
        { title: 'Accessories', items: [p('face_pull', 3, 12, 15, 60), p('db_curl', 2, 10, 15, 60), p('triceps_pressdown', 2, 10, 15, 60)] },
        { title: 'Shoulder resilience A', items: [p('side_lying_er', 3, 12, 15, 45, 'rehab'), p('prone_y', 3, 10, 12, 45, 'rehab'), p('pushup_plus', 3, 10, 10, 45, 'rehab')] },
      ],
    },
    run: {
      id: 'run', name: 'Run · Return-to-Run', kind: 'run', priority: 4,
      blocks: [
        { title: 'Run stage', items: [] }, // filled from runState by the engine
        { title: 'Core', items: [p('dead_bug', 3, 8, 8, 45, 'rehab'), p('side_plank', 3, 30, 45, 45, 'timed'), p('pallof_press', 3, 10, 10, 45, 'rehab')] },
      ],
    },
    upperB: {
      id: 'upperB', name: 'Upper B · Vertical', kind: 'strength', priority: 3,
      blocks: [
        { title: 'Overhead ladder', items: [p('landmine_press', 3, 8, 12, 120)] }, // exercise swapped in from shoulderState by the engine
        { title: 'Main lifts', items: [p('lat_pulldown', 3, 6, 10, 120)] },
        { title: 'Accessories', items: [p('cable_er_9090', 3, 12, 15, 60, 'rehab'), p('lateral_raise', 3, 12, 15, 60), p('scap_pull_up', 2, 8, 8, 60, 'rehab')] },
        { title: 'Shoulder resilience B', items: [p('prone_t', 3, 10, 12, 45, 'rehab'), p('serratus_wall_slide', 3, 10, 10, 45, 'rehab'), p('thoracic_ext_roller', 2, 10, 10, 30, 'rehab')] },
      ],
    },
    lowerB: {
      id: 'lowerB', name: 'Lower B · Single-Leg & Hinge', kind: 'strength', priority: 6,
      blocks: [
        { title: 'Main lifts', items: [p('trap_bar_dl', 3, 5, 8, 180), p('bss', 3, 8, 12, 105), p('hip_thrust', 3, 8, 12, 105)] },
        { title: 'Accessories', items: [p('sl_rdl', 3, 8, 10, 75), p('adductor_machine', 3, 12, 15, 60)] },
        { title: 'Knee resilience B', items: [p('sl_calf_raise', 3, 10, 12, 45, 'rehab'), p('tibialis_raise', 3, 15, 20, 45, 'rehab'), p('hip_airplane', 2, 8, 8, 45, 'rehab')] },
      ],
    },
    z2: {
      id: 'z2', name: 'Zone-2 + Mobility', kind: 'conditioning', priority: 2,
      blocks: [
        { title: 'Steady state', items: [p('z2_bike', 1, 40, 60, 0, 'timed', 'Bike or incline walk, 40–60 min conversational')] },
        { title: 'Mobility', items: [p('mobility_flow', 1, 15, 15, 0, 'timed')] },
      ],
    },
    rest: {
      id: 'rest', name: 'Rest / Recovery', kind: 'rest', priority: 1,
      blocks: [{ title: 'Optional', items: [p('mobility_flow', 1, 15, 15, 0, 'timed', 'Walk, stretch, or full rest')] }],
    },
    racket: {
      id: 'racket', name: 'Racket Sport', kind: 'racket', priority: 7,
      blocks: [{ title: 'Play', items: [] }],
    },
  };

  // Default weekly skeleton: index 0 = Monday.
  const WEEK_SKELETON = ['lowerA', 'upperA', 'run', 'upperB', 'lowerB', 'z2', 'rest'];

  // ---- Return-to-run stages ----
  // Advance after `completionsRequired` runs with knee pain <=2/10 during AND next morning.
  const RUN_STAGES = [
    { id: 0, name: 'Baseline walk', protocol: '30 min incline walk, brisk', intervals: [{ run: 0, walk: 30 }], totalRunMin: 0, completionsRequired: 1 },
    { id: 1, name: 'Stage 1', protocol: '8 × (1 min run / 2 min walk)', intervals: Array(8).fill({ run: 1, walk: 2 }), totalRunMin: 8, completionsRequired: 2 },
    { id: 2, name: 'Stage 2', protocol: '6 × (2 min run / 2 min walk)', intervals: Array(6).fill({ run: 2, walk: 2 }), totalRunMin: 12, completionsRequired: 2 },
    { id: 3, name: 'Stage 3', protocol: '5 × (3 min run / 2 min walk)', intervals: Array(5).fill({ run: 3, walk: 2 }), totalRunMin: 15, completionsRequired: 2 },
    { id: 4, name: 'Stage 4', protocol: '4 × (5 min run / 2 min walk)', intervals: Array(4).fill({ run: 5, walk: 2 }), totalRunMin: 20, completionsRequired: 2 },
    { id: 5, name: 'Stage 5', protocol: '3 × (8 min run / 2 min walk)', intervals: Array(3).fill({ run: 8, walk: 2 }), totalRunMin: 24, completionsRequired: 2 },
    { id: 6, name: 'Stage 6', protocol: '2 × (12 min run / 3 min walk)', intervals: Array(2).fill({ run: 12, walk: 3 }), totalRunMin: 24, completionsRequired: 2 },
    { id: 7, name: 'Stage 7', protocol: '20 min continuous run', intervals: [{ run: 20, walk: 0 }], totalRunMin: 20, completionsRequired: 2 },
    { id: 8, name: 'Stage 8', protocol: '25 min continuous run', intervals: [{ run: 25, walk: 0 }], totalRunMin: 25, completionsRequired: 2 },
    { id: 9, name: 'Stage 9', protocol: '30 min continuous run', intervals: [{ run: 30, walk: 0 }], totalRunMin: 30, completionsRequired: 2 },
    { id: 10, name: '5k benchmark', protocol: '5 km at a comfortable pace — log your time', intervals: [{ run: 35, walk: 0 }], totalRunMin: 35, completionsRequired: 2 },
  ];
  const RUN_CUES = ['Flat surface, avoid downhill', 'Cadence ~170–180 (shorter, quicker steps)', 'Stop the session if knee pain reaches 3/10 and is rising'];

  // Sprint track — unlocks when run stage 7 is completed pain-free.
  const SPRINT_STAGES = [
    { id: 0, name: 'Strides', protocol: '4 × 10 s strides @ ~75%, walk-back recovery', sessionsRequired: 4 },
    { id: 1, name: 'Hill sprints', protocol: '6 × 8 s hill sprints, walk-back recovery', sessionsRequired: 5 },
    { id: 2, name: 'Accelerations', protocol: '4–6 × 20–30 m flat accelerations, full recovery', sessionsRequired: 999 },
  ];

  // ---- Overhead loading ladder ----
  // Advance after 2 consecutive sessions with shoulder pain <=2/10 during AND next day.
  const OVERHEAD_RUNGS = [
    { id: 0, exerciseId: 'landmine_press', sessionsRequired: 2 },
    { id: 1, exerciseId: 'high_incline_db_press', sessionsRequired: 2 },
    { id: 2, exerciseId: 'seated_db_press', sessionsRequired: 2 },
    { id: 3, exerciseId: 'standing_db_ohp', sessionsRequired: 2 },
    { id: 4, exerciseId: 'barbell_ohp', sessionsRequired: 999, addOn: 'med_ball_chop' },
  ];

  // Lifts worth charting on the Progress screen.
  const MAIN_LIFTS = ['back_squat', 'bench_press', 'trap_bar_dl', 'rdl', 'lat_pulldown', 'landmine_press', 'high_incline_db_press', 'seated_db_press', 'standing_db_ohp', 'barbell_ohp'];

  return { EXERCISES: EX, DAYS, WEEK_SKELETON, RUN_STAGES, RUN_CUES, SPRINT_STAGES, OVERHEAD_RUNGS, MAIN_LIFTS };
})();
