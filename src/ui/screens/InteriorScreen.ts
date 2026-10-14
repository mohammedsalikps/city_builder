import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
import { worldToHouse, type InteriorHouse, type InteriorRoom } from '@/creative/interior';
import type { RoomType } from '@/creative/plan/ConstructionPlan';
import type { InteriorSnapshot } from '@/game/InteriorExplorer';
import { VirtualJoystick } from '../interior/VirtualJoystick';
import { icon } from '../studio/icons';
import '../interior/interior.css';
import { blocksEscape, focusIfPresent, interiorBackStep } from '../keyboard';

const ROOM_ICON: Record<RoomType, string> = { living: 'sofa', kitchen: 'table', bedroom: 'bed', bathroom: 'wave' };

/** Furniture the room palette offers (catalogue ids), with the rooms each one suits best. */
const FURNITURE: Array<{ id: string; label: string; icon: string; rooms: RoomType[] }> = [
  { id: 'furniture_bed', label: 'Bed', icon: 'bed', rooms: ['bedroom'] },
  { id: 'furniture_wardrobe', label: 'Wardrobe', icon: 'door', rooms: ['bedroom'] },
  { id: 'furniture_sofa', label: 'Sofa', icon: 'sofa', rooms: ['living'] },
  { id: 'furniture_table', label: 'Table', icon: 'table', rooms: ['living', 'kitchen'] },
  { id: 'furniture_chair', label: 'Chair', icon: 'chair', rooms: ['living', 'kitchen', 'bedroom'] },
  { id: 'kitchen_counter', label: 'Kitchen counter', icon: 'table', rooms: ['kitchen'] },
  { id: 'bath_tub', label: 'Bathtub', icon: 'wave', rooms: ['bathroom'] },
  { id: 'bath_toilet', label: 'Toilet', icon: 'wave', rooms: ['bathroom'] },
  { id: 'bath_basin', label: 'Washbasin', icon: 'wave', rooms: ['bathroom'] },
  { id: 'decor_potted_plant', label: 'Plant', icon: 'leaf', rooms: ['living', 'bedroom', 'kitchen', 'bathroom'] },
];

/** Mini floor plan size (SVG user units), front of the house at the bottom. */
const PLAN_SIZE = 168;

/**
 * Interior Explorer's screen, shown over World Studio while the child is
 * inside a house: a room navigator made from the house's real plan (only
 * rooms that exist), a mini floor plan with "you are here", walk / dollhouse,
 * a guided tour, the way back outside, touch walking, a furniture palette
 * for the room, and the yes/no bar for changes that are shown first.
 */
export class InteriorScreen extends Screen {
  readonly id = 'interior';

  private titleLabel!: HTMLElement;
  private floorLabel!: HTMLElement;
  private roomList!: HTMLElement;
  private plan!: SVGSVGElement;
  private walker!: SVGGElement;
  private walkButton!: HTMLButtonElement;
  private dollButton!: HTMLButtonElement;
  private tourButton!: HTMLButtonElement;
  private hint!: HTMLElement;
  private companion!: HTMLElement;
  private palette!: HTMLElement;
  private paletteButton!: HTMLButtonElement;
  private proposalBar!: HTMLElement;
  private proposalText!: HTMLElement;
  private toast!: HTMLElement;
  private joystick: VirtualJoystick | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private houseKey = '';
  private roomKey = '';
  private paletteKey = '';
  private lastRoomId: string | null = null;
  private furnitureList!: HTMLElement;
  private furnitureKey = '';
  private latestState: GameState | null = null;
  /** A change started from this screen's own buttons: move keyboard focus to its yes / no. */
  private focusProposal = false;
  /** Where focus goes back to once that change is answered. */
  private proposalReturnFocus: HTMLElement | null = null;
  private readonly disposers: Array<() => void> = [];

