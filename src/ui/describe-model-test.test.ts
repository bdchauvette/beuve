import { describe } from 'vitest';

import { describeModelTest } from './describe-model-test.ts';
import { test } from './testing/test.ts';

describe('describeModelTest', () => {
  test('shows latency and model, or the typed error', ({ expect }) => {
    expect(
      describeModelTest({ outcome: 'ok', elapsedMs: 1234, model: 'qwen3:8b' }, 'en'),
    ).toStrictEqual({
      tone: 'ok',
      text: 'OK · 1s 234ms · qwen3:8b',
    });
    expect(
      describeModelTest(
        {
          outcome: 'failed',
          elapsedMs: 40,
          errorKind: 'not-authenticated',
          message: 'Not signed in: invalid api key',
        },
        'en',
      ),
    ).toStrictEqual({
      tone: 'warn',
      text: 'Failed (not-authenticated) after 40ms: Not signed in: invalid api key',
    });
  });
});
