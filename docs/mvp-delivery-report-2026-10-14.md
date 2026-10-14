# EAVARA City Builder: MVP delivery report (2026-10-14)

Status (updated later on 2026-10-14): release `7fc455c` was committed, pushed
and deployed to Production through Vercel's GitHub connection, and checked on
the live site. A follow-up fixes the voice and the room-by-room interior
(below). Recommended release unchanged: a **supervised, adult-led
demonstration or invite-only test, with voice off**. Not ready for public or
unsupervised use by children (see "Readiness" and "Release decision").

## Update: voice and room-by-room interiors (2026-10-14)

- **Voice.** "Talking isn't switched on yet" on the live site was the
  Production switch doing its job (`EAVARA_VOICE_ENABLED` is off there). The
  defect was that the app found out only after recording the child. It now
  asks `/api/status` first: while voice is off the microphone looks off, a
  line under the box says why, and nothing is recorded or sent. With voice on,
  the whole chain was checked with a controlled speech sample (a synthesized
  voice played into the browser, not a real microphone): recording, upload,
  Groq transcription, the transcript shown in the box, and Send building from
  it. The level meter no longer throws speech away when it cannot hear (a
  suspended or missing audio context).
- **Voice stays off in Production** until there is a decision on consent for
  children's voice recordings, a recording notice in the app, confirmed Groq
  Zero Data Retention and provider spending limits (section 1 of
  [the child-facing checklist](child-facing-release-checklist.md)).
- **Interiors.** Entering goes straight into the room behind the front door
  (no glide in from the sky or through the closed front door). Choosing a room
  is a cut with a short fade, never a glide through walls and furniture. Each
  room is seen from a free corner or doorway spot with the longest view across
  it and nothing filling the view. The indoor view is wider (84 degrees across;
  up to 90 degrees vertical on a phone). The dollhouse faces the front like
  the floor plan, fits narrow screens, names every room and lights the chosen
  one. Leaving from inside is a cut. A ready-made house (one model, no plan)
  explains that it has no rooms instead of offering no way in.
- **Tests on that tree:** `typecheck` passed; `test:plan` 7,820; `test:ai` 326
  (live speech-to-text included, with the controlled sample); `test:interior`
  506; `test:walk` 179; `test:explorer` 139; `test:realworld` 514; `test:a11y`
  62 - all passed, none failed or skipped; `build` succeeded.

## MVP features (no new features were added in the final passes)

- **Home screen** with three modes: Challenge Mode, My World and RealWorld
  Explorer, plus "Continue where you left off", the device-data links and the
  Animations (reduced-motion) choice.
- **My World:** building with previews, cancel and confirm, smart placement
  alternatives, individual-house selection and editing, undo/redo, autosave
  and reload, Ask EAVARA (typed requests; voice where enabled).
- **Challenge Mode:** levels with blueprints and progression.
- **Interior Explorer:** enter a planned house, room list and floor plan, walk
  and dollhouse views, guided tour, add / move / recolour / remove furniture
  (shown first, done on yes), "In this room" furniture list, Go outside.
- **RealWorld Explorer** (loaded on demand): Burj Khalifa, Eiffel Tower
  (downloaded CC0 model with built-in fallback) and Golden Gate Bridge; places
  to visit, complete / construction / cutaway / inspect views, timelines,
  parts (tap or the Parts list), six lessons with quizzes, missions, sourced
  facts.
- **EAVARA companion** lines that follow what is really on screen.
- **Accessibility:** keyboard access with visible focus and Escape to step
  back, reduced motion (follows the device; can be overridden).

## Improvements completed in the final passes

- **EAVARA's look and states (Ask EAVARA panel and its launcher).** The flat
  square icon is now a softly lit orb. It shows the states the panel already
  had, so the child can see what EAVARA is doing:
  - *idle*: a slow, quiet glow;
  - *listening*: a coral ring that grows with the child's voice;
  - *thinking*: a turning ring, with "Thinking..." under the name;
  - *previewing*: a warm ring while a plan waits for "Place here" or Cancel
    (the launcher pulses as before);
  - *error*: a coral orb and "That did not work - try again" for a few
    seconds, next to the message that says what to do.
  All motion stops under reduced motion. Checked in the browser: thinking
  (send and input disabled, so no double submits), previewing (and Cancel
  leaving the world unchanged), error (a simulated blocked microphone) and the
  return to idle; panel fits a 375 px wide screen with no overflow (emulated).
- **Warmer, clearer interiors.** Inside a house the blue sky's light is turned
  down and the indoor fill light is warm, so rooms keep their colours instead
  of looking washed out. Restored exactly on leaving (test and browser check).
- No other changes: no layout or workflow defects worth the risk were found.
  The release pass found no release-blocking defect, so no code changed in it.

## Assets

