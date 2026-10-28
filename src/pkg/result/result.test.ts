import { describe, expect, it } from 'vitest';

import { andThen } from './and-then.ts';
import { err } from './err.ts';
import { fromPromise } from './from-promise.ts';
import { isErr } from './is-err.ts';
import { isOk } from './is-ok.ts';
import { mapErr } from './map-err.ts';
import { mapResult } from './map-result.ts';
import { ok } from './ok.ts';
import type { Result } from './result.ts';
import { tryCatch } from './try-catch.ts';
import { unwrapOr } from './unwrap-or.ts';

describe('result', () => {
  it('constructs and narrows both branches', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isErr(err('x'))).toBe(true);
  });

  it('maps success and failure independently', () => {
    expect(mapResult(parse('2'), (n) => n * 2)).toEqual(ok(4));
    expect(mapResult(parse('x'), (n) => n * 2)).toEqual(err('not a number: x'));
    expect(mapErr(parse('x'), (message) => message.length)).toEqual(err(15));
    expect(mapErr(parse('3'), (message) => message.length)).toEqual(ok(3));
  });

  it('chains fallible steps and short-circuits on the first failure', () => {
    expect(andThen(parse('5'), positive)).toEqual(ok(5));
    expect(andThen(parse('-5'), positive)).toEqual(err('not positive'));
    expect(andThen(parse('x'), positive)).toEqual(err('not a number: x'));
  });

  it('unwraps with a fallback', () => {
    expect(unwrapOr(parse('7'), 0)).toBe(7);
    expect(unwrapOr(parse('x'), 0)).toBe(0);
  });

  it('captures thrown exceptions', () => {
    expect(tryCatch(() => 1, String)).toEqual(ok(1));
    expect(tryCatch(boom, String)).toEqual(err('Error: boom'));
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

function boom(): number {
  throw new Error('boom');
}
