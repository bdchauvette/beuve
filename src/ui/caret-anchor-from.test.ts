import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { caretAnchorFrom } from './caret-anchor-from.ts';
import type { ViewportBox } from './caret-anchor-from.ts';

function field(): ViewportBox {
  return { left: 100, top: 200, right: 400, bottom: 300 };
}

describe('caretAnchorFrom', () => {
  test("anchors at the character's start, on its line", ({ expect }) => {
    const character = { left: 140, top: 230, right: 147, bottom: 248 };
    expect(caretAnchorFrom({ field: field(), character })).toStrictEqual({
      x: 140,
      top: 230,
      bottom: 248,
    });
  });

  test('holds a character scrolled above the field at its top edge', ({ expect }) => {
    const character = { left: 140, top: 150, right: 147, bottom: 168 };
    expect(caretAnchorFrom({ field: field(), character })).toStrictEqual({
      x: 140,
      top: 200,
      bottom: 200,
    });
  });

  test('holds a character scrolled past the end of the field at its edges', ({ expect }) => {
    const character = { left: 520, top: 290, right: 527, bottom: 308 };
    expect(caretAnchorFrom({ field: field(), character })).toStrictEqual({
      x: 400,
      top: 290,
      bottom: 300,
    });
  });
});