- **No new assets were downloaded.** The scenes use existing assets: Poly
  Haven sky, sand and concrete textures (CC0), the Eiffel Tower model by
  ingoenius via the 3D Model Repository (CC0), and the bundled 3D set
  (241 models and 164 palette textures referenced by the catalogue - all
  present in the build). New floor or wall textures would change every
  building in My World at once, which is too risky before the deadline.
- Asset documentation is unchanged and current:
  [manifest](realworld-asset-manifest.md), [licence notes](realworld-asset-licences.md),
  [asset ZIP](realworld-assets-2026-10-14.zip) (15 files, integrity verified,
  SHA-256 `38d86646db6d6350b8ed8872fa276737e63f59efd385b094fe92920298792887`).

## Tests on the final working tree (release pass, 2026-10-14)

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run test:plan` | 7,820 passed, 0 failed |
| `npm run test:ai` | 290 passed, 0 failed (live speech-to-text skipped: needs a recorded voice sample) |
| `npm run test:interior` | 488 passed, 0 failed |
| `npm run test:walk` | 179 passed, 0 failed |
| `npm run test:explorer` | 123 passed, 0 failed |
| `npm run test:realworld` | 514 passed, 0 failed |
| `npm run test:a11y` | 62 passed, 0 failed |
| `npm run build` | succeeded (Vite's large-chunk warning remains) |
| `npm run measure:bundle` | succeeded; the entry script carries no landmark text |

Total: 9,476 checks passed, 0 failed.

Note: `test:ai` has a live section that sends 14 requests to the configured AI
provider (here Anthropic, `claude-opus-5-5`, using the local `.env.local`
key). Each run costs a little. Live speech-to-text runs only when a voice
sample is supplied.

## Bundle (production build)

| | Before on-demand RealWorld | Final |
| --- | --- | --- |
| Initial JavaScript | 1,673.6 kB (437.1 kB gzip) | 1,517.0 kB (389.7 kB gzip) |
| Initial CSS | 84.6 kB | 69.6 kB (13.7 kB gzip) |
| RealWorld Explorer, fetched on demand | (in the first load) | 195.4 kB JS + CSS (58.6 kB gzip) |

The entry script carries no landmark content (`npm run measure:bundle`). The
build is reproducible: the same file names (`index-Ba_WL5aG.js`) on every run.

## Production build checked in a browser (2026-10-14)

`npm run build`, then `vite preview` on an unused local port, in the desktop
app's built-in browser at 1280 x 800 and at 375 x 812 (phone size, emulated).
A local preview has no `/api/*` functions, so Ask EAVARA's request got a 404
and the on-device helper answered; the hosted AI service was not used.

| Checked | Result |
| --- | --- |
| Home screen and its three modes | works |
| RealWorld Explorer loads on demand (its scripts, sky and textures) | works |
| Golden Gate Bridge: lesson "Pull or squeeze?", force arrows on the main cables | works |
| Eiffel Tower: downloaded model (200), lesson "Why is the Eiffel Tower full of triangles?" (braced frame) | works |
| Burj Khalifa: foundation lesson with load-path arrows | works |
| Challenge Mode: level map and level 1 with its blueprint | works |
| My World: Ask EAVARA "Build my first home" (on-device helper), preview, Place here, undo, redo | works |
| Reload keeps the placed house (autosave) | works |
| Interior: enter by typing "go inside my house", walk to the living room, "In this room" list (choosing the sofa opens its card), Go outside | works |
| Keyboard: Escape steps back from a lesson, to the library, to Home; focus returns to the card you came from | works |
| Reduced motion: the setting is saved, `<html data-motion="reduce">`, the intro is skipped | works |
| Phone size: Home, Golden Gate Bridge and the Ask EAVARA panel fit; no sideways scrolling | works |
| Network: every request 200 except the expected `/api/build` 404 (about 440 in the first session); no requests to other websites | as expected |
| Console, across three page loads: no errors except that 404 | as expected |

## Hosting and environment

- Vercel project link: `eavara-city-builder` (`.vercel/project.json`). No
  `vercel.json`: Vercel's Vite defaults apply - build `npm run build`
  (`tsc --noEmit && vite build`), output `dist/`, serverless functions in
  `api/` (`/api/build`, `/api/transcribe`, `/api/status`). The app is a single
  page at `/` with no client-side routes, so refreshing works and no rewrites
  are needed; other paths return Vercel's 404.
- Production assets: every model, palette texture and RealWorld file the app
  asks for exists in `dist/`; the RealWorld chunks are separate files loaded on
  demand; no `localhost` address or dev-only code (`window.game` is dev-only)
  is in the build.
- `.vercelignore` keeps `.env*`, `android/`, `scripts/`, `*.apk` and build
  output out of the upload; `.env*` is also in `.gitignore`. The build depends
  on uncommitted changes (including the new `api/` and `server/` folders and
  the updated `package-lock.json`): a Git-based deployment needs them
  committed first.
- **No secrets in the client:** a scan of all 289 files in `dist/` found no
  API keys, no `.env.local` values, no server-only variable names and no
  provider addresses; the browser only calls the app's own `/api/build` and
  `/api/transcribe`. The browser bundle reads one build setting,
  `VITE_EAVARA_API_BASE` (an address, not a secret).
- **Safe failures:** AI or voice switched off gives 503 `disabled`; missing
  provider settings 503 `not-configured`; other websites 403; too many
  requests 429; oversized requests 413; provider failures are mapped to
  error codes without details. The client shows friendly messages, and when
  the AI service cannot be reached the on-device helper still answers
  (checked in the browser). The 429 limit counts per server instance only: it
  is **not** a global limit or a spending cap.
- **Switches:** `EAVARA_AI_ENABLED` and `EAVARA_VOICE_ENABLED` are on when not
  set; only `false`, `0`, `off` or `no` turn them off. Changing them needs a
  new deployment to take effect.
- **Production environment variables to check in the Vercel dashboard**
  (names only; values were not read): `ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
  `EAVARA_AI_ENABLED`, `EAVARA_VOICE_ENABLED`, and optionally
  `EAVARA_LLM_PROVIDER`, `EAVARA_LLM_MODEL`, `EAVARA_LLM_EFFORT`,
  `EAVARA_STT_PROVIDER`, `EAVARA_STT_MODEL`, `EAVARA_STT_LANGUAGE` (and the
  `*_BASE_URL` / `*_API_KEY` / Cloudflare settings only if those providers
  are used).
- **The live site** (<https://eavara-city-builder.vercel.app>): `7fc455c`
  was deployed through Vercel's GitHub connection (a push to `master` now
  deploys to Production). Checked live on 2026-10-14: the new build loads,
  `/api/status` answers `{"ai":true,"voice":false}`, `/api/transcribe`
  refuses with `disabled`, `/api/build` refuses other websites and empty
  requests, every lazy chunk and landmark asset loads, and no secrets or
  `localhost` addresses are in the client files.
- **Not verified:** the production values of the environment variables (the
  Vercel CLI is not installed or signed in on this computer, and there is no
  dashboard access); this version on the live site.

## Readiness

| Level | Status |
| --- | --- |
| Build-ready (tests and production build pass) | **Yes** |
| Deployment-ready (configuration and deployment verified) | **Not yet**: the production build and configuration are verified locally; still to do: commit and push, set `EAVARA_VOICE_ENABLED=false` in Vercel Production, deploy this version |
| Hosted | **Yes**: `7fc455c` is live; later commits deploy the same way |
| Live-tested | **Yes for `7fc455c`** (assets, API answers, My World, interior and dollhouse checked on the live site) |
| Demo-ready (under stated restrictions) | **Yes**, for a supervised, adult-led demonstration with voice off |
| Public child-release-ready | **No** (see below) |

## Remaining blockers

| Blocker | Kind |
| --- | --- |
| Check every deployment on the live site (a push to `master` deploys to Production) | Operational |
| Keep `EAVARA_VOICE_ENABLED=false` in Production until consent, a recording notice and Groq Zero Data Retention are settled; set provider spending limits (or `EAVARA_AI_ENABLED=false`) | Operational, legal |
| Parental consent flow and child-facing privacy notice | Legal, privacy |
| Provider data retention (Groq zero data retention, Anthropic terms), data-processing agreements, provider-side deletion requests | Privacy, legal |
| Global rate limit, spending caps, a kill switch that works without a redeploy | Technical, operational |
| Legal review of landmark names, models, likenesses and assets | Legal |
| Science-teacher or engineer review of the lessons | Content review |
| Real-device and assistive-technology testing (`real-device-test-checklist.md`) | Device testing |

## Release decision

**Recommendation:** deploy only for a **supervised demonstration or
invite-only test led by adults**, with **voice disabled**
(`EAVARA_VOICE_ENABLED=false`) because consent is unresolved, and with the AI
builder either disabled (`EAVARA_AI_ENABLED=false`) or protected by spending
limits set in the Anthropic and Groq accounts first. Do not present it as
ready for children to use on their own.

## Files changed in the final passes

- `src/game/InteriorExplorer.ts` - warm indoor lighting, restored on leaving.
- `scripts/test-explorer.mjs` - the fake world gets a hemisphere light; two
  checks that indoor lighting is applied and restored.
- `src/ui/studio/AiBuilderPanel.ts` - EAVARA's mood (idle, listening,
  thinking, previewing, error) from the existing states.
- `src/ui/studio/ai.css` - the lit orb and the mood styles.
- `docs/mvp-delivery-report-2026-10-14.md` (this report), `docs/child-facing-release-checklist.md`,
  `docs/screenshots/mvp-delivery-2026-10-14/`.
