# Luke's Training App

A single-user, mobile-first training PWA for building all-round athleticism: strength, conditioning and joint resilience, aimed at performing well in racket sports and running — with surf-specific prep (paddling endurance, pop-up power, rotational core strength) woven into the same sessions.

Vanilla HTML/CSS/JS. No build step, no dependencies. Data lives in `localStorage` with optional Supabase cloud sync (credentials pasted at runtime in Settings — never in this repo).

## What it does

- **Adaptive weekly rhythm** — 4 lifting days (45–60 min, each structured Power → Strength → Muscle → Resilience), 2 conditioning days (return-to-run + HIIT spin / incline steady state), 1 GMB-style recovery day. The week reshuffles automatically when racket sessions land (1–3×/week).
- **Choose your day** — pull any scheduled session forward and the days trade places, or build a freestyle workout exercise-by-exercise; everything still counts toward progression.
- **Auto-progression + periodisation** — double progression on lifts, stall detection with 10% resets, deload every 5th week or when readiness drops, and Build ↔ Strength blocks alternating between deloads.
- **Form first** — per-session tailored warmups, 2–3 cues per exercise, and a video search link to qualified coaches (Squat University, kneesovertoesguy, GMB, E3 Rehab, …) on every lift.
- **Graded return-to-run** — 11 stages from incline walking to a 5k, each gated on discomfort staying ≤2/10 during the run and the next morning before advancing. Sprint work unlocks after 20 min continuous running clears the gate.
- **Overhead loading ladder** — landmine press → barbell OHP in 5 rungs behind the same gating, with rotator-cuff, lower-trap, serratus and thoracic work as permanent fixtures on both upper days rather than a temporary phase.
- **Skip or swap the first half** — on run days (run → core) and Engine days (conditioning → mobility) you can skip the first part or swap it for other cardio (quick picks or freestyle) and go straight to the second half. A skipped or swapped part never counts toward the run ladder, sprint ladder or knee check-in.
- **Racket and surf sessions** — Tennis, Padel, Surf or any other sport, logged with sport-specific labels (paddling and pop-up intensity for surf). Surf reshuffles the week like racket play.
- **Lower-abdominal monitoring** — flag it mid-session (with left/right/both), on surf sessions, in the morning check-in and in the weekly review; the Progress tab charts it. At 3/10 or more, dead bug, box/broad jumps and rotational med-ball work swap to gentler options until it settles.
- **Next-morning check-ins** — after runs, overhead pressing or play, the app follows up the next day and advances or regresses the relevant ladder on the answer.
- **Weekly review** — sleep/energy/soreness questionnaire that builds the following week and explains every adjustment it makes.
- **Tracking** — e1RM trends, run-stage timeline, pain trends, adherence, all charted.

## Run locally

Any static server, e.g.:

```bash
python3 -m http.server 8123
```

then open http://localhost:8123.

## Deploy to GitHub Pages

```bash
git remote add origin https://github.com/<you>/lukes-training-app.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**. The app will be at `https://<you>.github.io/lukes-training-app/`.

On iPhone: open that URL in Safari → Share → **Add to Home Screen**.

## Optional cloud sync (Supabase)

1. Create a free Supabase project.
2. Run the SQL shown in the app under **Settings → Cloud sync → One-time table setup**.
3. Paste your project URL and anon key into Settings on each device. Keys are stored only in that device's localStorage.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell, tab bar |
| `styles.css` | Dark mobile-first theme |
| `data.js` | Exercise library, day templates, run stages, overhead ladder |
| `store.js` | localStorage persistence, schema migrations, export/import |
| `engine.js` | Progression, deloads, pain autoregulation, racket reshuffler, weekly review |
| `app.js` | Views, session player, timers, charts |
| `sync.js` | Supabase sync (plain fetch) |
| `sw.js` | Offline cache |

Console dev harness: `LTA.dev.simulateWeeks(6, { kneePainOnRuns: [0,0,5], missRate: 0.1 })` fast-forwards state for testing.
