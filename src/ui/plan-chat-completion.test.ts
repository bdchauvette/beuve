import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { planChatCompletion } from './plan-chat-completion.ts';

describe('planChatCompletion', () => {
  test('leaves every key to the input while the list is closed', ({ expect }) => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape']) {
      expect(planChatCompletion({ key, count: 0, highlighted: undefined })).toBeUndefined();
    }
  });

  test('moves the highlight with the arrows, wrapping at both ends', ({ expect }) => {
    expect(
      planChatCompletion({ key: 'ArrowDown', count: 3, highlighted: undefined }),
    ).toStrictEqual({ kind: 'highlight', index: 0 });
    expect(planChatCompletion({ key: 'ArrowDown', count: 3, highlighted: 2 })).toStrictEqual({
      kind: 'highlight',
      index: 0,
    });
    expect(planChatCompletion({ key: 'ArrowUp', count: 3, highlighted: undefined })).toStrictEqual({
      kind: 'highlight',
      index: 2,
    });
    expect(planChatCompletion({ key: 'ArrowUp', count: 3, highlighted: 1 })).toStrictEqual({
      kind: 'highlight',
      index: 0,
    });
  });

  test('chooses with Tab, the first command when none is highlighted', ({ expect }) => {
    expect(planChatCompletion({ key: 'Tab', count: 3, highlighted: undefined })).toStrictEqual({
      kind: 'choose',
      index: 0,
    });
    expect(planChatCompletion({ key: 'Tab', count: 3, highlighted: 2 })).toStrictEqual({
      kind: 'choose',
      index: 2,
    });
  });

  test('chooses with Enter only a highlighted command, else Enter sends', ({ expect }) => {
    expect(planChatCompletion({ key: 'Enter', count: 3, highlighted: 1 })).toStrictEqual({
      kind: 'choose',
      index: 1,
    });
    expect(planChatCompletion({ key: 'Enter', count: 3, highlighted: undefined })).toBeUndefined();
  });

  test('closes the list on Escape and leaves other keys alone', ({ expect }) => {
    expect(planChatCompletion({ key: 'Escape', count: 1, highlighted: 0 })).toStrictEqual({
      kind: 'dismiss',
    });
    expect(planChatCompletion({ key: 'a', count: 1, highlighted: 0 })).toBeUndefined();
  });
});
