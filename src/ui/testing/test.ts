import { test as vitestTest } from 'vitest';

import { createColorsOf } from './create-colors-of.ts';
import type { ColorsOf } from './create-colors-of.ts';

/**
 * Vitest's `test` for the renderer's tests (ADR 0058). `src/ui` typechecks with DOM libraries and
 * no Node types, so it cannot extend `#testing/test.ts` (which uses `node:*`). Fixtures:
 *
 * - `colorsOf` (worker): Shiki highlighting through the light TextMate theme, as the diff view does.
 */
export const test = vitestTest.extend(
  'colorsOf',
  { scope: 'worker' },
  async (): Promise<ColorsOf> => {
    return createColorsOf();
  },
);
