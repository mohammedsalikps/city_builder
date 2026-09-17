import { Screen, el } from '../Screen';
import { DEFAULT_WORLD_NAME, isPlacementMode, type GameState } from '@/state/GameState';
import type { CreationDefinition, CreationVariant } from '@/creative/Studio';
import { icon, iconSvg, ORB_MARK } from '../studio/icons';
import { actionButton, pillButton, setShown, thumbnail } from '../studio/dom';
import { ObjectBubble } from '../studio/ObjectBubble';
import { PiecesDrawer } from '../studio/PiecesDrawer';
import { StudioMap } from '../studio/StudioMap';
import type { CameraView } from '../studio/StudioServices';

type MenuState = 'closed' | 'radial' | 'styles' | 'drawer';

/** Tile colours per creation, so each intent has its own recognisable face. */
const CREATION_TONES: Record<string, string> = {
  house: 'sun',
  villa: 'coral',
  street: 'slate',
  park: 'leaf',
  neighborhood: 'sky',
  town: 'violet',
  industry: 'slate',
  nature: 'leaf',
  vehicle: 'sky',
  furniture: 'coral',
  hand: 'sun',
};

/** The empty world's four quick starts: creation id, and the style to jump straight to (if any). */
const WELCOME_STARTS: Array<{ creation: string; variant?: string; label: string; picture?: string }> = [
  { creation: 'house', label: 'House' },
  { creation: 'street', label: 'Street', picture: 'intent_street' },
  { creation: 'park', variant: 'pocket', label: 'Park' },
  { creation: 'neighborhood', variant: 'classic', label: 'Neighborhood' },
];

/**
 * EAVARA WORLD STUDIO - My World's whole child-facing experience.
 *
 * The 3D world is the interface; everything here floats around its edges:
 *   - the world badge (top left): home, the world's own name, its story,
 *     a playful count of what has been made;
 *   - the view dock (top right): Undo / Redo and friendly camera framings;
 *   - the Build Orb (bottom centre): the child's toybox. It opens a radial
 *     menu of creations ("House", "Street", "Park"...), then a shelf of 3D
 *     style previews, then a ghost to place;
 *   - the placement bar while something is being placed or drawn;
 *   - the object bubble above whatever the child taps (see ObjectBubble);
 *   - a welcome card while the world is still empty.
 *
 * It only ever calls GameActions / StudioServices; it holds no world data
 * of its own beyond which menu is open.
 */
export class StudioScreen extends Screen {
  readonly id = 'studio';

  private menu: MenuState = 'closed';
  private latest: GameState | null = null;
  private readonly disposers: Array<() => void> = [];
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  private lastObjects: GameState['placedObjects'] | null = null;
  private lastIdentity: GameState['myWorld'] | null = null;

  // world badge
  private nameLabel!: HTMLElement;
  private nameInput!: HTMLInputElement;
  private storyChip!: HTMLButtonElement;
  private summary!: HTMLElement;
  private savedMark!: HTMLElement;
  private storyPopover!: HTMLElement;
  private placeLabel!: HTMLElement;
  private placeName = '';
  // dock
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private mapButton!: HTMLButtonElement;
  private map!: StudioMap;
  private lastFrame = 0;
  // orb + menus
  private orb!: HTMLButtonElement;
  private orbLabel!: HTMLElement;
  private radial!: HTMLElement;
  private radialTiles: Array<{ creation: CreationDefinition; tile: HTMLElement }> = [];
  private shelf!: HTMLElement;
  private shelfTitle!: HTMLElement;
  private shelfRow!: HTMLElement;
  private backdrop!: HTMLElement;
  // flows
  private placementBar!: HTMLElement;
  private placementThumb!: HTMLElement;
  private placementTitle!: HTMLElement;
  private placementHint!: HTMLElement;
  private placementTurn!: HTMLButtonElement;
  private placementConfirm!: HTMLButtonElement;
  private placementDone!: HTMLButtonElement;
  private placementKey = '';
  // welcome
  private welcome!: HTMLElement;
  private welcomeName!: HTMLInputElement;
  private welcomeStories: Array<{ id: string; chip: HTMLButtonElement }> = [];
  private toast!: HTMLElement;

