/* LTA.engine — adaptation engine: week planning, double progression, deloads,
 * pain autoregulation (knee run stages, shoulder overhead ladder), racket reshuffle,
 * weekly review processing. All mutations go through LTA.store.getState() + save().
 */
window.LTA = window.LTA || {};

LTA.engine = (function () {
  'use strict';
  const U = LTA.util;
  const D = LTA.data;

  function S() { return LTA.store.getState(); }

  // ---------- Week planning ----------

  function generateWeekPlan(weekStart, isDeload) {
    const s = S();
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push({ date: U.addDays(weekStart, i), dayType: s.settings.skeleton[i] || 'rest', status: 'planned' });
    }
    const mode = (s.settings && s.settings.trainingMode) === 'surf' ? 'surf' : 'racket';
    const decisions = isDeload ? ['Deload week: 2 sets per lift at −10%, easy conditioning only.'] : [];
    if (mode === 'surf') decisions.push('Surf focus this week — pop-up, paddle and rotation work replace the racket-specific pieces.');
    return {
      weekStart, isDeload: !!isDeload, kneeCaution: false, mergedUpper: false, mode,
      days, decisions,
    };
  }

  // ---------- Weekly focus (racket / surf) ----------

  function weekMode(w) {
    const wk = w === undefined ? S().currentWeek : w;
    return wk && wk.mode === 'surf' ? 'surf' : 'racket';
  }

  // Switch the current week's focus; it also becomes the default for the weeks that follow.
  // Only what's prescribed changes — days already done keep what was logged.
  function setWeekMode(mode, quiet) {
    const s = S();
    const m = mode === 'surf' ? 'surf' : 'racket';
    s.settings.trainingMode = m;
    const w = s.currentWeek;
    if (w && w.mode !== m) {
      w.mode = m;
      if (!quiet) decide(m === 'surf'
        ? 'Switched to SURF focus — pop-up ladder, paddle endurance and rotational power replace jumps, grip and the adductor machine; Engine day becomes paddle conditioning + surf skills.'
        : 'Switched to RACKET focus — jumps, grip and court-movement work are back.');
    }
    LTA.store.save(true);
  }

  // Display name for a day type under a given mode (defaults to the current week's).
  function dayName(dayType, mode) {
    const m = mode || weekMode();
    const surf = m === 'surf' && D.SURF_DAYS[dayType];
    if (surf) return surf.name;
    return D.DAYS[dayType] ? D.DAYS[dayType].name : dayType;
  }

  function dayWarmup(dayType, mode) {
    const m = mode || weekMode();
    const surf = m === 'surf' && D.SURF_DAYS[dayType];
    if (surf && surf.warmup) return surf.warmup;
    return D.DAYS[dayType] ? D.DAYS[dayType].warmup : [];
  }

  // ---------- Pop-up ladder ----------

  function popupState() {
    const s = S();
    if (!s.popupState) s.popupState = { stageId: 0, sessionsAtStage: 0, highHipStreak: 0 };
    return s.popupState;
  }

  // The stage actually prescribed today: capped while the lower-abdominal caution is on.
  function popupStageForToday() {
    const s = S();
    const ps = popupState();
    let id = Math.max(0, Math.min(D.POPUP_STAGES.length - 1, ps.stageId));
    const capped = !!(s.abdominalState && s.abdominalState.caution) && id > D.POPUP_ABDOMINAL_CAP;
    if (capped) id = D.POPUP_ABDOMINAL_CAP;
    return { stage: D.POPUP_STAGES[id], capped, sessions: ps.sessionsAtStage, required: D.POPUP_STAGES[ps.stageId].sessionsRequired, realStageId: ps.stageId };
  }

  function setPopupStage(id) {
    const ps = popupState();
    const n = Math.max(0, Math.min(D.POPUP_STAGES.length - 1, Number(id) || 0));
    if (n === ps.stageId) return;
    ps.stageId = n; ps.sessionsAtStage = 0; ps.highHipStreak = 0;
    decide('Pop-up ladder set to stage ' + (n + 1) + ': ' + D.EXERCISES[D.POPUP_STAGES[n].exerciseId].name + '.');
    LTA.store.save(true);
  }

  const POPUP_IDS = () => D.POPUP_STAGES.map((st) => st.exerciseId);

  // Gate the ladder on front-of-hip pinch during the drill. Runs only when the session
  // actually logged sets of a ladder drill.
  function applyPopupLadder(session) {
    const s = S();
    const ids = POPUP_IDS();
    const sets = (session.sets || []).filter((x) => ids.includes(x.exerciseId));
    if (!sets.length) return;
    const hip = Number(session.popupHip || 0);
    const ps = popupState();
    const today = popupStageForToday();
    const stage = D.POPUP_STAGES[ps.stageId];
    const didCurrent = sets.some((x) => x.exerciseId === today.stage.exerciseId);
    const already = (session.painFlags || []).some((f) => f.area === 'hip' && f.severity >= hip);
    if (hip > 0 && !already) {
      const flag = { area: 'hip', label: 'Front of hip', severity: hip, when: 'during', date: session.date, context: 'popup' };
      s.painLog.push(flag);
      session.painFlags = session.painFlags || [];
      session.painFlags.push(flag);
    }
    ps.highHipStreak = hip >= 3 ? (ps.highHipStreak || 0) + 1 : 0;
    if (ps.highHipStreak === 3) decide('Front-of-hip pinch has been 3/10 or more for 3 pop-up sessions in a row — worth getting it looked at by a physio; drills alone may not fix a structural pinch.');
    if (!didCurrent) return; // did an older/other drill — logged, but doesn't move the ladder
    if (hip >= 5) {
      if (ps.stageId > 0) {
        ps.stageId--;
        decide('Hip pinch ' + hip + '/10 on pop-ups → ladder steps back to ' + D.EXERCISES[D.POPUP_STAGES[ps.stageId].exerciseId].name + '.');
      } else {
        decide('Hip pinch ' + hip + '/10 on pop-ups → staying on stage 1; keep the hip prep flow and slow reps.');
      }
      ps.sessionsAtStage = 0;
    } else if (hip >= 3) {
      ps.sessionsAtStage = 0;
      decide('Hip pinch ' + hip + '/10 on pop-ups → repeating ' + D.EXERCISES[stage.exerciseId].name + '.');
    } else if (today.capped) {
      decide('Pop-up ladder held while the lower-abdominal caution is on.');
    } else {
      ps.sessionsAtStage++;
      if (ps.sessionsAtStage >= stage.sessionsRequired && ps.stageId < D.POPUP_STAGES.length - 1) {
        ps.stageId++;
        ps.sessionsAtStage = 0;
        decide('Pop-up ladder: advanced to ' + D.EXERCISES[D.POPUP_STAGES[ps.stageId].exerciseId].name + '.');
      }
    }
  }

  // Mark every trainable day in a week as sick — used both when a brand-new week is
  // generated while illness is active, and when the roll-forward loop closes a week early.
  function applyIllnessToWeek(w) {
    w.days.forEach((d) => { if (d.dayType !== 'rest') { d.status = 'sick'; d.wasDeload = !!w.isDeload; } });
  }

  // Light week: planned, non-rest days inside the window become 'light' (excused, not skipped).
  function applyLightToWeek(w) {
    const lw = S().lightWeek;
    if (!lw || !lw.active || !w) return;
    w.days.forEach((d) => {
      if (d.dayType !== 'rest' && d.status === 'planned' && d.date >= lw.startDate && d.date <= lw.endDate) d.status = 'light';
    });
  }

  // The 4 gym/strength sessions the deload cadence cares about (excludes run/z2/racket/custom).
  const GYM_DAY_TYPES = ['upperA', 'upperB', 'lowerA', 'lowerB'];
  function completedGymDays(week) {
    return week.days.filter((d) => GYM_DAY_TYPES.includes(d.dayType) && d.status === 'done').length;
  }

  // ---------- Deload cadence ----------
  // A deload is due after this many qualifying training weeks since the last completed deload,
  // whatever triggered that deload (cycle, illness return, low-readiness review). Weeks that don't
  // qualify (illness, light week, under 3/4 gym sessions) never count, and never reset it.
  const WEEKS_BETWEEN_DELOADS = 4;

  // Weeks closed before the gate existed have no flag; those counted unless wiped out.
  function weekCounted(w) {
    if (w.countedTowardCadence !== undefined) return !!w.countedTowardCadence;
    const trainable = w.days.filter((d) => d.dayType !== 'rest');
    return !trainable.length || !trainable.every((d) => d.status === 'sick' || d.status === 'light');
  }

  function weeksSinceDeload() {
    const hist = S().weekHistory || [];
    let n = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      const w = hist[i];
      if (!weekCounted(w)) continue;
      if (w.isDeload) break;
      n++;
    }
    return n;
  }

  function deloadDue() { return weeksSinceDeload() >= WEEKS_BETWEEN_DELOADS; }

  // Create/roll the current week so it always contains today.
  function ensureWeek() {
    const s = S();
    const monday = U.mondayOf(U.todayStr());
    if (!s.currentWeek) {
      s.currentWeek = generateWeekPlan(monday, deloadDue());
      if (s.currentWeek.isDeload) s.currentWeek.deloadReason = 'cycle';
      if (s.illness && s.illness.active) applyIllnessToWeek(s.currentWeek);
      applyLightToWeek(s.currentWeek);
      LTA.store.save();
      return;
    }
    let changed = false;
    while (s.currentWeek.weekStart < monday) {
      const sick = !!(s.illness && s.illness.active);
      applyLightToWeek(s.currentWeek);
      // Mark unfinished planned days of the closing week as skipped — or, while unwell, as sick
      // (excused, not lost) so a program pause doesn't just silently eat the days.
      s.currentWeek.days.forEach((d) => {
        if (d.status === 'planned' && d.dayType !== 'rest') {
          if (sick) { d.status = 'sick'; d.wasDeload = !!s.currentWeek.isDeload; } else d.status = 'skipped';
        }
      });
      const closing = s.currentWeek;
      s.weekHistory.push(closing);
      // A week needs at least 3 of its 4 gym sessions done (and not be an illness or light
      // week) to count — both toward the Week N total and toward the next deload.
      const gymDone = completedGymDays(closing);
      const hadLight = closing.days.some((d) => d.status === 'light');
      const metCadence = !sick && !hadLight && gymDone >= 3;
      closing.countedTowardCadence = metCadence;
      if (metCadence) {
        s.weekCounter++;
      } else if (hadLight) {
        decide('Light week — this week does not count toward the deload cycle.');
      } else if (!sick) {
        decide('Only ' + gymDone + '/4 gym sessions completed this week — does not count toward the deload cycle.');
      }
      const nextStart = U.addDays(closing.weekStart, 7);
      // A deload week that didn't count (light week, or too few gym sessions) is still owed:
      // carry it into the next week whatever triggered it (cycle, review or illness resume).
      // Illness is excluded — sick days already carry their deload via resumeFromIllness.
      const owedDeload = closing.isDeload && !metCadence && !sick;
      const cycleDeload = !owedDeload && deloadDue();
      s.currentWeek = generateWeekPlan(nextStart, owedDeload || cycleDeload);
      if (owedDeload) s.currentWeek.deloadReason = closing.deloadReason || 'cycle';
      else if (cycleDeload) s.currentWeek.deloadReason = 'cycle';
      if (owedDeload) s.currentWeek.decisions.push('Deload carried over — last week ' + (hadLight ? 'was a light week' : 'had too few gym sessions to count') + ', so this week is the deload.');
      if (sick) applyIllnessToWeek(s.currentWeek);
      applyLightToWeek(s.currentWeek);
      // Block periodisation: coming off a deload, alternate Build ↔ Strength emphasis.
      if (closing.isDeload && !s.currentWeek.isDeload) {
        s.phase = s.phase === 'strength' ? 'build' : 'strength';
        s.currentWeek.decisions.push(s.phase === 'strength'
          ? 'New block: STRENGTH phase — main lifts drop to low reps (heavier), everything else stays.'
          : 'New block: BUILD phase — main lifts back to moderate reps for muscle.');
      }
      changed = true;
    }
    // Light week expires once its last day has passed.
    const lw = s.lightWeek;
    if (lw && lw.active && U.todayStr() > lw.endDate) {
      s.lightHistory = (s.lightHistory || []).concat([{ startDate: lw.startDate, endDate: lw.endDate, endedAt: U.todayStr() }]);
      s.lightWeek = { active: false, startDate: null, endDate: null, checkIns: {}, done: {} };
      changed = true;
    }
    if (changed) LTA.store.save();
  }

  // ---------- Light week ----------

  function startLightWeek() {
    const s = S();
    if (s.lightWeek && s.lightWeek.active) return false;
    const today = U.todayStr();
    if (s.illness && s.illness.active) {
      // Easing back in replaces the plain illness resume: no catch-up carry-over.
      s.illness = { active: false, startDate: null, reportedAt: null };
      decide('Ended the illness pause to ease back in with a light week (no missed sessions carried over).');
    }
    // Contained in the calendar week (Mon–Sun) like every other week, so it never spills
    // into the next week and disqualifies that one too.
    s.lightWeek = { active: true, startDate: today, endDate: U.addDays(U.mondayOf(today), 6), checkIns: {}, done: {} };
    applyLightToWeek(s.currentWeek);
    decide('Light week started (to Sunday) — the regular plan is on hold, this week does not count toward the cycle, and a deload due this week moves to next week.');
    LTA.store.save(true);
    return true;
  }

  function endLightWeek() {
    const s = S();
    const lw = s.lightWeek;
    if (!lw || !lw.active) return;
    const today = U.todayStr();
    const weeks = (s.weekHistory || []).concat(s.currentWeek ? [s.currentWeek] : []);
    // Give back today and later days, unless a light session was already logged today.
    weeks.forEach((w) => w.days.forEach((d) => {
      if (d.status === 'light' && d.date >= today && !(d.date === today && lw.done[today])) d.status = 'planned';
    }));
    s.lightHistory = (s.lightHistory || []).concat([{ startDate: lw.startDate, endDate: lw.endDate, endedAt: today }]);
    s.lightWeek = { active: false, startDate: null, endDate: null, checkIns: {}, done: {} };
    decide('Light week ended early — back to the regular plan.');
    LTA.store.save(true);
  }

  function lightDayIndex() {
    const lw = S().lightWeek;
    if (!lw || !lw.active) return -1;
    return Math.min(6, Math.max(0, U.daysBetween(lw.startDate, U.todayStr())));
  }

  // Days in the active light week (1–7: from its start day to Sunday).
  function lightWeekLength() {
    const lw = S().lightWeek;
    if (!lw || !lw.active) return 0;
    return Math.min(7, U.daysBetween(lw.startDate, lw.endDate) + 1);
  }

  function setLightCheckIn(date, v) {
    const lw = S().lightWeek;
    if (!lw || !lw.active) return;
    lw.checkIns[date] = v;
    LTA.store.save(true);
  }

  // Light sessions are logged directly: no sets, so progression/run/shoulder state is never touched.
  function logLightSession(data) {
    const s = S();
    const lw = s.lightWeek;
    if (!lw || !lw.active) return null;
    const idx = lightDayIndex();
    const plan = D.LIGHT_PLAN[idx];
    const sess = {
      id: U.uid(), date: U.todayStr(), dayType: 'light', light: true, lightDay: idx + 1,
      lightTitle: 'Light week · ' + plan.title, sets: [], painFlags: [],
      feel: data.feel, symptoms: data.symptoms,
    };
    if (data.durationMin) sess.durationMin = data.durationMin;
    if (data.notes) sess.notes = data.notes;
    s.sessions.push(sess);
    lw.done[sess.date] = sess.id;
    LTA.store.save(true);
    return sess;
  }

  // ---------- Illness pause ----------

  // Report illness from startDate onward (may be retroactive). Marks every not-yet-done,
  // non-rest day from startDate through whatever already exists (past days plus the rest of
  // the current week) as 'sick'. Never touches a day already logged as 'done'.
  function reportIllness(startDate) {
    const s = S();
    const today = U.todayStr();
    if (!startDate || startDate > today) return null;
    const existingStart = (s.illness && s.illness.active) ? s.illness.startDate : null;
    const effectiveStart = (existingStart && existingStart < startDate) ? existingStart : startDate;

    let count = 0;
    const touchedWeeks = [];
    const weeks = s.weekHistory.concat(s.currentWeek ? [s.currentWeek] : []);
    weeks.forEach((w) => {
      let touched = false;
      w.days.forEach((d) => {
        if (d.date >= effectiveStart && d.status !== 'done' && d.dayType !== 'rest') {
          if (d.status !== 'sick') { count++; touched = true; }
          d.status = 'sick';
          d.wasDeload = !!w.isDeload;
        }
      });
      if (touched) touchedWeeks.push(w);
    });

    // Retroactive macro-rhythm correction: an already-closed week this call just fully wiped
    // out (no session was ever logged in it) may have already advanced weekCounter when it
    // closed — undo that so the deload cycle reflects weeks he actually trained in, not
    // calendar weeks. Only undo it if the week actually counted (it may not have, e.g. it
    // fell short of the gym-session threshold even before illness wiped it further).
    let voided = 0;
    touchedWeeks.forEach((w) => {
      if (w === s.currentWeek) return; // not yet closed — nothing to correct
      const trainable = w.days.filter((d) => d.dayType !== 'rest');
      const fullyWiped = trainable.length && trainable.every((d) => d.status === 'sick');
      if (fullyWiped && w.countedTowardCadence) { s.weekCounter = Math.max(1, s.weekCounter - 1); w.countedTowardCadence = false; voided++; }
    });
    // Only a cycle deload depends on the count; carried, illness and review deloads stand.
    const cur = s.currentWeek;
    if (voided && cur && (!cur.isDeload || cur.deloadReason === 'cycle' || !cur.deloadReason)) {
      cur.isDeload = deloadDue();
      cur.deloadReason = cur.isDeload ? 'cycle' : undefined;
    }

    s.illness = { active: true, startDate: effectiveStart, reportedAt: today };
    decide('Marked unwell from ' + U.niceDate(effectiveStart) + ' — training paused until you resume.');
    LTA.store.save(true);
    return count;
  }

  // Resume training: carry every genuinely-missed session (already-archived 'sick' days) into
  // this week's still-open slots, in order, ahead of the week's own remaining sessions. Anything
  // that doesn't fit is dropped. If any carried session came from a deload week, the whole
  // resume week runs at deload intensity.
  function resumeFromIllness() {
    const s = S();
    if (!s.illness || !s.illness.active) return null;
    const w = s.currentWeek;

    const carriedOver = [];
    s.weekHistory.forEach((hw) => {
      hw.days.forEach((d) => { if (d.status === 'sick' && d.dayType !== 'rest') carriedOver.push(d); });
    });
    carriedOver.sort((a, b) => (a.date < b.date ? -1 : 1));

    const openSlots = w.days
      .filter((d) => d.status !== 'done' && d.dayType !== 'rest')
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const queue = carriedOver.map((d) => d.dayType).concat(openSlots.map((d) => d.dayType));
    const anyDeload = carriedOver.some((d) => d.wasDeload);
    openSlots.forEach((slot, i) => {
      if (i < queue.length) { slot.dayType = queue[i]; slot.status = 'planned'; delete slot.wasDeload; }
    });
    const carried = Math.min(carriedOver.length, openSlots.length);
    const dropped = Math.max(0, queue.length - openSlots.length);
    if (anyDeload && !w.isDeload) { w.isDeload = true; w.deloadReason = 'illness'; }

    s.illness = { active: false, startDate: null, reportedAt: null };
    decide('Welcome back — ' + carried + ' missed session' + (carried === 1 ? '' : 's') + ' carried into this week.' +
      (dropped ? ' ' + dropped + (dropped === 1 ? " couldn't fit and was dropped." : " couldn't fit and were dropped.") : ''));
    LTA.store.save(true);
    return { carried: carried, dropped: dropped };
  }

  // Merge user-created exercises and edits into the static library.
  // Call after load, import, and any library edit.
  function applyUserExercises() {
    const s = S();
    Object.keys(s.customExercises || {}).forEach((id) => {
      s.customExercises[id].id = id;
      D.EXERCISES[id] = Object.assign({ category: 'accessory', equipment: '', repRange: [8, 12], incrementKg: 2.5, cues: [], subs: [], unit: 'reps' }, D.EXERCISES[id], s.customExercises[id]);
    });
    Object.keys(s.exerciseEdits || {}).forEach((id) => {
      if (D.EXERCISES[id]) Object.assign(D.EXERCISES[id], s.exerciseEdits[id]);
    });
  }

  function dayForDate(dateStr) {
    const w = S().currentWeek;
    return w ? w.days.find((d) => d.date === dateStr) : null;
  }

  function sessionsForDate(dateStr) {
    return S().sessions.filter((sess) => sess.date === dateStr);
  }

  function decide(msg) {
    const w = S().currentWeek;
    if (w) w.decisions.push(msg);
  }

  // ---------- Prescriptions ----------

  // Resolve the day template into concrete prescriptions for the current state
  // (overhead rung, deload, merged upper, extra rehab volume).
  function prescriptionsForDay(dayType, modeOverride) {
    const s = S();
    const w = s.currentWeek;
    const tpl = D.DAYS[dayType];
    if (!tpl) return null;
    const mode = modeOverride || weekMode(w);
    const surfTpl = mode === 'surf' ? D.SURF_DAYS[dayType] : null;
    const blocks = JSON.parse(JSON.stringify(surfTpl ? surfTpl.blocks : tpl.blocks));

    // Pop-up ladder placeholder → today's stage (capped under the lower-abdominal caution).
    blocks.forEach((b) => b.items.forEach((it) => {
      if (!it.popupLadder) return;
      const t = popupStageForToday();
      it.exerciseId = t.stage.exerciseId;
      it.popupStageId = t.stage.id;
      if (t.capped) it.notes = 'Lower-abdominal caution: step-through pop-ups only, ladder on hold';
    }));

    if (dayType === 'upperB' || (dayType === 'upperA' && w && w.mergedUpper)) {
      const rung = D.OVERHEAD_RUNGS[s.shoulderState.rungId];
      const ladderItem = { exerciseId: rung.exerciseId, sets: 3, repLo: 8, repHi: 12, restSec: 120, progression: 'double', main: true, strengthRange: [5, 8] };
      if (dayType === 'upperB') {
        blocks[0].items = [ladderItem];
        if (rung.addOn) blocks[0].items.push({ exerciseId: rung.addOn, sets: 3, repLo: 8, repHi: 10, restSec: 75, progression: 'double' });
      } else {
        // Merged week: Upper A absorbs the overhead slot + pulldown, drops arm isolation.
        blocks.splice(1, 0, { title: 'From Upper B (merged)', items: [ladderItem, { exerciseId: 'lat_pulldown', sets: 3, repLo: 6, repHi: 10, restSec: 120, progression: 'double' }] });
        blocks.forEach((b) => { b.items = b.items.filter((it) => it.exerciseId !== 'db_curl' && it.exerciseId !== 'triceps_pressdown'); });
      }
    }

    // Strength phase: main lifts shift to their low-rep range with a little more rest.
    if (s.phase === 'strength') {
      blocks.forEach((b) => b.items.forEach((it) => {
        if (it.main && it.strengthRange) {
          it.repLo = it.strengthRange[0];
          it.repHi = it.strengthRange[1];
          it.restSec = (it.restSec || 120) + 60; // heavier work earns longer rest (3–5 min territory)
          it.phaseNote = 'Strength phase';
        }
      }));
    }

    if (s.shoulderState.extraRehabVolume) {
      blocks.forEach((b) => b.items.forEach((it) => {
        const e = D.EXERCISES[it.exerciseId];
        if (e && e.category === 'rehab' && e.painGate === 'shoulder') it.sets = Math.max(it.sets, 4);
      }));
    }

    if (w && w.isDeload) {
      blocks.forEach((b) => b.items.forEach((it) => {
        const e = D.EXERCISES[it.exerciseId];
        if (e && (e.category === 'strength' || e.category === 'accessory')) {
          it.sets = Math.min(it.sets, 2);
          it.deload = true; // UI renders load at −10%
        }
      }));
    }

    // Standing swaps ("from now on") replace the prescribed exercise wherever it appears.
    const subs = s.substitutions || {};
    blocks.forEach((b) => b.items.forEach((it) => {
      const to = subs[it.exerciseId];
      if (to && D.EXERCISES[to]) { it.swappedFrom = it.exerciseId; it.exerciseId = to; }
    }));

    if (w && w.kneeCaution && dayType === 'z2' && mode !== 'surf') {
      blocks[0].items.forEach((it) => { it.notes = 'Bike only this week (knee caution)'; });
    }

    // Lower-abdominal caution: gated exercises are replaced by a gentler option. Progression
    // state of the original is untouched (it simply holds until the caution clears).
    if (s.abdominalState && s.abdominalState.caution) {
      blocks.forEach((b) => b.items.forEach((it) => {
        const e = D.EXERCISES[it.exerciseId];
        const to = e && e.abdominalSub;
        if (to && D.EXERCISES[to]) {
          it.swappedFrom = it.swappedFrom || it.exerciseId;
          it.exerciseId = to;
          it.notes = 'Lower-abdominal caution: gentler option';
        }
      }));
    }
    return blocks;
  }

  // What the run slot should be today, given regressions/deload.
  function runSpec() {
    const s = S();
    const w = s.currentWeek;
    if (s.runState.pendingRegression) {
      return { mode: 'bike', stage: null, protocol: D.EXERCISES.hiit_spin.cues.join(' · '), cues: ['Knee is settling — HIIT spin replaces this run (zero impact, same engine work).'] };
    }
    const stage = D.RUN_STAGES[s.runState.stageId];
    const halfVolume = w && w.isDeload;
    return {
      mode: 'run', stage,
      protocol: stage.protocol + (halfVolume ? ' — HALF volume (deload)' : ''),
      intervals: halfVolume ? stage.intervals.slice(0, Math.max(1, Math.ceil(stage.intervals.length / 2))) : stage.intervals,
      cues: D.RUN_CUES,
      completions: s.runState.completionsAtStage, required: stage.completionsRequired,
    };
  }

  function sprintSpec() {
    const s = S();
    if (!s.runState.sprintUnlocked) return null;
    const st = D.SPRINT_STAGES[Math.min(s.runState.sprintStageId, D.SPRINT_STAGES.length - 1)];
    return { stage: st, sessions: s.runState.sprintSessions };
  }

  // ---------- Double progression ----------

  function progressExercise(exId, loggedSets, presc) {
    const s = S();
    const ex = D.EXERCISES[exId];
    if (!ex || !loggedSets.length) return;
    const st = LTA.store.exerciseState(exId);
    const prevSets = st.lastSessionSets;
    const topWeight = Math.max(...loggedSets.map((x) => x.weight));
    const totalReps = loggedSets.reduce((a, x) => a + x.reps, 0);

    const record = () => { st.lastSessionSets = loggedSets.map((x) => ({ weight: x.weight, reps: x.reps })); };

    if (!presc || presc.progression !== 'double' || !ex.incrementKg) { record(); return; }
    if (st.calibrating || st.justCalibrated) { delete st.justCalibrated; record(); return; } // calibration sets the baseline, not progression
    if (S().currentWeek && S().currentWeek.isDeload) { record(); return; } // deload sessions don't drive progression

    // First ever exposure adopts whatever you used as the baseline. Keyed off history, not the
    // weight itself — 0 is a legitimate working load (bodyweight) and must still progress.
    if (!prevSets) { st.currentWeightKg = topWeight; record(); return; }

    const allSetsAtTop = loggedSets.length >= presc.sets && loggedSets.every((x) => x.reps >= presc.repHi && x.weight >= st.currentWeightKg);
    if (allSetsAtTop) {
      st.currentWeightKg = Math.round((topWeight + ex.incrementKg) * 100) / 100;
      st.stallCount = 0;
      decide(ex.name + ' → ' + st.currentWeightKg + ' kg (topped the rep range).');
    } else {
      const prevTotal = prevSets ? prevSets.reduce((a, x) => a + x.reps, 0) : 0;
      const prevTop = prevSets ? Math.max(...prevSets.map((x) => x.weight)) : 0;
      if (topWeight > prevTop || totalReps > prevTotal) {
        st.stallCount = 0;
      } else {
        st.stallCount++;
        if (st.stallCount >= 3) {
          st.currentWeightKg = Math.round(st.currentWeightKg * 0.9 * 100) / 100;
          st.stallCount = 0;
          decide(ex.name + ' stalled 3 sessions → reset to ' + st.currentWeightKg + ' kg to rebuild.');
        }
      }
    }
    record();
  }

  // ---------- Session end ----------

  function applySessionEnd(session) {
    const s = S();
    if (!session.mode) session.mode = weekMode();
    s.sessions.push(session);
    (session.painFlags || []).forEach((f) => s.painLog.push(f));

    const day = dayForDate(session.date);
    if (day && day.status === 'planned') day.status = 'done';

    // Progression per exercise (strength-type days).
    const blocks = prescriptionsForDay(session.dayType, session.mode);
    if (blocks && session.sets && session.sets.length) {
      const byEx = {};
      session.sets.forEach((x) => { (byEx[x.exerciseId] = byEx[x.exerciseId] || []).push(x); });
      const prescByEx = {};
      blocks.forEach((b) => b.items.forEach((it) => { prescByEx[it.exerciseId] = it; }));
      Object.keys(byEx).forEach((exId) => {
        // Freestyle picks and mid-session additions have no template prescription —
        // synthesize one from the exercise's own rep range so progression still applies.
        let presc = prescByEx[exId];
        if (!presc) {
          const ex = D.EXERCISES[exId];
          if (ex) presc = { exerciseId: exId, sets: 3, repLo: ex.repRange[0], repHi: ex.repRange[1], progression: ex.incrementKg ? 'double' : 'rehab' };
        }
        progressExercise(exId, byEx[exId], presc);
      });
    }

    // Immediate shoulder rule: pain >=3 during overhead work drops the rung now.
    const shoulderDuring = maxFlag(session.painFlags, 'shoulder', 'during');
    const overheadIds = D.OVERHEAD_RUNGS.map((r) => r.exerciseId);
    const didOverhead = (session.sets || []).some((x) => overheadIds.includes(x.exerciseId));
    if (didOverhead) {
      if (shoulderDuring >= 3) {
        dropRung('Shoulder pain ' + shoulderDuring + '/10 during pressing');
      } else {
        queueCheckIn(session.date, 'shoulder', 'overhead', shoulderDuring);
      }
    }

    // Run day: completion is provisional until the next-morning knee check.
    if (session.dayType === 'run' && session.runMode === 'run') {
      s.runState.lastRunDate = session.date;
      const kneeDuring = maxFlag(session.painFlags, 'knee', 'during');
      if (session.runCompleted) queueCheckIn(session.date, 'knee', 'run', kneeDuring);
      if (kneeDuring >= 3) s.currentWeek.kneeCaution = true;
    }
    if (session.dayType === 'run' && session.runMode === 'bike') {
      // A completed bike-replacement clears the regression for the next run slot.
      s.runState.pendingRegression = false;
    }

    // Baseline-walk stage can also be satisfied outside the run slot — logged as its own
    // exercise on a freestyle/engine day. Route it through the same next-morning knee
    // check as a real run so it still advances the stage.
    if (s.runState.stageId === 0 && !(session.dayType === 'run' && session.runMode === 'run')) {
      const walked = (session.sets || []).some((x) => x.exerciseId === 'incline_walk');
      if (walked) {
        s.runState.lastRunDate = session.date;
        const kneeDuring = maxFlag(session.painFlags, 'knee', 'during');
        queueCheckIn(session.date, 'knee', 'run', kneeDuring);
      }
    }

    // Sprint work appended to a Z2 day.
    if (session.dayType === 'z2' && session.didSprints && s.runState.sprintUnlocked) {
      s.runState.sprintSessions++;
      const st = D.SPRINT_STAGES[Math.min(s.runState.sprintStageId, D.SPRINT_STAGES.length - 1)];
      if (s.runState.sprintSessions >= st.sessionsRequired && s.runState.sprintStageId < D.SPRINT_STAGES.length - 1) {
        s.runState.sprintStageId++;
        s.runState.sprintSessions = 0;
        decide('Sprint work advances to: ' + D.SPRINT_STAGES[s.runState.sprintStageId].name + '.');
      }
    }

    // Pop-up ladder (surf skills), gated on front-of-hip pinch.
    applyPopupLadder(session);

    // Paddle conditioning (surf Engine day): the paddling shoulder gets the same check as play.
    const paddled = (session.sets || []).some((x) => D.PADDLE_OPTIONS.includes(x.exerciseId));
    if (paddled) {
      const shPaddle = maxFlag(session.painFlags, 'shoulder', 'during');
      if (shPaddle >= 3) dropRung('Shoulder pain ' + shPaddle + '/10 while paddling');
      else queueCheckIn(session.date, 'shoulder', 'paddle', shPaddle);
    }

    // Racket play: check the serving shoulder tomorrow.
    if (session.dayType === 'racket') {
      const shoulderRacket = maxFlag(session.painFlags, 'shoulder', 'during');
      if (shoulderRacket >= 3) {
        dropRung('Shoulder pain ' + shoulderRacket + '/10 while playing — ease off overhead volume this week');
      } else if (!session.shoulderNotAsked) {
        // A surf log where the shoulder card was never opened gets no morning shoulder question.
        queueCheckIn(session.date, 'shoulder', 'racket', shoulderRacket, null, session.sport);
      }
    }

    // Lower abdominal (any session type): >=3 during switches the gentler options on now;
    // anything milder is checked again tomorrow morning.
    const abdFlags = (session.painFlags || []).filter((f) => f.area === 'abdominal');
    if (abdFlags.length) {
      const abdDuring = maxFlag(session.painFlags, 'abdominal', 'during');
      const abdLater = maxFlag(session.painFlags, 'abdominal', 'later');
      const worst = Math.max(abdDuring, abdLater);
      const worstFlag = abdFlags.slice().sort((a, b) => b.severity - a.severity)[0];
      const side = worstFlag.side || null;
      if (worst >= 3) {
        setAbdominalCaution(true, side, session.date, 'Lower abdominal ' + worst + '/10' + sideLabel(side) + ' during ' + (session.sport === 'Surf' ? 'surfing' : session.dayType === 'racket' ? 'play' : 'training'));
      } else if (worst > 0) {
        queueCheckIn(session.date, 'abdominal', abdContext(session), worst, side, session.sport);
      }
    }

    LTA.store.save(true);
  }

  function sideLabel(side) { return side ? ' (' + side + ')' : ''; }
  function abdContext(session) { return session.dayType === 'racket' ? 'racket' : 'training'; }

  function setAbdominalCaution(on, side, date, reason, quiet) {
    const s = S();
    if (!s.abdominalState) s.abdominalState = { caution: false, side: null, since: null };
    const a = s.abdominalState;
    if (on) {
      if (!a.caution && !quiet) decide(reason + ' → dead bug, jumps and rotational throws swap to gentler options until it settles.');
      a.caution = true;
      a.side = side || a.side || null;
      a.since = a.since || date || U.todayStr();
    } else if (a.caution) {
      if (!quiet) decide(reason + ' → lower-abdominal caution cleared, normal exercises are back.');
      a.caution = false; a.side = null; a.since = null;
    }
  }

  function maxFlag(flags, area, when) {
    let m = 0;
    (flags || []).forEach((f) => { if (f.area === area && (!when || f.when === when)) m = Math.max(m, f.severity); });
    return m;
  }

  // Pain that shows up after a racket session has already been logged — rest of the day,
  // or the next day. `entries` is [{area, severity, durations}]; zero-severity entries are dropped.
  function addRacketFollowUp(sessionId, entries) {
    const s = S();
    const sess = s.sessions.find((x) => x.id === sessionId);
    const date = sess ? sess.date : U.todayStr();
    (entries || []).forEach((e) => {
      if (!e.severity) return;
      const flag = { area: e.area, label: e.label, severity: e.severity, when: 'later', date, context: 'racket', durations: e.durations || [] };
      if (e.side) flag.side = e.side;
      s.painLog.push(flag);
      if (sess) { sess.painFlags = sess.painFlags || []; sess.painFlags.push(flag); }
      if (e.area === 'shoulder' && e.severity >= 3) dropRung('Shoulder pain ' + e.severity + '/10 after playing');
      if (e.area === 'knee' && e.severity >= 3) s.currentWeek.kneeCaution = true;
      if (e.area === 'abdominal' && e.severity >= 3) setAbdominalCaution(true, e.side, date, 'Lower abdominal ' + e.severity + '/10' + sideLabel(e.side) + ' after playing');
    });
    LTA.store.save(true);
  }

  // ---------- Morning check-ins ----------

  function queueCheckIn(date, area, context, painDuring, side, sport) {
    const s = S();
    if (s.pendingCheckIns.some((c) => c.date === date && c.area === area && c.context === context)) return;
    const ci = { date, area, context, painDuring: painDuring || 0 };
    if (side) ci.side = side;
    if (sport) ci.sport = sport;
    s.pendingCheckIns.push(ci);
  }

  function dueCheckIns() {
    const today = U.todayStr();
    return S().pendingCheckIns.filter((c) => c.date < today);
  }

  function resolveCheckIn(ci, severity) {
    const s = S();
    s.pendingCheckIns = s.pendingCheckIns.filter((c) => !(c.date === ci.date && c.area === ci.area && c.context === ci.context));
    const logged = { area: ci.area, severity, when: 'nextMorning', date: U.todayStr(), context: ci.context };
    if (ci.side) logged.side = ci.side;
    s.painLog.push(logged);

    if (ci.area === 'abdominal') {
      // The morning answer decides: in-session pain already switched the caution on, so a settled
      // morning (<=2) is what clears it again.
      if (severity >= 3) setAbdominalCaution(true, ci.side, U.todayStr(), 'Lower abdominal ' + severity + '/10' + sideLabel(ci.side) + ' the morning after');
      else setAbdominalCaution(false, null, null, 'Lower abdominal ' + severity + '/10 this morning');
    }

    if (ci.area === 'knee' && ci.context === 'run') {
      const worst = Math.max(ci.painDuring || 0, severity);
      const rs = s.runState;
      const stage = D.RUN_STAGES[rs.stageId];
      if (worst <= 2) {
        rs.completionsAtStage++;
        if (rs.completionsAtStage >= stage.completionsRequired && rs.stageId < D.RUN_STAGES.length - 1) {
          rs.stageId++;
          rs.completionsAtStage = 0;
          decide('Run progression: advanced to ' + D.RUN_STAGES[rs.stageId].name + ' (' + D.RUN_STAGES[rs.stageId].protocol + ').');
          if (rs.stageId > 7 && !rs.sprintUnlocked) {
            rs.sprintUnlocked = true;
            decide('20 min continuous running pain-free → sprint work unlocked (Saturday slot).');
          }
        }
      } else if (worst <= 4) {
        rs.completionsAtStage = 0;
        decide('Knee ' + worst + '/10 after the run → repeating ' + stage.name + '.');
      } else {
        rs.stageId = Math.max(0, rs.stageId - 1);
        rs.completionsAtStage = 0;
        rs.pendingRegression = true;
        decide('Knee ' + worst + '/10 → dropped back to ' + D.RUN_STAGES[rs.stageId].name + '; next run slot is bike intervals.');
      }
      if (worst >= 3) s.currentWeek.kneeCaution = true;
    }

    if (ci.area === 'shoulder') {
      const sh = s.shoulderState;
      const rung = D.OVERHEAD_RUNGS[sh.rungId];
      if (ci.context === 'overhead') {
        const worst = Math.max(ci.painDuring || 0, severity);
        if (worst <= 2) {
          sh.sessionsAtRung++;
          if (sh.sessionsAtRung >= rung.sessionsRequired && sh.rungId < D.OVERHEAD_RUNGS.length - 1) {
            sh.rungId++;
            sh.sessionsAtRung = 0;
            decide('Overhead ladder: progressed to ' + D.EXERCISES[D.OVERHEAD_RUNGS[sh.rungId].exerciseId].name + '.');
          }
        } else if (worst <= 4) {
          sh.sessionsAtRung = 0;
        } else {
          dropRung('Shoulder ' + worst + '/10 the morning after pressing');
        }
      } else if ((ci.context === 'racket' || ci.context === 'paddle') && severity >= 3) {
        dropRung('Shoulder ' + severity + '/10 the morning after ' + (ci.context === 'paddle' ? 'paddling' : 'playing') + ' — reduce overhead volume');
      }
    }
    LTA.store.save(true);
  }

  function dropRung(reason) {
    const s = S();
    const sh = s.shoulderState;
    if (sh.rungId > 0) {
      sh.rungId--;
      decide(reason + ' → overhead work steps down to ' + D.EXERCISES[D.OVERHEAD_RUNGS[sh.rungId].exerciseId].name + '.');
    } else {
      decide(reason + ' → staying on ' + D.EXERCISES[D.OVERHEAD_RUNGS[0].exerciseId].name + ', extra rehab volume added.');
      sh.extraRehabVolume = true;
    }
    sh.sessionsAtRung = 0;
  }

  // ---------- Racket reshuffle ----------

  function racketCount(week) {
    return week.days.filter((d) => d.replacedBy === 'racket' || (d.status === 'done' && d.dayType === 'racket')).length;
  }

  function insertRacketSession(dateStr) {
    const s = S();
    const w = s.currentWeek;
    const day = w.days.find((d) => d.date === dateStr);
    if (!day || day.status === 'sick') return null;

    const displaced = (day.status === 'planned' && D.DAYS[day.dayType].kind === 'strength') ? day.dayType : null;
    if (day.status === 'planned' || day.status === 'skipped') {
      day.status = 'replaced';
      day.replacedBy = 'racket';
      day.originalType = day.dayType;
      day.dayType = 'racket';
    }
    const count = racketCount(w);

    // Rule 1: play covers conditioning — drop Z2 first, second session makes a run optional.
    const z2Day = w.days.find((d) => d.dayType === 'z2' && d.status === 'planned');
    if (count === 1 && z2Day) {
      z2Day.status = 'skipped';
      decide(U.weekdayName(z2Day.date) + ' ' + dayName('z2') + ' dropped — the play/surf session covered conditioning.');
    } else if (count === 2) {
      const runDay = w.days.find((d) => d.dayType === 'run' && d.status === 'planned');
      if (runDay) { runDay.optional = true; decide(U.weekdayName(runDay.date) + ' run is now optional (bike ok) — two play sessions this week.'); }
    }

    // Rule 2: relocate a displaced strength day into a remaining rest/dropped-Z2 slot.
    if (displaced) {
      const slot = w.days.find((d) => d.date > dateStr && d.status !== 'done' && d.status !== 'replaced' && (d.dayType === 'rest' || (d.dayType === 'z2' && d.status === 'skipped')));
      if (slot) {
        slot.dayType = displaced;
        slot.status = 'planned';
        decide(dayName(displaced) + ' moved to ' + U.weekdayName(slot.date) + '.');
      } else if (displaced === 'upperB' || displaced === 'upperA') {
        const other = displaced === 'upperB' ? 'upperA' : 'upperB';
        if (w.days.some((d) => d.dayType === other && d.status === 'planned')) {
          w.mergedUpper = true;
          decide('No free day left — upper sessions merged (overhead work joins the remaining upper day).');
        } else {
          decide(dayName(displaced) + ' dropped this week — resumes next week.');
        }
      } else {
        decide(dayName(displaced) + ' dropped this week — lower days are never merged; resumes next week.');
      }
    }

    // Rule 3: no heavy lower the day after play — swap with the nearest upper day.
    const next = w.days.find((d) => d.date === U.addDays(dateStr, 1));
    if (next && next.status === 'planned' && (next.dayType === 'lowerA' || next.dayType === 'lowerB')) {
      const upper = w.days.find((d) => d.date > next.date && d.status === 'planned' && (d.dayType === 'upperA' || d.dayType === 'upperB'));
      if (upper) {
        const t = next.dayType; next.dayType = upper.dayType; upper.dayType = t;
        decide('Swapped ' + U.weekdayName(next.date) + ' and ' + U.weekdayName(upper.date) + ' — no heavy legs the day after play.');
      }
    }

    // Rule 4: 3+ sessions of play — strip the week to the essentials.
    if (count >= 3) {
      const keep = { lowerA: 1, upperA: 1, run: 1 };
      w.mergedUpper = true;
      w.days.forEach((d) => {
        if (d.status !== 'planned') return;
        if (keep[d.dayType] > 0) { keep[d.dayType]--; return; }
        if (d.dayType !== 'rest') { d.status = 'skipped'; }
      });
      decide('Three play sessions this week — trimmed to Lower A, one merged Upper, one run.');
    }

    LTA.store.save(true);
    return w.decisions.slice(-4);
  }

  // ---------- Choose-your-day ----------

  // Do `takeType` on `dateStr` instead of what was scheduled; the week rearranges.
  // If another planned day already holds takeType, the two days trade places.
  // Otherwise the displaced session relocates to a free rest/conditioning slot, or drops.
  function doDayInstead(dateStr, takeType) {
    const s = S();
    const w = s.currentWeek;
    const day = w.days.find((d) => d.date === dateStr);
    if (!day || day.dayType === takeType) return null;
    if (day.status === 'done') return null; // already completed — nothing to reschedule
    if (day.status === 'sick') return null; // marked unwell — resume training to reschedule
    if (takeType === 'racket') return insertRacketSession(dateStr);

    const displaced = day.status === 'planned' ? day.dayType : null;
    const donor = w.days.find((d) => d !== day && d.status === 'planned' && d.dayType === takeType);
    day.dayType = takeType;
    day.status = 'planned';
    day.optional = false;

    if (donor && displaced) {
      donor.dayType = displaced;
      decide(dayName(takeType) + ' pulled to ' + U.weekdayName(day.date) + '; ' + dayName(displaced) + ' takes ' + U.weekdayName(donor.date) + '.');
      // Don't leave two heavy lower days back-to-back after the trade.
      const isLower = (t) => t === 'lowerA' || t === 'lowerB';
      w.days.forEach((d, i) => {
        const next = w.days[i + 1];
        if (next && isLower(d.dayType) && isLower(next.dayType) && d.status === 'planned' && next.status === 'planned') {
          const upper = w.days.find((x) => x.status === 'planned' && x.date > next.date && (x.dayType === 'upperA' || x.dayType === 'upperB'));
          if (upper) {
            const t = next.dayType; next.dayType = upper.dayType; upper.dayType = t;
            decide('Also swapped ' + U.weekdayName(next.date) + ' and ' + U.weekdayName(upper.date) + ' — two heavy lower days in a row is a recovery hole.');
          }
        }
      });
    } else if (donor && !displaced) {
      donor.dayType = 'rest';
      decide(dayName(takeType) + ' pulled to ' + U.weekdayName(day.date) + '; ' + U.weekdayName(donor.date) + ' becomes recovery.');
    } else if (displaced && D.DAYS[displaced].kind === 'strength') {
      const slot = w.days.find((d) => d !== day && d.status === 'planned' && (d.dayType === 'rest' || d.dayType === 'z2'));
      if (slot) {
        slot.dayType = displaced;
        decide(dayName(displaced) + ' moved to ' + U.weekdayName(slot.date) + '.');
      } else {
        decide(dayName(displaced) + ' dropped this week — no free day left.');
      }
    } else if (displaced) {
      decide(dayName(displaced) + ' skipped in favour of ' + dayName(takeType) + '.');
    } else {
      decide(dayName(takeType) + ' added on ' + U.weekdayName(day.date) + '.');
    }

    LTA.store.save(true);
    return w.decisions.slice(-3);
  }

  // ---------- Weekly review ----------

  function reviewDue() {
    const s = S();
    if (!s.weekHistory.length) return null;
    const last = s.weekHistory[s.weekHistory.length - 1];
    if (s.reviews.some((r) => r.weekStart === last.weekStart)) return null;
    // Only prompt for the most recently finished week.
    if (U.daysBetween(last.weekStart, U.todayStr()) > 14) return null;
    // A fully-sick week has nothing meaningful to review.
    if (!last.days.some((d) => d.dayType !== 'rest' && d.status !== 'sick' && d.status !== 'light')) return null;
    return last;
  }

  function adherenceOf(week) {
    const planned = week.days.filter((d) => (d.dayType !== 'rest' && d.status !== 'sick' && d.status !== 'light') || d.status === 'replaced');
    const done = planned.filter((d) => d.status === 'done' || d.status === 'replaced');
    return planned.length ? done.length / planned.length : 1;
  }

  function processReview(weekStart, answers) {
    const s = S();
    const week = s.weekHistory.find((w) => w.weekStart === weekStart) || s.currentWeek;
    const decisions = [];
    const adherence = adherenceOf(week);
    const readiness = answers.sleep + answers.energy + (6 - answers.soreness);

    // Weekly focus picked in the review applies to the week being built.
    if (answers.mode && answers.mode !== weekMode()) {
      setWeekMode(answers.mode, true);
      decisions.push(answers.mode === 'surf' ? 'Surf focus this week — pop-up ladder, paddle endurance and rotational power.' : 'Racket focus this week — jumps, grip and court movement.');
    }

    // Readiness-triggered deload.
    const prevReview = s.reviews[s.reviews.length - 1];
    const stalling = Object.values(s.exerciseStates).filter((x) => x.stallCount >= 2).length;
    if (!s.currentWeek.isDeload && readiness <= 7 && ((prevReview && prevReview.readiness <= 7) || stalling >= 2)) {
      s.currentWeek.isDeload = true;
      s.currentWeek.deloadReason = 'review';
      decisions.push('Low readiness (' + readiness + '/15) → this week becomes a deload.');
    }

    // Knee.
    if (answers.kneeMaxPain >= 3) {
      s.currentWeek.kneeCaution = true;
      decisions.push('Knee flagged ' + answers.kneeMaxPain + '/10 → conditioning on the bike this week.');
    }
    if (answers.kneeMorningPain >= 5) {
      s.runState.stageId = Math.max(0, s.runState.stageId - 1);
      s.runState.completionsAtStage = 0;
      s.runState.pendingRegression = true;
      decisions.push('Morning knee pain ' + answers.kneeMorningPain + '/10 → run stage regressed to ' + D.RUN_STAGES[s.runState.stageId].name + '.');
    }

    // Shoulder.
    if (answers.shoulderMaxPain >= 3) {
      if (s.shoulderState.rungId > 0) {
        s.shoulderState.rungId--;
        s.shoulderState.sessionsAtRung = 0;
        decisions.push('Shoulder flagged ' + answers.shoulderMaxPain + '/10 → overhead steps down to ' + D.EXERCISES[D.OVERHEAD_RUNGS[s.shoulderState.rungId].exerciseId].name + '.');
      }
      s.shoulderState.extraRehabVolume = true;
      decisions.push('Shoulder rehab volume increased to 4 sets this week.');
    } else if (s.shoulderState.extraRehabVolume && answers.shoulderMaxPain <= 1) {
      s.shoulderState.extraRehabVolume = false;
      decisions.push('Shoulder settled → rehab volume back to normal.');
    }

    // Lower abdominal (answers.abdominalMaxPain is absent on older callers).
    if (answers.abdominalMaxPain != null) {
      if (answers.abdominalMaxPain >= 3) {
        setAbdominalCaution(true, answers.abdominalSide, U.todayStr(), '', true);
        decisions.push('Lower abdominal flagged ' + answers.abdominalMaxPain + '/10' + sideLabel(answers.abdominalSide) + ' → gentler dead bug, jump and throw options stay on.');
      } else if (s.abdominalState && s.abdominalState.caution && answers.abdominalMaxPain <= 2) {
        setAbdominalCaution(false, null, null, '', true);
        decisions.push('Lower abdominal settled → normal exercises are back.');
      }
    }

    // Adherence.
    if (adherence < 0.5) {
      const trainDays = s.currentWeek.days.filter((d) => d.dayType !== 'rest' && d.status === 'planned');
      if (trainDays.length > 4) {
        let lowest = null;
        trainDays.forEach((d) => { if (!lowest || D.DAYS[d.dayType].priority < D.DAYS[lowest.dayType].priority) lowest = d; });
        if (lowest) {
          decisions.push(dayName(lowest.dayType) + ' (' + U.weekdayName(lowest.date) + ') dropped — last week was under 50% adherence, keeping the week realistic.');
          lowest.dayType = 'rest';
        }
      }
    } else if (adherence >= 0.85 && readiness >= 12) {
      decisions.push('Great week (' + Math.round(adherence * 100) + '% adherence, readiness ' + readiness + '/15). Optional: add one set to a lift you want to push.');
    }

    if (!decisions.length) decisions.push('Steady week — plan continues as scheduled.');
    s.reviews.push({ weekStart, answers, readiness, adherence, decisions, date: U.todayStr() });
    s.currentWeek.decisions.push.apply(s.currentWeek.decisions, decisions);
    LTA.store.save(true);
    return decisions;
  }

  return {
    ensureWeek, generateWeekPlan, dayForDate, sessionsForDate, applyUserExercises, prescriptionsForDay, runSpec, sprintSpec,
    progressExercise, applySessionEnd, dueCheckIns, resolveCheckIn, insertRacketSession, addRacketFollowUp,
    doDayInstead, reviewDue, processReview, adherenceOf, racketCount, reportIllness, resumeFromIllness, completedGymDays,
    startLightWeek, endLightWeek, lightDayIndex, lightWeekLength, weeksSinceDeload, deloadDue, WEEKS_BETWEEN_DELOADS, setLightCheckIn, logLightSession,
    weekMode, setWeekMode, dayName, dayWarmup, popupState, popupStageForToday, setPopupStage,
  };
})();

