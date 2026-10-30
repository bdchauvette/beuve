import { describe } from 'vitest';

import { andThen } from './and-then.ts';
import { err } from './err.ts';
import { fromPromise } from './from-promise.ts';
import { ok } from './ok.ts';
import type { Result } from './result.ts';
import { test } from '#testing/test.ts';

describe('result', () => {
  test('constructs and narrows both branches', ({ expect }) => {
    expect(ok(1)).toStrictEqual({ ok: true, value: 1 });
    expect(err('boom')).toStrictEqual({ ok: false, error: 'boom' });
  });

  test('chains fallible steps and short-circuits on the first failure', ({ expect }) => {
    expect(andThen(parse('5'), positive)).toStrictEqual(ok(5));
    expect(andThen(parse('-5'), positive)).toStrictEqual(err('not positive'));
    expect(andThen(parse('x'), positive)).toStrictEqual(err('not a number: x'));
  });

  test('settles promises into results', async ({ expect }) => {
    const rejected = Promise.reject(new Error('nope'));
    await expect(fromPromise(Promise.resolve(1), String)).resolves.toStrictEqual(ok(1));
    await expect(fromPromise(rejected, String)).resolves.toStrictEqual(err('Error: nope'));
  });
});

function parse(text: string): Result<number, string> {
  const value = Number(text);
  return Number.isNaN(value) ? err(`not a number: ${text}`) : ok(value);
}

function positive(n: number): Result<number, string> {
  return n > 0 ? ok(n) : err('not positive');
}