  private bubble!: ObjectBubble;
  private drawer!: PiecesDrawer;

  protected build(): HTMLElement {
    const root = el('div', 'screen studio');
    const services = this.context.studio;

    this.backdrop = el('div', 'st-backdrop');
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', () => this.closeMenus());
    root.appendChild(this.backdrop);

    root.appendChild(this.buildBadge());
    root.appendChild(this.buildDock());
    this.map = new StudioMap(this.context, () => this.setMapOpen(false));
    root.appendChild(this.map.root);

    this.bubble = new ObjectBubble(this.context, (text) => this.showToast(text));
    root.appendChild(this.bubble.root);

    this.welcome = this.buildWelcome();
    root.appendChild(this.welcome);

    this.drawer = new PiecesDrawer(this.context, () => this.closeMenus());
    root.appendChild(this.drawer.root);

    this.shelf = this.buildShelf();
    root.appendChild(this.shelf);

    this.radial = this.buildRadial();
    root.appendChild(this.radial);

    this.placementBar = this.buildPlacementBar();
    root.appendChild(this.placementBar);

    root.appendChild(this.buildOrb());

    this.toast = el('div', 'st-toast');
    this.toast.hidden = true;
    root.appendChild(this.toast);

    this.disposers.push(services.history.onChange(() => this.refreshHistory()));
    window.addEventListener('keydown', this.onKeyDown);
    this.disposers.push(() => window.removeEventListener('keydown', this.onKeyDown));

    // Warm the preview cache for the first things a child is likely to open.
    for (const creation of services.catalog.creations) {
      const first = creation.variants[0];
      if (first?.templateId) void services.thumbnails.forTemplate(first.templateId);
    }
    return root;
  }

  update(state: GameState): void {
    const previous = this.latest;
    this.latest = state;
    const flowActive = state.templatePlacement !== null || state.streetDrawing || isPlacementMode(state);
    if (flowActive && this.menu !== 'closed' && this.menu !== 'drawer') this.setMenu('closed');
    if (isPlacementMode(state) && this.menu === 'drawer') this.setMenu('closed');

    this.updateBadge(state, previous);
    this.updatePlacementBar(state);
    this.updateWelcome(state, flowActive);
    this.bubble.update(state, flowActive || this.menu !== 'closed');
    this.drawer.update(state);
    this.map.update(state);
    this.orb.parentElement!.classList.toggle('st-orb-dock--hidden', flowActive);
    this.orb.classList.toggle('st-orb--invite', state.placedObjects.length === 0 && !flowActive);
    this.updateSuggestions(state);
    this.refreshHistory();
  }

  frame(): void {
    const now = performance.now();
    const delta = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.bubble.frame();
    this.map.frame(delta);
    this.updatePlace();
    if (this.latest?.templatePlacement) this.refreshTemplateHint();
  }

  /** "You are in Maple Grove" - the badge names the part of the world in view. */
  private updatePlace(): void {
    const name = this.context.studio.placeName();
    if (name === this.placeName) return;
    this.placeName = name;
    this.placeLabel.replaceChildren(icon('pin'), el('span', '', name));
  }

  private setMapOpen(open: boolean): void {
    this.map.setOpen(open);
    this.mapButton.classList.toggle('st-view--active', open);
    this.mapButton.setAttribute('aria-pressed', String(open));
  }

  protected onUnmount(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.bubble.dispose();
    this.menu = 'closed';
    this.latest = null;
    this.lastObjects = null;
    this.lastIdentity = null;
    this.radialTiles = [];
    this.welcomeStories = [];
    this.placementKey = '';
    this.placeName = '';
    this.lastFrame = 0;
  }

