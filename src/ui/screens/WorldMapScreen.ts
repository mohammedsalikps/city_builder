import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
import { listLevels, type LevelEntry } from '@/progression/levelState';
import { starString } from '@/progression/stars';

interface MapNode {
  challengeId: string;
  button: HTMLButtonElement;
  number: HTMLElement;
  stars: HTMLElement;
  label: HTMLElement;
}

/** Horizontal offsets (percent of path width) for the zig-zag, per row. */
const ZIGZAG = [18, 50, 82, 50];

/**
 * World map: the levels of one world as nodes along a zig-zag "site path".
 * Node state (locked / available / completed, stars, current) is derived
 * from `state.progress` through the same level-state rule the menu and the
 * unlocking use; the map holds no progression of its own.
 *
 * Only World 1 exists today, but the screen reads worlds from the registry
 * and shows whichever world holds the next level to play.
 */
export class WorldMapScreen extends Screen {
  readonly id = 'world-map';

  private titleLabel: HTMLElement | null = null;
  private descriptionLabel: HTMLElement | null = null;
  private summaryLabel: HTMLElement | null = null;
  private noticeLabel: HTMLElement | null = null;
  private path: HTMLElement | null = null;
  private pathLine: SVGPolylineElement | null = null;
  private nodes: MapNode[] = [];
  private worldId: string | null = null;
  private scrolledTo: string | null = null;

  private readonly onBack = () => this.context.actions.closeWorldMap();

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--map');
    const panel = el('div', 'map');

    const header = el('div', 'map__header');
    const back = el('button', 'button button--small', '← Menu');
    back.type = 'button';
    back.addEventListener('click', this.onBack);
    header.appendChild(back);
    const titles = el('div', 'map__titles');
    this.titleLabel = el('div', 'map__title');
    this.descriptionLabel = el('div', 'map__description');
    titles.append(this.titleLabel, this.descriptionLabel);
    header.appendChild(titles);
    panel.appendChild(header);

    this.summaryLabel = el('div', 'map__summary');
    panel.appendChild(this.summaryLabel);

    this.path = el('div', 'map__path');
    panel.appendChild(this.path);

    this.noticeLabel = el('div', 'menu__notice');
    this.noticeLabel.hidden = true;
    panel.appendChild(this.noticeLabel);

    root.appendChild(panel);
    return root;
  }

  /** Create the nodes for a world once; positions come from the level order. */
  private buildNodes(worldId: string): void {
    if (!this.path) return;
    this.path.replaceChildren();
    this.nodes = [];

    const levels = this.context.challenges.listByWorld(worldId);
    const rowHeight = 76;
    this.path.style.height = `${levels.length * rowHeight + 56}px`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'map__svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    this.pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    this.pathLine.setAttribute('class', 'map__line');
    svg.appendChild(this.pathLine);
    this.path.appendChild(svg);

    const points: string[] = [];
    levels.forEach((challenge, i) => {
      const xPercent = ZIGZAG[i % ZIGZAG.length];
      const y = 56 + i * rowHeight;
      points.push(`${xPercent},${y}`);

      const button = el('button', 'node');
      button.type = 'button';
      button.dataset.challengeId = challenge.id;
      button.style.left = `${xPercent}%`;
      button.style.top = `${y}px`;
      const number = el('span', 'node__number', String(challenge.index));
      const stars = el('span', 'node__stars');
      const label = el('span', 'node__label', challenge.title);
      button.append(number, stars, label);
      button.addEventListener('click', () => this.context.actions.startChallenge(challenge.id));
      this.path?.appendChild(button);
      this.nodes.push({ challengeId: challenge.id, button, number, stars, label });
    });

    // The polyline is drawn in a 100 x height user space so x can be percent-like.
    svg.setAttribute('viewBox', `0 0 100 ${levels.length * rowHeight + 56}`);
    this.pathLine.setAttribute('points', points.join(' '));
  }

  update(state: GameState): void {
    if (!this.root) return;
    const worlds = this.context.challenges.worlds();
    if (worlds.length === 0) return;

    // Show the world containing the next level to play (or the last world).
    const ordered = this.context.challenges.list();
    const entries = listLevels(ordered, state.progress);
    const current = entries.find((e) => e.status === 'available') ?? entries[entries.length - 1];
    const world = this.context.challenges.getWorld(current.challenge.worldId) ?? worlds[0];
    if (this.worldId !== world.id) {
      this.worldId = world.id;
      this.buildNodes(world.id);
    }

    if (this.titleLabel) this.titleLabel.textContent = `World ${world.index}: ${world.title}`;
    if (this.descriptionLabel) this.descriptionLabel.textContent = world.description;

    const worldEntries = entries.filter((e) => e.challenge.worldId === world.id);
    const byId = new Map<string, LevelEntry>(worldEntries.map((e) => [e.challenge.id, e]));
    const completed = worldEntries.filter((e) => e.status === 'completed').length;
    const stars = worldEntries.reduce((sum, e) => sum + e.bestStars, 0);
    if (this.summaryLabel) {
      this.summaryLabel.textContent = `${completed} / ${worldEntries.length} levels · ${stars} / ${worldEntries.length * 3} stars`;
    }

    for (const node of this.nodes) {
      const entry = byId.get(node.challengeId);
      if (!entry) continue;
      const isCurrent = entry.challenge.id === current.challenge.id;
      node.button.classList.toggle('node--locked', entry.status === 'locked');
      node.button.classList.toggle('node--available', entry.status === 'available');
      node.button.classList.toggle('node--completed', entry.status === 'completed');
      node.button.classList.toggle('node--current', isCurrent);
      node.button.dataset.status = entry.status;
      node.button.setAttribute('aria-label', `Level ${entry.challenge.index}: ${entry.challenge.title} (${entry.status})`);
      node.number.textContent = entry.status === 'locked' ? '🔒' : entry.status === 'completed' ? '✓' : String(entry.challenge.index);
      node.stars.textContent = entry.status === 'completed' ? starString(entry.bestStars) : '';
      // Long worlds scroll: keep the level the player is on in view.
      if (isCurrent && node.challengeId !== this.scrolledTo) {
        this.scrolledTo = node.challengeId;
        node.button.scrollIntoView({ block: 'nearest' });
      }
    }

    if (this.noticeLabel) {
      this.noticeLabel.textContent = state.menuNotice ?? '';
      this.noticeLabel.hidden = state.menuNotice === null;
    }
  }

  protected onUnmount(): void {
    this.titleLabel = null;
    this.descriptionLabel = null;
    this.summaryLabel = null;
    this.noticeLabel = null;
    this.path = null;
    this.pathLine = null;
    this.nodes = [];
    this.worldId = null;
    this.scrolledTo = null;
  }
}
