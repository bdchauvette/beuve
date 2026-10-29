export type PaletteGroup = 'open' | 'files' | 'review' | 'commands';

/** The prefixes that narrow the palette to one group; its footer lists them. */
export const palettePrefixes: Readonly<Record<string, PaletteGroup>> = Object.freeze({
  '>': 'commands',
  '@': 'files',
  '#': 'open',
  '!': 'review',
});
