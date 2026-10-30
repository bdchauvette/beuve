import { describe } from 'vitest';

import type { ModelStreamEvent } from '#internal/chat/apply-model-event.ts';

import { describeChatActivity } from './describe-chat-activity.ts';
import { test } from './testing/test.ts';

describe('describeChatActivity', () => {
  test.for<[ModelStreamEvent, string | undefined]>([
    [{ kind: 'progress', progress: { kind: 'started', model: 'm' } }, undefined],
    [{ kind: 'progress', progress: { kind: 'thinking' } }, 'Qwen is thinking'],
    [
      {
        kind: 'progress',
        progress: { kind: 'tool-start', id: 't', tool: 'Read', description: 'read a.ts:1-9' },
      },
      'Qwen: read a.ts:1-9',
    ],
    [
      { kind: 'progress', progress: { kind: 'tool-end', id: 't', tool: 'Read', ok: true } },
      'Qwen is thinking',
    ],
    [{ kind: 'progress', progress: { kind: 'text-start' } }, 'Qwen is writing'],
    [{ kind: 'progress', progress: { kind: 'text-end' } }, undefined],
    [{ kind: 'text', delta: { kind: 'append', text: 'It ' } }, 'Qwen is writing'],
    [{ kind: 'text', delta: { kind: 'append', text: '' } }, undefined],
    [{ kind: 'text', delta: { kind: 'reset' } }, undefined],
    [{ kind: 'stop' }, undefined],
  ])('%j', ([event, expected], { expect }) => {
    expect(describeChatActivity('Qwen', event)).toBe(expected);
  });
});
