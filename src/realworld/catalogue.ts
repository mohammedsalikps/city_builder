/**
 * The Real World Explorer catalogue: every landmark the explorer lists.
 * Only 'available' entries carry content (facts, model, lessons...). The
 * 'coming-soon' entries have a name, place, tagline and subjects only, and
 * the UI shows "Coming soon" for them. Placeholder topics use generic names,
 * not specific real places.
 */
import { BURJ_KHALIFA } from '@/realworld/landmarks/burjKhalifa';
import { EIFFEL_TOWER } from '@/realworld/landmarks/eiffelTower';
import { GOLDEN_GATE_BRIDGE } from '@/realworld/landmarks/goldenGateBridge';
import { progressForBuiltHeight, type RealLandmark, type StageId, type TimelineEntry } from '@/realworld/types';

/** A 'coming-soon' entry: no facts, no model, no content yet. */
function comingSoon(id: string, name: string, place: string, tagline: string, subjects: string[]): RealLandmark {
  return {
    id,
    name,
    place,
    status: 'coming-soon',
    tagline,
    summary: '',
    disclaimer: '',
    model: null,
    facts: [],
    sources: [],
    stops: [],
    parts: [],
    hotspots: [],
    stages: [],
    timeline: [],
    lessons: [],
    quiz: [],
    missions: [],
    subjects,
  };
}

export const LANDMARKS: RealLandmark[] = [
  BURJ_KHALIFA,
  EIFFEL_TOWER,
  GOLDEN_GATE_BRIDGE,
  comingSoon('dam-and-reservoir', 'Dam and reservoir', 'Example landmark', 'How a dam holds back a lake of water', ['Engineering', 'Physics', 'Geography']),
  comingSoon('wind-turbine', 'Wind turbine', 'Example landmark', 'How moving air can make electricity', ['Engineering', 'Physics', 'Energy']),
  comingSoon('hydroelectric-power-station', 'Hydroelectric power station', 'Example landmark', 'How falling water can make electricity', ['Engineering', 'Physics', 'Energy']),
  comingSoon('rocket-launch-vehicle', 'Rocket launch vehicle', 'Example landmark', 'How a rocket pushes itself into the sky', ['Engineering', 'Physics', 'Space']),
  comingSoon('skyscraper-under-construction', 'Skyscraper under construction', 'Example landmark', 'How a tall building is put together', ['Engineering', 'Construction']),
  comingSoon('stadium', 'Stadium', 'Example landmark', 'How a big roof can cover thousands of seats', ['Engineering', 'Architecture']),
  comingSoon('solar-power-plant', 'Solar power plant', 'Example landmark', 'How sunlight can make electricity', ['Engineering', 'Physics', 'Energy']),
  comingSoon('railway-station', 'Railway station', 'Example landmark', 'How a busy station keeps trains and people moving', ['Engineering', 'Architecture']),
];

/** The landmark with this id, or undefined. */
export function landmarkById(id: string): RealLandmark | undefined {
  return LANDMARKS.find((landmark) => landmark.id === id);
}

/** Landmarks a child can open now. */
export function availableLandmarks(): RealLandmark[] {
  return LANDMARKS.filter((landmark) => landmark.status === 'available');
}

