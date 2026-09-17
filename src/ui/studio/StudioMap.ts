import { el, type ScreenContext } from '../Screen';
import type { GameState } from '@/state/GameState';
import type { WorldMapData } from './StudioServices';
import { icon } from './icons';
import { setShown } from './dom';

const SIZE = 248;
const PADDING = 8;
/** Districts offered as one-tap trips, in this order. */
const TRIPS: Array<{ id: string; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'maple', label: 'Houses' },
  { id: 'market', label: 'Town' },
  { id: 'skyline', label: 'City' },
  { id: 'works', label: 'Industry' },
  { id: 'lake', label: 'Lake' },
  { id: 'park', label: 'Park' },
];

type Dot = { x: number; z: number; id: string; color: string; r: number };

/**
 * The toy world map: a little illustrated card, not an editor minimap.
 * Painted districts, the lake and the world's streets are drawn once; the
 * child's own creations, the selection and the camera are drawn live while
 * it is open. Tap the map to travel there; tap one of your creations to
 * select it; or pick a place from the chips.
 */
export class StudioMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly chips: HTMLElement;
  private readonly place: HTMLElement;
  private background: HTMLCanvasElement | null = null;
  private data: WorldMapData | null = null;
  private open = false;
  private dots: Dot[] = [];
  private dotsSource: GameState['placedObjects'] | null = null;
  private selectedId: string | null = null;
  private pulse = 0;
  private readonly ratio = Math.min(2, window.devicePixelRatio || 1);

  constructor(
    private readonly context: ScreenContext,
    private readonly onClose: () => void,
  ) {
    this.root = el('div', 'st-map');
    this.root.hidden = true;
    const header = el('div', 'st-map__header');
    const title = el('div', 'st-map__title');
    title.appendChild(icon('map'));
    title.appendChild(el('strong', '', 'World Map'));
    const close = el('button', 'st-round st-round--tiny');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close map');
    close.appendChild(icon('close'));
    close.addEventListener('click', () => this.onClose());
    header.append(title, close);

    const frame = el('div', 'st-map__frame');
    this.canvas = el('canvas', 'st-map__canvas');
    this.canvas.width = SIZE * this.ratio;
    this.canvas.height = SIZE * this.ratio;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('click', (event) => this.onClick(event));
    frame.appendChild(this.canvas);

    this.place = el('div', 'st-map__place');
    this.chips = el('div', 'st-map__chips');
    this.root.append(header, frame, this.place, this.chips);
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    setShown(this.root, open);
    if (open) this.ensureData();
  }

  update(state: GameState): void {
    this.selectedId = state.selectedInstanceId;
    if (state.placedObjects !== this.dotsSource) {
      this.dotsSource = state.placedObjects;
      this.dots = state.placedObjects.map((p) => {
        const category = this.context.registry.get(p.definitionId)?.category;
        const color =
          category === 'roads' ? '#6b7280' : category === 'nature' ? '#2f8f46' : category === 'vehicles' ? '#2f7fd8' : category === 'furniture' ? '#b06ad6' : '#f08a24';
        const r = category === 'buildings' ? 3.2 : category === 'roads' ? 1.8 : 2.2;
        return { x: p.position.x, z: p.position.z, id: p.id, color, r };
      });
    }
  }

  /** Redraw the live layer (called every frame while open). */
  frame(deltaSeconds: number): void {
    if (!this.open) return;
    if (!this.ensureData() || !this.background) return;
    this.pulse = (this.pulse + deltaSeconds) % 10;
    const ctx = this.ctx;
    const k = this.ratio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.background, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    for (const dot of this.dots) {
      const p = this.toMap(dot.x, dot.z);
      ctx.beginPath();
      ctx.fillStyle = dot.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.arc(p.x, p.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const selected = this.selectedId ? this.dots.find((d) => d.id === this.selectedId) : undefined;
    if (selected) {
      const p = this.toMap(selected.x, selected.z);
      const r = 6 + Math.sin(this.pulse * 5) * 1.5;
      ctx.beginPath();
      ctx.strokeStyle = '#ff8a1f';
      ctx.lineWidth = 2.5;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The camera: where it looks and which way.
    const focus = this.context.studio.cameraFocus();
    const f = this.toMap(focus.x, focus.z);
    const heading = (focus.azimuth * Math.PI) / 180;
    const back = Math.min(26, 6 + focus.distance * 0.06);
    const cx = f.x + Math.sin(heading) * back;
    const cy = f.y + Math.cos(heading) * back;
    const spread = 0.5;
    const reach = back + 14;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - Math.sin(heading - spread) * reach, cy - Math.cos(heading - spread) * reach);
    ctx.lineTo(cx - Math.sin(heading + spread) * reach, cy - Math.cos(heading + spread) * reach);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff8a1f';
    ctx.lineWidth = 2.5;
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const label = this.context.studio.placeName();
    if (this.place.textContent !== label) {
      this.place.replaceChildren(icon('pin'), el('span', '', label));
    }
  }

  private ensureData(): boolean {
    if (this.data) return true;
    this.data = this.context.studio.mapData();
    if (!this.data) return false;
    this.background = this.paintBackground(this.data);
    this.buildChips(this.data);
    return true;
  }

  private buildChips(data: WorldMapData): void {
    this.chips.replaceChildren();
    for (const { id, label } of TRIPS) {
      const district = data.districts.find((d) => d.id === id);
      if (!district) continue;
      const chip = el('button', 'st-map__chip');
      chip.type = 'button';
      chip.style.setProperty('--chip', district.color);
      chip.appendChild(icon(district.icon));
      chip.appendChild(el('span', '', label));
      chip.title = district.name;
      chip.addEventListener('click', () => this.context.studio.flyToDistrict(district.id));
      this.chips.appendChild(chip);
    }
  }

  private toMap(x: number, z: number): { x: number; y: number } {
    const half = this.data?.halfSize ?? 250;
    const scale = (SIZE - PADDING * 2) / (half * 2);
    return { x: PADDING + (x + half) * scale, y: PADDING + (z + half) * scale };
  }

  private toWorld(px: number, py: number): { x: number; z: number } {
    const half = this.data?.halfSize ?? 250;
    const scale = (SIZE - PADDING * 2) / (half * 2);
    return { x: (px - PADDING) / scale - half, z: (py - PADDING) / scale - half };
  }

  private paintBackground(data: WorldMapData): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE * this.ratio;
    canvas.height = SIZE * this.ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(this.ratio, this.ratio);
    const scale = (SIZE - PADDING * 2) / (data.halfSize * 2);

    // Meadow base with soft rounded corners.
    ctx.save();
    roundRect(ctx, 0, 0, SIZE, SIZE, 18);
    ctx.clip();
    const grass = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    grass.addColorStop(0, '#bfe6a6');
    grass.addColorStop(1, '#a5d98c');
    ctx.fillStyle = grass;
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Hills around the edge.
    ctx.strokeStyle = 'rgba(92, 140, 70, 0.35)';
    ctx.lineWidth = PADDING * 1.6;
    roundRect(ctx, 0, 0, SIZE, SIZE, 18);
    ctx.stroke();

    for (const district of data.districts) {
      if (district.kind === 'home') continue;
      const a = this.toMap(district.rect.minX, district.rect.minZ);
      const b = this.toMap(district.rect.maxX, district.rect.maxZ);
      ctx.fillStyle = withAlpha(district.color, 0.42);
      roundRect(ctx, a.x + 1, a.y + 1, b.x - a.x - 2, b.y - a.y - 2, 7);
      ctx.fill();
    }
    // Home plot: a warm dashed outline.
    const h0 = this.toMap(data.homePlot.minX, data.homePlot.minZ);
    const h1 = this.toMap(data.homePlot.maxX, data.homePlot.maxZ);
    ctx.fillStyle = 'rgba(255, 214, 140, 0.55)';
    roundRect(ctx, h0.x, h0.y, h1.x - h0.x, h1.y - h0.y, 6);
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#f08a24';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    // Open plots: dashed "build here" outlines.
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.4;
    for (const plot of data.openPlots) {
      const a = this.toMap(plot.minX, plot.minZ);
      const b = this.toMap(plot.maxX, plot.maxZ);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      roundRect(ctx, a.x, a.y, b.x - a.x, b.y - a.y, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const lake of data.lakes) {
      const c = this.toMap(lake.x, lake.z);
      ctx.beginPath();
      ctx.fillStyle = '#6cc4ee';
      ctx.strokeStyle = '#e9f7ff';
      ctx.lineWidth = 2;
      ctx.ellipse(c.x, c.y, lake.radius * scale, lake.radius * scale * 0.92, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#8a8f99';
    const t = data.tile * scale;
    for (const tile of data.roadTiles) {
      const p = this.toMap(tile.x, tile.z);
      ctx.fillRect(p.x - t / 2, p.y - t / 2, t + 0.3, t + 0.3);
    }

    // District names.
    ctx.font = '700 8.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const district of data.districts) {
      if (district.kind === 'home' || district.id === 'east') continue;
      const c = this.toMap((district.rect.minX + district.rect.maxX) / 2, (district.rect.minZ + district.rect.maxZ) / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const w = ctx.measureText(district.name).width + 8;
      roundRect(ctx, c.x - w / 2, c.y - 7, w, 13, 6);
      ctx.fill();
      ctx.fillStyle = '#3b4a3c';
      ctx.fillText(district.name, c.x, c.y + 3);
    }
    ctx.restore();
    return canvas;
  }

  private onClick(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * SIZE;
    const py = ((event.clientY - rect.top) / rect.height) * SIZE;
    // Your own creations win over travelling.
    let best: Dot | null = null;
    let bestDistance = 7;
    for (const dot of this.dots) {
      const p = this.toMap(dot.x, dot.z);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestDistance) {
        best = dot;
        bestDistance = d;
      }
    }
    if (best) {
      this.context.actions.selectPlacedObject(best.id);
      return;
    }
    const world = this.toWorld(px, py);
    this.context.studio.flyTo(world.x, world.z);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, w / 2, h / 2));
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
