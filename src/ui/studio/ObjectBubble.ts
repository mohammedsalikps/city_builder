import { el, type ScreenContext } from '../Screen';
import type { GameState } from '@/state/GameState';
import type { PlacedObject } from '@/construction/PlacedObject';
import { roleOf, type ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import { transformCapabilitiesOf } from '@/construction/TransformCapabilities';
import type { ImprovementAction, ImprovementKind } from '@/creative/Studio';
import { creationCardText } from '@/creative/plan/PlanLayouts';
import { PAINT_COLOURS } from '@/creative/colours';
import { icon } from './icons';
import { actionButton } from './dom';

const KIND_ICONS: Record<ImprovementKind, string> = {
  home: 'home',
  street: 'road',
  nature: 'tree',
  vehicle: 'car',
  furniture: 'sofa',
  decor: 'lamp',
};

const MARGIN = 12;
const TOP_SAFE = 96;
const BOTTOM_SAFE = 150;
const DOCK_MARGIN = 18;
/** Half the Build Orb's width plus breathing room. */
const ORB_CLEARANCE = 64;

/**
 * The bubble that floats above whatever the child taps: its name, then
 * big friendly actions - Move, Turn, Size (only where it makes sense),
 * Make it yours, Copy, Remove. "Make it yours" unfolds contextual creative
 * shortcuts for that kind of thing (a house gets Garden / Driveway / Car /
 * Window..., a street gets Trees / Lights / Shops...). Every button calls
 * an existing action; the gizmo underneath is still TransformControls.
 */
export class ObjectBubble {
  readonly root: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly turnButton: HTMLButtonElement;
  private readonly sizeButton: HTMLButtonElement;
  private readonly improveButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly enterButton: HTMLButtonElement;
  private readonly colourButton: HTMLButtonElement;
  private readonly swatches: HTMLElement;
  private colourOpen = false;
  private readonly sizer: HTMLElement;
  private readonly smaller: HTMLButtonElement;
  private readonly bigger: HTMLButtonElement;
  private readonly improvePanel: HTMLElement;
  private readonly improveTitle: HTMLElement;
  private readonly improveRow: HTMLElement;
  private selectedId: string | null = null;
  private improveOpen = false;
  private announcedFocus: string | null = null;
  private improveKey = '';
  private visible = false;
  private size = { width: 0, height: 0 };
  private lastPosition = '';

  constructor(
    private readonly context: ScreenContext,
    private readonly toast: (text: string) => void,
  ) {
    this.root = el('div', 'st-bubble');
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());

    const head = el('div', 'st-bubble__head');
    this.icon = el('span', 'st-bubble__icon');
    this.title = el('strong', 'st-bubble__title');
    this.subtitle = el('span', 'st-bubble__subtitle');
    const titles = el('div', 'st-bubble__titles');
    titles.append(this.title, this.subtitle);
    const close = el('button', 'st-round st-round--tiny');
    close.type = 'button';
    close.setAttribute('aria-label', 'Done');
    close.appendChild(icon('close'));
    close.addEventListener('click', () => this.context.actions.selectPlacedObject(null));
    head.append(this.icon, titles, close);

    const actions = el('div', 'st-bubble__actions');
    const set = (mode: 'move' | 'rotate' | 'scale') => () => this.context.actions.setTransformMode(mode);
    this.moveButton = actionButton('move', 'Move', set('move'));
    this.turnButton = actionButton('turn', 'Turn', set('rotate'));
    this.sizeButton = actionButton('size', 'Size', set('scale'));
    this.improveButton = actionButton('sparkle', 'Make it yours', () => this.toggleImprove(), 'st-action--magic');
    this.copyButton = actionButton('copy', 'Copy', () => {
      const status = this.context.actions.duplicateSelectedPlacedObject();
      if (!status || !status.valid) this.toast('No room for a copy right here');
    });
    this.removeButton = actionButton('remove', 'Remove', () => this.context.actions.removeSelectedPlacedObject(), 'st-action--danger');
    // Interior Explorer: go inside the planned house this piece belongs to.
    this.enterButton = actionButton('door', 'Enter house', () => {
      const result = this.context.studio.interior.enter();
      if (!result.ok) this.toast(result.message);
    }, 'st-action--magic');
    this.colourButton = actionButton('pencil', 'Colour', () => {
      this.colourOpen = !this.colourOpen;
      this.colourButton.classList.toggle('st-action--on', this.colourOpen);
      this.swatches.hidden = !this.colourOpen;
    });
    actions.append(this.enterButton, this.moveButton, this.turnButton, this.sizeButton, this.colourButton, this.improveButton, this.copyButton, this.removeButton);

    // A small fixed palette, plus "as it was".
    this.swatches = el('div', 'st-bubble__swatches');
    this.swatches.hidden = true;
    this.swatches.setAttribute('role', 'group');
    this.swatches.setAttribute('aria-label', 'Paint colour');
    for (const colour of PAINT_COLOURS) {
      const swatch = el('button', 'st-swatch');
      swatch.type = 'button';
      swatch.style.background = colour.hex;
      swatch.title = colour.name;
      swatch.setAttribute('aria-label', `Paint it ${colour.name}`);
      swatch.addEventListener('click', () => {
        if (!this.context.actions.recolorSelectedPlacedObject(colour.hex)) this.toast(`It's already ${colour.name}`);
      });
      this.swatches.appendChild(swatch);
    }
    const original = el('button', 'st-swatch st-swatch--reset', 'As it was');
    original.type = 'button';
    original.addEventListener('click', () => void this.context.actions.recolorSelectedPlacedObject(null));
    this.swatches.appendChild(original);

    this.sizer = el('div', 'st-bubble__sizer');
    this.smaller = el('button', 'st-round st-round--small');
    this.smaller.type = 'button';
    this.smaller.setAttribute('aria-label', 'Smaller');
    this.smaller.appendChild(icon('minus'));
    this.smaller.addEventListener('click', () => this.context.actions.scaleSelectedPlacedObject(-1));
    this.bigger = el('button', 'st-round st-round--small');
    this.bigger.type = 'button';
    this.bigger.setAttribute('aria-label', 'Bigger');
    this.bigger.appendChild(icon('plus'));
    this.bigger.addEventListener('click', () => this.context.actions.scaleSelectedPlacedObject(1));
    this.sizer.append(this.smaller, el('span', '', 'Size'), this.bigger);

    this.improvePanel = el('div', 'st-bubble__improve');
    this.improveTitle = el('div', 'st-bubble__improve-title');
    this.improveRow = el('div', 'st-bubble__improve-row');
    this.improvePanel.append(this.improveTitle, this.improveRow);

    this.root.append(head, actions, this.sizer, this.swatches, this.improvePanel);
  }

  update(state: GameState, suppressed: boolean): void {
    const selected = !suppressed && state.selectedInstanceId
      ? state.placedObjects.find((p) => p.id === state.selectedInstanceId) ?? null
      : null;
    const definition = selected ? this.context.registry.get(selected.definitionId) : undefined;
    if (!selected || !definition) {
      this.hide();
      return;
    }
    if (selected.id !== this.selectedId) {
      this.selectedId = selected.id;
      this.improveOpen = false;
      this.colourOpen = false;
    }
    // Something the child just created opens straight onto "Make it yours" - once.
    const focusId = state.creationFocus?.instanceId ?? null;
    if (focusId !== this.announcedFocus) {
      this.announcedFocus = focusId;
      if (focusId === selected.id) this.improveOpen = true;
    }

    const catalog = this.context.studio.catalog;
    // A fresh creation is described as the whole thing the child made
    // ("Little Park"), with that creation's own "Make it yours" set.
    const focus = state.creationFocus?.instanceId === selected.id ? state.creationFocus : null;
    const kind = (focus && catalog.creation(focus.creationId)?.improve) || catalog.improvementKindOf(definition);
    this.icon.replaceChildren(icon(KIND_ICONS[kind]));
    this.icon.className = `st-bubble__icon st-kind--${kind}`;
    this.title.textContent = focus?.label ?? catalog.friendlyKindName(definition);
    // A piece of something bigger says so: "Part of your house · 9 pieces".
    // A planned creation is named by what it really is (a treehouse shares
    // the "park" group, but it is not a park).
    const group = selected.group ? state.placedObjects.filter((p) => p.group?.id === selected.group!.id).length : 0;
    const planned = selected.group ? this.context.studio.plannedCreation(selected.group.id) : null;
    const card = planned ? creationCardText(planned.kind, group) : null;
    const groupName = selected.group ? catalog.creation(selected.group.creation)?.name.toLowerCase() ?? 'creation' : '';
    // One house of a neighbourhood says which one ("House 2 of your neighbourhood").
    const house = planned?.kind === 'neighborhood' ? this.context.studio.houseOf(selected.id) : null;
    const subtitle = house !== null ? `House ${house + 1} of your neighbourhood · ${group} pieces` : card?.subtitle;
    this.subtitle.textContent = group > 1 ? subtitle ?? `Part of your ${groupName} · ${group} pieces` : '';
    this.subtitle.hidden = group <= 1;

    const hostsOpenings = state.placedObjects.some((p) => p.hostId === selected.id);
    const caps = transformCapabilitiesOf(definition, 'freeplay', hostsOpenings);
    this.moveButton.hidden = !caps.movable;
    this.turnButton.hidden = !caps.rotatableY;
    this.sizeButton.hidden = !caps.scalable;
    this.moveButton.classList.toggle('st-action--on', state.transformMode === 'move');
    this.turnButton.classList.toggle('st-action--on', state.transformMode === 'rotate');
    this.sizeButton.classList.toggle('st-action--on', state.transformMode === 'scale');
    this.copyButton.hidden = roleOf(definition) === 'opening';
    // Furniture and decorations can be painted; walls, floors, roofs, doors and windows keep their look.
    this.colourButton.hidden = roleOf(definition) !== null;
    this.colourButton.classList.toggle('st-action--on', this.colourOpen);
    this.swatches.hidden = !this.colourOpen || roleOf(definition) !== null;
    this.enterButton.hidden = state.interior !== null || (planned?.kind !== 'house' && planned?.kind !== 'neighborhood');
    this.sizer.hidden = !(caps.scalable && state.transformMode === 'scale');
    this.smaller.disabled = selected.scale.x <= caps.minScale + 1e-6;
    this.bigger.disabled = selected.scale.x >= caps.maxScale - 1e-6;

    const actions = this.improvementsFor(kind, definition);
    this.improveButton.hidden = actions.length === 0;
    this.improveButton.classList.toggle('st-action--on', this.improveOpen);
    this.improvePanel.hidden = !this.improveOpen || actions.length === 0;
    const key = `${selected.id}:${kind}:${planned?.kind ?? ''}:${actions.map((a) => a.id).join(',')}`;
    if (key !== this.improveKey) {
      this.improveKey = key;
      this.improveTitle.textContent = card?.improveTitle ?? catalog.improvements(kind).title;
      this.improveRow.replaceChildren(
        ...actions.map((action) =>
          actionButton(action.icon, action.name, () => this.run(action), 'st-action--tile'),
        ),
      );
    }

    if (!this.visible) {
      this.visible = true;
      this.root.hidden = false;
      this.root.classList.add('st-bubble--enter');
      requestAnimationFrame(() => this.root.classList.remove('st-bubble--enter'));
    }
    this.measure();
  }

  /**
   * Follow the selected object on screen: above it when there is room,
   * otherwise beside it (never on top of what the child is looking at),
   * otherwise docked above the Build Orb.
   */
  frame(): void {
    if (!this.visible || !this.selectedId) return;
    const point = this.context.studio.projectInstance(this.selectedId);
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const { width, height } = this.size;
    const maxY = viewportH - height - BOTTOM_SAFE;
    // Docked: the bottom-right corner, clear of the centred creation - and
    // lifted above the Build Orb if the bubble is wide enough to reach it.
    let x = viewportW - width - DOCK_MARGIN;
    let y = x < viewportW / 2 + ORB_CLEARANCE ? maxY : viewportH - height - DOCK_MARGIN;
    let side: 'above' | 'right' | 'left' | 'docked' = 'docked';
    if (point && point.onScreen) {
      const gap = 22;
      const aboveY = point.y - height - gap;
      const besideY = clamp(point.centerY - height / 2, TOP_SAFE, maxY);
      if (aboveY >= TOP_SAFE) {
        side = 'above';
        x = clamp(point.x - width / 2, MARGIN, viewportW - width - MARGIN);
        y = Math.min(aboveY, maxY);
      } else if (point.x + point.radius + gap + width <= viewportW - MARGIN) {
        side = 'right';
        x = point.x + point.radius + gap;
        y = besideY;
      } else if (point.x - point.radius - gap - width >= MARGIN) {
        side = 'left';
        x = point.x - point.radius - gap - width;
        y = besideY;
      }
    }
    const position = `${Math.round(x)},${Math.round(y)},${side}`;
    if (position === this.lastPosition) return;
    this.lastPosition = position;
    this.root.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    if (this.root.dataset.side !== side) this.root.dataset.side = side;
    if (point && (side === 'right' || side === 'left')) {
      this.root.style.setProperty('--arrow-y', `${clamp(point.centerY - y, 28, height - 28)}px`);
    }
  }

  dispose(): void {
    this.hide();
  }

  private hide(): void {
    if (!this.visible && this.selectedId === null) return;
    this.visible = false;
    this.selectedId = null;
    this.improveOpen = false;
    this.lastPosition = '';
    this.root.hidden = true;
  }

  private measure(): void {
    this.size = { width: this.root.offsetWidth, height: this.root.offsetHeight };
    this.lastPosition = '';
    this.frame();
  }

  private toggleImprove(): void {
    this.improveOpen = !this.improveOpen;
    this.improvePanel.hidden = !this.improveOpen;
    this.improveButton.classList.toggle('st-action--on', this.improveOpen);
    this.measure();
  }

  /** Shortcuts that make sense for this exact object: window/door/furnish only for hand-built homes. */
  private improvementsFor(kind: ImprovementKind, definition: ConstructionObjectDefinition): ImprovementAction[] {
    const handBuilt = roleOf(definition) !== null;
    return this.context.studio.catalog
      .improvements(kind)
      .actions.filter((action) => action.needs !== 'walls' || handBuilt);
  }

  private run(action: ImprovementAction): void {
    const state = this.latestSelected();
    if (!state) return;
    const { placed, definition } = state;
    const actions = this.context.actions;
    if (action.type === 'place') {
      actions.selectObject(action.definitionId);
      return;
    }
    if (action.type === 'street') {
      actions.startStreetDrawing();
      return;
    }
    const footprint = Math.max(definition.dimensions.width * placed.scale.x, definition.dimensions.depth * placed.scale.z) / 2;
    let added = 0;
    for (const item of action.items) {
      const itemDefinition = this.context.registry.get(item);
      if (!itemDefinition) continue;
      // A car would rather park on a nearby driveway or road than on the grass.
      if (itemDefinition.category === 'vehicles' && this.parkNearby(item, placed, footprint + 8)) {
        added++;
        continue;
      }
      const itemRadius = Math.max(itemDefinition.dimensions.width, itemDefinition.dimensions.depth) / 2;
      const result = actions.placeNearby(item, anchorOf(placed), {
        anchorRotationY: placed.rotationY,
        minRadius: footprint + itemRadius + 0.4,
      });
      if (result) added++;
    }
    this.toast(added > 0 ? `${action.name} added!` : 'No room nearby - try moving it first');
  }

  private parkNearby(definitionId: string, anchor: PlacedObject, radius: number): boolean {
    const objects = this.context.studio.allPlaced();
    const occupied = new Set(objects.map((p) => p.supportId).filter((id): id is string => id !== null));
    const spots = objects
      .filter((p) => {
        const definition = this.context.registry.get(p.definitionId);
        return definition?.category === 'roads' && definition.type !== 'sidewalk' && !occupied.has(p.id);
      })
      .map((p) => ({ p, distance: Math.hypot(p.position.x - anchor.position.x, p.position.z - anchor.position.z) }))
      .filter((spot) => spot.distance <= radius || spot.p.id === anchor.id)
      .sort((a, b) => a.distance - b.distance);
    for (const { p } of spots) {
      if (this.context.actions.placeOnTop(definitionId, p.id, p.rotationY + Math.PI / 2)) return true;
    }
    return false;
  }

  private latestSelected(): { placed: PlacedObject; definition: ConstructionObjectDefinition } | null {
    if (!this.selectedId) return null;
    // Actions read state themselves; this only needs the anchor's own data.
    const placed = this.context.studio.findPlaced(this.selectedId);
    const definition = placed ? this.context.registry.get(placed.definitionId) : undefined;
    return placed && definition ? { placed, definition } : null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function anchorOf(placed: PlacedObject): { x: number; y: number; z: number } {
  return { x: placed.position.x, y: 0, z: placed.position.z };
}
