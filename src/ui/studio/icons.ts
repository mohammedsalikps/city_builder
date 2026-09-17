/**
 * World Studio's icon set: one friendly, rounded line style (24px grid,
 * 2px strokes, round joins) so every control reads as part of one toybox.
 * Icons use `currentColor`; tiles tint them. No emoji in the final UI.
 */
const PATHS: Record<string, string> = {
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  villa: '<path d="M2.5 12 9 7l6.5 5"/><path d="M4.5 10.5V19h9v-8.5"/><path d="M13.5 13H21v6h-7.5"/><path d="M7.5 19v-4h3v4"/><path d="M16.5 15.5h2"/>',
  road: '<path d="M8 3 5 21"/><path d="M16 3l3 18"/><path d="M12 4v2.5M12 10.5v3M12 17.5V20"/>',
  tree: '<path d="M12 21v-5"/><path d="M12 3c3.6 0 6 2.8 6 6.2 0 3.3-2.6 5.8-6 5.8s-6-2.5-6-5.8C6 5.8 8.4 3 12 3Z"/><path d="M9.5 21h5"/>',
  leaf: '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14Z"/><path d="M5 19 13 11"/>',
  neighborhood: '<path d="M2.5 12 7 8.5l4.5 3.5"/><path d="M4 11v8h6v-8"/><path d="M12.5 10 17 6.5l4.5 3.5"/><path d="M14 9v10h6V9"/><path d="M16 19v-3h2v3"/>',
  town: '<path d="M3 20V10h5v10"/><path d="M8 20V5h7v15"/><path d="M15 20v-8h6v8"/><path d="M10.5 8h2M10.5 11h2M10.5 14h2"/><path d="M2 20h20"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.8" r="2.3"/>',
  factory: '<path d="M3 20V11l5 3v-3l5 3v-3l5 3V4h3v16z"/><path d="M7 17h2M12 17h2"/>',
  tower: '<path d="M7 21V4h10v17"/><path d="M10 7h4M10 10h4M10 13h4M10 16h4"/><path d="M4 21h16"/>',
  car: '<path d="M4 16v-3l2-5h12l2 5v3"/><path d="M3 16h18v2H3z"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/><path d="M6.8 12.5h10.4"/>',
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z"/><path d="M5 18v2M19 18v2"/>',
  bricks: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 9.7v4.6M9 14.3V19"/>',
  flower: '<circle cx="12" cy="9" r="2.2"/><path d="M12 6.8c0-2.6 3-2.6 3 0M14.2 9c2.6 0 2.6 3 0 3M12 11.2c0 2.6-3 2.6-3 0M9.8 9c-2.6 0-2.6-3 0-3"/><path d="M12 13v8M12 17c-2.5 0-4-1.5-4-3 2 0 4 1 4 3Z"/>',
  fence: '<path d="M5 20V7l1.5-2L8 7v13M11 20V7l1.5-2L14 7v13M17 20V7l1.5-2L20 7v13"/><path d="M3 10h19M3 16h19"/>',
  window: '<rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M12 4v16M5 12h14"/>',
  door: '<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"/><path d="M4 21h16"/><circle cx="14.5" cy="12.5" r="1"/>',
  lamp: '<path d="M8 21h8M12 21V7"/><path d="M12 7c0-2.5 2-4 5-4"/><path d="M15 5h5l-1 3h-3z"/>',
  shop: '<path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6c0 1.4-1.3 2.2-2.6 2.2S16 11.4 16 10c0 1.4-1.1 2.2-2.4 2.2S11.2 11.4 11.2 10c0 1.4-1.1 2.2-2.4 2.2S6.4 11.4 6.4 10c0 1.4-1.1 2.2-2.4 2.2"/><path d="M10 20v-5h4v5"/>',
  rock: '<path d="M3.5 18.5 6.5 10l4-4 5 2 3 5 2 5.5z"/><path d="M10.5 6 11 12l7.5 1"/>',
  planter: '<path d="M5 13h14l-2 7H7z"/><path d="M8 13c-1-3 0-6 3-7M12 13c0-3 1-5 4-6M16 13c1-2 2-3 3-3"/>',
  table: '<path d="M3 9h18"/><path d="M5 9v10M19 9v10M8 9v5h8V9"/>',
  chair: '<path d="M7 3v17M7 12h10v8M7 12V3"/><path d="M17 12V9"/>',
  bed: '<path d="M3 20V6M3 13h18v7"/><path d="M3 13v-2.5A1.5 1.5 0 0 1 4.5 9h5A1.5 1.5 0 0 1 11 10.5V13"/><path d="M11 11h8a2 2 0 0 1 2 2"/>',
  wave: '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  turn: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  size: '<path d="M4 20 20 4"/><path d="M14 4h6v6M10 20H4v-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  remove: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  sparkle: '<path d="M12 3c.8 4.2 2.8 6.2 7 7-4.2.8-6.2 2.8-7 7-.8-4.2-2.8-6.2-7-7 4.2-.8 6.2-2.8 7-7Z"/><path d="M19 16c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m14 6 4 4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.7 3.5 5.5 3.5 8.5s-1 5.8-3.5 8.5c-2.5-2.7-3.5-5.5-3.5-8.5s1-5.8 3.5-8.5Z"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/><path d="M8 11.5 10.5 9l2.5 2.5M9 11v2h3v-2"/>',
  skyline: '<path d="M2 20h20"/><path d="M4 20v-7h4v7M8 20V8h5v12M13 20v-9h3v9M16 20V5h4v15"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 8.5 4.5 4.5 0 0 1 17 18z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3l-2.3-3.4a1.5 1.5 0 0 1 2.4-1.8L8 14"/>',
  star: '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.3 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z"/>',
};

/** An inline SVG icon element string. Unknown names render an empty frame rather than throwing. */
export function iconSvg(name: string, className = 'st-icon'): string {
  const body = PATHS[name] ?? '';
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** A span holding an icon, ready to append. */
export function icon(name: string, className = 'st-icon'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'st-icon-wrap';
  span.innerHTML = iconSvg(name, className);
  return span;
}

/** The Eavara orb's own mark: a small spark over a rooftop. */
export const ORB_MARK = `<svg class="st-orb__mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <path d="M10 27 24 16l14 11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14.5 24v11.5h19V24" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M34 5.5c.7 3.2 2.1 4.6 5.3 5.3-3.2.7-4.6 2.1-5.3 5.3-.7-3.2-2.1-4.6-5.3-5.3 3.2-.7 4.6-2.1 5.3-5.3Z" fill="#fff"/>
</svg>`;
