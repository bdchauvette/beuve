import { test } from '#testing/test.ts';

import { ScrollbackBuffer } from './scrollback-buffer.ts';

test('keeps everything under the limit and counts what it saw', ({ expect }) => {
  const buffer = new ScrollbackBuffer(100);
  buffer.append('one\n');
  buffer.append('two\n');
  expect(buffer.text).toBe('one\ntwo\n');
  expect(buffer.end).toBe(8);
});

test('drops from the start, at a line boundary, past the limit', ({ expect }) => {
  const buffer = new ScrollbackBuffer(10);
  buffer.append('aaaa\nbbbb\ncccc\n');
  expect(buffer.text).toBe('cccc\n');
  expect(buffer.end).toBe(15);
});

test('drops mid-line when a single line exceeds the limit', ({ expect }) => {
  const buffer = new ScrollbackBuffer(4);
  buffer.append('abcdefgh');
  expect(buffer.text).toBe('efgh');
  expect(buffer.end).toBe(8);
});
