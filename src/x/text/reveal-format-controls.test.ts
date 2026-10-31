import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { restoreFormatControls } from './restore-format-controls.ts';
import { revealFormatControls } from './reveal-format-controls.ts';

describe('revealFormatControls (ADR 0082)', () => {
  test('shows a right-to-left override instead of letting it reorder the name', ({ expect }) => {
    expect(revealFormatControls(`invoice${character(0x20_2e)}gpj.ts`)).toBe(
      'invoice⟨U+202E⟩gpj.ts',
    );
  });

  test.for([
    // Bidi embeddings, overrides, isolates and marks.
    0x20_2a, 0x20_2b, 0x20_2c, 0x20_2d, 0x20_2e, 0x20_66, 0x20_67, 0x20_68, 0x20_69, 0x20_0e,
    0x20_0f, 0x06_1c,
    // Zero-width and other invisible format characters.
    0x20_0b, 0x20_0c, 0x20_0d, 0x20_60, 0xfe_ff, 0x00_ad, 0x18_0e, 0xe_00_41, 0xe_00_7f,
    // Default-ignorable code points that are not format characters.
    0x03_4f, 0xfe_0f, 0x31_64, 0x11_5f,
    // Control characters.
    0x00_00, 0x00_09, 0x00_0a, 0x00_0d, 0x00_1b, 0x00_7f, 0x00_85,
    // Spaces other than U+0020, and line and paragraph separators.
    0x00_a0, 0x20_00, 0x20_2f, 0x30_00, 0x20_28, 0x20_29,
    // A lone surrogate, and the escape's own opening bracket.
    0xd8_00, 0x27_e8,
  ])('escapes code point %i', (codePoint, { expect }) => {
    const name = codePoint.toString(16).toUpperCase().padStart(4, '0');
    expect(revealFormatControls(`a${character(codePoint)}b`)).toBe(`a⟨U+${name}⟩b`);
  });

  test.for([
    'src/app.ts',
    'docs/read me.md',
    'src/übersicht/café.ts',
    'src/שלום/مرحبا.ts',
    'src/日本語.ts',
    'emoji/🎉.ts',
    'a⟩b',
    '',
  ])('leaves %j unchanged', (text, { expect }) => {
    expect(revealFormatControls(text)).toBe(text);
  });

  test.for([
    [0x20_2e],
    [0x27_e8, 0x20_2e],
    [0x20_66, 0x20_69, 0x27_e8],
    [0x00_09, 0x00_0a],
    [0xdc_00],
    [0xe_00_41, 0xe_00_7f],
  ])('round-trips %j through restoreFormatControls', (codePoints, { expect }) => {
    const text = `a${codePoints.map((codePoint) => character(codePoint)).join('b')}c`;
    const revealed = revealFormatControls(text);
    const unbracketed = revealed.replaceAll('⟨', '');
    expect(revealFormatControls(unbracketed)).toBe(unbracketed);
    expect(restoreFormatControls(revealed)).toBe(text);
  });

  test('never shows two different texts the same way', ({ expect }) => {
    const texts = [`a${character(0x20_2e)}b`, 'a⟨U+202E⟩b'];
    const shown = new Set(texts.map((text) => revealFormatControls(text)));
    expect(shown.size).toBe(texts.length);
  });
});

/** A character by code point, so this file holds none of the characters it tests. */
function character(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}
