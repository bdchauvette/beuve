import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ChatMentionView } from '#contract/ipc-contract.ts';

import type { DraftPart } from './chat-draft.ts';
import { insertDraftText } from './insert-draft-text.ts';

function chip(): DraftPart {
  const mention: ChatMentionView = {
    path: 'src/discounts.ts',
    side: 'head',
    startLine: 27,
    endLine: 33,
    sha: 'c'.repeat(40),
  };
  return { kind: 'mention', mention };
}

describe('insertDraftText', () => {
  test('starts an empty draft', ({ expect }) => {
    expect(insertDraftText({ parts: [], caret: 0 }, '\n')).toStrictEqual({
      parts: [{ kind: 'text', text: '\n' }],
      caret: 1,
    });
  });

  test('splits the text at the caret', ({ expect }) => {
    const state = { parts: [{ kind: 'text', text: 'onetwo' }] as const, caret: 3 };
    expect(insertDraftText(state, '\n')).toStrictEqual({
      parts: [{ kind: 'text', text: 'one\ntwo' }],
      caret: 4,
    });
  });

  test('joins the text before a chip when the caret is at its end', ({ expect }) => {
    const state = { parts: [{ kind: 'text', text: 'see ' }, chip()] as const, caret: 4 };
    expect(insertDraftText(state, '\n')).toStrictEqual({
      parts: [{ kind: 'text', text: 'see \n' }, chip()],
      caret: 5,
    });
  });

  test('starts a run between two chips, and after the last', ({ expect }) => {
    const between = insertDraftText({ parts: [chip(), chip()], caret: 1 }, '\n');
    const after = insertDraftText({ parts: [chip()], caret: 1 }, '\n');
    expect([between, after]).toStrictEqual([
      { parts: [chip(), { kind: 'text', text: '\n' }, chip()], caret: 2 },
      { parts: [chip(), { kind: 'text', text: '\n' }], caret: 2 },
    ]);
  });
});
