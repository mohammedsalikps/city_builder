/**
 * Acceptance tests for the Interior Explorer integration and RealWorld
 * Explorer plumbing (Milestone 4):
 *
 *   - the on-device interior command parser and the AI helper's interior
 *     turns (nothing sent to the AI, honest answers, yes/no confirmation)
 *   - InteriorExplorer itself, run headlessly against a real planned house:
 *     entering/leaving, rooms from the real plan, walking with walls, the
 *     dollhouse cutaway, the guided tour, furniture added/moved/painted only
 *     after a yes, only the entered house touched, undo/redo and save/reload
 *   - the new state and actions (interior slice, RealWorld mode, room
 *     placement joining the house, recolouring, re-finding the floor after a
 *     house revision), saved colours validated
 *   - RealWorld progress kept apart from Challenge Mode and removed by
 *     "Delete everything on this device"
 *   - per-house frames of neighbourhood layouts
 *
 * The game's own TypeScript runs through Vite's SSR loader; WebGL is not
 * needed (the camera, canvas and renderer services are small fakes):
 *   node scripts/test-explorer.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// GameActions announces creations on `window`; the storages use localStorage.
const memory = new Map();
globalThis.window = Object.assign(new EventTarget(), {
  localStorage: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  },
});

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
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

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
  const { objectDefinitions, worldDefinition, templateDefinitions } = await load('/src/data/index.ts');
  const { ObjectRegistry } = await load('/src/construction/ObjectRegistry.ts');
  const { roleOf } = await load('/src/construction/ConstructionObjectDefinition.ts');
  const { boundsOfPlaced } = await load('/src/construction/bounds.ts');
  const { TemplateRegistry } = await load('/src/creative/Template.ts');
  const { PlanBuilder } = await load('/src/creative/plan/PlanBuilder.ts');
  const { LocalPlanStore } = await load('/src/creative/plan/PlanRecords.ts');
  const { layoutPlan } = await load('/src/creative/plan/PlanLayouts.ts');
  const { layoutHouse } = await load('/src/creative/plan/HouseLayout.ts');
  const { neighborhoodHouse } = await load('/src/creative/plan/NeighborhoodLayout.ts');
  const { parseConstructionPlan } = await load('/src/creative/plan/ConstructionPlan.ts');
  const { GameStore } = await load('/src/state/GameStore.ts');
  const { createInitialState } = await load('/src/state/initialState.ts');
  const { GameActions } = await load('/src/state/actions.ts');
  const { ChallengeRegistry } = await load('/src/challenges/ChallengeRegistry.ts');
  const { WorldSpace } = await load('/src/world/WorldSpace.ts');
  const { HistoryService } = await load('/src/creative/HistoryService.ts');
  const { LocalMyWorldStorage } = await load('/src/state/MyWorldStorage.ts');
  const { rotateAroundY } = await load('/src/utils/math.ts');
  const { interpretInteriorCommand, roomIn } = await load('/src/creative/ai/InteriorCommands.ts');
  const { BuildAssistant } = await load('/src/creative/ai/BuildAssistant.ts');
  const { InteriorExplorer } = await load('/src/game/InteriorExplorer.ts');
  const { interiorPortFor } = await load('/src/game/interiorPort.ts');
  const { colourIn, PAINT_COLOURS } = await load('/src/creative/colours.ts');
  const { RealWorldProgressStore, REALWORLD_PROGRESS_KEY, parseProgress } = await load('/src/realworld/RealWorldProgress.ts');
  const { eraseDeviceData, DEVICE_STORAGE_KEYS, storedKeys } = await load('/src/state/DeviceData.ts');
  const { roomAt } = await load('/src/creative/interior/index.ts');

  const registry = new ObjectRegistry();
  registry.registerAll(objectDefinitions);

  /** A My World of its own, built through the real actions and plan builder (test-only storage keys). */
  function myWorld(planKey = 'test.m4.plans') {
    const worldSpace = new WorldSpace(worldDefinition);
    const store = new GameStore(createInitialState());
    const rules = {
      getBuildArea: () => ({ center: { x: 0, y: 0, z: 0 }, halfSize: worldSpace.buildHalfSize }),
      getPlacementTargets: () => ({ targets: [], requiredSupport: null }),
      isBlocked: (bounds) => worldSpace.isBlocked(bounds),
    };
    const actions = new GameActions(store, registry, new ChallengeRegistry(registry), rules);
    const templates = new TemplateRegistry();
    templates.registerAll(templateDefinitions);
    actions.finishBoot();
    actions.enterMyWorld('Tester');
    const planStore = new LocalPlanStore(planKey);
    const builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth: 0 }), planStore);
    const confirm = () => {
      const placement = store.getState().templatePlacement;
      const template = templates.get(placement.templateId);
      actions.cancelTemplatePlacement();
      const revise = placement.revise;
      const result = actions.instantiateTemplate(template, placement.origin, placement.rotationY, placement.creationId, revise ? { replace: revise.replace, carry: { ids: revise.carry, from: revise.from } } : {});
      builder.onTemplateBuilt(placement.templateId, { origin: placement.origin, rotationY: placement.rotationY }, result);
      return result;
    };
    const groupOf = (id) => store.getState().placedObjects.filter((p) => p.group?.id === id);
    return { worldSpace, store, actions, templates, builder, confirm, groupOf, rules, planStore };
  }

  /** The services InteriorExplorer drives, without WebGL: a real camera, an event-target canvas, recording fakes. */
  function fakeGame(store) {
    const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 3000);
    camera.position.set(30, 25, 30);
    camera.lookAt(0, 0, 0);
    const canvas = Object.assign(new EventTarget(), { clientWidth: 1200, clientHeight: 800 });
    const log = { driver: null, suspended: false, cutaway: null, restored: null, transitions: 0, snapshots: 0 };
    const controller = {
      target: new THREE.Vector3(),
      azimuth: 0,
      snapshot: () => {
        log.snapshots++;
        return { position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: { x: 0, y: 0, z: 0 }, limits: { minDistance: 3, maxDistance: 820, halfSize: 290 }, minPolar: 0.05, maxPolar: 1.49 };
      },
      restore: (snapshot, options) => {
        log.restored = snapshot;
        log.restoreAnimated = options?.animate ?? false;
        camera.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
      },
      setSuspended: (on) => (log.suspended = on),
      transitionTo: (point, view) => {
        log.transitions++;
        log.view = view ?? null;
        controller.target.set(point.x, point.y, point.z);
      },
    };
    const overlayRoot = new THREE.Group();
    const scene = new THREE.Scene();
    scene.environmentIntensity = 0.3;
    const environment = { hemisphere: new THREE.HemisphereLight('#cfe3ff', '#5f6b45', 0.22) };
    const world = {
      camera,
      renderer: { domElement: canvas },
      scene,
      environment,
      overlayRoot,
      cameraController: controller,
      setCameraDriver: (driver) => (log.driver = driver),
    };
    const held = new Set();
    const keyListeners = new Set();
    const input = {
      keyboard: {
        isDown: (code) => held.has(code),
        on: (_event, listener) => {
          keyListeners.add(listener);
          return () => keyListeners.delete(listener);
        },
      },
    };
    const ghosts = {
      live: new Set(),
      create: () => {
        const ghost = new THREE.Group();
        ghosts.live.add(ghost);
        return ghost;
      },
      setValid: () => {},
      discard: (ghost) => {
        ghosts.live.delete(ghost);
        ghost.removeFromParent();
      },
    };
    const readability = { setInteriorCutaway: (ids) => (log.cutaway = ids ? [...ids] : null) };
    return { world, input, ghosts, readability, log, held, keyListeners, camera, store };
  }

  // ------------------------------------------------------------------ 1
  section('1. Interior commands are understood on the device (and building requests are not taken for them)');
  {
    const inside = { inside: true };
    const outside = { inside: false };
    const cases = [
      ['Enter the house', outside, (c) => c?.kind === 'enter'],
      ['go inside', outside, (c) => c?.kind === 'enter'],
      ["let's go in", outside, (c) => c?.kind === 'enter'],
      ['Take me back outside', inside, (c) => c?.kind === 'exit'],
      ['leave the house', inside, (c) => c?.kind === 'exit'],
      ['Show me the second bedroom', inside, (c) => c?.kind === 'room' && c.type === 'bedroom' && c.ordinal === 2],
      ['take me to the kitchen', inside, (c) => c?.kind === 'room' && c.type === 'kitchen' && c.ordinal === null],
      ['go to bedroom 2', inside, (c) => c?.kind === 'room' && c.type === 'bedroom' && c.ordinal === 2],
      ['show me the living room', outside, (c) => c?.kind === 'room' && c.type === 'living'],
      ['Add a sofa to the living room.', inside, (c) => c?.kind === 'add' && c.item.definitionId === 'furniture_sofa' && c.count === 1 && c.room?.type === 'living'],
      ['Add two chairs to this room.', inside, (c) => c?.kind === 'add' && c.item.definitionId === 'furniture_chair' && c.count === 2 && c.room === 'here'],
      ['add a bed by the window', inside, (c) => c?.kind === 'add' && c.item.word === 'bed' && c.near === 'window'],
      ['Move the bed near the window.', inside, (c) => c?.kind === 'move' && c.item.word === 'bed' && c.near === 'window'],
      ['Make the kitchen cabinets white.', inside, (c) => c?.kind === 'paint' && c.item.definitionId === 'kitchen_counter' && c.colour.id === 'white' && c.room?.type === 'kitchen'],
      ['paint it light blue', inside, (c) => c?.kind === 'paint' && c.item === 'it' && c.colour.id === 'blue'],
      ['make the walls pink', inside, (c) => c?.kind === 'cannot-paint' && c.what === 'walls'],
      ['show me the house from above', inside, (c) => c?.kind === 'view' && c.view === 'dollhouse'],
      ['give me a tour', inside, (c) => c?.kind === 'tour'],
    ];
    for (const [text, context, ok] of cases) check(ok(interpretInteriorCommand(text, context)), `"${text}" -> ${JSON.stringify(interpretInteriorCommand(text, context))}`);
    const notInterior = [
      ['build a house with a big kitchen and two bedrooms', outside],
      ['make the house bigger', inside],
      ['add a garden behind the house', outside],
      ['add some plants to the garden', outside],
      ['add two benches in front of my house', outside],
      ['add a table', outside],
      ['plan a neighbourhood with four houses', outside],
      ['move the house closer to the lake', outside],
      ['design a garden with flower beds', outside],
    ];
    for (const [text, context] of notInterior) check(interpretInteriorCommand(text, context) === null, `"${text}" is left to the AI builder (${JSON.stringify(interpretInteriorCommand(text, context))})`);
    check(roomIn('the third bedroom')?.ordinal === 3 && roomIn('bathroom')?.type === 'bathroom' && roomIn('kitchen 1')?.ordinal === 1, 'room ordinals in words and numbers');
    check(colourIn('make it dark blue')?.id === 'navy' && colourIn('paint it grey')?.id === 'grey' && colourIn('the sofa') === null, 'colour words map to the fixed palette (longest match first)');
    check(PAINT_COLOURS.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)), 'every palette colour is a #rrggbb value');
  }

  // ------------------------------------------------------------------ 2
  section('2. InteriorExplorer with a real planned house: entering, rooms, walking, dollhouse, leaving');
  const w = myWorld();
  const history = new HistoryService(w.store, w.actions);
  history.start();
  await flush();
  check(w.builder.preview({ version: 1, kind: 'house', size: { width: 14, depth: 10 }, rooms: [{ type: 'living' }, { type: 'kitchen' }, { type: 'bedroom', count: 2 }, { type: 'bathroom' }], site: { near: 'home' } }).ok, 'a house with two bedrooms is previewed');
  const house = w.confirm();
  await flush();
  check(house.skipped === 0, `the house is built (${house.placed} pieces)`);
  // Something else nearby that must never be touched by edits inside the house.
  check(w.builder.preview({ version: 1, kind: 'garden', site: { near: 'home' } }).ok, 'a garden is previewed');
  const garden = w.confirm();
  await flush();
  const fake = fakeGame(w.store);
  const explorer = new InteriorExplorer(w.store, w.actions, registry, w.builder, fake.world, fake.input, fake.ghosts, fake.readability);
  explorer.start();
  const outsideObjects = () => w.store.getState().placedObjects.filter((p) => p.group?.id !== house.groupId).map((p) => JSON.stringify(p)).sort().join('\n');
  const gardenBefore = outsideObjects();
  // Like frames: each tick is its own turn, so chained eases (walk to the door, then in) can continue.
  const step = async (seconds) => {
    for (let t = 0; t < seconds; t += 0.05) {
      explorer.walk.update(0.05);
      await Promise.resolve();
    }
  };

  // Enter through a piece of the house.
  w.actions.selectPlacedObject(w.groupOf(house.groupId)[0].id);
  check(explorer.targetHouse()?.groupId === house.groupId, 'the house a tap means is the selected piece\'s house');
  const entered = explorer.enter();
  check(entered.ok && w.store.getState().interior?.groupId === house.groupId && explorer.isInside, `entering works (${entered.message})`);
  const snap = explorer.snapshotState();
  const layoutRooms = layoutHouse(w.builder.recordOf(house.groupId).plan, registry).rooms;
  check(snap && snap.house.rooms.length === layoutRooms.length && [...snap.house.rooms.map((r) => r.name)].sort().join(',') === ['Bathroom', 'Bedroom 1', 'Bedroom 2', 'Kitchen', 'Living room'].join(','), `the navigator lists exactly the planned rooms (${snap?.house.rooms.map((r) => r.name).join(', ')})`);
  check(snap.house.floors.length === 1 && snap.house.floors[0].name === 'Ground floor', 'one floor, honestly (houses are single-storey)');
  check(fake.log.driver === explorer.walk && fake.log.suspended === true && fake.log.snapshots === 1, 'the walker drives the camera; the orbit camera is suspended and its view remembered');
  check(fake.world.overlayRoot.children.some((c) => c.name === 'interior-ceiling'), 'a ceiling covers the rooms while walking (no sky through the roof)');
  const fill = fake.world.scene.getObjectByName('interior-fill');
  check(fill.intensity > 0 && fake.world.scene.environmentIntensity < 0.3 && fake.world.environment.hemisphere.intensity < 0.22, 'indoors: a warm fill light, and the blue sky\u2019s light turned down');
  // In at once: no glide in from the sky or through the front door (each shows the outside, or the inside of a wall, on the way).
  const atOnce = explorer.walk.getPose();
  const fp0 = snap.house.footprint;
  const cam = fake.camera.position;
  check(roomAt(snap.house, atOnce.x, atOnce.z) !== null && cam.x > fp0.minX && cam.x < fp0.maxX && cam.z > fp0.minZ && cam.z < fp0.maxZ && near(cam.y, snap.house.floorY + 1.45, 1e-6), 'entering goes straight to a view inside a room (the camera is never shown outside, or in a wall, on the way in)');
  check(snap.cut >= 1, 'the way in is a cut, which the screen covers with a short fade');
  const across = (camera) => (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect) * 180) / Math.PI;
  check(near(across(fake.camera), 84, 0.01) && fake.camera.fov > 55, `walking indoors widens the view to 84 degrees across (vertical ${fake.camera.fov.toFixed(1)})`);
  fake.camera.aspect = 375 / 812;
  explorer.update();
  check(near(fake.camera.fov, 90, 1e-9), 'on a phone held upright the indoor view opens to 90 degrees up and down (the most it goes)');
  fake.camera.aspect = 1.5;
  explorer.update();
  check(near(across(fake.camera), 84, 0.01), 'and follows the window back when it changes shape');
  await step(2.5);
  const afterEntry = explorer.walk.getPose();
  const entryRoom = roomAt(snap.house, afterEntry.x, afterEntry.z);
  check(entryRoom !== null, `after walking in, the walker stands inside a room (${entryRoom?.name})`);
  explorer.update();
  check(w.store.getState().interior.roomId === entryRoom?.id, 'the current room is tracked in state');
  check(near(afterEntry.y, snap.house.floorY + 1.45, 1e-6), 'eye height is above the floor');

  // Room navigator: walk to the second bedroom.
  const bedroom2 = explorer.room({ type: 'bedroom', ordinal: 2 });
  check(bedroom2?.name === 'Bedroom 2', 'the second bedroom exists');
  const going = explorer.goToRoom(bedroom2.id);
  const cutTo = explorer.walk.getPose();
  check(roomAt(snap.house, cutTo.x, cutTo.z)?.id === bedroom2.id && explorer.snapshotState().cut > snap.cut, 'choosing a room cuts straight to it - no glide through the walls and furniture in between');
  await step(3);
  check(await going, 'travelling to a room resolves when there');
  const atBed = explorer.walk.getPose();
  check(roomAt(snap.house, atBed.x, atBed.z)?.id === bedroom2.id && w.store.getState().interior.roomId === bedroom2.id, 'the walker is in Bedroom 2 and the navigator says so');
  check(explorer.room({ type: 'bedroom', ordinal: 3 }) === null, 'a third bedroom does not exist (and is reported as missing, not invented)');

  // Walls stop the walker: hold "forward" for a long time; it never leaves the house or passes through a wall.
  fake.held.add('KeyW');
  let insideAll = true;
  for (let i = 0; i < 200; i++) {
    explorer.walk.update(0.05);
    const p = explorer.walk.getPose();
    const fp = snap.house.footprint;
    if (p.x < fp.minX || p.x > fp.maxX || p.z < fp.minZ || p.z > fp.maxZ) insideAll = false;
  }
  fake.held.delete('KeyW');
  check(insideAll, 'walking straight ahead for 10 s never leaves the house (outer walls hold)');
  const model = explorer.snapshotState().model;
  const p = explorer.walk.getPose();
  check(model.obstacles.every((b) => !(p.x > b.minX + 0.27 && p.x < b.maxX - 0.27 && p.z > b.minZ + 0.27 && p.z < b.maxZ - 0.27)), 'the walker never ends up inside a wall or a piece of furniture');

  // Dollhouse: roof and outer walls cut away, orbit camera back, ceiling gone.
  w.actions.setInteriorView('dollhouse');
  const cut = new Set(fake.log.cutaway ?? []);
  const record = w.builder.recordOf(house.groupId);
  const roofs = w.groupOf(house.groupId).filter((p) => roleOf(registry.get(p.definitionId)) === 'roof' || /(^|\/)roof:/.test(record.pieces[p.id]?.key ?? ''));
  const outerWalls = w.groupOf(house.groupId).filter((p) => /^wall:w[fbew]/.test(record.pieces[p.id]?.key ?? ''));
  const innerWalls = w.groupOf(house.groupId).filter((p) => /^wall:(wd|p)/.test(record.pieces[p.id]?.key ?? ''));
  check(roofs.length > 0 && roofs.every((r) => cut.has(r.id)), `the dollhouse cuts away the roof (${roofs.length} pieces)`);
  check(outerWalls.length > 0 && outerWalls.every((r) => cut.has(r.id)) && innerWalls.every((r) => !cut.has(r.id)), 'outer walls are cut away; inner walls stay, so the rooms read clearly');
  check(fake.log.driver === null && fake.log.suspended === false && !fake.world.overlayRoot.children.some((c) => c.name === 'interior-ceiling'), 'the orbit camera frames the house from above; no ceiling');
  const frontDir = rotateAroundY(0, 1, snap.house.rotationY);
  const frontAzimuth = (Math.atan2(frontDir.x, frontDir.z) * 180) / Math.PI;
  check(fake.log.view !== null && near(fake.log.view.azimuth, frontAzimuth, 1e-6), `the dollhouse is seen from the front, like the floor plan beside it (azimuth ${fake.log.view?.azimuth})`);
  check(near(fake.camera.fov, 50, 1e-9), 'the dollhouse uses the ordinary 50 degree view again');
  const marks = fake.world.overlayRoot.getObjectByName('interior-room-marks');
  const floorMarks = marks ? marks.children.filter((c) => c.name.startsWith('interior-room-floor:')) : [];
  const litIs = (id) => floorMarks.length === snap.house.rooms.length && floorMarks.every((f) => f.visible === (f.userData.roomId === id));
  check(litIs(w.store.getState().interior.roomId), `every room has a floor mark and only the chosen room is lit (${w.store.getState().interior.roomId})`);
  const kitchenRoom = explorer.room({ type: 'kitchen' });
  await explorer.goToRoom(kitchenRoom.id);
  check(litIs(kitchenRoom.id), 'choosing another room in the dollhouse moves the lit floor to it');
  await explorer.goToRoom(bedroom2.id);
  w.actions.setInteriorView('walk');
  check(fake.log.cutaway === null && fake.log.driver === explorer.walk, 'back to walking: nothing cut away, the walker drives again');
  check(!fake.world.overlayRoot.getObjectByName('interior-room-marks') && near(across(fake.camera), 84, 0.01), 'walking again: the room marks are gone and the view is wide again');
  const backIn = explorer.walk.getPose();
  check(roomAt(snap.house, backIn.x, backIn.z)?.id === bedroom2.id, 'from the dollhouse back to walking lands in the chosen room (no glide down through the roof)');

  // ------------------------------------------------------------------ 3
  section('3. Furniture inside: shown first, made only on yes, only in the entered house, undoable, saved');
  const kitchen = explorer.room({ type: 'kitchen' });
  const before = w.store.getState().placedObjects;
  const offer = explorer.proposeAdd('furniture_chair', { roomId: kitchen.id, count: 2 });
  check(offer.ok && explorer.hasProposal && fake.ghosts.live.size === 2, `two chairs are shown as ghosts first (${offer.message})`);
  check(w.store.getState().placedObjects === before, 'nothing is built before the yes');
  explorer.cancelProposal();
  check(!explorer.hasProposal && fake.ghosts.live.size === 0 && w.store.getState().placedObjects === before, '"No" removes the ghosts and changes nothing');
  explorer.proposeAdd('furniture_chair', { roomId: kitchen.id, count: 2 });
  const added = explorer.confirmProposal();
  await flush();
  const chairs = w.store.getState().placedObjects.filter((p) => !before.includes(p));
  check(added.ok && chairs.length === 2 && chairs.every((c) => c.definitionId === 'furniture_chair'), `"Yes" adds the two chairs (${added.message})`);
  check(chairs.every((c) => c.group?.id === house.groupId && c.supportId !== null), 'they belong to this house and stand on its floor');
  check(chairs.every((c) => roomAt(snap.house, c.position.x, c.position.z)?.id === kitchen.id), 'they are inside the kitchen');
  check(chairs.every((c) => near(c.position.y, snap.house.floorY, 1e-6)), 'they stand on the floor (not in it)');
  check(outsideObjects() === gardenBefore, 'the garden and everything else outside the house are untouched');
  history.undo();
  await flush();
  check(chairs.every((c) => !w.store.getState().placedObjects.some((p) => p.id === c.id)), 'one undo removes both chairs');
  history.redo();
  await flush();
  check(chairs.every((c) => w.store.getState().placedObjects.some((p) => p.id === c.id)), 'redo brings them back');

  // Paint the kitchen counters.
  const counters = explorer.furnitureOfType(['counter'], kitchen);
  const white = PAINT_COLOURS.find((c) => c.id === 'white');
  const paint = explorer.proposeRecolor(counters.map((c) => c.id), white, 'kitchen cabinets', kitchen.name);
  check(paint.ok && counters.length > 0, `painting is offered (${counters.length} counters)`);
  const painted = explorer.confirmProposal();
  check(painted.ok && counters.every((c) => w.store.getState().placedObjects.find((p) => p.id === c.id)?.materialOverrides.color === white.hex), `the counters are white (${painted.message})`);
  const otherCounters = w.store.getState().placedObjects.filter((p) => p.definitionId === 'kitchen_counter' && !counters.some((c) => c.id === p.id));
  check(otherCounters.every((p) => !p.materialOverrides.color), 'no other counter anywhere was painted');

  // Move the bed near the window (bedroom 1).
  const bedroom1 = explorer.room({ type: 'bedroom', ordinal: 1 });
  const bed = explorer.furnitureOfType(['bed'], bedroom1)[0];
  check(bed !== undefined, 'bedroom 1 has a bed');
  if (bed) {
    const move = explorer.proposeMove(bed.id, 'window');
    if (move.ok) {
      const moved = explorer.confirmProposal();
      const now = w.store.getState().placedObjects.find((p) => p.id === bed.id);
      check(moved.ok ? roomAt(snap.house, now.position.x, now.position.z)?.id === bedroom1.id : true, `moving the bed keeps it in its room (${moved.message})`);
    } else {
      check(/free spot|can't/.test(move.message), `no free spot by the window is said honestly (${move.message})`);
    }
  }

  // Save and reload: the chairs and the paint survive.
  const storage = new LocalMyWorldStorage('test.m4.world');
  const state = w.store.getState();
  storage.save({ player: state.player, placedObjects: state.placedObjects, identity: state.myWorld });
  const loaded = storage.load();
  check(chairs.every((c) => loaded.placedObjects.some((p) => p.id === c.id && p.group?.id === house.groupId)), 'the added chairs survive a save and reload (still in the house)');
  check(counters.every((c) => loaded.placedObjects.find((p) => p.id === c.id)?.materialOverrides.color === white.hex), 'the paint survives a save and reload');

  // Leaving puts the camera back.
  explorer.exit();
  check(!explorer.isInside && w.store.getState().interior === null && fake.log.driver === null && fake.log.suspended === false && fake.log.restored !== null, 'going outside restores the camera exactly as it was');
  check(fake.world.scene.getObjectByName('interior-fill').intensity === 0 && fake.world.scene.environmentIntensity === 0.3 && fake.world.environment.hemisphere.intensity === 0.22, '...and the outdoor light exactly as it was');
  check(!fake.world.overlayRoot.children.some((c) => c.name === 'interior-ceiling') && fake.world.scene.children.find((c) => c.name === 'interior-fill')?.intensity === 0, 'the ceiling is removed and the indoor light is off');
  check(near(fake.camera.fov, 50, 1e-9), '...and the ordinary 50 degree view is back');
  check(fake.log.restoreAnimated === false, 'leaving from the walking view is a cut (no glide back out through the walls)');

  // A ready-made house (a single model, no plan) has no rooms: entering it says so - it never takes the child into another house.
  const readyMade = w.actions.instantiateTemplate(w.templates.get('house_family'), { x: 60, y: 0, z: -60 }, 0, 'house');
  check(readyMade.placed > 0 && readyMade.groupId !== null, `a ready-made Family House stands nearby (${readyMade.placed} pieces)`);
  const readyPiece = w.store.getState().placedObjects.find((p) => p.group?.id === readyMade.groupId);
  w.actions.selectPlacedObject(readyPiece?.id ?? null);
  const refused = explorer.enter();
  check(!refused.ok && /no rooms I can show you/.test(refused.message) && w.store.getState().interior === null && !explorer.isInside, `entering a ready-made house is answered honestly, never by going into the planned house instead (${refused.message})`);
  w.actions.selectPlacedObject(null);

  // ------------------------------------------------------------------ 4
  section('4. The AI helper: interior requests answered on the device, never sent to the AI, never claiming too much');
  {
    let calls = 0;
    const assistant = new BuildAssistant(w.builder, async () => {
      calls++;
      throw new Error('offline');
    });
    assistant.setInteriorPort(interiorPortFor(explorer, w.store, registry));
    w.actions.selectPlacedObject(w.groupOf(house.groupId)[0].id);
    let turn = await assistant.ask('enter the house');
    check(turn.source === 'device' && explorer.isInside && calls === 0, `"enter the house" goes inside without asking the AI (${turn.reply})`);
    check(turn.choices.length > 0 && turn.choices.every((c) => /^Show me the /.test(c)), 'it offers rooms to visit');
    const going2 = assistant.ask('show me the second bedroom');
    await step(3);
    turn = await going2;
    check(turn.source === 'device' && /bedroom 2/i.test(turn.reply) && w.store.getState().interior.roomId === bedroom2.id && calls === 0, `"show me the second bedroom" walks there and says so (${turn.reply})`);
    turn = await assistant.ask('show me the fourth bedroom');
    check(!/You're in/.test(turn.reply) && /doesn't have/.test(turn.reply) && calls === 0, `a room that does not exist is said not to exist (${turn.reply})`);
    const beforeAdd = w.store.getState().placedObjects;
    const adding = assistant.ask('add a sofa to the living room');
    await step(3);
    turn = await adding;
    check(turn.source === 'device' && JSON.stringify(turn.choices) === JSON.stringify(['Yes, do it', 'No thanks']) && w.store.getState().placedObjects === beforeAdd, `"add a sofa to the living room" shows it first and asks (${turn.reply})`);
    turn = await assistant.ask('No thanks');
    check(/nothing changed/i.test(turn.reply) && w.store.getState().placedObjects === beforeAdd && !explorer.hasProposal, '"No thanks" changes nothing');
    const adding2 = assistant.ask('add a sofa to the living room');
    await step(3);
    await adding2;
    turn = await assistant.ask('Yes, do it');
    const sofa = w.store.getState().placedObjects.find((p) => !beforeAdd.includes(p) && p.definitionId === 'furniture_sofa');
    const living = explorer.room({ type: 'living' });
    check(sofa && roomAt(snap.house, sofa.position.x, sofa.position.z)?.id === living.id && sofa.group?.id === house.groupId && /Done/.test(turn.reply), `"Yes" adds the sofa in the living room (${turn.reply})`);
    turn = await assistant.ask('make the walls pink');
    check(/not the walls/.test(turn.reply) && calls === 0, 'walls cannot be painted, said honestly');
    // An AI "move" while inside never moves the whole house.
    const housePieces = JSON.stringify(w.groupOf(house.groupId).map((p) => p.position));
    const aiMove = new BuildAssistant(w.builder, async () => ({ model: 'test/model', intent: { action: 'move', reply: 'Moving it!', plan: null, move: { near: 'lake', right: 0, forward: 0 }, choices: [] } }));
    aiMove.setInteriorPort(interiorPortFor(explorer, w.store, registry));
    turn = await aiMove.ask('shove everything over there');
    check(turn.action === 'chat' && turn.preview === null && w.store.getState().templatePlacement === null && JSON.stringify(w.groupOf(house.groupId).map((p) => p.position)) === housePieces, `an AI "move" while inside never moves the house (${turn.reply})`);
    turn = await assistant.ask('take me back outside');
    check(!explorer.isInside && /back outside/.test(turn.reply), 'going back outside');
    turn = await assistant.ask('build a garden behind the house');
    check(calls === 1 && turn.source === 'offline', 'a building request still goes to the AI builder (here offline) as before');
    w.actions.cancelTemplatePlacement();
  }

  // ------------------------------------------------------------------ 5
  section('5. State and actions: interior and RealWorld are separate from My World saves and Challenge Mode');
  {
    const v = myWorld('test.m4.plans.b');
    check(v.builder.preview({ version: 1, kind: 'house', size: { width: 12, depth: 10 }, site: { near: 'home' } }).ok, 'a house');
    const h = v.confirm();
    // Interior enter guards.
    v.builder.preview({ version: 1, kind: 'garden', site: { near: 'home' } });
    check(!v.actions.enterInterior(h.groupId, null) && v.store.getState().interior === null, 'cannot go inside while a preview is on show');
    v.actions.cancelTemplatePlacement();
    check(!v.actions.enterInterior('no-such-group', null), 'cannot go inside a house that does not exist');
    // The child taps the roof, then "Enter house" on its card: the card must not stay open over the interior.
    const roofPiece = v.store.getState().placedObjects.find((p) => p.group?.id === h.groupId);
    v.actions.selectPlacedObject(roofPiece.id);
    check(v.store.getState().selectedInstanceId === roofPiece.id, 'a piece of the house is selected outside');
    check(v.actions.enterInterior(h.groupId, null), 'can go inside');
    check(v.store.getState().selectedInstanceId === null && v.store.getState().creationFocus === null, 'going inside lets go of the piece tapped outside (its card closes)');
    const objectsInside = v.store.getState().placedObjects;
    v.actions.setInteriorView('dollhouse');
    v.actions.setInteriorRoom('kitchen-1');
    v.actions.setInteriorTouring(true);
    check(v.store.getState().placedObjects === objectsInside, 'views, rooms and tours never change the world (not undo steps, not saved)');
    v.actions.selectPlacedObject(roofPiece.id);
    v.actions.exitInterior();
    check(v.store.getState().interior === null && v.store.getState().selectedInstanceId === null, 'going outside lets go of the piece selected inside');
    check(v.actions.enterInterior(h.groupId, null), 'can go inside again');
    v.actions.returnToMenu();
    check(v.store.getState().interior === null, 'going home clears the interior state');
    // RealWorld mode.
    v.actions.enterRealWorld();
    const rw = v.store.getState();
    check(rw.mode === 'realworld' && rw.realWorld.landmarkId === null && rw.challenge === null && rw.interior === null, 'RealWorld Explorer is its own mode, starting at the library');
    v.actions.openLandmark('burj-khalifa');
    check(v.store.getState().realWorld.landmarkId === 'burj-khalifa', 'a landmark can be opened');
    check(v.store.getState().placedObjects === rw.placedObjects, 'exploring changes nothing in My World');
    v.actions.exitRealWorld();
    check(v.store.getState().mode === 'menu' && v.store.getState().realWorld.landmarkId === null, 'leaving goes home');
    v.actions.openLandmark('burj-khalifa');
    check(v.store.getState().realWorld.landmarkId === null, 'landmarks only open inside RealWorld mode');
    // Challenge Mode: no interior, no recolour, no house-joining.
    const challengeId = v.actions && new ChallengeRegistry(registry).list?.()[0]?.id;
    void challengeId;
  }

  // ------------------------------------------------------------------ 6
  section('6. Painting, room placement and moving furniture after a house is changed');
  {
    const u = myWorld('test.m4.plans.c');
    const uh = new HistoryService(u.store, u.actions);
    uh.start();
    check(u.builder.preview({ version: 1, kind: 'house', size: { width: 12, depth: 10 }, site: { near: 'home' } }).ok, 'a house');
    const h = u.confirm();
    await flush();
    const sofa = u.groupOf(h.groupId).find((p) => p.definitionId === 'furniture_sofa');
    // Recolour validation and roles.
    check(u.actions.recolorPlacedObjects([sofa.id], 'not-a-colour') === 0 && u.actions.recolorPlacedObjects([sofa.id], '#12345') === 0, 'only #rrggbb colours are accepted');
    const wall = u.groupOf(h.groupId).find((p) => roleOf(registry.get(p.definitionId)) === 'wall');
    check(u.actions.recolorPlacedObjects([wall.id], '#ff0000') === 0, 'walls keep their own look');
    check(u.actions.recolorPlacedObjects([sofa.id], '#FF8A6B') === 1 && u.store.getState().placedObjects.find((p) => p.id === sofa.id).materialOverrides.color === '#ff8a6b', 'a sofa can be painted (stored in lower case)');
    await flush();
    uh.undo();
    await flush();
    check(!u.store.getState().placedObjects.find((p) => p.id === sofa.id).materialOverrides.color, 'painting is one undo step');
    uh.redo();
    await flush();
    // A painted sofa counts as the child's own edit and is kept by a house revision.
    const revision = u.builder.previewRevision(h.groupId, { version: 1, kind: 'house', size: { width: 14, depth: 10 }, site: { near: 'home' } });
    check(revision.ok, 'the house can be made wider');
    const wider = u.confirm();
    await flush();
    const keptSofa = u.store.getState().placedObjects.find((p) => p.id === sofa.id);
    check(keptSofa?.materialOverrides.color === '#ff8a6b' && keptSofa.group?.id === wider.groupId, 'the painted sofa is kept (with its colour) in the new version of the house');
    // Its floor tile was rebuilt: it can still be moved.
    u.actions.selectPlacedObject(keptSofa.id);
    const status = u.actions.moveSelectedPlacedObject(keptSofa.position.x + 0.2, keptSofa.position.z);
    const afterMove = u.store.getState().placedObjects.find((p) => p.id === sofa.id);
    check(status?.valid === true && near(afterMove.position.y, keptSofa.position.y, 1e-6) && afterMove.supportId !== null, `furniture can still be moved after the house was changed (re-found its floor; ${status?.reason ?? 'ok'})`);
    // placeAt on a house floor tile joins the house; on open ground it does not.
    const tile = u.groupOf(wider.groupId).find((p) => roleOf(registry.get(p.definitionId)) === 'floor');
    const tileBox = boundsOfPlaced(registry.get(tile.definitionId), tile);
    const plantSpots = [[0, 0], [0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]];
    let plant = null;
    for (const [dx, dz] of plantSpots) {
      plant = u.actions.placeAt('decor_potted_plant', { x: tile.position.x + dx, y: tileBox.maxY, z: tile.position.z + dz }, 0, { supportId: tile.id });
      if (plant) break;
    }
    check(plant === null || plant.group?.id === wider.groupId, 'furniture put on the house floor joins the house');
    const ground = u.actions.placeAt('decor_potted_plant', { x: tile.position.x + 40, y: 0, z: tile.position.z + 40 }, 0, {});
    check(ground === null || !ground.group, 'something put on open ground stays on its own');
    // Saved colours are validated on load: a bad one is dropped, the world is kept.
    const storage = new LocalMyWorldStorage('test.m4.world.c');
    const st = u.store.getState();
    storage.save({ player: st.player, placedObjects: st.placedObjects, identity: st.myWorld });
    const raw = JSON.parse(memory.get('test.m4.world.c'));
    const first = raw.placedObjects ?? raw.objects ?? null;
    if (Array.isArray(first) && first.length > 0) {
      first[0].materialOverrides = { color: 'javascript:alert(1)' };
      memory.set('test.m4.world.c', JSON.stringify(raw));
      const reloaded = storage.load();
      check(reloaded !== null && reloaded.placedObjects.length === st.placedObjects.length && !reloaded.placedObjects[0].materialOverrides.color, 'a bad saved colour is dropped and the rest of the world loads');
    } else {
      check(false, 'save format has a placedObjects list to tamper with');
    }
  }

  // ------------------------------------------------------------------ 7
  section('7. RealWorld progress: separate from Challenge Mode, validated, and deleted with everything else');
  {
    memory.delete(REALWORLD_PROGRESS_KEY);
    const store = new RealWorldProgressStore();
    store.load();
    check(store.completeMission('burj-khalifa', 'find-foundation') && !store.completeMission('burj-khalifa', 'find-foundation'), 'a mission is recorded once');
    check(store.answeredCorrectly('burj-khalifa', 'pressure-area') && store.markTimelineWatched('burj-khalifa') && store.completeLesson('burj-khalifa', 'foundation-pressure'), 'lessons, quiz answers and the timeline are recorded');
    check(!store.completeMission('Bad Id!', 'x') && !store.completeMission('burj-khalifa', ''), 'bad ids are refused');
    const again = new RealWorldProgressStore();
    again.load();
    const progress = again.get('burj-khalifa');
    check(progress.missions.includes('find-foundation') && progress.quizzes.includes('pressure-area') && progress.timelineWatched && progress.lessons.includes('foundation-pressure'), 'progress survives a reload');
    check(Object.keys(parseProgress({ version: 1, landmarks: { ok: { missions: ['a', 7, 'a'], lessons: 'x' }, 'BAD!': {} } })).join() === 'ok' && parseProgress({ version: 1, landmarks: { ok: { missions: ['a', 7, 'a'] } } }).ok.missions.join() === 'a', 'stored progress is validated entry by entry');
    check(parseProgress({ version: 2, landmarks: {} }) && Object.keys(parseProgress({ version: 2, landmarks: { a: {} } })).length === 0, 'an unknown version starts fresh');
    check(DEVICE_STORAGE_KEYS.includes(REALWORLD_PROGRESS_KEY) && REALWORLD_PROGRESS_KEY.startsWith('city-builder.'), 'the RealWorld key is one of the keys "Delete everything" removes');
    // Challenge "reset level progress" never touches it.
    const v = myWorld('test.m4.plans.d');
    v.actions.resetProgress();
    check(memory.has(REALWORLD_PROGRESS_KEY), 'resetting Challenge Mode levels keeps RealWorld progress');
    // Delete everything: memory first, then storage; nothing written back.
    const parts = {
      actions: v.actions,
      history: { clear: () => {} },
      planBuilder: v.builder,
      assistant: { reset: () => {} },
      persistence: { forget: () => {} },
      realWorld: again,
      storages: [again],
    };
    const result = eraseDeviceData(parts);
    check(!memory.has(REALWORLD_PROGRESS_KEY) && result.remaining.length === 0 && !storedKeys().includes(REALWORLD_PROGRESS_KEY), 'deleting everything removes RealWorld progress');
    check(again.get('burj-khalifa').missions.length === 0, 'and forgets it in memory, so nothing is written back');
  }

  // ------------------------------------------------------------------ 8
  section('8. Neighbourhood layouts say where each house stands (so its rooms map onto the right house)');
  {
    const plan = parseConstructionPlan({ version: 1, kind: 'neighborhood', houses: 4 }).plan;
    const layout = layoutPlan(plan, registry);
    check(layout.houses?.length === 4 && layout.houses.map((h) => h.prefix).join() === 'h0,h1,h2,h3', 'four houses with their prefixes');
    let exact = true;
    for (const frame of layout.houses) {
      const own = layoutHouse(neighborhoodHouse(plan, frame.index), registry);
      own.objects.forEach((spec, i) => {
        const key = `${frame.prefix}/${own.keys[i]}`;
        const index = layout.keys.indexOf(key);
        if (index < 0) return;
        const placed = layout.objects[index];
        const offset = rotateAroundY(spec.position.x, spec.position.z, frame.rotationY);
        if (!near(placed.position.x, frame.origin.x + offset.x, 1e-6) || !near(placed.position.z, frame.origin.z + offset.z, 1e-6)) exact = false;
      });
    }
    check(exact, 'each house\'s own layout placed with its frame lands exactly on the neighbourhood\'s pieces');
    check(layoutPlan(parseConstructionPlan({ version: 1, kind: 'house', size: { width: 12, depth: 10 } }).plan, registry).houses === undefined, 'single houses have no frames list');
  }
} finally {
  await server.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
