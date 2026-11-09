import { describe } from 'vitest';

import { test } from '../../testing/test.ts';

import { withoutHandlers } from './without-handlers.ts';

describe('withoutHandlers', () => {
  test.for<[string, string]>([
    ['<img src=x onerror=alert(1)>', '<img src=x data-dropped-onerror=alert(1)>'],
    ['<svg/onload=a()>', '<svg/data-dropped-onload=a()>'],
    ['<a title="x"onclick = "b">', '<a title="x"data-dropped-onclick = "b">'],
    ['<p title="on=1">turn on=off</p>', '<p title="on=1">turn on=off</p>'],
    [
      'A["<img src=x onerror=alert(1)>"] --> B',
      'A["<img src=x data-dropped-onerror=alert(1)>"] --> B',
    ],
  ])('%s', ([text, expected], { expect }) => {
    expect(withoutHandlers(text)).toBe(expected);
  });
});