/** 'YYYY-MM' to a month count, for ordering and interpolation. NaN if malformed. */
export function monthIndex(sortKey: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(sortKey);
  if (!match) return Number.NaN;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

/** Progress of an entry that fixes it on its own: a documented height in the structure stage, or any other stage's progress. */
function knownProgress(landmark: RealLandmark, entry: TimelineEntry): number | undefined {
  if (entry.progress !== undefined) return entry.progress;
  if (entry.stage === 'structure') {
    if (entry.builtHeightM === null || !landmark.heightM) return undefined;
    return progressForBuiltHeight(entry.builtHeightM, landmark.heightM);
  }
  return stageProgress(landmark, entry.stage);
}

/** The model progress (0..1) of a stage, or 0 when the landmark has no such stage. */
export function stageProgress(landmark: RealLandmark, stage: StageId): number {
  return landmark.stages.find((s) => s.id === stage)?.progress ?? 0;
}

/**
 * How much of the 3D model to show for a timeline entry (0..1).
 * Entries with a documented height show that height; other structure
 * entries are placed between their neighbours by date. Interpolated values
 * are for display only and are not documented heights (the entry's
 * `builtHeightM` stays null).
 */
export function timelineProgress(landmark: RealLandmark, entry: TimelineEntry): number {
  const own = knownProgress(landmark, entry);
  if (own !== undefined) return own;
  const sorted = [...landmark.timeline].sort((a, b) => monthIndex(a.sortKey) - monthIndex(b.sortKey));
  const at = monthIndex(entry.sortKey);
  let before: { month: number; progress: number } | undefined;
  let after: { month: number; progress: number } | undefined;
  for (const other of sorted) {
    const progress = other === entry ? undefined : knownProgress(landmark, other);
    if (progress === undefined) continue;
    const month = monthIndex(other.sortKey);
    if (month <= at) before = { month, progress };
    else if (!after) after = { month, progress };
  }
  if (before && after) {
    const span = after.month - before.month;
    return span > 0 ? before.progress + ((at - before.month) / span) * (after.progress - before.progress) : before.progress;
  }
  return before?.progress ?? after?.progress ?? stageProgress(landmark, entry.stage);
}

const STAGE_IDS: readonly StageId[] = ['site', 'foundation', 'structure', 'exterior', 'complete'];

/**
 * Content checks for a landmark (empty when it is consistent): ids unique,
 * every reference resolves, sources are https, the timeline is in order and
 * 'coming-soon' entries carry no content. Used by tests and by authors of
 * new landmarks.
 */
export function validateLandmark(landmark: RealLandmark): string[] {
  const problems: string[] = [];
  const where = (kind: string, id: string) => `${landmark.id} ${kind} '${id}'`;
  const sourceIds = new Set(landmark.sources.map((s) => s.id));
  const partIds = new Set(landmark.parts.map((p) => p.id));
  const lessonIds = new Set(landmark.lessons.map((l) => l.id));
  const quizIds = new Set(landmark.quiz.map((q) => q.id));
  const stopIds = new Set(landmark.stops.map((s) => s.id));

  const unique = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`${where(kind, id)} is duplicated`);
      seen.add(id);
    }
  };
  const cites = (kind: string, id: string, ids: string[]) => {
    if (ids.length === 0) problems.push(`${where(kind, id)} cites no source`);
    for (const sourceId of ids) if (!sourceIds.has(sourceId)) problems.push(`${where(kind, id)} cites unknown source '${sourceId}'`);
  };
  const needsPart = (kind: string, id: string, partId: string) => {
    if (!partIds.has(partId)) problems.push(`${where(kind, id)} uses unknown part '${partId}'`);
  };

  unique('source', landmark.sources.map((s) => s.id));
  unique('fact', landmark.facts.map((f) => f.id));
  unique('part', landmark.parts.map((p) => p.id));
  unique('hotspot', landmark.hotspots.map((h) => h.id));
  unique('stop', landmark.stops.map((s) => s.id));
  unique('timeline entry', landmark.timeline.map((t) => t.id));
  unique('lesson', landmark.lessons.map((l) => l.id));
  unique('quiz question', landmark.quiz.map((q) => q.id));
  unique('mission', landmark.missions.map((m) => m.id));

  if (landmark.status === 'coming-soon') {
    const content = landmark.facts.length + landmark.sources.length + landmark.parts.length + landmark.timeline.length + landmark.lessons.length + landmark.missions.length;
    if (content > 0 || landmark.model !== null) problems.push(`${landmark.id} is coming soon but has content or a model`);
    return problems;
  }

  for (const source of landmark.sources) if (!/^https:\/\/[^\s]+\.[^\s]+/.test(source.url)) problems.push(`${where('source', source.id)} needs an https url`);
  for (const fact of landmark.facts) cites('fact', fact.id, fact.sourceIds);
  for (const part of landmark.parts) cites('part', part.id, part.sourceIds);
  for (const hotspot of landmark.hotspots) {
    cites('hotspot', hotspot.id, hotspot.sourceIds);
    needsPart('hotspot', hotspot.id, hotspot.partId);
  }
  for (const lesson of landmark.lessons) {
    cites('lesson', lesson.id, lesson.sourceIds);
    if (!lesson.caveat.trim()) problems.push(`${where('lesson', lesson.id)} has no caveat`);
    for (const step of lesson.steps) {
      if (step.quizId && !quizIds.has(step.quizId)) problems.push(`${where('lesson', lesson.id)} uses unknown quiz '${step.quizId}'`);
      if (step.stopId && !stopIds.has(step.stopId)) problems.push(`${where('lesson', lesson.id)} uses unknown stop '${step.stopId}'`);
      for (const partId of step.focusPartIds ?? []) needsPart('lesson', lesson.id, partId);
    }
  }
  let previousMonth = Number.NEGATIVE_INFINITY;
  for (const entry of landmark.timeline) {
    cites('timeline entry', entry.id, entry.sourceIds);
    if (!STAGE_IDS.includes(entry.stage)) problems.push(`${where('timeline entry', entry.id)} has unknown stage '${entry.stage}'`);
    const month = monthIndex(entry.sortKey);
    if (Number.isNaN(month)) problems.push(`${where('timeline entry', entry.id)} has a malformed sortKey`);
    else if (month < previousMonth) problems.push(`${where('timeline entry', entry.id)} is out of order`);
    else previousMonth = month;
  }
  for (const stage of landmark.stages) if (!STAGE_IDS.includes(stage.id)) problems.push(`${where('stage', stage.id)} is not a known stage`);
  for (const question of landmark.quiz) {
    const { correctIndex, options } = question;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) problems.push(`${where('quiz question', question.id)} has an invalid correctIndex`);
    if (!question.explanation.trim()) problems.push(`${where('quiz question', question.id)} has no explanation`);
  }
  for (const mission of landmark.missions) {
    for (const partId of [...(mission.partIds ?? []), ...(mission.sequence ?? []).flat()]) needsPart('mission', mission.id, partId);
    if (mission.lessonId && !lessonIds.has(mission.lessonId)) problems.push(`${where('mission', mission.id)} uses unknown lesson '${mission.lessonId}'`);
    if (mission.quizId && !quizIds.has(mission.quizId)) problems.push(`${where('mission', mission.id)} uses unknown quiz '${mission.quizId}'`);
    if (!mission.reward.trim()) problems.push(`${where('mission', mission.id)} has no reward`);
  }
  return problems;
}
