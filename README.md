# Rise

A 3-minute muscle check on the phone for people taking GLP-1 medications.

Each check combines three measures of muscle health into one result for the patient and their care team:

- **Leg strength:** a 30-second chair stand, recorded and counted by the phone camera, compared with the patient's baseline and CDC STEADI norms.
- **Muscle mass:** body composition from a **Rise phone scan** (two photos), a **photo of an InBody or DEXA printout** (read by AI), a **smart-scale file**, or typed in. Rise tracks what share of the weight lost was lean mass, compared only within the same device.
- **Grip (optional):** a home dynamometer reading, compared with EWGSOP2 cut-offs and the patient's first grip.

Rise turns these into **Steady**, **Watch** or **Check in**, gives the patient one action and a week's plan, and puts the patient on the nurse's "needs review" list when the plan isn't working. Every rule, threshold and source is in [`docs/evaluation.md`](docs/evaluation.md); the evidence behind the camera and coaching choices is in [`docs/research.md`](docs/research.md).

## Try it on an iPhone

**Phone demo (no server needed):** open **https://anikaagra.github.io/startup/** in Safari, then Share › **Add to Home Screen**. It opens full screen like an app, with the real camera and on-device pose tracking. Data stays on the phone.

- Patient: *Set up my first check*, care-team code **DEMO42**.
- Care team: *I'm on a care team* › *Use demo sign-in* (`nurse@demo.rise` / `rise-demo-2026`).
- AI in the phone demo: care-team Settings › paste an Anthropic key. It is stored only on that phone and sent straight to Anthropic. Use the full server (below) for anything beyond a personal demo.
- Add `?debug=1` to the check URL to see live camera numbers (sharpness, haze, light, tilt) while tuning.

The demo republishes automatically on every push to `main` (GitHub Actions › *Test and publish phone demo*). If the link 404s, open the repo's **Settings › Pages** and set **Source: Deploy from a branch › gh-pages / (root)** once.

**Full app (server, real accounts, AI):** deploy with the Render blueprint below, then open your Render URL in Safari and add it to the Home Screen.

## What's built

