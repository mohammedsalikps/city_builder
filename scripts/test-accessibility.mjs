/**
 * Accessibility and loading tests (Milestone: performance, accessibility and
 * release hardening):
 *
 *   - the reduced-motion preference: follows the device, can be overridden,
 *     is stored on the device only, and tells listeners when it changes
 *   - what it changes: camera glides become jumps and the menu orbit stops;
 *     landmark force arrows, wind streaks and sway stand still (arrows keep
 *     their places and directions); CSS animations stop
 *   - keyboard: what Escape does in RealWorld Explorer and inside a house,
 *     and which targets count as typing
 *   - RealWorld Explorer loaded on demand: nothing fetched until it is wanted,
 *     one fetch however often it is asked for, honest failure and retry
 *
 * The game's own TypeScript runs through Vite's SSR loader (no browser):
 *   node scripts/test-accessibility.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
let passes = 0;
function check(condition, message) {
  if (condition) passes++;
  else {
    failures++;
    console.error(`  FAIL ${message}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}
const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

const server = await createServer({
  root,
  configFile: `${root}vite.config.ts`,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const load = (path) => server.ssrLoadModule(path);
  const THREE = await import('three');
  const motionModule = await load('/src/accessibility/motion.ts');
  const { MotionPreference, MOTION_STORAGE_KEY, applyMotionToDocument, motion } = motionModule;

  section('Reduced motion: the preference');
  {
    const memory = new Map();
    const storage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
    let changeListener = null;
    const query = { matches: false, addEventListener: (_type, listener) => (changeListener = listener) };
    const pref = new MotionPreference({ storage, matchMedia: () => query });
    check(pref.setting === 'system' && pref.reduced === false, 'by default it follows the device, which asks for nothing special');
    const seen = [];
    pref.onChange((reduced) => seen.push(reduced));
    query.matches = true;
    changeListener();
    check(pref.reduced === true && pref.systemPrefersReduced && seen.join() === 'true', 'the device asking for reduced motion (even while running) reduces it, and listeners hear about it');
    pref.set('full');
    check(pref.reduced === false && memory.get(MOTION_STORAGE_KEY) === 'full' && seen.join() === 'true,false', '"Full motion" overrides the device and is stored on this device');
    pref.set('reduce');
    check(pref.reduced === true && memory.get(MOTION_STORAGE_KEY) === 'reduce', '"Reduce motion" is stored too');
    const before = seen.length;
    pref.set('reduce');
    check(seen.length === before, 'choosing the same thing again tells nobody');
    pref.set('system');
    check(!memory.has(MOTION_STORAGE_KEY) && pref.reduced === true, '"Follow my device" removes the stored choice and follows the device again');
    pref.set('sideways');
    check(pref.setting === 'system', 'unknown choices are ignored');
    check(pref.duration(1.5) === 0, 'nonessential animations last no time at all while motion is reduced');
    query.matches = false;
    changeListener();
    check(pref.duration(1.5) === 1.5 && pref.reduced === false, '...and their normal time otherwise');

    memory.set(MOTION_STORAGE_KEY, 'reduce');
    const reloaded = new MotionPreference({ storage, matchMedia: () => ({ matches: false }) });
    check(reloaded.setting === 'reduce' && reloaded.reduced, 'the stored choice comes back after a reload');
    memory.set(MOTION_STORAGE_KEY, '<script>');
    check(new MotionPreference({ storage, matchMedia: null }).setting === 'system', 'a tampered stored value is ignored');
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const noStorage = new MotionPreference({ storage: blocked, matchMedia: () => ({ matches: true }) });
    noStorage.set('full');
    check(noStorage.setting === 'system' || noStorage.reduced === false, 'blocked storage never breaks it: the choice still applies');
    const oldSafari = { matches: true, addListener: () => undefined };
    check(new MotionPreference({ matchMedia: () => oldSafari }).reduced === true, 'older browsers (addListener only) work too');
    check(new MotionPreference({}).reduced === false, 'without a browser (headless) motion is full');

    const attributes = {};
    const fakeRoot = { setAttribute: (name, value) => (attributes[name] = value) };
    const docPref = new MotionPreference({ matchMedia: () => ({ matches: false }) });
    const stop = applyMotionToDocument(docPref, fakeRoot);
    check(attributes['data-motion'] === 'full', '<html data-motion="full"> while motion is full');
    docPref.set('reduce');
    check(attributes['data-motion'] === 'reduce', '<html data-motion="reduce"> follows the choice at once');
    stop();
    docPref.set('full');
    check(attributes['data-motion'] === 'reduce', 'after unsubscribing nothing changes the page any more');
  }

  section('Reduced motion: CSS animations and transitions stop');
  {
    const css = readFileSync(`${root}src/ui/styles.css`, 'utf8');
    const block = css.slice(css.indexOf("html[data-motion='reduce'] *"));
    check(block.includes('animation-duration: 0.001ms !important') && block.includes('transition-duration: 0.001ms !important') && block.includes('animation-iteration-count: 1 !important'), 'reduce: every animation and transition is cut to (almost) nothing');
    check(css.includes('@media (prefers-reduced-motion: reduce)') && css.includes("html:not([data-motion]) *"), 'before the script runs, the device setting applies on its own');
    check(/button:focus-visible,[\s\S]*?outline: 3px solid/.test(css), 'keyboard focus is always visible (a 3 px outline)');
  }

  section('Interior: the fade over a room cut never takes a tap');
  {
    const interiorCss = readFileSync(`${root}src/ui/interior/interior.css`, 'utf8');
    // `.screen > *` and `.studio > *` switch pointer events back on for every child of a screen: the veil's rule must outrank them.
    check(/\.screen\.interior\s*>\s*\.in-veil\s*\{[^}]*pointer-events:\s*none/.test(interiorCss), 'the fade over a room cut lets every tap and drag through (its rule outranks `.screen > *` and `.studio > *`)');
  }

  section('Reduced motion: camera glides become jumps, the menu orbit stops');
  {
    const { CameraController } = await load('/src/world/CameraController.ts');
    const element = Object.assign(new EventTarget(), {
      style: {},
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture: () => false,
    });
    element.getRootNode = () => element;
    element.ownerDocument = element;
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 3000);
    camera.position.set(30, 25, 30);
    const controller = new CameraController(camera, element);
    motion.set('full');
    controller.transitionTo({ x: 40, y: 0, z: 0 }, { distance: 30 }, 1.5);
    controller.update(1 / 60);
    check(controller.isTransitioning && !near(controller.target.x, 40, 1e-3), 'full motion: the camera glides over 1.5 s');
    motion.set('reduce');
    controller.transitionTo({ x: -40, y: 0, z: 0 }, { distance: 30 }, 1.5);
    controller.update(1 / 60);
    check(!controller.isTransitioning && near(controller.target.x, -40, 1e-6), 'reduced motion: the same move happens in one frame');
    controller.setAutoRotate(true, 0.5);
    const orbit = controller['controls'];
    check(orbit.autoRotate === false, 'reduced motion: the menu orbit stays still');
    motion.set('full');
    check(orbit.autoRotate === true, 'full motion again: the orbit the menu asked for resumes');
    controller.setAutoRotate(false);
    motion.set('reduce');
    motion.set('full');
    check(orbit.autoRotate === false, 'an orbit nobody asked for never starts');
    controller.dispose();
    motion.set('system');
  }

  section('Reduced motion: landmark arrows, wind streaks and sway stand still');
  {
    const realworld = await load('/src/realworld/index.ts');
    const helperMatrices = (model) => {
      const out = [];
      model.root.traverse((o) => {
        if (o.isInstancedMesh && o.userData.partId === null) out.push(Array.from(o.instanceMatrix.array.slice(0, o.count * 16)));
      });
      return JSON.stringify(out);
    };
    // Golden Gate: the load's arrows.
    const bridge = realworld.buildLandmarkModel(realworld.GOLDEN_GATE_BRIDGE, { quality: 'low' });
    bridge.setLoadPoint(0.3);
    const flowA = helperMatrices(bridge);
    bridge.update(0.05);
    check(helperMatrices(bridge) !== flowA, 'full motion: the bridge’s load arrows flow');
    bridge.setReducedMotion(true);
    const stillA = helperMatrices(bridge);
    for (let i = 0; i < 10; i++) bridge.update(0.05);
    check(helperMatrices(bridge) === stillA, 'reduced motion: they stand still');
    const arrows = bridge.root.getObjectByName('arrows');
    check(arrows.count > 0, `...and none of them disappear (${arrows.count} arrows)`);
    bridge.setForces('main-cables');
    const forces = helperMatrices(bridge);
    bridge.update(0.5);
    check(helperMatrices(bridge) === forces && arrows.count > 0, 'force arrows on a part stay put too');
    bridge.setReducedMotion(false);
    bridge.update(0.05);
    check(helperMatrices(bridge) !== forces, 'switching back: the arrows flow again');
    bridge.dispose();

    // Burj Khalifa: wind streaks and the exaggerated sway.
    for (const [name, build] of [['Burj Khalifa', () => realworld.buildLandmarkModel(realworld.BURJ_KHALIFA, { quality: 'low' })], ['Eiffel Tower (built-in model)', () => realworld.buildEiffelTower({ quality: 'low', source: null })]]) {
      const tower = build();
      const swayGroup = tower.root.getObjectByName('tower');
      tower.setWind(0.7);
      tower.update(0.1);
      const leanA = swayGroup.rotation.z;
      const streaksA = helperMatrices(tower);
      tower.update(0.5);
      check(swayGroup.rotation.z !== leanA && helperMatrices(tower) !== streaksA, `${name}, full motion: it sways and the wind streaks move`);
      tower.setReducedMotion(true);
      const lean = swayGroup.rotation.z;
      const streaks = helperMatrices(tower);
      for (let i = 0; i < 10; i++) tower.update(0.1);
      check(swayGroup.rotation.z === lean && helperMatrices(tower) === streaks, `${name}, reduced motion: a still lean and still streaks`);
      check(lean < 0, `${name}: the lean still shows which way the wind pushes`);
      tower.setLoadPath(true);
      const path = helperMatrices(tower);
      tower.update(0.5);
      check(helperMatrices(tower) === path, `${name}: the load-path arrows stand still`);
      tower.setWind(null);
      check(swayGroup.rotation.z === 0, `${name}: no wind, no lean`);
      tower.dispose();
    }
  }

  section('Keyboard: what Escape does');
  {
    const { realWorldBackStep, interiorBackStep, isTypingTarget, blocksEscape, returnFocusTo, takeReturnFocus } = await load('/src/ui/keyboard.ts');
    check(realWorldBackStep({ lessonOpen: true, partOpen: true, landmarkOpen: true }) === 'close-lesson', 'RealWorld: a lesson closes first');
    check(realWorldBackStep({ lessonOpen: false, partOpen: true, landmarkOpen: true }) === 'close-part', '...then the part card');
    check(realWorldBackStep({ lessonOpen: false, partOpen: false, landmarkOpen: true }) === 'close-landmark', '...then the landmark (back to the library)');
    check(realWorldBackStep({ lessonOpen: false, partOpen: false, landmarkOpen: false }) === 'leave-explorer', '...then RealWorld Explorer itself (back home)');
    check(interiorBackStep({ paletteOpen: true, proposalPending: true, objectSelected: true, touring: true }) === 'close-palette', 'inside a house: the furniture palette closes first');
    check(interiorBackStep({ paletteOpen: false, proposalPending: true, objectSelected: true, touring: true }) === 'cancel-proposal', '...then a waiting change is answered "no" (nothing changes)');
    check(interiorBackStep({ paletteOpen: false, proposalPending: false, objectSelected: true, touring: true }) === 'leave-to-builder', '...then a selected piece is left to the builder’s own Escape (deselect)');
    check(interiorBackStep({ paletteOpen: false, proposalPending: false, objectSelected: false, touring: true }) === 'stop-tour', '...then a guided tour stops');
    check(interiorBackStep({ paletteOpen: false, proposalPending: false, objectSelected: false, touring: false }) === 'nothing', 'Escape never throws the child out of the house ("Go outside" does that)');
    check(isTypingTarget(null) === false && isTypingTarget({ tagName: 'INPUT' }) === false, 'outside a browser nothing counts as a text box');
    check(blocksEscape(null) === false, '...and nothing keeps Escape for itself');
    check(takeReturnFocus() === null, 'Home screen: no focus to restore at first');
    returnFocusTo('.mode-card--explorer');
    check(takeReturnFocus() === '.mode-card--explorer' && takeReturnFocus() === null, 'leaving a mode remembers its Home card once (then forgets it)');
  }

  section('RealWorld Explorer loads on demand (RealWorldHost)');
  {
    const { RealWorldHost } = await load('/src/game/RealWorldHost.ts');
    const listeners = new Set();
    let state = { mode: 'menu', realWorld: { landmarkId: null } };
    const store = { getState: () => state, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) };
    const setMode = (mode) => {
      const previous = state;
      state = { ...state, mode };
      listeners.forEach((l) => l(state, previous));
    };
    let progressLoads = 0;
    const progress = { load: () => progressLoads++ };
    const made = [];
    class FakeScene {
      constructor(...args) {
        this.args = args;
        this.started = 0;
        this.updates = 0;
        this.disposed = false;
        made.push(this);
      }
      start() {
        this.started++;
      }
      update() {
        this.updates++;
      }
      dispose() {
        this.disposed = true;
      }
    }
    let fetches = 0;
    let fail = true;
    const importScene = async () => {
      fetches++;
      if (fail) throw new Error('offline');
      return { RealWorldScene: FakeScene };
    };
    const host = new RealWorldHost(store, {}, {}, {}, progress, importScene);
    host.start();
    check(progressLoads === 1 && fetches === 0 && host.state === 'idle', 'at start: learning progress is read, RealWorld Explorer’s code is not fetched');
    setMode('playing');
    check(fetches === 0, 'My World and Challenge Mode never fetch it');
    let failedOnce = false;
    await host.load().catch(() => (failedOnce = true));
    check(failedOnce && host.state === 'failed' && host.scene === null, 'a failed download is reported honestly (and nothing half-made is kept)');
    fail = false;
    const seen = [];
    host.onChange(() => seen.push(host.state));
    setMode('realworld');
    const scene = await host.load();
    check(fetches === 2 && seen.join() === 'loading,ready', 'entering RealWorld mode fetches it (trying again after the failure)');
    check(scene instanceof FakeScene && scene.started === 1 && host.scene === scene && scene.args[4] === progress, 'the scene is made once, started, and shares the progress store');
    const again = await host.load();
    host.preload();
    check(again === scene && fetches === 2 && made.length === 1, 'asking again, or preloading, never fetches or builds it twice');
    host.update(0.016);
    check(scene.updates === 1, 'frames reach the scene once it exists');
    host.dispose();
    check(scene.disposed, 'disposing the host disposes the scene');

    const lazyHost = new RealWorldHost(store, {}, {}, {}, progress, async () => ({ RealWorldScene: FakeScene }));
    lazyHost.preload();
    await lazyHost.load();
    check(lazyHost.scene !== null && lazyHost.state === 'ready', 'pointing at the RealWorld card preloads it quietly');
    lazyHost.dispose();
  }
} finally {
  await server.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
