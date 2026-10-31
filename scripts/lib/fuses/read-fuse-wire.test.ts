import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { readFuseWire } from './read-fuse-wire.ts';

describe('readFuseWire', () => {
  test('reads the version and each fuse after the sentinel', ({ expect }) => {
    const binary = withWire('\u{1}\u{5}010r1');

    expect(readFuseWire(binary)).toStrictEqual({
      ok: true,
      value: {
        version: 1,
        fuses: ['disabled', 'enabled', 'disabled', 'removed', 'enabled'],
      },
    });
  });

  test('accepts two identical wires (a universal binary)', ({ expect }) => {
    const one = withWire('\u{1}\u{2}01');
    const binary = Buffer.concat([one, one]);

    expect(readFuseWire(binary)).toStrictEqual({
      ok: true,
      value: { version: 1, fuses: ['disabled', 'enabled'] },
    });
  });

  test('refuses two wires that differ', ({ expect }) => {
    const binary = Buffer.concat([withWire('\u{1}\u{2}01'), withWire('\u{1}\u{2}11')]);

    expect(readFuseWire(binary)).toStrictEqual({
      ok: false,
      error: 'the binary has two fuse wires that differ',
    });
  });

  test('refuses a binary without a wire or with a cut-off one', ({ expect }) => {
    expect(readFuseWire(Buffer.from('not electron'))).toMatchObject({ ok: false });
    expect(
      readFuseWire(Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX\u{1}\t0', 'latin1')),
    ).toStrictEqual({ ok: false, error: 'the fuse wire is cut off' });
  });
});

/** Bytes around a fuse wire: padding, the sentinel, `wire` (version, length, fuses), padding. */
function withWire(wire: string): Buffer {
  return Buffer.from(`\0ELF...dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX${wire}...\0`, 'latin1');
}
