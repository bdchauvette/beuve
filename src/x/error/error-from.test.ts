import { runInNewContext } from 'node:vm';
import { describe } from 'vitest';

import { errorFrom } from './error-from.ts';
import { test } from '#testing/test.ts';

describe('errorFrom', () => {
  test('returns an error as it is', ({ expect }) => {
    const error = new TypeError('boom', { cause: 'inner' });

    expect(errorFrom(error)).toBe(error);
  });

  test('returns an error from another realm as it is', ({ expect }) => {
    const foreign: unknown = runInNewContext('new RangeError("from afar")');

    expect(Object.getPrototypeOf(foreign)).not.toBe(Error.prototype);
    expect(errorFrom(foreign)).toBe(foreign);
    expect(errorFrom(foreign).message).toBe('from afar');
  });

  test.for([
    ['boom', 'Non-error thrown: "boom"'],
    ['', 'Non-error thrown: ""'],
    [42, 'Non-error thrown: 42'],
    [true, 'Non-error thrown: true'],
    [undefined, 'Non-error thrown: undefined'],
    [JSON.parse('null') as unknown, 'Non-error thrown: null'],
    [10n, 'Non-error thrown: 10'],
    [Symbol('why'), 'Non-error thrown: Symbol(why)'],
  ] as const)('describes %s', ([value, message], { expect }) => {
    const error = errorFrom(value);

    expect(error.message).toBe(message);
    expect(error.cause).toBe(value);
  });

  test('describes functions by name', ({ expect }) => {
    expect(errorFrom(namedFunction).message).toBe('Non-error thrown: function namedFunction');
    expect(errorFrom((): string => 'anonymous').message).toBe(
      'Non-error thrown: function anonymous',
    );
  });

  test('describes objects by constructor, message or keys', ({ expect }) => {
    class Failure {
      readonly code = 1;
    }

    expect(errorFrom({ message: 'bad' }).message).toBe(
      'Non-error thrown: Object with message "bad"',
    );
    expect(errorFrom({ code: 'E1', path: '/x' }).message).toBe(
      'Non-error thrown: Object with keys code, path',
    );
    expect(errorFrom(new Failure()).message).toBe('Non-error thrown: Failure with keys code');
    expect(errorFrom({}).message).toBe('Non-error thrown: Object');
    expect(errorFrom([]).message).toBe('Non-error thrown: Array');
    expect(errorFrom({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }).message).toBe(
      'Non-error thrown: Object with keys a, b, c, d, e, …',
    );
  });

  test('keeps the original object as the cause', ({ expect }) => {
    const value = { code: 'E1' };

    expect(errorFrom(value).cause).toBe(value);
  });

  test('never calls the value own conversions', ({ expect }) => {
    const hostile = {
      toString: (): string => {
        throw new Error('toString called');
      },
      toJSON: (): string => {
        throw new Error('toJSON called');
      },
      [Symbol.toPrimitive]: (): string => {
        throw new Error('toPrimitive called');
      },
    };

    expect(errorFrom(hostile).message).toBe('Non-error thrown: Object with keys toString, toJSON');
  });

  test('survives a null-prototype object', ({ expect }) => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['code'] = 7;

    expect(errorFrom(bare).message).toBe('Non-error thrown: Object with keys code');
    expect(errorFrom(Object.create(null)).message).toBe('Non-error thrown: Object');
  });

  test('survives getters that throw and a revoked proxy', ({ expect }) => {
    const trap = {
      get message(): string {
        throw new Error('getter called');
      },
    };
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(errorFrom(trap).message).toBe('Non-error thrown: Object with keys message');
    expect(errorFrom(proxy).message).toBe('Non-error thrown: an unprintable value');
  });

  test('survives a circular object', ({ expect }) => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;

    expect(errorFrom(loop).message).toBe('Non-error thrown: Object with keys self');
  });

  test('bounds the message without cutting a surrogate pair', ({ expect }) => {
    const long = errorFrom('x'.repeat(10_000)).message;
    const astral = errorFrom('x'.repeat(199) + '🙂'.repeat(50)).message;

    expect(long.length).toBeLessThan(260);
    expect(long.endsWith('…')).toBe(true);
    expect(astral.isWellFormed()).toBe(true);
  });
});

function namedFunction(): string {
  return 'named';
}
