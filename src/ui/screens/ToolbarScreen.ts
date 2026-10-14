import { Screen, el } from '../Screen';
import { isObjectUnlocked, type GameState } from '@/state/GameState';
import type { ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import type { PieceShelf } from '@/creative/Studio';
import { icon } from '../studio/icons';
import { thumbnail } from '../studio/dom';

interface ToolbarItem {
  definition: ConstructionObjectDefinition;
  button: HTMLButtonElement;
  lock: HTMLElement;
}

/**
 * Challenge Mode's piece palette (Step 27.1 visual pass - same actions,
 * unlock rules and available objects as before, new presentation only): a
 * compact floating bar of shelf tabs at the bottom of the screen, each
 * opening a strip of real 3D piece thumbnails. My World no longer uses this
 * screen - it has World Studio (see StudioScreen).
 *
 * Shelves come straight from World Studio's own catalogue
 * (`studio.catalog.pieces`), so grouping and iconography already match the
 * "By hand" drawer there; the underlying category filter and every locked
 * definition are unchanged. Thumbnails reuse the same `ThumbnailRenderer`
 * World Studio uses, so a wall or a tree looks like a picture of the real
 * thing rather than a flat colour swatch.
 */
export class ToolbarScreen extends Screen {
  readonly id = 'toolbar';

  private items: ToolbarItem[] = [];
  private tabs: Array<{ shelf: PieceShelf; button: HTMLButtonElement }> = [];
  private searchInput: HTMLInputElement | null = null;
  private searchToggle: HTMLButtonElement | null = null;
  private strip: HTMLElement | null = null;
  private emptyLabel: HTMLElement | null = null;
  private shelf: PieceShelf | null = null;
  private searching = false;
  private query = '';

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--toolbar');
    const palette = el('div', 'ev-palette');
    const shelves = this.context.studio.catalog.pieces;
    this.shelf = null;

    this.strip = el('div', 'ev-palette__strip');
    palette.appendChild(this.strip);

    const bar = el('div', 'ev-palette__bar');
    this.searchToggle = el('button', 'ev-palette__search-toggle');
    this.searchToggle.type = 'button';
    this.searchToggle.setAttribute('aria-label', 'Search construction pieces');
    this.searchToggle.appendChild(icon('zoom'));
    this.searchToggle.addEventListener('click', () => {
      this.searching = !this.searching;
      if (this.searching) {
        this.shelf = null;
      } else {
        this.query = '';
        if (this.searchInput) this.searchInput.value = '';
      }
      this.applyFilter();
      if (this.searching) this.searchInput?.focus();
    });
    bar.appendChild(this.searchToggle);
    bar.appendChild(this.buildTabs(shelves));
    palette.appendChild(bar);

    this.searchInput = el('input', 'ev-palette__search');
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
    this.emptyLabel = el('div', 'ev-palette__empty', 'Nothing here yet.');
    this.emptyLabel.hidden = true;
    this.strip.appendChild(this.emptyLabel);

    root.appendChild(palette);
    this.applyFilter();
    return root;
  }

  /** One tab per shelf that has at least one available definition. */
  private buildTabs(shelves: PieceShelf[]): HTMLElement {
    const row = el('div', 'ev-palette__tabs');
    const available = challengeCatalogue(this.context.registry.list());
    for (const shelf of shelves) {
      if (!available.some((d) => shelf.categories.includes(d.category))) continue;
      const chip = el('button', 'ev-chip');
      chip.type = 'button';
      chip.appendChild(icon(shelf.icon));
      chip.appendChild(el('span', '', shelf.name));
      chip.addEventListener('click', () => {
        this.searching = false;
        this.shelf = this.shelf === shelf ? null : shelf;
        this.applyFilter();
      });
      this.tabs.push({ shelf, button: chip });
      row.appendChild(chip);
    }
    return row;
  }

  private buildItem(definition: ConstructionObjectDefinition): ToolbarItem {
    const button = el('button', 'ev-piece');
    button.type = 'button';
    button.dataset.objectId = definition.id;

    button.appendChild(thumbnail(this.context.studio.thumbnails.forDefinition(definition.id), 'ev-piece__thumb'));
    const lock = el('span', 'ev-piece__lock');
    lock.appendChild(icon('lock'));
    button.appendChild(lock);
    button.appendChild(el('span', 'ev-piece__name', definition.name));

    button.addEventListener('click', () => {
      // Tapping the active piece again leaves placement mode.
      const actions = this.context.actions;
      if (button.classList.contains('ev-piece--active')) actions.cancelPlacement();
      else actions.selectObject(definition.id);
    });

    return { definition, button, lock };
  }

  /** Show the strip only while browsing a shelf or searching; filter its pieces. */
  private applyFilter(): void {
    const open = this.searching || this.shelf !== null;
    if (this.strip) this.strip.hidden = !open;
    if (this.searchInput) this.searchInput.hidden = !this.searching;
    if (this.searchToggle) this.searchToggle.classList.toggle('ev-palette__search-toggle--active', this.searching);

    let visible = 0;
    for (const item of this.items) {
      const show = open && this.matches(item.definition);
      item.button.hidden = !show;
      if (show) visible++;
    }
    for (const tab of this.tabs) {
      tab.button.classList.toggle('ev-chip--active', tab.shelf === this.shelf);
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
    return this.shelf !== null && this.shelf.categories.includes(definition.category);
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
      item.button.classList.toggle('ev-piece--locked', !unlocked);
      item.button.classList.toggle('ev-piece--active', active);
      item.button.setAttribute('aria-pressed', String(active));
      item.lock.hidden = unlocked;
    }
  }

  protected onUnmount(): void {
    this.items = [];
    this.tabs = [];
    this.searchInput = null;
    this.searchToggle = null;
    this.strip = null;
    this.emptyLabel = null;
    this.shelf = null;
    this.searching = false;
    this.query = '';
  }
}

/** Challenge Mode's catalogue: everything except My World's own large-world pieces. */
function challengeCatalogue<T extends { gameplay: { tags: string[] } }>(definitions: T[]): T[] {
  return definitions.filter((d) => !d.gameplay.tags.includes('studio-only'));
}
