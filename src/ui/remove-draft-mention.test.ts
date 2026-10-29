import { describe, expect, it } from 'vitest';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { removeDraftMention } from './remove-draft-mention.ts';

const mention: ChatMentionView = { path: 'a.ts', side: 'head', sha: 'c'.repeat(40) };
const parts = [
  { kind: 'text', text: 'Why ' },
  { kind: 'mention', mention },
  { kind: 'text', text: ' now?' },
] as const;

describe('removeDraftMention', () => {
  it('removes the whole chip before the caret on Backspace, joining the text', () => {
    expect(removeDraftMention({ parts, caret: 5 }, 'backward')).toEqual({
      parts: [{ kind: 'text', text: 'Why  now?' }],
      caret: 4,
    });
  });

  it('removes the chip after the caret on Delete', () => {
    expect(removeDraftMention({ parts, caret: 4 }, 'forward')).toEqual({
      parts: [{ kind: 'text', text: 'Why  now?' }],
      caret: 4,
    });
  });

  it('leaves text deletion to the editor', () => {
    expect(removeDraftMention({ parts, caret: 4 }, 'backward')).toBeUndefined();
    expect(removeDraftMention({ parts, caret: 5 }, 'forward')).toBeUndefined();
    expect(removeDraftMention({ parts, caret: 0 }, 'backward')).toBeUndefined();
    expect(removeDraftMention({ parts, caret: 10 }, 'forward')).toBeUndefined();
  });
});
