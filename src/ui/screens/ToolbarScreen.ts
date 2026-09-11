import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
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

type CategoryFilter = ObjectCategory | 'all';

/**
 * Construction toolbar: category tabs, a text filter and one button per
 * definition. Everything is generated from the object registry, never
 * hard-coded. Locked definitions are shown disabled so the player can see
 * what exists, but cannot select them.
 *
 * Category/search choices are UI-local (not game state): they describe how
 * the player is browsing, not what the game is.
 */
export class ToolbarScreen extends Screen {
  readonly id = 'toolbar';

  private items: ToolbarItem[] = [];
  private tabs: Array<{ category: CategoryFilter; button: HTMLButtonElement }> = [];
  private searchInput: HTMLInputElement | null = null;
  private emptyLabel: HTMLElement | null = null;
  private category: CategoryFilter = 'all';
  private query = '';

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--toolbar');
    const panel = el('div', 'toolbar');
    panel.appendChild(el('div', 'toolbar__title', 'Construction'));

    this.searchInput = el('input', 'toolbar__search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search (door, roof, tree...)';
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput?.value.trim().toLowerCase() ?? '';
      this.applyFilter();
    });
    panel.appendChild(this.searchInput);

    panel.appendChild(this.buildTabs());

    const list = el('div', 'toolbar__list');
    for (const definition of this.context.registry.list()) {
      const item = this.buildItem(definition);
      this.items.push(item);
      list.appendChild(item.button);
    }
    this.emptyLabel = el('div', 'toolbar__empty', 'No objects match.');
    this.emptyLabel.hidden = true;
    list.appendChild(this.emptyLabel);
    panel.appendChild(list);

    root.appendChild(panel);
    this.applyFilter();
    return root;
  }

  /** One tab for "All" plus every category that has at least one definition. */
  private buildTabs(): HTMLElement {
    const row = el('div', 'toolbar__tabs');
    const present = new Set(this.context.registry.list().map((d) => d.category));
    const categories: CategoryFilter[] = ['all', ...OBJECT_CATEGORIES.filter((c) => present.has(c))];
    for (const category of categories) {
      const label = category === 'all' ? 'All' : CATEGORY_LABELS[category];
      const button = el('button', 'tab', label);
      button.type = 'button';
      button.dataset.category = category;
      button.addEventListener('click', () => {
        this.category = category;
        this.applyFilter();
      });
      this.tabs.push({ category, button });
      row.appendChild(button);
    }
    return row;
  }

  private buildItem(definition: ConstructionObjectDefinition): ToolbarItem {
    const button = el('button', 'tool');
    button.type = 'button';
    button.dataset.objectId = definition.id;
    button.dataset.category = definition.category;

    const swatch = el('span', 'tool__swatch');
    swatch.style.background = definition.color;
    // Proportional footprint so a brick looks different from a pillar.
    const { width, height } = definition.dimensions;
    const ratio = Math.max(0.25, Math.min(4, width / Math.max(height, 0.01)));
    swatch.style.width = `${Math.round(ratio >= 1 ? 32 : 32 * ratio)}px`;
    swatch.style.height = `${Math.round(ratio >= 1 ? 32 / ratio : 32)}px`;
    button.appendChild(swatch);

    const text = el('span', 'tool__text');
    text.appendChild(el('span', 'tool__name', definition.name));
    const { width: w, height: h, depth: d } = definition.dimensions;
    text.appendChild(el('span', 'tool__category', `${CATEGORY_LABELS[definition.category]} · ${w}×${h}×${d} m`));
    button.appendChild(text);

    const status = el('span', 'tool__status');
    button.appendChild(status);

    button.addEventListener('click', () => {
      // Clicking the active tool again leaves placement mode.
      const actions = this.context.actions;
      if (button.classList.contains('tool--active')) actions.cancelPlacement();
      else actions.selectObject(definition.id);
    });

    return { definition, button, status };
  }

  /** Show only items matching the current category tab and search text. */
  private applyFilter(): void {
    let visible = 0;
    for (const item of this.items) {
      const show = this.matches(item.definition);
      item.button.hidden = !show;
      if (show) visible++;
    }
    for (const tab of this.tabs) {
      tab.button.classList.toggle('tab--active', tab.category === this.category);
    }
    if (this.emptyLabel) this.emptyLabel.hidden = visible > 0;
  }

  private matches(definition: ConstructionObjectDefinition): boolean {
    if (this.category !== 'all' && definition.category !== this.category) return false;
    if (this.query.length === 0) return true;
    const haystack = [definition.name, definition.type, definition.category, ...definition.gameplay.tags]
      .join(' ')
      .toLowerCase();
    return haystack.includes(this.query);
  }

  /** Definitions currently shown, for tests and debugging. */
  visibleObjectIds(): string[] {
    return this.items.filter((i) => !i.button.hidden).map((i) => i.definition.id);
  }

  update(state: GameState): void {
    for (const item of this.items) {
      const unlocked = state.unlocks.objectIds.includes(item.definition.id);
      const active = state.selectedObjectId === item.definition.id;
      item.button.disabled = !unlocked;
      item.button.classList.toggle('tool--locked', !unlocked);
      item.button.classList.toggle('tool--active', active);
      item.button.setAttribute('aria-pressed', String(active));
      item.status.textContent = !unlocked ? 'Locked' : active ? 'Placing' : '';
    }
  }

  protected onUnmount(): void {
    this.items = [];
    this.tabs = [];
    this.searchInput = null;
    this.emptyLabel = null;
  }
}
