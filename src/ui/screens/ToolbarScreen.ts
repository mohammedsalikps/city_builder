import { Screen, el } from '../Screen';
import { isObjectUnlocked, type GameState } from '@/state/GameState';
import {
  CATEGORY_LABELS,
  OBJECT_CATEGORIES,
  type ConstructionObjectDefinition,
  type ObjectCategory,
} from '@/construction/ConstructionObjectDefinition';
import type { TemplateDefinition } from '@/creative/Template';

interface ToolbarItem {
  definition: ConstructionObjectDefinition;
  button: HTMLButtonElement;
  status: HTMLElement;
}

interface TemplateItem {
  template: TemplateDefinition;
  button: HTMLButtonElement;
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

type PaletteGroup = 'build' | 'world' | 'create';

const GROUPS: Array<{ id: PaletteGroup; label: string; icon: string }> = [
  { id: 'build', label: 'Build', icon: '🛠️' },
  { id: 'world', label: 'World', icon: '🌍' },
  { id: 'create', label: 'Create', icon: '✨' },
];

/**
 * Two conceptual halves of the catalogue (see Step 22): BUILD is the
 * construction system - structures you assemble yourself (walls, floors,
 * openings...) and ready-made buildings for quickly filling out a town.
 * WORLD is everything that furnishes the city around what's built: roads,
 * nature, vehicles, decoration. CREATE isn't a category at all - it lists
 * whole starting arrangements (see Template.ts), not individual pieces.
 */
const GROUP_CATEGORIES: Record<'build' | 'world', ObjectCategory[]> = {
  build: ['structures', 'openings', 'buildings'],
  world: ['roads', 'nature', 'vehicles', 'decoration', 'utilities'],
};

/**
 * Compact build palette: a small floating bar of group tabs (Build / World /
 * Create) at the bottom of the screen. Build and World each open one
 * category-chip row and then a horizontal-scroll strip of pieces, exactly as
 * in Step 21; Create opens a strip of template cards instead - whole
 * starting arrangements, not individual objects (see Template.ts). The 3D
 * world stays the visual priority - nothing here permanently covers more
 * than a thin bottom band.
 *
 * Everything is generated from the object/template registries, never
 * hard-coded. Locked definitions (Challenge Mode only - see
 * `isObjectUnlocked`) show disabled so the player can see what exists
 * without being able to select it; My World never locks anything.
 */
export class ToolbarScreen extends Screen {
  readonly id = 'toolbar';

  private items: ToolbarItem[] = [];
  private templateItems: TemplateItem[] = [];
  private tabs: Array<{ category: ObjectCategory; button: HTMLButtonElement }> = [];
  private groupButtons: Array<{ id: PaletteGroup; button: HTMLButtonElement }> = [];
  private tabsRow: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private searchToggle: HTMLButtonElement | null = null;
  private strip: HTMLElement | null = null;
  private templateStrip: HTMLElement | null = null;
  private emptyLabel: HTMLElement | null = null;
  private group: PaletteGroup | null = null;
  private category: ObjectCategory | null = null;
  private searching = false;
  private query = '';

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--toolbar');
    const palette = el('div', 'palette');

    this.strip = el('div', 'palette__strip');
    palette.appendChild(this.strip);

    this.templateStrip = el('div', 'palette__strip palette__strip--templates');
    palette.appendChild(this.templateStrip);

    const bar = el('div', 'palette__bar');

    const groupsRow = el('div', 'palette__groups');
    for (const group of GROUPS) {
      const button = el('button', 'group-chip');
      button.type = 'button';
      button.appendChild(el('span', 'group-chip__icon', group.icon));
      button.appendChild(el('span', 'group-chip__label', group.label));
      button.addEventListener('click', () => this.selectGroup(group.id));
      this.groupButtons.push({ id: group.id, button });
      groupsRow.appendChild(button);
    }
    this.searchToggle = el('button', 'palette__search-toggle', '🔍');
    this.searchToggle.type = 'button';
    this.searchToggle.setAttribute('aria-label', 'Search construction pieces');
    this.searchToggle.addEventListener('click', () => {
      this.searching = !this.searching;
      if (this.searching) {
        this.group = null;
        this.category = null;
      } else {
        this.query = '';
        if (this.searchInput) this.searchInput.value = '';
      }
      this.applyFilter();
      if (this.searching) this.searchInput?.focus();
    });
    groupsRow.appendChild(this.searchToggle);
    bar.appendChild(groupsRow);

