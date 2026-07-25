/* LTA.data — static program content. No logic, no persistence.
 *
 * Exercise = { id, name, category: 'strength'|'accessory'|'rehab'|'power'|'conditioning'|'mobility'|'core',
 *              equipment, repRange:[lo,hi], incrementKg, cues:[], subs:[], painGate?:'knee'|'shoulder',
 *              unit?: 'reps'|'seconds'|'meters', video?: url }
 *
 * Session structure (v2): every lifting day runs Power → Strength → Muscle → Resilience,
 * capped at ~45–60 min. Strength phase weeks shift main lifts to lower rep ranges
 * (item.strengthRange) — simple block periodisation alternating Build ↔ Strength between deloads.
 */
window.LTA = window.LTA || {};

LTA.data = (function () {
  'use strict';

  function yt(q) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q); }

  const EX = {};
  function ex(id, name, category, equipment, repRange, incrementKg, cues, subs, extra) {
    EX[id] = Object.assign({ id, name, category, equipment, repRange, incrementKg, cues, subs: subs || [], unit: 'reps' }, extra || {});
  }

  // ---- Power (explosive intent, low reps, full recovery, never to failure) ----
  ex('box_jump', 'Box Jump', 'power', 'plyo box', [3, 3], 0,
    ['Step down, never jump down (knee-safe)', 'Land soft and quiet', 'Full intent every rep — stop when height drops'], ['broad_jump'],
    { video: yt('box jump technique landing mechanics') });
  ex('broad_jump', 'Broad Jump', 'power', 'floor', [3, 3], 0,
    ['Arms swing hard', 'Stick the landing, hips back', 'Walk back, full rest between reps'], ['box_jump'],
    { video: yt('standing broad jump technique') });
  ex('mb_chest_throw', 'Med-Ball Chest Throw', 'power', 'medicine ball + wall', [5, 5], 1,
    ['Throw as hard as possible', 'Catch, reset, repeat — no rush', 'Power first, before fatigue'], [],
    { video: yt('medicine ball chest pass power training') });

  // ---- Main strength ----
  ex('back_squat', 'Back Squat', 'strength', 'barbell + rack', [6, 10], 2.5,
    ['Brace before you descend', 'Knees track over toes', 'Drive the floor away'], ['leg_press', 'goblet_squat'],
    { video: yt('squat university how to back squat') });
  ex('goblet_squat', 'Goblet Squat', 'strength', 'dumbbell', [8, 12], 2,
    ['Elbows inside knees at bottom', 'Chest tall'], ['leg_press'], { video: yt('goblet squat form') });
  ex('rdl', 'Romanian Deadlift', 'strength', 'barbell', [8, 12], 2.5,
    ['Hips back, soft knees', 'Bar drags the thighs', 'Feel the hamstrings load'], ['db_rdl', 'leg_curl'],
    { video: yt('squat university romanian deadlift') });
  ex('db_rdl', 'DB Romanian Deadlift', 'strength', 'dumbbells', [8, 12], 2,
    ['Hips back, flat back', 'Dumbbells stay close'], ['leg_curl'], { video: yt('dumbbell rdl form') });
  ex('leg_press', 'Leg Press', 'strength', 'machine', [10, 15], 5,
    ['Full foot pressure', 'Don’t let knees cave'], ['back_squat'], { video: yt('leg press proper form') });
  ex('leg_curl', 'Seated Leg Curl', 'accessory', 'machine', [10, 15], 2.5,
    ['Control the return', 'Squeeze at full flexion'], ['db_rdl'], { video: yt('seated leg curl form') });
  ex('calf_raise', 'Standing Calf Raise', 'accessory', 'machine', [12, 15], 2.5,
    ['Pause at stretch', 'Full rise to big toe'], ['sl_calf_raise'], { video: yt('standing calf raise full range') });
  ex('trap_bar_dl', 'Trap-Bar Deadlift', 'strength', 'trap bar', [5, 8], 5,
    ['Push the floor away', 'Lats tight, chest proud', 'Stand tall, don’t lean back'], ['rdl', 'leg_press'],
    { video: yt('squat university trap bar deadlift') });
  ex('bss', 'Bulgarian Split Squat', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['Front foot far enough forward', 'Torso slightly forward', 'Drive through mid-foot'], ['atg_split_squat', 'leg_press'],
    { video: yt('bulgarian split squat form jeff nippard') });
  ex('hip_thrust', 'Hip Thrust', 'strength', 'barbell + bench', [8, 12], 5,
    ['Chin tucked, ribs down', 'Full lockout squeeze'], ['glute_bridge'], { video: yt('hip thrust form bret contreras') });
  ex('glute_bridge', 'Glute Bridge', 'strength', 'barbell', [10, 15], 5, ['Squeeze at top'], []);
  ex('adductor_machine', 'Adductor Machine', 'accessory', 'machine', [12, 15], 2.5,
    ['Slow and controlled', 'Full comfortable range', 'Groin strength = lateral court movement'], [],
    { video: yt('hip adduction machine form') });

  ex('bench_press', 'Bench Press', 'strength', 'barbell + bench', [6, 10], 2.5,
    ['Shoulder blades pinned back', 'Feet driving', 'Bar to lower chest'], ['incline_db_press', 'machine_chest_press'],
    { video: yt('how to bench press jeff nippard') });
  ex('machine_chest_press', 'Machine Chest Press', 'strength', 'machine', [8, 12], 2.5, ['Shoulders back into pad'], []);
  ex('incline_db_press', 'Incline DB Press', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['30–45° bench', 'Elbows ~45° from torso'], ['machine_chest_press'], { video: yt('incline dumbbell press form') });
  ex('cs_row', 'Chest-Supported Row', 'strength', 'machine or bench', [8, 12], 2.5,
    ['Pull elbows to hips', 'No torso heave'], ['cable_row_1arm', 'lat_pulldown'], { video: yt('chest supported row form') });
  ex('cable_row_1arm', 'One-Arm Cable Row', 'accessory', 'cable', [10, 12], 2.5,
    ['Long stretch forward', 'Elbow to hip'], ['cs_row']);
  ex('face_pull', 'Face Pull', 'accessory', 'cable + rope', [12, 15], 1.25,
    ['Pull to eyebrows', 'Thumbs point back at the end'], ['prone_t'], { video: yt('face pull form athlean') });
  ex('db_curl', 'DB Curl', 'accessory', 'dumbbells', [10, 15], 2, ['No swing', 'Full stretch at the bottom'], [],
    { video: yt('dumbbell curl form') });
  ex('triceps_pressdown', 'Triceps Pressdown', 'accessory', 'cable', [10, 15], 2.5, ['Elbows pinned'], [],
    { video: yt('triceps pressdown form') });
  ex('lat_pulldown', 'Lat Pulldown', 'strength', 'cable', [6, 10], 2.5,
    ['Drive elbows down', 'Chest to the bar'], ['pull_up', 'cs_row'], { video: yt('lat pulldown form jeff nippard') });
  ex('pull_up', 'Pull-Up', 'strength', 'bar (+ belt)', [6, 10], 2.5,
    ['Full hang start', 'Chin over bar'], ['lat_pulldown'], { video: yt('pull up form') });
  ex('lateral_raise', 'DB Lateral Raise', 'accessory', 'dumbbells', [12, 15], 1,
    ['Lead with elbows', 'Stay smooth — no swing'], ['cable_lateral_raise'], { video: yt('lateral raise form') });
  ex('cable_lateral_raise', 'Cable Lateral Raise', 'accessory', 'cable', [12, 15], 1.25, ['Lean slightly away'], []);

  // ---- Grip (racket + everything) ----
  ex('farmer_carry', 'Farmer Carry', 'accessory', 'heavy dumbbells', [40, 40], 4,
    ['Tall posture, ribs down', 'Crush grip, no shrugging', '~40 m per set, heavy'], ['dead_hang'],
    { unit: 'meters', video: yt('farmer carry form') });
  ex('dead_hang', 'Dead Hang', 'accessory', 'pull-up bar', [20, 40], 0,
    ['Full grip, shoulders slightly packed', 'Build to 40+ s', 'Also decompresses the shoulder'], [],
    { unit: 'seconds', video: yt('dead hang benefits technique') });

  // ---- Overhead ladder (all shoulder pain-gated) ----
  ex('landmine_press', 'Half-Kneeling Landmine Press', 'strength', 'landmine/barbell corner', [8, 12], 2.5,
    ['Ribs down, glute of down-knee on', 'Press up and slightly forward', 'Pain-free arc only'], ['incline_db_press'],
    { painGate: 'shoulder', video: yt('half kneeling landmine press form') });
  ex('high_incline_db_press', 'High-Incline DB Press (~60°)', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['Elbows just in front of shoulders', 'Stop shy of a painful arc'], ['landmine_press'],
    { painGate: 'shoulder', video: yt('high incline dumbbell press') });
  ex('seated_db_press', 'Seated DB Shoulder Press', 'strength', 'dumbbells + bench', [8, 12], 2,
    ['Forearms vertical', 'Press slightly in front of the head'], ['high_incline_db_press'],
    { painGate: 'shoulder', video: yt('seated dumbbell shoulder press form') });
  ex('standing_db_ohp', 'Standing DB Overhead Press', 'strength', 'dumbbells', [8, 12], 2,
    ['Glutes and ribs braced', 'Biceps finish by the ears'], ['seated_db_press'],
    { painGate: 'shoulder', video: yt('standing dumbbell overhead press') });
  ex('barbell_ohp', 'Standing Barbell OHP', 'strength', 'barbell', [6, 10], 2.5,
    ['Squeeze glutes, ribs down', 'Head through at lockout'], ['standing_db_ohp'],
    { painGate: 'shoulder', video: yt('overhead press form jeff nippard') });
  ex('med_ball_chop', 'Med-Ball Serve Chop', 'accessory', 'medicine ball', [8, 10], 1,
    ['Mimic the serve arc', 'Whip from the hips, not the shoulder'], [],
    { painGate: 'shoulder', video: yt('medicine ball overhead slam tennis serve power') });

  // ---- Shoulder rehab / resilience ----
  ex('side_lying_er', 'Side-Lying External Rotation', 'rehab', 'light dumbbell', [12, 15], 0.5,
    ['Towel under elbow', 'Slow 3-sec lower'], [], { painGate: 'shoulder', video: yt('e3 rehab rotator cuff side lying external rotation') });
  ex('cable_er_9090', 'Cable ER at 90/90', 'rehab', 'cable', [12, 15], 1.25,
    ['Elbow stays level with shoulder', 'Rotate, don’t press'], ['side_lying_er'],
    { painGate: 'shoulder', video: yt('cable external rotation 90 90') });
  ex('prone_y', 'Prone Y Raise', 'rehab', 'incline bench, light DBs', [10, 12], 0.5,
    ['Thumbs up', 'Lift from the lower traps, not the neck'], [], { video: yt('prone y raise lower trap') });
  ex('prone_t', 'Prone T Raise', 'rehab', 'incline bench, light DBs', [10, 12], 0.5,
    ['Squeeze shoulder blades together', 'Neck long and relaxed'], ['face_pull']);
  ex('pushup_plus', 'Push-Up Plus', 'rehab', 'bodyweight', [10, 10], 0,
    ['Push the floor away at the top', 'Round the upper back slightly'], []);
  ex('serratus_wall_slide', 'Serratus Wall Slide', 'rehab', 'wall (+ band)', [10, 10], 0,
    ['Forearms slide up the wall', 'Reach at the top'], [], { video: yt('serratus wall slide') });
  ex('scap_pull_up', 'Scap Pull-Up', 'rehab', 'bar', [8, 8], 0,
    ['Arms straight', 'Pull shoulder blades down only'], []);
  ex('thoracic_ext_roller', 'Thoracic Extension on Roller', 'mobility', 'foam roller', [10, 10], 0,
    ['Support the head', 'Extend over the roller, not the low back'], [], { video: yt('thoracic extension foam roller') });

  // ---- Knee rehab / resilience (kneesovertoes-style, no special equipment) ----
  ex('atg_split_squat', 'ATG Split Squat', 'rehab', 'bodyweight → DBs', [8, 10], 2,
    ['Hamstring covers calf at the bottom', 'Knee travels far over toes — that’s the point', 'Elevate front foot if needed, regress until pain-free'], ['bss'],
    { painGate: 'knee', video: yt('kneesovertoesguy atg split squat tutorial') });
  ex('patrick_step', 'Patrick Step', 'rehab', 'low step/plate', [10, 12], 0,
    ['Heel stays down, knee drives over toes', 'Slow lower to a gentle heel tap', 'Builds the knee over the toes safely'], [],
    { painGate: 'knee', video: yt('kneesovertoesguy patrick step') });
  ex('backward_walk', 'Backward Treadmill Walk', 'rehab', 'treadmill (belt off ok) or floor', [5, 8], 0,
    ['5–8 min, add incline over weeks', 'Push the floor away with the forefoot', 'Best knee-friendly warmup there is'], [],
    { unit: 'seconds', painGate: 'knee', video: yt('kneesovertoesguy backward walking treadmill') });
  ex('band_lateral_walk', 'Banded Lateral Walk', 'rehab', 'mini band', [15, 15], 0,
    ['Stay low, feet apart', 'Don’t drag the trailing foot'], [], { painGate: 'knee' });
  ex('side_hip_abduction', 'Side-Lying Hip Abduction', 'rehab', 'bodyweight/ankle weight', [12, 15], 0,
    ['Heel leads, toes slightly down', 'Torso still'], [], { painGate: 'knee' });
  ex('tibialis_raise', 'Tibialis Raise', 'rehab', 'wall or tib bar', [15, 20], 0,
    ['Heels planted, lift toes high', 'Slow lower'], [], { painGate: 'knee', video: yt('kneesovertoesguy tibialis raise wall') });
  ex('sl_calf_raise', 'Single-Leg Calf Raise', 'rehab', 'step', [10, 12], 0,
    ['Full stretch at bottom', 'Straight up, no rolling out'], ['calf_raise'], { painGate: 'knee' });
  ex('hip_airplane', 'Hip Airplane', 'rehab', 'bodyweight', [8, 8], 0,
    ['Hinge on one leg', 'Rotate hips open then closed, slow'], [], { painGate: 'knee', video: yt('hip airplane exercise') });

  // ---- Core ----
  ex('dead_bug', 'Dead Bug', 'core', 'floor', [8, 8], 0, ['Low back glued down', 'Exhale as limbs extend'], [],
    { video: yt('dead bug exercise form') });
  ex('side_plank', 'Side Plank', 'core', 'floor', [30, 45], 0, ['Straight line head to feet', 'Hips high'], [], { unit: 'seconds' });
  ex('pallof_press', 'Pallof Press', 'core', 'cable/band', [10, 10], 1.25, ['Resist the twist', 'Slow press out'], [],
    { video: yt('pallof press form') });

  // ---- Conditioning & mobility ----
  ex('hiit_spin', 'HIIT Spin', 'conditioning', 'spin bike', [30, 30], 0,
    ['10 min build-up, then 6–8 × 40 s hard / 80 s easy', 'Hard = can say words, not sentences', '5 min easy spin-down'], ['bike_intervals'],
    { unit: 'seconds', video: yt('hiit spin bike interval workout 30 minutes') });
  ex('incline_walk', 'Incline Treadmill Walk', 'conditioning', 'treadmill', [30, 40], 0,
    ['10–12% incline, no handrails', '60–80% max HR — conversational', 'Fat-burning + aerobic base'], ['z2_bike'],
    { unit: 'seconds', painGate: 'knee' });
  ex('z2_bike', 'Zone-2 Bike', 'conditioning', 'static bike', [30, 45], 0,
    ['Conversational pace — you can talk in sentences', 'Nose-breathing is a good check'], ['incline_walk'], { unit: 'seconds' });
  ex('bike_intervals', 'Bike Intervals', 'conditioning', 'static bike', [1, 1], 0,
    ['6 × 2 min hard / 2 min easy', 'Hard = can say words, not sentences'], [], { unit: 'seconds' });
  ex('gmb_flow', 'GMB Locomotion Flow', 'mobility', 'floor space', [15, 15], 0,
    ['Bear crawl 2×10 m — slow, quiet hands', 'Monkey (lateral) 2×10 m', 'Frogger 2×10 m', 'Rock back and forth ×10, explore end ranges', 'Quality over speed — this is skill practice'], [],
    { unit: 'seconds', video: yt('GMB fitness elements bear monkey frogger locomotion') });
  ex('mobility_flow', 'Mobility Flow', 'mobility', 'mat + roller', [15, 15], 0,
    ['Couch stretch 2×45s/side', '90/90 hip switches ×10', 'Thoracic rotations ×8/side', 'Cross-body shoulder 2×30s'], [], { unit: 'seconds' });

  // ---- Prescriptions helper ----
  // main:true + strengthRange → in a Strength phase, the rep target drops to strengthRange (periodisation).
  function p(exerciseId, sets, repLo, repHi, restSec, progression, notes, extra) {
    return Object.assign({ exerciseId, sets, repLo, repHi, restSec, progression: progression || 'double', notes }, extra || {});
  }

  // ---- Day templates ----
  // Every lifting day: Power → Strength → Muscle → Resilience, 45–60 min.
  // warmup: shown before the session starts; Luke's own 15-min routine always counts instead.
  const DAYS = {
    lowerA: {
      id: 'lowerA', name: 'Lower · Squat & Power', kind: 'strength', priority: 6,
      warmup: ['3 min easy bike OR 5 min backward treadmill walk', 'Leg swings ×10/side', 'Bodyweight squats ×10 + hip airplane ×5/side', 'Bar squat ×8, then +50% ×5 (ramp-up)'],
      blocks: [
        { title: 'Power', items: [p('box_jump', 3, 3, 3, 150, 'rehab', 'Explosive intent, full rest')] },
        { title: 'Strength', items: [p('back_squat', 3, 6, 10, 180, 'double', null, { main: true, strengthRange: [4, 6] })] },
        { title: 'Muscle', items: [p('leg_press', 3, 10, 15, 105), p('leg_curl', 3, 10, 15, 75), p('calf_raise', 3, 12, 15, 60)] },
        { title: 'Knee resilience', items: [p('atg_split_squat', 2, 8, 10, 60, 'rehab'), p('tibialis_raise', 3, 15, 20, 45, 'rehab'), p('backward_walk', 1, 5, 8, 0, 'timed', '5–8 min to finish')] },
      ],
    },
    upperA: {
      id: 'upperA', name: 'Upper · Chest & Biceps', kind: 'strength', priority: 5,
      warmup: ['Band pull-aparts ×15', 'Side-lying ER ×10/side (light)', 'Push-up plus ×10', 'Bar bench ×10, then +50% ×6 (ramp-up)'],
      blocks: [
        { title: 'Power', items: [p('mb_chest_throw', 3, 5, 5, 150, 'rehab', 'Max intent throws')] },
        { title: 'Strength', items: [p('bench_press', 3, 6, 10, 180, 'double', null, { main: true, strengthRange: [4, 6] })] },
        { title: 'Muscle', items: [p('cs_row', 3, 8, 12, 105), p('incline_db_press', 3, 8, 12, 105), p('face_pull', 3, 12, 15, 60), p('db_curl', 2, 10, 15, 60)] },
        { title: 'Shoulder resilience', items: [p('side_lying_er', 3, 12, 15, 45, 'rehab'), p('prone_y', 3, 10, 12, 45, 'rehab')] },
      ],
    },
    run: {
      id: 'run', name: 'Conditioning · Run + Core', kind: 'run', priority: 4,
      warmup: ['Brisk 3 min walk', 'Calf raises ×15 + tibialis raises ×15', 'Leg swings ×10/side', '2 × 10 m gentle skips'],
      blocks: [
        { title: 'Run stage', items: [] }, // filled from runState by the engine
        { title: 'Core', items: [p('dead_bug', 3, 8, 8, 45, 'rehab'), p('side_plank', 3, 30, 45, 45, 'timed'), p('pallof_press', 3, 10, 10, 45, 'rehab')] },
      ],
    },
    upperB: {
      id: 'upperB', name: 'Upper · Back, Shoulders, Grip & Triceps', kind: 'strength', priority: 3,
      warmup: ['Serratus wall slides ×8', 'Band ER at 90/90 ×12', 'Scap pull-ups ×8', 'Light press ×8 (ramp-up on today’s ladder exercise)'],
      blocks: [
        { title: 'Strength — overhead ladder', items: [p('landmine_press', 3, 8, 12, 150, 'double', null, { main: true, strengthRange: [5, 8] })] },
        { title: 'Strength — pull', items: [p('lat_pulldown', 3, 6, 10, 150, 'double', null, { main: true, strengthRange: [5, 8] })] },
        { title: 'Muscle', items: [p('lateral_raise', 3, 12, 15, 60), p('triceps_pressdown', 2, 10, 15, 60)] },
        { title: 'Grip', items: [p('farmer_carry', 3, 40, 40, 90, 'double', 'Heavy, ~40 m per carry'), p('dead_hang', 2, 20, 40, 60, 'timed', 'Build toward 40+ s')] },
        { title: 'Shoulder resilience', items: [p('cable_er_9090', 3, 12, 15, 45, 'rehab'), p('prone_t', 3, 10, 12, 45, 'rehab')] },
      ],
    },
    lowerB: {
      id: 'lowerB', name: 'Lower · Hinge & Speed', kind: 'strength', priority: 6,
      warmup: ['3 min easy bike', 'Elephant walks ×10 (straight-ish legs, walk hands out)', 'Glute bridges ×12', 'Light trap-bar ×5 (ramp-up)'],
      blocks: [
        { title: 'Power', items: [p('broad_jump', 3, 3, 3, 150, 'rehab', 'Stick every landing')] },
        { title: 'Strength', items: [p('trap_bar_dl', 3, 5, 8, 210, 'double', null, { main: true, strengthRange: [3, 5] })] },
        { title: 'Muscle', items: [p('bss', 3, 8, 12, 105), p('hip_thrust', 3, 8, 12, 105), p('adductor_machine', 3, 12, 15, 60)] },
        { title: 'Knee resilience', items: [p('sl_calf_raise', 3, 10, 12, 45, 'rehab'), p('patrick_step', 2, 10, 12, 45, 'rehab'), p('hip_airplane', 2, 8, 8, 45, 'rehab')] },
      ],
    },
    z2: {
      id: 'z2', name: 'Conditioning · Engine', kind: 'conditioning', priority: 2,
      warmup: ['First 3–5 min easy — that’s the warmup'],
      blocks: [
        { title: 'Pick one or both (~30 min each)', items: [p('hiit_spin', 1, 30, 30, 0, 'timed', 'Anaerobic: 6–8 × 40 s hard / 80 s easy'), p('incline_walk', 1, 30, 40, 0, 'timed', 'Aerobic/fat-burn: 60–80% max HR')] },
        { title: 'Mobility', items: [p('mobility_flow', 1, 15, 15, 0, 'timed')] },
      ],
    },
    rest: {
      id: 'rest', name: 'Recovery · GMB Flow', kind: 'rest', priority: 1,
      warmup: [],
      blocks: [
        { title: 'Body control (GMB-style)', items: [p('gmb_flow', 1, 15, 15, 0, 'timed', 'Skill practice, not a workout')] },
        { title: 'Optional', items: [p('mobility_flow', 1, 15, 15, 0, 'timed', 'Or a walk, or full rest')] },
      ],
    },
    racket: {
      id: 'racket', name: 'Racket Sport', kind: 'racket', priority: 7,
      warmup: ['5 min easy movement + shadow swings', 'Band ER ×12 before serving', 'Start serves at 50% pace'],
      blocks: [{ title: 'Play', items: [] }],
    },
    custom: {
      id: 'custom', name: 'Freestyle Session', kind: 'strength', priority: 3,
      warmup: ['Your own 15-min routine, or 3 min raise-the-heart-rate + ramp-up sets on your first lift'],
      blocks: [{ title: 'Your picks', items: [] }],
    },
  };

  // Default weekly skeleton: index 0 = Monday.
  // 4 lifts + 2 conditioning + 1 recovery. Racket sessions overlay via the reshuffler.
  const WEEK_SKELETON = ['lowerA', 'upperA', 'run', 'upperB', 'lowerB', 'z2', 'rest'];

  // ---- Return-to-run stages ----
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

  const SPRINT_STAGES = [
    { id: 0, name: 'Strides', protocol: '4 × 10 s strides @ ~75%, walk-back recovery', sessionsRequired: 4 },
    { id: 1, name: 'Hill sprints', protocol: '6 × 8 s hill sprints, walk-back recovery', sessionsRequired: 5 },
    { id: 2, name: 'Accelerations', protocol: '4–6 × 20–30 m flat accelerations, full recovery', sessionsRequired: 999 },
  ];

  const OVERHEAD_RUNGS = [
    { id: 0, exerciseId: 'landmine_press', sessionsRequired: 2 },
    { id: 1, exerciseId: 'high_incline_db_press', sessionsRequired: 2 },
    { id: 2, exerciseId: 'seated_db_press', sessionsRequired: 2 },
    { id: 3, exerciseId: 'standing_db_ohp', sessionsRequired: 2 },
    { id: 4, exerciseId: 'barbell_ohp', sessionsRequired: 999, addOn: 'med_ball_chop' },
  ];

  const MAIN_LIFTS = ['back_squat', 'bench_press', 'trap_bar_dl', 'rdl', 'lat_pulldown', 'landmine_press', 'high_incline_db_press', 'seated_db_press', 'standing_db_ohp', 'barbell_ohp'];

  return { EXERCISES: EX, DAYS, WEEK_SKELETON, RUN_STAGES, RUN_CUES, SPRINT_STAGES, OVERHEAD_RUNGS, MAIN_LIFTS };
})();
