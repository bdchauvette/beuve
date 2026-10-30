import { describe } from 'vitest';

import { safeHrefFrom } from './safe-href-from.ts';
import { test } from './testing/test.ts';

describe('safeHrefFrom', () => {
  test.for<[string, string | undefined]>([
    ['https://example.com/a b', 'https://example.com/a%20b'],
    ['HTTP://LocalHost:8080', 'http://localhost:8080/'],
    [' https://x.dev ', 'https://x.dev/'],
    ['javascript:alert(1)', undefined],
    ['JAVASCRIPT:alert(1)', undefined],
    ['java\tscript:alert(1)', undefined],
    ['data:text/html,<script>alert(1)</script>', undefined],
    ['file:///etc/passwd', undefined],
    ['//example.com', undefined],
    ['src/a.ts#L3', undefined],
    ['https://', undefined],
    ['https:/x', undefined],
  ])('%j', ([destination, expected], { expect }) => {
    expect(safeHrefFrom(destination)).toBe(expected);
  });
});
