import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { linkTargetFrom } from './link-target-from.ts';
import type { LinkTarget } from './link-target-from.ts';

describe('linkTargetFrom', () => {
  test.for<[string, LinkTarget]>([
    ['https://example.com/a?b#c', { kind: 'external', href: 'https://example.com/a?b#c' }],
    ['#getting-started', { kind: 'fragment', id: 'getting-started' }],
    ['#%C3%BCber', { kind: 'fragment', id: 'über' }],
    ['setup.md', { kind: 'file', path: 'docs/setup.md' }],
    ['../src/a.ts?plain=1#L12-L20', { kind: 'file', path: 'src/a.ts', line: 12 }],
    ['setup.md#install', { kind: 'file', path: 'docs/setup.md' }],
    ['javascript:alert(1)', { kind: 'none' }],
    ['mailto:someone@example.com', { kind: 'none' }],
    ['//evil.example/x', { kind: 'none' }],
    ['../../outside.md', { kind: 'none' }],
    ['  ', { kind: 'none' }],
  ])('%s', ([href, expected], { expect }) => {
    expect(linkTargetFrom({ file: 'docs/guide.md', reference: href })).toStrictEqual(expected);
  });
});
