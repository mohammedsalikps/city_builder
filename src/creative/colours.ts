/**
 * The colours a child can paint furniture and decorations with - one fixed,
 * friendly palette shared by the object card's Colour swatches and the AI
 * builder's "make the cupboards white". A fixed list keeps the renderer's
 * cache of painted materials small and every colour readable in the world.
 */
export interface PaintColour {
  id: string;
  /** What the child sees and says. */
  name: string;
  hex: string;
  /** Other words children use for it (matched as whole words). */
  words: string[];
}

export const PAINT_COLOURS: readonly PaintColour[] = [
  { id: 'white', name: 'white', hex: '#f4f3ef', words: ['white', 'snow'] },
  { id: 'cream', name: 'cream', hex: '#efe0bf', words: ['cream', 'beige'] },
  { id: 'yellow', name: 'sunny yellow', hex: '#ffd36b', words: ['yellow', 'gold', 'golden'] },
  { id: 'orange', name: 'orange', hex: '#ffa552', words: ['orange'] },
  { id: 'coral', name: 'coral', hex: '#ff8a6b', words: ['coral', 'peach'] },
  { id: 'red', name: 'red', hex: '#e8505b', words: ['red'] },
  { id: 'pink', name: 'pink', hex: '#f59ac4', words: ['pink'] },
  { id: 'lavender', name: 'lavender', hex: '#b49bff', words: ['lavender', 'lilac', 'purple', 'violet'] },
  { id: 'blue', name: 'sky blue', hex: '#6fb8ff', words: ['blue', 'sky blue', 'light blue'] },
  { id: 'navy', name: 'navy', hex: '#34507f', words: ['navy', 'dark blue'] },
  { id: 'green', name: 'leaf green', hex: '#6cc58a', words: ['green', 'mint'] },
  { id: 'wood', name: 'wood brown', hex: '#a0703f', words: ['brown', 'wood', 'wooden'] },
  { id: 'grey', name: 'grey', hex: '#9aa3ad', words: ['grey', 'gray', 'silver'] },
  { id: 'charcoal', name: 'charcoal', hex: '#4a5160', words: ['black', 'charcoal', 'dark grey', 'dark gray'] },
];

/** The palette colour a phrase names ("make it light blue" -> sky blue), longest match first; null if none. */
export function colourIn(text: string): PaintColour | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `;
  let best: { colour: PaintColour; length: number } | null = null;
  for (const colour of PAINT_COLOURS) {
    for (const word of colour.words) {
      if (t.includes(` ${word} `) && (!best || word.length > best.length)) best = { colour, length: word.length };
    }
  }
  return best?.colour ?? null;
}

export function colourByHex(hex: string | null | undefined): PaintColour | null {
  if (!hex) return null;
  const lower = hex.toLowerCase();
  return PAINT_COLOURS.find((c) => c.hex === lower) ?? null;
}
