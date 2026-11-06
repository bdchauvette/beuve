import { test } from '#testing/test.ts';

import { agentSessionUrlFrom } from './agent-session-url-from.ts';

test.for([
  [
    'an agent commit',
    'fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_1\n',
    'https://claude.ai/code/session_1',
  ],
  [
    'the last of two',
    'fix\n\nClaude-Session: https://a.example/1\nclaude-session: https://a.example/2',
    'https://a.example/2',
  ],
  ['an ftp URL', 'fix\n\nClaude-Session: ftp://claude.ai/code/x', undefined],
  ['a javascript URL', 'fix\n\nClaude-Session: javascript:alert(1)', undefined],
  ['credentials', 'fix\n\nClaude-Session: https://u:p@claude.ai/x', undefined],
  ['no trailer', 'fix\n\nClaude-Session is mentioned in prose.', undefined],
  ['a subject only', 'Claude-Session: https://claude.ai/code/x', undefined],
] as const)('agentSessionUrlFrom reads %s', ([, message, expected], { expect }) => {
  expect(agentSessionUrlFrom(message)).toBe(expected);
});
