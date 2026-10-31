import type { TemplateResult } from 'lit';
import { describe } from 'vitest';

import { pathText } from './path-text.ts';
import { test } from './testing/test.ts';

describe('pathText (ADR 0082)', () => {
  test('renders a plain path as it is', ({ expect }) => {
    expect(pathText('src/app.ts').values).toStrictEqual(['src/app.ts']);
  });

  test('shows each bidi or invisible character as a styled escape', ({ expect }) => {
    const path = `invoice${character(0x20_2e)}gpj${character(0x20_0b)}.ts`;
    expect(partsOf(pathText(path))).toStrictEqual([
      'invoice',
      { escape: '⟨U+202E⟩' },
      'gpj',
      { escape: '⟨U+200B⟩' },
      '.ts',
    ]);
  });

  test('escapes a literal bracket, so a name can’t pose as an escape', ({ expect }) => {
    expect(partsOf(pathText('a⟨U+202E⟩b'))).toStrictEqual([
      'a',
      { escape: '⟨U+27E8⟩' },
      'U+202E⟩b',
    ]);
  });
});

/** An escaped character as `pathText` renders it, by what the escape shows. */
interface EscapePart {
  readonly escape: unknown;
}

/** The text and escape spans a `pathText` template renders, empty text left out. */
function partsOf(result: TemplateResult): readonly (string | EscapePart)[] {
  const [parts] = result.values as [readonly (string | TemplateResult)[]];
  return parts
    .filter((part) => part !== '')
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      return { escape: escapedValue(part) };
    });
}

function escapedValue(part: TemplateResult): unknown {
  if (part.strings.join('').includes('format-control')) {
    return part.values[0];
  }
  return part;
}

/** A character by code point, so this file holds none of the characters it tests. */
function character(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}
