# Performance, reduced motion and keyboard access (2026-10-14)

Notes for the "performance, accessibility and release hardening" pass. What
was measured, how, and what is still limited. Reproduce the bundle numbers
with `npm run build` then `npm run measure:bundle`.

## 1. What the first page load downloads

Sizes from Vite's build report (gzip as Vite reports it; `measure:bundle`
uses gzip level 9 and gives a few kB less).

| | Before | After | Change |
| --- | --- | --- | --- |
| Initial JavaScript (`index-*.js`) | 1,673.64 kB (437.13 kB gzip) | 1,515.23 kB (389.24 kB gzip) | -158.4 kB (-9.5%), gzip -47.9 kB (-11.0%) |
| Initial CSS (`index-*.css`) | 84.56 kB (16.29 kB gzip) | 67.87 kB (13.34 kB gzip) | -16.7 kB (-19.7%) |
| RealWorld Explorer, fetched on demand | (in the initial bundle) | 173.9 kB JS (54.0 kB gzip) + 20.6 kB CSS (4.7 kB gzip) | moved out of the first load |

The "after" initial bundle already includes the new reduced-motion and
keyboard code (a few kB).

**How:** RealWorld Explorer's scene, screen, styles, the three landmarks'
content and lessons, and their 3D model builders are a separate chunk.
`RealWorldHost` (always loaded, small) keeps the learning-progress store and
fetches the chunk when the child opens RealWorld Explorer, or a moment
earlier when they point at or tab to its card on the Home screen.
`RealWorldLoaderScreen` shows "Getting RealWorld Explorer ready..." meanwhile,
and a plain message with "Try again" / "Back to Home" if the download fails.
The Eiffel Tower's downloaded model (`.glb`), the sky and the ground textures
were already fetched only when needed and still are.

**Checked:**

- the build has one copy of three.js, in the main chunk; the RealWorld chunks
  contain only RealWorld code plus the HDR loader (source-map attribution);
- the main chunk contains no landmark text (`measure:bundle` checks this);
- in the browser, the Home screen, My World and Challenge Mode load no
  RealWorld module (the dev server's request list), and RealWorld Explorer
  loads them when opened.

**Why it is not smaller:** most of the first download is needed for the Home
screen itself:

| Part of the initial JavaScript (minified, source-map attribution) | About |
| --- | --- |
| three.js core and renderer | 490 kB |
| Built-in game data (asset catalogue, objects, templates, challenges, scenery) | 210-300 kB |
| three.js add-ons used at start (GLTF loader 44 kB, meshopt decoder 27 kB, transform gizmo 22 kB, orbit controls 20 kB) | 113 kB |
| The game itself (construction, My World, Interior Explorer, AI helper, screens) | the rest |

Further options, not done (each needs a design decision and testing):
load Interior Explorer on demand (about 50 kB, but it is wired into the AI
helper and the builder); load the transform gizmo only when an object is
selected; split the asset catalogue by category. The single main chunk is
still above Vite's 500 kB warning, and the warning is expected.

## 2. Measurements in a browser (honest limits)

- Rendering, measured once in the desktop app's built-in browser pane while
  it was visible: 1614 x 858 CSS px, device pixel ratio 1, Windows laptop
  with Intel UHD integrated graphics (ANGLE / Direct3D 11), dev server build.
  - Home screen (turning 3D town): median frame 27.6 ms (about 36 fps),
    95th percentile 62.5 ms.
  - Golden Gate Bridge overview: median 20.8 ms (about 48 fps), 95th
    percentile 21.7 ms.
- These numbers are for that one laptop and that pane only. **No phone,
  tablet or iOS measurement exists**: see `real-device-test-checklist.md`.
- Startup time was not measured as a number. The intro animation makes the
  time to the Home screen depend on frames, and the pane was often hidden
  (when hidden, the browser stops drawing frames).

## 3. Reduced motion

`src/accessibility/motion.ts`. The Home screen has an **Animations** choice:
*Follow my device* (default: the operating system's reduce-motion setting),
*Reduce motion* or *Full motion*. It is stored on this device only
(`city-builder.motion`) and removed by "Delete everything on this device".

When motion is reduced:

| What | Change |
| --- | --- |
| Camera moves (stops, views, interiors' dollhouse, restores) | jump in one frame instead of gliding |
| Home screen | stops turning |
| Startup animation | skipped (straight to Home) |
| Walking between rooms inside a house | a step, not a glide |
| CSS animations and transitions (toasts, celebrations, spinners, hovers) | off (`<html data-motion="reduce">`) |
| Building: the bounce of a placed piece, sparkles, ground pulses, the pulsing selection halo | off (pieces still appear in their stages) |
| RealWorld force arrows, load-path arrows, wind streaks | stand still at the same places, pointing the same way |
| Wind lesson sway (Burj Khalifa, Eiffel Tower) | a still lean in the wind's direction instead of swinging |
| RealWorld view re-centring when panels open | immediate |

Nothing a lesson explains is removed: numbers, labels, meters and arrow
directions stay. Not changed: the cars and people moving in My World, and the
construction timeline's Play button (which the child starts).

Tests: `npm run test:a11y` (the preference, CSS, camera, landmark models).

## 4. Keyboard access

- Visible focus ring on every button, select, slider and focusable element.
- Enter / Space activate every control (they are real buttons).
- **Escape steps back:** RealWorld Explorer: lesson, then part card, then
  landmark (back to the library), then RealWorld Explorer (back home).
  Inside a house: closes the furniture palette, answers "no" to a waiting
  change, deselects, stops the guided tour; it never leaves the house
  ("Go outside" does). Text boxes keep their own Escape.
- **No aiming needed:** RealWorld Explorer's **Parts** tab lists every
  structural part (choosing one is the same as tapping it, missions
  included; its notes open inside the list). Inside a house, **In this
  room** lists the furniture, each with Turn, Remove and "Move to..." (shown
  first, done on yes).
- **Focus goes somewhere sensible:** to the library heading or landmark
  title when they appear, to the lesson and step titles, to quiz feedback, to
  Yes when a change is shown, back to the button that opened something when
  it closes, and to the Home card you came from.
- Entering a house without a mouse: type "go inside my house" into Ask
  EAVARA (understood on the device; nothing is sent to an AI provider).
  Choosing a house in the 3D view still needs a tap or click.

Limits: no screen-reader audit has been done (labels exist); the 3D views
themselves cannot be explored with the keyboard beyond the lists; My World's
building tools (placing and moving pieces with the gizmo) still need a
pointer.