/* LTA.dev — console-only harness to fast-forward state for testing.
 * Example: LTA.dev.simulateWeeks(6, { kneePainOnRuns: [0,0,5], missRate: 0.1 })
 */
LTA.dev = (function () {
  'use strict';
  const U = LTA.util;
  const D = LTA.data;

  function fabricateSession(day, opts, runPainQueue) {
    const s = LTA.store.getState();
    const sets = [];
    const blocks = LTA.engine.prescriptionsForDay(day.dayType);
    if (blocks) {
      blocks.forEach((b) => b.items.forEach((it) => {
        const ex = D.EXERCISES[it.exerciseId];
        if (!ex || (ex.category !== 'strength' && ex.category !== 'accessory')) return;
        const st = LTA.store.exerciseState(it.exerciseId);
        const w = st.currentWeightKg || 40;
        for (let i = 0; i < it.sets; i++) sets.push({ exerciseId: it.exerciseId, weight: w, reps: it.repHi });
      }));
    }
    const session = { id: U.uid(), date: day.date, dayType: day.dayType, sets, painFlags: [], feel: 4, sessionRPE: 7 };
    if (day.dayType === 'run') {
      session.runMode = s.runState.pendingRegression ? 'bike' : 'run';
      session.runCompleted = true;
      session.runStageId = s.runState.stageId;
    }
    return session;
  }

  function simulateWeeks(n, opts) {
    opts = opts || {};
    const runPain = (opts.kneePainOnRuns || []).slice();
    for (let wk = 0; wk < n; wk++) {
      const s = LTA.store.getState();
      LTA.engine.ensureWeek();
      const week = s.currentWeek;
      week.days.forEach((day) => {
        if (day.dayType === 'rest') return;
        if (opts.missRate && Math.random() < opts.missRate) { day.status = 'skipped'; return; }
        const session = fabricateSession(day, opts, runPain);
        LTA.engine.applySessionEnd(session);
        // Resolve the morning check-in immediately with scripted pain.
        LTA.store.getState().pendingCheckIns.slice().forEach((ci) => {
          let sev = 0;
          if (ci.area === 'knee' && runPain.length) sev = runPain.shift();
          LTA.engine.resolveCheckIn(ci, sev);
        });
      });
      // Force-roll into next week.
      week.days.forEach((d) => { if (d.status === 'planned' && d.dayType !== 'rest') d.status = 'skipped'; });
      s.weekHistory.push(week);
      const metCadence = LTA.engine.completedGymDays(week) >= 3;
      week.countedTowardCadence = metCadence;
      if (metCadence) s.weekCounter++;
      s.currentWeek = LTA.engine.generateWeekPlan(U.addDays(week.weekStart, 7), (week.isDeload && !metCadence) || LTA.engine.deloadDue());
      LTA.engine.processReview(week.weekStart, Object.assign({ sleep: 4, energy: 4, soreness: 2, motivation: 4, kneeMaxPain: 0, kneeMorningPain: 0, shoulderMaxPain: 0, abdominalMaxPain: 0 }, opts.review || {}));
    }
    LTA.store.save(true);
    console.log('Simulated', n, 'weeks. weekCounter =', LTA.store.getState().weekCounter);
    console.log('runState', JSON.stringify(LTA.store.getState().runState));
    console.log('shoulderState', JSON.stringify(LTA.store.getState().shoulderState));
    if (LTA.ui) LTA.ui.render();
  }

  return { simulateWeeks, fabricateSession };
})();
