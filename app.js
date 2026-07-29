/* LTA.ui — views, session player, timers, charts. Renders into #view. */
window.LTA = window.LTA || {};

LTA.ui = (function () {
  'use strict';
  const U = LTA.util;
  const D = LTA.data;
  const E = LTA.engine;

  const APP_VERSION = '2026.07.26.9';
  let swVersion = '';
  let tab = 'today';
  let session = null;          // in-progress session player state
  let rest = null;             // rest timer state
  let runTimer = null;         // run interval timer state
  let audioCtx = null;

  function S() { return LTA.store.getState(); }
  function $(id) { return document.getElementById(id); }
  const esc = U.esc;

  function unit() { return S().settings.units === 'lb' ? 'lb' : 'kg'; }

  // ---------- Load display ----------
  // Stored loads are always plain numbers (0 = no external load), so tracking, progression,
  // sync and export are untouched. "BW" is purely how 0 is rendered.
  function floorFor(ex) { return (ex && ex.barKg) || 0; }

  function fmtLoad(ex, w) {
    if (ex && ex.barKg) return String(w);            // a bar is never bodyweight
    if (!w) return 'BW';
    if (ex && ex.bodyweight) return 'BW+' + w;       // you're lifting yourself, plus this
    return String(w);
  }

  function loadWithUnit(ex, w) {
    const s = fmtLoad(ex, w);
    return s === 'BW' ? s : s + ' ' + unit();
  }

  // ---------- boot ----------

  function init() {
    LTA.store.load();
    E.applyUserExercises();
    E.ensureWeek();
    resumeDraft();
    render();
    if (LTA.sync) LTA.sync.initialSync();
    if (LTA.sync) LTA.sync.onStatus(renderSyncDot);
    registerServiceWorker();
    document.addEventListener('visibilitychange', onVisibility);
  }

  // A new deploy should land without the user knowing anything about caches: when a fresh
  // worker takes over an already-installed app, reload once so the new code is what's running.
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.version) { swVersion = e.data.version; if (tab === 'settings') render(); }
    });
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('version');
  }

  function onVisibility() {
    if (document.hidden) return;
    primeAudio();
    if (session) acquireWakeLock();
    if (rest) tickRest(true);   // clocks are timestamp-based, so just re-sync the display — silently, no catch-up ding
  }

  function resumeDraft() {
    const d = S().draftSession;
    if (d && d.date === U.todayStr()) session = d;
    else if (d) { S().draftSession = null; LTA.store.save(); }
  }

  function saveDraft() {
    S().draftSession = session;
    LTA.store.save();
  }

  // ---------- shell ----------

  function setTab(t) {
    tab = t;
    render();
  }

  function render() {
    E.ensureWeek();
    const view = $('view');
    if (!view) return;
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.view === tab));
    if (tab === 'today') renderToday(view);
    else if (tab === 'week') renderWeek(view);
    else if (tab === 'review') renderReview(view);
    else if (tab === 'progress') renderProgress(view);
    else if (tab === 'settings') renderSettings(view);
    renderSyncDot();
    maybeCheckInModal();
    if (rest) renderRestBar(); // refresh the "resting from X" label immediately on nav, not on the next tick
  }

  function renderSyncDot() {
    if (!LTA.sync) return;
    const st = LTA.sync.getStatus();
    const el = $('syncDot');
    if (el) {
      el.className = 'sync-dot ' + st.state;
      el.title = st.state + (st.detail ? ': ' + st.detail : '');
    }
    // Keep the Settings status line honest too — updating the text node rather than
    // re-rendering, so it can't wipe whatever is half-typed in the fields above it.
    const txt = $('syncStatusText');
    if (txt) txt.textContent = st.state + (st.detail ? ' — ' + st.detail : '');
  }

  function topInfo() {
    const s = S();
    const w = s.currentWeek;
    let badges = '<span class="badge">Week ' + s.weekCounter + '</span>';
    if (w && w.isDeload) badges += '<span class="badge deload">Deload</span>';
    if (w && w.kneeCaution) badges += '<span class="badge caution">Knee caution</span>';
    return badges;
  }

  // ---------- Today ----------

  function renderToday(view) {
    if (session) { renderSessionPlayer(view); return; }
    const s = S();
    const today = U.todayStr();
    const day = E.dayForDate(today);
    const daySessions = E.sessionsForDate(today);
    const due = E.reviewDue();
    let h = '<div class="pagehead"><h2>Today</h2><div>' + topInfo() + '</div></div>';
    h += '<p class="muted">' + U.niceDate(today) + '</p>';

    if (due) {
      h += '<div class="card banner" onclick="LTA.ui.setTab(\'review\')">📋 Weekly review is ready — tap to shape next week.</div>';
    }

    if (!day) {
      h += '<div class="card">No plan for today yet.</div>';
    } else {
      const tpl = D.DAYS[day.dayType];
      h += '<div class="card session-card">';
      if (day.status !== 'done') {
        h += '<div class="session-kind">' + esc(tpl.name) + '</div>';
        h += sessionSummaryHTML(day.dayType);
      }
      if (day.status === 'done') {
        h += '<button class="btn btn-ghost" onclick="LTA.ui.openChangeToday()">Additional session</button>';
      } else if (day.status === 'skipped') {
        h += '<div class="done-note muted">Skipped this week' + (day.replacedBy ? '' : ' — racket play covered it.') + '</div>';
        h += '<button class="btn btn-ghost" onclick="LTA.ui.startSession()">Do it anyway</button>';
        h += '<button class="btn btn-ghost" onclick="LTA.ui.openChangeToday()">Do something else today</button>';
      } else {
        h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.startSession()">Start session</button>';
        h += '<button class="btn btn-ghost" onclick="LTA.ui.openChangeToday()">Do something else today</button>';
      }
      h += '</div>';
      if (day.optional) h += '<p class="muted">This day is optional this week (two racket sessions already).</p>';
    }

    if (daySessions.length) {
      h += '<div class="card-title">' + daySessions.length + ' session' + (daySessions.length > 1 ? 's' : '') + ' logged today</div>';
      daySessions.forEach((sess) => { h += completedSessionCardHTML(sess); });
    }

    const w = s.currentWeek;
    if (w && w.decisions.length) {
      h += '<div class="card"><div class="card-title">This week’s adjustments</div><ul class="decisions">' +
        w.decisions.slice(-5).map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul></div>';
    }
    view.innerHTML = h;
  }

  function sessionSummaryHTML(dayType) {
    if (dayType === 'run') {
      const spec = E.runSpec();
      if (spec.mode === 'bike') return '<p>' + esc(spec.protocol) + '</p><p class="muted">' + esc(spec.cues[0]) + '</p>';
      return '<p><strong>' + esc(spec.stage.name) + ':</strong> ' + esc(spec.protocol) + '</p>' +
        '<p class="muted">Completions at this stage: ' + spec.completions + '/' + spec.required + '</p>';
    }
    if (dayType === 'racket') return '<p>Log your play session — duration, intensity, and how the shoulder handled serving.</p>';
    if (dayType === 'rest') return '<p>GMB-style locomotion flow, a walk, or full rest. Recovery is training.</p>';
    if (dayType === 'custom') return '<p>Freestyle — build your own session exercise by exercise. Everything still counts toward progression.</p>';
    const blocks = E.prescriptionsForDay(dayType);
    if (!blocks) return '';
    const items = [];
    blocks.forEach((b) => b.items.forEach((it) => items.push(it)));
    const rows = items.slice(0, 5).map((it) => {
      const e = D.EXERCISES[it.exerciseId];
      return '<div class="today-ex-row"><span class="tx-name">' + esc(e.name) + '</span>' +
        '<span class="tx-rx">' + it.sets + ' × ' + it.repLo + (it.repHi > it.repLo ? '–' + it.repHi : '') + '</span></div>';
    });
    if (items.length > 5) rows.push('<div class="today-ex-row"><span class="tx-name">+ ' + (items.length - 5) + ' more</span></div>');
    return '<div class="today-ex">' + rows.join('') + '</div>';
  }

  function completedSessionCardHTML(sess) {
    const tpl = D.DAYS[sess.dayType];
    const bits = [];
    if (sess.durationMin) bits.push(sess.durationMin + ' min');
    if (sess.sets && sess.sets.length) bits.push(sess.sets.length + ' sets');
    if (sess.feel) bits.push('felt ' + sess.feel + '/5');
    let h = '<div class="card session-card done-card">';
    h += '<div class="session-kind">' + esc(tpl ? tpl.name : sess.dayType) + '</div>';
    if (bits.length) h += '<p class="muted">' + esc(bits.join(' · ')) + '</p>';
    if (sess.notes) h += '<p>' + esc(sess.notes) + '</p>';
    h += '</div>';
    return h;
  }

  // ---------- Session player ----------

  function flattenDay(dayType) {
    const blocks = E.prescriptionsForDay(dayType) || [];
    const list = [];
    blocks.forEach((b) => b.items.forEach((it) => list.push(Object.assign({ block: b.title }, it))));
    return list;
  }

  function startSession() {
    const today = U.todayStr();
    const day = E.dayForDate(today);
    const dayType = day ? day.dayType : 'rest';
    session = {
      id: U.uid(), date: today, dayType,
      items: flattenDay(dayType), idx: 0,
      sets: [], painFlags: [], pending: {},
      startedAt: Date.now(),
      runDone: false,
    };
    primeAudio();
    acquireWakeLock();
    saveDraft();
    render();
  }

  function abandonSession() {
    if (!confirm('Discard this session? Logged sets will be lost.')) return;
    session = null;
    S().draftSession = null;
    releaseWakeLock();
    LTA.store.save();
    render();
  }

  // "Do something else today": pull another scheduled day forward, or go freestyle.
  function openChangeToday() {
    const w = S().currentWeek;
    const today = U.todayStr();
    const todayDay = w.days.find((d) => d.date === today);
    let h = '<h3>Do something else today</h3>';
    const others = w.days.filter((d) => d.date !== today && d.status === 'planned' && d.dayType !== 'rest' && d.dayType !== (todayDay && todayDay.dayType));
    if (others.length) {
      h += '<label>Pull a scheduled day forward (the days trade places)</label>';
      others.forEach((d) => {
        h += '<button class="btn btn-ghost" onclick="LTA.ui.changeToday(\'' + d.dayType + '\')">' + esc(D.DAYS[d.dayType].name) + ' <span class="muted">(' + U.weekdayName(d.date) + ')</span></button>';
      });
    }
    h += '<label>Or</label>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.changeToday(\'custom\')">🧩 Freestyle — build my own as I go</button>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.changeToday(\'racket\')">🎾 Racket session</button>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.changeToday(\'rest\')">🌙 Recovery day</button>';
    modal(h, true);
  }

  function changeToday(type) {
    const today = U.todayStr();
    closeModal();
    const decisions = LTA.engine.doDayInstead(today, type);
    if (type === 'racket') {
      session = { id: U.uid(), date: today, dayType: 'racket', items: [], sets: [], painFlags: [], pending: {}, startedAt: Date.now() };
    }
    render();
    if (decisions && decisions.length) toast(decisions.join(' '));
  }

  function renderSessionPlayer(view) {
    const dayType = session.dayType;
    const tpl = D.DAYS[dayType];
    if (!session.warmupDone && tpl.warmup && tpl.warmup.length) { renderWarmup(view, tpl); return; }
    if (dayType === 'run') { renderRunPlayer(view); return; }
    if (dayType === 'racket') { renderRacketPlayer(view); return; }
    if (dayType === 'z2' || dayType === 'rest') { renderSimplePlayer(view); return; }

    const items = session.items;
    if (!items.length) { renderEmptyFreestyle(view); return; }
    const it = items[session.idx];
    const ex = D.EXERCISES[it.exerciseId];
    const st = LTA.store.exerciseState(it.exerciseId);
    const logged = session.sets.filter((x) => x.exerciseId === it.exerciseId);
    const p = pendingFor(it, ex, st);
    const deloadW = it.deload && st.currentWeightKg ? U.roundTo(st.currentWeightKg * 0.9, ex.incrementKg || 2.5) : null;

    let h = '<div class="player">';
    h += '<div class="player-top"><button class="btn-mini" onclick="LTA.ui.abandonSession()">✕</button>' +
      '<div class="player-progress">' + (session.idx + 1) + ' / ' + items.length + '</div>' +
      '<button class="btn-mini pain" onclick="LTA.ui.openPainModal()">Pain?</button></div>';

    // Workout progress: one segment per exercise across the whole session.
    h += '<div class="setseg">' + items.map((item, i) => {
      const itemLogged = session.sets.filter((x) => x.exerciseId === item.exerciseId).length;
      const cls = i === session.idx ? 'now' : (itemLogged >= item.sets || i < session.idx ? 'done' : '');
      return '<span class="' + cls + '"></span>';
    }).join('') + '</div>';
    h += '<div class="ex-block muted">' + esc(it.block) + '</div>';
    h += '<h2 class="ex-name">' + esc(ex.name) + '</h2>';
    const calibrating = isCalibrating(it, ex, st);
    const cmode = calibrating ? calibMode(it, ex) : null;
    const tLo = cmode === 'heavy' ? CALIB_WINDOW[0] : it.repLo;
    const tHi = cmode === 'heavy' ? CALIB_WINDOW[1] : it.repHi;
    h += '<div class="ex-target">' + it.sets + ' × ' + tLo + (tHi > tLo ? '–' + tHi : '') + repUnit(ex) +
      (ex.sides ? ' per side' : '') +
      (!calibrating && st.currentWeightKg ? ' @ ' + loadWithUnit(ex, deloadW || st.currentWeightKg) : '') +
      (it.deload ? ' <span class="badge deload">deload</span>' : '') + '</div>';
    if (ex.sides) h += '<div class="sides-note">' + (ex.sides === 'alternate'
      ? '↔ <strong>Alternate sides</strong> within the set — the count above is per side.'
      : '↔ <strong>One side, then the other</strong> — both sides make one set, then rest.') + '</div>';
    const tempo = tempoFor(it, ex);
    if (tempo) h += '<div class="tempo"><strong>⏱ Tempo ' + esc(tempo) + '</strong><span>' + esc(tempoGloss(tempo)) + '</span></div>';
    if (it.swappedFrom && D.EXERCISES[it.swappedFrom]) h += '<p class="muted">Standing swap — replaced ' + esc(D.EXERCISES[it.swappedFrom].name) + '.</p>';
    if (it.notes) h += '<p class="muted">' + esc(it.notes) + '</p>';
    if (it.phaseNote) h += '<p class="muted">🏋️ ' + esc(it.phaseNote) + ' — heavier, lower reps this block.</p>';
    h += '<ul class="cues">' + ex.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    if (ex.video) h += '<a class="video-link" href="' + esc(ex.video) + '" target="_blank" rel="noopener">▶ Watch a form breakdown</a>';
    if (st.lastSessionSets && st.lastSessionSets.length) {
      h += '<div class="prev-line"><span class="lb">Previous</span>' +
        st.lastSessionSets.map((x) => loadWithUnit(ex, x.weight) + ' × ' + x.reps).join(' · ') + '</div>';
    }
    const myNote = S().exerciseNotes[it.exerciseId];
    if (myNote) h += '<div class="my-note">📝 ' + esc(myNote) + '</div>';
    h += '<button class="btn-link note-link" onclick="LTA.ui.openNoteModal(\'' + it.exerciseId + '\')">' + (myNote ? '✎ Edit my note' : '✎ Note to self') + '</button>';

    if (logged.length) {
      h += '<div class="logged">' + logged.map((x, i) =>
        '<button class="set-chip" title="Tap to delete this set" onclick="LTA.ui.deleteSet(\'' + it.exerciseId + '\',' + i + ')">S' + (i + 1) + ': ' + fmtLoad(ex, x.weight) + '×' + x.reps + ' <span class="chip-x">×</span></button>').join('') +
        '</div><div class="muted chip-hint">Tap a set to delete it.</div>';
    }

    if (calibrating) h += '<div class="calib-card">' + calibBanner(cmode, ex, logged.length) + '</div>';
    if (ex.category === 'conditioning' || ex.category === 'mobility') {
      h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.logTimedItem(' + session.idx + ')">Mark done</button>';
    } else {
      h += '<div class="set-entry">';
      h += stepperHTML('weight', p.weight, ex.incrementKg || 2.5, unit(), fmtLoad(ex, p.weight));
      h += stepperHTML('reps', p.reps, ex.unit === 'seconds' ? 5 : ex.unit === 'meters' ? 10 : ex.unit === 'minutes' ? 5 : 1, repUnit(ex).trim());
      h += '</div>';
      h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.logSet()">Log set ' + (logged.length + 1) + '</button>';
    }

    h += '<div class="player-nav">' +
      '<button class="btn btn-ghost" ' + (session.idx === 0 ? 'disabled' : '') + ' onclick="LTA.ui.moveEx(-1)">‹ Prev</button>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.openSubModal()">Swap</button>' +
      (session.idx < items.length - 1
        ? '<button class="btn btn-ghost" onclick="LTA.ui.moveEx(1)">Next ›</button>'
        : '<button class="btn btn-primary" onclick="LTA.ui.openFinishModal()">Finish</button>') +
      '</div>';
    h += '<button class="btn-link" onclick="LTA.ui.openAddExercise()">＋ Add an exercise to this session</button>';
    if (session.idx < items.length - 1) h += '<button class="btn-link" onclick="LTA.ui.openFinishModal()">Finish session early</button>';
    h += '</div>';
    view.innerHTML = h;
  }

  function repUnit(ex) { return ex.unit === 'seconds' ? ' s' : ex.unit === 'meters' ? ' m' : ex.unit === 'minutes' ? ' min' : ' reps'; }

  function renderWarmup(view, tpl) {
    let h = '<div class="player">';
    h += '<div class="player-top"><button class="btn-mini" onclick="LTA.ui.abandonSession()">✕</button>' +
      '<div class="player-progress">Warmup</div><span></span></div>';
    h += '<h2 class="ex-name">Warm up first</h2>';
    h += '<p class="muted">Tailored for ' + esc(tpl.name) + ' — or run your own 15-min routine, both count.</p>';
    h += '<ul class="cues">' + tpl.warmup.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    const myNote = S().warmupNotes[tpl.id];
    if (myNote) h += '<div class="my-note">📝 ' + esc(myNote) + '</div>';
    h += '<button class="btn-link note-link" onclick="LTA.ui.openWarmupNoteModal(\'' + tpl.id + '\')">' + (myNote ? '✎ Edit my note' : '✎ Note to self') + '</button>';
    h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.warmupDone()">Warmed up — start session</button>';
    h += '</div>';
    view.innerHTML = h;
  }

  function openWarmupNoteModal(dayType) {
    const note = S().warmupNotes[dayType] || '';
    const h = '<h3>Warmup note — ' + esc(D.DAYS[dayType].name) + '</h3>' +
      '<textarea id="warmupNoteText" rows="4" placeholder="Anything you want reminding of before this one — an extra drill, how long to spend on it…">' + esc(note) + '</textarea>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.saveWarmupNote(\'' + dayType + '\')">Save note</button>';
    modal(h, true);
  }

  function saveWarmupNote(dayType) {
    const s = S();
    const v = $('warmupNoteText').value.trim();
    if (v) s.warmupNotes[dayType] = v; else delete s.warmupNotes[dayType];
    LTA.store.save(true);
    closeModal();
    render();
  }

  function warmupDone() {
    session.warmupDone = true;
    primeAudio();
    acquireWakeLock();
    saveDraft();
    render();
  }

  function renderEmptyFreestyle(view) {
    let h = '<div class="player">';
    h += '<div class="player-top"><button class="btn-mini" onclick="LTA.ui.abandonSession()">✕</button>' +
      '<div class="player-progress">Freestyle</div>' +
      '<button class="btn-mini pain" onclick="LTA.ui.openPainModal()">Pain?</button></div>';
    h += '<h2 class="ex-name">Build it as you go</h2>';
    h += '<p class="muted">Pick your first exercise. Every lift you log still counts toward progression, and pain flags still protect the knee and shoulder.</p>';
    h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.openAddExercise()">＋ Add first exercise</button>';
    h += '</div>';
    view.innerHTML = h;
  }

  let listHandler = 'addExercise'; // which LTA.ui fn an exercise tap in the picker calls

  function openAddExercise() {
    listHandler = 'addExercise';
    let h = '<h3>Add exercise</h3>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.openExerciseForm(null, \'session\')">＋ Create a new exercise</button>' +
      '<input class="input" id="exSearch" placeholder="Search…" oninput="LTA.ui.filterExercises(this.value)">' +
      '<div id="exList" class="ex-list">' + exerciseListHTML('') + '</div>';
    modal(h, true);
  }

  function exerciseListHTML(q) {
    q = (q || '').toLowerCase();
    const custom = S().customExercises || {};
    const groups = { power: [], strength: [], accessory: [], rehab: [], core: [], conditioning: [], mobility: [] };
    Object.values(D.EXERCISES).forEach((e) => {
      if (q && e.name.toLowerCase().indexOf(q) === -1) return;
      (groups[e.category] = groups[e.category] || []).push(e);
    });
    let h = '';
    Object.keys(groups).forEach((cat) => {
      if (!groups[cat].length) return;
      h += '<div class="ex-cat">' + esc(cat) + '</div>';
      groups[cat].forEach((e) => {
        h += '<button class="btn btn-ghost ex-pick" onclick="LTA.ui.' + listHandler + '(\'' + e.id + '\')">' + esc(e.name) + (custom[e.id] ? ' <span class="badge">yours</span>' : '') + '</button>';
      });
    });
    return h || '<p class="muted">Nothing matches.</p>';
  }

  function filterExercises(q) {
    const el = $('exList');
    if (el) el.innerHTML = exerciseListHTML(q);
  }

  // ---------- Exercise create / edit ----------

  function openExerciseLibrary() {
    listHandler = 'openExerciseFormFor';
    let h = '<h3>Exercise library</h3>' +
      '<p class="muted">Tap any exercise to edit it — changes stick. Your own exercises can be deleted.</p>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.openExerciseForm(null, \'settings\')">＋ Create a new exercise</button>' +
      '<input class="input" id="exSearch" placeholder="Search…" oninput="LTA.ui.filterExercises(this.value)">' +
      '<div id="exList" class="ex-list">' + exerciseListHTML('') + '</div>';
    modal(h, true);
  }

  function openExerciseFormFor(exId) { openExerciseForm(exId, 'settings'); }

  function openExerciseForm(editId, context) {
    const ex = editId ? D.EXERCISES[editId] : null;
    const isCustom = editId && !!(S().customExercises || {})[editId];
    const note = editId ? (S().exerciseNotes[editId] || '') : '';
    const cats = ['strength', 'accessory', 'power', 'rehab', 'core', 'conditioning', 'mobility'];
    const units = ['reps', 'seconds', 'meters', 'minutes'];
    const gates = ['none', 'knee', 'shoulder'];
    let h = '<h3>' + (editId ? 'Edit ' + esc(ex.name) : 'New exercise') + '</h3>' +
      '<label>Name</label><input class="input" id="f-name" value="' + esc(ex ? ex.name : '') + '">' +
      '<label>Equipment</label><input class="input" id="f-equip" value="' + esc(ex ? ex.equipment : '') + '">' +
      '<label>Category</label><select class="input" id="f-cat" onchange="LTA.ui.syncTempoDefault()">' + cats.map((c) => '<option' + (ex && ex.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
      '<label>Tempo (down-pause-up, X = fast) — auto-filled from the category, edit freely</label>' +
      '<input class="input" id="f-tempo" placeholder="3-0-2" value="' + esc(ex ? (ex.tempo !== undefined ? ex.tempo : D.defaultTempo(ex.category, D.MAIN_LIFTS.indexOf(ex.id) >= 0)) : D.defaultTempo('strength', false)) + '">' +
      '<label>Sides</label><select class="input" id="f-sides">' +
      [['', 'Both together / not applicable'], ['each', 'One side then the other'], ['alternate', 'Alternate sides within the set']]
        .map((o) => '<option value="' + o[0] + '"' + (ex && (ex.sides || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '<div class="set-entry"><div style="flex:1"><label>Rep range low</label><input class="input" id="f-repLo" type="number" value="' + (ex ? ex.repRange[0] : 8) + '"></div>' +
      '<div style="flex:1"><label>Rep range high</label><input class="input" id="f-repHi" type="number" value="' + (ex ? ex.repRange[1] : 12) + '"></div></div>' +
      '<div class="set-entry"><div style="flex:1"><label>Weight step (kg)</label><input class="input" id="f-inc" type="number" step="0.25" value="' + (ex ? ex.incrementKg : 2.5) + '"></div>' +
      '<div style="flex:1"><label>Counted in</label><select class="input" id="f-unit">' + units.map((u) => '<option' + (ex && ex.unit === u ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div></div>' +
      '<label>Pain-gate (autoregulation watches this area)</label><select class="input" id="f-gate">' + gates.map((g) => '<option' + (ex && ex.painGate === g ? ' selected' : '') + '>' + g + '</option>').join('') + '</select>' +
      '<label>Form cues — one per line</label><textarea id="f-cues" rows="3">' + esc(ex ? ex.cues.join('\n') : '') + '</textarea>' +
      '<label>Video link (optional)</label><input class="input" id="f-video" value="' + esc(ex && ex.video ? ex.video : '') + '">' +
      '<label>My note (tips / reminders, shown in the session)</label><textarea id="f-note" rows="2">' + esc(note) + '</textarea>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.saveExerciseForm(' + (editId ? '\'' + editId + '\'' : 'null') + ', \'' + context + '\')">Save</button>';
    if (isCustom) h += '<button class="btn btn-ghost" onclick="LTA.ui.deleteCustomExercise(\'' + editId + '\')">Delete this exercise</button>';
    modal(h, true);
  }

  function saveExerciseForm(editId, context) {
    const s = S();
    const name = $('f-name').value.trim();
    if (!name) { alert('Give it a name.'); return; }
    const gate = $('f-gate').value;
    const patch = {
      name,
      equipment: $('f-equip').value.trim(),
      category: $('f-cat').value,
      repRange: [Math.max(1, Number($('f-repLo').value) || 8), Math.max(1, Number($('f-repHi').value) || 12)],
      incrementKg: Number($('f-inc').value) || 0,
      unit: $('f-unit').value,
      cues: $('f-cues').value.split('\n').map((x) => x.trim()).filter(Boolean),
      video: $('f-video').value.trim() || undefined,
      painGate: gate === 'none' ? undefined : gate,
      tempo: $('f-tempo').value.trim(),
      sides: $('f-sides').value || undefined,
    };
    let id = editId;
    if (!id) {
      id = 'cx_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      while (D.EXERCISES[id]) id += '2';
      s.customExercises[id] = patch;
    } else if (s.customExercises[id]) {
      s.customExercises[id] = Object.assign(s.customExercises[id], patch);
    } else {
      s.exerciseEdits[id] = Object.assign(s.exerciseEdits[id] || {}, patch);
    }
    const note = $('f-note').value.trim();
    if (note) s.exerciseNotes[id] = note; else delete s.exerciseNotes[id];
    E.applyUserExercises();
    LTA.store.save(true);
    closeModal();
    if (!editId && context === 'session' && session) { addExercise(id); return; }
    if (!editId && context === 'swap' && session) { chooseSwap(id); return; }
    render();
    toast(editId ? 'Saved — ' + name + ' updated.' : name + ' added to your library.');
  }

  function syncTempoDefault() {
    const cat = $('f-cat'), tempo = $('f-tempo');
    if (cat && tempo) tempo.value = D.defaultTempo(cat.value, false);
  }

  function deleteCustomExercise(id) {
    if (!confirm('Delete this exercise from your library? Past logs keep their history.')) return;
    const s = S();
    delete s.customExercises[id];
    delete s.exerciseNotes[id];
    delete D.EXERCISES[id];
    LTA.store.save(true);
    closeModal();
    render();
  }

  function openNoteModal(exId) {
    const note = S().exerciseNotes[exId] || '';
    const h = '<h3>Note — ' + esc(D.EXERCISES[exId].name) + '</h3>' +
      '<textarea id="noteText" rows="4" placeholder="Tips, setup reminders, what worked…">' + esc(note) + '</textarea>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.saveNote(\'' + exId + '\')">Save note</button>';
    modal(h, true);
  }

  function saveNote(exId) {
    const s = S();
    const v = $('noteText').value.trim();
    if (v) s.exerciseNotes[exId] = v; else delete s.exerciseNotes[exId];
    LTA.store.save(true);
    closeModal();
    render();
  }

  function addExercise(exId) {
    const ex = D.EXERCISES[exId];
    const isTimed = ex.category === 'conditioning' || ex.category === 'mobility';
    session.items.push({
      exerciseId: exId, block: 'Your picks',
      sets: isTimed ? 1 : 3, repLo: ex.repRange[0], repHi: ex.repRange[1],
      restSec: S().settings.defaultRestSec, progression: ex.incrementKg ? 'double' : 'rehab',
    });
    session.idx = session.items.length - 1;
    saveDraft();
    closeModal();
    render();
  }

  function pendingFor(it, ex, st) {
    if (!session.pending[it.exerciseId]) {
      const last = st.lastSessionSets;
      const w = it.deload && st.currentWeightKg ? U.roundTo(st.currentWeightKg * 0.9, ex.incrementKg || 2.5) : (st.currentWeightKg || (last ? last[0].weight : 0));
      session.pending[it.exerciseId] = {
        weight: Math.max(floorFor(ex), w),
        reps: last ? last[0].reps : it.repLo,
      };
    }
    return session.pending[it.exerciseId];
  }

  function stepperHTML(field, value, step, label, display) {
    return '<div class="stepper"><div class="stepper-label">' + esc(label) + '</div>' +
      '<button class="step-btn" onclick="LTA.ui.step(\'' + field + '\',' + (-step) + ')">−</button>' +
      '<div class="step-val' + valSizeClass(String(display === undefined ? value : display)) + '" id="step-' + field + '" onclick="LTA.ui.editStep(\'' + field + '\')" title="Tap to type a number">' + esc(display === undefined ? value : display) + '</div>' +
      '<button class="step-btn" onclick="LTA.ui.step(\'' + field + '\',' + step + ')">+</button></div>';
  }

  // "BW+22.5" needs to shrink to stay inside its cell; "85" should stay big and glanceable.
  function valSizeClass(s) { return s.length > 6 ? ' step-val-xs' : s.length > 4 ? ' step-val-sm' : ''; }

  // Tap the number to type it in directly, rather than stepping 20 times.
  function editStep(field) {
    const el = $('step-' + field);
    if (!el || el.querySelector('input')) return;
    const it = session.items[session.idx];
    const p = session.pending[it.exerciseId];
    el.innerHTML = '<input class="step-input" id="stepin-' + field + '" type="number" inputmode="decimal" step="any" value="' + p[field] + '">';
    const inp = $('stepin-' + field);
    inp.focus();
    inp.select();
    inp.addEventListener('blur', () => commitStep(field));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  }

  function commitStep(field) {
    const inp = $('stepin-' + field);
    if (!inp) return;
    const it = session.items[session.idx];
    const ex = it && D.EXERCISES[it.exerciseId];
    const p = session.pending[it.exerciseId];
    let v = parseFloat(inp.value);
    if (isNaN(v)) v = p[field];
    const floor = field === 'weight' ? floorFor(ex) : 0;
    p[field] = Math.max(floor, Math.round(v * 100) / 100);
    const el = $('step-' + field);
    if (el) {
      const txt = field === 'weight' ? fmtLoad(ex, p[field]) : String(p[field]);
      el.textContent = txt;
      el.className = 'step-val' + valSizeClass(txt);
    }
  }

  function deleteSet(exId, nth) {
    const idxs = [];
    session.sets.forEach((x, i) => { if (x.exerciseId === exId) idxs.push(i); });
    const target = idxs[nth];
    if (target === undefined) return;
    const s = session.sets[target];
    if (!confirm('Delete set ' + (nth + 1) + ' (' + fmtLoad(D.EXERCISES[exId], s.weight) + ' × ' + s.reps + ')?')) return;
    session.sets.splice(target, 1);
    const st = LTA.store.exerciseState(exId);
    if (st.calibrating && st.calibGoodSets) st.calibGoodSets = Math.max(0, st.calibGoodSets - 1);
    saveDraft();
    render();
  }

  // ---------- Tempo ----------
  function tempoFor(it, ex) {
    if (ex.tempo !== undefined) return ex.tempo;   // explicit, including a user's own edit
    if (ex.unit === 'seconds' || ex.unit === 'meters' || ex.unit === 'minutes') return 'hold';
    return D.defaultTempo(ex.category, !!it.main || D.MAIN_LIFTS.indexOf(ex.id) >= 0);
  }

  function tempoGloss(t) {
    if (t === 'hold') return 'Hold steady — breathe, don’t brace to failure';
    if (t === 'X-0-X') return 'Max intent every rep · reset fully between reps';
    const parts = String(t).split('-');
    if (parts.length !== 3) return '';
    const out = [parts[0] === 'X' ? 'fast down' : parts[0] + ' beats down'];
    if (parts[1] !== '0') out.push(parts[1] + ' beat pause');
    out.push(parts[2] === 'X' ? 'drive up fast' : parts[2] + ' beats up');
    return out.join(' · ');
  }

  function step(field, delta) {
    const it = session.items[session.idx];
    const ex = it && D.EXERCISES[it.exerciseId];
    const p = session.pending[it.exerciseId];
    const floor = field === 'weight' ? floorFor(ex) : 0;
    p[field] = Math.max(floor, Math.round((p[field] + delta) * 100) / 100);
    $('step-' + field).textContent = field === 'weight' ? fmtLoad(ex, p[field]) : p[field];
  }

  function isCalibrating(it, ex, st) {
    if (!st.calibrating || it.progression !== 'double' || !(ex.incrementKg > 0)) return false;
    if (ex.bodyweight) return false; // starts at BW by definition; load gets added by progression
    return ex.category === 'strength' || ex.category === 'accessory' || ex.category === 'power';
  }

  function logSet() {
    const it = session.items[session.idx];
    const p = session.pending[it.exerciseId];
    session.sets.push({ exerciseId: it.exerciseId, weight: p.weight, reps: p.reps });
    saveDraft();
    const ex = D.EXERCISES[it.exerciseId];
    const st = LTA.store.exerciseState(it.exerciseId);
    if (isCalibrating(it, ex, st)) { openCalibFlow(it, ex); render(); return; } // rest starts after the answer
    maybeStartRest(it, ex);
    render();
  }

  function maybeStartRest(it, ex) {
    // Heavy/technical work auto-regulates: count UP until breathing settles, prescribed rest is the guide.
    const autoreg = S().settings.autoRest !== false && (it.main || (ex && ex.category === 'power'));
    const logged = session.sets.filter((x) => x.exerciseId === it.exerciseId).length;
    const st = LTA.store.exerciseState(it.exerciseId);
    // Hitting the prescribed set count doesn't mean "done" while still finding the
    // weight — a heavy lift can need more attempts than the nominal set count before
    // it locks in. Don't let the exercise get treated as finished (and auto-advanced
    // away from) until calibration is actually settled.
    const doneWithExercise = logged >= it.sets && !st.calibrating;
    const lastSetOfLastEx = session.idx === session.items.length - 1 && doneWithExercise;
    if (doneWithExercise && session.idx < session.items.length - 1) {
      // Resolve the target now, at the idx you're on when the set finishes — not
      // whatever idx you happen to be viewing when the rest clock runs out, since
      // you're free to look ahead and come back while it counts.
      startRest(it.restSec, Math.min(session.items.length - 1, session.idx + 1), autoreg, ex.name);
    } else if (!lastSetOfLastEx && it.restSec) {
      startRest(it.restSec, null, autoreg, ex.name);
    }
  }

  // ---------- First-time weight calibration ----------
  // How you find a working weight depends on what you're training:
  //   heavy     — main barbell compounds. Never hunt for the number at 3–5 reps: calibrate in an
  //               8–10 window even during a Strength block, then DERIVE the heavy working weight.
  //               Needs two qualifying sets, so it settles over ~2 sessions, biased light.
  //   power     — output, not effort. Right load = heaviest one that stays fast.
  //   endurance — carries/hangs. "Could you have kept going?", grip vs posture.
  //   standard  — machines and isolation; RIR at mid reps, converges in one session.
  // Anything pain-gated asks about pain FIRST and locks further from failure (3–4 RIR).

  const CALIB_WINDOW = [8, 10];
  // reps-to-failure → approximate % of 1RM
  const RTF_PCT = { 1: 1.00, 2: 0.95, 3: 0.93, 4: 0.90, 5: 0.87, 6: 0.85, 7: 0.83, 8: 0.80, 9: 0.77, 10: 0.75, 11: 0.73, 12: 0.70 };
  function pctFor(rtf) { return RTF_PCT[Math.max(1, Math.min(12, Math.round(rtf)))]; }

  function calibMode(it, ex) {
    if (ex.category === 'power') return 'power';
    if (ex.unit === 'meters' || ex.unit === 'seconds' || ex.unit === 'minutes') return 'endurance';
    if (it.main && ex.category === 'strength') return 'heavy';
    return 'standard';
  }

  function calibBanner(mode, ex, setsDone) {
    const lead = '🎯 <strong>Finding your weight.</strong> ';
    if (setsDone === 0) {
      if (mode === 'power') return lead + 'Start light — this is about speed, not strain. I’ll ask whether every rep stayed explosive.';
      if (mode === 'endurance') return lead + 'Start with something you could carry comfortably. I’ll ask whether grip or posture gave out first.';
      if (mode === 'heavy') return lead + 'We’ll find this at <strong>8–10 reps</strong> — safer and more accurate than testing near your limit — then work out your heavy weight from it. Start light.';
      return lead + 'Set 1: go light — a weight you’re confident you could lift ~15 times.';
    }
    if (mode === 'heavy') return lead + 'Still in the 8–10 window. Two solid sets and I’ll lock it in and calculate your working weight.';
    return lead + 'Adjusting from your answer — keep going until it feels right.';
  }

  function openCalibFlow(it, ex) {
    if (ex.painGate) openCalibPain(it, ex);
    else openCalibEffort(it, ex);
  }

  function openCalibPain(it, ex) {
    const area = ex.painGate === 'knee' ? 'knee' : 'shoulder';
    const h = '<h3>' + area.charAt(0).toUpperCase() + area.slice(1) + ' first</h3>' +
      '<p class="muted">On this exercise pain sets the weight, not effort. Any discomfort on that set?</p>' +
      painSliderHTML('calibPain', 0) +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.calibPainAnswer()">Next</button>';
    modal(h, false);
  }

  function calibPainAnswer() {
    const sev = Number(($('slider-calibPain') || {}).value || 0);
    const it = session.items[session.idx];
    const ex = D.EXERCISES[it.exerciseId];
    closeModal();
    if (sev > 0) session.painFlags.push({ area: ex.painGate, severity: sev, when: 'during', date: session.date, context: 'calibration' });
    if (sev >= 3) {
      const st = LTA.store.exerciseState(it.exerciseId);
      const last = session.sets.filter((x) => x.exerciseId === it.exerciseId).slice(-1)[0];
      const inc = ex.incrementKg || 2.5;
      const backed = Math.max(floorFor(ex), U.roundTo(last.weight * 0.9, inc));
      st.calibrating = false; st.justCalibrated = true; st.calibGoodSets = 0;
      st.currentWeightKg = backed;
      LTA.store.save(true);
      toast('Pain ' + sev + '/10 — ending the ramp here. Working weight set at ' + loadWithUnit(ex, backed) + ', and the rehab work stays light.');
      maybeStartRest(it, ex);
      render();
      return;
    }
    openCalibEffort(it, ex);
  }

  function cbtn(band, label, primary) {
    return '<button class="btn ' + (primary ? 'btn-primary' : 'btn-ghost') + ' btn-big" onclick="LTA.ui.calibAnswer(\'' + band + '\')">' + label + '</button>';
  }

  function openCalibEffort(it, ex) {
    const mode = calibMode(it, ex);
    let h;
    if (mode === 'power') {
      h = '<h3>Was the last rep as explosive as the first?</h3>' +
        '<p class="muted">Power is set by output, not effort — the right load is the heaviest one that stays fast.</p>' +
        cbtn('up', 'Yes — every rep crisp', false) +
        cbtn('hold', 'Slight drop-off', true) +
        cbtn('down', 'No — clearly slower', false);
    } else if (mode === 'endurance') {
      h = '<h3>Could you have kept going?</h3>' +
        '<p class="muted">Grip giving out is the point. Posture breaking down means it’s too heavy.</p>' +
        cbtn('7+', 'Easily — lots left', false) +
        cbtn('4-6', 'A bit more in me', false) +
        cbtn('2-3', 'That was about right', true) +
        cbtn('0-1', 'Posture broke down early', false);
    } else if (ex.painGate) {
      h = '<h3>How much was left in the tank?</h3>' +
        '<p class="muted">For this one we stop further from failure — 3–4 in reserve is the target.</p>' +
        cbtn('7+', '7+ — way too light', false) +
        cbtn('4-6', '5–6 — still easy', false) +
        cbtn('3-4', '3–4 — right for this', true) +
        cbtn('0-1', '0–2 — too close to failure', false);
    } else {
      h = '<h3>How much was left in the tank?</h3>' +
        '<p class="muted">If you’d pushed to the limit, how many more reps could you have done?' +
        (mode === 'heavy' ? ' Aim to answer this on a set of 8–10.' : '') + '</p>' +
        cbtn('7+', '7+ — way too light', false) +
        cbtn('4-6', '4–6 — still easy', false) +
        cbtn('2-3', '2–3 — felt right', true) +
        cbtn('0-1', '0–1 — too heavy', false);
    }
    modal(h, false);
  }

  function calibAnswer(band) {
    closeModal();
    const it = session.items[session.idx];
    const ex = D.EXERCISES[it.exerciseId];
    const st = LTA.store.exerciseState(it.exerciseId);
    const p = session.pending[it.exerciseId];
    const last = session.sets.filter((x) => x.exerciseId === it.exerciseId).slice(-1)[0];
    const w = last.weight;
    const inc = ex.incrementKg || 2.5;
    const floor = floorFor(ex);
    const mode = calibMode(it, ex);

    const lockBand = mode === 'power' ? 'hold' : (ex.painGate ? '3-4' : '2-3');
    const minReps = (mode === 'power' || mode === 'endurance') ? 0 : (mode === 'heavy' ? CALIB_WINDOW[0] : it.repLo);
    const needGood = mode === 'heavy' ? 2 : 1; // heavy lifts confirm across two sets (often two sessions)

    if (band === lockBand && last.reps >= minReps) {
      st.calibGoodSets = (st.calibGoodSets || 0) + 1;
      if (st.calibGoodSets >= needGood) {
        let working = w;
        if (mode === 'heavy') working = deriveWorkingWeight(w, last.reps, ex.painGate ? 3.5 : 2.5, it, inc);
        working = Math.max(floor, working);
        st.calibrating = false; st.justCalibrated = true; st.calibGoodSets = 0;
        st.currentWeightKg = working;
        LTA.store.save(true);
        toast(mode === 'heavy'
          ? '🎯 ' + ex.name + ' set at ' + loadWithUnit(ex, working) + ' for ' + it.repLo + '–' + it.repHi + ' — worked out from that 8–10 set, deliberately a touch light. Progression takes it from here.'
          : '🎯 Working weight locked in: ' + loadWithUnit(ex, working) + ' for ' + ex.name + '. Progression takes it from here.');
      } else {
        LTA.store.save(true);
        toast('Good set. One more like that at ' + loadWithUnit(ex, w) + ' and I’ll lock it in.');
      }
      maybeStartRest(it, ex);
      render();
      return;
    }

    st.calibGoodSets = 0;
    let next = w;
    const bump = (f) => Math.max(floor, U.roundTo(w * f, inc));
    if (mode === 'power') {
      next = band === 'up' ? bump(1.10) : band === 'down' ? bump(0.90) : w;
    } else if (band === '7+') next = w <= floor ? Math.max(floor + inc * 3, bump(1.15)) : bump(1.15);
    else if (band === '4-6') next = w <= floor ? Math.max(floor + inc * 2, bump(1.08)) : bump(1.08);
    else if (band === '0-1') next = bump(0.90);
    else next = w; // right effort, reps short of the window — stay and build reps

    if (next === w && band !== lockBand && band !== 'hold') {
      next = (band === '0-1' || band === 'down') ? Math.max(floor, w - inc) : w + inc;
    }
    p.weight = next;
    LTA.store.save(true);
    if (next === w) toast('Effort is right — stay at ' + loadWithUnit(ex, w) + ' and build reps toward ' + (mode === 'heavy' ? CALIB_WINDOW[0] : it.repLo) + '.');
    else if (next < w) toast('Drop to ' + loadWithUnit(ex, next) + ' next set.');
    else toast('Try ' + loadWithUnit(ex, next) + ' next set.');
    maybeStartRest(it, ex);
    render();
  }

  // From a calibration set, estimate 1RM, then take the % that matches the block's target reps.
  // Shaved 5% so the first working weight lands slightly light rather than slightly heavy.
  function deriveWorkingWeight(w, reps, rir, it, inc) {
    const e1 = w / pctFor(reps + rir);
    return U.roundTo(e1 * pctFor(it.repLo + 2.5) * 0.95, inc);
  }

  function logTimedItem(idx) {
    const it = session.items[idx];
    session.sets.push({ exerciseId: it.exerciseId, weight: 0, reps: it.repLo });
    if (session.idx < session.items.length - 1) session.idx++;
    saveDraft();
    render();
  }

  function moveEx(delta) {
    // Deliberately doesn't touch the rest timer — looking ahead at what's coming
    // (or back at what you just did) shouldn't reset a clock that's mid-count.
    session.idx = Math.max(0, Math.min(session.items.length - 1, session.idx + delta));
    render();
  }

  // ---------- Exercise substitution ----------
  let pendingSwap = null;

  function openSubModal() {
    const it = session.items[session.idx];
    const ex = D.EXERCISES[it.exerciseId];
    const subs = ex.subs.filter((id) => D.EXERCISES[id]);
    listHandler = 'chooseSwap';
    let h = '<h3>Swap ' + esc(ex.name) + '</h3>';
    if (subs.length) {
      h += '<label>Suggested</label>';
      subs.forEach((id) => {
        h += '<button class="btn btn-ghost ex-pick" onclick="LTA.ui.chooseSwap(\'' + id + '\')">' + esc(D.EXERCISES[id].name) + '</button>';
      });
    }
    h += '<label>Or anything else</label>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.openExerciseForm(null, \'swap\')">＋ Create a new exercise</button>' +
      '<input class="input" id="exSearch" placeholder="Search the library…" oninput="LTA.ui.filterExercises(this.value)">' +
      '<div id="exList" class="ex-list">' + exerciseListHTML('') + '</div>';
    modal(h, true);
  }

  function chooseSwap(toId) {
    const it = session.items[session.idx];
    pendingSwap = { from: it.swappedFrom || it.exerciseId, to: toId };
    const fromName = D.EXERCISES[pendingSwap.from].name;
    const toName = D.EXERCISES[toId].name;
    const h = '<h3>' + esc(toName) + '</h3>' +
      '<p class="muted">Replacing ' + esc(fromName) + '. How long should this stick?</p>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.applySwap(\'session\')">Just today</button>' +
      '<button class="btn btn-ghost btn-big" onclick="LTA.ui.applySwap(\'program\')">From now on</button>' +
      '<p class="muted">“From now on” swaps it everywhere ' + esc(fromName) + ' appears in your program, for the rest of the cycle and beyond. Undo it any time in Settings → Exercise library.</p>';
    modal(h, false);
  }

  function applySwap(scope) {
    const it = session.items[session.idx];
    const from = pendingSwap.from, to = pendingSwap.to;
    it.exerciseId = to;
    it.swappedFrom = from;
    delete session.pending[to];
    if (scope === 'program') {
      S().substitutions[from] = to;
      LTA.store.save(true);
    }
    saveDraft();
    closeModal();
    render();
    toast(scope === 'program'
      ? D.EXERCISES[to].name + ' replaces ' + D.EXERCISES[from].name + ' from now on.'
      : 'Swapped for today only.');
  }

  // ---------- Rest timer ----------

  // Rest clocks are derived from a start timestamp, never counted down tick by tick —
  // phones suspend timers for backgrounded pages, so a counter would silently drift or
  // freeze. This way the clock is always right the moment you look at it again.
  function startRest(sec, advanceToIdx, autoreg, forExercise) {
    stopRest();
    if (!sec) return;
    rest = { startedAt: Date.now(), total: sec, advanceToIdx: (advanceToIdx === undefined ? null : advanceToIdx), autoreg: !!autoreg, beeped: false, forExercise: forExercise || '' };
    rest.timerId = setInterval(tickRest, 500);
    renderRestBar();
  }

  // Land at the resolved target, but never pull you backward — if you've already
  // wandered ahead to peek at what's coming, the rest ending shouldn't yank you back.
  function landAt(targetIdx) {
    if (targetIdx == null || !session) return;
    session.idx = Math.max(session.idx, Math.min(session.items.length - 1, targetIdx));
  }

  function restElapsed() { return Math.max(0, Math.round((Date.now() - rest.startedAt) / 1000)); }

  function tickRest(silent) {
    if (!rest) return;
    const elapsed = restElapsed();
    if (rest.autoreg) {
      // Count up; the prescribed rest is a guide, you decide when you're ready.
      if (!rest.beeped && elapsed >= rest.total) { rest.beeped = true; if (!silent) beep(); }
      const el = $('restTime');
      if (el) el.textContent = U.fmtSec(elapsed);
      const bar = $('restFill');
      if (bar) bar.style.width = Math.min(100, 100 * elapsed / rest.total) + '%';
      return;
    }
    const remaining = rest.total - elapsed;
    if (remaining <= 0) {
      // silent: this is a reopen/foreground resync finding the timer already elapsed —
      // don't ding for a moment that already passed while the app was closed.
      if (!silent) beep();
      const target = rest.advanceToIdx;
      stopRest();
      landAt(target);
      render();
      return;
    }
    const el = $('restTime');
    if (el) el.textContent = U.fmtSec(remaining);
    const bar = $('restFill');
    if (bar) bar.style.width = (100 * remaining / rest.total) + '%';
  }

  function restReady() {
    const target = rest && rest.advanceToIdx;
    stopRest();
    landAt(target);
    render();
  }

  function adjustRest(d) {
    if (!rest) return;
    rest.startedAt += d * 1000;                                  // shifting the start shifts the clock
    if (restElapsed() > rest.total) rest.startedAt = Date.now() - rest.total * 1000;
    rest.beeped = false;
    tickRest();
  }

  function stopRest() {
    if (rest && rest.timerId) clearInterval(rest.timerId);
    rest = null;
    const el = $('restBar');
    if (el) el.remove();
  }

  function renderRestBar() {
    let el = $('restBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'restBar';
      el.className = 'rest-bar';
      document.body.appendChild(el);
    }
    const elapsed = restElapsed();
    // Only label it once you've navigated elsewhere — no need to state the obvious
    // while you're still looking at the exercise the rest belongs to.
    const viewingOther = session && rest.forExercise && D.EXERCISES[session.items[session.idx].exerciseId] &&
      D.EXERCISES[session.items[session.idx].exerciseId].name !== rest.forExercise;
    const label = viewingOther ? '<div class="rest-for">Resting from ' + esc(rest.forExercise) + '</div>' : '';
    if (rest.autoreg) {
      el.innerHTML = label + '<div class="rest-fill" id="restFill" style="width:' + Math.min(100, 100 * elapsed / rest.total) + '%"></div>' +
        '<div class="rest-row"><span>Rest · guide ' + U.fmtSec(rest.total) + '+</span><strong id="restTime">' + U.fmtSec(elapsed) + '</strong>' +
        '<button class="btn-mini" onclick="LTA.ui.restReady()">Ready — go</button></div>' +
        '<div class="rest-hint">Breathing settled, same weight feels doable? That’s ready.</div>';
    } else {
      const remaining = Math.max(0, rest.total - elapsed);
      el.innerHTML = label + '<div class="rest-fill" id="restFill" style="width:' + (100 * remaining / rest.total) + '%"></div>' +
        '<div class="rest-row"><span>Rest</span><strong id="restTime">' + U.fmtSec(remaining) + '</strong>' +
        '<button class="btn-mini" onclick="LTA.ui.adjustRest(-15)">−15</button>' +
        '<button class="btn-mini" onclick="LTA.ui.adjustRest(15)">+15</button>' +
        '<button class="btn-mini" onclick="LTA.ui.stopRest()">Skip</button></div>';
    }
  }

  // ---------- Audio ----------
  // Phones only let a page make noise if the audio was unlocked by a real tap, and a
  // suspended AudioContext silently does nothing. So we prime on every user gesture we
  // get, and keep a plain <audio> element as the more reliable path on iOS.
  let beepEl = null;
  let beepUrl = null;

  function buildBeep() {
    const sr = 8000, dur = 0.22, n = Math.round(sr * dur);
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE');
    wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wr(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const fade = Math.min(1, Math.min(i, n - i) / (sr * 0.012));
      v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 880 * i / sr) * 26000 * fade, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // Deliberately doesn't touch AudioContext here: merely constructing/resuming one is
  // enough to make iOS Safari steal audio focus from whatever's playing in the
  // background (e.g. Spotify), even though the beep itself plays through beepEl below.
  // AudioContext stays a lazy fallback inside beep(), reached only if beepEl fails.
  function primeAudio() {
    try {
      if (!beepEl) {
        beepUrl = beepUrl || buildBeep();
        beepEl = new Audio(beepUrl);
        beepEl.preload = 'auto';
        beepEl.load();
      }
    } catch (e) { /* no audio available */ }
  }

  function beep() {
    let played = false;
    try {
      if (beepEl) { beepEl.currentTime = 0; const pr = beepEl.play(); if (pr && pr.catch) pr.catch(() => {}); played = true; }
    } catch (e) { played = false; }
    if (played) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = 880; g.gain.value = 0.15;
      o.start(); o.stop(audioCtx.currentTime + 0.25);
    } catch (e) { /* silent */ }
  }

  // ---------- Keep the screen on during a session ----------
  let wakeLock = null;
  function acquireWakeLock() {
    try {
      if (!('wakeLock' in navigator) || wakeLock) return;
      navigator.wakeLock.request('screen').then((wl) => {
        wakeLock = wl;
        wl.addEventListener('release', () => { wakeLock = null; });
      }).catch(() => {});
    } catch (e) { /* unsupported */ }
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* noop */ }
    wakeLock = null;
  }

  // ---------- Run player ----------

  function renderRunPlayer(view) {
    const spec = E.runSpec();
    let h = '<div class="player">';
    h += '<div class="player-top"><button class="btn-mini" onclick="LTA.ui.abandonSession()">✕</button>' +
      '<div class="player-progress">Run day</div>' +
      '<button class="btn-mini pain" onclick="LTA.ui.openPainModal()">Pain?</button></div>';

    if (spec.mode === 'bike') {
      h += '<h2 class="ex-name">Bike intervals</h2><p>' + esc(spec.protocol) + '</p>' +
        '<p class="muted">' + esc(spec.cues[0]) + '</p>' +
        '<button class="btn btn-primary btn-big" onclick="LTA.ui.finishRun(\'bike\')">Done — intervals complete</button>';
    } else {
      h += '<h2 class="ex-name">' + esc(spec.stage.name) + '</h2>';
      h += '<div class="ex-target">' + esc(spec.protocol) + '</div>';
      h += '<p class="muted">Completions: ' + spec.completions + '/' + spec.required + ' · pain ≤2/10 counts</p>';
      h += '<ul class="cues">' + spec.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
      if (runTimer) {
        h += '<div class="run-timer"><div class="run-phase" id="runPhase">' + esc(runTimer.phases[runTimer.idx].label) + '</div>' +
          '<div class="run-clock" id="runClock">' + U.fmtSec(runTimer.remaining) + '</div>' +
          '<div class="muted" id="runNext">' + runNextLabel() + '</div>' +
          '<button class="btn btn-ghost" onclick="LTA.ui.toggleRunTimer()">' + (runTimer.running ? 'Pause' : 'Resume') + '</button>' +
          '<button class="btn-link" onclick="LTA.ui.stopRunTimer()">Stop timer</button></div>';
      } else {
        h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.startRunTimer()">Start interval timer</button>';
        h += '<button class="btn btn-ghost btn-big" onclick="LTA.ui.finishRun(\'run\')">Finish — I ran it</button>';
      }
    }
    h += '<div class="card-title" style="margin-top:24px">Then: core</div>';
    h += '<p class="muted">Dead bug 3×8 · Side plank 3×30–45 s · Pallof press 3×10 — logged as part of this session.</p>';
    h += '</div>';
    view.innerHTML = h;
  }

  function startRunTimer() {
    const spec = E.runSpec();
    const phases = [];
    (spec.intervals || []).forEach((iv) => {
      if (iv.run) phases.push({ label: '🏃 RUN', sec: iv.run * 60 });
      if (iv.walk) phases.push({ label: '🚶 Walk', sec: iv.walk * 60 });
    });
    if (!phases.length) return;
    runTimer = { phases, idx: 0, remaining: phases[0].sec, running: true };
    runTimer.timerId = setInterval(tickRun, 1000);
    render();
  }

  function runNextLabel() {
    const nxt = runTimer.phases[runTimer.idx + 1];
    return nxt ? 'Next: ' + nxt.label + ' ' + U.fmtSec(nxt.sec) : 'Last interval — finish strong';
  }

  function tickRun() {
    if (!runTimer || !runTimer.running) return;
    runTimer.remaining--;
    if (runTimer.remaining <= 0) {
      beep();
      runTimer.idx++;
      if (runTimer.idx >= runTimer.phases.length) {
        stopRunTimer();
        finishRun('run');
        return;
      }
      runTimer.remaining = runTimer.phases[runTimer.idx].sec;
      const ph = $('runPhase'); if (ph) ph.textContent = runTimer.phases[runTimer.idx].label;
      const nx = $('runNext'); if (nx) nx.textContent = runNextLabel();
    }
    const el = $('runClock');
    if (el) el.textContent = U.fmtSec(runTimer.remaining);
  }

  function toggleRunTimer() { if (runTimer) { runTimer.running = !runTimer.running; render(); } }
  function stopRunTimer() { if (runTimer && runTimer.timerId) clearInterval(runTimer.timerId); runTimer = null; render(); }

  function finishRun(mode) {
    stopRunTimer();
    const spec = E.runSpec();
    let h = '<h3>' + (mode === 'bike' ? 'Bike intervals done' : 'Run done') + '</h3>';
    if (mode === 'run') {
      h += '<label>Knee pain during the run (0–10)</label>' + painSliderHTML('runPain', 0);
    }
    h += '<label>How did it feel overall?</label>' + feelButtonsHTML();
    h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.confirmRunFinish(\'' + mode + '\',' + (spec.stage ? spec.stage.id : -1) + ')">Save session</button>';
    modal(h, true);
  }

  function confirmRunFinish(mode, stageId) {
    const painVal = mode === 'run' ? Number(($('slider-runPain') || {}).value || 0) : 0;
    if (mode === 'run' && painVal > 0) {
      session.painFlags.push({ area: 'knee', severity: painVal, when: 'during', date: session.date, context: 'run' });
    }
    session.runMode = mode;
    session.runCompleted = true;
    if (stageId >= 0) session.runStageId = stageId;
    session.feel = selectedFeel;
    closeModal();
    completeSession();
  }

  // ---------- Racket / simple players ----------

  function renderRacketPlayer(view) {
    let h = '<div class="player"><div class="player-top"><button class="btn-mini" onclick="LTA.ui.abandonSession()">✕</button>' +
      '<div class="player-progress">Racket session</div><span></span></div>';
    h += '<h2 class="ex-name">Tennis / Padel</h2>';
    h += '<label>Duration (minutes)</label>' + stepperHTML('duration', 60, 15, 'min');
    h += '<label>Intensity</label><div class="seg" id="seg-intensity">' + segHTML(['Casual', 'Moderate', 'Competitive'], 1) + '</div>';
    h += '<label>Shoulder during serves (0–10)</label>' + painSliderHTML('racketShoulder', 0);
    h += '<label>Knee (0–10)</label>' + painSliderHTML('racketKnee', 0);
    h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.finishRacket()">Save play session</button></div>';
    view.innerHTML = h;
    session.pending.__racket = { duration: 60 };
    // reuse stepper plumbing
    session.items = [{ exerciseId: '__racket' }];
    session.idx = 0;
    session.pending.__racket = session.pending.__racket || {};
    session.pending.__racket.weight = 0;
    session.pending.__racket.duration = 60;
  }

  function segHTML(labels, activeIdx) {
    return labels.map((l, i) => '<button class="seg-btn' + (i === activeIdx ? ' active' : '') + '" onclick="LTA.ui.segPick(this)">' + esc(l) + '</button>').join('');
  }
  function segPick(btn) {
    btn.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function finishRacket() {
    const dur = Number(($('step-duration') || {}).textContent || 60);
    const sh = Number(($('slider-racketShoulder') || {}).value || 0);
    const kn = Number(($('slider-racketKnee') || {}).value || 0);
    const seg = document.querySelector('#seg-intensity .seg-btn.active');
    if (sh > 0) session.painFlags.push({ area: 'shoulder', severity: sh, when: 'during', date: session.date, context: 'racket' });
    if (kn > 0) session.painFlags.push({ area: 'knee', severity: kn, when: 'during', date: session.date, context: 'racket' });
    session.durationMin = dur;
    session.notes = 'Intensity: ' + (seg ? seg.textContent : 'Moderate');
    session.feel = 4;
    completeSession();
  }

  function renderSimplePlayer(view) {
    const isZ2 = session.dayType === 'z2';
    const s = S();
    let h = '<div class="player"><div class="player-top"><button class="btn-mini" onclick="LTA.ui.abandonSession()">✕</button>' +
      '<div class="player-progress">' + (isZ2 ? 'Engine day' : 'Recovery day') + '</div>' +
      '<button class="btn-mini pain" onclick="LTA.ui.openPainModal()">Pain?</button></div>';
    if (isZ2) {
      const caution = s.currentWeek && s.currentWeek.kneeCaution;
      h += '<h2 class="ex-name">Build the engine</h2>';
      h += '<p class="muted">Pick one or both — ~30 min each.' + (caution ? ' Knee caution this week: prefer the spin bike over incline walking.' : '') + '</p>';
      h += '<div class="card"><label class="check"><input type="checkbox" id="didHiit" checked> HIIT spin · anaerobic</label>' +
        '<ul class="cues">' + D.EXERCISES.hiit_spin.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul></div>';
      h += '<div class="card"><label class="check"><input type="checkbox" id="didSteady"> Incline walk · steady state</label>' +
        '<ul class="cues">' + D.EXERCISES.incline_walk.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul></div>';
      h += '<label>Total minutes</label>' + stepperHTML('duration', 30, 5, 'min');
      const sprint = E.sprintSpec();
      if (sprint) {
        h += '<div class="card"><div class="card-title">⚡ Sprint work (unlocked)</div><p>' + esc(sprint.stage.name) + ': ' + esc(sprint.stage.protocol) + '</p>' +
          '<label class="check"><input type="checkbox" id="didSprints"> I did the sprints</label></div>';
      }
      h += '<div class="card"><div class="card-title">Mobility flow · 15 min</div><ul class="cues">' +
        D.EXERCISES.mobility_flow.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul></div>';
    } else {
      h += '<h2 class="ex-name">Recovery · GMB flow</h2><p class="muted">Skill practice, not a workout — or a walk, or full rest.</p>';
      h += '<ul class="cues">' + D.EXERCISES.gmb_flow.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
      h += '<a class="video-link" href="' + esc(D.EXERCISES.gmb_flow.video) + '" target="_blank" rel="noopener">▶ GMB locomotion tutorial</a>';
      h += '<div class="card"><div class="card-title">Optional mobility · 15 min</div><ul class="cues">' +
        D.EXERCISES.mobility_flow.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul></div>';
    }
    h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.finishSimple()">Mark done</button></div>';
    view.innerHTML = h;
    session.pending.__t = { duration: isZ2 ? 30 : 15 };
  }

  function finishSimple() {
    const durEl = $('step-duration');
    if (durEl) session.durationMin = Number(durEl.textContent);
    const sp = $('didSprints');
    if (sp && sp.checked) session.didSprints = true;
    // Record which engine modalities were done so history shows the mix.
    const hi = $('didHiit'), st = $('didSteady');
    if (hi && hi.checked) session.sets.push({ exerciseId: 'hiit_spin', weight: 0, reps: 30 });
    if (st && st.checked) session.sets.push({ exerciseId: 'incline_walk', weight: 0, reps: 30 });
    if (session.dayType === 'z2') openFinishModal();
    else openRecoveryFinishModal();
  }

  // ---------- Pain modal ----------

  function painSliderHTML(id, val) {
    return '<div class="pain-slider"><input type="range" min="0" max="10" step="1" value="' + val + '" id="slider-' + id + '" ' +
      'oninput="document.getElementById(\'sliderv-' + id + '\').textContent=this.value">' +
      '<div class="pain-val" id="sliderv-' + id + '">' + val + '</div></div>';
  }

  function openPainModal() {
    let h = '<h3>Flag pain</h3><label>Where?</label><div class="seg" id="seg-painarea">' + segHTML(['Knee', 'Shoulder', 'Other'], 0) + '</div>' +
      '<label>Severity (0–10)</label>' + painSliderHTML('painNow', 3) +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.savePainFlag()">Save flag</button>';
    modal(h, true);
  }

  function savePainFlag() {
    const seg = document.querySelector('#seg-painarea .seg-btn.active');
    const area = seg ? seg.textContent.toLowerCase() : 'other';
    const sev = Number(($('slider-painNow') || {}).value || 0);
    session.painFlags.push({ area, severity: sev, when: 'during', date: session.date });
    closeModal();
    if (area === 'shoulder' && sev >= 3) {
      const it = session.items[session.idx];
      const ex = it && D.EXERCISES[it.exerciseId];
      if (ex && ex.painGate === 'shoulder' && ex.subs.length) {
        if (confirm('Shoulder at ' + sev + '/10 — switch to ' + D.EXERCISES[ex.subs[0]].name + ' for the rest of this session?')) {
          it.exerciseId = ex.subs[0];
        }
      }
    }
    render();
  }

  // ---------- Finish modal (strength days) ----------

  let selectedFeel = 4;

  function feelButtonsHTML() {
    const faces = ['😖', '😕', '😐', '🙂', '💪'];
    return '<div class="seg" id="seg-feel">' + faces.map((f, i) =>
      '<button class="seg-btn' + (i === 3 ? ' active' : '') + '" onclick="LTA.ui.pickFeel(this,' + (i + 1) + ')">' + f + '</button>').join('') + '</div>';
  }
  function pickFeel(btn, v) { selectedFeel = v; segPick(btn); }

  function openFinishModal() {
    selectedFeel = 4;
    let h = '<h3>Finish session</h3>' +
      '<p class="muted">' + session.sets.length + ' sets logged · ' + Math.round((Date.now() - session.startedAt) / 60000) + ' min</p>' +
      '<label>How did it feel?</label>' + feelButtonsHTML() +
      '<label>Session effort (RPE 1–10)</label>' + painSliderHTML('srpe', 7) +
      '<label>Notes</label><textarea id="sessionNotes" rows="2" placeholder="optional"></textarea>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.confirmFinish()">Save session</button>';
    modal(h, true);
  }

  function confirmFinish() {
    session.feel = selectedFeel;
    session.sessionRPE = Number(($('slider-srpe') || {}).value || 7);
    const notes = $('sessionNotes');
    if (notes && notes.value) session.notes = notes.value;
    closeModal();
    completeSession();
  }

  function openRecoveryFinishModal() {
    selectedFeel = 4;
    let h = '<h3>Finish session</h3>' +
      '<label>How did it feel?</label>' + feelButtonsHTML() +
      '<label>Notes</label><textarea id="sessionNotes" rows="2" placeholder="optional"></textarea>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.confirmRecoveryFinish()">Save session</button>';
    modal(h, true);
  }

  function confirmRecoveryFinish() {
    session.feel = selectedFeel;
    const notes = $('sessionNotes');
    if (notes && notes.value) session.notes = notes.value;
    closeModal();
    completeSession();
  }

  function completeSession() {
    stopRest();
    releaseWakeLock();
    const sess = session;
    session = null;
    S().draftSession = null;
    sess.durationMin = sess.durationMin || Math.round((Date.now() - sess.startedAt) / 60000);
    delete sess.items; delete sess.pending; delete sess.idx; delete sess.startedAt;
    E.applySessionEnd(sess);
    const w = S().currentWeek;
    const fresh = w.decisions.slice(-2);
    render();
    if (fresh.length) toast(fresh.join(' '));
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 30);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 5000);
  }

  // ---------- Morning check-in ----------

  let activeCheckIn = null;

  function maybeCheckInModal() {
    if (session || activeCheckIn) return;
    const due = E.dueCheckIns();
    if (!due.length) return;
    activeCheckIn = due[0];
    const label = activeCheckIn.area === 'knee' ? 'knee' : 'shoulder';
    const ctx = activeCheckIn.context === 'run' ? 'the run' : activeCheckIn.context === 'racket' ? 'playing' : 'pressing';
    let h = '<h3>Morning check-in</h3><p>How is your ' + label + ' after ' + ctx + ' on ' + U.niceDate(activeCheckIn.date) + '?</p>' +
      painSliderHTML('checkin', 0) +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.saveCheckIn()">Save</button>' +
      '<button class="btn-link" onclick="LTA.ui.saveCheckIn(0)">No pain at all</button>';
    modal(h, false);
  }

  function saveCheckIn(forceVal) {
    const sev = forceVal !== undefined ? forceVal : Number(($('slider-checkin') || {}).value || 0);
    const ci = activeCheckIn;
    activeCheckIn = null;
    closeModal();
    E.resolveCheckIn(ci, sev);
    const fresh = S().currentWeek.decisions.slice(-1);
    render();
    if (fresh.length && sev > 0) toast(fresh[0]);
  }

  // ---------- Week view ----------

  function renderWeek(view) {
    const s = S();
    const w = s.currentWeek;
    const today = U.todayStr();
    let h = '<div class="pagehead"><h2>This Week</h2><div>' + topInfo() + '</div></div>';
    h += '<div class="week-list">';
    w.days.forEach((d, i) => {
      const tpl = D.DAYS[d.dayType];
      const isToday = d.date === today;
      const daySessions = E.sessionsForDate(d.date);
      const chip = daySessions.length > 1 ? '✅×' + daySessions.length :
        d.status === 'done' ? '✅' : d.status === 'replaced' ? '🎾' : d.status === 'skipped' ? '⏭' : (tpl.kind === 'rest' ? '🌙' : '·');
      const name = daySessions.length > 1 ? daySessions.map((sess) => (D.DAYS[sess.dayType] || {}).name || sess.dayType).join(' + ') : tpl.name;
      h += '<div class="week-day' + (isToday ? ' today' : '') + '" onclick="LTA.ui.dayActions(' + i + ')">' +
        '<div class="wd-date">' + U.weekdayName(d.date) + '<span>' + d.date.slice(8) + '</span></div>' +
        '<div class="wd-name">' + esc(name) + (d.optional ? ' <span class="badge">optional</span>' : '') + '</div>' +
        '<div class="wd-chip">' + chip + '</div></div>';
    });
    h += '</div>';
    h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.openRacketModal()">🎾 Racket session — played or planning to</button>';
    if (w.decisions.length) {
      h += '<div class="card"><div class="card-title">Adjustments & why</div><ul class="decisions">' +
        w.decisions.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul></div>';
    }
    view.innerHTML = h;
  }

  function dayActions(i) {
    const w = S().currentWeek;
    const d = w.days[i];
    const tpl = D.DAYS[d.dayType];
    const daySessions = E.sessionsForDate(d.date);
    let h = '<h3>' + U.niceDate(d.date) + '</h3><p>' + esc(tpl.name) + ' — ' + d.status + '</p>';
    if (daySessions.length) {
      h += '<div class="card-title">' + daySessions.length + ' session' + (daySessions.length > 1 ? 's' : '') + ' logged</div>';
      daySessions.forEach((sess) => { h += completedSessionCardHTML(sess); });
    }
    if (d.status === 'planned') {
      h += '<label>Change this day to:</label><select id="daySwapSel" class="input">' +
        Object.keys(D.DAYS).map((k) => '<option value="' + k + '"' + (k === d.dayType ? ' selected' : '') + '>' + esc(D.DAYS[k].name) + '</option>').join('') + '</select>' +
        '<button class="btn btn-primary btn-big" onclick="LTA.ui.applyDaySwap(' + i + ')">Save</button>';
      h += '<button class="btn btn-ghost btn-big" onclick="LTA.ui.markSkipped(' + i + ')">Mark skipped</button>';
    } else if (d.status === 'skipped') {
      h += '<button class="btn btn-ghost btn-big" onclick="LTA.ui.unskip(' + i + ')">Restore to planned</button>';
    }
    modal(h, true);
  }

  function applyDaySwap(i) {
    const sel = $('daySwapSel');
    const w = S().currentWeek;
    closeModal();
    const decisions = E.doDayInstead(w.days[i].date, sel.value);
    render();
    if (decisions && decisions.length) toast(decisions.join(' '));
  }
  function markSkipped(i) { const w = S().currentWeek; w.days[i].status = 'skipped'; LTA.store.save(true); closeModal(); render(); }
  function unskip(i) { const w = S().currentWeek; w.days[i].status = 'planned'; LTA.store.save(true); closeModal(); render(); }

  function openRacketModal() {
    const w = S().currentWeek;
    const today = U.todayStr();
    let h = '<h3>🎾 Racket session</h3><label>Which day?</label><select id="racketDate" class="input">';
    w.days.forEach((d) => {
      h += '<option value="' + d.date + '"' + (d.date === today ? ' selected' : '') + '>' + U.niceDate(d.date) + (d.date === today ? ' (today)' : '') + '</option>';
    });
    h += '</select><p class="muted">Past/today: logs the session and reshuffles the week. Future: plans it in and reshuffles now.</p>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.confirmRacket()">Continue</button>';
    modal(h, true);
  }

  function confirmRacket() {
    const date = $('racketDate').value;
    const today = U.todayStr();
    closeModal();
    E.insertRacketSession(date);
    if (date <= today) {
      // log the play session now
      session = { id: U.uid(), date, dayType: 'racket', items: [], sets: [], painFlags: [], pending: {}, startedAt: Date.now() };
      tab = 'today';
    }
    render();
    if (date > today) toast('Planned. The week has been reshuffled — check the adjustments list.');
  }

  // ---------- Review view ----------

  function renderReview(view) {
    const s = S();
    const due = E.reviewDue();
    let h = '<div class="pagehead"><h2>Weekly Review</h2><div>' + topInfo() + '</div></div>';
    if (due) {
      const adh = Math.round(E.adherenceOf(due) * 100);
      h += '<div class="card"><div class="card-title">Week of ' + U.niceDate(due.weekStart) + '</div>' +
        '<p class="muted">Adherence: ' + adh + '%</p>' +
        revSlider('sleep', 'Sleep quality', 4, 1, 5) +
        revSlider('energy', 'Energy levels', 4, 1, 5) +
        revSlider('soreness', 'Soreness / beat-up-ness', 2, 1, 5) +
        revSlider('motivation', 'Motivation', 4, 1, 5) +
        revSlider('kneeMaxPain', 'Worst knee pain this week (0–10)', 0, 0, 10) +
        revSlider('kneeMorningPain', 'Knee pain on waking, typical (0–10)', 0, 0, 10) +
        revSlider('shoulderMaxPain', 'Worst shoulder pain this week (0–10)', 0, 0, 10) +
        '<button class="btn btn-primary btn-big" onclick="LTA.ui.submitReview(\'' + due.weekStart + '\')">Build next week</button></div>';
    } else {
      h += '<div class="card"><p>No review due. It unlocks when a training week finishes.</p></div>';
    }
    if (s.reviews.length) {
      h += '<div class="card"><div class="card-title">Past reviews</div>';
      s.reviews.slice(-6).reverse().forEach((r) => {
        h += '<div class="review-item"><strong>' + U.niceDate(r.weekStart) + '</strong> · readiness ' + r.readiness + '/15 · ' + Math.round(r.adherence * 100) + '%' +
          '<ul class="decisions">' + r.decisions.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul></div>';
      });
      h += '</div>';
    }
    view.innerHTML = h;
  }

  function revSlider(id, label, val, min, max) {
    return '<label>' + esc(label) + '</label><div class="pain-slider"><input type="range" min="' + min + '" max="' + max + '" step="1" value="' + val + '" id="rev-' + id + '" ' +
      'oninput="document.getElementById(\'revv-' + id + '\').textContent=this.value">' +
      '<div class="pain-val" id="revv-' + id + '">' + val + '</div></div>';
  }

  function submitReview(weekStart) {
    const g = (id) => Number($('rev-' + id).value);
    const answers = {
      sleep: g('sleep'), energy: g('energy'), soreness: g('soreness'), motivation: g('motivation'),
      kneeMaxPain: g('kneeMaxPain'), kneeMorningPain: g('kneeMorningPain'), shoulderMaxPain: g('shoulderMaxPain'),
    };
    const decisions = E.processReview(weekStart, answers);
    let h = '<h3>Next week, and why</h3><ul class="decisions">' + decisions.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul>' +
      '<button class="btn btn-primary btn-big" onclick="LTA.ui.closeModal();LTA.ui.setTab(\'week\')">See the week</button>';
    modal(h, false);
  }

  // ---------- Progress view ----------

  let chartLift = null;

  function renderProgress(view) {
    const s = S();
    const liftsWithData = chartableLifts();
    if (!chartLift || !liftsWithData.includes(chartLift)) chartLift = liftsWithData[0] || null;

    let h = '<div class="pagehead"><h2>Progress</h2><div>' + topInfo() + '</div></div>';

    // Strength
    h += '<div class="card"><div class="card-title">' + (chartLift && repsChart(chartLift) ? 'Strength — best set (reps)' : 'Strength — estimated 1RM') + '</div>';
    if (chartLift) {
      h += '<select class="input" onchange="LTA.ui.pickLift(this.value)">' +
        liftsWithData.map((id) => '<option value="' + id + '"' + (id === chartLift ? ' selected' : '') + '>' + esc(D.EXERCISES[id].name) + '</option>').join('') + '</select>';
      h += '<canvas id="liftChart" width="640" height="240"></canvas>';
    } else {
      h += '<p class="muted">Log a few strength sessions and the chart appears here.</p>';
    }
    h += '</div>';

    // Run
    const rs = s.runState;
    const stage = D.RUN_STAGES[rs.stageId];
    h += '<div class="card"><div class="card-title">Run — road to 5k</div>';
    h += '<div class="stage-track">' + D.RUN_STAGES.map((st) =>
      '<div class="stage-dot' + (st.id < rs.stageId ? ' passed' : st.id === rs.stageId ? ' current' : '') + '" title="' + esc(st.protocol) + '">' + st.id + '</div>').join('') + '</div>';
    h += '<p>' + esc(stage.name) + ': ' + esc(stage.protocol) + ' · completions ' + rs.completionsAtStage + '/' + stage.completionsRequired + '</p>';
    if (rs.sprintUnlocked) {
      const sp = E.sprintSpec();
      h += '<p>⚡ Sprints: ' + esc(sp.stage.name) + ' (' + sp.sessions + ' sessions in)</p>';
    } else {
      h += '<p class="muted">Sprint work unlocks after 20 min continuous running pain-free.</p>';
    }
    h += '</div>';

    // Shoulder
    const sh = s.shoulderState;
    h += '<div class="card"><div class="card-title">Overhead ladder</div><div class="stage-track">' +
      D.OVERHEAD_RUNGS.map((r) => '<div class="stage-dot' + (r.id < sh.rungId ? ' passed' : r.id === sh.rungId ? ' current' : '') + '" title="' + esc(D.EXERCISES[r.exerciseId].name) + '">' + (r.id + 1) + '</div>').join('') +
      '</div><p>' + esc(D.EXERCISES[D.OVERHEAD_RUNGS[sh.rungId].exerciseId].name) + ' · clean sessions ' + sh.sessionsAtRung + '/' + D.OVERHEAD_RUNGS[sh.rungId].sessionsRequired + '</p></div>';

    // Pain trends
    h += '<div class="card"><div class="card-title">Pain trend (weekly max)</div><canvas id="painChart" width="640" height="200"></canvas>' +
      '<p class="muted"><span class="dotk"></span> knee &nbsp; <span class="dots"></span> shoulder</p></div>';

    // Adherence
    h += '<div class="card"><div class="card-title">Adherence</div><canvas id="adhChart" width="640" height="160"></canvas></div>';

    view.innerHTML = h;
    requestAnimationFrame(drawCharts);
  }

  function pickLift(id) { chartLift = id; render(); }

  // Anything loggable with history — main lifts first, then accessories and your own exercises.
  function chartableLifts() {
    const counts = {};
    S().sessions.forEach((sess) => {
      const seen = {};
      (sess.sets || []).forEach((x) => {
        if (seen[x.exerciseId]) return;
        seen[x.exerciseId] = 1;
        counts[x.exerciseId] = (counts[x.exerciseId] || 0) + 1;
      });
    });
    return Object.keys(counts).filter((id) => {
      const e = D.EXERCISES[id];
      return e && (e.category === 'strength' || e.category === 'accessory' || e.category === 'power');
    }).sort((a, b) => (D.MAIN_LIFTS.indexOf(b) >= 0) - (D.MAIN_LIFTS.indexOf(a) >= 0));
  }

  // Bodyweight work never carries a meaningful e1RM — chart reps instead so progress shows.
  function repsChart(exId) {
    const e = D.EXERCISES[exId];
    if (!e || !e.bodyweight) return false;
    return !S().sessions.some((sess) => (sess.sets || []).some((x) => x.exerciseId === exId && x.weight > 0));
  }

  function drawCharts() {
    const s = S();
    // e1RM chart
    const lc = $('liftChart');
    if (lc && chartLift) {
      const byReps = repsChart(chartLift);
      const pts = [];
      s.sessions.forEach((sess) => {
        let best = 0;
        (sess.sets || []).forEach((x) => {
          if (x.exerciseId !== chartLift) return;
          best = Math.max(best, byReps ? x.reps : U.e1rm(x.weight, x.reps));
        });
        if (best > 0) pts.push({ x: sess.date, y: Math.round(best * 10) / 10 });
      });
      drawLine(lc, [{ points: pts, color: css('--accent') }], { yLabel: byReps ? 'reps' : unit() });
    }
    // pain chart
    const pc = $('painChart');
    if (pc) {
      const byWeek = {};
      s.painLog.forEach((f) => {
        const wk = U.mondayOf(f.date);
        byWeek[wk] = byWeek[wk] || { knee: 0, shoulder: 0 };
        if (f.area === 'knee') byWeek[wk].knee = Math.max(byWeek[wk].knee, f.severity);
        if (f.area === 'shoulder') byWeek[wk].shoulder = Math.max(byWeek[wk].shoulder, f.severity);
      });
      const weeks = Object.keys(byWeek).sort();
      drawLine(pc, [
        { points: weeks.map((w) => ({ x: w, y: byWeek[w].knee })), color: css('--warn') },
        { points: weeks.map((w) => ({ x: w, y: byWeek[w].shoulder })), color: css('--accent2') },
      ], { yMax: 10 });
    }
    // adherence chart
    const ac = $('adhChart');
    if (ac) {
      const weeks = s.weekHistory.slice(-10);
      drawBars(ac, weeks.map((w) => ({ label: w.weekStart.slice(5), value: Math.round(E.adherenceOf(w) * 100) })), { yMax: 100 });
    }
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#4ade80'; }

  function drawLine(canvas, seriesList, opts) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, P = 28;
    ctx.clearRect(0, 0, W, H);
    let all = [];
    seriesList.forEach((sr) => { all = all.concat(sr.points); });
    if (!all.length) { ctx.fillStyle = css('--muted'); ctx.font = '14px system-ui'; ctx.fillText('No data yet', P, H / 2); return; }
    const xs = all.map((p) => p.x).sort();
    const x0 = xs[0], x1 = xs[xs.length - 1];
    const span = Math.max(1, U.daysBetween(x0, x1));
    const yMax = opts.yMax || Math.max(...all.map((p) => p.y)) * 1.15 || 1;
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
    ctx.strokeRect(P, 8, W - P - 8, H - P - 8);
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui';
    ctx.fillText(String(Math.round(yMax)), 2, 16);
    ctx.fillText('0', 2, H - P + 4);
    seriesList.forEach((sr) => {
      if (!sr.points.length) return;
      ctx.strokeStyle = sr.color; ctx.lineWidth = 2; ctx.beginPath();
      sr.points.forEach((p, i) => {
        const px = P + (U.daysBetween(x0, p.x) / span) * (W - P - 12);
        const py = (H - P) - (p.y / yMax) * (H - P - 16);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = sr.color;
      sr.points.forEach((p) => {
        const px = P + (U.daysBetween(x0, p.x) / span) * (W - P - 12);
        const py = (H - P) - (p.y / yMax) * (H - P - 16);
        ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
      });
    });
  }

  function drawBars(canvas, bars, opts) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, P = 24;
    ctx.clearRect(0, 0, W, H);
    if (!bars.length) { ctx.fillStyle = css('--muted'); ctx.font = '14px system-ui'; ctx.fillText('Finish a week to see adherence', P, H / 2); return; }
    const bw = Math.min(48, (W - P * 2) / bars.length - 8);
    bars.forEach((b, i) => {
      const x = P + i * ((W - P * 2) / bars.length);
      const h = (b.value / (opts.yMax || 100)) * (H - P - 20);
      ctx.fillStyle = b.value >= 85 ? css('--accent') : b.value >= 50 ? css('--accent2') : css('--warn');
      ctx.fillRect(x, H - P - h, bw, h);
      ctx.fillStyle = css('--muted'); ctx.font = '10px system-ui';
      ctx.fillText(b.label, x, H - 8);
      ctx.fillText(b.value + '%', x, H - P - h - 4);
    });
  }

  // ---------- Settings ----------

  function renderSettings(view) {
    const s = S();
    const st = LTA.sync ? LTA.sync.getStatus() : { state: 'off' };
    let h = '<div class="pagehead"><h2>Settings</h2></div>';

    const user = LTA.sync ? LTA.sync.currentUser() : null;
    const configured = !!(s.settings.supabaseUrl && s.settings.supabaseKey);
    h += '<div class="card"><div class="card-title">Cloud sync (Supabase)</div>';
    if (user) {
      h += '<p>Signed in as <strong>' + esc(user.email) + '</strong></p>' +
        '<p class="muted">Status: <span id="syncStatusText">' + esc(st.state) + (st.detail ? ' — ' + esc(st.detail) : '') + '</span></p>' +
        '<button class="btn btn-ghost" onclick="LTA.ui.syncNow()">Sync now</button>' +
        '<button class="btn btn-ghost" onclick="LTA.ui.doSignOut()">Sign out</button>';
    } else if (configured) {
      h += '<p class="muted">Sign in to sync. Your data is scoped to your account — the project key on its own can’t reach it.</p>' +
        '<label>Email</label><input class="input" id="authEmail" type="email" autocomplete="username" placeholder="you@example.com">' +
        '<label>Password</label><input class="input" id="authPass" type="password" autocomplete="current-password" placeholder="at least 6 characters">' +
        '<button class="btn btn-primary" onclick="LTA.ui.doSignIn()">Sign in</button>' +
        '<button class="btn btn-ghost" onclick="LTA.ui.doSignUp()">Create account</button>' +
        '<p class="muted">Status: <span id="syncStatusText">' + esc(st.state) + (st.detail ? ' — ' + esc(st.detail) : '') + '</span></p>';
    } else {
      h += '<p class="muted">Add your project details, then sign in. Both values are safe to store here — they identify the project, they don’t grant access on their own.</p>';
    }
    // Once signed in and synced, the raw key field and one-time setup SQL are done
    // business — fold them both under one "Advanced" disclosure instead of showing
    // two open sections for steps that only matter during setup or troubleshooting.
    const settled = user && st.state === 'ok';
    h += '<details' + (settled ? '' : ' open') + '><summary class="muted">' + (settled ? 'Advanced / troubleshooting' : 'Project details') + '</summary>';
    h += '<label>Project URL</label><input class="input" id="sbUrl" placeholder="https://xxxx.supabase.co" value="' + esc(s.settings.supabaseUrl) + '">' +
      '<label>Anon key</label><input class="input" id="sbKey" type="password" placeholder="paste anon public key" value="' + esc(s.settings.supabaseKey) + '">' +
      '<button class="btn btn-primary" onclick="LTA.ui.saveSupabase()">Save project details</button>' +
      '<details' + (settled ? '' : ' open') + '><summary class="muted">One-time table setup (run in Supabase SQL editor)</summary><pre class="sql">' + esc(LTA.sync ? LTA.sync.TABLE_SQL : '') + '</pre></details>' +
      '</details></div>';

    h += '<div class="card"><div class="card-title">Exercise library</div>' +
      '<p class="muted">Create your own exercises or edit any existing one — cues, tempo, rep ranges, videos, notes.</p>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.openExerciseLibrary()">Manage exercises</button>';
    const subs = s.substitutions || {};
    const subIds = Object.keys(subs).filter((id) => D.EXERCISES[id] && D.EXERCISES[subs[id]]);
    if (subIds.length) {
      h += '<div class="card-title" style="margin-top:14px">Standing swaps</div>';
      subIds.forEach((id) => {
        h += '<div class="swap-row"><span>' + esc(D.EXERCISES[id].name) + ' → <strong>' + esc(D.EXERCISES[subs[id]].name) + '</strong></span>' +
          '<button class="btn-mini" onclick="LTA.ui.undoSwap(\'' + id + '\')">Undo</button></div>';
      });
    }
    h += '</div>';

    h += '<div class="card"><div class="card-title">Data</div>' +
      '<button class="btn btn-ghost" onclick="LTA.store.exportJSON()">Export backup (JSON)</button>' +
      '<label class="btn btn-ghost file-btn">Import backup<input type="file" accept=".json" onchange="LTA.ui.importFile(this)"></label></div>';

    h += '<div class="card"><div class="card-title">Training</div>' +
      '<label class="check" style="margin-top:4px"><input type="checkbox" id="setAutoRest"' + (s.settings.autoRest !== false ? ' checked' : '') + '> Auto-regulate rest on heavy lifts (count up until ready)</label>' +
      '<label>Default rest (seconds)</label><input class="input" id="setRest" type="number" value="' + s.settings.defaultRestSec + '">' +
      '<label>Weekly skeleton</label>';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d, i) => {
      h += '<div class="skel-row"><span>' + d + '</span><select class="input skel" data-i="' + i + '">' +
        Object.keys(D.DAYS).filter((k) => k !== 'racket').map((k) => '<option value="' + k + '"' + (s.settings.skeleton[i] === k ? ' selected' : '') + '>' + esc(D.DAYS[k].name) + '</option>').join('') +
        '</select></div>';
    });
    h += '<button class="btn btn-primary" onclick="LTA.ui.saveTraining()">Save training settings</button>' +
      '<p class="muted">Skeleton changes apply from next week.</p></div>';

    h += '<div class="card danger"><div class="card-title">Danger zone</div>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.resetAll()">Reset everything</button></div>';

    h += '<div class="card"><div class="card-title">App version</div>' +
      '<p class="muted">Build <strong>' + esc(APP_VERSION) + '</strong>' + (swVersion ? ' · cache ' + esc(swVersion) : '') + '</p>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.forceUpdate()">Force update now</button>' +
      '<p class="muted">Clears the offline cache and reloads. Your data is untouched.</p></div>';

    h += '<p class="muted center">Luke’s Training App · install: Safari share → “Add to Home Screen”</p>';
    view.innerHTML = h;
  }

  function undoSwap(id) {
    delete S().substitutions[id];
    LTA.store.save(true);
    render();
    toast('Standing swap removed — the original exercise is back.');
  }

  // Escape hatch: if the phone is ever stuck on an old build, this wipes the cache and reloads.
  function forceUpdate() {
    const done = () => setTimeout(() => location.reload(), 150);
    try {
      const jobs = [];
      if (window.caches) jobs.push(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
      if ('serviceWorker' in navigator) {
        jobs.push(navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))));
      }
      Promise.all(jobs).then(done, done);
    } catch (e) { done(); }
  }

  function saveSupabase() {
    const s = S();
    s.settings.supabaseUrl = $('sbUrl').value.trim();
    s.settings.supabaseKey = $('sbKey').value.trim();
    LTA.store.save(true);
    render();
    toast('Project saved. Now sign in.');
  }

  function authFields() {
    const email = ($('authEmail') || {}).value || '';
    const pass = ($('authPass') || {}).value || '';
    return { email: email.trim(), pass };
  }

  function doSignIn() {
    const { email, pass } = authFields();
    if (!email || !pass) { alert('Enter your email and password.'); return; }
    toast('Signing in…');
    LTA.sync.signIn(email, pass)
      .then(() => LTA.sync.initialSync())
      .then(() => { render(); toast('Signed in — syncing.'); })
      .catch((e) => { render(); alert('Sign-in failed: ' + e.message); });
  }

  function doSignUp() {
    const { email, pass } = authFields();
    if (!email || !pass) { alert('Enter an email and a password (6+ characters).'); return; }
    toast('Creating account…');
    LTA.sync.signUp(email, pass)
      .then((r) => {
        render();
        if (r.confirmationRequired) alert('Account created. Check your email for the confirmation link, then sign in.');
        else { LTA.sync.initialSync(); toast('Account created — syncing.'); }
      })
      .catch((e) => { render(); alert('Could not create the account: ' + e.message); });
  }

  function doSignOut() {
    if (!confirm('Sign out on this device? Your training data stays here.')) return;
    LTA.sync.signOut().then(() => { render(); toast('Signed out.'); });
  }

  function syncNow() {
    toast('Syncing…');
    LTA.sync.push().then((ok) => { render(); toast(ok ? 'Synced.' : 'Sync failed — see status.'); });
  }

  function importFile(input) {
    const f = input.files[0];
    if (!f) return;
    if (!confirm('Importing replaces everything on this device with the backup. Continue?')) { input.value = ''; return; }
    const r = new FileReader();
    r.onload = () => {
      try { LTA.store.importJSON(r.result); E.applyUserExercises(); E.ensureWeek(); render(); toast('Backup imported.'); }
      catch (e) { alert('Import failed: ' + e.message); }
    };
    r.readAsText(f);
  }

  function saveTraining() {
    const s = S();
    s.settings.autoRest = $('setAutoRest').checked;
    s.settings.defaultRestSec = Number($('setRest').value) || 90;
    document.querySelectorAll('.skel').forEach((sel) => { s.settings.skeleton[Number(sel.dataset.i)] = sel.value; });
    LTA.store.save(true);
    toast('Saved. New skeleton applies from next week.');
  }

  function resetAll() {
    if (!confirm('Wipe ALL local data (sessions, progress, settings)?')) return;
    if (!confirm('Really sure? This cannot be undone unless you exported a backup.')) return;
    LTA.store.reset();
    session = null;
    E.ensureWeek();
    render();
  }

  // ---------- Modal plumbing ----------

  function modal(html, dismissible) {
    const m = $('modal');
    m.classList.remove('hidden');
    m.innerHTML = '<div class="modal-box">' + (dismissible ? '<button class="modal-x" onclick="LTA.ui.closeModal()">✕</button>' : '') + html + '</div>';
  }
  function closeModal() {
    const m = $('modal');
    m.classList.add('hidden');
    m.innerHTML = '';
  }

  return {
    init, render, setTab,
    startSession, abandonSession, logSet, logTimedItem, moveEx, step,
    openSubModal, chooseSwap, applySwap, openChangeToday, changeToday, warmupDone, calibAnswer, calibPainAnswer,
    editStep, deleteSet, undoSwap, forceUpdate,
    openAddExercise, filterExercises, addExercise,
    openExerciseLibrary, openExerciseFormFor, openExerciseForm, saveExerciseForm, deleteCustomExercise,
    openNoteModal, saveNote, openWarmupNoteModal, saveWarmupNote,
    startRest, stopRest, adjustRest, restReady,
    startRunTimer, toggleRunTimer, stopRunTimer, finishRun, confirmRunFinish,
    finishRacket, finishSimple, segPick,
    openPainModal, savePainFlag,
    openFinishModal, confirmFinish, openRecoveryFinishModal, confirmRecoveryFinish, pickFeel,
    saveCheckIn,
    dayActions, applyDaySwap, markSkipped, unskip, openRacketModal, confirmRacket,
    submitReview, pickLift,
    saveSupabase, doSignIn, doSignUp, doSignOut, syncNow, importFile, saveTraining, resetAll,
    closeModal,
  };
})();

document.addEventListener('DOMContentLoaded', LTA.ui.init);
