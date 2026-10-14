/**
 * Acceptance tests for planned construction (src/creative/plan):
 * plan validation, house layout geometry, site finding, and building a plan
 * through the real GameActions / HistoryService / MyWorldStorage code.
 *
 * Runs the game's own TypeScript modules through Vite's SSR loader, so no
 * extra test dependencies are needed:   npm run test:plan
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

const EXAMPLE = {
  version: 1,
  kind: 'house',
  name: 'Lakeside House',
  size: { width: 30, depth: 20 },
  site: { near: 'lake' },
  rooms: [{ type: 'bedroom', count: 3 }, { type: 'living' }, { type: 'kitchen' }],
  garden: true,
  driveway: true,
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
  const { computeBounds, boundsOverlap } = await load('/src/construction/bounds.ts');
  const { TemplateRegistry } = await load('/src/creative/Template.ts');
  const { parseConstructionPlan } = await load('/src/creative/plan/ConstructionPlan.ts');
  const { layoutHouse } = await load('/src/creative/plan/HouseLayout.ts');
  const { chooseSite, worldRect } = await load('/src/creative/plan/PlanSite.ts');
  const { PlanBuilder } = await load('/src/creative/plan/PlanBuilder.ts');
  const { GameStore } = await load('/src/state/GameStore.ts');
  const { createInitialState } = await load('/src/state/initialState.ts');
  const { GameActions } = await load('/src/state/actions.ts');
  const { ChallengeRegistry } = await load('/src/challenges/ChallengeRegistry.ts');
  const { WorldSpace } = await load('/src/world/WorldSpace.ts');
  const { HistoryService } = await load('/src/creative/HistoryService.ts');
  const { LocalMyWorldStorage } = await load('/src/state/MyWorldStorage.ts');
  const { rotateAroundY } = await load('/src/utils/math.ts');

  const registry = new ObjectRegistry();
  registry.registerAll(objectDefinitions);
  const UNIT = { x: 1, y: 1, z: 1 };
  const boundsOf = (spec, origin = { x: 0, y: 0, z: 0 }, turn = 0) => {
    const offset = rotateAroundY(spec.position.x, spec.position.z, turn);
    const position = { x: origin.x + offset.x, y: origin.y + spec.position.y, z: origin.z + offset.z };
    return computeBounds(registry.get(spec.definitionId), position, (spec.rotationY ?? 0) + turn, spec.scale ?? UNIT);
  };
  const union = (boxes) =>
    boxes.reduce(
      (u, b) => ({ minX: Math.min(u.minX, b.minX), maxX: Math.max(u.maxX, b.maxX), minZ: Math.min(u.minZ, b.minZ), maxZ: Math.max(u.maxZ, b.maxZ) }),
      { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
    );

  /** Pairs of pieces that share volume, except an opening inside its own host wall. */
  function overlaps(objects) {
    const items = objects.map((spec, index) => ({ spec, index, box: boundsOf(spec) })).sort((a, b) => a.box.minX - b.box.minX);
    const found = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length && items[j].box.minX < items[i].box.maxX; j++) {
        const a = items[i];
        const b = items[j];
        const hosted = (x, y) => x.spec.hostRef && x.spec.hostRef === y.spec.localId;
        if (hosted(a, b) || hosted(b, a)) continue;
        if (boundsOverlap(a.box, b.box)) found.push(`${a.spec.definitionId}#${a.index} x ${b.spec.definitionId}#${b.index}`);
      }
    }
    return found;
  }

  /** Rooms reachable from outside through doors (graph over the layout's rooms). */
  function unreachableRooms(layout) {
    const roomAt = (x, z) => {
      const index = layout.rooms.findIndex((r) => x > r.rect.minX && x < r.rect.maxX && z > r.rect.minZ && z < r.rect.maxZ);
      if (index >= 0) return index;
      const { width, depth } = layout.footprint;
      return Math.abs(x) > width / 2 || Math.abs(z) > depth / 2 ? 'outside' : null;
    };
    const links = new Map();
    const link = (a, b) => {
      if (a === null || b === null || a === b) return;
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!links.has(x)) links.set(x, new Set());
        links.get(x).add(y);
      }
    };
    for (const spec of layout.objects) {
      if (roleOf(registry.get(spec.definitionId)) !== 'opening' || registry.get(spec.definitionId).type !== 'door') continue;
      const normal = rotateAroundY(0, 1, spec.rotationY ?? 0);
      const p = spec.position;
      link(roomAt(p.x + normal.x * 0.3, p.z + normal.z * 0.3), roomAt(p.x - normal.x * 0.3, p.z - normal.z * 0.3));
    }
    const seen = new Set(['outside']);
    const queue = ['outside'];
    while (queue.length) for (const next of links.get(queue.shift()) ?? []) if (!seen.has(next)) seen.add(next), queue.push(next);
    return layout.rooms.map((_, i) => i).filter((i) => !seen.has(i));
  }

  function checkLayout(plan, label) {
    const layout = layoutHouse(plan, registry);
    const walls = layout.objects.filter((s) => roleOf(registry.get(s.definitionId)) === 'wall');
    const W = plan.size.width;
    const D = plan.size.depth;
    // The house floor (a balcony's deck tiles are floors too, but outside the walls).
    const floors = layout.objects.filter(
      (s) => roleOf(registry.get(s.definitionId)) === 'floor' && s.position.y === 0 && Math.abs(s.position.x) < W / 2 && Math.abs(s.position.z) < D / 2,
    );
    const w = union(walls.map((s) => boundsOf(s)));
    const f = union(floors.map((s) => boundsOf(s)));
    check(near(w.minX, -W / 2) && near(w.maxX, W / 2) && near(w.minZ, -D / 2) && near(w.maxZ, D / 2), `${label}: wall outer faces are exactly ${W} x ${D} m (got ${(w.maxX - w.minX).toFixed(3)} x ${(w.maxZ - w.minZ).toFixed(3)})`);
    check(near(f.minX, -W / 2) && near(f.maxX, W / 2) && near(f.minZ, -D / 2) && near(f.maxZ, D / 2), `${label}: floor covers exactly ${W} x ${D} m`);
    check(floors.length === (W / 2) * (D / 2), `${label}: ${(W / 2) * (D / 2)} floor tiles (got ${floors.length})`);
    const clashes = overlaps(layout.objects);
    check(clashes.length === 0, `${label}: no overlapping pieces (${clashes.slice(0, 3).join(', ')})`);
    const lost = unreachableRooms(layout);
    check(lost.length === 0, `${label}: every room reachable from the front door (unreachable: ${lost.map((i) => layout.rooms[i].type).join(', ')})`);
    try {
      new TemplateRegistry().upsert({ id: 'check', name: 'Check', description: '', icon: 'x', objects: layout.objects });
      check(true, '');
    } catch (error) {
      check(false, `${label}: layout is a valid template (${error.message})`);
    }
    checkStructure(plan, layout, label);
    return layout;
  }

  /** Roof, doors and windows sit where a real house has them. */
  function checkStructure(plan, layout, label) {
    const W = plan.size.width;
    const D = plan.size.depth;
    const roofs = layout.objects.filter((s) => s.definitionId === 'roof_gable_long');
    if (plan.roof === 'gable') {
      const r = roofs.length === 1 ? boundsOf(roofs[0]) : null;
      check(r !== null, `${label}: one gable roof (got ${roofs.length})`);
      if (r) {
        check(near(r.minY, 2.9), `${label}: the roof rests exactly on the wall tops (y ${r.minY})`);
        check(near(r.minX, -W / 2 - 0.3) && near(r.maxX, W / 2 + 0.3) && near(r.minZ, -D / 2 - 0.3) && near(r.maxZ, D / 2 + 0.3), `${label}: the roof covers the walls with 0.3 m eaves`);
        const ridgeAlongX = Math.abs(Math.sin(roofs[0].rotationY ?? 0)) > 0.5;
        check(ridgeAlongX === W >= D, `${label}: the ridge runs along the longer side`);
        check(r.maxY - r.minY >= 1.5 && r.maxY - r.minY <= 4.5, `${label}: the roof rise is 1.5-4.5 m`);
      }
    } else {
      check(roofs.length === 0, `${label}: no pitched roof when ${plan.roof} was asked for`);
    }
    const byLocal = new Map(layout.objects.filter((s) => s.localId).map((s) => [s.localId, s]));
    for (const spec of layout.objects.filter((s) => s.hostRef)) {
      const host = byLocal.get(spec.hostRef);
      const hb = host && boundsOf(host);
      const ob = boundsOf(spec);
      const inside = hb && ob.minX >= hb.minX - 1e-6 && ob.maxX <= hb.maxX + 1e-6 && ob.minZ >= hb.minZ - 1e-6 && ob.maxZ <= hb.maxZ + 1e-6 && ob.maxY <= hb.maxY + 1e-6 && ob.minY >= hb.minY - 1e-6;
      if (!inside) {
        check(false, `${label}: ${spec.definitionId} sits inside its wall`);
        return;
      }
    }
    const doors = layout.objects.filter((s) => s.definitionId === 'door_single');
    check(doors.every((s) => near(s.position.y, 0.2)), `${label}: doors stand on the floor`);
  }

  // ------------------------------------------------------------------ 1
  section('1. Plan validation');
  {
    const { plan, errors, notes } = parseConstructionPlan(EXAMPLE);
    check(plan !== null && errors.length === 0, 'example plan is accepted');
    check(plan?.size.width === 30 && plan?.size.depth === 20, 'example size is kept at 30 x 20 m');
    check(notes.length === 0, `no adjustments for the example (got ${notes.join(' | ')})`);
    check(JSON.stringify(plan?.rooms) === JSON.stringify(['bedroom', 'bedroom', 'bedroom', 'living', 'kitchen']), 'rooms expand to 3 bedrooms, living room, kitchen');
    check(plan?.site.near === 'lake' && plan?.garden === true && plan?.driveway === true, 'site, garden and driveway are read');

    const rejected = [
      [null, 'null'],
      ['build me a house', 'plain text'],
      [[], 'an array'],
      [{}, 'an empty object'],
      [{ ...EXAMPLE, version: 2 }, 'another version'],
      [{ ...EXAMPLE, kind: 'rocket' }, 'an unknown kind'],
      [{ ...EXAMPLE, size: { width: '30', depth: 20 } }, 'a size given as text'],
      [{ ...EXAMPLE, size: { width: NaN, depth: 20 } }, 'a NaN size'],
      [{ ...EXAMPLE, size: { width: Infinity, depth: 20 } }, 'an infinite size'],
      [{ ...EXAMPLE, size: { width: -30, depth: 20 } }, 'a negative size'],
      [{ ...EXAMPLE, size: undefined }, 'no size'],
    ];
    for (const [input, label] of rejected) check(parseConstructionPlan(input).plan === null, `rejects ${label}`);

    const big = parseConstructionPlan({ ...EXAMPLE, size: { width: 1000, depth: 3 } });
    check(big.plan?.size.width === 40 && big.plan?.size.depth === 8 && big.notes.length === 2, 'clamps sizes to 8..40 m and says so');
    const odd = parseConstructionPlan({ ...EXAMPLE, size: { width: 25, depth: 17.3 } });
    check(odd.plan?.size.width === 26 && odd.plan?.size.depth === 18 && odd.notes.length === 2, 'rounds sizes to the 2 m module and says so');
    const many = parseConstructionPlan({ ...EXAMPLE, rooms: [{ type: 'bedroom', count: 99 }, { type: 'dungeon' }, { type: 'kitchen', count: 9 }] });
    check(many.plan?.rooms.length === 10 && many.plan.rooms.filter((r) => r === 'bedroom').length === 6, 'caps rooms (6 of a kind, 10 in all)');
    check(many.warnings.some((w) => w.includes('dungeon')), 'ignores unknown room types with a warning');
    const hostile = parseConstructionPlan(
      JSON.parse('{"__proto__":{"polluted":true},"version":1,"kind":"house","size":{"width":12,"depth":10},"script":"alert(1)","name":"<img src=x onerror=alert(1)>\\u0000\\u0007 House of a very very long name"}'),
    );
    check(hostile.plan !== null && {}.polluted === undefined, '__proto__ in input cannot pollute objects');
    check(hostile.warnings.some((w) => w.includes('"script"')), 'unknown fields are ignored with a warning');
    check(hostile.plan.name.length <= 32 && !/[\u0000-\u001f]/.test(hostile.plan.name), 'names are cut to 32 characters with control characters removed');
    const badSite = parseConstructionPlan({ ...EXAMPLE, site: { at: { x: 'a', z: 1 } } });
    check(badSite.plan?.site.near === 'view', 'an unreadable site falls back to the current view');
  }

  // ------------------------------------------------------------------ 2
  section('2. House layout');
  {
    const plan = parseConstructionPlan(EXAMPLE).plan;
    const started = performance.now();
    const layout = checkLayout(plan, '30x20 example');
    console.log(`  layout: ${layout.objects.length} pieces in ${(performance.now() - started).toFixed(1)} ms`);
    const count = (type) => layout.rooms.filter((r) => r.type === type).length;
    check(count('bedroom') === 3 && count('living') === 1 && count('kitchen') === 1 && layout.rooms.length === 5, 'has 3 bedrooms, a living room and a kitchen');
    check(layout.notes.length === 0, `nothing had to be dropped (${layout.notes.join(' | ')})`);
    const byType = (type) => layout.objects.filter((s) => registry.get(s.definitionId).type === type);
    check(byType('door').length === 1 + 3 + 1, `doors: front + one per bedroom + living/kitchen (got ${byType('door').length})`);
    check(byType('door').every((s) => near(s.position.y, 0.2)), 'doors stand on the floor (y = 0.2 m)');
    check(byType('window').length >= 5 && byType('window').every((s) => near(s.position.y, 1.1)), 'windows sit 0.9 m above the floor');
    // 30 x 20 m: three roomy bedrooms (bed + desk + chair each), a big living room (sofa,
    // coffee table, two armchairs) and a kitchen (table, four chairs). No bathroom fittings exist.
    check(byType('bed').length === 3 && byType('sofa').length === 1, 'every bedroom gets a bed, the living room a sofa');
    check(byType('table').length === 3 + 1 + 1, `tables: a desk per roomy bedroom, a coffee table, a kitchen table (got ${byType('table').length})`);
    check(byType('chair').length === 3 + 2 + 4, `chairs: desk chairs, two armchairs, four kitchen chairs (got ${byType('chair').length})`);
    const small = layoutHouse({ ...plan, size: { width: 10, depth: 8 }, rooms: ['bedroom', 'living'] }, registry);
    check(small.objects.filter((s) => registry.get(s.definitionId).type === 'table').length === 1, 'a small house is not over-furnished (no desk in a small bedroom)');
    check(byType('road').length === 2 && byType('car').length === 1, 'driveway of two tiles with a car');
    check(byType('tree').length >= 2 && byType('bush').length >= 2, 'garden has trees and bushes');
    for (const room of layout.rooms) {
      const r = room.rect;
      check(r.maxX - r.minX >= 2.4 && r.maxZ - r.minZ >= 3.6, `${room.type} is at least 2.4 x 3.6 m (${(r.maxX - r.minX).toFixed(1)} x ${(r.maxZ - r.minZ).toFixed(1)})`);
    }

    const roofed = checkLayout({ ...plan, roof: 'flat' }, '30x20 flat roof');
    check(roofed.objects.filter((s) => s.position.y > 2).length === 150, 'flat roof covers the whole house (150 tiles)');
    checkLayout({ ...plan, roof: 'none' }, '30x20 open top (asked for)');
    checkLayout({ ...plan, size: { width: 12, depth: 20 } }, '12x20 (ridge along Z)');

    // Every size the plan format allows, with a crowded room list.
    const crowded = parseConstructionPlan({
      ...EXAMPLE,
      rooms: [{ type: 'bedroom', count: 4 }, { type: 'living' }, { type: 'kitchen' }, { type: 'bathroom', count: 2 }],
      balcony: true,
    }).plan;
    let checked = 0;
    const before = failures;
    for (let width = 8; width <= 40; width += 2) {
      for (let depth = 8; depth <= 40; depth += 2) {
        checkLayout({ ...crowded, size: { width, depth } }, `${width}x${depth}`);
        checkLayout({ ...crowded, size: { width, depth }, rooms: ['kitchen'], garden: false, driveway: false }, `${width}x${depth} one room`);
        checked++;
      }
    }
    console.log(`  swept ${checked} sizes x 2 room lists${failures === before ? ', all exact and overlap-free' : ''}`);
    const tiny = layoutHouse({ ...crowded, size: { width: 8, depth: 8 } }, registry);
    check(tiny.notes.some((n) => n.includes('bedroom')), 'a small house explains which rooms did not fit');
  }

  // ------------------------------------------------------------------ 3
  section('3. Building a plan in My World (real GameActions)');
  {
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
    const history = new HistoryService(store, actions);
    history.start();
    actions.finishBoot();
    actions.enterMyWorld('Tester');
    await Promise.resolve();

    const builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth: 25 }));
    let framed = null;
    builder.onPreview = (center, radius) => (framed = { center, radius });
    const started = performance.now();
    const preview = builder.preview(EXAMPLE);
    console.log(`  preview: ${(performance.now() - started).toFixed(1)} ms`);
    check(preview.ok, `preview succeeds (${preview.errors.join(' | ')})`);
    const placement = store.getState().templatePlacement;
    check(placement?.templateId === preview.summary.templateId && placement.origin !== undefined, 'preview is a pinned template placement');
    check(store.getState().placedObjects.length === 0, 'previewing builds nothing yet');
    check(framed !== null && framed.radius > 15, 'the camera is asked to frame the preview');

    const lake = [...worldDefinition.water].sort((a, b) => b.radius - a.radius)[0];
    const template = templates.get(placement.templateId);
    const t0 = performance.now();
    const result = actions.instantiateTemplate(template, placement.origin, placement.rotationY, placement.creationId);
    console.log(`  build: ${result.placed} pieces in ${(performance.now() - t0).toFixed(1)} ms`);
    actions.cancelTemplatePlacement();
    await Promise.resolve();
    check(result.placed === template.objects.length && result.skipped === 0, `every planned piece is built (${result.placed} placed, ${result.skipped} skipped)`);
    const placed = store.getState().placedObjects;
    check(placed.length === template.objects.length && placed.every((p) => p.group?.id === result.groupId && p.group.creation === 'house'), 'pieces are ordinary placed objects in one "house" creation group');

    const walls = placed.filter((p) => roleOf(registry.get(p.definitionId)) === 'wall');
    const box = union(walls.map((p) => computeBounds(registry.get(p.definitionId), p.position, p.rotationY, p.scale)));
    const sx = box.maxX - box.minX;
    const sz = box.maxZ - box.minZ;
    check((near(sx, 30, 1e-4) && near(sz, 20, 1e-4)) || (near(sx, 20, 1e-4) && near(sz, 30, 1e-4)), `built walls measure 30 x 20 m in the world (got ${sx.toFixed(4)} x ${sz.toFixed(4)})`);
    const dx = Math.max(box.minX - lake.x, 0, lake.x - box.maxX);
    const dz = Math.max(box.minZ - lake.z, 0, lake.z - box.maxZ);
    const fromShore = Math.hypot(dx, dz) - lake.radius;
    check(fromShore > 0 && fromShore < 30, `house is near the lake: ${fromShore.toFixed(1)} m from the water's edge`);
    const back = rotateAroundY(0, -1, placement.rotationY);
    const toLake = { x: lake.x - placement.origin.x, z: lake.z - placement.origin.z };
    check(back.x * toLake.x + back.z * toLake.z > 0, 'the back garden faces the lake');

    // Editing the result with the normal tools.
    const bed = placed.find((p) => registry.get(p.definitionId).type === 'bed');
    actions.selectPlacedObject(bed.id);
    const moved = actions.moveSelectedPlacedObject(bed.position.x + 0.3, bed.position.z);
    const bedAfter = store.getState().placedObjects.find((p) => p.id === bed.id);
    check(moved?.valid === true && !near(bedAfter.position.x, bed.position.x), 'a planned bed can be moved like any object');
    const doorWall = store.getState().placedObjects.find((p) => store.getState().placedObjects.some((o) => o.hostId === p.id));
    const hosted = store.getState().placedObjects.filter((o) => o.hostId === doorWall.id).length;
    const countBefore = store.getState().placedObjects.length;
    actions.removePlacedObject(doorWall.id);
    check(store.getState().placedObjects.length === countBefore - 1 - hosted, 'removing a planned wall removes its door/window too');
    await Promise.resolve();

    // Undo back to the empty world, redo the build.
    while (history.canUndo) {
      history.undo();
      await Promise.resolve();
    }
    check(store.getState().placedObjects.length === 0, 'undo takes the whole house away');
    history.redo();
    await Promise.resolve();
    check(store.getState().placedObjects.length === template.objects.length, 'redo brings the whole house back in one step');

    // Saved and loaded like any My World build.
    const storage = new LocalMyWorldStorage('test.world');
    const state = store.getState();
    storage.save({ player: state.player, placedObjects: state.placedObjects, identity: state.myWorld });
    const loaded = storage.load();
    check(loaded?.placedObjects.length === state.placedObjects.length, 'the house survives a save and load');
    check(
      loaded.placedObjects.every((p, i) => p.id === state.placedObjects[i].id && near(p.position.x, state.placedObjects[i].position.x) && p.group?.id === result.groupId),
      'positions, ids and the creation group are kept',
    );

    // A second house near the lake goes somewhere free.
    const second = builder.preview({ ...EXAMPLE, name: 'Second House', size: { width: 16, depth: 12 } });
    check(second.ok, `a second lakeside house finds a spot (${second.errors.join(' | ')})`);
    const secondPlacement = store.getState().templatePlacement;
    const secondResult = actions.instantiateTemplate(templates.get(secondPlacement.templateId), secondPlacement.origin, secondPlacement.rotationY, 'house');
    check(secondResult.skipped === 0, `...and is built without clashing with the first (${secondResult.skipped} skipped)`);
    check(templates.get(preview.summary.templateId) === undefined, 'the earlier preview template is released');

    for (const site of [{ near: 'home' }, { near: 'view' }, { at: { x: 120, z: 40 } }]) {
      const result = builder.preview({ ...EXAMPLE, size: { width: 12, depth: 10 }, site });
      check(result.ok, `a site ${JSON.stringify(site)} is found`);
    }
    const nowhere = builder.preview({ ...EXAMPLE, site: { at: { x: 5000, z: 5000 } } });
    check(!nowhere.ok && nowhere.errors.length > 0, 'a site outside the world is refused with a reason');

    actions.cancelTemplatePlacement();
    store.setState({ challenge: { challengeId: 'level', status: 'in-progress', startedAt: '' } });
    check(!builder.preview(EXAMPLE).ok, 'planned building is refused during a challenge');
  }

  // ------------------------------------------------------------------ 4
  section('4. Rotated templates are built where their ghost shows them');
  {
    const store = new GameStore(createInitialState());
    const rules = { getBuildArea: () => ({ center: { x: 0, y: 0, z: 0 }, halfSize: 250 }) };
    const actions = new GameActions(store, registry, new ChallengeRegistry(registry), rules);
    actions.finishBoot();
    actions.enterMyWorld('Tester');
    const template = templateDefinitions.find((t) => t.id === 'intent_house');
    const origin = { x: 10, y: 0, z: -4 };
    const turn = Math.PI / 2;
    actions.instantiateTemplate(template, origin, turn, 'house');
    // The ghost: a three.js group at the origin, rotated, holding each piece.
    const group = new THREE.Group();
    group.position.set(origin.x, origin.y, origin.z);
    group.rotation.y = turn;
    const placed = store.getState().placedObjects;
    let matched = 0;
    for (const spec of template.objects) {
      const child = new THREE.Object3D();
      child.position.set(spec.position.x, spec.position.y, spec.position.z);
      group.add(child);
      group.updateMatrixWorld(true);
      const world = child.getWorldPosition(new THREE.Vector3());
      if (placed.some((p) => p.definitionId === spec.definitionId && near(p.position.x, world.x, 1e-4) && near(p.position.z, world.z, 1e-4))) matched++;
    }
    check(matched === template.objects.length, `all ${template.objects.length} pieces of a quarter-turned Cozy House land where the ghost drew them (${matched} did)`);
  }

  // ------------------------------------------------------------------ 5
  section('5. Challenge Mode regression (every level built through the real player actions)');
  {
    const { challengeDefinitions, worldDefinitions } = await load('/src/data/index.ts');
    const { matchBlueprint } = await load('/src/challenges/ChallengeMatcher.ts');
    const { blueprintWorldPosition } = await load('/src/challenges/Blueprint.ts');
    const { calculateStars } = await load('/src/progression/stars.ts');
    const challenges = new ChallengeRegistry(registry);
    challenges.registerWorlds(worldDefinitions);
    challenges.registerAll(challengeDefinitions);
    const store = new GameStore(createInitialState());
    const rules = {
      getBuildArea: () => {
        const c = store.getState().challenge;
        const d = c && challenges.get(c.challengeId);
        return d ? { center: d.buildOrigin, halfSize: d.buildAreaHalfSize } : { center: { x: 0, y: 0, z: 0 }, halfSize: 250 };
      },
      getPlacementTargets: () => ({ targets: [], requiredSupport: null }),
    };
    const actions = new GameActions(store, registry, challenges, rules);
    actions.finishBoot();
    actions.enterMyWorld('Tester');
    const park = templateDefinitions.find((t) => t.id === 'park_small');
    actions.instantiateTemplate(park, { x: 10, y: 0, z: 10 }, 0, 'park');
    const myWorld = store.getState().placedObjects;
    actions.returnToMenu();
    // Every level available (as if the earlier ones were done).
    store.setState({ progress: { ...store.getState().progress, completedChallengeIds: challengeDefinitions.map((c) => c.id) } });
    let perfect = 0;
    for (const level of challengeDefinitions) {
      check(actions.startChallenge(level.id), `${level.id}: the level starts`);
      const placedIds = new Map();
      let pending = [...level.blueprint.objects];
      for (let pass = 0; pass < 4 && pending.length; pass++) {
        const next = [];
        for (const target of pending) {
          const host = target.host ? placedIds.get(target.host) : null;
          const support = target.support?.length ? placedIds.get(target.support.find((id) => placedIds.has(id))) : null;
          if ((target.host && !host) || (target.support?.length && !support)) {
            next.push(target);
            continue;
          }
          actions.selectObject(target.definitionId);
          const placed = actions.placeObject(blueprintWorldPosition(level.buildOrigin, target), {
            rotationY: target.rotationStep * (Math.PI / 2),
            hostId: host ?? null,
            supportId: support ?? null,
            surface: host ? 'side' : support ? 'top' : 'ground',
          });
          if (placed) placedIds.set(target.id, placed.id);
        }
        pending = next;
      }
      const result = matchBlueprint(level, store.getState().placedObjects, registry);
      const stars = calculateStars(result);
      check(result.completed && stars === 3, `${level.id} "${level.title}": completed with 3 stars (${result.matchedCount}/${result.required} matched, ${stars} stars)`);
      if (result.completed && stars === 3) perfect++;
      actions.exitChallenge();
    }
    console.log(`  ${perfect}/${challengeDefinitions.length} levels completed with 3 stars`);
    check(store.getState().mode === 'world-map' && store.getState().placedObjects.length === 0, 'leaving a level returns to the map with the level cleared');
    check(store.getState().progress.completedChallengeIds.length === challengeDefinitions.length, 'Challenge progress is untouched by My World');
    check(myWorld.length > 0, 'My World had its own objects before the levels (restored by MyWorldPersistenceService in the app)');
  }

  // ======================================================== Milestone 2
  const { layoutPlan, KIND_CREATION } = await load('/src/creative/plan/PlanLayouts.ts');
  const { planInput: planInputOf } = await load('/src/creative/plan/ConstructionPlan.ts');
  const { isContentKey } = await load('/src/creative/plan/LayoutKit.ts');
  const { LocalPlanStore } = await load('/src/creative/plan/PlanRecords.ts');
  const plan = (input) => {
    const result = parseConstructionPlan({ version: 1, ...input });
    if (!result.plan) throw new Error(`test plan rejected: ${result.errors.join(' ')}`);
    return result.plan;
  };
  const byLocalId = (layout) => new Map(layout.objects.filter((s) => s.localId).map((s) => [s.localId, s]));
  const typeIs = (spec, type) => registry.get(spec.definitionId).type === type;
  const gap = (a, b) => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));

  /** The invariants every planned creation must keep, whatever its kind. */
  function checkCreation(layout, label) {
    const clashes = overlaps(layout.objects);
    check(clashes.length === 0, `${label}: no overlapping pieces (${clashes.slice(0, 3).join(', ')})`);
    try {
      new TemplateRegistry().upsert({ id: 'check', name: 'Check', description: '', icon: 'x', objects: layout.objects });
      check(true, '');
    } catch (error) {
      check(false, `${label}: layout is a valid template (${error.message})`);
    }
    check(layout.keys.length === layout.objects.length && new Set(layout.keys).size === layout.keys.length, `${label}: every piece has its own stable key`);
    // Ground contact: on the ground, exactly on top of its support (and over it), or inside its host wall.
    const locals = byLocalId(layout);
    const floating = [];
    layout.objects.forEach((spec, i) => {
      const box = boundsOf(spec);
      if (spec.hostRef) {
        const host = locals.get(spec.hostRef);
        const h = host && boundsOf(host);
        if (!h || box.minX < h.minX - 1e-6 || box.maxX > h.maxX + 1e-6 || box.minZ < h.minZ - 1e-6 || box.maxZ > h.maxZ + 1e-6 || box.minY < h.minY - 1e-6 || box.maxY > h.maxY + 1e-6) floating.push(`${layout.keys[i]} outside its wall`);
      } else if (spec.supportRef) {
        const support = locals.get(spec.supportRef);
        const s = support && boundsOf(support);
        if (!s) floating.push(`${layout.keys[i]} has no support`);
        else if (!near(box.minY, s.maxY, 1e-6)) floating.push(`${layout.keys[i]} at y ${box.minY.toFixed(3)}, support top ${s.maxY.toFixed(3)}`);
        else if (!(box.minX < s.maxX && box.maxX > s.minX && box.minZ < s.maxZ && box.maxZ > s.minZ)) floating.push(`${layout.keys[i]} not over its support`);
      } else if (!near(box.minY, 0, 1e-6)) {
        floating.push(`${layout.keys[i]} off the ground (y ${box.minY})`);
      }
    });
    check(floating.length === 0, `${label}: every piece stands on the ground, on its support or in its wall (${floating.slice(0, 3).join('; ')})`);
    // The extent (what site finding keeps clear) covers every piece.
    const e = layout.extent;
    const outside = layout.objects.filter((spec) => {
      const b = boundsOf(spec);
      return b.minX < e.minX - 1e-6 || b.maxX > e.maxX + 1e-6 || b.minZ < e.minZ - 1e-6 || b.maxZ > e.maxZ + 1e-6;
    });
    check(outside.length === 0, `${label}: the site extent covers every piece (${outside.slice(0, 2).map((s) => s.definitionId).join(', ')})`);
  }

  // ------------------------------------------------------------------ 6
  section('6. Creation plans are validated for every kind');
  {
    const defaults = {
      garden: plan({ kind: 'garden' }),
      park: plan({ kind: 'park' }),
      neighborhood: plan({ kind: 'neighborhood' }),
      treehouse: plan({ kind: 'treehouse' }),
    };
    check(defaults.garden.size.width === 10 && defaults.garden.fence && defaults.garden.path && defaults.garden.benches === 1, 'a garden gets sensible defaults (10 x 8 m, fence, path, a bench)');
    check(defaults.park.size.width === 24 && defaults.park.lamps && !defaults.park.playground, 'a park gets sensible defaults (24 x 20 m, lamps, no playground unless asked)');
    check(defaults.neighborhood.houses === 4 && defaults.neighborhood.street && defaults.neighborhood.park, 'a neighbourhood defaults to 4 houses along a street with a park');
    check(defaults.treehouse.access === 'ladder' && defaults.treehouse.hut && defaults.treehouse.roof === 'gable', 'a treehouse defaults to a ladder and a hut with a pitched roof');
    const big = parseConstructionPlan({ version: 1, kind: 'garden', size: { width: 99, depth: 3 }, trees: 50, benches: -2 });
    check(big.plan?.size.width === 30 && big.plan.size.depth === 6 && big.plan.trees === 8 && big.plan.benches === 0 && big.notes.length >= 3, `garden sizes and counts are clamped, and each adjustment is explained (${big.notes.join(' | ')})`);
    const park = parseConstructionPlan({ version: 1, kind: 'park', size: { width: 30, depth: 22 } });
    check(park.plan?.size.width === 32 && park.plan.size.depth === 24 && park.notes.length === 2, 'park sizes round to the 4 m paving step and say so');
    const hood = parseConstructionPlan({ version: 1, kind: 'neighborhood', houses: 40, houseSize: { width: 30, depth: 9 } });
    check(hood.plan?.houses === 6 && hood.plan.houseSize.width === 16 && hood.plan.houseSize.depth === 10, 'a neighbourhood is capped at 6 houses of 10-16 m');
    const flat = parseConstructionPlan({ version: 1, kind: 'treehouse', roof: 'flat', access: 'rope' });
    check(flat.plan?.roof === 'gable' && flat.plan.access === 'ladder' && flat.notes.some((n) => n.includes('pitched')), 'a treehouse cannot get a flat roof or an unknown way up - and says why');
    const items = parseConstructionPlan({ version: 1, kind: 'objects', items: [{ item: 'bench', count: 9 }, { item: 'dragon', count: 1 }, { item: 'tree', count: 9 }] });
    check(items.plan?.items.reduce((s, i) => s + i.count, 0) === 12 && items.warnings.some((w) => w.includes('dragon')) && items.notes.length === 1, 'loose objects are capped at 12, unknown items are ignored');
    check(parseConstructionPlan({ version: 1, kind: 'objects', items: [] }).plan === null, 'an empty "add" is rejected with a reason');
    check(parseConstructionPlan({ version: 1, kind: 'castle' }).plan === null, 'an unsupported kind is rejected');
    const beside = parseConstructionPlan({ version: 1, kind: 'garden', site: { beside: 'back' } });
    check('beside' in (beside.plan?.site ?? {}) && beside.plan.site.beside === 'back', 'a garden can be planned behind the house');
    const roundTrip = Object.values(defaults).every((p) => JSON.stringify(parseConstructionPlan(planInputOf(p)).plan) === JSON.stringify(p));
    check(roundTrip, 'every kind survives the saved-plan round trip unchanged');
    const sneaky = parseConstructionPlan(JSON.parse('{"__proto__":{"evil":1},"version":1,"kind":"park","script":"x","benches":2}'));
    check(sneaky.plan !== null && {}.evil === undefined && sneaky.warnings.some((w) => w.includes('script')), 'hostile park input cannot pollute objects; unknown fields are ignored');
  }

  // ------------------------------------------------------------------ 7
  section('7. Creation layouts: geometry, safety and access');
  {
    // Gardens: every allowed size (2 m steps) with a full feature list.
    let swept = 0;
    const before = failures;
    for (let width = 6; width <= 30; width += 4) {
      for (let depth = 6; depth <= 30; depth += 4) {
        const p = plan({ kind: 'garden', size: { width, depth }, trees: 8, flowerBeds: 8, shrubs: 16, benches: 4, playground: width >= 16 && depth >= 16, lamps: true });
        const layout = layoutPlan(p, registry);
        checkCreation(layout, `garden ${width}x${depth}`);
        const fences = layout.objects.filter((s) => typeIs(s, 'fence'));
        const fenceLength = fences.reduce((sum, s) => sum + registry.get(s.definitionId).dimensions.width * (s.scale?.x ?? 1), 0);
        check(near(fenceLength, 2 * width + 2 * depth - 0.4 - 2, 1e-6), `garden ${width}x${depth}: the fence closes all round except a 2 m gate (${fenceLength.toFixed(2)} m)`);
        const path = layout.objects.filter((s) => typeIs(s, 'path')).map((s) => boundsOf(s));
        check(path.length > 0 && path.some((b) => near(b.maxZ, depth / 2) && b.minX >= -1 - 1e-6 && b.maxX <= 1 + 1e-6), `garden ${width}x${depth}: the path comes in through the gate`);
        const trees = layout.objects.filter((s) => typeIs(s, 'tree'));
        check(trees.every((a, i) => trees.slice(i + 1).every((b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= 3 - 1e-6)), `garden ${width}x${depth}: trees stand at least 3 m apart`);
        swept++;
      }
    }
    console.log(`  swept ${swept} garden sizes${failures === before ? ', all closed, connected and overlap-free' : ''}`);

    // Parks: crossing paths that reach the entrance, play equipment with safe space, lamps by the paths, benches facing them.
    for (const [width, depth] of [[12, 12], [24, 20], [32, 28], [60, 60]]) {
      const label = `park ${width}x${depth}`;
      const layout = layoutPlan(plan({ kind: 'park', size: { width, depth }, playground: true, benches: 12, trees: 30, flowerBeds: 12 }), registry);
      checkCreation(layout, label);
      const paths = layout.objects.filter((s) => typeIs(s, 'sidewalk')).map((s) => boundsOf(s));
      const across = paths.filter((b) => b.maxX - b.minX > b.maxZ - b.minZ);
      check(near(Math.min(...across.map((b) => b.minX)), -width / 2) && near(Math.max(...across.map((b) => b.maxX)), width / 2), `${label}: a path runs right across`);
      check(paths.some((b) => near(b.maxZ, depth / 2)), `${label}: a path reaches the entrance edge`);
      const play = layout.objects.filter((s) => ['slide', 'swing', 'sandpit'].includes(registry.get(s.definitionId).type));
      const others = layout.objects.filter((s) => !play.includes(s));
      const tight = play.filter((p) => [...others, ...play.filter((q) => q !== p)].some((o) => gap(boundsOf(p), boundsOf(o)) < 1.5 - 1e-6));
      check(play.length >= (width >= 24 ? 3 : 1) && tight.length === 0, `${label}: ${play.length} play pieces, each with 1.5 m of free ground round it`);
      const lamps = layout.objects.filter((s) => typeIs(s, 'streetlight'));
      check(lamps.every((l) => paths.some((b) => gap(boundsOf(l), b) <= 1.01)), `${label}: every lamp stands beside a path`);
      const benches = layout.objects.filter((s) => typeIs(s, 'bench'));
      const facing = benches.filter((bench) => {
        const front = rotateAroundY(0, 1, bench.rotationY ?? 0);
        const probe = { minX: bench.position.x + front.x * 1.2 - 0.05, maxX: bench.position.x + front.x * 1.2 + 0.05, minZ: bench.position.z + front.z * 1.2 - 0.05, maxZ: bench.position.z + front.z * 1.2 + 0.05 };
        return paths.some((b) => gap(probe, b) === 0);
      });
      check(benches.length > 0 && facing.length === benches.length, `${label}: all ${benches.length} benches face a path within 1.2 m`);
      check(layout.facts.measures.minPlayClearance >= 1.5 && layout.facts.measures.pathWidth === 1.5, `${label}: facts report the real clearance (${layout.facts.measures.minPlayClearance} m) and path width`);
    }

    // Treehouses: deck on posts round the tree, railings on every open edge, a way up at the railing gap, a roofed hut.
    for (const options of [{}, { access: 'stairs' }, { hut: false }, { roof: 'none' }]) {
      const label = `treehouse ${JSON.stringify(options)}`;
      const p = plan({ kind: 'treehouse', ...options });
      const layout = layoutPlan(p, registry);
      checkCreation(layout, label);
      const deck = layout.objects.filter((s) => s.definitionId === 'deck_wood');
      check(deck.length === 8 && deck.every((s) => near(boundsOf(s).maxY, 2.6)), `${label}: eight deck tiles, 2.6 m up`);
      const tree = boundsOf(layout.objects.find((s) => typeIs(s, 'tree')));
      check(tree.minX > -1 && tree.maxX < 1 && tree.minZ > -1 && tree.maxZ < 1 && tree.maxY > 6.3, `${label}: the tree grows up through the gap and above the hut`);
      const rails = layout.objects.filter((s) => s.definitionId === 'railing_wood');
      const railLength = rails.reduce((sum, s) => sum + 2 * (s.scale?.x ?? 1), 0);
      const openEdges = p.hut ? 9 : 11;
      // One railing per open 2 m edge, stopping at most 0.1 m short at each end where it meets a corner railing or the hut.
      check(rails.length === openEdges && rails.every((s) => 2 * (s.scale?.x ?? 1) >= 1.8 - 1e-6), `${label}: railings on all ${openEdges} open edges (${rails.length} pieces, ${railLength.toFixed(1)} m)`);
      check(rails.every((s) => near(boundsOf(s).maxY - boundsOf(s).minY, 1)), `${label}: railings are 1 m high`);
      const way = layout.objects.find((s) => ['ladder', 'stairs'].includes(registry.get(s.definitionId).type));
      const w = boundsOf(way);
      check(near(w.minZ, 3) && w.minX >= -1 && w.maxX <= 1, `${label}: the ${p.access} meets the deck at the gap in the railing`);
      check(p.access === 'ladder' ? w.maxY >= 2.6 + 0.9 - 1e-6 : near(w.maxY, 2.6), `${label}: ${p.access === 'ladder' ? 'the ladder rails rise 0.9 m above the deck' : 'the stairs reach the deck'}`);
      const walls = layout.objects.filter((s) => roleOf(registry.get(s.definitionId)) === 'wall');
      const roof = layout.objects.find((s) => roleOf(registry.get(s.definitionId)) === 'roof');
      if (p.hut) {
        const hut = union(walls.map((s) => boundsOf(s)));
        check(walls.length === 4 && near(hut.maxX - hut.minX, 2.2) && near(hut.maxZ - hut.minZ, 2.2), `${label}: a 2.2 m square hut`);
        check(layout.objects.some((s) => typeIs(s, 'door')) && layout.objects.filter((s) => typeIs(s, 'window')).length === 3, `${label}: the hut has a door and three windows`);
        if (p.roof === 'gable') {
          const r = boundsOf(roof);
          check(r.minX <= hut.minX && r.maxX >= hut.maxX && r.minZ <= hut.minZ && r.maxZ >= hut.maxZ && near(r.minY, 2.6 + 2.7), `${label}: the roof covers the hut and rests on its walls`);
        } else check(!roof, `${label}: no roof when the child asked for none`);
      } else {
        check(walls.length === 0 && layout.objects.some((s) => typeIs(s, 'bench')), `${label}: an open deck gets a bench instead of a hut`);
      }
    }

    // Neighbourhoods: real houses, each front path and driveway meeting the pavement, spaced apart.
    for (const options of [{}, { houses: 6 }, { houses: 3, street: false, park: false }, { houses: 2, houseSize: { width: 16, depth: 14 }, rooms: [{ type: 'bedroom', count: 2 }, { type: 'living' }, { type: 'kitchen' }, { type: 'bathroom' }] }]) {
      const label = `neighbourhood ${JSON.stringify(options)}`;
      const p = plan({ kind: 'neighborhood', ...options });
      const t0 = performance.now();
      const layout = layoutPlan(p, registry);
      const ms = performance.now() - t0;
      checkCreation(layout, label);
      check(ms < 500, `${label}: laid out in ${ms.toFixed(0)} ms`);
      const prefixes = [...new Set(layout.keys.map((k) => k.split('/')[0]).filter((k) => /^h\d+$/.test(k)))];
      check(prefixes.length === p.houses, `${label}: ${p.houses} houses`);
      const pavements = layout.objects.filter((s, i) => layout.keys[i].startsWith('pave:')).map((s) => boundsOf(s));
      for (const prefix of prefixes) {
        const piece = (key) => layout.objects[layout.keys.indexOf(`${prefix}/${key}`)];
        const walls = layout.objects.filter((s, i) => layout.keys[i].startsWith(`${prefix}/wall:`)).map((s) => boundsOf(s));
        const box = union(walls);
        const sizes = [box.maxX - box.minX, box.maxZ - box.minZ].sort((a, b) => a - b);
        const wanted = [p.houseSize.width, p.houseSize.depth].sort((a, b) => a - b);
        check(near(sizes[0], wanted[0], 1e-6) && near(sizes[1], wanted[1], 1e-6), `${label} ${prefix}: walls are exactly ${p.houseSize.width} x ${p.houseSize.depth} m`);
        for (const key of ['path:1', 'drive:1']) {
          const part = piece(key);
          check(part && pavements.some((b) => gap(boundsOf(part), b) < 1e-6), `${label} ${prefix}: the ${key.startsWith('path') ? 'front path' : 'driveway'} reaches the pavement`);
        }
      }
      check(layout.facts.measures.minHouseGap >= 4, `${label}: at least 4 m between neighbouring houses (${layout.facts.measures.minHouseGap} m)`);
      if (p.street) {
        const road = layout.objects.filter((s, i) => layout.keys[i].startsWith('road:')).map((s) => boundsOf(s)).sort((a, b) => a.minX - b.minX);
        check(road.every((b, i) => i === 0 || near(b.minX, road[i - 1].maxX)), `${label}: the street is continuous`);
        check(layout.objects.filter((s) => typeIs(s, 'streetlight')).every((s) => s.supportRef?.startsWith('p')), `${label}: lamps stand on the pavement`);
      }
      if (p.park) {
        const parkPaths = layout.objects.filter((s, i) => layout.keys[i].startsWith('park/walk:front')).map((s) => boundsOf(s));
        check(parkPaths.some((b) => pavements.some((pv) => gap(b, pv) < 1e-6)), `${label}: the shared park opens onto the pavement`);
      }
    }

    // Loose objects: what was asked for, in neat rows with room between them.
    const objects = layoutPlan(plan({ kind: 'objects', items: [{ item: 'bench', count: 3 }, { item: 'tree', count: 4 }, { item: 'slide', count: 1 }, { item: 'swing', count: 1 }] }), registry);
    checkCreation(objects, 'objects');
    check(objects.facts.counts.bench === 3 && objects.facts.counts.tree === 4 && objects.facts.counts.slide === 1, 'loose objects: exactly what was asked for');
    const boxes = objects.objects.map((s) => boundsOf(s));
    check(boxes.every((a, i) => boxes.slice(i + 1).every((b) => gap(a, b) >= 0.6 - 1e-6)), 'loose objects: at least 0.6 m of walking room between neighbours');
    check(near((objects.extent.minX + objects.extent.maxX) / 2, 0, 0.01) && near((objects.extent.minZ + objects.extent.maxZ) / 2, 0, 0.01), 'loose objects: the group is centred on its origin');

    // Content keys: contents are kept across revisions, structure is rebuilt.
    check(isContentKey('bench:0') && isContentKey('h2/furn:kitchen#0:1') && isContentKey('play:1') && !isContentKey('fence:back#0') && !isContentKey('h1/wall:wb0') && !isContentKey('walk:x#2'), 'contents (benches, furniture, play) vs structure (fences, walls, paths) are told apart');
  }

  // ------------------------------------------------------------------ 8
  section('8. Interiors: fittings, furniture by room, doors kept clear, room to walk');
  {
    let rooms = 0;
    let fitted = 0;
    let crowded = 0;
    const problems = [];
    const before = failures;
    for (let width = 8; width <= 40; width += 4) {
      for (let depth = 8; depth <= 40; depth += 4) {
        const p = plan({ kind: 'house', size: { width, depth }, rooms: [{ type: 'bedroom', count: 2 }, { type: 'living' }, { type: 'kitchen' }, { type: 'bathroom' }] });
        const layout = layoutPlan(p, registry);
        const doors = layout.objects.filter((s) => typeIs(s, 'door')).map((s) => {
          const b = boundsOf(s);
          const across = Math.abs(Math.sin(s.rotationY ?? 0)) > 0.5 ? 'x' : 'z';
          return across === 'z' ? { minX: b.minX, maxX: b.maxX, minZ: b.minZ - 0.95, maxZ: b.maxZ + 0.95 } : { minX: b.minX - 0.95, maxX: b.maxX + 0.95, minZ: b.minZ, maxZ: b.maxZ };
        });
        for (const room of layout.rooms) {
          rooms++;
          const r = room.rect;
          const inRoom = layout.objects.filter((s, i) => layout.keys[i].startsWith('furn:') && s.position.x > r.minX && s.position.x < r.maxX && s.position.z > r.minZ && s.position.z < r.maxZ);
          const boxes = inRoom.map((s) => boundsOf(s));
          if (boxes.some((b) => b.minX < r.minX + 0.1 - 1e-6 || b.maxX > r.maxX - 0.1 + 1e-6 || b.minZ < r.minZ + 0.1 - 1e-6 || b.maxZ > r.maxZ - 0.1 + 1e-6)) problems.push(`${width}x${depth} ${room.type}: furniture through a wall`);
          if (boxes.some((b) => doors.some((d) => b.minX < d.maxX && b.maxX > d.minX && b.minZ < d.maxZ && b.maxZ > d.minZ))) problems.push(`${width}x${depth} ${room.type}: furniture in a doorway`);
          const area = (r.maxX - r.minX) * (r.maxZ - r.minZ);
          const covered = boxes.reduce((sum, b) => sum + (b.maxX - b.minX) * (b.maxZ - b.minZ), 0);
          if (covered > area * 0.46) crowded++;
          const chairsOff = inRoom.filter((s) => !typeIs(s, 'chair'));
          for (let i = 0; i < chairsOff.length; i++) for (let j = i + 1; j < chairsOff.length; j++) if (gap(boundsOf(chairsOff[i]), boundsOf(chairsOff[j])) < 0.4 - 1e-6) problems.push(`${width}x${depth} ${room.type}: ${chairsOff[i].definitionId} and ${chairsOff[j].definitionId} less than 0.4 m apart`);
          if (room.type === 'bathroom') {
            const fittings = inRoom.filter((s) => ['bathtub', 'toilet', 'basin'].includes(registry.get(s.definitionId).type)).length;
            if (fittings >= 2) fitted++;
            else problems.push(`${width}x${depth} bathroom: only ${fittings} fittings`);
          }
          if (room.type === 'kitchen' && !inRoom.some((s) => typeIs(s, 'counter') || typeIs(s, 'table'))) problems.push(`${width}x${depth} kitchen: empty`);
          if (room.type === 'bedroom' && !inRoom.some((s) => typeIs(s, 'bed'))) problems.push(`${width}x${depth} bedroom: no bed`);
        }
      }
    }
    check(problems.length === 0, `furniture inside its room, out of doorways, 0.4 m apart, every room furnished for its purpose (${problems.slice(0, 4).join('; ')})`);
    check(crowded === 0, `no room has more than 45% of its floor covered (${crowded} too crowded)`);
    console.log(`  checked ${rooms} rooms in 81 house sizes, ${fitted} bathrooms with fittings${failures === before ? '' : ' (see failures)'}`);
    const big = layoutPlan(plan({ kind: 'house', size: { width: 30, depth: 20 }, rooms: [{ type: 'living' }, { type: 'kitchen' }, { type: 'bedroom', count: 2 }, { type: 'bathroom' }] }), registry);
    const counts = big.facts.counts;
    check(counts.bathtub === 1 && counts.toilet === 1 && counts.basin === 1, 'a roomy bathroom gets a bath, a toilet and a basin');
    check(counts.counter >= 1 && counts.wardrobe === 2 && counts.plant >= 2, 'kitchens get a worktop, bedrooms a wardrobe, big rooms plants');
  }

  // ------------------------------------------------------------------ 9
  section('9. Building creations in a busy world (real GameActions)');
  {
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
    const history = new HistoryService(store, actions);
    history.start();
    actions.finishBoot();
    actions.enterMyWorld('Tester');
    await Promise.resolve();
    const planStore = new LocalPlanStore('test.m2.plans');
    let builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth: 0 }), planStore);
    let notifications = 0;
    store.subscribe(() => notifications++);
    function confirm() {
      const placement = store.getState().templatePlacement;
      const template = templates.get(placement.templateId);
      actions.cancelTemplatePlacement();
      const revise = placement.revise;
      const result = actions.instantiateTemplate(template, placement.origin, placement.rotationY, placement.creationId, revise ? { replace: revise.replace, carry: { ids: revise.carry, from: revise.from } } : {});
      builder.onTemplateBuilt(placement.templateId, { origin: placement.origin, rotationY: placement.rotationY }, result);
      return { result, template, placement };
    }
    const groupOf = (id) => store.getState().placedObjects.filter((p) => p.group?.id === id);
    const groupBox = (id) => union(groupOf(id).map((p) => computeBounds(registry.get(p.definitionId), p.position, p.rotationY, p.scale)));

    // Things already in the world that nothing may touch.
    actions.instantiateTemplate(templates.get('park_small'), { x: 30, y: 0, z: 40 }, 0, 'park');
    builder.preview({ kind: 'house', version: 1, name: 'Home', size: { width: 16, depth: 12 }, site: { near: 'home' } });
    const house = confirm();
    const houseId = house.result.groupId;
    await Promise.resolve();

    const built = {};
    const cases = [
      ['garden', { kind: 'garden', site: { beside: 'back' }, benches: 2 }],
      ['benches', { kind: 'objects', site: { beside: 'front' }, items: [{ item: 'bench', count: 3 }] }],
      ['park', { kind: 'park', playground: true, site: { near: 'home' } }],
      ['treehouse', { kind: 'treehouse', site: { near: 'home' } }],
      ['neighbourhood', { kind: 'neighborhood', site: { near: 'home' } }],
    ];
    for (const [name, input] of cases) {
      const existing = store.getState().placedObjects;
      const snapshot = existing.map((p) => JSON.stringify(p));
      const preview = builder.preview({ version: 1, ...input });
      check(preview.ok, `${name}: a preview is found in the busy world (${preview.errors.join(' | ')})`);
      if (!preview.ok) continue;
      check(store.getState().placedObjects === existing, `${name}: previewing builds nothing`);
      actions.cancelTemplatePlacement();
      check(store.getState().placedObjects === existing && store.getState().templatePlacement === null, `${name}: cancelling the preview leaves the world exactly as it was`);
      builder.preview({ version: 1, ...input });
      notifications = 0;
      const t0 = performance.now();
      const { result, template, placement } = confirm();
      const ms = performance.now() - t0;
      check(result.skipped === 0 && result.placed === template.objects.length, `${name}: every piece is built (${result.placed}/${template.objects.length}, ${ms.toFixed(0)} ms)`);
      check(notifications <= 4, `${name}: subscribers hear about the creation once, not once per piece (${notifications} notifications for ${result.placed} pieces)`);
      const now = new Set(store.getState().placedObjects.map((p) => JSON.stringify(p)));
      check(snapshot.every((p) => now.has(p)), `${name}: everything already built is untouched`);
      const pieces = groupOf(result.groupId);
      const landed = template.objects.every((spec) => {
        const offset = rotateAroundY(spec.position.x, spec.position.z, placement.rotationY);
        return pieces.some((p) => p.definitionId === spec.definitionId && near(p.position.x, placement.origin.x + offset.x, 1e-3) && near(p.position.z, placement.origin.z + offset.z, 1e-3) && near(p.position.y, spec.position.y, 1e-3));
      });
      check(landed, `${name}: every piece lands exactly where the preview showed it`);
      check(pieces.every((p) => p.group.creation === KIND_CREATION[input.kind]), `${name}: pieces join the "${KIND_CREATION[input.kind]}" creation`);
      built[name] = result.groupId;
      await Promise.resolve();
    }

    // Context: the garden is right behind the house, the benches in front of it.
    const homeRecord = builder.records[houseId];
    const back = rotateAroundY(0, -1, homeRecord.rotationY);
    const garden = groupBox(built.garden);
    const home = groupBox(houseId);
    const toGarden = { x: (garden.minX + garden.maxX) / 2 - homeRecord.origin.x, z: (garden.minZ + garden.maxZ) / 2 - homeRecord.origin.z };
    check(back.x * toGarden.x + back.z * toGarden.z > 0 && gap(garden, home) < 3, `the garden is behind the house, close to it (${gap(garden, home).toFixed(1)} m away)`);
    const benches = groupBox(built.benches);
    const toBenches = { x: (benches.minX + benches.maxX) / 2 - homeRecord.origin.x, z: (benches.minZ + benches.maxZ) / 2 - homeRecord.origin.z };
    check(back.x * toBenches.x + back.z * toBenches.z < 0, 'the benches are in front of the house');
    check(builder.currentPlan()?.groupId === built.neighbourhood && builder.currentHouse()?.groupId === houseId, 'follow-ups target the newest creation; "the house" still means the house');

    // Undo removes the whole neighbourhood in one step; redo brings it back.
    const count = store.getState().placedObjects.length;
    const hoodSize = groupOf(built.neighbourhood).length;
    history.undo();
    await Promise.resolve();
    check(hoodSize > 100 && groupOf(built.neighbourhood).length === 0 && store.getState().placedObjects.length === count - hoodSize, `one undo removes the whole neighbourhood (${hoodSize} pieces)`);
    history.redo();
    await Promise.resolve();
    check(groupOf(built.neighbourhood).length > 0 && store.getState().placedObjects.length === count, 'redo brings the whole neighbourhood back');

    // A follow-up keeps the child's own edits: move a garden bench, remove a garden tree, then add benches.
    const bench = groupOf(built.garden).find((p) => p.definitionId === 'decor_bench');
    actions.selectPlacedObject(bench.id);
    const moved = actions.moveSelectedPlacedObject(bench.position.x + 0.5, bench.position.z);
    actions.selectPlacedObject(null);
    const tree = groupOf(built.garden).find((p) => registry.get(p.definitionId).type === 'tree');
    actions.removePlacedObject(tree.id);
    await Promise.resolve();
    const gardenPlan = builder.records[built.garden].plan;
    const revision = builder.previewRevision(built.garden, { ...planInputOf(gardenPlan), benches: gardenPlan.benches + 2 });
    check(moved?.valid && revision.ok && revision.summary.changes.includes('2 more benches') && revision.summary.keptEdits === 1, `"add two benches" previews a changed garden keeping the moved bench (${revision.summary?.changes})`);
    const revised = confirm();
    await Promise.resolve();
    const keptBench = store.getState().placedObjects.find((p) => p.id === bench.id);
    check(revised.result.skipped === 0 && keptBench?.group?.id === revised.result.groupId, 'the bench the child moved is kept in the new version');
    check(groupOf(revised.result.groupId).filter((p) => p.definitionId === 'decor_bench').length === gardenPlan.benches + 2, 'the garden now has two more benches (no duplicates)');
    check(groupOf(revised.result.groupId).filter((p) => registry.get(p.definitionId).type === 'tree').length === gardenPlan.trees - 1, 'the tree the child removed stays removed');

    // A piece generated at its own size (the treehouse's tall tree) is not mistaken for one the child resized.
    const treeRecord = builder.records[built.treehouse];
    const stairs = builder.previewRevision(built.treehouse, { ...planInputOf(treeRecord.plan), access: 'stairs' });
    check(stairs.ok && stairs.summary.changes.includes('stairs instead of a ladder') && stairs.summary.keptEdits === 0, `changing an untouched treehouse keeps no "edits" (${stairs.summary?.keptEdits})`);
    actions.cancelTemplatePlacement();
    const bigTree = groupOf(built.treehouse).find((p) => registry.get(p.definitionId).type === 'tree');
    store.setState({ placedObjects: store.getState().placedObjects.map((p) => (p.id === bigTree.id ? { ...p, scale: { x: 1, y: 2.5, z: 1 } } : p)) });
    const resized = builder.previewRevision(built.treehouse, { ...planInputOf(treeRecord.plan), access: 'stairs' });
    check(resized.ok && resized.summary.keptEdits === 1, 'a tree the child really resized is kept as their edit');
    actions.cancelTemplatePlacement();

    // Save and reload: the world and every kind of plan come back, and follow-ups keep working.
    const storage = new LocalMyWorldStorage('test.m2.world');
    const state = store.getState();
    storage.save({ player: state.player, placedObjects: state.placedObjects, identity: state.myWorld });
    const loaded = storage.load();
    check(loaded?.placedObjects.length === state.placedObjects.length && loaded.placedObjects.every((p, i) => p.id === state.placedObjects[i].id && p.definitionId === state.placedObjects[i].definitionId), 'every creation survives a save and load');
    builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth: 0 }), planStore);
    const kinds = Object.values(builder.records).map((r) => r.plan.kind).sort();
    check(['garden', 'house', 'neighborhood', 'objects', 'park', 'treehouse'].every((k) => kinds.includes(k)), `plans of every kind are reloaded (${kinds.join(', ')})`);
    check(builder.currentPlan()?.groupId === revised.result.groupId, 'after a reload, follow-ups target the newest creation (the changed garden)');
    const hood = builder.records[built.neighbourhood];
    const again = builder.previewRevision(built.neighbourhood, { ...planInputOf(hood.plan), houses: hood.plan.houses + 1 });
    check(again.ok && again.summary.changes.includes('one more house'), `a neighbourhood follow-up works after a reload ("${again.summary?.changes}")`);
    actions.cancelTemplatePlacement();
  }

  // ----------------------------------------------------------------- 10
  section('10. Ready-made templates build completely');
  for (const template of templateDefinitions) {
    const store = new GameStore(createInitialState());
    const actions = new GameActions(store, registry, new ChallengeRegistry(registry), { getBuildArea: () => ({ center: { x: 0, y: 0, z: 0 }, halfSize: 250 }) });
    actions.finishBoot();
    actions.enterMyWorld('Tester');
    const result = actions.instantiateTemplate(template, { x: 0, y: 0, z: 0 }, 0, 'house');
    check(result.skipped === 0, `${template.id}: all ${template.objects.length} pieces fit (${result.skipped} would be dropped)`);
  }

  // ----------------------------------------------------------------- 11
  section('11. Challenge Mode keeps its own catalogue');
  {
    const added = ['furniture_wardrobe', 'kitchen_counter', 'bath_tub', 'bath_toilet', 'bath_basin', 'decor_potted_plant', 'garden_flowerbed', 'path_stones', 'decor_bin', 'play_slide', 'play_swing', 'play_sandpit', 'post_wood', 'deck_wood', 'railing_wood', 'ladder_wood', 'stairs_wood'];
    check(added.every((id) => registry.get(id)?.gameplay.tags.includes('studio-only')), 'every new piece is My World only, so Challenge Mode catalogues are unchanged');
    const geometry = await load('/src/construction/shapes/index.ts');
    const bad = added.filter((id) => {
      const g = geometry.buildShapeGeometry(registry.get(id));
      g.computeBoundingBox();
      const d = registry.get(id).dimensions;
      const b = g.boundingBox;
      return b.min.x < -d.width / 2 - 1e-3 || b.max.x > d.width / 2 + 1e-3 || b.min.y < -1e-3 || b.max.y > d.height + 1e-3 || b.min.z < -d.depth / 2 - 1e-3 || b.max.z > d.depth / 2 + 1e-3;
    });
    check(bad.length === 0, `every new piece's geometry fits inside its gameplay box (${bad.join(', ')})`);
  }

  // ======================================================== Milestone 3
  /** A My World of its own, built through the real actions and the real plan builder. */
  function m3World(buildRules = null, planStore = null) {
    const worldSpace = new WorldSpace(worldDefinition);
    const store = new GameStore(createInitialState());
    const rules = buildRules ?? {
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
    world.newBuilder = () => (world.builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth: 0 }), planStore));
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
    world.groupOf = (id) => store.getState().placedObjects.filter((p) => p.group?.id === id);
    world.groupBox = (id) => union(world.groupOf(id).map((p) => computeBounds(registry.get(p.definitionId), p.position, p.rotationY, p.scale)));
    return world;
  }
  const lake = [...worldDefinition.water].sort((a, b) => b.radius - a.radius)[0];
  /** A house built `at` this spot stands with its back (-Z) to the big lake's shore. */
  const BY_THE_SHORE = { x: lake.x, z: lake.z + lake.radius * 1.12 + 8 };

  // ----------------------------------------------------------------- 12
  section('12. A taken place: other places are offered, and only used when the child picks one');
  {
    const { store, actions, builder, confirm, groupOf, groupBox } = m3World();
    const house = builder.preview({ version: 1, kind: 'house', size: { width: 12, depth: 10 }, site: { at: BY_THE_SHORE } });
    check(house.ok, `a house can stand by the shore (${house.errors.join(' | ')})`);
    const houseId = confirm().groupId;
    const record = builder.records[houseId];
    const back = rotateAroundY(0, -1, record.rotationY);
    const toLake = { x: lake.x - record.origin.x, z: lake.z - record.origin.z };
    check((back.x * toLake.x + back.z * toLake.z) / Math.hypot(toLake.x, toLake.z) > 0.95, 'the test house has its back to the lake');

    // "A garden behind my house": the lake is there.
    const GARDEN = { version: 1, kind: 'garden', size: { width: 14, depth: 10 } };
    const before = store.getState().placedObjects;
    const behind = builder.preview({ ...GARDEN, site: { beside: 'back' } });
    const labels = behind.offer?.alternatives.map((a) => a.label) ?? [];
    check(!behind.ok && behind.offer?.conflict === 'water', `the place behind the house is found to be taken by the lake (${behind.offer?.conflict})`);
    check(labels.length === 2 && labels.includes('Beside the house') && labels.includes('In front of the house'), `two free places are offered (${labels.join(', ')})`);
    check(/lake/.test(behind.errors[0]) && /Shall I put it beside your house or in front of your house instead\?$/.test(behind.errors[0]), `the reason is given in plain words and the child is asked ("${behind.errors[0]}")`);
    check(store.getState().placedObjects === before && store.getState().templatePlacement === null, 'nothing is built or shown anywhere the child did not choose');

    // Each offered place really fits, and choosing one only previews it.
    for (const alternative of behind.offer?.alternatives ?? []) {
      const chosen = builder.preview({ ...GARDEN, site: alternative.site });
      check(chosen.ok && store.getState().templatePlacement !== null && store.getState().placedObjects === before, `"${alternative.label}" previews the garden there and builds nothing yet`);
      actions.cancelTemplatePlacement();
    }
    builder.preview({ ...GARDEN, site: { beside: 'side' } });
    const garden = confirm();
    const box = groupBox(garden.groupId);
    const toGarden = { x: (box.minX + box.maxX) / 2 - record.origin.x, z: (box.minZ + box.maxZ) / 2 - record.origin.z };
    const side = rotateAroundY(1, 0, record.rotationY);
    check(garden.skipped === 0 && Math.abs(side.x * toGarden.x + side.z * toGarden.z) > Math.abs(back.x * toGarden.x + back.z * toGarden.z), 'only confirming builds it, beside the house as chosen');

    // Moving that garden behind the house: other places are offered, never the one it already stands on.
    const standing = store.getState().placedObjects;
    const move = builder.previewRevision(garden.groupId, { ...planInputOf(builder.records[garden.groupId].plan), site: { beside: 'back' } });
    const moveSites = move.offer?.alternatives.map((a) => JSON.stringify(a.site)) ?? [];
    check(!move.ok && moveSites.length >= 1 && !moveSites.includes('{"beside":"side"}'), `moving it to a taken place offers somewhere new (${moveSites.join(', ')})`);
    check(store.getState().placedObjects === standing && store.getState().templatePlacement === null && groupOf(garden.groupId).length > 0, 'the garden stays exactly where it is until the child picks');

    // Nowhere close by: said honestly, and nothing is offered.
    const tight = m3World({ getBuildArea: () => ({ center: { x: 0, y: 0, z: 0 }, halfSize: 16 }), getPlacementTargets: () => ({ targets: [], requiredSupport: null }), isBlocked: () => false });
    check(tight.builder.preview({ version: 1, kind: 'house', size: { width: 12, depth: 10 }, site: { at: { x: 0, z: 0 } } }).ok, 'a house fits in a small world');
    tight.confirm();
    const small = tight.store.getState().placedObjects;
    const park = tight.builder.preview({ version: 1, kind: 'park', size: { width: 24, depth: 20 }, site: { beside: 'back' } });
    check(!park.ok && !park.offer && /edge of the world/.test(park.errors[0]) && /anywhere close by either/.test(park.errors[0]), `with no free place nearby the child is told honestly ("${park.errors[0]}")`);
    check(tight.store.getState().placedObjects === small && tight.store.getState().templatePlacement === null, 'and nothing is built or shown');
  }

  // ----------------------------------------------------------------- 13
  section('13. Creation cards say what a creation really is');
  {
    const { creationCardText } = await load('/src/creative/plan/PlanLayouts.ts');
    const { KIND_NAMES } = await load('/src/creative/plan/ConstructionPlan.ts');
    const kinds = ['house', 'garden', 'park', 'neighborhood', 'treehouse', 'objects'];
    const wrong = [];
    for (const kind of kinds) {
      const card = creationCardText(kind, 12);
      const text = `${card.subtitle} ${card.improveTitle}`.toLowerCase();
      if (kind !== 'objects' && !card.subtitle.includes(KIND_NAMES[kind])) wrong.push(`${kind}: "${card.subtitle}"`);
      for (const other of kinds) {
        if (other === kind || other === 'objects' || other === 'house') continue;
        if (text.includes(KIND_NAMES[other])) wrong.push(`${kind} card mentions ${other}: "${text}"`);
      }
    }
    check(wrong.length === 0, `each card names its own kind and no other (${wrong.join(' | ')})`);
    check(creationCardText('treehouse', 23).subtitle === 'Part of your treehouse · 23 pieces', `the treehouse card says treehouse ("${creationCardText('treehouse', 23).subtitle}")`);

    // Treehouses, gardens and loose things join the "park" catalogue creation - the card must not follow that.
    const { builder, confirm } = m3World();
    const real = {};
    for (const kind of ['treehouse', 'garden', 'objects']) {
      const input = kind === 'objects' ? { kind, items: [{ item: 'bench', count: 2 }], site: { near: 'home' } } : { kind, site: { near: 'home' } };
      check(builder.preview({ version: 1, ...input }).ok, `${kind}: previewed for the card test`);
      const result = confirm();
      real[kind] = { creation: KIND_CREATION[kind], planned: builder.planOf(result.groupId)?.kind };
    }
    check(Object.entries(real).every(([kind, r]) => r.creation === 'park' && r.planned === kind), `the card reads the planned kind, not the catalogue creation (${JSON.stringify(real)})`);
    check(builder.planOf('no-such-group') === null, 'a creation that was not planned has no planned kind (its card falls back to the catalogue name)');
  }

  // ----------------------------------------------------------------- 14
  section('14. Faster placement gives exactly the same result as checking everything');
  {
    const fast = m3World();
    const full = m3World();
    // The old way: every piece checked against everything in the world.
    const placeDefinition = full.actions.placeDefinition;
    full.actions.placeDefinition = function (definition, position, options, quiet) {
      return placeDefinition.call(this, definition, position, options, quiet);
    };
    const shape = (store) => store.getState().placedObjects.map((p) => `${p.definitionId}@${p.position.x},${p.position.y},${p.position.z}/${p.rotationY.toFixed(6)}/${p.supportId ? 's' : ''}${p.hostId ? 'h' : ''}`);
    // Every ready-made template piled around one spot: walls with windows, stacked pieces, streets, at odd angles.
    let refused = 0;
    const mismatches = [];
    templateDefinitions.forEach((template, i) => {
      const origin = { x: 20 + (i % 4) * 5, y: 0, z: 30 + Math.floor(i / 4) * 5 };
      const turn = (i % 4) * (Math.PI / 2) + (i % 3) * 0.3;
      const a = fast.actions.instantiateTemplate(template, origin, turn, 'park');
      const b = full.actions.instantiateTemplate(template, origin, turn, 'park');
      refused += a.skipped;
      if (a.placed !== b.placed || a.skipped !== b.skipped) mismatches.push(`${template.id} ${a.placed}/${a.skipped} vs ${b.placed}/${b.skipped}`);
    });
    const a = shape(fast.store);
    const b = shape(full.store);
    check(mismatches.length === 0 && a.length === b.length && a.every((s, i) => s === b[i]), `every piece is accepted or refused exactly as a full check would decide (${mismatches.join(' | ')})`);
    check(refused > 0 && a.length > 100, `the test really piles creations onto each other (${refused} pieces refused, ${a.length} built)`);
  }

  // ----------------------------------------------------------------- 15
  section('15. Changing one house of a neighbourhood leaves everything else exactly as it is');
  {
    const planStore = new LocalPlanStore('test.m3.plans');
    const world = m3World(null, planStore);
    const { store, actions, groupOf } = world;
    const history = new HistoryService(store, actions);
    history.start();
    await Promise.resolve();
    // The neighbourhood, and something built after it (so it is not the newest creation).
    check(world.builder.preview({ version: 1, kind: 'neighborhood', houses: 4, site: { near: 'home' } }).ok, 'a neighbourhood of four houses is previewed');
    const hood = world.confirm();
    await Promise.resolve();
    check(hood.skipped === 0, `the neighbourhood is built whole (${hood.placed} pieces)`);
    world.builder.preview({ version: 1, kind: 'garden', site: { near: 'home' } });
    const garden = world.confirm();
    await Promise.resolve();
    check(garden.skipped === 0 && world.builder.currentPlan()?.groupId === garden.groupId, 'a garden is built after it and is the newest creation');
    const keyOf = (p) => world.builder.records[p.group?.id]?.pieces[p.id]?.key ?? '';
    const sig = (p) => JSON.stringify([p.id, p.definitionId, p.position, p.rotationY, p.scale, p.supportId, p.hostId]);
    const sigs = (list) => list.map((p) => `${sig(p)}${p.group?.id ?? ''}`).sort().join('\n');

    // Picking house 2: by tapping one of its pieces, by tapping the street (the whole street), from the list.
    const door = world.builder.housePiece(hood.groupId, 1);
    check(door !== null && world.builder.houseOf(door)?.index === 1 && keyOf(store.getState().placedObjects.find((p) => p.id === door)).startsWith('h1/opening:wf'), 'house 2 is shown by its front door');
    actions.selectPlacedObject(door);
    world.builder.noteSelection(door); // Game tells the builder about every selection change
    check(world.builder.houseFocus()?.index === 1 && world.builder.houseFocus()?.groupId === hood.groupId, 'tapping a piece of house 2 picks house 2');
    const road = groupOf(hood.groupId).find((p) => keyOf(p).startsWith('road:'));
    actions.selectPlacedObject(road.id);
    world.builder.noteSelection(road.id);
    check(world.builder.houseFocus() === null, 'tapping the street picks the whole neighbourhood');
    world.builder.setHouseFocus(hood.groupId, 1);
    actions.selectPlacedObject(null);
    world.builder.noteSelection(null);
    check(world.builder.houseFocus()?.index === 1, 'house 2 picked from the list stays picked when nothing is selected');

    // "Make house 2 four metres deeper, with a flat roof and a balcony."
    const before = store.getState().placedObjects;
    const house2 = (list, groupId) => list.filter((p) => p.group?.id === groupId && keyOf(p).startsWith('h1/'));
    const oldHouse2 = house2(before, hood.groupId);
    const others = before.filter((p) => !oldHouse2.includes(p));
    const base = world.builder.houseFocus().plan;
    const change = world.builder.previewHouseRevision(hood.groupId, 1, { size: { width: base.size.width, depth: base.size.depth + 4 }, roof: 'flat', balcony: true });
    check(change.ok && change.summary.house === 1 && change.summary.understood[0] === 'House 2', `house 2 alone is previewed (${change.errors.join(' | ')})`);
    check(change.ok && change.summary.changes.includes('4 m deeper') && change.summary.changes.some((c) => /flat roof/.test(c)) && change.summary.changes.some((c) => /balcony/.test(c)), `the preview says what changes (${change.summary?.changes})`);
    check(store.getState().placedObjects === before && change.summary?.pieces < hood.placed / 2, `previewing builds nothing, and only house 2's pieces are in the preview (${change.summary?.pieces} of ${hood.placed})`);
    check(world.builder.houseFocus()?.index === 1, 'house 2 stays picked while its change is on show');
    actions.cancelTemplatePlacement();
    check(store.getState().placedObjects === before && world.builder.houseFocus()?.groupId === hood.groupId && world.builder.houseFocus()?.index === 1, 'cancelling the change keeps house 2 picked (not the newer garden)');
    world.builder.previewHouseRevision(hood.groupId, 1, { size: { width: base.size.width, depth: base.size.depth + 4 }, roof: 'flat', balcony: true });
    const built = world.confirm();
    await Promise.resolve();
    const after = store.getState().placedObjects;
    const now = new Map(after.map((p) => [p.id, p]));
    const moved = others.filter((p) => !now.has(p.id) || sig(now.get(p.id)) !== sig(p));
    check(built.skipped === 0 && moved.length === 0, `every other house, the street, the park and the garden keep the same pieces in the same places (${moved.length} of ${others.length} changed)`);
    check(oldHouse2.every((p) => !now.has(p.id)) && house2(after, built.groupId).length > 0, 'house 2 is rebuilt');
    const fresh = after.filter((p) => !before.some((b) => b.id === p.id));
    check(fresh.length === built.placed && fresh.every((p) => keyOf(p).startsWith('h1/')), `every new piece belongs to house 2 (${fresh.length} new pieces)`);
    check(groupOf(hood.groupId).length === 0 && after.length === before.length - oldHouse2.length + built.placed && others.filter((p) => p.group?.id === hood.groupId).every((p) => now.get(p.id).group.id === built.groupId), 'it is still one neighbourhood with no duplicates: the kept pieces join the new version');
    const record = world.builder.records[built.groupId];
    check(JSON.stringify(record.plan.customHouses) === JSON.stringify([{ house: 1, size: { width: base.size.width, depth: base.size.depth + 4 }, roof: 'flat', balcony: true }]), `the plan remembers what changed on house 2 alone (${JSON.stringify(record.plan.customHouses)})`);
    const depthOf = (list) => {
      const box = union(list.filter((p) => keyOf(p).includes('/wall:')).map((p) => computeBounds(registry.get(p.definitionId), p.position, p.rotationY, p.scale)));
      return Math.round(Math.abs(Math.cos(record.rotationY)) > 0.5 ? box.maxZ - box.minZ : box.maxX - box.minX);
    };
    check(depthOf(house2(after, built.groupId)) - depthOf(oldHouse2) === 4, `house 2's walls really are 4 m deeper (${depthOf(oldHouse2)} -> ${depthOf(house2(after, built.groupId))} m)`);
    check(world.builder.houseFocus()?.groupId === built.groupId && world.builder.houseFocus()?.index === 1, 'house 2 stays picked once its change is built');

    // One undo brings back exactly what was there; redo brings the change back exactly.
    history.undo();
    await Promise.resolve();
    check(sigs(store.getState().placedObjects) === sigs(before), 'one undo restores every piece exactly as it was');
    check(world.builder.houseFocus()?.index === 1, 'house 2 is still picked after undo');
    history.redo();
    await Promise.resolve();
    check(sigs(store.getState().placedObjects) === sigs(after), 'redo brings the changed house back exactly');
    check(world.builder.houseFocus()?.groupId === built.groupId && world.builder.houseFocus()?.index === 1, 'and house 2 is still picked after redo');

    // Save and reload: the world, the changed house and the picked house all come back.
    const storage = new LocalMyWorldStorage('test.m3.world');
    const state = store.getState();
    storage.save({ player: state.player, placedObjects: state.placedObjects, identity: state.myWorld });
    const loaded = storage.load();
    check(loaded && sigs(loaded.placedObjects) === sigs(after), 'every piece survives a save and load exactly');
    world.newBuilder();
    const reloaded = world.builder.records[built.groupId];
    check(JSON.stringify(reloaded?.plan.customHouses) === JSON.stringify(record.plan.customHouses) && reloaded.focusHouse === 1 && world.builder.houseFocus()?.index === 1, 'after a reload the changed house and the picked house are remembered');

    // Wider than its plot: refused honestly, nothing changes.
    const current = world.builder.houseFocus().plan;
    const wide = world.builder.previewHouseRevision(built.groupId, 1, { size: { width: current.size.width + 4, depth: current.size.depth } });
    check(!wide.ok && /can't get any wider/.test(wide.errors[0]) && store.getState().templatePlacement === null && store.getState().placedObjects === after, `a house wider than its plot is refused honestly ("${wide.errors[0]}")`);
    const same = world.builder.previewHouseRevision(built.groupId, 1, { roof: 'flat' });
    check(!same.ok && /already looks like that/.test(same.errors[0]), 'asking for what is already there changes nothing');
    const narrow = world.builder.previewHouseRevision(built.groupId, 1, { size: { width: current.size.width - 2, depth: current.size.depth } });
    check(narrow.ok && narrow.summary.changes.includes('2 m narrower'), `a narrower house fits its plot (${narrow.summary?.changes})`);
    actions.cancelTemplatePlacement();

    // Then house 3: house 2's change is kept, and house 2 is not touched.
    const withHouse2 = store.getState().placedObjects;
    const house3 = world.builder.previewHouseRevision(built.groupId, 2, { rooms: [{ type: 'living' }, { type: 'kitchen' }, { type: 'bedroom', count: 2 }, { type: 'bathroom' }] });
    check(house3.ok && house3.summary.house === 2 && house3.summary.changes.some((c) => /bedroom/.test(c)), `house 3 gets another bedroom and a bathroom (${house3.errors.join(' | ')} ${house3.summary?.changes})`);
    const third = world.confirm();
    await Promise.resolve();
    const afterThird = new Map(store.getState().placedObjects.map((p) => [p.id, p]));
    const stillHouse2 = house2(withHouse2, built.groupId);
    check(third.skipped === 0 && stillHouse2.every((p) => afterThird.has(p.id) && sig(afterThird.get(p.id)) === sig(p)), 'changing house 3 leaves house 2 exactly as it was');
    check(world.builder.records[third.groupId].plan.customHouses.map((c) => c.house).join() === '1,2' && world.builder.houseFocus()?.index === 2, 'both changes are remembered, and house 3 is now the picked house');
    // Undo after a reload: the version from before the reload comes back with its plan and its picked house.
    history.undo();
    await Promise.resolve();
    check(world.builder.records[built.groupId] !== undefined && world.builder.currentPlan()?.groupId === built.groupId && world.builder.houseFocus()?.index === 1, 'undoing a change made after a reload brings back the earlier version with its plan and picked house');
    history.redo();
    await Promise.resolve();
    check(world.builder.currentPlan()?.groupId === third.groupId && world.builder.houseFocus()?.index === 2, 'redo brings the house 3 change back');

    // A change to the whole street keeps the houses changed on their own (unless it sets that thing for every house).
    const hoodPlan = world.builder.records[third.groupId].plan;
    const { customHouses: _custom, ...wholeStreet } = planInputOf(hoodPlan);
    const roofs = world.builder.previewRevision(third.groupId, { ...wholeStreet, roof: 'none' });
    check(roofs.ok, `"take the roofs off every house" previews (${roofs.errors.join(' | ')})`);
    const roofless = world.confirm();
    const edits = world.builder.records[roofless.groupId].plan.customHouses;
    check(edits.length === 2 && edits.every((e) => e.roof === undefined) && edits[0].balcony === true && edits[0].size?.depth === base.size.depth + 4 && edits[1].rooms?.length === 5, `the whole-street change reaches every roof but keeps house 2's size and balcony and house 3's rooms (${JSON.stringify(edits)})`);
    const more = world.builder.previewRevision(roofless.groupId, { ...wholeStreet, roof: 'none', houses: hoodPlan.houses + 1 });
    check(more.ok && more.summary.changes.includes('one more house'), `adding a house to the street works (${more.summary?.changes})`);
    const fiveHouses = world.confirm();
    check(world.builder.records[fiveHouses.groupId].plan.customHouses.length === 2 && world.builder.records[fiveHouses.groupId].plan.houses === hoodPlan.houses + 1, 'and keeps both changed houses');
  }

  section('16. "Delete everything on this device": every key goes, nothing is written back, a reload starts empty');
  {
    const { LocalProgressStorage } = await load('/src/progression/ProgressStorage.ts');
    const { ProgressionService } = await load('/src/progression/ProgressionService.ts');
    const { MyWorldPersistenceService } = await load('/src/creative/MyWorldPersistenceService.ts');
    const { BuildAssistant } = await load('/src/creative/ai/BuildAssistant.ts');
    const { DEFAULT_WORLD_NAME } = await load('/src/state/GameState.ts');
    const { eraseDeviceData, storedKeys, DEVICE_STORAGE_KEYS } = await load('/src/state/DeviceData.ts');

    /** Start the game's state and services the way Game.ts does: from what is stored on the device. */
    function boot() {
      const progressStorage = new LocalProgressStorage();
      const worldStorage = new LocalMyWorldStorage();
      const planStore = new LocalPlanStore();
      const saved = worldStorage.load();
      const store = new GameStore(createInitialState(progressStorage.load() ?? undefined, saved?.player ?? null, saved?.identity));
      const worldSpace = new WorldSpace(worldDefinition);
      const rules = {
        getBuildArea: () => ({ center: { x: 0, y: 0, z: 0 }, halfSize: worldSpace.buildHalfSize }),
        getPlacementTargets: () => ({ targets: [], requiredSupport: null }),
        isBlocked: (bounds) => worldSpace.isBlocked(bounds),
      };
      const actions = new GameActions(store, registry, new ChallengeRegistry(registry), rules);
      const templates = new TemplateRegistry();
      templates.registerAll(templateDefinitions);
      const persistence = new MyWorldPersistenceService(store, actions, worldStorage, registry);
      const history = new HistoryService(store, actions);
      const builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth: 0 }), planStore);
      const assistant = new BuildAssistant(builder, async () => {
        throw new Error('offline');
      });
      new ProgressionService(store, actions, progressStorage).start();
      persistence.start();
      history.start();
      actions.finishBoot();
      const confirm = () => {
        const placement = store.getState().templatePlacement;
        actions.cancelTemplatePlacement();
        const result = actions.instantiateTemplate(templates.get(placement.templateId), placement.origin, placement.rotationY, placement.creationId);
        builder.onTemplateBuilt(placement.templateId, { origin: placement.origin, rotationY: placement.rotationY }, result);
        return result;
      };
      const erase = () => eraseDeviceData({ actions, history, planBuilder: builder, assistant, persistence, storages: [worldStorage, progressStorage, planStore] });
      return { store, actions, templates, builder, history, assistant, confirm, erase };
    }
    const flush = async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    };
    const ours = () => storedKeys().sort();
    for (const key of DEVICE_STORAGE_KEYS) memory.delete(key);

    // A child plays: a named builder and world, a planned creation with a child-chosen name, stars, and an older key of ours.
    let game = boot();
    game.actions.enterMyWorld('Robin');
    await flush();
    game.actions.setWorldName('Robin Town');
    check(game.builder.preview({ ...EXAMPLE, name: "Robin's Den", size: { width: 12, depth: 10 }, site: { near: 'home' } }).ok, 'a creation named by the child is previewed');
    const built = game.confirm();
    await flush();
    const firstPlayer = game.store.getState().player.id;
    game.store.setState({ progress: { ...game.store.getState().progress, completedChallengeIds: ['level-1'], bestStars: { 'level-1': 3 } } });
    memory.set('city-builder.old-format', 'left by an earlier version');
    check(JSON.stringify(ours()) === JSON.stringify(['city-builder.old-format', 'city-builder.plans', 'city-builder.progress', 'city-builder.world']), `before: the world, progress, plans and an older key are stored (${ours().join(', ')})`);
    check(memory.get('city-builder.world').includes('Robin') && memory.get('city-builder.plans').includes("Robin's Den"), 'before: the names are in the stored copies');
    check(game.history.canUndo && Object.keys(game.builder.records).length === 1, 'before: there is history to undo and a plan record in memory');

    // Delete while still in My World, with an autosave already queued (the hardest case).
    const bed = game.store.getState().placedObjects.find((p) => p.group?.id === built.groupId && registry.get(p.definitionId).type === 'bed');
    game.actions.selectPlacedObject(bed.id);
    game.actions.moveSelectedPlacedObject(bed.position.x + 0.3, bed.position.z);
    const result = game.erase();
    check(result.remaining.length === 0, `erasing reports nothing left (${result.remaining.join(', ')})`);
    check(ours().length === 0, `every EAVARA key is gone right away (${ours().join(', ')})`);
    await flush();
    check(ours().length === 0, `...and stays gone once the queued autosave has run (${ours().join(', ')})`);
    const state = game.store.getState();
    check(state.mode === 'menu' && state.player === null && state.placedObjects.length === 0 && state.myWorld.name === DEFAULT_WORLD_NAME && state.myWorld.story === null, 'the game is back on the home screen with no builder, world or name');
    check(state.progress.completedChallengeIds.length === 0 && Object.keys(state.progress.bestStars).length === 0 && state.templatePlacement === null && state.selectedInstanceId === null, 'no progress, preview or selection is left in memory');
    check(Object.keys(game.builder.records).length === 0 && game.builder.currentPlan() === null && !game.templates.list().some((t) => t.id.startsWith('plan-')), 'plan records and the templates made from them are forgotten');
    check(!game.history.canUndo && !game.history.canRedo, 'nothing can be undone back into existence');
    game.history.undo();
    await flush();
    check(game.store.getState().placedObjects.length === 0 && ours().length === 0, 'undo after deleting brings nothing back and writes nothing');
    check(game.assistant.target === null, 'the AI helper has nothing to change');

    // "Reload": a fresh start from storage is empty, and a new builder gets a new identity.
    game = boot();
    const fresh = game.store.getState();
    check(fresh.player === null && fresh.progress.completedChallengeIds.length === 0 && fresh.myWorld.name === DEFAULT_WORLD_NAME, 'after a reload: no builder, no progress, the default world name');
    check(Object.keys(game.builder.records).length === 0, 'after a reload: no plan records');
    game.actions.enterMyWorld('');
    await flush();
    check(game.store.getState().player.id !== firstPlayer && game.store.getState().placedObjects.length === 0, 'after a reload: My World starts empty with a new builder id');

    // "Reset level progress" (asked about first in the UI) still clears only Challenge progress.
    check(game.builder.preview({ ...EXAMPLE, name: 'Keep Me', size: { width: 12, depth: 10 }, site: { near: 'home' } }).ok, 'a new creation after deleting works');
    game.confirm();
    game.store.setState({ progress: { ...game.store.getState().progress, completedChallengeIds: ['level-1'], bestStars: { 'level-1': 2 } } });
    await flush();
    game.actions.resetProgress();
    await flush();
    const progress = new LocalProgressStorage().load();
    check(progress?.completedChallengeIds.length === 0 && new LocalMyWorldStorage().load()?.placedObjects.length > 0, 'resetting level progress clears the stars and keeps the world');
    for (const key of DEVICE_STORAGE_KEYS) memory.delete(key);
  }
} finally {
  await server.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
