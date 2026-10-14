/**
 * Acceptance tests for the Interior Explorer's pure logic (src/creative/interior):
 * rooms of built houses in world metres, the walk model (walls with door
 * gaps, furniture as it stands now), collision, viewpoints, the door graph,
 * free spots for furniture, and rooms surviving a reload.
 *
 * Houses are planned and built through the real PlanBuilder / GameActions,
 * and the game's own TypeScript modules run through Vite's SSR loader, so no
 * extra test dependencies are needed:   node scripts/test-interior.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// GameActions announces creations on `window`; MyWorldStorage uses localStorage.
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

const server = await createServer({
  root,
  configFile: `${root}vite.config.ts`,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});

const TEST_PLAN_KEY = 'test.interior.plans';

try {
  const load = (path) => server.ssrLoadModule(path);
  const { objectDefinitions, worldDefinition, templateDefinitions } = await load('/src/data/index.ts');
  const { ObjectRegistry } = await load('/src/construction/ObjectRegistry.ts');
  const { roleOf } = await load('/src/construction/ConstructionObjectDefinition.ts');
  const { computeBounds } = await load('/src/construction/bounds.ts');
  const { TemplateRegistry } = await load('/src/creative/Template.ts');
  const { parseConstructionPlan } = await load('/src/creative/plan/ConstructionPlan.ts');
  const { layoutHouse } = await load('/src/creative/plan/HouseLayout.ts');
  const { layoutPlan } = await load('/src/creative/plan/PlanLayouts.ts');
  const { neighborhoodHouse } = await load('/src/creative/plan/NeighborhoodLayout.ts');
  const { LocalPlanStore } = await load('/src/creative/plan/PlanRecords.ts');
  const { PlanBuilder } = await load('/src/creative/plan/PlanBuilder.ts');
  const { GameStore } = await load('/src/state/GameStore.ts');
  const { createInitialState } = await load('/src/state/initialState.ts');
  const { GameActions } = await load('/src/state/actions.ts');
  const { ChallengeRegistry } = await load('/src/challenges/ChallengeRegistry.ts');
  const { WorldSpace } = await load('/src/world/WorldSpace.ts');
  const { rotateAroundY } = await load('/src/utils/math.ts');
  const interior = await load('/src/creative/interior/index.ts');
  const {
    EYE_HEIGHT,
    WALK_RADIUS,
    describeHouseInterior,
    houseToWorld,
    worldToHouse,
    roomAt,
    findRoom,
    buildWalkModel,
    isFree,
    moveWithCollision,
    roomViewpoint,
    entryPose,
    exitPoint,
    doorGraph,
    tourOrder,
    windowsOf,
    findFreeSpot,
  } = interior;

  const registry = new ObjectRegistry();
  registry.registerAll(objectDefinitions);
  const QUARTER = Math.PI / 2;
  const union = (boxes) =>
    boxes.reduce(
      (u, b) => ({ minX: Math.min(u.minX, b.minX), maxX: Math.max(u.maxX, b.maxX), minZ: Math.min(u.minZ, b.minZ), maxZ: Math.max(u.maxZ, b.maxZ) }),
      { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
    );
  const boxOf = (p) => computeBounds(registry.get(p.definitionId), p.position, p.rotationY, p.scale);
  const inside = (box, outer, tolerance = 1e-6) =>
    box.minX >= outer.minX - tolerance && box.maxX <= outer.maxX + tolerance && box.minZ >= outer.minZ - tolerance && box.maxZ <= outer.maxZ + tolerance;
  const overlap = (a, b) => a.minX < b.maxX - 1e-9 && b.minX < a.maxX - 1e-9 && a.minZ < b.maxZ - 1e-9 && b.minZ < a.maxZ - 1e-9;
  const pointIn = (box, p) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
  const sameBox = (a, b, tolerance = 1e-6) => near(a.minX, b.minX, tolerance) && near(a.maxX, b.maxX, tolerance) && near(a.minZ, b.minZ, tolerance) && near(a.maxZ, b.maxZ, tolerance);
  const plan = (input) => {
    const result = parseConstructionPlan({ version: 1, ...input });
    if (!result.plan) throw new Error(`test plan rejected: ${result.errors.join(' ')}`);
    return result.plan;
  };
  /** Deterministic PRNG (mulberry32), so a failing random walk can be replayed. */
  function prng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A My World of its own, built through the real actions and the real plan builder (camera heading `azimuth`). */
  function makeWorld({ azimuth = 0, planStore = null } = {}) {
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
    const world = { worldSpace, store, actions, templates, rules };
    world.newBuilder = () => (world.builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth }), planStore));
    world.newBuilder();
    world.confirm = () => {
      const placement = store.getState().templatePlacement;
      const template = templates.get(placement.templateId);
      actions.cancelTemplatePlacement();
      const revise = placement.revise;
      const result = actions.instantiateTemplate(template, placement.origin, placement.rotationY, placement.creationId, revise ? { replace: revise.replace, carry: { ids: revise.carry, from: revise.from } } : {});
      world.builder.onTemplateBuilt(placement.templateId, { origin: placement.origin, rotationY: placement.rotationY }, result);
      return result;
    };
    /** Preview and confirm a plan; returns its group id, record and build result. */
    world.build = (input) => {
      const preview = world.builder.preview({ version: 1, ...input });
      if (!preview.ok) throw new Error(`could not preview ${JSON.stringify(input)}: ${preview.errors.join(' | ')}`);
      const result = world.confirm();
      return { groupId: result.groupId, record: world.builder.records[result.groupId], result };
    };
    world.groupOf = (id) => store.getState().placedObjects.filter((p) => p.group?.id === id);
    /** Standing pieces of a group whose layout key passes `test`. */
    world.piecesWhere = (groupId, test) => {
      const record = world.builder.records[groupId];
      return world.groupOf(groupId).filter((p) => record.pieces[p.id] && test(record.pieces[p.id].key));
    };
    return world;
  }

  /** The front door of a walk model, found independently: a door out of the house in its front (local +Z) wall. */
  const frontDoorOf = (model) =>
    model.doors.find((d) => d.sides.includes('outside') && worldToHouse(model.house, d).z > model.house.plan.size.depth / 2 - 0.5) ?? null;
  const inwardOf = (door, roomId) => (door.sides[0] === roomId ? door.normal : { x: -door.normal.x, z: -door.normal.z });

  /** Expected child-facing names, in layout order. */
  function expectedNames(types) {
    const label = { living: 'Living room', kitchen: 'Kitchen', bedroom: 'Bedroom', bathroom: 'Bathroom' };
    const seen = {};
    return types.map((t) => {
      seen[t] = (seen[t] ?? 0) + 1;
      return types.filter((x) => x === t).length > 1 ? `${label[t]} ${seen[t]}` : label[t];
    });
  }

  /** Everything every described house must satisfy. */
  function checkHouse(house, record, layout, label) {
    check(house !== null, `${label}: the house is described`);
    if (!house) return;
    const types = layout.rooms.map((r) => r.type);
    check(house.rooms.length === layout.rooms.length && house.rooms.every((r, i) => r.type === types[i]), `${label}: rooms match the layout in count and type (${house.rooms.map((r) => r.id).join(', ')})`);
    const names = house.rooms.map((r) => r.name);
    check(JSON.stringify(names) === JSON.stringify(expectedNames(types)), `${label}: rooms have child-facing names (${names.join(', ')})`);
    check(new Set(names).size === names.length && new Set(house.rooms.map((r) => r.id)).size === names.length, `${label}: names and ids are unique`);
    check(house.rooms.every((r) => r.id === `${r.type}-${r.ordinal}` && r.floor === 0), `${label}: ids are type-ordinal, all on floor 0`);
    check(house.rooms.every((r) => inside(r.rect, house.footprint)), `${label}: every room lies inside the footprint`);
    check(house.rooms.every((a, i) => house.rooms.every((b, j) => i === j || !overlap(a.rect, b.rect))), `${label}: rooms do not overlap`);
    check(house.rooms.every((r) => pointIn(r.rect, r.center) && near(r.center.x, (r.rect.minX + r.rect.maxX) / 2) && near(r.center.z, (r.rect.minZ + r.rect.maxZ) / 2)), `${label}: centres are inside their rooms`);
    check(house.rooms.every((r) => near(r.area, (r.rect.maxX - r.rect.minX) * (r.rect.maxZ - r.rect.minZ), 1e-4)), `${label}: areas match the rects`);
    const builtKeys = new Set(Object.values(record.pieces).map((p) => p.key));
    const allFurniture = house.rooms.flatMap((r) => r.furnitureKeys);
    check(allFurniture.length > 0 && allFurniture.every((k) => builtKeys.has(k)), `${label}: every furniture key exists in record.pieces (${allFurniture.length} keys)`);
    const plannedFurniture = [...builtKeys].filter((k) => k.startsWith(`${house.keyPrefix}furn:`));
    check(allFurniture.length === plannedFurniture.length && new Set(allFurniture).size === allFurniture.length, `${label}: each built piece of furniture belongs to exactly one room`);
    check(house.rooms.every((r) => r.furnitureKeys.every((k) => k.startsWith(`${house.keyPrefix}furn:${r.type}#${r.ordinal - 1}:`))), `${label}: a room's furniture keys carry its type and ordinal`);
    check(house.floors.length === 1 && house.floors[0].index === 0 && house.floors[0].name === 'Ground floor' && house.floors[0].roomIds.join() === house.rooms.map((r) => r.id).join(), `${label}: one ground floor holding every room`);
    check(near(house.floorY, house.origin.y + 0.2) && near(house.ceilingY, house.floorY + 2.7), `${label}: floor top at +0.2 m, ceiling 2.7 m above it (${house.floorY}, ${house.ceilingY})`);
    const turned = Math.abs(Math.round(house.rotationY / QUARTER)) % 2 === 1;
    const [w, d] = turned ? [house.plan.size.depth, house.plan.size.width] : [house.plan.size.width, house.plan.size.depth];
    check(near(house.footprint.maxX - house.footprint.minX, w) && near(house.footprint.maxZ - house.footprint.minZ, d), `${label}: the footprint is the outer wall size, turned with the house`);
    for (const room of house.rooms) {
      if (roomAt(house, room.center.x, room.center.z) !== room) check(false, `${label}: roomAt finds ${room.id} at its centre`);
    }
    check(roomAt(house, house.footprint.minX + 0.1, house.footprint.minZ + 0.1) === null, `${label}: a point inside an outer wall is in no room`);
    const local = { x: 1.3, z: -0.7 };
    const back = worldToHouse(house, houseToWorld(house, local));
    check(near(back.x, local.x, 1e-9) && near(back.z, local.z, 1e-9), `${label}: houseToWorld and worldToHouse are inverse`);
  }

  // ------------------------------------------------------------------ 1
  section('1. Rooms of single houses, in world metres');
  const CASES = [
    { label: '10x8 living + kitchen', input: { kind: 'house', size: { width: 10, depth: 8 }, rooms: [{ type: 'living' }, { type: 'kitchen' }] } },
    { label: '12x10 default', input: { kind: 'house', size: { width: 12, depth: 10 } } },
    { label: '16x12 two bedrooms + bathroom', input: { kind: 'house', size: { width: 16, depth: 12 }, rooms: [{ type: 'bedroom', count: 2 }, { type: 'bathroom' }] } },
    {
      label: '20x14 big family house',
      input: { kind: 'house', name: 'Big Family House', size: { width: 20, depth: 14 }, rooms: [{ type: 'bedroom', count: 3 }, { type: 'bathroom', count: 2 }, { type: 'kitchen' }, { type: 'living' }], balcony: true },
    },
  ];
  const houses = [];
  for (const c of CASES) {
    const world = makeWorld();
    const built = world.build({ ...c.input, site: { near: 'home' } });
    const layout = layoutHouse(built.record.plan, registry);
    const house = describeHouseInterior(built.groupId, built.record, registry, null);
    checkHouse(house, built.record, layout, c.label);
    check(house.groupId === built.groupId && house.houseIndex === null && house.keyPrefix === '' && house.name === built.record.plan.name, `${c.label}: group, index, prefix and name (${house.name})`);
    // The described frame is where the pieces really stand.
    const walls = world.piecesWhere(built.groupId, (k) => k.startsWith('wall:')).map(boxOf);
    const floors = world.piecesWhere(built.groupId, (k) => k.startsWith('floor:')).map(boxOf);
    check(sameBox(union(walls), house.footprint, 1e-4) && sameBox(union(floors), house.footprint, 1e-4), `${c.label}: the footprint is exactly the built walls and floor`);
    const furniture = world.piecesWhere(built.groupId, (k) => k.startsWith('furn:'));
    const keyOf = (p) => built.record.pieces[p.id].key;
    check(furniture.every((p) => inside(boxOf(p), house.rooms.find((r) => r.furnitureKeys.includes(keyOf(p))).rect, 1e-4)), `${c.label}: every built piece of furniture stands inside its own room`);
    houses.push({ ...c, world, built, layout, house });
  }
  const [small, , family, big] = houses;
  check(small.house.name === 'Your House' && big.house.name === 'Big Family House', `a house is called by its plan's name (${small.house.name}, ${big.house.name})`);
  check(JSON.stringify(big.house.rooms.map((r) => r.name).sort()) === JSON.stringify(['Bathroom 1', 'Bathroom 2', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Kitchen', 'Living room']), `numbers only where a house has more than one of a kind (${big.house.rooms.map((r) => r.name).join(', ')})`);
  check(findRoom(big.house, { type: 'bedroom', ordinal: 2 })?.name === 'Bedroom 2' && findRoom(big.house, { type: 'bedroom' })?.id === 'bedroom-1' && findRoom(big.house, { id: 'kitchen-1' })?.type === 'kitchen', 'findRoom by type and ordinal, by type alone (the first), and by id');
  check(findRoom(small.house, { type: 'bathroom' }) === null && findRoom(big.house, { type: 'bedroom', ordinal: 4 }) === null && findRoom(big.house, { id: 'garage-1' }) === null && findRoom(big.house, {}) === null, 'findRoom says null for rooms the house does not have');
  check(small.house.rooms.length === 2 && family.house.rooms.some((r) => r.type === 'living'), 'every house has its living room');
  check(describeHouseInterior('nope', { ...small.built.record, plan: plan({ kind: 'garden' }) }, registry, null) === null, 'a garden has no inside');

  // A house turned a quarter: built facing a camera heading of 90 degrees...
  {
    const world = makeWorld({ azimuth: 90 });
    const built = world.build({ kind: 'house', size: { width: 14, depth: 10 }, rooms: [{ type: 'bedroom', count: 2 }, { type: 'kitchen' }], site: { near: 'view' } });
    const turn = Math.round(built.record.rotationY / QUARTER);
    check(turn % 2 !== 0 && near(built.record.rotationY, turn * QUARTER), `the house is built turned a quarter (rotationY ${built.record.rotationY.toFixed(4)})`);
    const layout = layoutHouse(built.record.plan, registry);
    const house = describeHouseInterior(built.groupId, built.record, registry, null);
    checkHouse(house, built.record, layout, 'turned 14x10');
    const walls = world.piecesWhere(built.groupId, (k) => k.startsWith('wall:')).map(boxOf);
    check(sameBox(union(walls), house.footprint, 1e-4), 'turned 14x10: the footprint is exactly the built walls');
    const furniture = world.piecesWhere(built.groupId, (k) => k.startsWith('furn:'));
    check(furniture.every((p) => inside(boxOf(p), house.rooms.find((r) => r.furnitureKeys.includes(built.record.pieces[p.id].key)).rect, 1e-4)), 'turned 14x10: every piece of furniture stands inside its own room');
    houses.push({ label: 'turned 14x10', world, built, layout, house });
  }
  // ...and a hand-made record turned by PI/2 from a real layout.
  {
    const base = houses[1];
    const layout = base.layout;
    const origin = { x: 5, y: 0, z: -3 };
    // Pieces recorded where a quarter-turned build would have put them.
    const pieces = Object.fromEntries(
      layout.keys.map((key, i) => {
        const spec = layout.objects[i];
        const at = rotateAroundY(spec.position.x, spec.position.z, QUARTER);
        return [`p${i}`, { key, x: origin.x + at.x, z: origin.z + at.z, rotationY: (spec.rotationY ?? 0) + QUARTER }];
      }),
    );
    const record = { plan: base.built.record.plan, origin, rotationY: QUARTER, pieces };
    const house = describeHouseInterior('hand', record, registry, null);
    checkHouse(house, record, layout, 'hand-made PI/2');
    const expected = layout.rooms.map((r) => {
      const corners = [[r.rect.minX, r.rect.minZ], [r.rect.maxX, r.rect.maxZ]].map(([x, z]) => rotateAroundY(x, z, QUARTER));
      return { minX: origin.x + Math.min(corners[0].x, corners[1].x), maxX: origin.x + Math.max(corners[0].x, corners[1].x), minZ: origin.z + Math.min(corners[0].z, corners[1].z), maxZ: origin.z + Math.max(corners[0].z, corners[1].z) };
    });
    check(house.rooms.every((r, i) => sameBox(r.rect, expected[i])), 'hand-made PI/2: each room is its layout rect turned a quarter round the origin');
    check(house.rooms.every((r, i) => near(r.area, base.house.rooms[i].area)), 'hand-made PI/2: turning keeps every area');
    // rotateAroundY(PI/2) takes house-local +Z (the front) to world +X.
    check(near(house.footprint.maxX - origin.x, base.built.record.plan.size.depth / 2), 'hand-made PI/2: the front of the house faces world +X');
  }

  // ------------------------------------------------------------------ 2
  section('2. A neighbourhood of four houses');
  const hoodWorld = makeWorld();
  const hood = hoodWorld.build({ kind: 'neighborhood', houses: 4, site: { near: 'home' } });
  const hoodHouses = [];
  {
    const record = hood.record;
    check(record.plan.kind === 'neighborhood' && record.plan.houses === 4 && hood.result.skipped === 0, `the neighbourhood is built completely (${hood.result.placed} pieces)`);
    for (let i = 0; i < 4; i++) {
      const house = describeHouseInterior(hood.groupId, record, registry, i);
      const layout = layoutHouse(neighborhoodHouse(record.plan, i), registry);
      checkHouse(house, record, layout, `house ${i + 1}`);
      if (!house) continue;
      check(house.houseIndex === i && house.keyPrefix === `h${i}/` && house.name === `House ${i + 1}`, `house ${i + 1}: index, prefix and name (${house.name})`);
      const tiles = hoodWorld.piecesWhere(hood.groupId, (k) => k.startsWith(`h${i}/floor:`)).map(boxOf);
      const tileBox = union(tiles);
      check(tiles.length > 0 && house.rooms.every((r) => inside(r.rect, tileBox)), `house ${i + 1}: every room lies on that house's own floor tiles`);
      check(sameBox(tileBox, house.footprint, 1e-4), `house ${i + 1}: its footprint is exactly its floor`);
      const furniture = hoodWorld.piecesWhere(hood.groupId, (k) => k.startsWith(`h${i}/furn:`));
      check(furniture.length > 0 && furniture.every((p) => inside(boxOf(p), house.rooms.find((r) => r.furnitureKeys.includes(record.pieces[p.id].key))?.rect ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, 1e-4)), `house ${i + 1}: its furniture stands in its own rooms`);
      hoodHouses.push(house);
    }
    const shared = hoodHouses.flatMap((a, i) => hoodHouses.slice(i + 1).flatMap((b) => a.rooms.flatMap((ra) => b.rooms.filter((rb) => overlap(ra.rect, rb.rect)))));
    check(hoodHouses.length === 4 && shared.length === 0 && hoodHouses.every((a, i) => hoodHouses.every((b, j) => i === j || !overlap(a.footprint, b.footprint))), 'houses share no rooms and no floor');
    check(new Set(hoodHouses.map((h) => Math.round(h.rotationY / QUARTER) % 4)).size === 2, 'the two rows of houses face opposite ways');
    check([4, 5, -1, 1.5, null].every((index) => describeHouseInterior(hood.groupId, record, registry, index) === null), 'no house 5, no house -1, no half house, and a neighbourhood needs a house index');
    const slot = layoutPlan(record.plan, registry).houses[2];
    const offset = rotateAroundY(slot.origin.x, slot.origin.z, record.rotationY);
    check(near(hoodHouses[2].origin.x, record.origin.x + offset.x) && near(hoodHouses[2].origin.z, record.origin.z + offset.z) && near(hoodHouses[2].rotationY, record.rotationY + slot.rotationY), 'house 3 stands at its slot of the neighbourhood');
  }

  // ------------------------------------------------------------------ 3
  section('3. Walk model: viewpoints, the way in, doors and the tour');
  const walkable = [...houses.map((h) => ({ label: h.label, house: h.house, world: h.world })), ...hoodHouses.map((house, i) => ({ label: `house ${i + 1}`, house, world: hoodWorld }))];
  for (const entry of walkable) {
    const { label, house, world } = entry;
    const model = buildWalkModel(house, world.store.getState().placedObjects, registry);
    entry.model = model;
    const groupDoors = world.groupOf(house.groupId).filter((p) => registry.get(p.definitionId).type === 'door' && pointIn(house.footprint, p.position));
    check(model.doors.length === groupDoors.length && model.doors.length >= house.rooms.length, `${label}: one walk door per built door (${model.doors.length})`);
    check(model.walls.length > 0 && model.furniture.length > 0 && model.obstacles.length === model.walls.length + model.furniture.length, `${label}: walls and furniture are obstacles (${model.walls.length} + ${model.furniture.length})`);
    check(model.doors.every((d) => model.walls.every((w) => !pointIn({ minX: w.minX + 1e-6, maxX: w.maxX - 1e-6, minZ: w.minZ + 1e-6, maxZ: w.maxZ - 1e-6 }, d))), `${label}: every door is an open gap in its wall`);
    check(model.doors.every((d) => d.sides[0] !== d.sides[1] && Math.hypot(d.normal.x, d.normal.z) > 0.999), `${label}: every door joins two different places`);
    check(model.windows.length > 0 && model.windows.every((w) => w.roomId !== null && roomAt(house, w.x + w.normal.x * 0.4, w.z + w.normal.z * 0.4)?.id === w.roomId), `${label}: every window looks into its room (${model.windows.length} windows)`);
    const facts = layoutHouse(house.plan, registry).facts;
    check(model.windows.length === facts.counts.window, `${label}: one walk window per window in the layout (${model.windows.length})`);
    const lit = house.rooms.filter((r) => windowsOf(model, r).length > 0).length;
    check(facts.flags.everyRoomHasWindow ? lit === house.rooms.length : lit < house.rooms.length, `${label}: rooms with windows agree with the layout (${lit} of ${house.rooms.length})`);
    check(sameBox(model.bounds, house.footprint), `${label}: the walker is kept inside the footprint`);
    const views = house.rooms.map((room) => ({ room, view: roomViewpoint(model, room) }));
    check(views.every(({ room, view }) => isFree(model, view) && roomAt(house, view.x, view.z) === room), `${label}: every room's viewpoint is free floor inside that room`);
    check(views.every(({ view }) => near(view.y, house.floorY + EYE_HEIGHT) && near(view.pitch, -0.12, 0.05) && Number.isFinite(view.yaw)), `${label}: viewpoints are at eye height, looking slightly down`);
    check(views.every(({ room, view }) => {
      const forward = { x: -Math.sin(view.yaw), z: -Math.cos(view.yaw) };
      const ahead = { x: view.x + forward.x * 0.6, z: view.z + forward.z * 0.6 };
      return pointIn(room.rect, ahead);
    }), `${label}: every viewpoint looks across its own room`);
    // Sampled, independently of the walk model's own maths: nothing stands within 1.2 m straight ahead of a viewpoint.
    const filledAhead = (view) => {
      const forward = { x: -Math.sin(view.yaw), z: -Math.cos(view.yaw) };
      for (let d = 0; d <= 1.2 + 1e-9; d += 0.02) {
        const p = { x: view.x + forward.x * d, z: view.z + forward.z * d };
        if (model.furniture.some((box) => pointIn(box, p))) return true;
      }
      return false;
    };
    check(views.every(({ view }) => !filledAhead(view)), `${label}: no furniture fills a room's view (nothing within 1.2 m straight ahead of any viewpoint)`);
    check(views.every(({ room, view }) => {
      const r = room.rect;
      const far = { x: Math.abs(r.minX - view.x) > Math.abs(r.maxX - view.x) ? r.minX : r.maxX, z: Math.abs(r.minZ - view.z) > Math.abs(r.maxZ - view.z) ? r.minZ : r.maxZ };
      return Math.hypot(far.x - view.x, far.z - view.z) >= 0.6 * Math.hypot(r.maxX - r.minX, r.maxZ - r.minZ);
    }), `${label}: every viewpoint sees across most of its room (its far corner is at least 60% of the room's diagonal away)`);
    const front = frontDoorOf(model);
    const behind = front ? house.rooms.find((r) => front.sides.includes(r.id)) : null;
    check(front !== null && behind?.type === 'living', `${label}: the front door opens into the living room`);
    const entryView = entryPose(model);
    check(isFree(model, entryView) && behind !== null && roomAt(house, entryView.x, entryView.z) === behind && near(entryView.y, house.floorY + EYE_HEIGHT), `${label}: the way in is free floor just inside the front door`);
    if (front && behind) {
      const inward = inwardOf(front, behind.id);
      const forward = { x: -Math.sin(entryView.yaw), z: -Math.cos(entryView.yaw) };
      check(forward.x * inward.x + forward.z * inward.z > 0.99 && Math.hypot(entryView.x - front.x, entryView.z - front.z) < 1.6, `${label}: standing at the front door, facing into the house`);
      const exit = exitPoint(model);
      check(!pointIn(house.footprint, exit) && near(Math.hypot(exit.x - front.x, exit.z - front.z), 1.5, 1e-6) && (exit.x - front.x) * inward.x + (exit.z - front.z) * inward.z < -1.4, `${label}: the exit point is 1.5 m outside the front door`);
    }
    const graph = doorGraph(model);
    const reached = new Set(['outside']);
    const queue = ['outside'];
    while (queue.length) for (const next of graph.get(queue.shift()) ?? []) if (!reached.has(next)) reached.add(next), queue.push(next);
    check(house.rooms.every((r) => reached.has(r.id) && graph.has(r.id)), `${label}: the door graph joins every room to outside`);
    check([...graph].every(([a, set]) => [...set].every((b) => graph.get(b)?.has(a))), `${label}: door links go both ways`);
    const tour = tourOrder(model);
    check(tour.length === house.rooms.length && new Set(tour).size === tour.length && house.rooms.every((r) => tour.includes(r.id)), `${label}: the tour visits every room once (${tour.join(' > ')})`);
    check(tour[0] === behind?.id, `${label}: the tour starts in the room behind the front door`);
    const depth = new Map([[tour[0], 0]]);
    const bfs = [tour[0]];
    while (bfs.length) {
      const id = bfs.shift();
      for (const next of graph.get(id) ?? []) if (next !== 'outside' && !depth.has(next)) depth.set(next, depth.get(id) + 1), bfs.push(next);
    }
    check(tour.every((id, i) => i === 0 || depth.get(tour[i - 1]) <= depth.get(id)), `${label}: the tour is breadth-first`);
  }

  // ------------------------------------------------------------------ 4
  section('4. Collision: random walks, walls, and walking through every door');
  /** The free grid of a model, for routing a scripted walk round furniture (0.1 m cells). */
  function router(model) {
    const step = 0.1;
    const { minX, minZ, maxX, maxZ } = model.bounds;
    const nx = Math.floor((maxX - minX) / step) + 1;
    const nz = Math.floor((maxZ - minZ) / step) + 1;
    const free = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) free[i * nz + j] = isFree(model, { x: minX + i * step, z: minZ + j * step }) ? 1 : 0;
    const at = (i, j) => ({ x: minX + i * step, z: minZ + j * step });
    const nearestCell = (p) => {
      let best = null;
      let bestD = Infinity;
      const ci = Math.round((p.x - minX) / step);
      const cj = Math.round((p.z - minZ) / step);
      for (let i = Math.max(0, ci - 6); i <= Math.min(nx - 1, ci + 6); i++) {
        for (let j = Math.max(0, cj - 6); j <= Math.min(nz - 1, cj + 6); j++) {
          const q = at(i, j);
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (free[i * nz + j] && d < bestD) (best = [i, j]), (bestD = d);
        }
      }
      return best;
    };
    /** Waypoints from `a` to `b` through free cells (breadth-first, 4-connected), or null. */
    return (a, b) => {
      const s = nearestCell(a);
      const g = nearestCell(b);
      if (!s || !g) return null;
      const prev = new Int32Array(nx * nz).fill(-1);
      const start = s[0] * nz + s[1];
      const goal = g[0] * nz + g[1];
      prev[start] = start;
      const queue = [start];
      while (queue.length && prev[goal] === -1) {
        const c = queue.shift();
        const i = Math.floor(c / nz);
        const j = c % nz;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
          const n = ni * nz + nj;
          if (!free[n] || prev[n] !== -1) continue;
          prev[n] = c;
          queue.push(n);
        }
      }
      if (prev[goal] === -1) return null;
      const path = [];
      for (let c = goal; c !== start; c = prev[c]) path.push(at(Math.floor(c / nz), c % nz));
      return [...path.reverse(), b];
    };
  }
  /** Walk through a list of waypoints with real collision; returns the end point and whether every step ended free. */
  function walk(model, from, waypoints) {
    let p = from;
    let allFree = true;
    for (const w of waypoints) {
      p = moveWithCollision(model, p, w);
      if (!isFree(model, p)) allFree = false;
    }
    return { p, allFree };
  }

  for (const [n, entry] of walkable.entries()) {
    const { label, house, model } = entry;
    // A long random walk never ends a step stuck or outside.
    const random = prng(1234 + n);
    let p = entryPose(model);
    p = { x: p.x, z: p.z };
    let stuck = 0;
    let outside = 0;
    const visited = new Set();
    for (let k = 0; k < 3000; k++) {
      const angle = random() * Math.PI * 2;
      const length = random() * 0.5;
      // Every so often stride towards a random room, so the walk gets around the house.
      const room = house.rooms[Math.floor(random() * house.rooms.length)];
      const to = k % 50 === 0 ? room.center : { x: p.x + Math.cos(angle) * length, z: p.z + Math.sin(angle) * length };
      p = moveWithCollision(model, p, to);
      if (!isFree(model, p)) stuck++;
      if (!pointIn({ minX: model.bounds.minX + WALK_RADIUS - 1e-9, maxX: model.bounds.maxX - WALK_RADIUS + 1e-9, minZ: model.bounds.minZ + WALK_RADIUS - 1e-9, maxZ: model.bounds.maxZ - WALK_RADIUS + 1e-9 }, p)) outside++;
      const r = roomAt(house, p.x, p.z);
      if (r) visited.add(r.id);
    }
    check(stuck === 0 && outside === 0, `${label}: 3000 random steps never end stuck or outside (${stuck} stuck, ${outside} outside)`);
    check(visited.size >= Math.min(2, house.rooms.length), `${label}: the random walk gets round the house (${visited.size} of ${house.rooms.length} rooms)`);

    // Through every door, both ways: from the room's viewpoint to the door, and 0.8 m beyond.
    const route = router(model);
    const failed = [];
    for (const door of model.doors) {
      for (const [from, to] of [door.sides, [...door.sides].reverse()]) {
        if (from === 'outside') continue;
        const room = house.rooms.find((r) => r.id === from);
        const view = roomViewpoint(model, room);
        const inward = inwardOf(door, from);
        const approach = { x: door.x + inward.x * 0.7, z: door.z + inward.z * 0.7 };
        let { p: at, allFree } = walk(model, { x: view.x, z: view.z }, [approach]);
        if (Math.hypot(at.x - approach.x, at.z - approach.z) > 0.05) {
          const path = route(at, approach);
          if (!path) {
            failed.push(`${from}->${to}: no route to the door`);
            continue;
          }
          ({ p: at, allFree } = walk(model, at, path));
        }
        const beyond = { x: door.x - inward.x * 0.8, z: door.z - inward.z * 0.8 };
        const end = walk(model, at, [{ x: door.x, z: door.z }, beyond]);
        const ok =
          allFree &&
          end.allFree &&
          (to === 'outside' ? Math.hypot(end.p.x - door.x, end.p.z - door.z) < 0.25 : roomAt(house, end.p.x, end.p.z)?.id === to);
        if (!ok) failed.push(`${from}->${to}: ended at ${end.p.x.toFixed(2)},${end.p.z.toFixed(2)} (${roomAt(house, end.p.x, end.p.z)?.id ?? 'no room'})`);
      }
    }
    check(failed.length === 0, `${label}: walking through each of the ${model.doors.length} doors ends in the room on the other side (or in the doorway out) (${failed.join('; ')})`);

    // Straight at a wall (no furniture in the way): the walker stops against it, never in it.
    const bare = buildWalkModel(house, entry.world.store.getState().placedObjects, registry, { furnitureMinHeight: Infinity });
    check(bare.furniture.length === 0 && bare.walls.length === model.walls.length, `${label}: furniture can be left out of the model`);
    const living = findRoom(house, { type: 'living' });
    const sides = [
      { dir: { x: -1, z: 0 }, wall: living.rect.minX },
      { dir: { x: 1, z: 0 }, wall: living.rect.maxX },
      { dir: { x: 0, z: -1 }, wall: living.rect.minZ },
      { dir: { x: 0, z: 1 }, wall: living.rect.maxZ },
    ];
    const start = living.center;
    const solid = sides.find(({ dir }) => !bare.doors.some((d) => (dir.x !== 0 ? Math.abs(d.z - start.z) < d.width / 2 + WALK_RADIUS + 0.05 && Math.sign(d.x - start.x) === dir.x : Math.abs(d.x - start.x) < d.width / 2 + WALK_RADIUS + 0.05 && Math.sign(d.z - start.z) === dir.z)));
    check(solid !== undefined, `${label}: the living room has a wall without a door straight ahead`);
    if (solid) {
      const target = { x: start.x + solid.dir.x * 30, z: start.z + solid.dir.z * 30 };
      const stop = moveWithCollision(bare, start, target);
      const along = solid.dir.x !== 0 ? stop.x : stop.z;
      const contact = solid.wall - (solid.dir.x + solid.dir.z) * WALK_RADIUS;
      check(isFree(bare, stop) && Math.abs(along - contact) < 0.01 && roomAt(house, stop.x, stop.z) === living, `${label}: walking straight at a wall stops right against it (${along.toFixed(3)} vs ${contact.toFixed(3)})`);
    }
  }

  // No tunnelling: one huge step from one bedroom straight at the next, through the wall between them.
  {
    const entry = walkable.find((e) => e.label === CASES[2].label);
    const bare = buildWalkModel(entry.house, entry.world.store.getState().placedObjects, registry, { furnitureMinHeight: Infinity });
    const [a, b] = [findRoom(entry.house, { type: 'bedroom', ordinal: 1 }), findRoom(entry.house, { type: 'bedroom', ordinal: 2 })];
    const between = bare.doors.filter((d) => d.sides.includes(a.id) && d.sides.includes(b.id));
    const stop = moveWithCollision(bare, a.center, b.center);
    check(between.length === 0 && roomAt(entry.house, stop.x, stop.z) === a && isFree(bare, stop), `one long step from bedroom 1 towards bedroom 2 stops at the wall between them (ended in ${roomAt(entry.house, stop.x, stop.z)?.id})`);
    for (const radius of [0.05, 0.12]) {
      const thin = moveWithCollision(bare, a.center, b.center, radius);
      check(roomAt(entry.house, thin.x, thin.z) === a, `a thin walker (radius ${radius} m) cannot slip through a 0.2 m wall either`);
    }
    // A walker stuck inside something (furniture moved onto it) is pushed out to the nearest free floor.
    const model = walkable.find((e) => e.label === CASES[2].label).model;
    const bed = model.furniture.find((f) => pointIn(a.rect, { x: (f.minX + f.maxX) / 2, z: (f.minZ + f.maxZ) / 2 }));
    const inBed = { x: (bed.minX + bed.maxX) / 2, z: (bed.minZ + bed.maxZ) / 2 };
    check(!isFree(model, inBed), 'a point in the middle of the bed is not free');
    const out = moveWithCollision(model, inBed, inBed);
    const toEdge = Math.min(inBed.x - bed.minX, bed.maxX - inBed.x, inBed.z - bed.minZ, bed.maxZ - inBed.z) + WALK_RADIUS;
    check(isFree(model, out) && Math.hypot(out.x - inBed.x, out.z - inBed.z) <= toEdge + 0.06, `a stuck walker is pushed out to the nearest free floor (${Math.hypot(out.x - inBed.x, out.z - inBed.z).toFixed(2)} m, edge ${toEdge.toFixed(2)} m)`);
    check(isFree(model, moveWithCollision(model, { x: -1e6, z: 1e6 }, { x: 1e6, z: 1e6 })), 'a walker far outside is brought back in to free floor');
  }

  // ------------------------------------------------------------------ 5
  section('5. Furniture: the child\'s moves count, and free spots for new pieces');
  {
    const entry = walkable.find((e) => e.label === CASES[2].label);
    const { house, world } = entry;
    const record = world.builder.records[house.groupId];
    const bedroom = findRoom(house, { type: 'bedroom', ordinal: 1 });
    const bedId = Object.keys(record.pieces).find((id) => record.pieces[id].key === 'furn:bedroom#0:0');
    const before = buildWalkModel(house, world.store.getState().placedObjects, registry);
    const oldBox = before.furniture.find((f) => f.id === bedId);
    check(oldBox !== undefined && sameBox(oldBox, boxOf(world.store.getState().placedObjects.find((p) => p.id === bedId))), 'the bed is in the walk model where it stands');
    const bed = world.store.getState().placedObjects.find((p) => p.id === bedId);
    world.actions.selectPlacedObject(bedId);
    let status = null;
    for (const [dx, dz] of [[0.6, 0], [-0.6, 0], [0.4, 0], [-0.4, 0], [0, 0.5], [0.3, 0.3]]) {
      status = world.actions.moveSelectedPlacedObject(bed.position.x + dx, bed.position.z + dz);
      if (status?.valid) break;
    }
    world.actions.selectPlacedObject(null);
    const moved = world.store.getState().placedObjects.find((p) => p.id === bedId);
    check(status?.valid && Math.hypot(moved.position.x - bed.position.x, moved.position.z - bed.position.z) > 0.2, `the child moves the bed with the real actions (${moved.position.x - bed.position.x}, ${moved.position.z - bed.position.z})`);
    const after = buildWalkModel(house, world.store.getState().placedObjects, registry);
    const newBox = after.furniture.find((f) => f.id === bedId);
    check(newBox !== undefined && sameBox(newBox, boxOf(moved)) && !sameBox(newBox, oldBox) && !after.obstacles.some((o) => sameBox(o, oldBox)), 'the walk model has the bed where it was moved to, and not where it was');
    check(after.furniture.length === before.furniture.length && after.obstacles.length === before.obstacles.length, 'moving furniture keeps the obstacle count');
    // A point just inside the edge of the bed's old box that it moved away from.
    const movedAlongX = Math.abs(moved.position.x - bed.position.x) >= 0.1;
    const vacated = movedAlongX
      ? { x: moved.position.x > bed.position.x ? oldBox.minX + 0.05 : oldBox.maxX - 0.05, z: (oldBox.minZ + oldBox.maxZ) / 2 }
      : { x: (oldBox.minX + oldBox.maxX) / 2, z: moved.position.z > bed.position.z ? oldBox.minZ + 0.05 : oldBox.maxZ - 0.05 };
    check(!isFree(before, vacated, 0.01) && isFree(after, vacated, 0.01), 'floor the bed left is walkable now; it was blocked before');
    const without = buildWalkModel(house, world.store.getState().placedObjects.filter((p) => p.id !== bedId), registry);
    check(without.furniture.length === before.furniture.length - 1 && !without.furniture.some((f) => f.id === bedId), 'a removed bed is gone from the walk model');
    // Low things are walked over; tall things block, wherever they come from.
    const centre = bedroom.center;
    const y = house.floorY;
    const extra = (id, definitionId) => ({ id, definitionId, position: { x: centre.x, y, z: centre.z }, rotationY: 0, scale: { x: 1, y: 1, z: 1 }, materialOverrides: {}, supportId: null, hostId: null, createdAt: '' });
    const withExtras = buildWalkModel(house, [...world.store.getState().placedObjects, extra('low-beam', 'beam_timber'), extra('chair', 'furniture_chair')], registry);
    check(withExtras.furniture.some((f) => f.id === 'chair') && !withExtras.furniture.some((f) => f.id === 'low-beam'), 'a chair the child adds blocks the way; a 0.15 m beam on the floor is walked over');
    const roofTop = { ...extra('on-roof', 'furniture_chair'), position: { x: centre.x, y: house.ceilingY + 0.1, z: centre.z } };
    check(!buildWalkModel(house, [...world.store.getState().placedObjects, roofTop], registry).furniture.some((f) => f.id === 'on-roof'), 'something standing on the roof is not in the way inside');

    // Free spots.
    const model = after;
    const bedroomDoors = model.doors.filter((d) => d.sides.includes(bedroom.id));
    const zones = bedroomDoors.map((d) => {
      const inward = inwardOf(d, bedroom.id);
      const a = { x: d.x + inward.x * 0.1, z: d.z + inward.z * 0.1 };
      const b = { x: d.x + inward.x * 1.0, z: d.z + inward.z * 1.0 };
      const half = { x: Math.abs(inward.z) * d.width / 2, z: Math.abs(inward.x) * d.width / 2 };
      return { minX: Math.min(a.x, b.x) - half.x, maxX: Math.max(a.x, b.x) + half.x, minZ: Math.min(a.z, b.z) - half.z, maxZ: Math.max(a.z, b.z) + half.z };
    });
    const spotBox = (spot, width, depth) => {
      const turned = Math.abs(Math.round(spot.rotationY / QUARTER)) % 2 === 1;
      const [w, d] = turned ? [depth, width] : [width, depth];
      return { minX: spot.x - w / 2, maxX: spot.x + w / 2, minZ: spot.z - d / 2, maxZ: spot.z + d / 2 };
    };
    const shrink = (b, by) => ({ minX: b.minX + by, maxX: b.maxX - by, minZ: b.minZ + by, maxZ: b.maxZ - by });
    const grow = (b, by) => shrink(b, -by);
    const spot = findFreeSpot(model, bedroom, { width: 2, depth: 1.6 });
    check(spot !== null, `a 2 x 1.6 m spot is found in bedroom 1 (${spot ? `${spot.x}, ${spot.z}, turn ${spot.rotationY.toFixed(2)}` : 'none'})`);
    if (spot) {
      const box = spotBox(spot, 2, 1.6);
      check(inside(box, bedroom.rect) && Math.abs(Math.round(spot.rotationY / QUARTER) * QUARTER - spot.rotationY) < 1e-9, 'the spot is inside the bedroom, turned a whole quarter');
      check(!model.obstacles.some((o) => overlap(grow(box, 0.049), o)), 'the spot keeps clear of walls and furniture');
      check(bedroomDoors.length > 0 && !zones.some((z) => overlap(shrink(z, 0.001), box)), `the spot leaves the floor in front of the bedroom's ${bedroomDoors.length} door(s) free`);
      // Against a wall by default: its back 0.05 m from a wall.
      const back = rotateAroundY(0, -1, spot.rotationY);
      const gap = back.z < -0.9 ? box.minZ - bedroom.rect.minZ : back.z > 0.9 ? bedroom.rect.maxZ - box.maxZ : back.x < -0.9 ? box.minX - bedroom.rect.minX : bedroom.rect.maxX - box.maxX;
      check(near(gap, 0.05, 1e-6), `by default the piece stands with its back against a wall (gap ${gap.toFixed(3)} m)`);
    }
    check(findFreeSpot(model, bedroom, { width: 50, depth: 50 }) === null && findFreeSpot(model, bedroom, { width: 0, depth: 1 }) === null && findFreeSpot(model, bedroom, { width: NaN, depth: 1 }) === null, 'an impossible size gets null, so EAVARA can say it does not fit');
    const windows = windowsOf(model, bedroom);
    const toWindow = (s) => Math.min(...windows.map((w) => Math.hypot(w.x - s.x, w.z - s.z)));
    const byWindow = findFreeSpot(model, bedroom, { width: 2, depth: 1.6 }, { near: 'window' });
    check(byWindow !== null && spot !== null && windows.length > 0 && toWindow(byWindow) < toWindow(spot), `near: 'window' picks a spot by a window (${byWindow && toWindow(byWindow).toFixed(2)} m vs ${spot && toWindow(spot).toFixed(2)} m by default)`);
    const small = findFreeSpot(model, bedroom, { width: 0.5, depth: 0.5 }, { near: 'window' });
    const smallDefault = findFreeSpot(model, bedroom, { width: 0.5, depth: 0.5 }, { near: 'centre' });
    check(small && smallDefault && toWindow(small) < toWindow(smallDefault), `a small piece near the window is closer to it than one near the centre (${small && toWindow(small).toFixed(2)} vs ${smallDefault && toWindow(smallDefault).toFixed(2)})`);
    const centred = findFreeSpot(model, bedroom, { width: 0.5, depth: 0.5 }, { near: 'centre' });
    check(centred && Math.hypot(centred.x - bedroom.center.x, centred.z - bedroom.center.z) < 1.5, 'near: centre stays near the middle of the room');
    const corner = { x: bedroom.rect.maxX, z: bedroom.rect.maxZ };
    const toward = findFreeSpot(model, bedroom, { width: 0.5, depth: 0.5 }, { near: corner });
    check(toward && Math.hypot(toward.x - corner.x, toward.z - corner.z) < Math.hypot(centred.x - corner.x, centred.z - corner.z), 'near a point picks the free spot closest to it');
    const fixed = findFreeSpot(model, bedroom, { width: 2, depth: 0.6 }, { rotationY: QUARTER });
    check(fixed && fixed.rotationY === QUARTER, 'a requested turn is kept');
    // The spot really is free: placing a piece of that size there with the real actions works.
    const wardrobe = registry.get('furniture_wardrobe');
    const place = findFreeSpot(model, bedroom, { width: wardrobe.dimensions.width, depth: wardrobe.dimensions.depth });
    const placedBefore = world.store.getState().placedObjects.length;
    const instance = world.actions.instantiateTemplate({ objects: [{ definitionId: wardrobe.id, position: { x: 0, y: house.floorY, z: 0 }, rotationY: place.rotationY }] }, { x: place.x, y: 0, z: place.z }, 0);
    check(instance.placed === 1 && world.store.getState().placedObjects.length === placedBefore + 1, 'a wardrobe placed at the free spot is accepted by the real placement rules');
    const withWardrobe = buildWalkModel(house, world.store.getState().placedObjects, registry);
    check(withWardrobe.furniture.length === model.furniture.length + 1, 'and the new wardrobe is in the walk model');
    const again = findFreeSpot(withWardrobe, bedroom, { width: wardrobe.dimensions.width, depth: wardrobe.dimensions.depth });
    check(again && !(near(again.x, place.x) && near(again.z, place.z)), 'the next free spot is somewhere else');
  }

  // ------------------------------------------------------------------ 6
  section('6. Rooms are the same after a reload');
  {
    memory.delete(TEST_PLAN_KEY);
    const planStore = new LocalPlanStore(TEST_PLAN_KEY);
    const world = makeWorld({ azimuth: 90, planStore });
    const house = world.build({ ...CASES[3].input, site: { near: 'view' } });
    const street = world.build({ kind: 'neighborhood', houses: 3, site: { near: 'home' } });
    const describeAll = (builder) => [
      describeHouseInterior(house.groupId, builder.records[house.groupId], registry, null),
      ...[0, 1, 2].map((i) => describeHouseInterior(street.groupId, builder.records[street.groupId], registry, i)),
    ];
    const first = describeAll(world.builder);
    check(memory.has(TEST_PLAN_KEY) && TEST_PLAN_KEY.indexOf('city-builder.') !== 0, 'the plans are saved under the test key');
    const askedOrder = world.builder.records[house.groupId].plan.rooms.join();
    world.newBuilder();
    const second = describeAll(world.builder);
    const reloadedOrder = world.builder.records[house.groupId].plan.rooms.join();
    // A saved plan comes back with its rooms grouped by type, which HouseLayout would lay out differently...
    check(askedOrder !== reloadedOrder, `the reloaded plan lists its rooms in another order (${askedOrder} -> ${reloadedOrder})`);
    // ...yet the rooms are still the ones standing: every piece of furniture in its own room.
    const reloadedRecord = world.builder.records[house.groupId];
    const standingFurniture = world.piecesWhere(house.groupId, (k) => k.startsWith('furn:'));
    check(
      second[0] !== null && standingFurniture.length > 0 && standingFurniture.every((p) => inside(boxOf(p), second[0].rooms.find((r) => r.furnitureKeys.includes(reloadedRecord.pieces[p.id].key))?.rect ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, 1e-4)),
      'after the reload every piece of furniture is still in its own room (the built room order is recovered)',
    );
    check(JSON.stringify(layoutHouse(second[0].plan, registry).keys) === JSON.stringify(layoutHouse(first[0].plan, registry).keys) && layoutHouse(second[0].plan, registry).keys.length > 0, "the described plan lays out exactly what was built, before and after the reload");
    check(first.every((h) => h !== null) && JSON.stringify(first.map((h) => h.rooms)) === JSON.stringify(second.map((h) => h?.rooms)), 'every room comes back exactly the same from a fresh PlanBuilder');
    check(JSON.stringify(first) === JSON.stringify(second), 'so does everything else about the houses');
    const models = (houses) => houses.map((h) => buildWalkModel(h, world.store.getState().placedObjects, registry));
    check(JSON.stringify(models(first).map((m) => [m.walls, m.doors, tourOrder(m), entryPose(m)])) === JSON.stringify(models(second).map((m) => [m.walls, m.doors, tourOrder(m), entryPose(m)])), 'and so do the walk models, the tours and the way in');
    memory.delete(TEST_PLAN_KEY);
  }

  section('7. A walker stuck in furniture stays in its room; odd radii are safe');
  {
    let stuckCases = 0;
    let wrongRoom = 0;
    let notFree = 0;
    for (const entry of walkable) {
      const model = interior.buildWalkModel(entry.house, entry.world.store.getState().placedObjects, registry);
      for (const box of model.furniture) {
        const centre = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
        const room = interior.roomAt(entry.house, centre.x, centre.z);
        if (!room || interior.isFree(model, centre)) continue;
        stuckCases++;
        const out = interior.moveWithCollision(model, centre, centre);
        if (!interior.isFree(model, out)) notFree++;
        else if (interior.roomAt(entry.house, out.x, out.z) !== room) wrongRoom++;
      }
    }
    check(stuckCases > 20, `stuck walkers were tried inside ${stuckCases} pieces of furniture`);
    check(notFree === 0 && wrongRoom === 0, `every stuck walker is pushed out to a free spot in the same room (${notFree} not free, ${wrongRoom} pushed into another room)`);

    const { house, world } = walkable[0];
    const model = interior.buildWalkModel(house, world.store.getState().placedObjects, registry);
    const wall = model.walls[0];
    const wallCentre = { x: (wall.minX + wall.maxX) / 2, z: (wall.minZ + wall.maxZ) / 2 };
    check(!interior.isFree(model, wallCentre, Number.NaN) && !interior.isFree(model, wallCentre, -1), 'a NaN or negative radius means the normal walker, never a ghost that walks through walls');
    const from = interior.roomViewpoint(model, house.rooms[0]);
    const t0 = performance.now();
    const far = interior.moveWithCollision(model, from, { x: from.x + 50, z: from.z + 50 }, 1e-6);
    const ms = performance.now() - t0;
    check(ms < 250 && interior.isFree(model, far, 1e-6), `a tiny radius cannot make one move take thousands of steps (${ms.toFixed(1)} ms)`);
  }
} finally {
  await server.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