  protected build(): HTMLElement {
    const root = el('div', 'screen studio interior');
    const explorer = this.context.studio.interior;

    // ---------------------------------------------------------- navigator
    const nav = el('section', 'in-nav');
    nav.setAttribute('aria-label', 'Rooms in this house');
    const head = el('div', 'in-nav__head');
    head.appendChild(icon('home', 'st-icon in-nav__icon'));
    const titles = el('div', 'in-nav__titles');
    this.titleLabel = el('strong', 'in-nav__title', 'Your house');
    this.floorLabel = el('span', 'in-nav__floor', 'Ground floor');
    titles.append(this.titleLabel, this.floorLabel);
    head.appendChild(titles);
    nav.appendChild(head);
    this.roomList = el('div', 'in-nav__rooms');
    this.roomList.setAttribute('role', 'list');
    nav.appendChild(this.roomList);
    this.plan = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.plan.classList.add('in-plan');
    this.plan.setAttribute('viewBox', `0 0 ${PLAN_SIZE} ${PLAN_SIZE}`);
    this.plan.setAttribute('role', 'img');
    this.plan.setAttribute('aria-label', 'Floor plan: tap a room to go there');
    nav.appendChild(this.plan);
    this.walker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.walker.classList.add('in-plan__walker');
    nav.appendChild(el('p', 'in-nav__note', 'Rooms come from your house plan. Front door at the bottom.'));
    // Below the plan, so the rooms and the plan stay where they always were.
    // Furniture in the room as a list: choose a piece without aiming at it in 3D (keyboard and screen readers too).
    nav.appendChild(el('div', 'in-nav__subhead', 'In this room'));
    this.furnitureList = el('div', 'in-furniture');
    this.furnitureList.setAttribute('role', 'list');
    this.furnitureList.setAttribute('aria-label', 'Furniture in this room');
    nav.appendChild(this.furnitureList);
    root.appendChild(nav);

    // ---------------------------------------------------------- controls
    const controls = el('div', 'in-controls');
    const views = el('div', 'in-views');
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'How to look around');
    this.walkButton = this.toggle('eye', 'Walk', () => explorer.setView('walk'));
    this.dollButton = this.toggle('home', 'Dollhouse', () => explorer.setView('dollhouse'));
    views.append(this.walkButton, this.dollButton);
    this.tourButton = el('button', 'in-btn');
    this.tourButton.type = 'button';
    this.tourButton.addEventListener('click', () => {
      if (explorer.snapshotState()?.touring) explorer.stopTour();
      else void explorer.startTour();
    });
    const outside = el('button', 'in-btn in-btn--strong');
    outside.type = 'button';
    outside.append(icon('back'), el('span', '', 'Go outside'));
    outside.addEventListener('click', () => explorer.exit());
    controls.append(views, this.tourButton, outside);
    root.appendChild(controls);

    // ---------------------------------------------------------- companion line + hint
    this.companion = el('div', 'in-companion');
    this.companion.setAttribute('aria-live', 'polite');
    root.appendChild(this.companion);
    this.hint = el('div', 'in-hint');
    root.appendChild(this.hint);

    // ---------------------------------------------------------- furniture palette
    const furnish = el('div', 'in-furnish');
    this.paletteButton = el('button', 'in-btn in-btn--violet');
    this.paletteButton.type = 'button';
    this.paletteButton.setAttribute('aria-expanded', 'false');
    this.paletteButton.append(icon('plus'), el('span', '', 'Add furniture'));
    this.paletteButton.addEventListener('click', () => this.setPaletteOpen(this.palette.hidden === true));
    this.palette = el('div', 'in-palette');
    this.palette.hidden = true;
    this.palette.setAttribute('role', 'menu');
    furnish.append(this.palette, this.paletteButton);
    root.appendChild(furnish);

    // ---------------------------------------------------------- yes / no
    this.proposalBar = el('div', 'in-proposal');
    this.proposalBar.hidden = true;
    this.proposalBar.setAttribute('role', 'alertdialog');
    this.proposalBar.setAttribute('aria-label', 'Change waiting for your answer');
    this.proposalText = el('div', 'in-proposal__text');
    const yes = el('button', 'in-btn in-btn--strong');
    yes.type = 'button';
    yes.append(icon('check'), el('span', '', 'Yes, do it'));
    yes.addEventListener('click', () => {
      this.showResult(explorer.confirmProposal().message);
      this.returnFocusAfterProposal();
    });
    const no = el('button', 'in-btn');
    no.type = 'button';
    no.append(icon('close'), el('span', '', 'No thanks'));
    no.addEventListener('click', () => {
      explorer.cancelProposal();
      this.showResult('Okay, nothing changed.');
      this.returnFocusAfterProposal();
    });
    this.proposalBar.append(this.proposalText, yes, no);
    root.appendChild(this.proposalBar);

