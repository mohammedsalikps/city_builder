import { el, type ScreenContext } from '../Screen';
import type { GameState } from '@/state/GameState';
import type { PieceShelf } from '@/creative/Studio';
import { icon } from './icons';
import { setShown, thumbnail } from './dom';

/**
 * "Build by hand": a friendly drawer of every construction piece, grouped
 * on shelves (Walls & floors, Doors & windows, Furniture...) with real 3D
 * pictures. Picking a piece starts ordinary single-object placement, so a
 * child can still design a villa wall by wall. Only the open shelf renders
 * its tiles, keeping the DOM small.
 */
export class PiecesDrawer {
  readonly root: HTMLElement;
  private readonly tabs: Array<{ shelf: PieceShelf; button: HTMLButtonElement }> = [];
  private readonly grid: HTMLElement;
  private shelf: PieceShelf;
  private open = false;

  constructor(
    private readonly context: ScreenContext,
    private readonly onClose: () => void,
  ) {
    const shelves = context.studio.catalog.pieces;
    this.shelf = shelves[0];
    this.root = el('div', 'st-drawer');
    this.root.hidden = true;

    const header = el('div', 'st-drawer__header');
    const title = el('div', 'st-drawer__title');
    title.appendChild(icon('hand'));
    title.appendChild(el('strong', '', 'Build piece by piece'));
    const close = el('button', 'st-round st-round--small');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.appendChild(icon('close'));
    close.addEventListener('click', () => this.onClose());
    header.append(title, close);

    const tabRow = el('div', 'st-drawer__tabs');
    for (const shelf of shelves) {
      const button = el('button', 'st-tab');
      button.type = 'button';
      button.appendChild(icon(shelf.icon));
      button.appendChild(el('span', '', shelf.name));
      button.addEventListener('click', () => {
        this.shelf = shelf;
        this.render();
      });
      tabRow.appendChild(button);
      this.tabs.push({ shelf, button });
    }

    this.grid = el('div', 'st-drawer__grid');
    this.root.append(header, tabRow, this.grid);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    setShown(this.root, open);
    if (open) this.render();
  }

  update(state: GameState): void {
    if (!this.open) return;
    this.grid.querySelectorAll<HTMLElement>('.st-piece').forEach((tile) => {
      tile.classList.toggle('st-piece--active', tile.dataset.id === state.selectedObjectId);
    });
  }

  private render(): void {
    for (const { shelf, button } of this.tabs) button.classList.toggle('st-tab--active', shelf === this.shelf);
    const thumbnails = this.context.studio.thumbnails;
    const pieces = this.context.registry.list().filter((d) => this.shelf.categories.includes(d.category));
    this.grid.replaceChildren(
      ...pieces.map((definition) => {
        const tile = el('button', 'st-piece');
        tile.type = 'button';
        tile.dataset.id = definition.id;
        tile.appendChild(thumbnail(thumbnails.forDefinition(definition.id), 'st-piece__thumb'));
        tile.appendChild(el('span', 'st-piece__name', definition.name));
        tile.addEventListener('click', () => {
          this.context.actions.selectObject(definition.id);
          this.onClose();
        });
        return tile;
      }),
    );
    this.grid.scrollLeft = 0;
  }
}
