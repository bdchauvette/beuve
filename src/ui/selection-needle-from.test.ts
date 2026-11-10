import { describe } from 'vitest';

import { selectionNeedleFrom } from './selection-needle-from.ts';
import { test } from './testing/test.ts';

describe('selectionNeedleFrom', () => {
  test('matches a whole selected word only as a whole word', ({ expect }) => {
    expect(selectionNeedleFrom({ text: 'count', before: ' ', after: '(' })).toStrictEqual({
      text: 'count',
      isWholeWord: true,
    });
    expect(selectionNeedleFrom({ text: '$el_2', before: '', after: '' })).toStrictEqual({
      text: '$el_2',
      isWholeWord: true,
    });
  });

  test('matches part of a word, or text that is not a word, anywhere', ({ expect }) => {
    expect(selectionNeedleFrom({ text: 'Name', before: 'r', after: ' ' })?.isWholeWord).toBe(false);
    expect(selectionNeedleFrom({ text: 'use', before: '', after: 'r' })?.isWholeWord).toBe(false);
    expect(selectionNeedleFrom({ text: 'a.b', before: ' ', after: ' ' })?.isWholeWord).toBe(false);
    expect(selectionNeedleFrom({ text: '=> ', before: ' ', after: 'x' })?.isWholeWord).toBe(false);
  });

  test('treats letters of any script as word characters', ({ expect }) => {
    expect(selectionNeedleFrom({ text: 'größe', before: '', after: '' })?.isWholeWord).toBe(true);
    expect(selectionNeedleFrom({ text: 'öß', before: 'r', after: '' })?.isWholeWord).toBe(false);
  });

  test('ignores a selection with fewer than two visible characters', ({ expect }) => {
    expect(selectionNeedleFrom({ text: '', before: '', after: '' })).toBeUndefined();
    expect(selectionNeedleFrom({ text: 'x', before: ' ', after: ' ' })).toBeUndefined();
    expect(selectionNeedleFrom({ text: ' x\t ', before: '', after: '' })).toBeUndefined();
    expect(selectionNeedleFrom({ text: ' '.repeat(4), before: '', after: '' })).toBeUndefined();
    expect(selectionNeedleFrom({ text: ' ;;', before: '', after: '' })?.text).toBe(' ;;');
  });

  test('ignores a selection over several lines or of a pasted block', ({ expect }) => {
    expect(selectionNeedleFrom({ text: 'one\ntwo', before: '', after: '' })).toBeUndefined();
    expect(selectionNeedleFrom({ text: 'one\r', before: '', after: '' })).toBeUndefined();
    expect(selectionNeedleFrom({ text: 'x'.repeat(201), before: '', after: '' })).toBeUndefined();
    expect(selectionNeedleFrom({ text: 'x'.repeat(200), before: '', after: '' })).toBeDefined();
  });
});
