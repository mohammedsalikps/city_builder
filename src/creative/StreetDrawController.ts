import * as THREE from 'three';
import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { GameState } from '@/state/GameState';
import type { World } from '@/world/World';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { ConstructionRaycaster } from '@/construction/ConstructionRaycaster';
import { computeBounds, boundsOfPlaced, boundsOverlap } from '@/construction/bounds';
import type { PlacementRulesContext } from '@/construction/PlacementResolver';
import type { TemplateObjectSpec } from './Template';
import type { GhostKit } from './Ghosts';

/** Road tiles are 4 m squares; streets are drawn on this lattice so they join up. */
const TILE = 4;
const MAX_TILES = 12;
const ROAD_ID = 'road_segment';
const SIDEWALK_ID = 'sidewalk_segment';
const SIDEWALK_OFFSET = 2.85;
/** A drag starting this close to an existing road tile continues that road. */
const JOIN_DISTANCE = 3.2;

interface StreetPlan {
  specs: TemplateObjectSpec[];
  /** Index of each spec's ghost, same order. */
  length: number;
}

/**
 * "Draw a Street": while `state.streetDrawing` is on, a press-drag-release
 * across the ground lays a straight street along the dominant drag axis -
 * road tiles with a sidewalk on each side - shown live as a ghost and then
 * built through `actions.instantiateTemplate` like every other creation.
 *
 * The camera's own drag is paused while drawing (the child's finger draws,
 * it does not orbit). Streets snap to a 4 m lattice and continue an
 * existing road when started on or next to one, so they visibly connect;
 * tiles that land on an existing road simply join it (the overlap skips
 * the duplicate), never block the drawing.
 */
export class StreetDrawController {
  private readonly group = new THREE.Group();
  private readonly raycaster: ConstructionRaycaster;
  private ghosts: THREE.Object3D[] = [];
  private origin: { x: number; z: number } | null = null;
  private plan: StreetPlan | null = null;
  private active = false;
  private pointerId: number | null = null;
  private readonly disposers: Array<() => void> = [];

