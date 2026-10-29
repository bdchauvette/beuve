import { describe, expect, it } from 'vitest';

import { describeChatPlaceholder } from './describe-chat-placeholder.ts';

describe('describeChatPlaceholder', () => {
  it('stays short enough for the minimum sidebar width in either state', () => {
    for (const isAnswering of [false, true]) {
      expect(describeChatPlaceholder(isAnswering).length).toBeLessThanOrEqual(26);
    }
  });

  it('hints at commands while idle and says why sending waits while answering', () => {
    expect(describeChatPlaceholder(false)).toBe('Ask, or / for commands');
    expect(describeChatPlaceholder(true)).toContain('Answering');
  });
});
