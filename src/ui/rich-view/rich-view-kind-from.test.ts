import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { richViewKindFrom } from './rich-view-kind-from.ts';
import type { RichViewKind } from './rich-view-kind-from.ts';

describe('richViewKindFrom', () => {
  test.for<[string, RichViewKind | undefined]>([
    ['README.md', 'markdown'],
    ['docs/guide.markdown', 'markdown'],
    ['CHANGELOG.MD', 'markdown'],
    ['page.mdx', undefined],
    ['notes.md.txt', undefined],
    ['src/md.ts', undefined],
    ['README', undefined],
  ])('%s', ([path, expected], { expect }) => {
    expect(richViewKindFrom(path)).toBe(expected);
  });
});
