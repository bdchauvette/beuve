import { uraSeverities } from './ura-severities.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';
import { test } from './testing/test.ts';

test('every severity has its own emoji', ({ expect }) => {
  const emoji = uraSeverities.map((severity) => uraSeverityEmoji(severity));
  expect(emoji).toStrictEqual(['🛑', '⚠️', '❓', '⛏️', '✨']);
});
