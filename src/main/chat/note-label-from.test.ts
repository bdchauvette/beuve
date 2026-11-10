import { describe } from 'vitest';

import { uraSeverities } from '#internal/ura/ura-severities.ts';

import { chatPartViewFrom } from './chat-part-view-from.ts';
import { noteLabelFrom } from './note-label-from.ts';
import { test } from './testing/test.ts';

describe('noteLabelFrom', () => {
  test('knows every URA severity and nothing else', ({ expect }) => {
    expect(uraSeverities.map((label) => noteLabelFrom(label))).toStrictEqual([...uraSeverities]);
    expect(noteLabelFrom('major')).toBeUndefined();
  });

  test('makes a stored proposal with a retired label read as dropped', ({ expect }) => {
    const note = {
      path: 'a.rs',
      startLine: 1,
      endLine: 1,
      label: 'major',
      blocking: false,
      title: '',
      body: 'B',
    };
    expect(chatPartViewFrom({ kind: 'proposal', id: 'p2', proposal: 0, note })).toStrictEqual({
      kind: 'dropped-proposal',
      id: 'p2',
      reason: 'unknown-label',
    });
    const nit = { ...note, label: 'nitpick' };
    expect(chatPartViewFrom({ kind: 'proposal', id: 'p2', proposal: 0, note: nit })).toStrictEqual({
      kind: 'proposal',
      id: 'p2',
      proposal: 0,
      note: nit,
    });
  });
});
