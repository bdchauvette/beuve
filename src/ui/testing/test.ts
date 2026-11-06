import { test as vitestTest } from 'vitest';

import { createStylesOf } from './create-styles-of.ts';
import type { StylesOf } from './create-styles-of.ts';

/**
 * Vitest's `test` for the renderer's tests (ADR 0058). `src/ui` typechecks with DOM libraries and
 * no Node types, so it cannot extend `#testing/test.ts` (which uses `node:*`). Fixtures:
 *
 * - `stylesOf` (worker): Shiki highlighting through the light TextMate theme, as the diff view does.
 */
export const test = vitestTest.extend(
  'stylesOf',
  { scope: 'worker' },
  async (): Promise<StylesOf> => {
    return createStylesOf();
  },
);
