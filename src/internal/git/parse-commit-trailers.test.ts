import { describe } from 'vitest';

import { parseCommitTrailers } from './parse-commit-trailers.ts';
import { test } from './testing/test.ts';

describe('parseCommitTrailers', () => {
  test.for([
    [
      'an agent commit',
      'fix: login\n\nWhy.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_1\n',
      [
        { key: 'Co-Authored-By', value: 'Claude <noreply@anthropic.com>' },
        { key: 'Claude-Session', value: 'https://claude.ai/code/session_1' },
      ],
    ],
    [
      'a folded value and CRLF',
      'subject\r\n\r\nSigned-off-by: A\r\n  B <a@b>\r\n',
      [{ key: 'Signed-off-by', value: 'A B <a@b>' }],
    ],
    ['a subject only', 'Key: value\n', []],
    ['a prose last paragraph', 'subject\n\nKey: value\nnot a trailer\n', []],
    ['an empty message', '', []],
    ['a URL in prose', 'subject\n\nsee https://example.com\n', []],
  ] as const)('reads %s', ([, message, expected], { expect }) => {
    expect(parseCommitTrailers(message)).toStrictEqual(expected);
  });
});
