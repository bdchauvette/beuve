import { test as baseTest } from '#testing/test.ts';

import { createVitestFixture } from './create-vitest-fixture.ts';
import type { VitestFixture } from './create-vitest-fixture.ts';

/** Creates {@link VitestFixture}s that live under the test's `tempDir`. */
export interface VitestFixtures {
  readonly create: (files: Readonly<Record<string, string>>) => VitestFixture;
}

/**
 * `#testing/test.ts` with trace fixtures (ADR 0058): `vitestFixtures.create(files)` makes a
 * throwaway Vitest project inside the test's `tempDir`, removed with it.
 */
export const test = baseTest.extend('vitestFixtures', ({ tempDir }): VitestFixtures => {
  return {
    create: (files): VitestFixture => {
      return createVitestFixture(files, tempDir);
    },
  };
});
