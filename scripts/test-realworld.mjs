/**
 * Acceptance tests for the Real World Explorer (src/realworld): catalogue and
 * Burj Khalifa, Eiffel Tower and Golden Gate Bridge content integrity (sources, timeline, stops, lessons,
 * missions), lesson physics, and the procedural Burj Khalifa model built
 * headlessly (no DOM, no WebGL).
 *
 * Runs the game's own TypeScript modules through Vite's SSR loader, so no
 * extra test dependencies are needed:   node scripts/test-realworld.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

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
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const doesNotThrow = (fn) => {
  try {
    fn();
    return true;
  } catch (error) {
    console.error(`    threw: ${error?.stack ?? error}`);
    return false;
  }
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
  const realworld = await load('/src/realworld/index.ts');
  const { LANDMARKS, landmarkById, validateLandmark, timelineProgress, monthIndex, buildLandmarkModel } = realworld;
  const { SCENE_SCALE, CONSTRUCTION_PROGRESS, progressForBuiltHeight, builtHeightForProgress } = realworld;
  const physics = await load('/src/realworld/physics.ts');
  const { buildBurjKhalifa, BURJ_MODEL_PART_IDS } = await load('/src/realworld/models/BurjKhalifaModel.ts');

  section('Catalogue');
  {
    const ids = LANDMARKS.map((l) => l.id);
    check(new Set(ids).size === ids.length, `landmark ids are unique (${ids.join(', ')})`);
    check(landmarkById('burj-khalifa')?.status === 'available', 'burj-khalifa is available');
    check(landmarkById('eiffel-tower')?.status === 'available' && landmarkById('golden-gate-bridge')?.status === 'available', 'the Eiffel Tower and the Golden Gate Bridge are available');
    check(landmarkById('nowhere') === undefined, 'an unknown id gives undefined');
    const placeholders = ['dam-and-reservoir', 'wind-turbine', 'hydroelectric-power-station', 'rocket-launch-vehicle', 'skyscraper-under-construction', 'stadium', 'solar-power-plant', 'railway-station'];
    check(placeholders.every((id) => landmarkById(id)?.status === 'coming-soon'), 'all eight future placeholders are listed as coming soon');
    for (const landmark of LANDMARKS) {
      const hasContent = landmark.facts.length + landmark.sources.length + landmark.parts.length + landmark.timeline.length + landmark.lessons.length + landmark.missions.length + landmark.stops.length + landmark.hotspots.length + landmark.quiz.length + landmark.stages.length > 0;
      if (landmark.status === 'available') check(landmark.facts.length > 0 && landmark.model !== null, `${landmark.id}: available entries have facts and a model`);
      else check(!hasContent && landmark.model === null, `${landmark.id}: coming-soon entries have no facts, model or content`);
      check(Boolean(landmark.name && landmark.place && landmark.tagline) && landmark.subjects.length > 0, `${landmark.id}: has a name, place, tagline and subjects`);
      const problems = validateLandmark(landmark);
      check(problems.length === 0, `${landmark.id}: validateLandmark finds nothing (${problems.join('; ')})`);
      if (landmark.status === 'coming-soon') check(buildLandmarkModel(landmark) === null, `${landmark.id}: no model is built`);
    }
  }

  const burj = landmarkById('burj-khalifa');
  const sourceIds = new Set(burj.sources.map((s) => s.id));
  const partIds = new Set(burj.parts.map((p) => p.id));
  const quizIds = new Set(burj.quiz.map((q) => q.id));
  const lessonIds = new Set(burj.lessons.map((l) => l.id));

  section('Burj Khalifa sources and citations');
  {
    check(burj.sources.every((s) => /^https:\/\//.test(s.url) && s.title && s.publisher), 'every source has an https url, a title and a publisher');
    check(sourceIds.size === burj.sources.length, 'source ids are unique');
    const citing = [
      ...burj.facts.map((x) => ['fact', x]),
      ...burj.hotspots.map((x) => ['hotspot', x]),
      ...burj.timeline.map((x) => ['timeline', x]),
      ...burj.parts.map((x) => ['part', x]),
      ...burj.lessons.map((x) => ['lesson', x]),
    ];
    for (const [kind, item] of citing) check(item.sourceIds.length > 0 && item.sourceIds.every((id) => sourceIds.has(id)), `${kind} '${item.id}' cites existing sources (${item.sourceIds.join(', ')})`);
    const nasa = new Set(['nasa-gas-pressure', 'nasa-dynamic-pressure']);
    check(burj.facts.every((f) => f.sourceIds.every((id) => !nasa.has(id))), 'general physics sources are never cited for tower facts');
    check(burj.facts.every((f) => f.confidence === 'high' || f.confidence === 'medium'), 'every fact has a confidence level');
    const fact = (id) => burj.facts.find((f) => f.id === id);
    check(fact('height')?.value.includes('828 m') && fact('height')?.value.includes('829.8 m'), 'height fact: 828 m architectural, 829.8 m tip');
    check(fact('occupied-height')?.value.includes('585.4'), 'highest occupied floor 585.4 m');
    check(fact('floors')?.value.includes('160-163') && /SOM/.test(fact('floors')?.note ?? ''), 'floor count keeps the "depending on how floors are counted" caveat');
    for (const id of ['setbacks', 'pile-size', 'pile-count', 'groundwater', 'design-rotated', 'workers', 'lifts']) check(fact(id)?.confidence === 'medium', `'${id}' is marked medium confidence`);
    for (const id of ['setbacks', 'pile-size', 'pile-count', 'lifts']) check(Boolean(fact(id)?.note), `'${id}' explains how sources differ`);
    check(burj.disclaimer === 'This is a simplified 3D learning model built for EAVARA. Its shape and proportions are approximate, and the inside views are educational cutaways, not the real interiors.', 'disclaimer text is exact');
  }

  section('Timeline and stages');
  {
    const validStages = new Set(['site', 'foundation', 'structure', 'exterior', 'complete']);
    const months = burj.timeline.map((t) => monthIndex(t.sortKey));
    check(months.every((m) => Number.isFinite(m)), 'every sortKey is YYYY-MM');
    check(months.every((m, i) => i === 0 || m >= months[i - 1]), `timeline is chronological (${burj.timeline.map((t) => t.sortKey).join(' ')})`);
    check(burj.timeline.every((t) => validStages.has(t.stage)), 'timeline stage ids are valid');
    check(burj.stages.map((s) => s.id).join() === 'site,foundation,structure,exterior,complete', 'the five stages are listed in order');
    check(burj.stages.every((s, i) => s.progress >= 0 && s.progress <= 1 && (i === 0 || s.progress >= burj.stages[i - 1].progress)), 'stage progress rises from 0 to 1');
    check(burj.stages[0].progress === 0 && burj.stages.at(-1).progress === 1 && near(burj.stages[1].progress, 0.05) && near(burj.stages[3].progress, 0.95), 'site 0, foundation 0.05, exterior 0.95, complete 1');
    const entry = (id) => burj.timeline.find((t) => t.id === id);
    check(entry('passes-taipei-101')?.builtHeightM === 512.1 && entry('tallest-structure')?.builtHeightM === 629 && entry('passes-cn-tower')?.builtHeightM === 555, 'documented heights 512.1 m, 555 m and 629 m');
    check(entry('level-100')?.builtHeightM === null && entry('level-100')?.dateLabel === 'Early 2007' && entry('level-100')?.confidence === 'medium', 'level 100: no invented height, "Early 2007", medium');
    check(entry('exterior-complete')?.dateLabel === 'Autumn 2009' && Boolean(entry('exterior-complete')?.note), 'exterior: "Autumn 2009" with a note on the differing dates');
    check(burj.timeline.every((t) => t.builtHeightM === null || (t.builtHeightM > 0 && t.builtHeightM <= 828)), 'built heights are null or within the tower height');
    const progress = burj.timeline.map((t) => timelineProgress(burj, t));
    console.log(`  timeline progress: ${progress.map((p) => p.toFixed(3)).join(' ')}`);
    check(progress.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= progress[i - 1] - 1e-9)), `timeline progress never goes backwards (${progress.map((p) => p.toFixed(2)).join(' ')})`);
    check(near(timelineProgress(burj, entry('passes-taipei-101')), progressForBuiltHeight(512.1, 828)), 'a documented height maps straight onto the model progress');
    check(near(timelineProgress(burj, entry('topped-out')), CONSTRUCTION_PROGRESS.structureDone) && timelineProgress(burj, entry('opening')) === 1, 'topping out = structure done, opening = 1');
    check(near(builtHeightForProgress(progressForBuiltHeight(629, 828), 828), 629), 'progress <-> built height round-trips');
  }

  section('Stops, parts, hotspots');
  {
    const heights = burj.stops.map((s) => s.heightM);
    check(heights.every((h, i) => i === 0 || h >= heights[i - 1]), `stops are sorted by height (${heights.join(', ')})`);
    check(heights.every((h) => h >= -60 && h <= 829.8), 'stops lie within [-60, 829.8] m');
    check(burj.stops.length === 7 && burj.stops[0].kind === 'foundation' && burj.stops.at(-1).kind === 'top', 'seven stops from the foundation to the top');
    check(burj.stops.find((s) => s.id === 'highest-occupied')?.heightM === 585.4, 'highest occupied floor stop at 585.4 m');
    for (const stop of burj.stops.filter((s) => s.kind === 'floors' || s.kind === 'foundation')) check(stop.reconstructed, `stop '${stop.id}' is marked reconstructed`);
    for (const stop of burj.stops.filter((s) => s.kind === 'floors')) check(/real interiors are not shown/.test(stop.description) && /not every floor is open to the public/.test(stop.description), `stop '${stop.id}' says the real interiors are not shown`);
    check(burj.stops.every((s) => s.camera.distance > 0 && Number.isFinite(s.camera.elevation) && Number.isFinite(s.camera.azimuth)), 'every stop has a camera view');
    for (const id of ['piles', 'raft', 'podium', 'core', 'wing-a', 'wing-b', 'wing-c', 'floors', 'facade', 'spire']) check(partIds.has(id), `part '${id}' exists`);
    const hotspotParts = new Set(burj.hotspots.map((h) => h.partId));
    for (const id of ['raft', 'core', 'wing-a', 'facade', 'spire']) check(hotspotParts.has(id), `there is a hotspot on '${id}'`);
    check(burj.hotspots.some((h) => /10 metres per second/.test(h.text)), 'there is a lifts hotspot with the 10 m/s speed');
  }

  section('Lessons, quiz and missions');
  {
    check(lessonIds.has('foundation-pressure') && lessonIds.has('wind'), 'both lessons exist');
    for (const lesson of burj.lessons) {
      check(lesson.caveat.trim().length > 0, `lesson '${lesson.id}' has a caveat`);
      check(lesson.steps.map((s) => s.kind).join() === 'experience,interact,explain,check', `lesson '${lesson.id}' runs experience, interact, explain, check`);
      for (const step of lesson.steps) if (step.quizId) check(quizIds.has(step.quizId), `lesson '${lesson.id}' quiz '${step.quizId}' exists`);
      for (const step of lesson.steps) for (const id of step.focusPartIds ?? []) check(partIds.has(id), `lesson '${lesson.id}' focus part '${id}' exists`);
    }
    const foundation = burj.lessons.find((l) => l.id === 'foundation-pressure');
    const wind = burj.lessons.find((l) => l.id === 'wind');
    check(foundation.caveat === 'Simplified model, not an engineering calculation.', 'foundation caveat text is exact');
    check(/not a structural engineering calculation/i.test(wind.caveat) && /exaggerated/i.test(wind.caveat), 'wind caveat: not an engineering calculation, sway exaggerated');
    check(foundation.steps.find((s) => s.kind === 'interact')?.simulation === 'foundation-pressure' && wind.steps.find((s) => s.kind === 'interact')?.simulation === 'wind', 'each lesson opens its simulation');
    const explain = foundation.steps.find((s) => s.kind === 'explain').text;
    check(explain.includes('P = F / A'), 'foundation explain text includes "P = F / A"');
    check(/load path/i.test(explain) && /add up along the load paths/i.test(explain), 'foundation explain text says loads build up along load paths');
    const wrongClaims = [
      /pressure (increases|grows|rises|gets bigger|gets higher|is bigger|is higher) on every (lower )?floor/i,
      /lower floors? (always )?(have|has|feel|feels|get|gets) (more|higher|bigger) pressure/i,
      /the lower (the|a) floor,? the (higher|bigger|greater) the pressure/i,
    ];
    check(wrongClaims.every((claim) => !claim.test(explain)), 'foundation explain text does not claim pressure rises on every lower floor');
    check(/soil|rock/.test(explain) && /groundwater/.test(explain) && /settle/.test(explain) && /safety factors/.test(explain), 'foundation explain text lists what real design depends on');
    const windExplain = wind.steps.find((s) => s.kind === 'explain').text;
    check(/square of the speed/.test(windExplain) && /four times/.test(windExplain) && /damping/.test(windExplain), 'wind explain text: square of the speed, four times, damping');

    const pressureQuiz = burj.quiz.find((q) => q.id === foundation.steps.find((s) => s.kind === 'check').quizId);
    check(pressureQuiz?.question === 'What happens to the average pressure if the same force acts on a smaller area?' && pressureQuiz.options[pressureQuiz.correctIndex] === 'It gets bigger', 'pressure quiz: "It gets bigger" is correct');
    for (const q of burj.quiz) check(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length && q.explanation.trim().length > 0, `quiz '${q.id}' has a valid answer and an explanation`);

    const missionIds = burj.missions.map((m) => m.id);
    for (const id of ['find-foundation', 'find-support', 'load-path', 'find-wind', 'compare-designs', 'physics-question', 'timeline']) check(missionIds.includes(id), `mission '${id}' exists`);
    for (const mission of burj.missions) {
      for (const id of [...(mission.partIds ?? []), ...(mission.sequence ?? []).flat()]) check(partIds.has(id), `mission '${mission.id}' part '${id}' exists`);
      if (mission.lessonId) check(lessonIds.has(mission.lessonId), `mission '${mission.id}' lesson '${mission.lessonId}' exists`);
      if (mission.quizId) check(quizIds.has(mission.quizId), `mission '${mission.id}' quiz '${mission.quizId}' exists`);
      check(mission.reward.trim().length > 0 && !/point|streak|coin|timer|score/i.test(mission.reward), `mission '${mission.id}' reward celebrates understanding (no points or streaks)`);
    }
    const loadPath = burj.missions.find((m) => m.id === 'load-path');
    check(loadPath.kind === 'tap-sequence' && loadPath.sequence.length === 4 && loadPath.sequence[2].includes('raft') && loadPath.sequence[3].includes('piles'), 'load-path mission ends raft -> piles');
    check(burj.missions.find((m) => m.id === 'physics-question')?.quizId === pressureQuiz.id, 'physics-question mission uses the lesson 1 quiz');
  }

  section('Physics');
  {
    const { supportedLoad, averagePressure, foundationScenario, windDynamicPressure, relativeWindPush, exaggeratedSwayMetres, windLabel, FOUNDATION_SIMULATION } = physics;
    check(supportedLoad(10) === 10 && supportedLoad(20) === 2 * supportedLoad(10), 'supportedLoad doubles when the floors double');
    check(supportedLoad(10, 3) === 30 && supportedLoad(0) === 0 && supportedLoad(-5) === 0 && supportedLoad(4.7) === 4, 'supportedLoad: load per floor, zero and bad input');
    check(near(averagePressure(100, 5), 20) && near(averagePressure(100, 2.5), 2 * averagePressure(100, 5)), 'the same force on half the area doubles the average pressure');
    check(averagePressure(100, 0) === Infinity && averagePressure(100, -1) === Infinity && averagePressure(0, 0) === 0, 'averagePressure guards a zero or negative area');
    const { lowRise, tall } = FOUNDATION_SIMULATION.presets;
    const low = foundationScenario(lowRise.floors, lowRise.area);
    const high = foundationScenario(tall.floors, tall.area);
    const spread = foundationScenario(tall.floors, FOUNDATION_SIMULATION.maxArea);
    check(low.level === 'low' && high.level === 'high', `low-rise reads low (${low.pressure}), tall reads high (${high.pressure}) on the same area`);
    check(spread.pressure < high.pressure && spread.level !== 'high', `a bigger foundation area lowers the tall building's pressure (${spread.pressure})`);
    check(near(windDynamicPressure(10), 61.25, 1e-9), `windDynamicPressure(10) = 61.25 Pa (${windDynamicPressure(10)})`);
    check(near(windDynamicPressure(20), 4 * windDynamicPressure(10), 1e-9) && windDynamicPressure(0) === 0 && windDynamicPressure(Number.NaN) === 0, 'dynamic pressure grows with the square of the speed');
    check(relativeWindPush(20, 10) === 4 && relativeWindPush(7, 7) === 1 && relativeWindPush(5, 0) === 0, 'relativeWindPush(2v, v) = 4');
    const sways = [0, 0.1, 0.25, 0.5, 0.75, 1].map(exaggeratedSwayMetres);
    check(sways[0] === 0 && sways.every((s, i) => i === 0 || s > sways[i - 1]), `exaggerated sway is 0 at 0 and rises monotonically (${sways.join(', ')})`);
    check(exaggeratedSwayMetres(2) === exaggeratedSwayMetres(1) && exaggeratedSwayMetres(-1) === 0, 'exaggerated sway clamps its input');
    check(windLabel(0) === 'calm' && windLabel(0.3) === 'breezy' && windLabel(0.6) === 'windy' && windLabel(1) === 'stormy', 'wind labels: calm, breezy, windy, stormy');
  }

  section('Procedural Burj Khalifa model');
  {
    const parent = new THREE.Group();
    const model = buildLandmarkModel(burj, { quality: 'high' });
    check(model !== null, 'buildLandmarkModel builds the Burj Khalifa');
    parent.add(model.root);
    const modelParts = new Set(model.partIds);
    check(model.partIds.join() === BURJ_MODEL_PART_IDS.join(), 'model part ids are the exported list');
    check([...partIds].every((id) => modelParts.has(id)) && model.partIds.every((id) => partIds.has(id)), 'content parts and model parts match exactly');
    check(burj.hotspots.every((h) => modelParts.has(h.partId)), 'every hotspot part exists in the model');
    check(burj.missions.every((m) => [...(m.partIds ?? []), ...(m.sequence ?? []).flat()].every((id) => modelParts.has(id))), 'every mission part exists in the model');
    check(SCENE_SCALE === 0.1 && near(model.topY, 82.8, 1e-9), `topY is 82.8 units (${model.topY})`);
    check(near(model.heightToY(585.4), 58.54, 1e-9) && model.heightToY(0) === 0, 'heightToY(585.4) = 58.54');

    model.root.updateMatrixWorld(true);
    const box = (id) => new THREE.Box3().setFromObject(model.part(id));
    check(near(box('spire').max.y, 82.8, 0.5), `the spire top is at 82.8 units (${box('spire').max.y.toFixed(3)})`);
    check(box('raft').max.y < 0 && box('piles').max.y < 0, `the foundation is below ground (raft top ${box('raft').max.y.toFixed(2)}, piles top ${box('piles').max.y.toFixed(2)})`);
    check(box('piles').min.y > -6 && box('piles').min.y < -4, `the piles reach about 43 m below the raft (${box('piles').min.y.toFixed(2)})`);
    check(box('core').max.y <= model.heightToY(586) && box('podium').min.y >= -1e-6, 'the concrete core stops near 585 m and the podium sits on the ground');
    check(model.part('nothing') === undefined, 'part() of an unknown id is undefined');

    let meshes = 0;
    let unlabelled = 0;
    let unpickable = 0;
    model.root.traverse((object) => {
      if (!object.isMesh) return;
      meshes++;
      if (!('partId' in object.userData)) unlabelled++;
      if (typeof object.userData.partId === 'string' && model.pick(object) !== object.userData.partId) unpickable++;
    });
    check(meshes > 0 && unlabelled === 0, `every mesh carries userData.partId (${meshes} meshes)`);
    check(unpickable === 0, 'pick() finds the part of every part mesh');
    for (const id of model.partIds) {
      let firstMesh = null;
      model.part(id).traverse((o) => {
        if (!firstMesh && o.isMesh) firstMesh = o;
      });
      check(firstMesh !== null && model.pick(firstMesh) === id, `pick() of a '${id}' mesh gives '${id}'`);
    }
    const groundMesh = model.root.getObjectByName('ground').children[0];
    check(model.pick(groundMesh) === null && model.pick(new THREE.Object3D()) === null, 'pick() of the ground or a stranger gives null');

    const shown = (object) => {
      for (let node = object; node; node = node.parent) {
        if (!node.visible) return false;
        if (node === model.root) return true;
      }
      return true;
    };
    const materialsOf = (id) => {
      const list = new Set();
      model.part(id).traverse((o) => {
        if (o.isMesh) list.add(o.material);
      });
      return [...list];
    };
    const [ground, groundCut] = model.root.getObjectByName('ground').children;

    // Views.
    check(doesNotThrow(() => model.setView('complete')), 'setView complete runs');
    check(!shown(model.part('piles')) && !shown(model.part('raft')) && shown(model.part('facade')) && ground.visible && !groundCut.visible, 'complete: facade shown, foundation hidden under an opaque ground');
    check(materialsOf('facade').every((m) => m.opacity === 1 && !m.transparent), 'complete: facade is opaque');
    check(doesNotThrow(() => model.setView('cutaway')), 'setView cutaway runs');
    check(shown(model.part('piles')) && shown(model.part('raft')) && !ground.visible && groundCut.visible, 'cutaway: ground cut open, raft and piles shown');
    check(materialsOf('facade').every((m) => near(m.opacity, 0.25) && m.transparent && m.depthWrite === false), 'cutaway: facade at 0.25 opacity without depth writes');
    check(['floors', 'core', 'wing-a', 'wing-b', 'wing-c'].every((id) => shown(model.part(id))) && materialsOf('core').every((m) => m.opacity === 1), 'cutaway: floors, core and wings shown and solid');

    // Construction.
    check(doesNotThrow(() => model.setView('construction')), 'setView construction runs');
    const stepsOk = doesNotThrow(() => model.setConstructionProgress(0));
    check(stepsOk && model.part('piles').visible === false && !shown(model.part('raft')) && !shown(model.part('core')) && !shown(model.part('spire')) && !shown(model.part('facade')), 'progress 0: only the site, spire hidden');
    model.setConstructionProgress(0.03);
    const piles = model.part('piles').children[0];
    check(shown(model.part('piles')) && piles.count === piles.instanceMatrix.count && shown(model.part('raft')) && !shown(model.part('core')) && !shown(model.part('spire')), 'progress 0.03: all piles, the raft being poured, no tower yet');
    model.setConstructionProgress(0.01);
    check(piles.count > 0 && piles.count < piles.instanceMatrix.count && !shown(model.part('raft')), `progress 0.01: piles appearing (${piles.count} of ${piles.instanceMatrix.count}), raft not started`);
    model.setConstructionProgress(0.5);
    const floors = model.part('floors').children[0];
    const coreTop = box('core').max.y;
    check(shown(model.part('core')) && shown(model.part('floors')) && !shown(model.part('spire')), 'progress 0.5: the structure is rising, spire still hidden');
    check(floors.count > 0 && floors.count < floors.instanceMatrix.count && coreTop > 30 && coreTop < 58, `progress 0.5: part of the floors (${floors.count}) and core (${coreTop.toFixed(1)} units)`);
    const shownBox = (id) => {
      const result = new THREE.Box3();
      model.root.updateMatrixWorld(true);
      model.part(id).traverse((o) => {
        if (o.isMesh && shown(o)) result.union(new THREE.Box3().setFromObject(o));
      });
      return result;
    };
    const facadeTop = shownBox('facade').max.y;
    check(facadeTop > 0 && facadeTop < coreTop, `progress 0.5: the facade lags the structure (${facadeTop.toFixed(1)} < ${coreTop.toFixed(1)})`);
    check(near(shownBox('core').max.y, coreTop), 'progress 0.5: the visible core matches its clipped height');
    model.setConstructionProgress(0.8);
    check(shown(model.part('spire')) && box('spire').max.y < 82.8 - 1, `progress 0.8: the spire is being jacked up from inside (tip ${box('spire').max.y.toFixed(1)})`);
    model.setConstructionProgress(1);
    check(model.partIds.every((id) => shown(model.part(id))) && floors.count === floors.instanceMatrix.count && near(box('spire').max.y, 82.8, 0.5), 'progress 1: every part visible and complete');
    model.setView('complete');
    model.setConstructionProgress(0);
    check(shown(model.part('spire')) && shown(model.part('core')), 'outside the construction view, progress is remembered but not shown');

    // Highlight and inspect.
    const facadeBefore = materialsOf('facade').map((m) => m.emissive.getHex());
    check(doesNotThrow(() => model.setHighlight(['core', 'raft', 'not-a-part'])), 'setHighlight runs (unknown ids ignored)');
    check(materialsOf('core').every((m) => m.emissive.getHex() !== 0) && materialsOf('raft').every((m) => m.emissive.getHex() !== 0), 'highlighted parts glow');
    check(materialsOf('facade').every((m, i) => m.emissive.getHex() === facadeBefore[i] && m.emissive.getHex() === 0), 'other parts do not glow');
    check(materialsOf('core').every((m) => !materialsOf('wing-a').includes(m)), 'each part has its own material clones (shared materials are not mutated)');
    model.setView('inspect');
    check(materialsOf('core').every((m) => m.opacity === 1) && materialsOf('facade').every((m) => m.opacity < 0.2 && m.transparent), 'inspect: highlighted parts solid, everything else dim');
    model.setHighlight(null);
    check(model.partIds.every((id) => materialsOf(id).every((m) => m.emissive.getHex() === 0)), 'setHighlight(null) clears the glow');
    model.setView('complete');

    // Load path.
    const loadPath = model.root.getObjectByName('load-path');
    check(doesNotThrow(() => model.setLoadPath(true)) && loadPath.visible, 'setLoadPath(true) shows the arrows');
    const arrows = loadPath.children[0];
    const arrowYs = () => Array.from({ length: arrows.count }, (_, i) => {
      const m = new THREE.Matrix4();
      arrows.getMatrixAt(i, m);
      return new THREE.Vector3().setFromMatrixPosition(m).y;
    });
    const before = arrowYs();
    check(Math.min(...before) < 0 && Math.max(...before) > 40, 'the arrows run from high on the tower down into the foundation');
    model.update(0.05);
    check(arrowYs().some((y, i) => y < before[i]), 'update() moves the arrows downward');
    model.setLoadPath(false);
    check(!loadPath.visible, 'setLoadPath(false) hides the arrows');

    // Wind and sway.
    const wind = model.root.getObjectByName('wind');
    const tower = model.root.getObjectByName('tower');
    check(doesNotThrow(() => model.setWind(0.8)) && wind.visible, 'setWind(0.8) shows the wind');
    const firstX = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(wind.instanceMatrix.array, 0)).x;
    check(doesNotThrow(() => model.update(0.05)), 'update() runs with wind');
    const movedX = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(wind.instanceMatrix.array, 0)).x;
    check(movedX !== firstX, 'the wind streaks move');
    check(tower.rotation.z < 0, `the tower sways downwind (${tower.rotation.z.toFixed(4)} rad)`);
    const strongSway = Math.abs(tower.rotation.z);
    model.setWind(0.2);
    check(Math.abs(tower.rotation.z) < strongSway, 'weaker wind, smaller sway');
    model.setWind(null);
    check(!wind.visible && tower.rotation.z === 0, 'setWind(null) removes the wind and resets the sway');
    check(doesNotThrow(() => model.update(0.016)) && doesNotThrow(() => model.update(Number.NaN)), 'update() runs without wind and tolerates bad input');

    // Triangle budget.
    const triangles = (m) => {
      let total = 0;
      m.root.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry;
        const perCopy = (g.index ? g.index.count : g.attributes.position.count) / 3;
        total += perCopy * (o.isInstancedMesh ? o.instanceMatrix.count : 1);
      });
      return total;
    };
    const highTriangles = triangles(model);
    console.log(`  triangles: high ${highTriangles}`);
    check(highTriangles < 120000, `high quality stays under 120k triangles (${highTriangles})`);
    const lowModel = buildBurjKhalifa({ quality: 'low' });
    const lowTriangles = triangles(lowModel);
    console.log(`  triangles: low ${lowTriangles}`);
    check(lowTriangles < 40000 && lowTriangles < highTriangles, `low quality stays under 40k triangles (${lowTriangles})`);
    check(near(lowModel.topY, 82.8, 1e-9) && lowModel.partIds.length === model.partIds.length, 'low quality has the same parts and height');

    // Dispose.
    check(doesNotThrow(() => model.dispose()), 'dispose() runs');
    check(model.root.parent === null, 'dispose() removes the model from the scene');
    check(doesNotThrow(() => model.dispose()) && doesNotThrow(() => model.update(0.1)), 'dispose() twice and update() after dispose are harmless');
    check(doesNotThrow(() => lowModel.dispose()), 'the low quality model disposes');
  }

  section('Taps reach what the child sees (realworld/picking)');
  {
    const picking = await load('/src/realworld/picking.ts');
    const { partFromHits, seeThroughForTaps, mostFrequentPart, ringOffsets, TAP_TOLERANCE_PX } = picking;
    const model = buildBurjKhalifa();
    check(model.envelopeParts instanceof Set && model.envelopeParts.has('facade') && model.envelopeParts.has('podium'), 'the facade and podium are the outer skin');
    const shown = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    const raycaster = new THREE.Raycaster();
    const tap = (from, to) => {
      model.root.updateMatrixWorld(true);
      const origin = new THREE.Vector3(...from);
      raycaster.set(origin, new THREE.Vector3(...to).sub(origin).normalize());
      const hits = raycaster.intersectObject(model.root, true).filter((h) => shown(h.object));
      return { part: partFromHits(model, hits), first: hits.length > 0 ? model.pick(hits[0].object) : null };
    };
    // A viewpoint like the foundation stop: above ground, outside the pit, looking down at the foundation.
    const eye = [11.9, 7.1, 16.9];
    // The raft's top, out beyond the tower's footprint on the viewer's side (its centre is under the tower).
    const raftBox = new THREE.Box3().setFromObject(model.part('raft'));
    const raftCentre = raftBox.getCenter(new THREE.Vector3());
    const towardEye = new THREE.Vector3(eye[0] - raftCentre.x, 0, eye[2] - raftCentre.z).normalize();
    const raftRim = raftCentre.clone().addScaledVector(towardEye, 0.85 * (raftBox.max.x - raftBox.min.x) / 2).setY(raftBox.max.y - 0.01).toArray();

    model.setView('cutaway');
    const raft = tap(eye, raftRim);
    check(raft.first === 'podium', `in the cutaway the faded podium is the first thing in front of the raft (first hit: ${raft.first})`);
    check(raft.part === 'raft', `a tap on the raft through the faded podium picks the raft (${raft.part})`);
    const towerMid = [0, model.heightToY(300), 0];
    const side = [40, model.heightToY(300), 40];
    const inner = tap(side, towerMid);
    check(inner.first === 'facade' && ['floors', 'core', 'wing-a', 'wing-b', 'wing-c', 'mechanical'].includes(inner.part), `in the cutaway a tap on the tower passes the faded glass to the structure (${inner.first} -> ${inner.part})`);

    model.setView('complete');
    const outer = tap(side, towerMid);
    check(outer.part === 'facade', `in the complete view the same tap picks the glass facade (${outer.part})`);

    model.setView('inspect');
    model.setHighlight(['raft']);
    const dimmed = tap(side, towerMid);
    check(dimmed.part !== null && dimmed.part !== 'facade', `while the raft is inspected, a tap on the dimmed tower picks an inner part, not the skin (${dimmed.part})`);
    check(tap(eye, raftRim).part === 'raft', 'while inspected, the glowing raft is still tapped through the dimmed podium');
    model.setHighlight(null);

    // The rule itself, with hand-made hits.
    const material = (props) => Object.assign(new THREE.MeshStandardMaterial(), props);
    const mesh = (part, props) => {
      const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(props));
      object.userData.partId = part;
      return object;
    };
    const fake = { envelopeParts: new Set(['facade', 'podium']), pick: (object) => object.userData.partId ?? null };
    const ghost = { transparent: true, opacity: 0.25, depthWrite: false };
    const solid = {};
    const arrow = { transparent: true, opacity: 0.95, depthWrite: false };
    check(partFromHits(fake, [{ object: mesh('facade', ghost) }, { object: mesh(null, solid) }]) === 'facade', 'a tap through only the faded skin onto the ground picks the skin');
    check(partFromHits(fake, [{ object: mesh('facade', ghost) }, { object: mesh('core', ghost) }, { object: mesh(null, solid) }]) === 'core', 'crossing only faded parts prefers the inner one');
    check(partFromHits(fake, [{ object: mesh(null, arrow) }, { object: mesh('core', solid) }]) === 'core', 'load-path arrows and wind streaks never stop a tap');
    check(partFromHits(fake, [{ object: mesh(null, solid) }, { object: mesh('core', solid) }]) === null, 'solid ground in front hides what is behind it');
    check(partFromHits(fake, []) === null, 'no hits, no part');
    check(seeThroughForTaps(new THREE.Group()) === true, 'objects without a material never stop a tap');
    check(seeThroughForTaps(mesh('x', solid)) === false && seeThroughForTaps(mesh('x', { transparent: true, opacity: 0.9 })) === false, 'opaque and nearly opaque parts stop a tap');
    check(seeThroughForTaps(mesh('x', { transparent: true, opacity: 0.3 })) === true, 'a faded part lets a tap through');

    check(mostFrequentPart([null, 'piles', 'raft', 'piles']) === 'piles', 'the tolerance ring takes the part found most often');
    check(mostFrequentPart(['raft', 'piles']) === 'raft' && mostFrequentPart([null, null]) === null, 'ties go to the first found; nothing found is null');
    const ring = ringOffsets(10);
    check(ring.length === 8 && ring.every(({ dx, dy }) => near(Math.hypot(dx, dy), 10, 1e-9)), 'a tolerance ring has 8 points at its radius');
    check(TAP_TOLERANCE_PX.length > 0 && TAP_TOLERANCE_PX.every((r, i) => r > 0 && (i === 0 || r > TAP_TOLERANCE_PX[i - 1])), 'tolerance rings grow outward');
    model.dispose();
  }

  section('Eiffel Tower content');
  {
    const { EIFFEL_TOWER, EIFFEL_MODEL_PART_IDS } = realworld;
    const eiffel = landmarkById('eiffel-tower');
    check(eiffel === EIFFEL_TOWER && eiffel.status === 'available', 'the Eiffel Tower is available in the catalogue');
    const problems = validateLandmark(eiffel);
    check(problems.length === 0, `Eiffel Tower content is consistent${problems.length ? ': ' + problems.join('; ') : ''}`);
    check(eiffel.sources.every((source) => source.url.startsWith('https://')), 'every Eiffel source is https');
    check(eiffel.model?.kind === 'glb' && eiffel.model.path.endsWith('.glb') && eiffel.model.fallbackBuilder === 'eiffel-tower', 'the Eiffel Tower uses the downloaded model, with a built-in fallback');
    check(eiffel.heightM === 330, 'height 330 m (official, with antennas)');
    check(/CC0/.test(eiffel.disclaimer) && /ingoenius/.test(eiffel.disclaimer) && /approximate/.test(eiffel.disclaimer), 'the disclaimer credits the model and says it is approximate');
    const partIds = eiffel.parts.map((part) => part.id).sort();
    check(JSON.stringify(partIds) === JSON.stringify([...EIFFEL_MODEL_PART_IDS].sort()), 'content parts and model parts match');
    check(!JSON.stringify(eiffel).includes('Burj'), 'no Burj Khalifa text was copied into the Eiffel Tower');
    const floors = eiffel.timeline.filter((entry) => entry.builtHeightM !== null).map((entry) => entry.builtHeightM);
    check(floors.includes(57) && floors.includes(115) && floors.includes(312), 'the timeline uses the documented heights (57 m, 115 m, 312 m)');
    check(eiffel.timeline[0].sortKey === '1884-06' && eiffel.timeline.at(-1).stage === 'complete', 'the timeline runs from the 1884 idea to today');
    const progress = eiffel.timeline.map((entry) => timelineProgress(eiffel, entry));
    check(progress.every((value, i) => i === 0 || value >= progress[i - 1] - 1e-9), `timeline progress never goes backwards (${progress.map((v) => v.toFixed(2)).join(' ')})`);
    const assembly = eiffel.facts.find((fact) => fact.id === 'assembly-time');
    check(assembly?.confidence === 'medium' && /twenty-one/.test(assembly.note) && /twenty-two/.test(assembly.note), 'where the official pages disagree (21 or 22 months) the fact says so');
    const compare = eiffel.missions.find((mission) => mission.kind === 'compare');
    check(compare?.lessonId === 'triangles', "the frame comparison counts only in the triangles lesson");
    check(eiffel.lessons.some((lesson) => lesson.steps.some((step) => step.simulation === 'triangulation')), 'a lesson uses the triangulation simulation');
    for (const lesson of eiffel.lessons) {
      const kinds = lesson.steps.map((step) => step.kind).join(',');
      check(kinds === 'experience,interact,explain,check', `${lesson.id}: experience, interact, explain, check`);
    }
    const summit = [...eiffel.stops].sort((a, b) => b.heightM - a.heightM)[0];
    check(summit.id === 'summit' && summit.kind === 'top' && eiffel.stops.some((stop) => stop.kind === 'foundation'), 'stops run from the foundations to the summit');
    check(eiffel.stops.filter((stop) => stop.reconstructed).every((stop) => /learning (model|view)/.test(stop.description)), 'reconstructed stops say they are learning views');
  }

  section('Truss solver (triangulation lesson)');
  {
    const { solveTruss, lessonFrame, LESSON_DIAGONAL } = realworld;
    const square = lessonFrame(false);
    check(solveTruss(square.nodes, square.bars, [{ node: 3, fx: 1, fy: 0 }]) === null, 'a pin-jointed square pushed sideways is a mechanism (no answer: it folds)');
    const braced = lessonFrame(true);
    const right = solveTruss(braced.nodes, braced.bars, [{ node: 3, fx: 1, fy: 0 }], 1000);
    check(right !== null, 'the braced frame has an answer');
    // Hand-checked statics: pushing the top-left corner right puts the top bar and right post in compression (1)
    // and the diagonal in tension (square root of 2); the left post carries nothing.
    check(near(right.forces[LESSON_DIAGONAL], Math.SQRT2, 1e-9), `diagonal pulled by sqrt(2) times the push (${right.forces[LESSON_DIAGONAL].toFixed(4)})`);
    check(near(right.forces[2], -1, 1e-9) && near(right.forces[1], -1, 1e-9) && near(right.forces[3], 0, 1e-9) && near(right.forces[0], 0, 1e-9), 'top bar and right post squashed by 1, left post and floor bar carry nothing');
    const left = solveTruss(braced.nodes, braced.bars, [{ node: 2, fx: -1, fy: 0 }], 1000);
    check(near(left.forces[LESSON_DIAGONAL], -Math.SQRT2, 1e-9) && near(left.forces[1], 1, 1e-9) && near(left.forces[2], 0, 1e-9), 'pushing the other way squashes the diagonal (compression) and pulls the right post');
    const move = Math.hypot(right.displacements[3].x, right.displacements[3].y);
    check(move > 0 && move < 0.01, `the braced frame barely moves (${move.toFixed(5)} of a bar length)`);
    check(right.displacements[0].x === 0 && right.displacements[0].y === 0, 'supports stay put');
    // Virtual work: the push times the movement equals the energy stored in the bars.
    const energy = braced.bars.reduce((sum, bar, i) => {
      const length = Math.hypot(braced.nodes[bar.b].x - braced.nodes[bar.a].x, braced.nodes[bar.b].y - braced.nodes[bar.a].y);
      return sum + (right.forces[i] ** 2 * length) / 1000;
    }, 0);
    check(near(right.displacements[3].x, energy, 1e-12), 'work done by the push equals the energy stored in the bars');
    const stiffer = solveTruss(braced.nodes, braced.bars, [{ node: 3, fx: 1, fy: 0 }], 2000);
    check(near(stiffer.displacements[3].x, right.displacements[3].x / 2, 1e-12) && near(stiffer.forces[LESSON_DIAGONAL], Math.SQRT2, 1e-9), 'stiffer bars move half as much and carry the same forces');
    const triangle = solveTruss([{ x: 0, y: 0, fixX: true, fixY: true }, { x: 1, y: 0, fixY: true }, { x: 0.5, y: 0.8 }], [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 0 }], [{ node: 2, fx: 1, fy: -2 }]);
    check(triangle !== null, 'a triangle is rigid');
    check(solveTruss(braced.nodes, [{ a: 0, b: 0 }], []) === null && solveTruss(braced.nodes, [{ a: 0, b: 9 }], []) === null, 'bad bars are refused');
    check(solveTruss([{ x: Number.NaN, y: 0 }], [{ a: 0, b: 0 }], []) === null && solveTruss(braced.nodes, braced.bars, [{ node: 3, fx: Number.POSITIVE_INFINITY, fy: 0 }]) === null, 'non-finite numbers are refused');
    check(solveTruss(braced.nodes, braced.bars, [], 0) === null && solveTruss([], [], []) === null, 'no stiffness or nothing to solve: no answer');
  }

  section('Eiffel Tower model: the built-in fallback');
  {
    const { buildEiffelTower, EIFFEL_TOWER, CONSTRUCTION_PROGRESS: CP } = realworld;
    const model = buildEiffelTower();
    check(model.origin === 'built-in', 'without the file the model says it is the built-in one');
    check(near(model.topY, 33, 1e-9) && near(model.heightToY(57), 5.7, 1e-9), '330 m tall at 1:10');
    let meshes = 0;
    let triangles = 0;
    model.root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      triangles += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    console.log(`  built-in model: ${meshes} meshes, ${triangles} triangles`);
    check(triangles < 60000, `the built-in model stays light (${triangles} triangles)`);
    for (const id of model.partIds) {
      let parts = 0;
      model.part(id)?.traverse((o) => (parts += o.isMesh ? 1 : 0));
      check(parts > 0, `part '${id}' has something to see and tap`);
    }
    const ground = model.root.getObjectByName('ground');
    const visibleGround = () => ground.children.filter((c) => c.visible).length;
    model.setView('complete');
    check(!model.part('foundations').visible && visibleGround() === 1, 'complete view: solid ground, foundations hidden');
    model.setView('cutaway');
    check(model.part('foundations').visible && visibleGround() === 3, 'cutaway: the ground opens and the foundations show');
    const at = (id) => timelineProgress(EIFFEL_TOWER, EIFFEL_TOWER.timeline.find((entry) => entry.id === id));
    model.setView('construction');
    model.setConstructionProgress(0);
    check(!model.part('pillars').visible && !model.part('antennas').visible, 'construction at the start: nothing built yet');
    model.setConstructionProgress(at('first-floor'));
    const shown = (id) => {
      let count = 0;
      model.part(id).traverse((o) => {
        if (o.isInstancedMesh) count += o.count;
        else if (o.isMesh && o.visible) count++;
      });
      return model.part(id).visible ? count : 0;
    };
    check(shown('pillars') > 0 && shown('first-floor') > 0 && shown('upper-tower') === 0 && shown('top') === 0, 'first floor finished: pillars and first floor, nothing above');
    model.setConstructionProgress(at('completed'));
    check(shown('upper-tower') > 0 && shown('top') > 0 && !model.part('antennas').visible, '31 March 1889: the whole iron tower, no antennas yet');
    model.setConstructionProgress(at('antennas'));
    check(model.part('antennas').visible, 'today: the antennas are there');
    model.setConstructionProgress(CP.foundationDone * 0.5);
    check(model.part('foundations').visible && shown('pillars') === 0, 'during the foundation stage only the foundations grow');
    model.setView('inspect');
    model.setHighlight(['legs']);
    const opacities = (id) => {
      const out = [];
      model.part(id).traverse((o) => o.isMesh && out.push(o.material.opacity));
      return out;
    };
    check(opacities('legs').every((o) => o === 1) && opacities('pillars').every((o) => o < 0.5), 'inspecting: the chosen part stays solid, the rest is dimmed');
    model.setHighlight(null);
    model.setLoadPath(true);
    model.update(0.5);
    check(model.root.getObjectByName('load-path').visible, 'the load path shows');
    model.setWind(0.9);
    model.update(1.2);
    check(model.root.getObjectByName('tower').rotation.z !== 0, 'wind makes the (exaggerated) sway');
    model.setWind(null);
    check(model.root.getObjectByName('tower').rotation.z === 0, 'no wind, no sway');
    const someLeg = (() => {
      let found = null;
      model.part('legs').traverse((o) => (found ??= o.isMesh ? o : null));
      return found;
    })();
    check(model.pick(someLeg) === 'legs' && model.pick(ground.children[0]) === null, 'taps find the part; the ground is not a part');
    check(model.envelopeParts.size === 0, 'nothing is an outer skin to tap through');
    check(doesNotThrow(() => model.applyTextures({})), 'textures can arrive later without rebuilding');
    check(doesNotThrow(() => model.dispose()) && doesNotThrow(() => model.dispose()), 'dispose (twice) is safe');
    const low = buildEiffelTower({ quality: 'low' });
    check(low.partIds.length === model.partIds.length, 'low quality has the same parts');
    low.dispose();
  }

  section('Eiffel Tower model: the downloaded file (CC0, 3DMR)');
  {
    const { readFileSync, statSync } = await import('node:fs');
    const { buildEiffelTower, partForDownloadedPiece, EIFFEL_TOWER } = realworld;
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const path = `${root}public/${EIFFEL_TOWER.model.path}`;
    const bytes = statSync(path).size;
    check(bytes === 10713064, `the downloaded file is the verified one (${bytes} bytes)`);
    // Node cannot decode the embedded PNG/JPEG images, so the test strips them; the geometry is the real file's.
    const withoutImages = (buffer) => {
      const jsonLength = buffer.readUInt32LE(12);
      const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
      const binHeader = 20 + jsonLength;
      const bin = buffer.subarray(binHeader + 8, binHeader + 8 + buffer.readUInt32LE(binHeader));
      delete json.images;
      delete json.textures;
      delete json.samplers;
      for (const material of json.materials ?? []) if (material.pbrMetallicRoughness) delete material.pbrMetallicRoughness.baseColorTexture;
      let text = JSON.stringify(json);
      while (Buffer.byteLength(text) % 4 !== 0) text += ' ';
      const jsonBytes = Buffer.from(text, 'utf8');
      const total = 28 + jsonBytes.length + bin.length;
      const out = Buffer.alloc(total);
      out.write('glTF', 0, 'ascii');
      out.writeUInt32LE(2, 4);
      out.writeUInt32LE(total, 8);
      out.writeUInt32LE(jsonBytes.length, 12);
      out.write('JSON', 16, 'ascii');
      jsonBytes.copy(out, 20);
      out.writeUInt32LE(bin.length, 20 + jsonBytes.length);
      out.write('BIN\0', 24 + jsonBytes.length, 'ascii');
      bin.copy(out, 28 + jsonBytes.length);
      return out;
    };
    const stripped = withoutImages(readFileSync(path));
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '', resolve, reject));
    const model = buildEiffelTower({ source: gltf.scene });
    check(model.origin === 'downloaded', 'the model says it uses the downloaded file');
    let triangles = 0;
    const materials = new Set();
    model.root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const g = o.geometry;
      if (o.parent?.name !== 'antennas' && o.parent?.name !== 'foundations' && o.parent?.name !== 'ground') triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    });
    check(triangles === 86230, `all 86,230 triangles of the file are in the model (${triangles})`);
    const box = new THREE.Box3().setFromObject(model.part('top'));
    check(box.max.y > 29.9 && box.max.y < 30.1, `the file's top is at 300 m (scene y ${box.max.y.toFixed(2)})`);
    for (const id of ['pillars', 'arches', 'first-floor', 'legs', 'second-floor', 'upper-tower', 'top']) {
      let count = 0;
      model.part(id).traverse((o) => (count += o.isMesh ? 1 : 0));
      check(count > 0, `the file's pieces fill the '${id}' part (${count})`);
    }
    check([...materials].every((m) => m.transparent === false && m.depthWrite === true), "the file's 'blended' materials are drawn opaque (lattice as cut-outs)");
    // Height bands measured from the file.
    check(partForDownloadedPiece(59.8, 71.5, 'frame2_') === 'legs' && partForDownloadedPiece(59.8, 67, 'entrance') === 'first-floor', 'legs above the first floor are legs; the platform is the first floor');
    check(partForDownloadedPiece(22.4, 53.3, 'arch') === 'arches' && partForDownloadedPiece(0, 5.1, 'basestone') === 'pillars', 'arches by name, pedestals as pillars');
    check(partForDownloadedPiece(252.8, 300, 'top') === 'top' && partForDownloadedPiece(112.4, 300, '_Gray6_') === 'upper-tower' && partForDownloadedPiece(102.7, 112.4, 'M_3') === 'second-floor', 'top, upper tower and second floor bands');
    // Construction: sections appear once the work reaches their top.
    const at = (id) => timelineProgress(EIFFEL_TOWER, EIFFEL_TOWER.timeline.find((entry) => entry.id === id));
    const visibleMeshes = (id) => {
      let count = 0;
      model.part(id).traverse((o) => (count += o.isMesh && o.visible ? 1 : 0));
      return model.part(id).visible ? count : 0;
    };
    model.setView('construction');
    model.setConstructionProgress(at('first-floor'));
    check(visibleMeshes('pillars') > 0 && visibleMeshes('first-floor') > 0 && visibleMeshes('upper-tower') === 0 && visibleMeshes('top') === 0, 'first floor finished: the file shows the pillars and first floor only');
    model.setConstructionProgress(at('second-floor'));
    check(visibleMeshes('legs') > 0 && visibleMeshes('second-floor') > 0 && visibleMeshes('top') === 0, 'second floor finished: up to the second floor');
    model.setConstructionProgress(1);
    model.setView('complete');
    // Taps: rays from the side at a few heights find the right parts.
    model.root.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    // Rays along x: low down through two legs (their centres are about 37 m out), higher up through the middle.
    const tapAt = (heightM, zM = heightM < 60 ? 37 : 0.5) => {
      raycaster.set(new THREE.Vector3(-60, heightM * SCENE_SCALE, zM * SCENE_SCALE), new THREE.Vector3(1, 0, 0));
      const hit = raycaster.intersectObject(model.root, true).find((h) => {
        for (let n = h.object; n; n = n.parent) if (!n.visible) return false;
        return true;
      });
      return hit ? model.pick(hit.object) : null;
    };
    check(['pillars', 'arches'].includes(tapAt(20)), `a tap low down finds a pillar or arch (${tapAt(20)})`);
    check(tapAt(200) === 'upper-tower', `a tap at 200 m finds the upper tower (${tapAt(200)})`);
    check(tapAt(280) === 'top', `a tap at 280 m finds the top (${tapAt(280)})`);
    check(doesNotThrow(() => model.dispose()), 'the downloaded model disposes');
  }

  section('Loading a landmark model: missing or broken files fall back honestly');
  {
    const { prepareLandmarkModel } = await load('/src/realworld/loadModel.ts');
    const { EIFFEL_TOWER, BURJ_KHALIFA } = realworld;
    let asked = null;
    const missing = await prepareLandmarkModel(EIFFEL_TOWER, { quality: 'low' }, async (url) => {
      asked = url;
      throw new Error('404 Not Found');
    }, 'https://example.test/app/');
    check(asked === 'https://example.test/app/assets/realworld/landmarks/eiffel-tower/eiffel_tower_3dmr_model4_rev3.glb', 'the file is asked for relative to the app');
    check(missing.origin === 'fallback' && missing.model?.origin === 'built-in' && missing.error instanceof Error, 'a missing file: the built-in model is shown and the result says so');
    missing.model.dispose();
    const fake = new THREE.Group();
    const piece = new THREE.Mesh(new THREE.BoxGeometry(100, 300, 100).translate(0, 150, 0), new THREE.MeshStandardMaterial());
    fake.add(piece);
    const loaded = await prepareLandmarkModel(EIFFEL_TOWER, { quality: 'low' }, async () => fake);
    check(loaded.origin === 'downloaded' && loaded.model?.origin === 'downloaded' && !loaded.error, 'a file that loads is used');
    loaded.model.dispose();
    const broken = await prepareLandmarkModel(EIFFEL_TOWER, { quality: 'low' }, async () => ({ broken: true }));
    check(broken.origin === 'fallback' && broken.model?.origin === 'built-in' && broken.error, 'a file that loads but cannot be used: the built-in model, honestly labelled');
    broken.model.dispose();
    let burjAsked = false;
    const burj = await prepareLandmarkModel(BURJ_KHALIFA, { quality: 'low' }, async () => {
      burjAsked = true;
      throw new Error('never');
    });
    check(burj.origin === 'procedural' && !burjAsked && burj.model !== null, 'a landmark built in code never loads a file');
    burj.model.dispose();
  }
  section('Golden Gate Bridge content');
  {
    const { GOLDEN_GATE_BRIDGE, GOLDEN_GATE_MODEL_PART_IDS } = realworld;
    const gg = landmarkById('golden-gate-bridge');
    check(gg === GOLDEN_GATE_BRIDGE && gg.status === 'available', 'the Golden Gate Bridge is available in the catalogue');
    const problems = validateLandmark(gg);
    check(problems.length === 0, `Golden Gate content is consistent${problems.length ? ': ' + problems.join('; ') : ''}`);
    check(gg.sources.every((source) => source.url.startsWith('https://')), 'every Golden Gate source is https');
    check(gg.sources.some((s) => s.url.startsWith('https://www.goldengate.org/')) && gg.sources.some((s) => s.url.startsWith('https://www.pbs.org/')), 'sources: the bridge district’s official pages and PBS Building Big');
    check(gg.model?.kind === 'procedural' && gg.model.builder === 'golden-gate-bridge', 'the bridge model is built in code (no downloaded file)');
    check(gg.heightM === 227, 'tower height 227 m (official)');
    check(/built in code/.test(gg.disclaimer) && /approximate/.test(gg.disclaimer) && /simplified/.test(gg.disclaimer) && /not engineering/.test(gg.disclaimer), 'the disclaimer says it is built in code, approximate and simplified');
    const fact = (id) => gg.facts.find((f) => f.id === id)?.value ?? '';
    check(/^1,280 m/.test(fact('main-span')) && /^343 m/.test(fact('side-spans')) && /^227 m/.test(fact('towers')) && /^2,737 m/.test(fact('length')), 'span, side spans, towers and length match the official statistics');
    check(/27,572/.test(fact('wires')) && /250 pairs/.test(fact('suspenders')) && /60,000 tons/.test(fact('anchorage-weight')), 'wires, suspenders and anchorages match the official statistics');
    check(/27 May 1937/.test(fact('built')), 'opening day 27 May 1937');
    check(gg.facts.every((f) => f.sourceIds.length > 0), 'every fact cites a source');
    const partIds = gg.parts.map((part) => part.id).sort();
    check(JSON.stringify(partIds) === JSON.stringify([...GOLDEN_GATE_MODEL_PART_IDS].sort()), 'content parts and model parts match');
    check(['towers', 'main-cables', 'suspenders', 'deck', 'anchorages'].every((id) => partIds.includes(id)), 'deck, towers, cables, suspenders and anchorages can be selected');
    const text = JSON.stringify(gg);
    check(!text.includes('Burj') && !text.includes('Eiffel'), 'no Burj Khalifa or Eiffel Tower text was copied into the bridge');
    check(gg.stops.every((stop) => stop.focusM && Number.isFinite(stop.focusM.x)), 'every bridge stop says where along the bridge to look');
    check(gg.stops.some((s) => s.kind === 'foundation' && s.heightLabel === 'Under the water'), 'the pier stop is labelled "Under the water", not a floor height');
    const learningViews = gg.stops.filter((s) => s.reconstructed).map((s) => s.id).sort();
    check(JSON.stringify(learningViews) === JSON.stringify(['cables', 'pier', 'tower-top']), `places visitors cannot reach (under the water, the cables, a tower top) are marked as learning views (${learningViews.join(', ')})`);

    // Timeline: explicit progress for a bridge, in order, ending complete.
    const progress = gg.timeline.map((entry) => timelineProgress(gg, entry));
    check(gg.timeline.every((entry) => typeof entry.progress === 'number'), 'every bridge timeline entry gives its model progress');
    check(progress.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= progress[i - 1])), `timeline progress never goes backwards (${progress.join(', ')})`);
    check(progress.at(-1) === 1 && gg.timeline.find((e) => e.id === 'opening')?.dateLabel === '27 May 1937', 'the timeline reaches the finished bridge on opening day');
    check(gg.timeline.every((entry) => entry.builtHeightM === null || entry.builtHeightM <= 227), 'no invented heights in the timeline');
    check(gg.timeline.filter((e) => e.confidence === 'medium').every((e) => e.note), 'every medium-confidence date says why');
    const order = (id) => progress[gg.timeline.findIndex((e) => e.id === id)];
    check(order('marin-tower') < order('sf-tower') && order('sf-tower') < order('cables-spun') && order('cables-spun') < order('joined'), 'Marin tower, then San Francisco tower, then cables, then the deck joined');

    // Lessons.
    const forces = gg.lessons.find((l) => l.id === 'tension-compression');
    const load = gg.lessons.find((l) => l.id === 'load-path-bridge');
    check(forces?.steps.some((s) => s.simulation === 'bridge-forces') && forces.steps.some((s) => s.quizId === 'quiz-cable-force'), 'Lesson A (tension and compression): pick a part, then a quiz');
    check(load?.steps.some((s) => s.simulation === 'suspension-load') && load.steps.some((s) => s.quizId === 'quiz-load-order'), 'Lesson B (load path): move a load, then a quiz');
    check([forces, load].every((l) => /Educational model/.test(l.caveat) && /not an engineering design calculation/.test(l.caveat)), 'both lessons are labelled as an educational model');
    const explainB = load.steps.find((s) => s.kind === 'explain')?.text ?? '';
    check(/Documented facts/.test(explainB) && /Conceptual model/.test(explainB), 'Lesson B keeps documented facts apart from the conceptual model');
    const explainA = forces.steps.find((s) => s.kind === 'explain')?.text ?? '';
    check(/tension/.test(explainA) && /compression/.test(explainA) && /depends on/.test(explainA), 'Lesson A says the full load path depends on the design');
    const trace = gg.missions.find((m) => m.id === 'trace-the-load');
    check(JSON.stringify(trace?.sequence) === JSON.stringify([['deck'], ['suspenders'], ['main-cables'], ['towers'], ['piers']]), 'the trace-the-load mission goes deck, suspenders, cables, towers, piers');
    check(gg.missions.some((m) => m.kind === 'compare' && m.lessonId === 'load-path-bridge'), 'the compare mission belongs to the load lesson');

    // EAVARA's lines (from the brief) and their choices point at real stops, lessons and parts.
    const companion = gg.companion;
    check(companion?.welcome === 'Welcome to the Golden Gate Bridge. Shall we explore the towers or the cables?', 'EAVARA welcomes the child with the towers-or-cables question');
    check(companion?.parts?.['main-cables']?.text === 'These cables carry tension. Want to see how the bridge transfers a load?', 'EAVARA explains the cables when they are tapped');
    check(companion?.lessons?.['load-path-bridge'] === 'Can you trace the load from the deck toward the foundations?', 'EAVARA asks the child to trace the load in the load lesson');
    const choices = [...(companion.welcomeChoices ?? []), ...Object.values(companion.parts ?? {}).flatMap((p) => p.choices ?? [])];
    check(choices.every((c) => (!c.stopId || gg.stops.some((s) => s.id === c.stopId)) && (!c.lessonId || gg.lessons.some((l) => l.id === c.lessonId))), 'every EAVARA choice leads to a real stop or lesson');
    check(Object.keys(companion.parts ?? {}).every((id) => partIds.includes(id)) && Object.keys(companion.lessons ?? {}).every((id) => gg.lessons.some((l) => l.id === id)), 'EAVARA has lines only for real parts and lessons');
  }

  section('Cable under a load (bridge lesson)');
  {
    const { cableUnderLoad, GOLDEN_GATE_SAG_RATIO } = realworld;
    const expected = (p, s) => {
      const d = 4 * s * p * (1 - p);
      const h = 1 / (4 * s);
      return { left: (h * Math.hypot(p, d)) / p, right: (h * Math.hypot(1 - p, d)) / (1 - p) };
    };
    const ninth = cableUnderLoad(0.5, 1 / 9);
    check(near(ninth.leftPull, expected(0.5, 1 / 9).left, 1e-6) && near(ninth.leftPull, ninth.rightPull, 1e-9), `a load in the middle: both halves pull the same, ${ninth.leftPull.toFixed(3)} x the load`);
    check(near(ninth.leftPull, 2.305, 0.001), 'with a dip of 1/9 of the span the cable pulls about 2.3 x the load');
    check(near(cableUnderLoad(0.5, 1 / 18).leftPull, 4.528, 0.001), 'half the dip: about 4.5 x the load');
    const off = cableUnderLoad(0.3, 0.11);
    check(near(off.leftPull, expected(0.3, 0.11).left, 1e-6) && near(off.rightPull, expected(0.3, 0.11).right, 1e-6), 'an off-centre load matches the hand calculation');
    check(near(off.leftTower, 0.7, 1e-6) && near(off.rightTower, 0.3, 1e-6) && near(off.leftTower + off.rightTower, 1, 1e-9), 'the nearer tower carries more: 70% / 30%');
    check(near(off.sidewaysPull, 1 / (4 * 0.11), 1e-6), 'the sideways pull at the towers is the same wherever the load is (load / (4 x dip))');
    check(GOLDEN_GATE_SAG_RATIO.normal > 0.1 && GOLDEN_GATE_SAG_RATIO.normal < 0.12 && near(GOLDEN_GATE_SAG_RATIO.flat, GOLDEN_GATE_SAG_RATIO.normal / 2, 1e-12), 'the model’s cable dips about 1/9 of the span; the pretend flat one half of that');
    const normal = cableUnderLoad(0.5, GOLDEN_GATE_SAG_RATIO.normal);
    const flat = cableUnderLoad(0.5, GOLDEN_GATE_SAG_RATIO.flat);
    check(flat.leftPull / normal.leftPull > 1.9 && flat.leftPull / normal.leftPull < 2, 'the flatter cable pulls almost twice as hard');
    check(cableUnderLoad(0, 0.1).position === 0.05 && cableUnderLoad(1, 0.1).position === 0.95, 'loads are kept a little away from the towers');
    check(cableUnderLoad(Number.NaN, 0.1) === null && cableUnderLoad(0.5, 0) === null && cableUnderLoad(0.5, -1) === null && cableUnderLoad(0.5, Number.POSITIVE_INFINITY) === null, 'unusable input gives null');
  }

  section('Golden Gate Bridge model (built in code)');
  {
    const { GOLDEN_GATE_BRIDGE, GOLDEN_GATE_MODEL_PART_IDS, buildGoldenGateBridge, mainCableHeightM } = realworld;
    const model = buildLandmarkModel(GOLDEN_GATE_BRIDGE, { quality: 'high' });
    check(model !== null && model.root.name === 'golden-gate-bridge', 'buildLandmarkModel builds the bridge');
    check(JSON.stringify(model.partIds) === JSON.stringify([...GOLDEN_GATE_MODEL_PART_IDS]), 'the model has the six parts');
    check(near(model.topY, 22.7, 1e-9) && near(model.heightToY(227), 22.7, 1e-9), 'tower tops at 227 m (22.7 scene units)');
    check(model.overview && model.overview.distance > 100 && model.overview.targetY < 20, 'the bridge brings a wide, low overview framing');
    check(typeof model.setForces === 'function' && typeof model.setLoadPoint === 'function', 'the bridge has force arrows and a movable load');
    for (const id of GOLDEN_GATE_MODEL_PART_IDS) {
      let meshes = 0;
      model.part(id)?.traverse((o) => o.isMesh && meshes++);
      check(meshes > 0, `part '${id}' has geometry`);
    }
    let triangles = 0;
    model.root.updateMatrixWorld(true);
    model.root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      triangles += tris * (o.isInstancedMesh ? o.count : 1);
    });
    check(triangles < 250000, `the bridge stays light: ${Math.round(triangles).toLocaleString()} triangles`);
    const low = buildGoldenGateBridge({ quality: 'low' });
    check(low.partIds.length === 6, 'the low-quality bridge builds too');
    low.dispose();

    // Where things are (metres x 0.1): towers at +-640 m, cable tops near the tower tops, the dip in the middle.
    const box = new THREE.Box3().setFromObject(model.part('towers'));
    check(near(box.min.x, -64 - 0.5, 0.2) && near(box.max.x, 64 + 0.5, 0.2) && near(box.max.y, 22.7, 0.05), `towers stand 1,280 m apart and reach 227 m (x ${box.min.x.toFixed(1)}..${box.max.x.toFixed(1)}, top ${box.max.y.toFixed(2)})`);
    check(near(mainCableHeightM(0), 80, 1e-9) && near(mainCableHeightM(640), 223, 1e-9) && near(mainCableHeightM(-640), 223, 1e-9), 'the main cable rests on the tower tops and dips in the middle');
    check(mainCableHeightM(0) > 67 + 7.6, 'the cable stays above the deck in the middle');
    const deckBox = new THREE.Box3().setFromObject(model.part('deck'));
    check(near(deckBox.min.y, 6.7, 0.01), `the underside of the deck is 67 m above the water (${(deckBox.min.y * 10).toFixed(1)} m)`);

    // Construction order follows the timeline: Marin pier and tower, San Francisco pier and tower, cables, then the deck.
    const towers = model.part('towers').children;
    const marinTower = towers.find((t) => t.position.x > 0);
    const sfTower = towers.find((t) => t.position.x < 0);
    const instancedShown = (id) => {
      let shown = 0;
      const m = new THREE.Matrix4();
      model.part(id).traverse((o) => {
        if (!o.isInstancedMesh) return;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          if (Math.abs(m.determinant()) > 1e-12) shown++;
        }
      });
      return shown;
    };
    model.setView('construction');
    model.setConstructionProgress(0.05);
    check(!marinTower.visible && !sfTower.visible && instancedShown('main-cables') === 0, 'early on: no towers or cables yet');
    model.setConstructionProgress(0.2);
    check(marinTower.visible && !sfTower.visible, 'the Marin tower rises first');
    model.setConstructionProgress(0.4);
    check(marinTower.visible && sfTower.visible && instancedShown('main-cables') === 0, 'then the San Francisco tower, still without cables');
    model.setConstructionProgress(0.6);
    check(instancedShown('main-cables') > 0 && instancedShown('deck') === 0 && instancedShown('suspenders') === 0, 'the cables are spun before any deck hangs');
    model.setConstructionProgress(0.76);
    const partDeck = instancedShown('deck');
    const totalDeck = (() => {
      let n = 0;
      model.part('deck').traverse((o) => o.isInstancedMesh && (n += o.count));
      return n;
    })();
    check(partDeck > 0 && partDeck < totalDeck && instancedShown('suspenders') > 0, `the deck grows out from the towers (${partDeck} of ${totalDeck} pieces)`);
    model.setConstructionProgress(1);
    check(instancedShown('deck') === totalDeck, 'finished: the whole deck');
    model.setConstructionProgress(0.1);
    model.setView('complete');
    check(marinTower.visible && sfTower.visible && instancedShown('deck') === totalDeck, 'the complete view always shows the finished bridge');

    // Views and highlighting.
    const water = model.root.getObjectByName('water');
    check(water.material.transparent === false, 'complete view: the water is solid');
    model.setView('cutaway');
    check(water.material.transparent === true && water.material.depthWrite === false, 'cutaway: the water turns see-through so the piers show');
    model.setView('inspect');
    model.setHighlight(['towers']);
    const material = (id) => {
      let found = null;
      model.part(id).traverse((o) => o.isMesh && !found && (found = o.material));
      return found;
    };
    check(material('towers').opacity === 1 && material('towers').emissive.getHex() !== 0 && material('deck').opacity < 0.5, 'inspect: the chosen part glows, the rest fades');
    model.setHighlight(['not-a-part']);
    check(material('towers').emissive.getHex() === 0, 'unknown part ids are ignored');
    model.setHighlight(null);
    model.setView('complete');

    // Force arrows and the moving load.
    const arrows = model.root.getObjectByName('arrows');
    const marker = model.root.getObjectByName('load');
    const colour = new THREE.Color();
    model.setForces('main-cables');
    arrows.getColorAt(0, colour);
    check(arrows.count > 0 && colour.b > colour.r, `cables: blue tension arrows (${arrows.count})`);
    model.setForces('towers');
    arrows.getColorAt(0, colour);
    check(arrows.count > 0 && colour.r > colour.b, 'towers: orange compression arrows');
    model.setForces('nonsense');
    check(arrows.count === 0, 'an unknown part shows no arrows');
    model.setForces(null);
    model.setLoadPoint(0.25);
    check(marker.visible && near(marker.position.x, -32, 1e-6) && arrows.count > 0, 'a load a quarter of the way along the main span, with its load path');
    model.setLoadPath(true);
    model.setLoadPoint(null);
    check(marker.visible && near(marker.position.x, 0, 1e-6), 'without a lesson load, the general load path stands in the middle');
    model.setLoadPath(false);
    check(!marker.visible && arrows.count === 0, 'load path off: no marker, no arrows');
    const lowestCable = () => {
      let lowest = Infinity;
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      model.part('main-cables').traverse((o) => {
        if (!o.isInstancedMesh) return;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          if (Math.abs(p.x) < 60) lowest = Math.min(lowest, p.y);
        }
      });
      return lowest * 10;
    };
    const normalLow = lowestCable();
    model.setLoadPoint(0.5, 'flat');
    const flatLow = lowestCable();
    model.setLoadPoint(null);
    check(near(normalLow, 80, 1.5) && near(flatLow, 151.5, 1.5) && near(lowestCable(), 80, 1.5), `the pretend flat cable hangs higher (${normalLow.toFixed(0)} m -> ${flatLow.toFixed(0)} m) and goes back afterwards`);
    check(doesNotThrow(() => {
      model.setWind(0.6);
      for (let i = 0; i < 30; i++) model.update(1 / 60);
      model.setLoadPoint(0.7);
      model.update(0.5);
      model.update(Number.NaN);
      model.setWind(null);
    }), 'wind and flowing arrows update without errors');
    model.setLoadPoint(null);

    // Taps (the same picking rule as the app).
    const picking = await load('/src/realworld/picking.ts');
    const raycaster = new THREE.Raycaster();
    const shown = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    const tap = (from, to) => {
      model.root.updateMatrixWorld(true);
      const origin = new THREE.Vector3(...from);
      raycaster.set(origin, new THREE.Vector3(...to).sub(origin).normalize());
      return picking.partFromHits(model, raycaster.intersectObject(model.root, true).filter((h) => shown(h.object)));
    };
    check(tap([64, 15, 60], [64, 15, 0]) === 'towers', 'a tap on a tower picks the towers');
    check(tap([-30, 7.1, 60], [-30, 7.1, 0]) === 'deck', 'a tap on the side of the deck picks the deck');
    check(tap([1, 8, 60], [1, 8, 0]) === 'main-cables', 'a tap near the low point of a main cable picks the cables');
    check(tap([103.5, 5, 60], [103.5, 5, 0]) === 'anchorages', 'a tap on an anchorage picks the anchorages');
    const suspenderX = -967.76 + 15.24 * 20;
    check(tap([suspenderX / 10, 12, 60], [suspenderX / 10, 12, 0]) === 'suspenders', 'a tap on a suspender rope picks the suspenders');
    check(tap([-64, 1, 20], [-64, -2, 0]) === null, 'complete view: the water hides the underwater pier');
    model.setView('cutaway');
    check(tap([-64, 1, 20], [-64, -2, 0]) === 'piers', 'cutaway: a tap through the see-through water reaches the pier');
    model.setLoadPoint(0.5);
    check(tap([1, 8, 60], [1, 8, 0]) === 'main-cables', 'the load and its arrows never stop a tap');
    model.setLoadPoint(null);
    model.setView('complete');
    check(model.pick(water) === null && model.pick(arrows) === null, 'water and arrows are not parts');

    check(doesNotThrow(() => model.dispose()) && model.root.parent === null, 'the bridge disposes cleanly');
    check(doesNotThrow(() => model.dispose()), 'disposing twice is harmless');
  }
  section('The view shift keeps the screen\u2019s shape (RealWorldScene)');
  {
    const { RealWorldScene } = await load('/src/game/RealWorldScene.ts');
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 3000);
    const fakeStore = { subscribe: () => () => {}, getState: () => ({ mode: 'realworld', realWorld: { landmarkId: null } }) };
    const fakeWorld = { camera, renderer: { domElement: { clientWidth: 1280, clientHeight: 800 } } };
    const fakeInput = { pointer: { on: () => () => {} } };
    const fakeProgress = { load() {}, onChange() {}, get: () => ({ missions: [], lessons: [], quiz: [] }) };
    const scene = new RealWorldScene(fakeStore, {}, fakeWorld, fakeInput, fakeProgress);
    scene.active = true;
    scene.setScreenInsets({ left: 0.22, top: 0, right: 0.3, bottom: 0.2 });
    for (let i = 0; i < 60; i++) scene.update(1 / 30);
    check(camera.view?.enabled === true && camera.view.offsetX > 0, 'panels on the right and below: the image centre moves to the free area');
    check(near(camera.aspect, 1.6, 1e-12), `the camera keeps the canvas aspect while shifted (${camera.aspect})`);
    const shifted = camera.projectionMatrix.clone();
    const unshifted = new THREE.PerspectiveCamera(50, 1.6, 0.1, 3000);
    check(near(shifted.elements[0] / shifted.elements[5], unshifted.projectionMatrix.elements[0] / unshifted.projectionMatrix.elements[5], 1e-9), 'nothing is stretched: same width-to-height scale as an unshifted camera');
    scene.setScreenInsets({ left: 0, top: 0, right: 0, bottom: 0 });
    for (let i = 0; i < 120; i++) scene.update(1 / 30);
    check(!camera.view?.enabled && near(camera.aspect, 1.6, 1e-12), 'panels gone: the shift is cleared and the aspect is still the canvas\u2019s');
  }
} finally {
  await server.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
