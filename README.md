# Luke's Training App

A single-user, mobile-first training PWA built around Luke's vision: an athletic body on a broad frame — strength, fitness, and resilience; able to play tennis/padel anytime without issue; run a 5k and sprint; sustainable energy.

Vanilla HTML/CSS/JS. No build step, no dependencies. Data lives in `localStorage` with optional Supabase cloud sync (credentials pasted at runtime in Settings — never in this repo).

## What it does

- **Adaptive weekly rhythm** — 4 lifting days (45–60 min, each structured Power → Strength → Muscle → Resilience), 2 conditioning days (return-to-run + HIIT spin / incline steady state), 1 GMB-style recovery day. The week reshuffles automatically when racket sessions land (1–3×/week).
- **Choose your day** — pull any scheduled session forward and the days trade places, or build a freestyle workout exercise-by-exercise; everything still counts toward progression.
- **Auto-progression + periodisation** — double progression on lifts, stall detection with 10% resets, deload every 5th week or when readiness drops, and Build ↔ Strength blocks alternating between deloads.
- **Form first** — per-session tailored warmups, 2–3 cues per exercise, and a video search link to qualified coaches (Squat University, kneesovertoesguy, GMB, E3 Rehab, …) on every lift.
- **Knee-safe return-to-run** — 11 stages from incline walking to a 5k, gated by pain (≤2/10 during + next morning to advance). Sprint work unlocks after 20 min continuous pain-free running.
- **Shoulder overhead ladder** — landmine press → barbell OHP in 5 rungs, same pain gating, permanent rotator-cuff/scap/thoracic rehab volume on both upper days.
- **Morning check-ins** — the day after runs, pressing, or play, the app asks about the knee/shoulder and regresses or advances accordingly.
- **Weekly review** — sleep/energy/soreness/pain questionnaire that builds next week and explains every adjustment it makes.
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
