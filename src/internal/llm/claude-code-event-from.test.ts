import { describe } from 'vitest';

import { claudeCodeEventFrom } from './claude-code-event-from.ts';
import { test } from './testing/test.ts';

describe('claudeCodeEventFrom', () => {
  test('reads the credential source from init', ({ expect }) => {
    expect(
      claudeCodeEventFrom({
        type: 'system',
        subtype: 'init',
        model: 'claude-opus-5-5',
        tools: ['Read'],
        apiKeySource: 'ANTHROPIC_API_KEY',
      }),
    ).toStrictEqual({
      kind: 'init',
      model: 'claude-opus-5-5',
      version: undefined,
      tools: ['Read'],
      apiKeySource: 'ANTHROPIC_API_KEY',
    });
  });

  test('reads a refusal fallback and the model it moved to', ({ expect }) => {
    expect(
      claudeCodeEventFrom({
        type: 'system',
        subtype: 'model_refusal_fallback',
        original_model: 'claude-opus-5-5',
        fallback_model: 'claude-opus-4-8',
      }),
    ).toStrictEqual({ kind: 'refusal-fallback', model: 'claude-opus-4-8' });
  });

  test('reads token usage from the result', ({ expect }) => {
    expect(
      claudeCodeEventFrom({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'hi',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
      }),
    ).toMatchObject({
      kind: 'result',
      result: {
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 0,
        },
      },
    });
  });
});
