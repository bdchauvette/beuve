import { describe, expect, it } from 'vitest';

import { andThen } from './and-then.ts';
import { err } from './err.ts';
import { fromPromise } from './from-promise.ts';
import { ok } from './ok.ts';
import type { Result } from './result.ts';

describe('result', () => {
  it('constructs and narrows both branches', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('chains fallible steps and short-circuits on the first failure', () => {
    expect(andThen(parse('5'), positive)).toEqual(ok(5));
    expect(andThen(parse('-5'), positive)).toEqual(err('not positive'));
    expect(andThen(parse('x'), positive)).toEqual(err('not a number: x'));
  });

  it('settles promises into results', async () => {
    const rejected = Promise.reject(new Error('nope'));
    await expect(fromPromise(Promise.resolve(1), String)).resolves.toEqual(ok(1));
    await expect(fromPromise(rejected, String)).resolves.toEqual(err('Error: nope'));
  });
});

function parse(text: string): Result<number, string> {
  const value = Number(text);
  return Number.isNaN(value) ? err(`not a number: ${text}`) : ok(value);
}

function positive(n: number): Result<number, string> {
  return n > 0 ? ok(n) : err('not positive');
}
