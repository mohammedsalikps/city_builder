/**
 * Acceptance tests for the first-person walk camera and its input
 * (src/world/WalkController.ts, the World camera-driver seam, the
 * CameraController snapshot/restore additions, KeyboardInput held keys and
 * src/ui/interior/VirtualJoystick.ts).
 *
 * Runs the game's own TypeScript modules through Vite's SSR loader with
 * EventTarget-based fakes for the DOM, so no browser or WebGL is needed:
 *   node scripts/test-walk.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// KeyboardInput listens on `window` (and `document`, added only for its own section below).
globalThis.window = new EventTarget();

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
const flush = () => new Promise((resolve) => setImmediate(resolve));
const STEP = 1 / 60;

/** A plain Event carrying the pointer fields the controllers read. */
function pointer(type, fields) {
  const event = new Event(type, { cancelable: true });
  return Object.assign(event, { pointerId: 1, pointerType: 'touch', button: 0, buttons: 1, clientX: 0, clientY: 0, ...fields });
}
/** Press, move through `path` and release, all with one pointer. */
function drag(target, from, path, fields = {}) {
  target.dispatchEvent(pointer('pointerdown', { clientX: from[0], clientY: from[1], ...fields }));
  for (const [x, y] of path) target.dispatchEvent(pointer('pointermove', { clientX: x, clientY: y, ...fields }));
  const last = path.length ? path[path.length - 1] : from;
  target.dispatchEvent(pointer('pointerup', { clientX: last[0], clientY: last[1], buttons: 0, ...fields }));
}

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
  const { WalkController, shortestAngle } = await load('/src/world/WalkController.ts');

  const START = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
  /** A walker on a fresh camera, standing at `pose`. */
  function makeWalker(pose = START) {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const dom = Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 600 });
    const held = new Set();
    const keys = { isDown: (code) => held.has(code) };
    const walker = new WalkController(camera, dom, keys);
    void walker.setPose(pose);
    return { camera, dom, held, walker };
  }
  /** Simulate `seconds` of 60 fps frames. */
  function run(walker, seconds, step = STEP) {
    const frames = Math.round(seconds / step);
    for (let i = 0; i < frames; i++) walker.update(step);
  }
  /** Ground speed over one more frame, m/s. */
  function speedNow(walker) {
    const a = walker.getPose();
    walker.update(STEP);
    const b = walker.getPose();
    return Math.hypot(b.x - a.x, b.z - a.z) / STEP;
  }
  const samePose = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.pitch === b.pitch;
  const fmt = (p) => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)}, yaw ${p.yaw.toFixed(4)}, pitch ${p.pitch.toFixed(4)})`;

  // ------------------------------------------------------------------ 1
  section('1. Walking: directions, speed, smoothing');
  {
    const { walker, held } = makeWalker();
    check(walker.speed === 1.6 && walker.turnSpeed === 1.8 && walker.lookSensitivity === 0.005, 'defaults: 1.6 m/s, 1.8 rad/s, 0.005 rad/px');
    check(walker.enabled === true && walker.isEasing === false, 'a new walker is enabled and not easing');
    held.add('KeyW');
    run(walker, 1);
    const p = walker.getPose();
    check(near(p.x, 0, 1e-12) && p.z < -1.4 && p.z > -1.6, `W at yaw 0 walks toward -Z (${fmt(p)})`);
    check(p.y === 1.6 && p.yaw === 0 && p.pitch === 0, 'walking keeps eye height and view');
  }
  {
    const { walker, held } = makeWalker({ ...START, yaw: Math.PI / 2 });
    held.add('ArrowUp');
    run(walker, 1);
    const p = walker.getPose();
    check(p.x < -1.4 && p.x > -1.6 && near(p.z, 0, 1e-9), `ArrowUp at yaw PI/2 walks toward -X (${fmt(p)})`);
  }
  {
    const { walker, held } = makeWalker();
    held.add('KeyS');
    run(walker, 1);
    check(walker.getPose().z > 1.4, 'S walks backward (+Z at yaw 0)');
  }
  {
    const { walker, held } = makeWalker();
    held.add('KeyD');
    run(walker, 1);
    const p = walker.getPose();
    check(p.x > 1.4 && near(p.z, 0, 1e-12), `D at yaw 0 strafes right toward +X (${fmt(p)})`);
    const turned = makeWalker({ ...START, yaw: Math.PI / 2 });
    turned.held.add('KeyD');
    run(turned.walker, 1);
    const q = turned.walker.getPose();
    check(near(q.x, 0, 1e-9) && q.z < -1.4, `D at yaw PI/2 strafes toward -Z, i.e. right = (cos yaw, 0, -sin yaw) (${fmt(q)})`);
    const left = makeWalker();
    left.held.add('KeyA');
    run(left.walker, 1);
    check(left.walker.getPose().x < -1.4, 'A strafes left');
  }
  {
    const { walker, held } = makeWalker();
    held.add('KeyW');
    run(walker, 0.1);
    const early = speedNow(walker);
    check(early > 0.5 && early < 1.6 - 0.1, `still speeding up after 0.1 s (${early.toFixed(3)} m/s)`);
    run(walker, 0.1);
    check(near(speedNow(walker), 1.6, 1e-9), 'full speed 1.6 m/s within ~0.15 s');
    run(walker, 1);
    check(near(speedNow(walker), 1.6, 1e-9), 'cruising speed stays exactly 1.6 m/s');
    held.clear();
    walker.update(STEP);
    const slowing = speedNow(walker);
    check(slowing > 0 && slowing < 1.6, `lets go softly rather than stopping dead (${slowing.toFixed(3)} m/s one frame after release)`);
    run(walker, 0.2);
    check(speedNow(walker) === 0, 'comes to rest within 0.2 s of letting go');
  }
  {
    const { walker, held } = makeWalker();
    held.add('KeyW');
    held.add('KeyD');
    run(walker, 1);
    const a = walker.getPose();
    run(walker, 0.5);
    const b = walker.getPose();
    const speed = Math.hypot(b.x - a.x, b.z - a.z) / 0.5;
    check(near(speed, 1.6, 1e-9), `diagonal W+D is normalised to 1.6 m/s (got ${speed.toFixed(6)})`);
    check(near(b.x - a.x, -(b.z - a.z), 1e-9), 'diagonal W+D heads exactly between forward and right');
  }
  {
    const { walker } = makeWalker();
    walker.setMoveInput(0, 1);
    run(walker, 1);
    check(near(speedNow(walker), 1.6, 1e-9) && walker.getPose().z < -1.4, 'joystick y = 1 walks forward at full speed');
    walker.setMoveInput(1, 1);
    run(walker, 0.5);
    check(near(speedNow(walker), 1.6, 1e-9), 'joystick diagonal (1, 1) is normalised');
    walker.setMoveInput(0.5, 0);
    run(walker, 0.5);
    const a = walker.getPose();
    run(walker, 0.5);
    const b = walker.getPose();
    check(near((b.x - a.x) / 0.5, 0.8, 1e-9) && near(b.z, a.z, 1e-9), 'joystick x = 0.5 strafes right at half speed');
    walker.setMoveInput(9, NaN);
    run(walker, 0.5);
    check(near(speedNow(walker), 1.6, 1e-9), 'out-of-range joystick values are clamped (NaN counts as 0)');
  }
  {
    const { walker, held } = makeWalker();
    held.add('KeyW');
    walker.update(1);
    const p = walker.getPose();
    check(near(-p.z, (1.6 / 0.15) * 0.05 * 0.05, 1e-12), `a 1 s frame is simulated as 0.05 s (moved ${(-p.z).toFixed(5)} m)`);
    walker.update(-1);
    walker.update(NaN);
    check(samePose(walker.getPose(), p), 'negative or NaN frame times move nothing');
  }
  {
    const { walker, held } = makeWalker();
    held.add('ArrowLeft');
    run(walker, 0.5);
    check(near(walker.getPose().yaw, 0.9, 1e-9), `ArrowLeft turns left at 1.8 rad/s (yaw ${walker.getPose().yaw.toFixed(6)})`);
    held.clear();
    held.add('KeyE');
    run(walker, 0.5);
    check(near(walker.getPose().yaw, 0, 1e-9), 'E turns right back to 0');
    held.clear();
    held.add('KeyQ');
    run(walker, 0.25);
    held.clear();
    held.add('ArrowRight');
    run(walker, 0.25);
    check(near(walker.getPose().yaw, 0, 1e-9), 'Q and ArrowRight turn too');
    const p = walker.getPose();
    check(p.x === 0 && p.z === 0, 'turning on the spot does not move the walker');
  }

  // ------------------------------------------------------------------ 2
  section('2. Collision resolver');
  {
    const { walker, held } = makeWalker();
    const calls = [];
    walker.setCollision((from, to) => {
      calls.push({ from, to });
      return { x: to.x, z: Math.max(to.z, -1) };
    });
    held.add('KeyW');
    run(walker, 2);
    const p = walker.getPose();
    // 2 s at 60 fps is 120 frames, and the walker is moving (or pressing into the wall) in every one of them.
    check(calls.length === Math.round(2 / STEP), `the resolver is asked about every step (${calls.length} calls for ${Math.round(2 / STEP)} frames)`);
    check(calls.every((c) => typeof c.from.x === 'number' && typeof c.from.z === 'number' && typeof c.to.x === 'number' && typeof c.to.z === 'number'), 'it gets plain {x, z} from/to points');
    check(calls[0].from.x === 0 && calls[0].from.z === 0 && calls[0].to.z < 0, 'the first step starts where the walker stands and heads -Z');
    check(p.z === -1, `the wall at z = -1 stops the walker exactly (z ${p.z})`);
    held.add('KeyD');
    const before = walker.getPose();
    run(walker, 1);
    const after = walker.getPose();
    check(after.z === -1 && after.x > before.x + 0.5, `pushing diagonally into the wall slides along it (x ${before.x.toFixed(3)} -> ${after.x.toFixed(3)})`);
    walker.setCollision(null);
    held.delete('KeyD');
    run(walker, 0.5);
    check(walker.getPose().z < -1.3, 'with the resolver removed the walker walks on');
  }
  {
    const { walker, held } = makeWalker();
    let pushes = 1;
    walker.setCollision((from, to) => (pushes-- > 0 ? { x: to.x + 1, z: to.z } : to));
    held.add('KeyW');
    run(walker, 0.5);
    const a = walker.getPose();
    walker.update(STEP);
    const b = walker.getPose();
    check(Math.hypot(b.x - a.x, b.z - a.z) / STEP <= 1.6 + 1e-9, 'a resolver that pushes the walker out of a wall never flings them faster than walking speed');
    walker.setCollision(() => ({ x: NaN, z: Infinity }));
    const c = walker.getPose();
    walker.update(STEP);
    check(samePose(walker.getPose(), c), 'a broken resolver answer (NaN) keeps the walker where it was');
  }

  // ------------------------------------------------------------------ 3
  section('3. setPose: jumps, glides, cancels');
  {
    const { walker, camera } = makeWalker();
    const jump = { x: 3, y: 1.5, z: -7, yaw: 0.4, pitch: -0.2 };
    let jumped = false;
    void walker.setPose(jump).then(() => (jumped = true));
    await flush();
    check(jumped && samePose(walker.getPose(), jump), 'setPose without a duration jumps and resolves');
    check(camera.position.x === 3 && camera.position.y === 1.5 && camera.position.z === -7, 'a jump moves the camera straight away');

    void walker.setPose(START);
    const target = { x: 4, y: 1.7, z: -2, yaw: 1, pitch: -0.3 };
    let done = false;
    const promise = walker.setPose(target, { duration: 1 });
    void promise.then(() => (done = true));
    check(walker.isEasing, 'setPose with a duration starts a glide');
    run(walker, 0.5);
    const mid = walker.getPose();
    check(near(mid.x, 2, 1e-6) && near(mid.z, -1, 1e-6) && near(mid.yaw, 0.5, 1e-6) && near(mid.pitch, -0.15, 1e-6) && near(mid.y, 1.65, 1e-6), `halfway through, easeInOutCubic puts the walker halfway ${fmt(mid)}`);
    run(walker, 0.25);
    const k = 1 - Math.pow(-2 * 0.75 + 2, 3) / 2;
    check(near(walker.getPose().x, 4 * k, 1e-6), `three quarters through follows easeInOutCubic (x ${walker.getPose().x.toFixed(5)}, expected ${(4 * k).toFixed(5)})`);
    await flush();
    check(!done, 'the promise is still pending mid-glide');
    run(walker, 0.3);
    await flush();
    check(done && !walker.isEasing, 'the glide finishes and its promise resolves');
    check(samePose(walker.getPose(), target), `it lands exactly on the target pose ${fmt(walker.getPose())}`);
    check(camera.position.x === 4 && camera.position.y === 1.7 && camera.position.z === -2, 'the camera lands exactly too');
    check(camera.rotation.order === 'YXZ' && camera.rotation.x === -0.3 && camera.rotation.y === 1 && camera.rotation.z === 0, "camera rotation is order 'YXZ' with (pitch, yaw, 0)");
  }
  {
    const { walker } = makeWalker();
    const A = { x: 10, y: 1.6, z: 0, yaw: 0, pitch: 0 };
    const B = { x: 0, y: 1.6, z: 10, yaw: -1, pitch: 0.2 };
    let firstDone = false;
    let secondDone = false;
    void walker.setPose(A, { duration: 1 }).then(() => (firstDone = true));
    run(walker, 0.3);
    void walker.setPose(B, { duration: 1 }).then(() => (secondDone = true));
    await flush();
    const interrupted = walker.getPose();
    check(firstDone && !secondDone, 'a second setPose cancels the first glide and resolves its promise');
    check(interrupted.x > 0 && interrupted.x < 10, `the cancelled glide stops where it was (x ${interrupted.x.toFixed(3)}), no jump to its end`);
    walker.update(STEP);
    check(Math.abs(walker.getPose().x - interrupted.x) < 0.01, 'the new glide starts smoothly from there');
    run(walker, 1.1);
    await flush();
    check(secondDone && samePose(walker.getPose(), B), 'the second glide lands exactly on its own target');
  }
  {
    const { walker } = makeWalker({ ...START, yaw: 3 });
    void walker.setPose({ ...START, yaw: -3 }, { duration: 1 });
    run(walker, 0.5);
    const yaw = walker.getPose().yaw;
    check(near(yaw, Math.PI, 1e-6), `yaw eases the short way round through PI, not through 0 (mid-glide yaw ${yaw.toFixed(5)})`);
    run(walker, 0.6);
    check(walker.getPose().yaw === -3, 'and still lands exactly on the requested yaw');
    check(near(shortestAngle(3, -3), 2 * Math.PI - 6, 1e-12) && near(shortestAngle(-3, 3), 6 - 2 * Math.PI, 1e-12) && near(shortestAngle(0, 7), 7 - 2 * Math.PI, 1e-12), 'shortestAngle picks the smaller turn either way');
  }
  {
    const { walker, held, dom } = makeWalker();
    const twin = makeWalker();
    const target = { x: 2, y: 1.6, z: 2, yaw: 0.5, pitch: 0 };
    void walker.setPose(target, { duration: 1 });
    void twin.walker.setPose(target, { duration: 1 });
    held.add('KeyW');
    held.add('ArrowLeft');
    walker.setMoveInput(1, 1);
    run(walker, 0.2);
    run(twin.walker, 0.2);
    drag(dom, [100, 100], [[200, 150]]);
    run(walker, 0.3);
    run(twin.walker, 0.3);
    check(samePose(walker.getPose(), twin.walker.getPose()), 'keys, joystick and look-drags are ignored while gliding');
    run(walker, 0.5);
    check(samePose(walker.getPose(), target), 'the glide lands exactly on target even with keys held');
    walker.update(STEP);
    check(walker.getPose().z !== target.z, 'walking resumes once the glide is over');
  }
  {
    const { walker } = makeWalker();
    void walker.setPose({ ...START, pitch: 2 });
    check(walker.getPose().pitch === 0.95, 'setPose clamps pitch to +0.95');
    void walker.setPose({ ...START, pitch: -5 });
    check(walker.getPose().pitch === -0.95, 'setPose clamps pitch to -0.95');
    void walker.setPose({ x: NaN, y: 1.6, z: 1, yaw: Infinity, pitch: 0 });
    const p = walker.getPose();
    check(p.x === 0 && p.z === 1 && p.yaw === 0, 'non-finite pose values keep the current ones');
  }
  {
    // Flying in from an orbit view: the glide starts from the camera itself, even looking steeply down.
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(3, 20, 3);
    camera.lookAt(0, 0, 0);
    const dom = new EventTarget();
    const walker = new WalkController(camera, dom, { isDown: () => false });
    check(near(walker.getPose().yaw, Math.PI / 4, 1e-9) && walker.getPose().pitch === -0.95, 'a new walker starts from the camera heading (pitch clamped)');
    void walker.setPose({ x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 }, { duration: 1 });
    walker.update(0.001);
    const first = walker.getPose();
    check(near(first.x, 3, 1e-3) && near(first.y, 20, 1e-3) && first.pitch < -0.95, `the glide starts from the camera's real pose, not a jump ${fmt(first)}`);
  }

  // ------------------------------------------------------------------ 4
  section('4. Drag to look');
  {
    const { walker, dom } = makeWalker();
    drag(dom, [100, 100], [[103, 100]]);
    check(samePose(walker.getPose(), START), 'a 3 px drag is a tap: the view does not move');
    drag(dom, [100, 100], [[104, 104]]);
    check(samePose(walker.getPose(), START), 'a 5.7 px drag is still a tap');
    drag(dom, [100, 100], [[120, 110]]);
    const p = walker.getPose();
    check(near(p.yaw, -0.1, 1e-12) && near(p.pitch, -0.05, 1e-12), `dragging right/down: yaw -= dx*0.005, pitch -= dy*0.005 (yaw ${p.yaw}, pitch ${p.pitch})`);
    drag(dom, [100, 100], [[103, 100], [110, 100], [70, 80]]);
    const q = walker.getPose();
    check(near(q.yaw, -0.1 + 30 * 0.005, 1e-12) && near(q.pitch, -0.05 + 20 * 0.005, 1e-12), 'past the threshold the view follows the pointer from where it was pressed, both ways');
  }
  {
    const { walker, dom } = makeWalker();
    drag(dom, [0, 0], [[0, -1000]]);
    check(walker.getPose().pitch === 0.95, 'looking up clamps at +0.95 rad');
    drag(dom, [0, 0], [[0, 5000]]);
    check(walker.getPose().pitch === -0.95, 'looking down clamps at -0.95 rad');
  }
  {
    const { walker, dom } = makeWalker();
    drag(dom, [0, 0], [[50, 0]], { pointerType: 'mouse', button: 2, buttons: 2 });
    check(samePose(walker.getPose(), START), 'a right-button mouse drag does not look');
    drag(dom, [0, 0], [[50, 0]], { pointerType: 'mouse', button: 0, buttons: 1 });
    check(near(walker.getPose().yaw, -0.25, 1e-12), 'a left-button mouse drag looks');
    drag(dom, [0, 0], [[0, 20]], { pointerType: 'pen' });
    check(near(walker.getPose().pitch, -0.1, 1e-12), 'a pen drag looks');
  }
  {
    const { walker, dom } = makeWalker();
    dom.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
    dom.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 0, clientY: 0 }));
    dom.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 80, clientY: 0 }));
    check(samePose(walker.getPose(), START), 'a second finger is ignored');
    dom.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 50, clientY: 0 }));
    check(near(walker.getPose().yaw, -0.25, 1e-12), 'the first finger keeps looking');
    dom.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
    dom.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 100, clientY: 0 }));
    check(near(walker.getPose().yaw, -0.25, 1e-12), 'after release, moves do nothing');
  }
  {
    const { walker, dom } = makeWalker();
    let downDefaultPrevented = false;
    dom.addEventListener('pointerdown', (e) => (downDefaultPrevented ||= e.defaultPrevented));
    drag(dom, [0, 0], [[40, 0]]);
    check(!downDefaultPrevented, 'pointerdown is never prevented (taps still select objects)');
    // A mouse released off the canvas: the next press (same pointer) starts fresh.
    dom.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 }));
    dom.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientX: 500, clientY: 0 }));
    dom.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', clientX: 520, clientY: 0 }));
    check(near(walker.getPose().yaw, -0.2 - 0.1, 1e-12), 'a lost mouse-up does not leave the look stuck: the next press starts from its own point');
    dom.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', buttons: 0, clientX: 900, clientY: 0 }));
    check(near(walker.getPose().yaw, -0.3, 1e-12), 'a mouse move with no buttons down ends the drag');
  }
  {
    const { walker, dom } = makeWalker();
    let blocked = true;
    walker.setLookBlocked(() => blocked);
    drag(dom, [0, 0], [[60, 30]]);
    check(samePose(walker.getPose(), START), 'while lookBlocked() is true dragging does not look');
    blocked = false;
    dom.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0 }));
    blocked = true;
    dom.dispatchEvent(pointer('pointermove', { clientX: 60, clientY: 0 }));
    blocked = false;
    dom.dispatchEvent(pointer('pointermove', { clientX: 90, clientY: 0 }));
    dom.dispatchEvent(pointer('pointerup', { clientX: 90, clientY: 0 }));
    check(samePose(walker.getPose(), START), 'a press claimed by a gizmo mid-drag stays out of looking even after the gizmo lets go');
    walker.setLookBlocked(null);
    drag(dom, [0, 0], [[20, 0]]);
    check(near(walker.getPose().yaw, -0.1, 1e-12), 'with no blocker, looking works again');
  }

  // ------------------------------------------------------------------ 5
  section('5. Enable / disable, camera output, focus, dispose');
  {
    const { walker, held, dom, camera } = makeWalker();
    walker.setEnabled(false);
    check(walker.enabled === false, 'setEnabled(false) reports disabled');
    held.add('KeyW');
    walker.setMoveInput(1, 0);
    run(walker, 1);
    drag(dom, [0, 0], [[100, 100]]);
    check(samePose(walker.getPose(), START), 'disabled: keys, joystick and drags do nothing');
    camera.position.set(9, 9, 9);
    walker.update(STEP);
    check(camera.position.x === 9, 'disabled: update leaves the camera alone');
    walker.setEnabled(true);
    run(walker, 0.5);
    check(walker.getPose().z < -0.3 && walker.getPose().x > 0.3, 'enabled again: walking resumes');

    let jumpResolved = false;
    walker.setEnabled(false);
    void walker.setPose(START, { duration: 1 }).then(() => (jumpResolved = true));
    await flush();
    check(jumpResolved && samePose(walker.getPose(), START), 'setPose while disabled jumps and resolves at once');
  }
  {
    const { walker, camera } = makeWalker({ x: 1, y: 1.6, z: 2, yaw: 0, pitch: -0.4 });
    walker.update(STEP);
    check(camera.rotation.order === 'YXZ', "camera.rotation.order is 'YXZ'");
    check(camera.position.x === 1 && camera.position.y === 1.6 && camera.position.z === 2, 'camera.position is the walker eye');
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    check(near(look.x, 0, 1e-9) && near(look.y, Math.sin(-0.4), 1e-9) && near(look.z, -Math.cos(-0.4), 1e-9), 'the camera looks along -Z, tilted down by the pitch');
    check(near(walker.focus.x, 1, 1e-12) && near(walker.focus.y, 0.15, 1e-12) && near(walker.focus.z, -0.5, 1e-12), `focus is 2.5 m ahead on the floor (${walker.focus.toArray().map((v) => v.toFixed(3)).join(', ')})`);
    void walker.setPose({ x: 0, y: 1.6, z: 0, yaw: Math.PI / 2, pitch: 0 });
    check(near(walker.focus.x, -2.5, 1e-12) && near(walker.focus.z, 0, 1e-12), 'focus follows the heading (yaw PI/2: 2.5 m toward -X)');
    const turned = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    check(near(turned.x, -1, 1e-9) && near(turned.z, 0, 1e-9), 'yaw PI/2 looks toward -X');
  }
  {
    const { walker, dom } = makeWalker();
    walker.dispose();
    drag(dom, [0, 0], [[100, 0]]);
    check(samePose(walker.getPose(), START), 'after dispose, pointers are no longer heard');
  }

  // ------------------------------------------------------------------ 6
  section('6. World camera-driver seam');
  {
    let World = null;
    try {
      ({ World } = await load('/src/world/World.ts'));
    } catch (error) {
      console.log(`  (World.ts could not be loaded headless: ${error.message})`);
    }
    check(World !== null, 'World.ts loads without a DOM or WebGL');
    if (World) {
      const log = [];
      const target = new THREE.Vector3(1, 0, 2);
      const fake = {
        driver: null,
        camera: { position: new THREE.Vector3(1, 3, 6) },
        cameraController: {
          target,
          update: (dt) => log.push(['orbit', dt]),
          setSuspended: (on) => log.push(['suspend', on]),
        },
        environment: { update: (dt, focus, distance) => log.push(['environment', dt, focus, distance]) },
        grid: { update: (dt) => log.push(['grid', dt]) },
      };
      const getDriver = Object.getOwnPropertyDescriptor(World.prototype, 'cameraDriver').get;
      World.prototype.update.call(fake, 0.02);
      check(
        log.length === 3 && log[0][0] === 'orbit' && log[0][1] === 0.02 && log[1][0] === 'environment' && log[1][2] === target && log[1][3] === 5 && log[2][0] === 'grid',
        'without a driver: orbit camera update, then environment at the orbit target and camera distance (unchanged)',
      );
      check(getDriver.call(fake) === null, 'cameraDriver is null by default');

      const { walker, held } = makeWalker();
      World.prototype.setCameraDriver.call(fake, walker);
      check(getDriver.call(fake) === walker, 'setCameraDriver stores the driver');
      check(log.at(-1)[0] === 'suspend' && log.at(-1)[1] === true, 'setting a driver suspends the orbit controls');
      log.length = 0;
      held.add('KeyW');
      World.prototype.update.call(fake, 0.02);
      check(!log.some((entry) => entry[0] === 'orbit'), 'with a driver the orbit camera is not updated at all');
      check(log[0][0] === 'environment' && log[0][2] === walker.focus && log[0][3] === 14, "the environment follows the driver's focus with view distance 14");
      check(walker.getPose().z < 0, 'the driver itself was updated');
      World.prototype.setCameraDriver.call(fake, walker);
      check(log.filter((entry) => entry[0] === 'suspend').length === 0, 'setting the same driver again changes nothing');
      World.prototype.setCameraDriver.call(fake, null);
      check(getDriver.call(fake) === null && log.at(-1)[0] === 'suspend' && log.at(-1)[1] === false, 'clearing the driver hands the camera back to the orbit controls');
      log.length = 0;
      World.prototype.update.call(fake, 0.02);
      check(log[0][0] === 'orbit' && log[1][2] === target, 'and the orbit camera drives again');
    }
  }

  // ------------------------------------------------------------------ 7
  section('7. CameraController: snapshot, restore, polar limits, suspension');
  {
    const { CameraController } = await load('/src/world/CameraController.ts');
    const rootNode = new EventTarget();
    const makeDom = () =>
      Object.assign(new EventTarget(), {
        style: {},
        clientWidth: 800,
        clientHeight: 600,
        ownerDocument: rootNode,
        getRootNode: () => rootNode,
        setPointerCapture() {},
        releasePointerCapture() {},
        hasPointerCapture: () => false,
      });
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    camera.position.set(4, 3, 4);
    const cc = new CameraController(camera, makeDom());
    const controls = cc.controls;
    check(controls.minPolarAngle === 0.05 && controls.maxPolarAngle === Math.PI / 2 - 0.08 && controls.minDistance === 1.5 && controls.maxDistance === 240, 'default limits are unchanged');
    check(controls.enabled === true && cc.isSuspended === false, 'enabled and not suspended by default');

    cc.frame({ x: 2, y: 0, z: -3 }, { distance: 10, azimuth: 30, elevation: 40 });
    const snap = cc.snapshot();
    check(near(snap.target.x, 2) && near(snap.target.z, -3) && near(Math.hypot(snap.position.x - 2, snap.position.y, snap.position.z + 3), 10, 1e-6), 'snapshot records the eye and the target');
    check(snap.limits.minDistance === 1.5 && snap.limits.halfSize === null && snap.minPolar === 0.05 && snap.maxPolar === Math.PI / 2 - 0.08, 'snapshot records limits and polar limits');
    check(snap.limits !== cc.snapshot().limits && !(snap.position instanceof THREE.Vector3), 'snapshot is plain, independent data');

    cc.setPolarLimits(0.2, 2.4);
    check(controls.minPolarAngle === 0.2 && controls.maxPolarAngle === 2.4, 'setPolarLimits widens the tilt (e.g. to look up at a tower)');
    cc.setLimits({ minDistance: 3, maxDistance: 50, halfSize: 100 });
    check(controls.minPolarAngle === 0.2 && controls.minDistance === 3, 'setLimits keeps the polar limits');
    cc.setPolarLimits(null, 2);
    check(controls.minPolarAngle === 0.05 && controls.maxPolarAngle === 2, 'null restores the default for that end only');
    cc.setPolarLimits(null, null);
    check(controls.minPolarAngle === 0.05 && controls.maxPolarAngle === Math.PI / 2 - 0.08, 'null, null restores both defaults');
    cc.setPolarLimits(2, 1);
    check(controls.minPolarAngle === 2 && controls.maxPolarAngle === 2, 'a max below the min is raised to the min');

    // Jump restore.
    cc.setPolarLimits(0.3, 1.2);
    cc.frame({ x: 40, y: 0, z: 40 }, { distance: 30 });
    cc.restore(snap);
    const p = camera.position;
    check(near(p.x, snap.position.x, 1e-6) && near(p.y, snap.position.y, 1e-6) && near(p.z, snap.position.z, 1e-6) && cc.target.equals(new THREE.Vector3(2, 0, -3)), 'restore jumps back to the snapshot eye and target');
    check(controls.minPolarAngle === 0.05 && controls.maxPolarAngle === Math.PI / 2 - 0.08 && controls.minDistance === 1.5 && controls.maxDistance === 240 && !cc.isTransitioning, 'restore brings back limits and polar limits');
    const again = cc.snapshot();
    const fields = ['x', 'y', 'z'];
    check(
      fields.every((f) => near(again.position[f], snap.position[f], 1e-6) && near(again.target[f], snap.target[f], 1e-6)) &&
        again.limits.minDistance === snap.limits.minDistance &&
        again.limits.maxDistance === snap.limits.maxDistance &&
        again.limits.halfSize === snap.limits.halfSize &&
        again.minPolar === snap.minPolar &&
        again.maxPolar === snap.maxPolar,
      'a snapshot after restoring matches the original in every field',
    );

    // A snapshot that went through JSON storage with broken values must not poison the camera.
    const broken = JSON.parse(
      JSON.stringify({
        position: { x: NaN, y: 5, z: 5 },
        target: { x: 1, y: 0, z: 1 },
        limits: { minDistance: NaN, maxDistance: null, halfSize: Infinity },
        minPolar: NaN,
        maxPolar: null,
      }),
    );
    const eyeBefore = camera.position.clone();
    cc.restore(broken);
    check(controls.minPolarAngle === 0.05 && controls.maxPolarAngle === Math.PI / 2 - 0.08, 'restore: broken polar limits (NaN, null) fall back to the defaults');
    check(controls.minDistance === 1.5 && controls.maxDistance === 240 && cc.snapshot().limits.halfSize === null, 'restore: broken limits fall back to the site defaults');
    check(
      [camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite) && camera.position.distanceTo(eyeBefore) < 1e-3 && cc.target.distanceTo(new THREE.Vector3(1, 0, 1)) < 1e-6,
      'restore: a broken eye keeps the current one (no NaN reaches the camera), a good target is used',
    );
    cc.restore({ ...snap, minPolar: 2, maxPolar: 9 });
    check(controls.minPolarAngle === 2 && controls.maxPolarAngle === Math.PI, 'restore: polar limits are clamped like setPolarLimits');
    cc.restore(snap);

    // Animated restore from a first-person pose (camera aimed by a walker, far below the polar limit).
    cc.setSuspended(true);
    check(controls.enabled === false, 'suspended: the orbit controls ignore input');
    cc.setEnabled(true);
    check(controls.enabled === false, 'setEnabled(true) cannot wake suspended controls (e.g. a gizmo drag ending)');
    camera.position.set(6, 1.6, 6);
    camera.rotation.set(0.2, 0.7, 0, 'YXZ');
    const lookBefore = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    cc.setSuspended(false);
    check(controls.enabled === true, 'unsuspended: controls are enabled again as last asked');
    cc.restore(snap, { animate: true, duration: 1 });
    check(cc.isTransitioning, 'restore with animate starts an easing move');
    check(controls.minDistance === 0 && controls.maxPolarAngle === Math.PI, 'clamps are opened wide while the restore move runs');
    cc.update(0.0005);
    const lookAfter = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    check(camera.position.distanceTo(new THREE.Vector3(6, 1.6, 6)) < 0.01, `the move starts at the walker eye, no snap (moved ${camera.position.distanceTo(new THREE.Vector3(6, 1.6, 6)).toFixed(5)} m)`);
    check(lookBefore.dot(lookAfter) > 0.9999, 'and looking the same way the walker looked');
    for (let i = 0; i < 70; i++) cc.update(STEP);
    check(!cc.isTransitioning, 'the restore move finishes');
    check(near(camera.position.x, snap.position.x, 1e-4) && near(camera.position.y, snap.position.y, 1e-4) && near(camera.position.z, snap.position.z, 1e-4), 'and ends on the snapshot eye');
    check(cc.target.distanceTo(new THREE.Vector3(2, 0, -3)) < 1e-6, 'looking at the snapshot target');
    check(controls.minDistance === 1.5 && controls.minPolarAngle === 0.05 && controls.maxPolarAngle === Math.PI / 2 - 0.08, 'the snapshot limits are back in force afterwards');

    // cancelTransition and transitionToPose.
    cc.transitionTo({ x: 30, y: 0, z: 0 }, { distance: 20 });
    cc.update(0.2);
    const midway = camera.position.clone();
    cc.cancelTransition();
    cc.update(STEP);
    check(!cc.isTransitioning && camera.position.distanceTo(midway) < 0.5, 'cancelTransition stops the move where it is');
    cc.restore(snap, { animate: true });
    cc.cancelTransition();
    check(controls.minDistance === 1.5 && controls.maxPolarAngle === Math.PI / 2 - 0.08, 'cancelling a restore move puts the real clamps back');
    const before = cc.target.clone();
    cc.transitionToPose({ x: 0, y: 10, z: 10 }, { x: 0, y: 0, z: 0 }, 0.5);
    cc.update(0);
    check(cc.target.distanceTo(before) < 1e-6, 'transitionToPose from the orbit view starts from the current target (seamless)');
    for (let i = 0; i < 40; i++) cc.update(STEP);
    check(!cc.isTransitioning && camera.position.distanceTo(new THREE.Vector3(0, 10, 10)) < 1e-4 && cc.target.length() < 1e-6, 'transitionToPose ends on the explicit eye and target');

    cc.transitionTo({ x: 5, y: 0, z: 5 });
    cc.setSuspended(true);
    check(!cc.isTransitioning, 'suspending stops any easing move');
    cc.setEnabled(false);
    cc.setSuspended(false);
    check(controls.enabled === false, 'unsuspending respects a setEnabled(false) made meanwhile');
    cc.setEnabled(true);

    // Default behaviour regression: preset transitions land where they always did.
    cc.frame({ x: 0, y: 0, z: 0 }, { distance: 14, azimuth: 0, elevation: 42 });
    cc.setPreset('town');
    cc.finishTransition();
    check(near(cc.distance, 95, 1e-3) && near(cc.azimuth, 0, 1e-3), 'presets still ease to the same views');
    cc.dispose();
  }

  // ------------------------------------------------------------------ 8
  section('8. KeyboardInput: held keys, keyup, blur and visibility');
  {
    globalThis.document = Object.assign(new EventTarget(), { hidden: false });
    const { KeyboardInput } = await load('/src/input/KeyboardInput.ts');
    const key = (type, fields) => Object.assign(new Event(type), { code: '', key: '', shiftKey: false, ...fields });
    const kb = new KeyboardInput();
    const downs = [];
    const ups = [];
    kb.on('keydown', (k) => downs.push(k));
    kb.on('keyup', (k) => ups.push(k));

    window.dispatchEvent(key('keydown', { code: 'KeyW', key: 'w' }));
    check(downs.length === 1 && downs[0].code === 'KeyW' && downs[0].shift === false && kb.isDown('KeyW'), "'keydown' is emitted as before, and the key is held");
    window.dispatchEvent(key('keydown', { code: 'KeyW', key: 'w' }));
    check(downs.length === 2 && kb.isDown('KeyW'), 'auto-repeat keeps emitting keydown (unchanged) and the key stays held');
    window.dispatchEvent(key('keydown', { key: 'a', shiftKey: true }));
    check(downs[2].code === 'KeyA' && downs[2].shift === true && kb.isDown('KeyA'), 'events without `code` still map from `key` (KeyA)');
    window.dispatchEvent(key('keyup', { code: 'KeyW', key: 'w', shiftKey: true }));
    check(!kb.isDown('KeyW') && ups.length === 1 && ups[0].code === 'KeyW' && ups[0].shift === true, "'keyup' is emitted with the same shape and the key is let go");
    window.dispatchEvent(key('keyup', { code: 'KeyZ' }));
    check(ups.length === 1, 'a key-up without an announced key-down is not announced');

    window.dispatchEvent(key('keydown', { code: 'ArrowUp' }));
    window.dispatchEvent(new Event('blur'));
    check(!kb.isDown('ArrowUp') && !kb.isDown('KeyA'), 'losing window focus lets go of every held key');
    check(ups.length === 3 && ups.slice(1).every((k) => k.shift === false) && ups.map((k) => k.code).slice(1).sort().join() === 'ArrowUp,KeyA', 'each released key is announced with a keyup');
    window.dispatchEvent(key('keydown', { code: 'KeyD' }));
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    check(!kb.isDown('KeyD'), 'hiding the tab lets go of every held key');
    document.hidden = false;

    globalThis.HTMLElement = class HTMLElement {};
    class FakeInput extends globalThis.HTMLElement {
      tagName = 'INPUT';
      isContentEditable = false;
    }
    const typed = key('keydown', { code: 'KeyS', key: 's' });
    Object.defineProperty(typed, 'target', { value: new FakeInput() });
    const downsBefore = downs.length;
    window.dispatchEvent(typed);
    check(!kb.isDown('KeyS') && downs.length === downsBefore, 'typing in a text input neither emits keydown nor holds the key');
    window.dispatchEvent(key('keydown', { code: 'KeyW' }));
    const upInInput = key('keyup', { code: 'KeyW' });
    Object.defineProperty(upInInput, 'target', { value: new FakeInput() });
    const upsBefore = ups.length;
    window.dispatchEvent(upInInput);
    check(!kb.isDown('KeyW') && ups.length === upsBefore + 1, 'a held key let go inside a text input is still released (never stuck)');
    delete globalThis.HTMLElement;

    window.dispatchEvent(key('keydown', { code: 'KeyQ' }));
    kb.dispose();
    check(!kb.isDown('KeyQ'), 'dispose clears held keys');
    window.dispatchEvent(key('keydown', { code: 'KeyE' }));
    check(!kb.isDown('KeyE'), 'after dispose no keys are heard');

    // The real keyboard drives a real walker.
    const kb2 = new KeyboardInput();
    const camera = new THREE.PerspectiveCamera();
    const walker = new WalkController(camera, new EventTarget(), kb2);
    void walker.setPose(START);
    window.dispatchEvent(key('keydown', { code: 'KeyW' }));
    run(walker, 0.5);
    const walked = walker.getPose().z;
    window.dispatchEvent(new Event('blur'));
    run(walker, 0.5);
    const stopped = walker.getPose().z;
    run(walker, 0.5);
    check(walked < -0.5 && walker.getPose().z === stopped, 'KeyboardInput drives the walker, and a window blur stops it walking on its own');
    kb2.dispose();
    delete globalThis.document;
  }

  // ------------------------------------------------------------------ 9
  section('9. VirtualJoystick');
  {
    const { VirtualJoystick, joystickValue } = await load('/src/ui/interior/VirtualJoystick.ts');
    check(typeof VirtualJoystick === 'function', 'the module imports headless (no DOM touched at import)');
    const v = (dx, dy) => joystickValue(dx, dy);
    check(v(0, 0).x === 0 && v(0, 0).y === 0, 'centre is (0, 0)');
    check(v(3, 0).x === 0 && v(0, -3).y === 0, 'the inner 10% is a dead zone');
    check(near(v(32, 0).x, 1) && v(32, 0).y === 0, 'full right is x = 1');
    check(near(v(0, -32).y, 1) && v(0, -32).x === 0, 'pushing up (screen y down) is forward, y = 1');
    check(near(v(0, 32).y, -1), 'pushing down is backward, y = -1');
    check(near(v(500, 0).x, 1), 'past the rim stays at 1');
    check(near(v(16, 0).x, (0.5 - 0.1) / 0.9, 1e-12), 'between the dead zone and the rim the value rises from 0 to 1');
    const diag = v(40, -40);
    check(near(Math.hypot(diag.x, diag.y), 1, 1e-12) && diag.x > 0 && diag.y > 0, 'a diagonal push stays within the unit circle');

    // A minimal DOM, just enough for the pad.
    class FakeElement extends EventTarget {
      constructor(tag, doc) {
        super();
        this.tagName = tag.toUpperCase();
        this.ownerDocument = doc;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.style = { transform: '' };
        this.hidden = false;
        this.id = '';
        this.className = '';
        this.textContent = '';
        this.captured = new Set();
        const classes = new Set();
        this.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
      }
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
      }
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      }
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      }
      remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
        this.parentNode = null;
      }
      getBoundingClientRect() {
        return { left: 100, top: 200, width: 112, height: 112 };
      }
      setPointerCapture(id) {
        this.captured.add(id);
      }
      hasPointerCapture(id) {
        return this.captured.has(id);
      }
      releasePointerCapture(id) {
        this.captured.delete(id);
      }
    }
    const doc = {
      createElement: (tag) => new FakeElement(tag, doc),
      getElementById: (id) => doc.head.children.find((c) => c.id === id) ?? null,
    };
    doc.head = new FakeElement('head', doc);
    const parent = new FakeElement('div', doc);

    const changes = [];
    const pad = new VirtualJoystick(parent, (x, y) => changes.push([x, y]));
    const second = new VirtualJoystick(parent, () => {}, { label: 'Move around' });
    const padEl = parent.children[0];
    const knob = padEl.children[0];
    check(doc.head.children.filter((c) => c.tagName === 'STYLE').length === 1 && doc.head.children[0].id === 'ev-joy-style', 'the stylesheet is added once for any number of pads');
    check(doc.head.children[0].textContent.includes('.ev-joy__knob'), "its class names are prefixed 'ev-joy'");
    check(padEl.className === 'ev-joy' && knob.className === 'ev-joy__knob', 'a round pad with a knob');
    // A labelled group (not role="application": it takes no keyboard focus - keyboard users walk with W A S D).
    check(padEl.getAttribute('role') === 'group' && padEl.getAttribute('aria-label') === 'Walk: drag to move, or use the arrow keys', 'role="group" with the default aria-label');
    check(parent.children[1].getAttribute('aria-label') === 'Move around', 'the aria-label can be changed');

    // Centre of the pad is (156, 256).
    const down = pointer('pointerdown', { pointerId: 7, clientX: 156 + 32, clientY: 256 });
    padEl.dispatchEvent(down);
    check(down.defaultPrevented, 'pressing the pad prevents scrolling/selection');
    check(padEl.captured.has(7) && padEl.classList.contains('ev-joy--active'), 'the pointer is captured');
    check(changes.length === 1 && near(changes[0][0], 1) && changes[0][1] === 0, `pressing at the right rim reports (1, 0) (${changes[0]})`);
    padEl.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 156, clientY: 256 - 80 }));
    check(changes.length === 2 && changes[1][0] === 0 && near(changes[1][1], 1), 'dragging up reports forward (0, 1)');
    check(knob.style.transform === 'translate(0px, -32px)', `the knob stays inside the rim (${knob.style.transform})`);
    padEl.dispatchEvent(pointer('pointermove', { pointerId: 8, clientX: 156 + 50, clientY: 256 }));
    check(changes.length === 2, 'a second finger is ignored');
    padEl.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 156, clientY: 256 - 90 }));
    check(changes.length === 2, 'repeating the same value is not reported again');
    padEl.dispatchEvent(pointer('pointerup', { pointerId: 7 }));
    check(changes.length === 3 && changes[2][0] === 0 && changes[2][1] === 0, 'letting go reports (0, 0)');
    check(knob.style.transform === '' && !padEl.captured.has(7) && !padEl.classList.contains('ev-joy--active'), 'and the knob springs back to the centre');

    padEl.dispatchEvent(pointer('pointerdown', { pointerId: 9, clientX: 156 - 20, clientY: 256 + 20 }));
    const pushed = changes.at(-1);
    check(pushed[0] < 0 && pushed[1] < 0, 'pressing down-left reports left and backward');
    padEl.dispatchEvent(pointer('pointercancel', { pointerId: 9 }));
    check(changes.at(-1)[0] === 0 && changes.at(-1)[1] === 0, 'a cancelled touch reports (0, 0)');
    const count = changes.length;
    padEl.dispatchEvent(pointer('pointerdown', { pointerId: 10, clientX: 157, clientY: 256 }));
    padEl.dispatchEvent(pointer('pointerup', { pointerId: 10 }));
    check(changes.length === count + 1 && changes.at(-1)[0] === 0, 'a tap inside the dead zone still reports its release');

    padEl.dispatchEvent(pointer('pointerdown', { pointerId: 11, clientX: 156 + 40, clientY: 256 }));
    pad.setVisible(false);
    check(padEl.hidden === true && changes.at(-1)[0] === 0 && changes.at(-1)[1] === 0, 'hiding the pad lets go of the knob');
    pad.setVisible(true);
    check(padEl.hidden === false, 'and it can be shown again');

    pad.dispose();
    second.dispose();
    check(parent.children.length === 0, 'dispose removes the pads');
    const after = changes.length;
    padEl.dispatchEvent(pointer('pointerdown', { pointerId: 12, clientX: 156 + 40, clientY: 256 }));
    check(changes.length === after, 'a disposed pad no longer reports');

    // The pad steers a walker.
    const { walker } = makeWalker();
    const stick = new VirtualJoystick(parent, (x, y) => walker.setMoveInput(x, y));
    const stickEl = parent.children[0];
    stickEl.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 156, clientY: 256 - 40 }));
    run(walker, 1);
    stickEl.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
    run(walker, 0.3);
    const p = walker.getPose();
    run(walker, 0.3);
    check(p.z < -1.2 && walker.getPose().z === p.z, 'pushing the pad forward walks, letting go stops');
    stick.dispose();
  }
} finally {
  await server.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
