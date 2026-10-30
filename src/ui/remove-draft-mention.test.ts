import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import { removeDraftMention } from './remove-draft-mention.ts';

function mention(): ChatMentionView {
  return { path: 'a.ts', side: 'head', sha: 'c'.repeat(40) };
}
function parts(): Parameters<typeof removeDraftMention>[0]['parts'] {
  return [
    { kind: 'text', text: 'Why ' },
    { kind: 'mention', mention: mention() },
    { kind: 'text', text: ' now?' },
  ] as const;
}

describe('removeDraftMention', () => {
  test('removes the whole chip before the caret on Backspace, joining the text', ({ expect }) => {
    expect(removeDraftMention({ parts: parts(), caret: 5 }, 'backward')).toStrictEqual({
      parts: [{ kind: 'text', text: 'Why  now?' }],
      caret: 4,
    });
  });

  test('removes the chip after the caret on Delete', ({ expect }) => {
    expect(removeDraftMention({ parts: parts(), caret: 4 }, 'forward')).toStrictEqual({
      parts: [{ kind: 'text', text: 'Why  now?' }],
      caret: 4,
    });
  });

  test('leaves text deletion to the editor', ({ expect }) => {
    expect(removeDraftMention({ parts: parts(), caret: 4 }, 'backward')).toBeUndefined();
    expect(removeDraftMention({ parts: parts(), caret: 5 }, 'forward')).toBeUndefined();
    expect(removeDraftMention({ parts: parts(), caret: 0 }, 'backward')).toBeUndefined();
    expect(removeDraftMention({ parts: parts(), caret: 10 }, 'forward')).toBeUndefined();
  });
});
