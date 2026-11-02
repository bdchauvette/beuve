import { describe } from 'vitest';

import { clampSidebarWidth } from './clamp-sidebar-width.ts';
import { test } from './testing/test.ts';

describe('clampSidebarWidth', () => {
  test.for([
    [{ width: 400, available: 1600 }, 400],
    [{ width: 100, available: 1600 }, 240],
    [{ width: 2000, available: 4000 }, 900],
    [{ width: 2000, available: 1000 }, 600],
    [{ width: 300.6, available: 1600 }, 301],
  ] as const)('%j gives %i', ([options, expected], { expect }) => {
    expect(clampSidebarWidth(options)).toBe(expected);
  });

  test('never goes under the minimum, even in a narrow workspace', ({ expect }) => {
    expect(clampSidebarWidth({ width: 500, available: 300 })).toBe(240);
  });
});
