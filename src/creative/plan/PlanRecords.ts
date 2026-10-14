import type { Vec3 } from '@/construction/PlacedObject';
import { parseConstructionPlan, planInput, type ConstructionPlan } from './ConstructionPlan';

/** Where one planned piece was generated (world metres), to tell later whether the child has moved it. */
export interface PlannedPiece {
  /** Layout key, e.g. "furn:bedroom#0:0" or "bench:1". */
  key: string;
  x: number;
  z: number;
  rotationY: number;
  /** The size it was generated at, when not 1 (a treehouse's tall tree): resizing means changing this. */
  scale?: Vec3;
}

/**
 * The plan behind one built version of a planned creation (one Creation
 * Group). Every follow-up ("make it wider") builds a NEW version with its
 * own group id, so undo/redo - which swaps placed objects back - always
 * finds the plan that matches what is standing.
 */
export interface PlanRecord {
  plan: ConstructionPlan;
  origin: Vec3;
  rotationY: number;
  /** Placed object id -> the piece it was generated as. */
  pieces: Record<string, PlannedPiece>;
  /** Content keys the child removed; later versions leave them out. */
  removedKeys: string[];
  /** When this version was built (ms since epoch). */
  builtAt: number;
  /** For a neighbourhood: the house the child is working on (0-based), so it stays picked through undo, redo and reloads. */
  focusHouse?: number;
}

/**
 * Keeps plan records between sessions - a third small slice next to
 * ProgressStorage and MyWorldStorage, with the same versioned, validated
 * localStorage pattern. Separate on purpose: My World's save format is
 * unchanged, and a broken record only loses that record.
 */
export interface PlanStore {
  load(): Record<string, PlanRecord>;
  save(records: Record<string, PlanRecord>): void;
  clear(): void;
}

export const PLAN_STORE_KEY = 'city-builder.plans';
const PLAN_STORE_VERSION = 1;

export class LocalPlanStore implements PlanStore {
  constructor(private readonly key: string = PLAN_STORE_KEY) {}

  load(): Record<string, PlanRecord> {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return {};
    }
    if (!raw) return {};
    try {
      return parsePlanRecords(JSON.parse(raw));
    } catch {
      console.warn('[plans] Saved plans are not valid JSON; starting without them');
      return {};
    }
  }

  save(records: Record<string, PlanRecord>): void {
    const file = {
      version: PLAN_STORE_VERSION,
      records: Object.fromEntries(Object.entries(records).map(([id, r]) => [id, { ...r, plan: planInput(r.plan) }])),
    };
    try {
      window.localStorage.setItem(this.key, JSON.stringify(file));
    } catch (error) {
      console.warn('[plans] Could not save plans', error);
    }
  }

  clear(): void {
    try {
      window.localStorage.removeItem(this.key);
    } catch (error) {
      console.warn('[plans] Could not clear saved plans', error);
    }
  }
}

/** Validate stored records one by one (storage is untrusted too); bad ones are dropped. */
export function parsePlanRecords(data: unknown): Record<string, PlanRecord> {
  const records: Record<string, PlanRecord> = {};
  if (!isRecord(data) || data.version !== PLAN_STORE_VERSION || !isRecord(data.records)) return records;
  for (const [groupId, value] of Object.entries(data.records)) {
    if (!isRecord(value)) continue;
    const plan = parseConstructionPlan(value.plan).plan;
    const origin = value.origin;
    if (!plan || !isRecord(origin) || !finite(origin.x) || !finite(origin.y) || !finite(origin.z) || !finite(value.rotationY)) continue;
    const pieces: Record<string, PlannedPiece> = {};
    if (isRecord(value.pieces)) {
      for (const [id, piece] of Object.entries(value.pieces)) {
        if (isRecord(piece) && typeof piece.key === 'string' && finite(piece.x) && finite(piece.z) && finite(piece.rotationY)) {
          const scale = isRecord(piece.scale) && finite(piece.scale.x) && finite(piece.scale.y) && finite(piece.scale.z) ? { x: piece.scale.x, y: piece.scale.y, z: piece.scale.z } : null;
          pieces[id] = { key: piece.key, x: piece.x, z: piece.z, rotationY: piece.rotationY, ...(scale ? { scale } : {}) };
        }
      }
    }
    records[groupId] = {
      plan,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      rotationY: value.rotationY,
      pieces,
      removedKeys: Array.isArray(value.removedKeys) ? value.removedKeys.filter((k): k is string => typeof k === 'string') : [],
      builtAt: finite(value.builtAt) ? value.builtAt : 0,
      ...(plan.kind === 'neighborhood' && Number.isInteger(value.focusHouse) && (value.focusHouse as number) >= 0 && (value.focusHouse as number) < plan.houses ? { focusHouse: value.focusHouse as number } : {}),
    };
  }
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
