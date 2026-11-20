import { describe } from 'vitest';

import { describeAgentOrigin } from './describe-agent-origin.ts';
import { test } from './testing/test.ts';

describe('describeAgentOrigin', () => {
  test('has nothing to say about a note you wrote', ({ expect }) => {
    expect(describeAgentOrigin({ kind: 'human' })).toBeUndefined();
  });

  test('names a finding with its confidence, a proposal, and an answer', ({ expect }) => {
    expect(
      describeAgentOrigin({ kind: 'chat-answer', messageId: 'm', finding: 2, confidence: 0.816 }),
    ).toStrictEqual({
      source: 'From a /review finding, 82% confidence',
      messageId: 'm',
      finding: 2,
    });
    expect(describeAgentOrigin({ kind: 'chat-answer', messageId: 'm', finding: 0 })).toStrictEqual({
      source: 'From a /review finding',
      messageId: 'm',
      finding: 0,
    });
    expect(describeAgentOrigin({ kind: 'chat-answer', messageId: 'm', proposal: 1 })).toStrictEqual(
      { source: 'Proposed in a chat answer', messageId: 'm', proposal: 1 },
    );
    expect(describeAgentOrigin({ kind: 'chat-answer', messageId: 'm' })).toStrictEqual({
      source: 'Staged from a chat answer',
      messageId: 'm',
    });
  });
});
