import { describe } from 'vitest';

import type { QueueCiView } from '#contract/ipc-contract.ts';

import { describeQueueCi } from './describe-queue-ci.ts';
import { test } from './testing/test.ts';

describe('describeQueueCi', () => {
  test.for<[QueueCiView | undefined, string, string]>([
    [undefined, 'muted', 'CI not read yet'],
    [{ overall: 'failure', failing: 1 }, 'danger', 'CI failing (1 check)'],
    [{ overall: 'failure', failing: 3 }, 'danger', 'CI failing (3 checks)'],
    [{ overall: 'pending', failing: 0 }, 'warn', 'CI running'],
    [{ overall: 'success', failing: 0 }, 'ok', 'CI passing'],
    [{ overall: 'neutral', failing: 0 }, 'muted', 'CI skipped or neutral'],
    [{ overall: 'none', failing: 0 }, 'muted', 'No CI on the head'],
  ])('%o', ([ci, tone, title], { expect }) => {
    expect(describeQueueCi(ci)).toStrictEqual({ tone, title });
  });
});
