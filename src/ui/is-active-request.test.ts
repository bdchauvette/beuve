import { describe } from 'vitest';

import type { ChatMessageView } from '#contract/ipc-contract.ts';

import { isActiveRequest } from './is-active-request.ts';
import { test } from './testing/test.ts';

describe('isActiveRequest', () => {
  test.for<[ChatMessageView['status'], boolean]>([
    ['queued', false],
    ['submitted', true],
    ['streaming', true],
    ['done', false],
    ['error', false],
    ['cancelled', false],
  ])('%s: %s', ([status, isActive], { expect }) => {
    expect(
      isActiveRequest({
        id: 'a1',
        sessionId: 's1',
        headSha: 'a'.repeat(40),
        role: 'assistant',
        parts: [],
        citations: [],
        status,
        createdAt: '2026-10-28T12:00:00.000Z',
      }),
    ).toBe(isActive);
  });
});
