import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { test as baseTest } from '#testing/test.ts';

import { writeFakeClaude } from './write-fake-claude.ts';

/**
 * `#testing/test.ts` with the fake `claude` CLI (ADR 0058): `fakeClaude` (worker) is the path of
 * the script {@link writeFakeClaude} wrote once into the worker's `tempRoot`. Run it with
 * `process.execPath`; a test keeps its pid and script files in its own `tempDir`.
 */
export const test = baseTest.extend('fakeClaude', { scope: 'worker' }, ({ tempRoot }): string => {
  const directory = path.join(tempRoot, 'fake-claude');
  mkdirSync(directory, { recursive: true });
  return writeFakeClaude(directory);
});
