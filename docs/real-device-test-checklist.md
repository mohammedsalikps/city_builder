# EAVARA City Builder: real-device test checklist

**Status: every test below is PENDING.** No physical laptop, phone or tablet
test has been run yet. The checks so far ran in automated tests (Node, no
browser) and in the desktop app's built-in browser pane on one Windows laptop
(Intel UHD integrated graphics), at emulated 375 x 812 and 1280 x 800
viewports. An emulated viewport is not a device: it does not show real touch
accuracy, iOS Safari behaviour, memory limits, thermal throttling or real
frame rates.

How to record a result: write the date, device model, OS and browser version
next to each line, mark it **Pass**, **Fail** (with what happened) or
**Not applicable**, and keep screenshots of failures.

Before starting:

- Use the production build (`npm run build`, then serve `dist/`), not the dev server.
- Start from a clean profile (or use "Delete everything on this device" on the Home screen) so old saves do not hide first-run problems.
- Have a grown-up tester on hand for the microphone and AI tests; use made-up test words only, never a child's real name or details.

## 1. Windows laptop, Chrome (current stable)

| # | Check | Result |
| --- | --- | --- |
| W1 | Page loading: cold start (cache cleared) to the Home screen. Note the time; the intro plays or, with reduced motion, is skipped | Pending |
| W2 | DevTools > Network: on the Home screen, no `RealWorldScreen-*.js`, `RealWorldScene-*.js` or `realworld-*.js` request yet. Pointing at (or tabbing to) the RealWorld card fetches them; opening the Eiffel Tower fetches the `.glb` only then | Pending |
| W3 | Offline test: DevTools > Network > Offline before opening RealWorld Explorer the first time: the "could not be loaded" card appears with Try again / Back to Home; going back online and pressing Try again opens the library | Pending |
| W4 | Camera navigation in My World: orbit (left drag), pan (right drag), zoom (wheel); no jumps or stuck camera | Pending |
| W5 | All three landmarks open; Burj pressure and wind lessons, Eiffel triangles lesson and timeline, Golden Gate tension/compression and load lessons work to the quiz and Finish | Pending |
| W6 | Keyboard only (no mouse): Tab reaches every control in order with a visible focus ring; Enter/Space activate; Escape steps back (lesson, part card, landmark, RealWorld Explorer); the Home card you came from gets focus back | Pending |
| W7 | Keyboard inside a house: "go inside my house" typed into Ask EAVARA enters it; room buttons, the "In this room" list (choose, Turn, Remove, Move to...), Add furniture, Yes/No, Ctrl+Z / Ctrl+Y and Go outside all work; Escape closes the palette, answers "no" to a waiting change, deselects | Pending |
| W8 | Reduced motion: Windows Settings > Accessibility > Visual effects > Animation effects **off**, reload: no intro, the Home screen does not turn, camera moves jump, force arrows and wind streaks stand still. Then Home > Animations > "Full motion" overrides it | Pending |
| W9 | Screen reader (NVDA or Narrator): landmark titles, lesson step titles and quiz feedback are announced when focus moves to them; buttons have names | Pending |
| W10 | Memory: Task Manager / DevTools Memory after 10 minutes moving between My World, a house, all three landmarks and Challenge Mode: no steady growth that does not come back | Pending |
| W11 | Rendering performance: with DevTools Performance or an FPS meter, note frame rate on the Home screen, in My World with a large town, and in each landmark overview; note the GPU | Pending |
| W12 | Voice: the microphone permission prompt appears only after the child presses the mic; the recording indicator shows; denying permission leaves typing working | Pending |
| W13 | Window resize from wide to narrow and back: panels never overlap the 3D subject or each other; nothing scrolls sideways | Pending |

## 2. Android phone, Chrome (one low-end and one mid-range device if possible)

| # | Check | Result |
| --- | --- | --- |
| A1 | Page loading on mobile data (or DevTools-free: a stopwatch): cold start to Home; RealWorld Explorer's first opening shows "Getting RealWorld Explorer ready..." briefly, never a blank screen | Pending |
| A2 | Touch accuracy: tap a tower, a main cable, a suspender rope, the deck and an anchorage on the Golden Gate Bridge; tap the Burj spire and piles; note which taps miss. The Parts tab picks every part without aiming | Pending |
| A3 | Camera navigation with two fingers: pan, pinch-zoom, twist-rotate; one finger still selects and drags objects | Pending |
| A4 | Interior navigation: the walk joystick, dragging to look around, room buttons, the dollhouse view, the furniture list (scroll the rooms panel), Add furniture, Yes/No | Pending |
| A5 | Screen rotation: portrait to landscape and back on the Home screen, in a landmark with a lesson open, and inside a house: layout recovers, the 3D view is not stretched, no panel covers the subject | Pending |
| A6 | Reduced motion: Settings > Accessibility > Remove animations **on**: no intro, still arrows, camera jumps | Pending |
| A7 | Voice: microphone permission prompt, recording indicator, transcription, and the text fallback when permission is denied | Pending |
| A8 | Memory and stability: 15 minutes of use including all three landmarks; the tab is not reloaded by the browser and WebGL is not lost ("context lost") | Pending |
| A9 | Back button / gesture (Android app build): steps back through RealWorld Explorer and leaves a house before leaving the app | Pending |
| A10 | Battery/heat: note if the phone gets hot or the frame rate drops after 10 minutes in a landmark | Pending |
| A11 | Physical keyboard or switch access (if available): Tab/Enter/Escape as on the laptop | Pending |

## 3. iPhone or iPad, Safari (if available)

| # | Check | Result |
| --- | --- | --- |
| I1 | The app loads and renders (WebGL 2) on the oldest supported iOS version; note the version | Pending |
| I2 | Touch accuracy and Parts tab, as A2; pinch on a panel does not zoom the whole page | Pending |
| I3 | Camera navigation with two fingers, as A3 | Pending |
| I4 | Interior navigation, as A4 | Pending |
| I5 | Screen rotation, as A5; the address bar showing and hiding does not cover the bottom controls | Pending |
| I6 | Reduced motion: Settings > Accessibility > Motion > Reduce Motion **on**, as A6 | Pending |
| I7 | Voice: Safari's microphone permission, recording indicator, transcription and text fallback | Pending |
| I8 | Memory: Safari does not reload the page after switching between landmarks for 10 minutes (iOS reloads tabs that use too much memory) | Pending |
| I9 | VoiceOver: buttons and lesson steps are read; focus moves to the landmark title and lesson steps | Pending |
| I10 | iPad with a keyboard: Tab/Enter/Escape as on the laptop | Pending |

## 4. After the tests

- File every failure with device, OS, browser, steps and a screenshot.
- Record measured frame rates and load times per device in the release notes. Do not quote numbers from the emulated viewport or the desktop pane as device results.
- Repeat the failed checks after fixes.
