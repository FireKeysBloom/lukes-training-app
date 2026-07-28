/* LTA.store — localStorage persistence, schema versioning, export/import.
 *
 * AppState = {
 *   schemaVersion, createdAt,
 *   settings: { units, defaultRestSec, plannedDaysPerWeek, skeleton: DayType[7] (Mon..Sun),
 *               supabaseUrl, supabaseKey },
 *   exerciseStates: { [exerciseId]: { currentWeightKg, stallCount, lastSessionSets: [{weight,reps}] } },
 *   runState: { stageId, completionsAtStage, lastRunDate, sprintUnlocked, sprintStageId, sprintSessions,
 *               pendingRegression: bool },
 *   shoulderState: { rungId, sessionsAtRung, extraRehabVolume: bool },
 *   weekCounter, currentWeek: WeekPlan, weekHistory: WeekPlan[],
 *   sessions: SessionLog[], reviews: ReviewLog[], painLog: PainFlag[],
 *   pendingCheckIns: [{date, area, context}]
 * }
 * WeekPlan = { weekStart, isDeload, kneeCaution: bool,
 *              days: [{date, dayType, status:'planned'|'done'|'skipped'|'replaced', replacedBy?}],
 *              decisions: string[] }
 */
window.LTA = window.LTA || {};

LTA.store = (function () {
  'use strict';

  const KEY = 'lta.state';
  const CURRENT_SCHEMA = 5;
  let state = null;
  let saveTimer = null;
  const listeners = [];

  function defaultState() {
    return {
      schemaVersion: CURRENT_SCHEMA,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: {
        units: 'kg',
        defaultRestSec: 90,
        plannedDaysPerWeek: 6,
        skeleton: LTA.data.WEEK_SKELETON.slice(),
        supabaseUrl: '',
        supabaseKey: '',
      },
      exerciseStates: {},
      customExercises: {},   // user-created exercises, merged into the library on load
      exerciseEdits: {},     // per-exercise patches over built-ins (name, cues, rep range, …)
      exerciseNotes: {},     // personal notes shown in the session player
      warmupNotes: {},       // personal notes shown on the pre-session warmup screen, keyed by dayType
      substitutions: {},     // { originalExerciseId: replacementId } — standing swaps applied to the program
      phase: 'build', // 'build' (hypertrophy ranges) | 'strength' (low-rep ranges on main lifts); alternates after each deload
      runState: { stageId: 0, completionsAtStage: 0, lastRunDate: null, sprintUnlocked: false, sprintStageId: 0, sprintSessions: 0, pendingRegression: false },
      shoulderState: { rungId: 0, sessionsAtRung: 0, extraRehabVolume: false },
      weekCounter: 1,
      currentWeek: null,
      weekHistory: [],
      sessions: [],
      reviews: [],
      painLog: [],
      pendingCheckIns: [],
    };
  }

  // Sequential migrations: MIGRATIONS[n] upgrades schemaVersion n -> n+1.
  const MIGRATIONS = {
    1: function (s) { s.phase = s.phase || 'build'; },
    2: function (s) { s.customExercises = {}; s.exerciseEdits = {}; s.exerciseNotes = {}; },
    3: function (s) { s.substitutions = {}; },
    4: function (s) { s.warmupNotes = {}; },
  };

  function migrate(s) {
    while (s.schemaVersion < CURRENT_SCHEMA) {
      const fn = MIGRATIONS[s.schemaVersion];
      if (!fn) { s.schemaVersion = CURRENT_SCHEMA; break; }
      fn(s);
      s.schemaVersion++;
    }
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.error('State load failed, starting fresh:', e);
      state = defaultState();
    }
    return state;
  }

  function save(immediate) {
    state.updatedAt = new Date().toISOString();
    clearTimeout(saveTimer);
    const write = () => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { console.error('State save failed:', e); }
      listeners.forEach((fn) => fn(state));
      if (LTA.sync) LTA.sync.schedulePush();
    };
    if (immediate) write(); else saveTimer = setTimeout(write, 300);
  }

  function onSave(fn) { listeners.push(fn); }

  // Credentials never travel with the data. A backup file gets shared, emailed and
  // synced to places the training log doesn't matter but a key would.
  function withoutCredentials(s) {
    const copy = JSON.parse(JSON.stringify(s));
    if (copy.settings) { delete copy.settings.supabaseUrl; delete copy.settings.supabaseKey; }
    return copy;
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(withoutCredentials(state), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'luke-training-' + LTA.util.todayStr() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text); // throws on bad JSON — caller handles
    if (typeof parsed.schemaVersion !== 'number' || !parsed.settings) {
      throw new Error('That file does not look like a training-app export.');
    }
    // This device's own credentials win — a backup should never repoint your sync.
    const keepUrl = (state && state.settings && state.settings.supabaseUrl) || '';
    const keepKey = (state && state.settings && state.settings.supabaseKey) || '';
    state = migrate(parsed);
    state.settings.supabaseUrl = keepUrl || state.settings.supabaseUrl || '';
    state.settings.supabaseKey = keepKey || state.settings.supabaseKey || '';
    save(true);
    return state;
  }

  function replaceState(newState) {
    state = migrate(newState);
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('State save failed:', e); }
    listeners.forEach((fn) => fn(state));
  }

  function reset() {
    state = defaultState();
    save(true);
    return state;
  }

  function getState() { return state; }

  function exerciseState(exId) {
    if (!state.exerciseStates[exId]) {
      // calibrating: no working weight yet — the session player runs the find-your-weight flow.
      state.exerciseStates[exId] = { currentWeightKg: 0, stallCount: 0, lastSessionSets: null, calibrating: true };
    }
    return state.exerciseStates[exId];
  }

  return { load, save, onSave, exportJSON, importJSON, replaceState, reset, getState, exerciseState, withoutCredentials, KEY };
})();

/* LTA.util — small shared helpers */
LTA.util = (function () {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  // Monday of the week containing date s.
  function mondayOf(s) { const d = parseDate(s); const shift = (d.getDay() + 6) % 7; d.setDate(d.getDate() - shift); return dateStr(d); }
  function weekdayName(s) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseDate(s).getDay()]; }
  function niceDate(s) { const d = parseDate(s); return weekdayName(s) + ' ' + d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function e1rm(weight, reps) { return reps > 0 ? weight * (1 + reps / 30) : 0; } // Epley
  function roundTo(x, step) { return step > 0 ? Math.round(x / step) * step : Math.round(x * 2) / 2; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtSec(t) { const m = Math.floor(t / 60), s = t % 60; return m + ':' + pad(s); }

  return { dateStr, todayStr, parseDate, addDays, daysBetween, mondayOf, weekdayName, niceDate, uid, e1rm, roundTo, esc, fmtSec };
})();