**Patient app** (installable web app, built for iPhone)
- **Setup:** 9 to 10 questions, one per screen. Answers set a **Higher** or **Standard** risk tier (how often to check, how fast to escalate). The phone gets a private sign-in token; *I already use Rise* moves a patient to a new phone with a 6-digit code from their care team.
- **Readiness:** sleep and pain/illness questions. A rough day never flags the nurse on its own and retests in a week.
- **Camera checks before recording** (all on the live camera, spoken and written, one fix at a time, debounced so one bad frame never interrupts):
  - *Lens:* blur (variance of the Laplacian, normalised by contrast so a plain wall isn't flagged), milky smudge haze (lifted blacks, narrow range), covered lens.
  - *Light:* too dark, too bright, a bright window behind the patient (blown-out pixels, or the person much darker than the room).
  - *Framing:* head and feet in view, too close, too far, side or 45° view, only one person.
  - *Phone:* upright (tilt from the motion sensors, ±15°), not tipped sideways, not shaking.
  - Recording starts by itself after 2 seconds of all-green, with a live skeleton overlay.
- **Stand counting:** MediaPipe pose on the phone. A stand counts when the hip rises from its seated height by about a thigh length *and* the knee straightens, with hysteresis and a 0.7 s minimum between stands. CDC STEADI rules: a stand more than halfway up at 30 s counts; uncrossed arms are flagged and the capture redone; lost tracking (under 75% of frames, or a gap over 2.5 s) is rejected with a fix.
- **Result:** Steady/Watch/Check in from the rules engine, an AI-written personal note (optional, safety-checked), one action, retest date, and **this week's plan**: protein target (2025 GLP-1 nutrition advisory: 1.2–1.6 g/kg of reference weight, or about 1.5 g/kg of lean mass), strength 3 times a week matched to joint pain and activity, 150 minutes of walking, day by day.
- **Home:** latest result, trend, plan, messages from the care team. **Settings:** calendar reminders (.ics), Home Screen install steps, unlink this phone, delete my data.

**Care-team app**
- Email/password sign-in (scrypt, hashed session tokens, rate-limited), clinic sign-up, admin and nurse roles.
- **Needs review** list first, then Watch/Check in, then steady; each row shows why and the last follow-up.
- Patient page: why this result, trends, every measure and its source, setup answers, what the patient saw.
- **Follow-up:** mark reviewed, log a call, referral, note, **message the patient** (shows in their app). Reviewing clears "needs review".
- **Draft note:** AI-written clinical note (summary, measures, assessment, plan, suggested patient message), or a structured template when AI is off. Copy, or send the suggested message.
- Link a patient's new phone, export the record (JSON), activity log, team management, AI key.

**AI (Claude)**
- Personal result notes for patients, draft clinical notes for nurses, and reading body composition printouts from a photo or PDF.
- The rules engine always decides the state; AI only writes words around numbers computed in code. Output is checked (no diagnosis, no medication advice, same state) and cached; every feature falls back to non-AI text when the key is missing or a call fails.
- Key: set `ANTHROPIC_API_KEY` on the server, or an admin pastes it in care-team Settings (stored server-side, never sent back to the browser). Models: `RISE_AI_MODEL` (default `claude-sonnet-5-5`) and `RISE_AI_FAST_MODEL` (default `claude-haiku-5-5`, used for reading printouts).

**Privacy and records**
- Camera video and body photos are processed on the phone and never uploaded. Printout photos are sent for reading and not stored.
- Every staff view, export, follow-up and settings change is written to an audit log. Patients can delete their data.

## Run it locally

Requires Node 22.5 or later.

```bash
npm run install:all
npm run dev          # API on :3001, app on http://localhost:5173
```

Open http://localhost:5173. Patients use code **DEMO42**; the care team signs in at `/provider` with `nurse@demo.rise` / `rise-demo-2026`. To turn on AI locally: `ANTHROPIC_API_KEY=sk-ant-... npm run dev`, or paste the key in care-team Settings.

Production build, served by the API server:

```bash
npm run build && npm start   # http://localhost:3001
```

`npm run fetch-model --prefix web` downloads the pose model into the app so it isn't fetched from Google at runtime (the Docker build and the Pages workflow do this).

## Deploy

**Render (recommended for the full app):** New › Blueprint › this repo. `render.yaml` builds the Docker image, mounts a disk at `/data` for the SQLite database, and asks for `ANTHROPIC_API_KEY`. Any host that runs a Docker container works the same way. Camera access needs `https`, which Render provides.

**Phone demo:** GitHub Pages, published by `.github/workflows/ci.yml` (`npm run build:pages --prefix web` builds it locally).

**Claude artifact demo:** `npm run build:demo --prefix web` builds a single-page version with in-memory routing for sharing inside Claude, where AI runs through the viewer's Claude account.

## Tests

```bash
npm test
```

- `server/test/rules.test.js`: risk tiers, STEADI norms, lean share, same-device comparison, EWGSOP2 cut-offs, combining measures, readiness flags, personalized copy.
- `server/test/api.test.js`: sign-in and tokens, clinic isolation, rate limits, follow-ups and messages, link codes, data deletion, AI on/off with a fake Claude client (safety rejection, caching, printout reading), admin-only settings, calendar file.
- `web/src/lib/__tests__`: stand counting (hip height and knee angle, STEADI halfway rule, arms flag), camera checks on synthetic sharp, blurred, hazy and covered frames, check debouncing, body scan geometry and file import.

## Project layout

```
server/   Express API, SQLite (node:sqlite), auth, rules engine, weekly plans, AI service, demo seed
web/      React + Vite app: patient app, camera pipeline, care-team app, demo builds
docs/     Evaluation rules, research, product principles, screens, design system, legal notes
```

## Before real patients use it

- **Camera thresholds on real phones.** Smudge, haze, light and tilt thresholds are conservative starting points. Tune them on several iPhones and Android phones with `?debug=1`.
- **Validation.** Validate phone counting against in-person 30-second chair stands (including older adults and people with obesity), and the Rise phone scan against DEXA. Photo circumference estimates are typically ±7–9 body-fat points for an individual (see research notes); Rise shows them as estimates and compares trends only.
- **Clinical review.** Risk tiers and Watch/Check-in thresholds are drafts. Set them with clinical advisors.
- **Regulatory and privacy.** Have a regulatory advisor review the flagging logic; complete a HIPAA review, sign a BAA with your host and AI provider, and add encryption at rest before storing real health data.
- **Accounts.** Add password reset by email and optional two-factor sign-in for staff.
- **Body scan.** Or license a validated scan SDK (Prism Labs and Spren both offer one) behind the same `rise-scan` step. See [`docs/legal-notes.md`](docs/legal-notes.md).
