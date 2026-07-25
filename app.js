/* LTA.ui — views, session player, timers, charts. Renders into #view. */
window.LTA = window.LTA || {};

LTA.ui = (function () {
  'use strict';
  const U = LTA.util;
  const D = LTA.data;
  const E = LTA.engine;

  let tab = 'today';
  let session = null;          // in-progress session player state
  let rest = null;             // rest timer state
  let runTimer = null;         // run interval timer state
  let audioCtx = null;

  function S() { return LTA.store.getState(); }
  function $(id) { return document.getElementById(id); }
  const esc = U.esc;

  function unit() { return S().settings.units === 'lb' ? 'lb' : 'kg'; }

  // ---------- boot ----------

  function init() {
    LTA.store.load();
    E.applyUserExercises();
    E.ensureWeek();
    resumeDraft();
    render();
    if (LTA.sync) LTA.sync.initialSync();
    if (LTA.sync) LTA.sync.onStatus(renderSyncDot);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
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
  }

  function renderSyncDot() {
    const el = $('syncDot');
    if (!el || !LTA.sync) return;
    const st = LTA.sync.getStatus();
    el.className = 'sync-dot ' + st.state;
    el.title = st.state + (st.detail ? ': ' + st.detail : '');
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
      h += '<div class="session-kind">' + esc(tpl.name) + '</div>';
      h += sessionSummaryHTML(day.dayType);
      if (day.status === 'done') {
        h += '<div class="done-note">✅ Done — nice work.</div>';
        h += '<button class="btn btn-ghost" onclick="LTA.ui.startSession()">Log another session</button>';
      } else if (day.status === 'skipped') {
        h += '<div class="done-note muted">Skipped this week' + (day.replacedBy ? '' : ' — racket play covered it.') + '</div>';
        h += '<button class="btn btn-ghost" onclick="LTA.ui.startSession()">Do it anyway</button>';
      } else {
        h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.startSession()">Start session</button>';
      }
      h += '<button class="btn btn-ghost" onclick="LTA.ui.openChangeToday()">Do something else today</button>';
      h += '</div>';
      if (day.optional) h += '<p class="muted">This day is optional this week (two racket sessions already).</p>';
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
    saveDraft();
    render();
  }

  function abandonSession() {
    if (!confirm('Discard this session? Logged sets will be lost.')) return;
    session = null;
    S().draftSession = null;
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
    h += '<div class="ex-target">' + it.sets + ' × ' + it.repLo + (it.repHi > it.repLo ? '–' + it.repHi : '') + repUnit(ex) +
      (st.currentWeightKg ? ' @ ' + (deloadW || st.currentWeightKg) + ' ' + unit() : '') +
      (it.deload ? ' <span class="badge deload">deload</span>' : '') + '</div>';
    if (it.notes) h += '<p class="muted">' + esc(it.notes) + '</p>';
    if (it.phaseNote) h += '<p class="muted">🏋️ ' + esc(it.phaseNote) + ' — heavier, lower reps this block.</p>';
    h += '<ul class="cues">' + ex.cues.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    if (ex.video) h += '<a class="video-link" href="' + esc(ex.video) + '" target="_blank" rel="noopener">▶ Watch a form breakdown</a>';
    if (st.lastSessionSets && st.lastSessionSets.length) {
      h += '<div class="prev-line"><span class="lb">Previous</span>' +
        st.lastSessionSets.map((x) => (x.weight ? x.weight + ' ' + unit() + ' × ' : '') + x.reps).join(' · ') + '</div>';
    }
    const myNote = S().exerciseNotes[it.exerciseId];
    if (myNote) h += '<div class="my-note">📝 ' + esc(myNote) + '</div>';
    h += '<button class="btn-link note-link" onclick="LTA.ui.openNoteModal(\'' + it.exerciseId + '\')">' + (myNote ? '✎ Edit my note' : '✎ Note to self') + '</button>';

    if (logged.length) {
      h += '<div class="logged">' + logged.map((x, i) => '<span class="set-chip">S' + (i + 1) + ': ' + x.weight + '×' + x.reps + '</span>').join('') + '</div>';
    }

    if (ex.category === 'conditioning' || ex.category === 'mobility') {
      h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.logTimedItem(' + session.idx + ')">Mark done</button>';
    } else {
      h += '<div class="set-entry">';
      h += stepperHTML('weight', p.weight, ex.incrementKg || 2.5, unit());
      h += stepperHTML('reps', p.reps, ex.unit === 'seconds' ? 5 : ex.unit === 'meters' ? 10 : 1, repUnit(ex).trim());
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

  function repUnit(ex) { return ex.unit === 'seconds' ? ' s' : ex.unit === 'meters' ? ' m' : ' reps'; }

  function renderWarmup(view, tpl) {
    let h = '<div class="player">';
    h += '<div class="player-top"><button class="btn-mini" onclick="LTA.ui.abandonSession()">✕</button>' +
      '<div class="player-progress">Warmup</div><span></span></div>';
    h += '<h2 class="ex-name">Warm up first</h2>';
    h += '<p class="muted">Tailored for ' + esc(tpl.name) + ' — or run your own 15-min routine, both count.</p>';
    h += '<ul class="cues">' + tpl.warmup.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    h += '<button class="btn btn-primary btn-big" onclick="LTA.ui.warmupDone()">Warmed up — start session</button>';
    h += '</div>';
    view.innerHTML = h;
  }

  function warmupDone() {
    session.warmupDone = true;
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
    const units = ['reps', 'seconds', 'meters'];
    const gates = ['none', 'knee', 'shoulder'];
    let h = '<h3>' + (editId ? 'Edit ' + esc(ex.name) : 'New exercise') + '</h3>' +
      '<label>Name</label><input class="input" id="f-name" value="' + esc(ex ? ex.name : '') + '">' +
      '<label>Equipment</label><input class="input" id="f-equip" value="' + esc(ex ? ex.equipment : '') + '">' +
      '<label>Category</label><select class="input" id="f-cat">' + cats.map((c) => '<option' + (ex && ex.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
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
    render();
    toast(editId ? 'Saved — ' + name + ' updated.' : name + ' added to your library.');
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
    session.items.push({
      exerciseId: exId, block: 'Your picks',
      sets: 3, repLo: ex.repRange[0], repHi: ex.repRange[1],
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
      session.pending[it.exerciseId] = {
        weight: it.deload && st.currentWeightKg ? U.roundTo(st.currentWeightKg * 0.9, ex.incrementKg || 2.5) : (st.currentWeightKg || (last ? last[0].weight : 0)),
        reps: last ? last[0].reps : it.repLo,
      };
    }
    return session.pending[it.exerciseId];
  }

  function stepperHTML(field, value, step, label) {
    return '<div class="stepper"><div class="stepper-label">' + esc(label) + '</div>' +
      '<button class="step-btn" onclick="LTA.ui.step(\'' + field + '\',' + (-step) + ')">−</button>' +
      '<div class="step-val" id="step-' + field + '">' + value + '</div>' +
      '<button class="step-btn" onclick="LTA.ui.step(\'' + field + '\',' + step + ')">+</button></div>';
  }

  function step(field, delta) {
    const it = session.items[session.idx];
    const p = session.pending[it.exerciseId];
    p[field] = Math.max(0, Math.round((p[field] + delta) * 100) / 100);
    $('step-' + field).textContent = p[field];
  }

  function logSet() {
    const it = session.items[session.idx];
    const p = session.pending[it.exerciseId];
    session.sets.push({ exerciseId: it.exerciseId, weight: p.weight, reps: p.reps });
    saveDraft();
    const logged = session.sets.filter((x) => x.exerciseId === it.exerciseId).length;
    const lastSetOfLastEx = session.idx === session.items.length - 1 && logged >= it.sets;
    if (logged >= it.sets && session.idx < session.items.length - 1) {
      startRest(it.restSec, true); // auto-advance after rest
    } else if (!lastSetOfLastEx && it.restSec) {
      startRest(it.restSec, false);
    }
    render();
  }

  function logTimedItem(idx) {
    const it = session.items[idx];
    session.sets.push({ exerciseId: it.exerciseId, weight: 0, reps: it.repLo });
    if (session.idx < session.items.length - 1) session.idx++;
    saveDraft();
    render();
  }

  function moveEx(delta) {
    session.idx = Math.max(0, Math.min(session.items.length - 1, session.idx + delta));
    stopRest();
    render();
  }

  // Exercise substitution
  function openSubModal() {
    const it = session.items[session.idx];
    const ex = D.EXERCISES[it.exerciseId];
    const subs = ex.subs.filter((id) => D.EXERCISES[id]);
    if (!subs.length) { alert('No substitutions listed for ' + ex.name + '.'); return; }
    let h = '<h3>Swap ' + esc(ex.name) + '</h3>';
    subs.forEach((id, i) => {
      h += '<button class="btn btn-ghost btn-big" onclick="LTA.ui.applySub(' + i + ')">' + esc(D.EXERCISES[id].name) + '</button>';
    });
    modal(h, true);
    modalData = subs;
  }

  let modalData = null;

  function applySub(i) {
    const it = session.items[session.idx];
    it.exerciseId = modalData[i];
    closeModal();
    render();
  }

  // ---------- Rest timer ----------

  function startRest(sec, advanceAfter) {
    stopRest();
    if (!sec) return;
    rest = { remaining: sec, total: sec, advanceAfter };
    rest.timerId = setInterval(tickRest, 1000);
    renderRestBar();
  }

  function tickRest() {
    if (!rest) return;
    rest.remaining--;
    if (rest.remaining <= 0) {
      beep();
      const adv = rest.advanceAfter;
      stopRest();
      if (adv && session) { session.idx = Math.min(session.items.length - 1, session.idx + 1); }
      render();
      return;
    }
    const el = $('restTime');
    if (el) el.textContent = U.fmtSec(rest.remaining);
    const bar = $('restFill');
    if (bar) bar.style.width = (100 * rest.remaining / rest.total) + '%';
  }

  function adjustRest(d) { if (rest) { rest.remaining = Math.max(1, rest.remaining + d); tickRestPaint(); } }
  function tickRestPaint() { const el = $('restTime'); if (el) el.textContent = U.fmtSec(rest.remaining); }

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
    el.innerHTML = '<div class="rest-fill" id="restFill" style="width:100%"></div>' +
      '<div class="rest-row"><span>Rest</span><strong id="restTime">' + U.fmtSec(rest.remaining) + '</strong>' +
      '<button class="btn-mini" onclick="LTA.ui.adjustRest(-15)">−15</button>' +
      '<button class="btn-mini" onclick="LTA.ui.adjustRest(15)">+15</button>' +
      '<button class="btn-mini" onclick="LTA.ui.stopRest()">Skip</button></div>';
  }

  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = 880; g.gain.value = 0.15;
      o.start(); o.stop(audioCtx.currentTime + 0.25);
    } catch (e) { /* silent */ }
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
    session.feel = 4;
    completeSession();
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

  function completeSession() {
    stopRest();
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
      const chip = d.status === 'done' ? '✅' : d.status === 'replaced' ? '🎾' : d.status === 'skipped' ? '⏭' : (tpl.kind === 'rest' ? '🌙' : '·');
      h += '<div class="week-day' + (isToday ? ' today' : '') + '" onclick="LTA.ui.dayActions(' + i + ')">' +
        '<div class="wd-date">' + U.weekdayName(d.date) + '<span>' + d.date.slice(8) + '</span></div>' +
        '<div class="wd-name">' + esc(tpl.name) + (d.optional ? ' <span class="badge">optional</span>' : '') + '</div>' +
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
    let h = '<h3>' + U.niceDate(d.date) + '</h3><p>' + esc(tpl.name) + ' — ' + d.status + '</p>';
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
    const liftsWithData = D.MAIN_LIFTS.filter((id) => s.sessions.some((x) => (x.sets || []).some((st) => st.exerciseId === id)));
    if (!chartLift || !liftsWithData.includes(chartLift)) chartLift = liftsWithData[0] || null;

    let h = '<div class="pagehead"><h2>Progress</h2><div>' + topInfo() + '</div></div>';

    // Strength
    h += '<div class="card"><div class="card-title">Strength — estimated 1RM</div>';
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

  function drawCharts() {
    const s = S();
    // e1RM chart
    const lc = $('liftChart');
    if (lc && chartLift) {
      const pts = [];
      s.sessions.forEach((sess) => {
        let best = 0;
        (sess.sets || []).forEach((x) => { if (x.exerciseId === chartLift) best = Math.max(best, U.e1rm(x.weight, x.reps)); });
        if (best > 0) pts.push({ x: sess.date, y: Math.round(best * 10) / 10 });
      });
      drawLine(lc, [{ points: pts, color: css('--accent') }], { yLabel: unit() });
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

    h += '<div class="card"><div class="card-title">Cloud sync (Supabase)</div>' +
      '<label>Project URL</label><input class="input" id="sbUrl" placeholder="https://xxxx.supabase.co" value="' + esc(s.settings.supabaseUrl) + '">' +
      '<label>Anon key</label><input class="input" id="sbKey" type="password" placeholder="paste anon public key" value="' + esc(s.settings.supabaseKey) + '">' +
      '<button class="btn btn-primary" onclick="LTA.ui.saveSupabase()">Save & connect</button>' +
      '<p class="muted">Status: ' + esc(st.state) + (st.detail ? ' — ' + esc(st.detail) : '') + '</p>' +
      '<details><summary class="muted">One-time table setup (run in Supabase SQL editor)</summary><pre class="sql">' + esc(LTA.sync ? LTA.sync.TABLE_SQL : '') + '</pre></details></div>';

    h += '<div class="card"><div class="card-title">Exercise library</div>' +
      '<p class="muted">Create your own exercises or edit any existing one — cues, rep ranges, videos, notes.</p>' +
      '<button class="btn btn-ghost" onclick="LTA.ui.openExerciseLibrary()">Manage exercises</button></div>';

    h += '<div class="card"><div class="card-title">Data</div>' +
      '<button class="btn btn-ghost" onclick="LTA.store.exportJSON()">Export backup (JSON)</button>' +
      '<label class="btn btn-ghost file-btn">Import backup<input type="file" accept=".json" onchange="LTA.ui.importFile(this)"></label></div>';

    h += '<div class="card"><div class="card-title">Training</div>' +
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

    h += '<p class="muted center">Luke’s Training App · install: Safari share → “Add to Home Screen”</p>';
    view.innerHTML = h;
  }

  function saveSupabase() {
    const s = S();
    s.settings.supabaseUrl = $('sbUrl').value.trim();
    s.settings.supabaseKey = $('sbKey').value.trim();
    LTA.store.save(true);
    if (LTA.sync) LTA.sync.initialSync();
    toast('Saved. Connecting…');
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
    openSubModal, applySub, openChangeToday, changeToday, warmupDone,
    openAddExercise, filterExercises, addExercise,
    openExerciseLibrary, openExerciseFormFor, openExerciseForm, saveExerciseForm, deleteCustomExercise,
    openNoteModal, saveNote,
    startRest, stopRest, adjustRest,
    startRunTimer, toggleRunTimer, stopRunTimer, finishRun, confirmRunFinish,
    finishRacket, finishSimple, segPick,
    openPainModal, savePainFlag,
    openFinishModal, confirmFinish, pickFeel,
    saveCheckIn,
    dayActions, applyDaySwap, markSkipped, unskip, openRacketModal, confirmRacket,
    submitReview, pickLift,
    saveSupabase, importFile, saveTraining, resetAll,
    closeModal,
  };
})();

document.addEventListener('DOMContentLoaded', LTA.ui.init);
