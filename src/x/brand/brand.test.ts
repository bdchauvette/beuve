import { describe, expectTypeOf, it } from 'vitest';

import type { Brand } from './brand.ts';

describe('Brand', () => {
  it('keeps the underlying type but separates brands', () => {
    type CommitSha = Brand<string, 'CommitSha'>;
    type SessionId = Brand<string, 'SessionId'>;
    expectTypeOf<SessionId>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<SessionId>();
    expectTypeOf<CommitSha>().not.toExtend<SessionId>();
  });
});