  // ------------------------------------------------------------------ badge

  private buildBadge(): HTMLElement {
    const badge = el('div', 'st-badge');

    const home = el('button', 'st-round st-badge__home');
    home.type = 'button';
    home.title = 'Home';
    home.setAttribute('aria-label', 'Back to home');
    home.appendChild(icon('home'));
    home.addEventListener('click', () => this.context.actions.returnToMenu());
    badge.appendChild(home);

    const body = el('div', 'st-badge__body');
    const nameRow = el('div', 'st-badge__name-row');
    this.nameLabel = el('button', 'st-badge__name') as unknown as HTMLElement;
    (this.nameLabel as HTMLButtonElement).type = 'button';
    this.nameLabel.title = 'Rename your world';
    this.nameLabel.addEventListener('click', () => this.beginRename());
    this.nameInput = el('input', 'st-badge__name-input');
    this.nameInput.maxLength = 32;
    this.nameInput.hidden = true;
    this.nameInput.setAttribute('aria-label', 'World name');
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.nameInput.blur();
      if (event.key === 'Escape') {
        this.nameInput.value = this.latest?.myWorld.name ?? '';
        this.nameInput.blur();
      }
      event.stopPropagation();
    });
    this.nameInput.addEventListener('blur', () => this.endRename());
    this.savedMark = el('span', 'st-badge__saved');
    this.savedMark.appendChild(icon('cloud'));
    this.savedMark.appendChild(el('span', '', 'Saved'));
    nameRow.append(this.nameLabel, this.nameInput, this.savedMark);
    body.appendChild(nameRow);

    const meta = el('div', 'st-badge__meta');
    this.storyChip = el('button', 'st-story-chip');
    this.storyChip.type = 'button';
    this.storyChip.addEventListener('click', (event) => {
      event.stopPropagation();
      this.storyPopover.hidden = !this.storyPopover.hidden;
    });
    this.summary = el('span', 'st-badge__summary');
    meta.append(this.storyChip, this.summary);
    body.appendChild(meta);
    this.placeLabel = el('div', 'st-badge__place');
    body.appendChild(this.placeLabel);
    badge.appendChild(body);

    this.storyPopover = el('div', 'st-story-pop');
    this.storyPopover.hidden = true;
    this.storyPopover.appendChild(el('div', 'st-story-pop__title', 'What kind of place are you building?'));
    for (const story of this.context.studio.catalog.stories) {
      const option = el('button', 'st-story-option');
      option.type = 'button';
      option.dataset.story = story.id;
      option.appendChild(icon(story.icon));
      const text = el('span', 'st-story-option__text');
      text.appendChild(el('strong', '', story.name));
      text.appendChild(el('span', '', story.tagline));
      option.appendChild(text);
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.context.actions.setWorldStory(story.id);
        this.storyPopover.hidden = true;
      });
      this.storyPopover.appendChild(option);
    }
    badge.appendChild(this.storyPopover);
    document.addEventListener('pointerdown', this.onDocumentPointer, true);
    this.disposers.push(() => document.removeEventListener('pointerdown', this.onDocumentPointer, true));
    return badge;
  }

  private readonly onDocumentPointer = (event: PointerEvent): void => {
    if (!this.storyPopover.hidden && !this.storyPopover.contains(event.target as Node) && event.target !== this.storyChip) {
      this.storyPopover.hidden = true;
    }
  };

  private beginRename(): void {
    this.nameInput.value = this.latest?.myWorld.name ?? '';
    this.nameLabel.hidden = true;
    this.nameInput.hidden = false;
    this.nameInput.focus();
    this.nameInput.select();
  }

  private endRename(): void {
    if (this.nameInput.hidden) return;
    this.context.actions.setWorldName(this.nameInput.value);
    this.nameInput.hidden = true;
    this.nameLabel.hidden = false;
  }

  private updateBadge(state: GameState, previous: GameState | null): void {
    this.nameLabel.replaceChildren(el('span', '', state.myWorld.name), icon('pencil'));
    const story = this.context.studio.catalog.story(state.myWorld.story);
    this.storyChip.replaceChildren(
      icon(story?.icon ?? 'sparkle'),
      el('span', '', story ? story.name : 'Pick a story'),
    );
    this.storyChip.classList.toggle('st-story-chip--empty', !story);
    this.storyPopover.querySelectorAll<HTMLElement>('.st-story-option').forEach((option) => {
      option.classList.toggle('st-story-option--active', option.dataset.story === state.myWorld.story);
    });
    this.summary.replaceChildren(...this.summaryParts(state));

    // "Saved" appears briefly whenever the world or its identity actually changed.
    const changed =
      previous !== null &&
      this.lastObjects !== null &&
      (state.placedObjects !== this.lastObjects || state.myWorld !== this.lastIdentity);
    this.lastObjects = state.placedObjects;
    this.lastIdentity = state.myWorld;
    if (changed) {
      this.savedMark.classList.add('st-badge__saved--on');
      if (this.savedTimer) clearTimeout(this.savedTimer);
      this.savedTimer = setTimeout(() => this.savedMark.classList.remove('st-badge__saved--on'), 1800);
    }
  }

  /** "3 homes · 2 streets · 8 trees · 4 cars" - identity, not analytics. */
  private summaryParts(state: GameState): HTMLElement[] {
    let homes = 0;
    let roads = 0;
    let green = 0;
    let cars = 0;
    for (const placed of state.placedObjects) {
      const definition = this.context.registry.get(placed.definitionId);
      if (!definition) continue;
      if (definition.category === 'buildings' || definition.role === 'roof') homes++;
      else if (definition.category === 'roads' && definition.type !== 'sidewalk') roads++;
      else if (definition.category === 'nature') green++;
      else if (definition.category === 'vehicles') cars++;
    }
    if (homes + roads + green + cars === 0) return [el('span', 'st-badge__empty', 'A fresh, empty world')];
    const parts: HTMLElement[] = [];
    const add = (iconName: string, count: number, label: string) => {
      if (count === 0) return;
      const part = el('span', 'st-count');
      part.title = label;
      part.appendChild(icon(iconName));
      part.appendChild(el('span', '', String(count)));
      parts.push(part);
    };
    add('home', homes, 'Buildings');
    add('road', roads, 'Road pieces');
    add('tree', green, 'Trees and plants');
    add('car', cars, 'Vehicles');
    return parts;
  }

  // ------------------------------------------------------------------- dock

  private buildDock(): HTMLElement {
    const dock = el('div', 'st-dock');
    const history = el('div', 'st-dock__group');
    this.undoButton = el('button', 'st-round');
    this.undoButton.type = 'button';
    this.undoButton.title = 'Undo (Ctrl+Z)';
    this.undoButton.setAttribute('aria-label', 'Undo');
    this.undoButton.appendChild(icon('undo'));
    this.undoButton.addEventListener('click', () => this.context.studio.history.undo());
    this.redoButton = el('button', 'st-round');
    this.redoButton.type = 'button';
    this.redoButton.title = 'Redo (Ctrl+Y)';
    this.redoButton.setAttribute('aria-label', 'Redo');
    this.redoButton.appendChild(icon('redo'));
    this.redoButton.addEventListener('click', () => this.context.studio.history.redo());
    history.append(this.undoButton, this.redoButton);

    const views = el('div', 'st-dock__views');
    const addView = (view: CameraView, iconName: string, label: string) => {
      const button = pillButton(iconName, label, () => this.context.studio.cameraView(view), 'st-view');
      button.title = `${label} view`;
      views.appendChild(button);
    };
    addView('close', 'zoom', 'Close');
    addView('world', 'globe', 'World');
    addView('city', 'skyline', 'City');
    this.mapButton = pillButton('map', 'Map', () => this.setMapOpen(!this.map.isOpen), 'st-view st-view--map');
    this.mapButton.title = 'World map';
    this.mapButton.setAttribute('aria-pressed', 'false');
    views.appendChild(this.mapButton);
    dock.append(history, views);
    return dock;
  }

  private refreshHistory(): void {
    if (!this.undoButton) return;
    this.undoButton.disabled = !this.context.studio.history.canUndo;
    this.redoButton.disabled = !this.context.studio.history.canRedo;
  }

  // -------------------------------------------------------------- build orb

  private buildOrb(): HTMLElement {
    const dock = el('div', 'st-orb-dock');
    this.orb = el('button', 'st-orb');
    this.orb.type = 'button';
    this.orb.setAttribute('aria-label', 'Create something');
    this.orb.innerHTML = `<span class="st-orb__glow"></span><span class="st-orb__core">${ORB_MARK}${iconSvg('close', 'st-orb__close')}</span>`;
    this.orb.addEventListener('click', () => {
      this.context.actions.selectPlacedObject(null);
      this.setMenu(this.menu === 'closed' ? 'radial' : 'closed');
    });
    this.orbLabel = el('span', 'st-orb-dock__label', 'Create');
    dock.append(this.orb, this.orbLabel);
    return dock;
  }

  private buildRadial(): HTMLElement {
    const radial = el('div', 'st-radial');
    radial.hidden = true;
    radial.appendChild(el('div', 'st-radial__title', 'What do you want to make?'));
    const rings: Record<'inner' | 'outer', CreationDefinition[]> = { inner: [], outer: [] };
    for (const creation of this.context.studio.catalog.creations) rings[creation.ring].push(creation);
    let order = 0;
    for (const ring of ['inner', 'outer'] as const) {
      const items = rings[ring];
      const spread = ring === 'inner' ? 180 : 160;
      items.forEach((creation, index) => {
        const angle = items.length === 1 ? 270 : 270 - spread / 2 + (spread * index) / (items.length - 1);
        const tile = el('button', `st-radial__tile st-tone--${CREATION_TONES[creation.id] ?? 'sun'}`);
        tile.type = 'button';
        tile.style.setProperty('--angle', `${angle}deg`);
        tile.style.setProperty('--ring', ring === 'inner' ? 'var(--st-ring-inner)' : 'var(--st-ring-outer)');
        tile.style.setProperty('--delay', `${order * 22}ms`);
        order++;
        const face = el('span', 'st-radial__face');
        face.appendChild(icon(creation.icon));
        tile.appendChild(face);
        tile.appendChild(el('span', 'st-radial__label', creation.name));
        const star = el('span', 'st-radial__suggest');
        star.appendChild(icon('star'));
        star.title = 'Suggested for your story';
        tile.appendChild(star);
        tile.addEventListener('click', (event) => {
          event.stopPropagation();
          this.startCreation(creation);
        });
        radial.appendChild(tile);
        this.radialTiles.push({ creation, tile });
      });
    }
    return radial;
  }

  private buildShelf(): HTMLElement {
    const shelf = el('div', 'st-shelf');
    shelf.hidden = true;
    const header = el('div', 'st-shelf__header');
    const back = el('button', 'st-round st-round--small');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    back.appendChild(icon('back'));
    back.addEventListener('click', () => this.setMenu('radial'));
    this.shelfTitle = el('div', 'st-shelf__title');
    const close = el('button', 'st-round st-round--small');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.appendChild(icon('close'));
    close.addEventListener('click', () => this.closeMenus());
    header.append(back, this.shelfTitle, close);
    this.shelfRow = el('div', 'st-shelf__row');
    shelf.append(header, this.shelfRow);
    return shelf;
  }

  private fillShelf(creation: CreationDefinition): void {
    const services = this.context.studio;
    this.shelfTitle.replaceChildren(
      el('strong', '', creation.verb),
      el('span', '', creation.kind === 'piece' ? 'Pick one, then tap the ground' : 'Pick a style'),
    );
    this.shelfRow.replaceChildren();
    for (const variant of creation.variants) {
      const card = el('button', 'st-style');
      card.type = 'button';
      const preview = variant.templateId
        ? services.thumbnails.forTemplate(variant.templateId)
        : services.thumbnails.forDefinition(variant.definitionId ?? '');
      card.appendChild(thumbnail(preview, 'st-style__thumb'));
      const text = el('span', 'st-style__text');
      text.appendChild(el('strong', '', variant.name));
      if (variant.hint) text.appendChild(el('span', '', variant.hint));
      card.appendChild(text);
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        this.chooseVariant(creation, variant);
      });
      this.shelfRow.appendChild(card);
    }
  }

  private setMenu(menu: MenuState): void {
    this.menu = menu;
    setShown(this.radial, menu === 'radial');
    setShown(this.shelf, menu === 'styles');
    this.drawer.setOpen(menu === 'drawer');
    this.backdrop.hidden = menu === 'closed' || menu === 'drawer';
    this.orb.classList.toggle('st-orb--open', menu !== 'closed');
    this.orbLabel.textContent = menu === 'closed' ? 'Create' : 'Close';
    if (this.latest) {
      this.bubble.update(this.latest, menu !== 'closed');
      this.updateWelcome(this.latest, false);
    }
  }

  private closeMenus(): void {
    this.setMenu('closed');
  }

  private updateSuggestions(state: GameState): void {
    const story = this.context.studio.catalog.story(state.myWorld.story);
    for (const { creation, tile } of this.radialTiles) {
      tile.classList.toggle('st-radial__tile--suggested', story?.suggests.includes(creation.id) ?? false);
    }
  }

  // --------------------------------------------------------------- creation

  private startCreation(creation: CreationDefinition, variantId?: string): void {
    const actions = this.context.actions;
    actions.selectPlacedObject(null);
    if (creation.kind === 'street') {
      this.setMenu('closed');
      actions.startStreetDrawing();
      return;
    }
    if (creation.kind === 'drawer') {
      this.setMenu('drawer');
      return;
    }
    const variant = variantId ? creation.variants.find((v) => v.id === variantId) : undefined;
    if (variant || creation.variants.length === 1) {
      this.chooseVariant(creation, variant ?? creation.variants[0]);
      return;
    }
    this.fillShelf(creation);
    this.setMenu('styles');
  }

  private chooseVariant(creation: CreationDefinition, variant: CreationVariant): void {
    const actions = this.context.actions;
    this.setMenu('closed');
    if (creation.kind === 'template' && variant.templateId) {
      // "Family" + "House" -> "Family House"; a full name ("Factory Yard") stands alone.
      const complete = variant.name.includes(' ') || variant.name.toLowerCase().includes(creation.name.toLowerCase());
      const label = complete ? variant.name : `${variant.name} ${creation.name}`;
      actions.startTemplatePlacement(variant.templateId, { label, creationId: creation.id });
    } else if (creation.kind === 'piece' && variant.definitionId) {
      actions.selectObject(variant.definitionId);
    }
  }

  // ---------------------------------------------------------- placement bar

  private buildPlacementBar(): HTMLElement {
    const bar = el('div', 'st-placing');
    bar.hidden = true;
    this.placementThumb = el('span', 'st-placing__thumb');
    const text = el('div', 'st-placing__text');
    this.placementTitle = el('strong', 'st-placing__title');
    this.placementHint = el('span', 'st-placing__hint');
    text.append(this.placementTitle, this.placementHint);
    const buttons = el('div', 'st-placing__buttons');
    this.placementTurn = actionButton('turn', 'Turn', () => {
      if (this.latest?.templatePlacement) this.context.actions.rotateTemplatePlacement(1);
      else this.context.actions.rotatePlacement(1);
    });
    this.placementConfirm = actionButton('check', 'Place here', () => {
      if (!this.context.studio.confirmTemplate()) this.showToast('Point at the ground first');
    }, 'st-action--primary');
    this.placementDone = actionButton('check', 'Done', () => this.context.actions.cancelPlacement(), 'st-action--primary');
    const cancel = actionButton('close', 'Cancel', () => {
      const state = this.latest;
      if (state?.templatePlacement) this.context.actions.cancelTemplatePlacement();
      else if (state?.streetDrawing) this.context.actions.cancelStreetDrawing();
      else this.context.actions.cancelPlacement();
    });
    buttons.append(this.placementTurn, this.placementConfirm, this.placementDone, cancel);
    bar.append(this.placementThumb, text, buttons);
    return bar;
  }

  private updatePlacementBar(state: GameState): void {
    const services = this.context.studio;
    let key = '';
    if (state.templatePlacement) key = `t:${state.templatePlacement.templateId}`;
    else if (state.streetDrawing) key = 'street';
    else if (isPlacementMode(state) && state.selectedObjectId) key = `p:${state.selectedObjectId}`;
    setShown(this.placementBar, key !== '');
    if (key === '') {
      this.placementKey = '';
      return;
    }

    if (key !== this.placementKey) {
      this.placementKey = key;
      this.placementThumb.replaceChildren();
      if (state.templatePlacement) {
        const template = this.context.templates.get(state.templatePlacement.templateId);
        this.placementThumb.appendChild(thumbnail(services.thumbnails.forTemplate(state.templatePlacement.templateId)));
        this.placementTitle.textContent = state.templatePlacement.label ?? template?.name ?? 'Your creation';
      } else if (state.streetDrawing) {
        const face = el('span', 'st-placing__icon st-tone--slate');
        face.appendChild(icon('road'));
        this.placementThumb.appendChild(face);
        this.placementTitle.textContent = 'Draw a street';
      } else if (state.selectedObjectId) {
        const definition = this.context.registry.get(state.selectedObjectId);
        this.placementThumb.appendChild(thumbnail(services.thumbnails.forDefinition(state.selectedObjectId)));
        this.placementTitle.textContent = definition?.name ?? 'Piece';
      }
    }

    this.placementTurn.hidden = state.streetDrawing;
    this.placementConfirm.hidden = state.templatePlacement === null;
    this.placementDone.hidden = !(isPlacementMode(state) && state.templatePlacement === null && !state.streetDrawing);
    this.placementBar.classList.remove('st-placing--warn');
    if (state.templatePlacement) {
      this.refreshTemplateHint();
    } else if (state.streetDrawing) {
      this.placementHint.textContent = 'Press and drag across the ground';
    } else {
      const status = state.placementStatus;
      if (!status) this.placementHint.textContent = 'Point where it should go';
      else if (status.valid) this.placementHint.textContent = 'Tap to place it. Tap again for another';
      else {
        this.placementHint.textContent = status.hint
          ? `${status.hint} - try another spot`
          : status.reason === 'blocked'
            ? "Something's already there - try an open spot"
            : "It doesn't fit there - try another spot";
        this.placementBar.classList.add('st-placing--warn');
      }
    }
  }

  private refreshTemplateHint(): void {
    const services = this.context.studio;
    const hasSpot = services.templateHasSpot();
    const fits = services.templateFits();
    this.placementConfirm.disabled = !hasSpot;
    let hint = 'Point at the ground, then tap to place it';
    if (hasSpot && !fits) hint = 'The red parts will be skipped - move it to fit it all';
    else if (hasSpot) hint = 'Looks great! Tap to place it here';
    if (this.placementHint.textContent !== hint) this.placementHint.textContent = hint;
    this.placementBar.classList.toggle('st-placing--warn', hasSpot && !fits);
  }

  // ---------------------------------------------------------------- welcome

  private buildWelcome(): HTMLElement {
    const services = this.context.studio;
    const card = el('div', 'st-welcome');
    card.hidden = true;
    card.appendChild(el('div', 'st-welcome__eyebrow', 'EAVARA WORLD STUDIO'));
    card.appendChild(el('h2', 'st-welcome__title', 'Welcome to your world.'));

    const nameRow = el('label', 'st-welcome__name');
    nameRow.appendChild(el('span', '', 'Name it'));
    this.welcomeName = el('input', 'st-welcome__name-input');
    this.welcomeName.maxLength = 32;
    this.welcomeName.placeholder = 'My Dream Town';
    this.welcomeName.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.welcomeName.blur();
      event.stopPropagation();
    });
    this.welcomeName.addEventListener('change', () => this.context.actions.setWorldName(this.welcomeName.value));
    nameRow.appendChild(this.welcomeName);
    card.appendChild(nameRow);

    card.appendChild(el('p', 'st-welcome__ask', 'What would you like to create?'));
    const row = el('div', 'st-welcome__row');
    for (const start of WELCOME_STARTS) {
      const creation = services.catalog.creation(start.creation);
      if (!creation) continue;
      const tile = el('button', 'st-welcome__tile');
      tile.type = 'button';
      const variant = start.variant ? creation.variants.find((v) => v.id === start.variant) : creation.variants[0];
      const picture = start.picture ?? variant?.templateId;
      if (picture) tile.appendChild(thumbnail(services.thumbnails.forTemplate(picture), 'st-welcome__thumb'));
      else {
        const face = el('span', `st-welcome__thumb st-welcome__thumb--icon st-tone--${CREATION_TONES[creation.id] ?? 'sun'}`);
        face.appendChild(icon(creation.icon));
        tile.appendChild(face);
      }
      tile.appendChild(el('span', 'st-welcome__label', start.label));
      tile.addEventListener('click', () => this.startCreation(creation, start.variant));
      row.appendChild(tile);
    }
    card.appendChild(row);

    card.appendChild(el('p', 'st-welcome__ask st-welcome__ask--small', 'What kind of place is it?'));
    const stories = el('div', 'st-welcome__stories');
    for (const story of services.catalog.stories) {
      const chip = el('button', 'st-story-chip');
      chip.type = 'button';
      chip.appendChild(icon(story.icon));
      chip.appendChild(el('span', '', story.name));
      chip.addEventListener('click', () => {
        const current = this.latest?.myWorld.story ?? null;
        this.context.actions.setWorldStory(current === story.id ? null : story.id);
      });
      stories.appendChild(chip);
      this.welcomeStories.push({ id: story.id, chip });
    }
    card.appendChild(stories);
    return card;
  }

  private updateWelcome(state: GameState, flowActive: boolean): void {
    const show = state.placedObjects.length === 0 && !flowActive && this.menu === 'closed';
    setShown(this.welcome, show);
    if (!show) return;
    if (document.activeElement !== this.welcomeName) {
      this.welcomeName.value = state.myWorld.name === DEFAULT_WORLD_NAME ? '' : state.myWorld.name;
    }
    for (const { id, chip } of this.welcomeStories) {
      chip.classList.toggle('st-story-chip--active', state.myWorld.story === id);
    }
  }

  // ------------------------------------------------------------------ misc

  private showToast(text: string): void {
    this.toast.textContent = text;
    setShown(this.toast, true);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => setShown(this.toast, false), 1800);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) this.context.studio.history.redo();
      else this.context.studio.history.undo();
    } else if (mod && event.code === 'KeyY') {
      event.preventDefault();
      this.context.studio.history.redo();
    } else if (event.code === 'Escape' && this.menu !== 'closed') {
      this.closeMenus();
    } else if (event.code === 'Escape' && this.map.isOpen) {
      this.setMapOpen(false);
    } else if (event.code === 'KeyM' && !mod) {
      this.setMapOpen(!this.map.isOpen);
    }
  };
}