    this.toast = el('div', 'in-toast');
    this.toast.hidden = true;
    this.toast.setAttribute('role', 'status');
    root.appendChild(this.toast);

    // Touch walking: a thumb-stick on touch screens; keyboard hint elsewhere.
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (touch) {
      const pad = el('div', 'in-joystick');
      root.appendChild(pad);
      this.joystick = new VirtualJoystick(pad, (x, y) => explorer.setMove(x, y), { label: 'Walk: drag to move around the house' });
    }
    this.hint.textContent = touch ? 'Drag the screen to look around. Use the stick to walk.' : 'Walk with W A S D or the arrow keys. Drag to look around.';

    this.disposers.push(explorer.onChange(() => this.render()));
    // Capture phase: Escape is decided here before the builder's own Escape sees it (one press, one step back).
    window.addEventListener('keydown', this.onKeyDown, true);
    this.disposers.push(() => window.removeEventListener('keydown', this.onKeyDown, true));
    return root;
  }

  update(state: GameState): void {
    this.latestState = state;
    this.render();
  }

  frame(): void {
    const snapshot = this.context.studio.interior.snapshotState();
    if (snapshot?.walker) this.placeWalker(snapshot);
  }

  protected onUnmount(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    this.joystick?.dispose();
    this.joystick = null;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.houseKey = '';
    this.roomKey = '';
    this.paletteKey = '';
    this.furnitureKey = '';
    this.lastRoomId = null;
  }

  // ------------------------------------------------------------ rendering

  private render(): void {
    if (!this.root) return;
    const explorer = this.context.studio.interior;
    const notice = explorer.takeNotice();
    if (notice) this.showResult(notice);
    const snapshot = explorer.snapshotState();
    if (!snapshot) return;
    const { house, view, roomId, touring, proposal } = snapshot;

    const houseKey = `${house.groupId}:${house.houseIndex}:${house.rooms.map((r) => r.id).join(',')}`;
    if (houseKey !== this.houseKey) {
      this.houseKey = houseKey;
      this.titleLabel.textContent = house.name;
      this.floorLabel.textContent = house.floors.map((f) => f.name).join(' · ');
      this.drawPlan(snapshot);
      this.roomKey = '';
    }
    const roomKey = `${roomId}`;
    if (roomKey !== this.roomKey) {
      this.roomKey = roomKey;
      this.renderRooms(house, roomId);
      this.highlightPlanRoom(roomId);
    }
    this.walkButton.setAttribute('aria-pressed', String(view === 'walk'));
    this.dollButton.setAttribute('aria-pressed', String(view === 'dollhouse'));
    this.tourButton.replaceChildren(icon(touring ? 'stop' : 'star'), el('span', '', touring ? 'Stop tour' : 'Guided tour'));
    this.hint.hidden = view !== 'walk';
    this.joystick?.setVisible(view === 'walk');
    this.walker.style.display = view === 'walk' ? '' : 'none';

    const room = roomId ? house.rooms.find((r) => r.id === roomId) ?? null : null;
    this.renderPalette(room);
    this.renderFurniture(room);
    this.proposalBar.hidden = proposal === null;
    if (proposal) this.proposalText.textContent = `${proposal.title}?`;
    if (proposal && this.focusProposal) {
      this.focusProposal = false;
      focusIfPresent(this.proposalBar.querySelector('button'));
    }

    // EAVARA's line follows what is really happening (never ahead of it).
    if (room?.id !== this.lastRoomId) {
      this.lastRoomId = room?.id ?? null;
      this.companion.textContent = room
        ? `You're in the ${room.name.toLowerCase()}. Would you like to add furniture or change the colours? Tap a piece to change it.`
        : `Welcome inside ${house.houseIndex === null ? 'your house' : house.name}! Which room would you like to explore?`;
    }
  }

  private renderRooms(house: InteriorHouse, currentId: string | null): void {
    const explorer = this.context.studio.interior;
    const floors = house.floors.length > 0 ? house.floors : [{ index: 0, name: 'Ground floor', roomIds: house.rooms.map((r) => r.id) }];
    const children: HTMLElement[] = [];
    for (const floor of floors) {
      if (floors.length > 1) children.push(el('div', 'in-nav__floor-title', floor.name));
      for (const id of floor.roomIds) {
        const room = house.rooms.find((r) => r.id === id);
        if (!room) continue;
        const button = el('button', 'in-room');
        button.type = 'button';
        button.setAttribute('role', 'listitem');
        if (room.id === currentId) button.setAttribute('aria-current', 'true');
        button.append(icon(ROOM_ICON[room.type] ?? 'home'), el('span', '', room.name));
        button.addEventListener('click', () => void explorer.goToRoom(room.id));
        children.push(button);
      }
    }
    this.roomList.replaceChildren(...children);
  }

  /** The house's rooms in its own frame: front door at the bottom, scaled to fit. */
  private drawPlan(snapshot: InteriorSnapshot): void {
    const { house, model } = snapshot;
    const svg = 'http://www.w3.org/2000/svg';
    const corners = (rect: InteriorRoom['rect']) =>
      [
        worldToHouse(house, { x: rect.minX, z: rect.minZ }),
        worldToHouse(house, { x: rect.maxX, z: rect.maxZ }),
      ];
    const outline = corners(house.footprint);
    const minX = Math.min(outline[0].x, outline[1].x);
    const maxX = Math.max(outline[0].x, outline[1].x);
    const minZ = Math.min(outline[0].z, outline[1].z);
    const maxZ = Math.max(outline[0].z, outline[1].z);
    const pad = 8;
    const scale = (PLAN_SIZE - pad * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    const ox = (PLAN_SIZE - (maxX - minX) * scale) / 2;
    const oz = (PLAN_SIZE - (maxZ - minZ) * scale) / 2;
    // House-local +Z (front) is drawn at the bottom of the plan.
    const toPlan = (p: { x: number; z: number }) => ({ x: ox + (p.x - minX) * scale, y: oz + (p.z - minZ) * scale });
    this.planTransform = (world) => toPlan(worldToHouse(house, world));

    const nodes: SVGElement[] = [];
    const shell = document.createElementNS(svg, 'rect');
    const a = toPlan({ x: minX, z: minZ });
    shell.setAttribute('x', String(a.x));
    shell.setAttribute('y', String(a.y));
    shell.setAttribute('width', String((maxX - minX) * scale));
    shell.setAttribute('height', String((maxZ - minZ) * scale));
    shell.classList.add('in-plan__shell');
    nodes.push(shell);
    for (const room of house.rooms) {
      const [p, q] = corners(room.rect);
      const tl = toPlan({ x: Math.min(p.x, q.x), z: Math.min(p.z, q.z) });
      const rect = document.createElementNS(svg, 'rect');
      rect.setAttribute('x', String(tl.x));
      rect.setAttribute('y', String(tl.y));
      rect.setAttribute('width', String(Math.abs(q.x - p.x) * scale));
      rect.setAttribute('height', String(Math.abs(q.z - p.z) * scale));
      rect.setAttribute('rx', '3');
      rect.classList.add('in-plan__room');
      rect.dataset.room = room.id;
      rect.addEventListener('click', () => void this.context.studio.interior.goToRoom(room.id));
      const title = document.createElementNS(svg, 'title');
      title.textContent = room.name;
      rect.appendChild(title);
      nodes.push(rect);
      const label = document.createElementNS(svg, 'text');
      const centre = toPlan(worldToHouse(house, room.center));
      label.setAttribute('x', String(centre.x));
      label.setAttribute('y', String(centre.y + 3));
      label.classList.add('in-plan__label');
      label.textContent = room.name.length > 11 ? room.name.replace('room', '').trim() : room.name;
      nodes.push(label);
    }
    for (const door of model.doors) {
      const p = toPlan(worldToHouse(house, door));
      const dot = document.createElementNS(svg, 'circle');
      dot.setAttribute('cx', String(p.x));
      dot.setAttribute('cy', String(p.y));
      dot.setAttribute('r', door.sides.includes('outside') ? '3.2' : '2.2');
      dot.classList.add(door.sides.includes('outside') ? 'in-plan__front' : 'in-plan__door');
      nodes.push(dot);
    }
    // You-are-here: a dot with a nose pointing where you look.
    this.walker.replaceChildren();
    const body = document.createElementNS(svg, 'circle');
    body.setAttribute('r', '4.2');
    const nose = document.createElementNS(svg, 'path');
    nose.setAttribute('d', 'M0,-9 L3.6,-3 L-3.6,-3 Z');
    this.walker.append(nose, body);
    nodes.push(this.walker);
    this.plan.replaceChildren(...nodes);
  }

  private planTransform: ((world: { x: number; z: number }) => { x: number; y: number }) | null = null;

  private placeWalker(snapshot: InteriorSnapshot): void {
    if (!this.planTransform || !snapshot.walker) return;
    const p = this.planTransform(snapshot.walker);
    // World yaw -> plan angle: the plan is the house frame, so subtract the house turn.
    const degrees = (-(snapshot.walker.yaw - snapshot.house.rotationY) * 180) / Math.PI;
    this.walker.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${degrees.toFixed(1)})`);
  }

  private highlightPlanRoom(roomId: string | null): void {
    this.plan.querySelectorAll<SVGRectElement>('.in-plan__room').forEach((rect) => {
      rect.classList.toggle('in-plan__room--here', rect.dataset.room === roomId);
    });
  }

  private renderPalette(room: InteriorRoom | null): void {
    const key = room?.type ?? '';
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    // Pieces that suit this room first, then the rest.
    const sorted = [...FURNITURE].sort((a, b) => Number(!room || !a.rooms.includes(room.type)) - Number(!room || !b.rooms.includes(room.type)));
    this.palette.replaceChildren(
      el('div', 'in-palette__title', room ? `Add to the ${room.name.toLowerCase()}` : 'Add furniture'),
      ...sorted.map((item) => {
        const chip = el('button', 'in-chip');
        chip.type = 'button';
        chip.setAttribute('role', 'menuitem');
        if (room && item.rooms.includes(room.type)) chip.classList.add('in-chip--suits');
        chip.append(icon(item.icon), el('span', '', item.label));
        chip.addEventListener('click', () => {
          this.setPaletteOpen(false);
          this.focusProposal = true;
          this.proposalReturnFocus = this.paletteButton;
          const result = this.context.studio.interior.proposeAdd(item.id, room ? { roomId: room.id } : {});
          this.showResult(result.message);
        });
        return chip;
      }),
    );
  }

  /**
   * The furniture already in the room, each with "choose" (the piece's card
   * opens: turn, size, colour, copy, remove) and "move to" (shown first,
   * done on yes, like every other change).
   */
  private renderFurniture(room: InteriorRoom | null): void {
    const explorer = this.context.studio.interior;
    const pieces = room ? explorer.objectsIn(room) : [];
    const key = `${room?.id ?? ''}:${pieces.map((p) => `${p.id}/${p.definitionId}`).join(',')}`;
    if (key !== this.furnitureKey) {
      this.furnitureKey = key;
      const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-object-id]')?.dataset.objectId ?? null;
      if (pieces.length === 0) {
        this.furnitureList.replaceChildren(el('p', 'in-furniture__empty', room ? 'Nothing here yet. Use Add furniture.' : 'Go into a room to see its furniture.'));
      } else {
        this.furnitureList.replaceChildren(...pieces.map((piece) => this.furnitureRow(piece.id, this.context.registry.get(piece.definitionId)?.name ?? 'Furniture')));
      }
      if (focusedId) focusIfPresent(this.furnitureList.querySelector(`[data-object-id="${focusedId}"] button`));
    }
    const selected = this.latestState?.selectedInstanceId ?? null;
    this.furnitureList.querySelectorAll<HTMLElement>('.in-furniture__choose').forEach((button) => button.setAttribute('aria-pressed', String(button.closest<HTMLElement>('[data-object-id]')?.dataset.objectId === selected)));
  }

  private furnitureRow(objectId: string, name: string): HTMLElement {
    const explorer = this.context.studio.interior;
    const row = el('div', 'in-furniture__row');
    row.setAttribute('role', 'listitem');
    row.dataset.objectId = objectId;
    const choose = el('button', 'in-furniture__choose', name);
    choose.type = 'button';
    choose.setAttribute('aria-pressed', 'false');
    choose.addEventListener('click', () => {
      this.context.actions.selectPlacedObject(objectId);
      // The piece's card (Colour, Copy...) floats over the view when the piece is in sight: then focus its first action.
      // When it is out of sight the card hides, and the buttons in this row still work.
      requestAnimationFrame(() => {
        const action = [...document.querySelectorAll<HTMLButtonElement>('.st-bubble:not([hidden]) .st-bubble__actions button')].find((b) => !b.hidden && b.offsetParent !== null);
        if (action) focusIfPresent(action);
      });
    });
    const turn = el('button', 'in-furniture__icon');
    turn.type = 'button';
    turn.setAttribute('aria-label', `Turn the ${name.toLowerCase()}`);
    turn.title = 'Turn a quarter';
    turn.appendChild(icon('turn'));
    turn.addEventListener('click', () => {
      const piece = this.latestState?.placedObjects.find((p) => p.id === objectId);
      if (!piece) return;
      this.context.actions.selectPlacedObject(objectId);
      const status = this.context.actions.rotateSelectedPlacedObject(piece.rotationY + Math.PI / 2);
      this.showResult(status?.valid ? `Turned the ${name.toLowerCase()}.` : `There is no room to turn the ${name.toLowerCase()} here.`);
    });
    const remove = el('button', 'in-furniture__icon in-furniture__icon--danger');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove the ${name.toLowerCase()}`);
    remove.title = 'Remove (Undo brings it back)';
    remove.appendChild(icon('remove'));
    remove.addEventListener('click', () => {
      if (this.context.actions.removePlacedObject(objectId)) {
        this.showResult(`Removed the ${name.toLowerCase()}. Undo brings it back.`);
        focusIfPresent(this.paletteButton);
      }
    });
    const move = el('select', 'in-furniture__move');
    move.setAttribute('aria-label', `Move the ${name.toLowerCase()}`);
    for (const [value, label] of [['', 'Move to...'], ['window', 'Near a window'], ['wall', 'Against a wall'], ['centre', 'Middle of the room']] as const) {
      const option = el('option', undefined, label);
      option.value = value;
      move.appendChild(option);
    }
    move.addEventListener('change', () => {
      const near = move.value as '' | 'window' | 'wall' | 'centre';
      move.value = '';
      if (!near) return;
      this.focusProposal = true;
      this.proposalReturnFocus = move;
      this.showResult(explorer.proposeMove(objectId, near).message);
    });
    row.append(choose, turn, remove, move);
    return row;
  }

  private returnFocusAfterProposal(): void {
    const target = this.proposalReturnFocus;
    this.proposalReturnFocus = null;
    if (!focusIfPresent(target)) focusIfPresent(this.paletteButton);
  }

  /** Escape: close the palette, or answer "no" to a waiting change, or stop the tour - one step at a time. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.root || blocksEscape(event.target)) return;
    if (document.querySelector('.confirm')) return;
    const explorer = this.context.studio.interior;
    const snapshot = explorer.snapshotState();
    if (!snapshot) return;
    const selected = this.latestState?.selectedInstanceId ?? null;
    const step = interiorBackStep({ paletteOpen: !this.palette.hidden, proposalPending: snapshot.proposal !== null, objectSelected: selected !== null, touring: snapshot.touring });
    if (step === 'nothing') return;
    if (step === 'leave-to-builder') {
      // The builder's Escape deselects the piece - except from a drop-down, which the builder's keys ignore: deselect here then.
      if (event.target instanceof HTMLSelectElement) {
        event.preventDefault();
        this.context.actions.selectPlacedObject(null);
      }
      // Then focus goes back to the piece in the list.
      setTimeout(() => focusIfPresent(this.furnitureList.querySelector(`[data-object-id="${selected}"] button`)), 0);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (step === 'close-palette') {
      this.setPaletteOpen(false);
      focusIfPresent(this.paletteButton);
    } else if (step === 'cancel-proposal') {
      explorer.cancelProposal();
      this.showResult('Okay, nothing changed.');
      this.returnFocusAfterProposal();
    } else {
      explorer.stopTour();
    }
  };

  private setPaletteOpen(open: boolean): void {
    this.palette.hidden = !open;
    this.paletteButton.setAttribute('aria-expanded', String(open));
  }

  private toggle(iconName: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'in-toggle');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.append(icon(iconName), el('span', '', label));
    button.addEventListener('click', onClick);
    return button;
  }

  private showResult(message: string): void {
    this.toast.textContent = message;
    this.toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.hidden = true;
    }, 3600);
  }
}
