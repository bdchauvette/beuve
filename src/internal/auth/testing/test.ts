import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { test as baseTest } from '#testing/test.ts';

import { writeFakeGh } from './write-fake-gh.ts';

/**
 * `#testing/test.ts` with the fake `gh` CLI (ADR 0058): `fakeGh` (worker) is the path of the
 * script {@link writeFakeGh} wrote once into the worker's `tempRoot`. Run it with
 * `process.execPath` and a scenario file from the test's `tempDir`.
 */
export const test = baseTest.extend('fakeGh', { scope: 'worker' }, ({ tempRoot }): string => {
  const directory = path.join(tempRoot, 'fake-gh');
  mkdirSync(directory, { recursive: true });
  return writeFakeGh(directory);
});
