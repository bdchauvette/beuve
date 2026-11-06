import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { isFontFamilyList } from './is-font-family-list.ts';

describe('isFontFamilyList', () => {
  test.for([
    '',
    '  ',
    'Menlo',
    'JetBrains Mono',
    '"JetBrains Mono", Menlo, monospace',
    "'Iosevka Term', ui-monospace",
    'Noto Sans JP, sans-serif',
    '"游ゴシック", sans-serif',
    '-apple-system, system-ui',
  ])('accepts %j', (value, { expect }) => {
    expect(isFontFamilyList(value)).toBe(true);
  });

  test.for([
    'Menlo; color: red',
    'var(--beuve-font-family-sans)',
    'url(x.woff2)',
    '"Unclosed',
    '"a\\" b"',
    'Menlo,',
    ', Menlo',
    '3270 Font',
    'inherit',
    'Menlo, initial',
    'Menlo }',
    'a\nb',
    `"${'x'.repeat(200)}"`,
  ])('refuses %j', (value, { expect }) => {
    expect(isFontFamilyList(value)).toBe(false);
  });
});
