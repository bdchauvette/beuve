import { describe } from 'vitest';

import { describeModelTest } from './describe-model-test.ts';
import { test } from './testing/test.ts';

describe('describeModelTest', () => {
  test('shows latency and model, or the typed error', ({ expect }) => {
    expect(describeModelTest({ outcome: 'ok', elapsedMs: 1234, model: 'qwen3:8b' })).toStrictEqual({
      tone: 'ok',
      text: 'OK · 1.2 s · qwen3:8b',
    });
    expect(
      describeModelTest({
        outcome: 'failed',
        elapsedMs: 40,
        errorKind: 'not-authenticated',
        message: 'Not signed in: invalid api key',
      }),
    ).toStrictEqual({
      tone: 'warn',
      text: 'Failed (not-authenticated) after 0.0 s: Not signed in: invalid api key',
    });
  });
});
