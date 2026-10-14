/**
 * RealWorld Explorer's own learning progress: which missions, lessons and
 * questions a child has finished at each landmark. Deliberately separate
 * from Challenge Mode's progress (ProgressStorage) - resetting level
 * progress never touches it, and it never unlocks or changes anything in
 * Challenge Mode or My World. Stored under a 'city-builder.' key, so
 * "Delete everything on this device" removes it (see DeviceData).
 *
 * Progress only records what was understood or explored; there are no
 * points, streaks or timers.
 */

export const REALWORLD_PROGRESS_KEY = 'city-builder.realworld';
const VERSION = 1;
/** Longest id we keep (landmark, mission, lesson and quiz ids are short slugs). */
const MAX_ID = 64;

export interface LandmarkProgress {
  /** Mission ids finished at this landmark. */
  missions: string[];
  /** Lesson ids whose last step was reached. */
  lessons: string[];
  /** Quiz ids answered correctly (a wrong answer is never recorded). */
  quizzes: string[];
  /** True once the construction timeline was followed to the end. */
  timelineWatched: boolean;
}

interface ProgressFile {
  version: typeof VERSION;
  landmarks: Record<string, LandmarkProgress>;
}

export function emptyLandmarkProgress(): LandmarkProgress {
  return { missions: [], lessons: [], quizzes: [], timelineWatched: false };
}

export class RealWorldProgressStore {
  private landmarks: Record<string, LandmarkProgress> = {};
  private readonly listeners = new Set<() => void>();

  constructor(private readonly key: string = REALWORLD_PROGRESS_KEY) {}

  /** Read the stored progress (bad or missing data simply starts fresh). */
  load(): void {
    this.landmarks = {};
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      this.landmarks = parseProgress(JSON.parse(raw));
    } catch {
      console.warn('[realworld] Saved progress is not valid JSON; starting without it');
    }
  }

  /** A copy of the progress at one landmark. */
  get(landmarkId: string): LandmarkProgress {
    const found = this.landmarks[landmarkId];
    return found ? { ...found, missions: [...found.missions], lessons: [...found.lessons], quizzes: [...found.quizzes] } : emptyLandmarkProgress();
  }

  /** Mark a mission finished. True when it was not finished before. */
  completeMission(landmarkId: string, missionId: string): boolean {
    return this.addTo(landmarkId, 'missions', missionId);
  }

  completeLesson(landmarkId: string, lessonId: string): boolean {
    return this.addTo(landmarkId, 'lessons', lessonId);
  }

  /** Record a correct answer (wrong answers are not stored). */
  answeredCorrectly(landmarkId: string, quizId: string): boolean {
    return this.addTo(landmarkId, 'quizzes', quizId);
  }

  markTimelineWatched(landmarkId: string): boolean {
    if (!validId(landmarkId)) return false;
    const progress = this.landmarks[landmarkId] ?? emptyLandmarkProgress();
    if (progress.timelineWatched) return false;
    this.landmarks[landmarkId] = { ...progress, timelineWatched: true };
    this.changed();
    return true;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drop the progress held in memory without saving (part of "Delete everything"). */
  forget(): void {
    this.landmarks = {};
    this.listeners.forEach((listener) => listener());
  }

  /** Remove the stored copy. */
  clear(): void {
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      // Storage blocked: nothing of ours could be stored either.
    }
  }

  private addTo(landmarkId: string, field: 'missions' | 'lessons' | 'quizzes', id: string): boolean {
    if (!validId(landmarkId) || !validId(id)) return false;
    const progress = this.landmarks[landmarkId] ?? emptyLandmarkProgress();
    if (progress[field].includes(id)) return false;
    this.landmarks[landmarkId] = { ...progress, [field]: [...progress[field], id] };
    this.changed();
    return true;
  }

  private changed(): void {
    const file: ProgressFile = { version: VERSION, landmarks: this.landmarks };
    try {
      window.localStorage.setItem(this.key, JSON.stringify(file));
    } catch (error) {
      console.warn('[realworld] Could not save progress', error);
    }
    this.listeners.forEach((listener) => listener());
  }
}

/** Strict reader for stored progress (storage is untrusted): bad entries are dropped one by one. */
export function parseProgress(data: unknown): Record<string, LandmarkProgress> {
  const out: Record<string, LandmarkProgress> = {};
  if (!isRecord(data) || data.version !== VERSION || !isRecord(data.landmarks)) return out;
  for (const [landmarkId, value] of Object.entries(data.landmarks)) {
    if (!validId(landmarkId) || !isRecord(value)) continue;
    out[landmarkId] = {
      missions: ids(value.missions),
      lessons: ids(value.lessons),
      quizzes: ids(value.quizzes),
      timelineWatched: value.timelineWatched === true,
    };
  }
  return out;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && validId(v)))];
}

function validId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID && /^[a-z0-9][a-z0-9-]*$/.test(id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
