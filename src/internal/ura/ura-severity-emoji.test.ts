import { uraSeverities } from './ura-severities.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';
import { test } from './testing/test.ts';

test('every label has its own emoji', ({ expect }) => {
  const emoji = uraSeverities.map((severity) => uraSeverityEmoji(severity));
  expect(emoji).toStrictEqual([
    '⚠️',
    '💡',
    '❓',
    '⛏️',
    '💭',
    '👃',
    '✨',
    'ℹ️',
    '☑️',
    '🧹',
    '🔤',
    '💅',
    '🤏',
  ]);
  expect(new Set(emoji).size).toBe(emoji.length);
});