  /** Called after a street is built, with its middle - lets Game.ts frame it. */
  onBuilt: ((center: { x: number; y: number; z: number }, radius: number) => void) | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly registry: ObjectRegistry,
    private readonly ghostKit: GhostKit,
    private readonly world: World,
    private readonly canvas: HTMLElement,
    private readonly placementRules: PlacementRulesContext,
  ) {
    this.group.name = 'streetGhost';
    this.world.overlayRoot.add(this.group);
    this.raycaster = new ConstructionRaycaster(world.camera);
  }

  /** True while the child is mid-drag. */
  get drawing(): boolean {
    return this.origin !== null;
  }

  start(): void {
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.disposers.push(this.store.subscribe((state) => this.onStateChanged(state)));
    window.addEventListener('keydown', this.onKey);
    this.onStateChanged(this.store.getState());
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKey);
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    this.clearGhosts();
    this.world.overlayRoot.remove(this.group);
  }

  private onStateChanged(state: GameState): void {
    const active = state.streetDrawing && state.mode === 'playing' && state.challenge === null;
    if (active === this.active) return;
    this.active = active;
    // The finger draws instead of orbiting while a street is being drawn.
    this.world.cameraController.setEnabled(state.mode === 'playing' && !active);
    if (!active) this.reset();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (this.active && event.code === 'Escape') {
      this.reset();
      this.actions.cancelStreetDrawing();
    }
  };

  private readonly onDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) return;
    const point = this.groundPoint(event);
    if (!point) return;
    this.pointerId = event.pointerId;
    this.origin = this.snapStart(point);
    this.updatePlan(this.origin);
    try {
      // Keep receiving the drag even if the finger leaves the canvas.
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; drawing still works without it.
    }
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.active || !this.origin || event.pointerId !== this.pointerId) return;
    const point = this.groundPoint(event);
    if (point) this.updatePlan(point);
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.active || !this.origin || event.pointerId !== this.pointerId) return;
    const point = this.groundPoint(event);
    if (point) this.updatePlan(point);
    const plan = this.plan;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Not captured - nothing to release.
    }
    this.reset();
    if (!plan) return;

    const result = this.actions.instantiateTemplate({ objects: plan.specs }, undefined, 0, 'street');
    this.actions.cancelStreetDrawing();
    const roads = this.store.getState().placedObjects.filter((p) => result.ids.includes(p.id) && p.definitionId === ROAD_ID);
    const focus = roads[Math.floor(roads.length / 2)] ?? roads[0];
    if (focus) {
      this.actions.focusCreation('street', focus.id, roads.length > 1 ? 'Your street' : 'Street');
      this.onBuilt?.({ x: focus.position.x, y: 0, z: focus.position.z }, roads.length * 2 + 4);
    }
  };

  private readonly onCancel = (): void => {
    this.reset();
  };

  private reset(): void {
    this.origin = null;
    this.plan = null;
    this.pointerId = null;
    this.clearGhosts();
  }

  private groundPoint(event: PointerEvent): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = {
      ndcX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ndcY: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
    const hit = this.raycaster.hitSurface(pointer, this.world.ground, []);
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  /** Continue a road the drag starts on/next to; otherwise start on the 4 m lattice. */
  private snapStart(point: { x: number; z: number }): { x: number; z: number } {
    let best: { x: number; z: number } | null = null;
    let bestDistance = JOIN_DISTANCE;
    for (const placed of this.store.getState().placedObjects) {
      const definition = this.registry.get(placed.definitionId);
      if (definition?.category !== 'roads' || definition.id === SIDEWALK_ID) continue;
      const distance = Math.hypot(placed.position.x - point.x, placed.position.z - point.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: placed.position.x, z: placed.position.z };
      }
    }
    return best ?? { x: Math.round(point.x / TILE) * TILE, z: Math.round(point.z / TILE) * TILE };
  }

  private updatePlan(end: { x: number; z: number }): void {
    if (!this.origin) return;
    const dx = end.x - this.origin.x;
    const dz = end.z - this.origin.z;
    const alongX = Math.abs(dx) >= Math.abs(dz);
    const distance = alongX ? dx : dz;
    const count = Math.min(MAX_TILES, Math.max(1, Math.round(Math.abs(distance) / TILE) + 1));
    const sign = distance < 0 ? -1 : 1;
    const key = `${alongX}:${sign}:${count}`;
    if (this.plan && this.group.userData.key === key) return;
    this.group.userData.key = key;

    const specs: TemplateObjectSpec[] = [];
    const roadRotation = alongX ? 0 : Math.PI / 2;
    for (let i = 0; i < count; i++) {
      const cx = this.origin.x + (alongX ? sign * TILE * i : 0);
      const cz = this.origin.z + (alongX ? 0 : sign * TILE * i);
      specs.push({ definitionId: ROAD_ID, position: { x: cx, y: 0, z: cz }, rotationY: roadRotation });
    }
    for (let i = 0; i < count; i++) {
      const cx = this.origin.x + (alongX ? sign * TILE * i : 0);
      const cz = this.origin.z + (alongX ? 0 : sign * TILE * i);
      for (const side of [-1, 1]) {
        specs.push({
          definitionId: SIDEWALK_ID,
          position: { x: cx + (alongX ? 0 : side * SIDEWALK_OFFSET), y: 0, z: cz + (alongX ? side * SIDEWALK_OFFSET : 0) },
          rotationY: roadRotation,
        });
      }
    }
    this.plan = { specs, length: specs.length };
    this.showGhosts(specs);
  }

  private showGhosts(specs: TemplateObjectSpec[]): void {
    this.clearGhosts();
    const placed = this.store.getState().placedObjects;
    for (const spec of specs) {
      const definition = this.registry.get(spec.definitionId);
      if (!definition) continue;
      const ghost = this.ghostKit.create(definition);
      ghost.position.set(spec.position.x, spec.position.y, spec.position.z);
      ghost.rotation.set(0, spec.rotationY ?? 0, 0);
      this.ghostKit.setValid(ghost, this.fits(spec, placed));
      this.group.add(ghost);
      this.ghosts.push(ghost);
    }
  }

  /** Landing on an existing road is joining it (fine); landing on anything else, or off the ground, won't build. */
  private fits(spec: TemplateObjectSpec, placed: GameState['placedObjects']): boolean {
    const definition = this.registry.get(spec.definitionId);
    if (!definition) return false;
    const bounds = computeBounds(definition, spec.position, spec.rotationY ?? 0, { x: 1, y: 1, z: 1 });
    const { center, halfSize } = this.placementRules.getBuildArea();
    if (
      bounds.minX < center.x - halfSize - 1e-6 ||
      bounds.maxX > center.x + halfSize + 1e-6 ||
      bounds.minZ < center.z - halfSize - 1e-6 ||
      bounds.maxZ > center.z + halfSize + 1e-6
    ) {
      return false;
    }
    for (const other of placed) {
      const otherDefinition = this.registry.get(other.definitionId);
      if (!otherDefinition) continue;
      if (!boundsOverlap(bounds, boundsOfPlaced(otherDefinition, other))) continue;
      if (otherDefinition.category !== 'roads') return false;
    }
    return true;
  }

  private clearGhosts(): void {
    for (const ghost of this.ghosts) {
      this.ghostKit.discard(ghost);
      this.group.remove(ghost);
    }
    this.ghosts = [];
    delete this.group.userData.key;
  }
}
