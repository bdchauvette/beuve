import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeChatPlaceholder } from './describe-chat-placeholder.ts';

describe('describeChatPlaceholder', () => {
  test('stays short enough for the minimum sidebar width in either state', ({ expect }) => {
    for (const isAnswering of [false, true]) {
      expect(describeChatPlaceholder(isAnswering).length).toBeLessThanOrEqual(26);
    }
  });

  test('hints at commands while idle and says that what is sent queues while answering', ({
    expect,
  }) => {
    expect(describeChatPlaceholder(false)).toBe('Ask, or / for commands');
    expect(describeChatPlaceholder(true)).toContain('waits its turn');
  });
});
