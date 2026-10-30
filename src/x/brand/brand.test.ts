import { describe, expectTypeOf } from 'vitest';

import type { Brand } from './brand.ts';
import { test } from '#testing/test.ts';

describe('Brand', () => {
  // The assertions are type-level (`expectTypeOf`), which `vitest/expect-expect` does not count.
  // eslint-disable-next-line vitest/expect-expect
  test('keeps the underlying type but separates brands', () => {
    type CommitSha = Brand<string, 'CommitSha'>;
    type SessionId = Brand<string, 'SessionId'>;
    expectTypeOf<SessionId>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<SessionId>();
    expectTypeOf<CommitSha>().not.toExtend<SessionId>();
  });
});