    this.tabsRow = this.buildTabs();
    bar.appendChild(this.tabsRow);
    palette.appendChild(bar);

    this.searchInput = el('input', 'palette__search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search (door, roof, tree...)';
    this.searchInput.hidden = true;
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput?.value.trim().toLowerCase() ?? '';
      this.applyFilter();
    });
    palette.appendChild(this.searchInput);

    for (const definition of this.context.registry.list()) {
      const item = this.buildItem(definition);
      this.items.push(item);
      this.strip.appendChild(item.button);
    }
    this.emptyLabel = el('div', 'palette__empty', 'Nothing here yet.');
    this.emptyLabel.hidden = true;
    this.strip.appendChild(this.emptyLabel);

    for (const template of this.context.templates.list()) {
      const item = this.buildTemplateItem(template);
      this.templateItems.push(item);
      this.templateStrip.appendChild(item.button);
    }

    root.appendChild(palette);
    this.applyFilter();
    return root;
  }

  private selectGroup(group: PaletteGroup): void {
    this.searching = false;
    this.group = this.group === group ? null : group;
    this.category = null;
    this.applyFilter();
  }

  /** One chip per category in the active group (Build or World). */
  private buildTabs(): HTMLElement {
    const row = el('div', 'palette__tabs');
    const present = new Set(this.context.registry.list().map((d) => d.category));
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

  private buildTemplateItem(template: TemplateDefinition): TemplateItem {
    const button = el('button', 'template-card');
    button.type = 'button';
    button.appendChild(el('span', 'template-card__name', template.name));
    button.appendChild(el('span', 'template-card__desc', template.description));

    button.addEventListener('click', () => {
      this.context.actions.instantiateTemplate(template);
    });

    return { template, button };
  }

  /** Show the strip only while browsing a category, a template group, or searching; filter pieces. */
  private applyFilter(): void {
    const browsingObjects = this.searching || (this.group !== 'create' && this.category !== null);
    const browsingTemplates = this.group === 'create';

    if (this.strip) this.strip.hidden = !browsingObjects;
    if (this.templateStrip) this.templateStrip.hidden = !browsingTemplates;
    if (this.tabsRow) this.tabsRow.hidden = this.searching || this.group === null || this.group === 'create';
    if (this.searchInput) this.searchInput.hidden = !this.searching;
    if (this.searchToggle) {
      this.searchToggle.classList.toggle('palette__search-toggle--active', this.searching);
      this.searchToggle.hidden = this.group === 'create';
    }

    for (const g of this.groupButtons) {
      g.button.classList.toggle('group-chip--active', g.id === this.group && !this.searching);
    }

    const activeCategories = this.group === 'build' || this.group === 'world' ? GROUP_CATEGORIES[this.group] : null;
    let visible = 0;
    for (const item of this.items) {
      const show = browsingObjects && this.matches(item.definition, activeCategories);
      item.button.hidden = !show;
      if (show) visible++;
    }
    for (const tab of this.tabs) {
      const inGroup = activeCategories ? activeCategories.includes(tab.category) : false;
      tab.button.hidden = !inGroup;
      tab.button.classList.toggle('chip--active', tab.category === this.category);
    }
    if (this.emptyLabel) this.emptyLabel.hidden = !browsingObjects || visible > 0;
  }

  private matches(definition: ConstructionObjectDefinition, activeCategories: ObjectCategory[] | null): boolean {
    if (this.searching) {
      if (this.query.length === 0) return true;
      const haystack = [definition.name, definition.type, definition.category, ...definition.gameplay.tags]
        .join(' ')
        .toLowerCase();
      return haystack.includes(this.query);
    }
    if (!activeCategories || !activeCategories.includes(definition.category)) return false;
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
    this.templateItems = [];
    this.tabs = [];
    this.groupButtons = [];
    this.tabsRow = null;
    this.searchInput = null;
    this.searchToggle = null;
    this.strip = null;
    this.templateStrip = null;
    this.emptyLabel = null;
    this.group = null;
    this.category = null;
    this.searching = false;
    this.query = '';
  }
}
