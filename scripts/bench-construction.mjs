/**
 * Construction benchmark for big My World saves:   npm run bench:construction
 *
 * Builds the SAME busy world every run (planned houses, gardens and parks at
 * fixed spots, through the real PlanBuilder and GameActions, with the undo
 * history and autosave listening like in the app), then times the expensive
 * steps a child triggers in it: previewing a neighbourhood, confirming it,
 * undoing it and saving. The renderer is not included (Node has no WebGL);
 * see the browser measurements in the milestone report for that part.
 *
 * Usage: node scripts/bench-construction.mjs [repeats]
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repeats = Number(process.argv[2] ?? 3);
const memory = new Map();
globalThis.window = Object.assign(new EventTarget(), {
  localStorage: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
});

const server = await createServer({ root, configFile: `${root}vite.config.ts`, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const { objectDefinitions, worldDefinition, templateDefinitions } = await load('/src/data/index.ts');
  const { ObjectRegistry } = await load('/src/construction/ObjectRegistry.ts');
  const { TemplateRegistry } = await load('/src/creative/Template.ts');
  const { PlanBuilder } = await load('/src/creative/plan/PlanBuilder.ts');
  const { GameStore } = await load('/src/state/GameStore.ts');
  const { createInitialState } = await load('/src/state/initialState.ts');
  const { GameActions } = await load('/src/state/actions.ts');
  const { ChallengeRegistry } = await load('/src/challenges/ChallengeRegistry.ts');
  const { WorldSpace } = await load('/src/world/WorldSpace.ts');
  const { HistoryService } = await load('/src/creative/HistoryService.ts');
  const { LocalMyWorldStorage } = await load('/src/state/MyWorldStorage.ts');
  const { MyWorldPersistenceService } = await load('/src/creative/MyWorldPersistenceService.ts');

  const registry = new ObjectRegistry();
  registry.registerAll(objectDefinitions);
  const ms = (t0) => performance.now() - t0;
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

  /** A fresh, identical busy world: ~2,400 objects from planned creations at fixed spots. */
  function busyWorld() {
    memory.clear();
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
    new MyWorldPersistenceService(store, actions, new LocalMyWorldStorage('bench.world'), registry).start();
    actions.finishBoot();
    actions.enterMyWorld('Bench');
    const builder = new PlanBuilder(store, actions, registry, templates, rules, worldSpace, () => ({ x: 0, z: 0, azimuth: 0 }), null);
    const confirm = () => {
      const placement = store.getState().templatePlacement;
      const template = templates.get(placement.templateId);
      actions.cancelTemplatePlacement();
      const result = actions.instantiateTemplate(template, placement.origin, placement.rotationY, placement.creationId);
      builder.onTemplateBuilt(placement.templateId, { origin: placement.origin, rotationY: placement.rotationY }, result);
      return result;
    };
    const spots = [];
    // A ring of creations round a clearing in the middle, where the neighbourhood goes.
    for (let x = -180; x <= 180; x += 60) for (let z = -180; z <= 180; z += 60) if (Math.abs(x) > 60 || Math.abs(z) > 60) spots.push({ x, z });
    const kinds = [
      { kind: 'house', size: { width: 20, depth: 14 }, rooms: [{ type: 'bedroom', count: 3 }, { type: 'living' }, { type: 'kitchen' }, { type: 'bathroom' }] },
      { kind: 'park', playground: true },
      { kind: 'house', size: { width: 16, depth: 12 } },
      { kind: 'garden', size: { width: 14, depth: 10 } },
    ];
    let built = 0;
    for (const [i, at] of spots.entries()) {
      const preview = builder.preview({ version: 1, ...kinds[i % kinds.length], site: { at } });
      if (preview.ok) {
        confirm();
        built++;
      }
    }
    return { store, actions, builder, history, templates, confirm, built };
  }

  const results = { preview: [], confirm: [], undo: [], redo: [], save: [] };
  let objects = 0;
  let pieces = 0;
  let creations = 0;
  for (let run = 0; run < repeats; run++) {
    const world = busyWorld();
    objects = world.store.getState().placedObjects.length;
    creations = world.built;
    await Promise.resolve();
    let t0 = performance.now();
    const preview = world.builder.preview({ version: 1, kind: 'neighborhood', site: { at: { x: 0, z: 0 } } });
    results.preview.push(ms(t0));
    if (!preview.ok) throw new Error(`no room for the benchmark neighbourhood: ${preview.errors.join(' ')}`);
    t0 = performance.now();
    const result = world.confirm();
    results.confirm.push(ms(t0));
    pieces = result.placed;
    await Promise.resolve();
    t0 = performance.now();
    world.history.undo();
    results.undo.push(ms(t0));
    t0 = performance.now();
    world.history.redo();
    results.redo.push(ms(t0));
    await Promise.resolve();
    const storage = new LocalMyWorldStorage('bench.save');
    const state = world.store.getState();
    t0 = performance.now();
    storage.save({ player: state.player, placedObjects: state.placedObjects, identity: state.myWorld });
    results.save.push(ms(t0));
  }
  console.log(`busy world: ${creations} planned creations, ${objects} objects; neighbourhood of ${pieces} pieces; median of ${repeats} runs`);
  for (const [step, values] of Object.entries(results)) console.log(`  ${step.padEnd(8)} ${median(values).toFixed(1).padStart(8)} ms   (runs: ${values.map((v) => v.toFixed(0)).join(', ')})`);
} finally {
  await server.close();
}
