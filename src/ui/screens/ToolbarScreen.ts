import { Screen, el } from '../Screen';
import { isObjectUnlocked, type GameState } from '@/state/GameState';
import {
  CATEGORY_LABELS,
  OBJECT_CATEGORIES,
  type ConstructionObjectDefinition,
  type ObjectCategory,
} from '@/construction/ConstructionObjectDefinition';

interface ToolbarItem {
  definition: ConstructionObjectDefinition;
  button: HTMLButtonElement;
  status: HTMLElement;
}

/** One small glyph per category, so the compact bar reads at a glance. */
const CATEGORY_ICONS: Record<ObjectCategory, string> = {
  structures: '🧱',
  openings: '🚪',
  buildings: '🏠',
  furniture: '🛋️',
  nature: '🌳',
  decoration: '💡',
  roads: '🛣️',
  vehicles: '🚗',
  utilities: '🔧',
};

/**
 * Challenge Mode's piece palette: a compact floating bar of category chips
 * at the bottom of the screen. Tapping a category slides open one
 * horizontal strip of its pieces; tapping it again closes it. My World no
 * longer uses this screen - it has World Studio (see StudioScreen).
 *
 * Every category that has pieces gets a chip (a level's furniture, roads or
 * vehicles must always be reachable). Locked definitions show disabled so
 * the player can see what exists without being able to select it.
 */
export class ToolbarScreen extends Screen {
  readonly id = 'toolbar';

  private items: ToolbarItem[] = [];
  private tabs: Array<{ category: ObjectCategory; button: HTMLButtonElement }> = [];
  private searchInput: HTMLInputElement | null = null;
  private searchToggle: HTMLButtonElement | null = null;
  private strip: HTMLElement | null = null;
  private emptyLabel: HTMLElement | null = null;
  private category: ObjectCategory | null = null;
  private searching = false;
  private query = '';

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--toolbar');
    const palette = el('div', 'palette');

    this.strip = el('div', 'palette__strip');
    palette.appendChild(this.strip);

    const bar = el('div', 'palette__bar');
    this.searchToggle = el('button', 'palette__search-toggle', '🔍');
    this.searchToggle.type = 'button';
    this.searchToggle.setAttribute('aria-label', 'Search construction pieces');
    this.searchToggle.addEventListener('click', () => {
      this.searching = !this.searching;
      if (this.searching) {
        this.category = null;
      } else {
        this.query = '';
        if (this.searchInput) this.searchInput.value = '';
      }
      this.applyFilter();
      if (this.searching) this.searchInput?.focus();
    });
    bar.appendChild(this.searchToggle);
    bar.appendChild(this.buildTabs());
    palette.appendChild(bar);

    this.searchInput = el('input', 'palette__search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search (door, roof, tree...)';
    this.searchInput.hidden = true;
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput?.value.trim().toLowerCase() ?? '';
      this.applyFilter();
    });
    this.searchInput.addEventListener('keydown', (event) => event.stopPropagation());
    palette.appendChild(this.searchInput);

    for (const definition of challengeCatalogue(this.context.registry.list())) {
      const item = this.buildItem(definition);
      this.items.push(item);
      this.strip.appendChild(item.button);
    }
    this.emptyLabel = el('div', 'palette__empty', 'Nothing here yet.');
    this.emptyLabel.hidden = true;
    this.strip.appendChild(this.emptyLabel);

    root.appendChild(palette);
    this.applyFilter();
    return root;
  }

  /** One chip per category that has at least one definition. */
  private buildTabs(): HTMLElement {
    const row = el('div', 'palette__tabs');
    const present = new Set(challengeCatalogue(this.context.registry.list()).map((d) => d.category));
    for (const category of OBJECT_CATEGORIES.filter((c) => present.has(c))) {
      const chip = el('button', 'chip');
      chip.type = 'button';
      chip.dataset.category = category;
      chip.appendChild(el('span', 'chip__icon', CATEGORY_ICONS[category]));
      chip.appendChild(el('span', 'chip__label', CATEGORY_LABELS[category]));
      chip.addEventListener('click', () => {
        this.searching = false;
        this.category = this.category === category ? null : category;
        this.applyFilter();
      });
      this.tabs.push({ category, button: chip });
      row.appendChild(chip);
    }
    return row;
  }

  private buildItem(definition: ConstructionObjectDefinition): ToolbarItem {
    const button = el('button', 'piece');
    button.type = 'button';
    button.dataset.objectId = definition.id;
    button.dataset.category = definition.category;

    const swatch = el('span', 'piece__swatch');
    swatch.style.background = definition.color;
    button.appendChild(swatch);

    const text = el('span', 'piece__text');
    text.appendChild(el('span', 'piece__name', definition.name));
    const status = el('span', 'piece__status');
    text.appendChild(status);
    button.appendChild(text);

    button.addEventListener('click', () => {
      // Clicking the active piece again leaves placement mode.
      const actions = this.context.actions;
      if (button.classList.contains('piece--active')) actions.cancelPlacement();
      else actions.selectObject(definition.id);
    });

    return { definition, button, status };
  }

  /** Show the strip only while browsing a category or searching; filter its pieces. */
  private applyFilter(): void {
    const open = this.searching || this.category !== null;
    if (this.strip) this.strip.hidden = !open;
    if (this.searchInput) this.searchInput.hidden = !this.searching;
    if (this.searchToggle) this.searchToggle.classList.toggle('palette__search-toggle--active', this.searching);

    let visible = 0;
    for (const item of this.items) {
      const show = open && this.matches(item.definition);
      item.button.hidden = !show;
      if (show) visible++;
    }
    for (const tab of this.tabs) {
      tab.button.classList.toggle('chip--active', tab.category === this.category);
    }
    if (this.emptyLabel) this.emptyLabel.hidden = !open || visible > 0;
  }

  private matches(definition: ConstructionObjectDefinition): boolean {
    if (this.searching) {
      if (this.query.length === 0) return true;
      const haystack = [definition.name, definition.type, definition.category, ...definition.gameplay.tags]
        .join(' ')
        .toLowerCase();
      return haystack.includes(this.query);
    }
    return definition.category === this.category;
  }

  /** Definitions currently shown, for tests and debugging. */
  visibleObjectIds(): string[] {
    return this.items.filter((i) => !i.button.hidden).map((i) => i.definition.id);
  }

  update(state: GameState): void {
    for (const item of this.items) {
      const unlocked = isObjectUnlocked(state, item.definition.id);
      const active = state.selectedObjectId === item.definition.id;
      item.button.disabled = !unlocked;
      item.button.classList.toggle('piece--locked', !unlocked);
      item.button.classList.toggle('piece--active', active);
      item.button.setAttribute('aria-pressed', String(active));
      item.status.textContent = !unlocked ? 'Locked' : active ? 'Placing' : '';
    }
  }

  protected onUnmount(): void {
    this.items = [];
    this.tabs = [];
    this.searchInput = null;
    this.searchToggle = null;
    this.strip = null;
    this.emptyLabel = null;
    this.category = null;
    this.searching = false;
    this.query = '';
  }
}

/** Challenge Mode's catalogue: everything except My World's own large-world pieces. */
function challengeCatalogue<T extends { gameplay: { tags: string[] } }>(definitions: T[]): T[] {
  return definitions.filter((d) => !d.gameplay.tags.includes('studio-only'));
}
