import { describe } from 'vitest';

import type { ChatCitationView } from '#contract/ipc-contract.ts';

import { citationPlace } from './citation-place.ts';
import { test } from './testing/test.ts';

interface CitationLines {
  readonly startLine: number;
  readonly endLine: number;
}

function citationOf(lines: CitationLines): ChatCitationView {
  return { path: 'src/a.ts', ...lines };
}

describe('citationPlace', () => {
  test('gives one line as path:line', ({ expect }) => {
    expect(citationPlace(citationOf({ startLine: 7, endLine: 7 }))).toBe('src/a.ts:7');
  });

  test('gives a range as path:start-end', ({ expect }) => {
    expect(citationPlace(citationOf({ startLine: 3, endLine: 12 }))).toBe('src/a.ts:3-12');
  });
});
