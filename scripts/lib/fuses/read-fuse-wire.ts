import { err } from '../../../src/x/result/err.ts';
import { ok } from '../../../src/x/result/ok.ts';
import type { Result } from '../../../src/x/result/result.ts';

/** One fuse's byte: `'0'` disabled, `'1'` enabled, `'r'` removed from this Electron. */
export type FuseState = 'disabled' | 'enabled' | 'removed' | 'unknown';

/** The fuse wire of an Electron binary, in Electron's fuse order (`FuseV1Options`). */
export interface FuseWire {
  readonly version: number;
  readonly fuses: readonly FuseState[];
}

/** Electron's marker before the wire: a version byte, a length byte, then one byte per fuse. */
const sentinel = new TextEncoder().encode('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');

/**
 * Reads the fuses from an Electron executable (Linux) or its `Electron Framework` (macOS), as
 * `@electron/fuses` does, without depending on it. Refuses a binary with no wire, or two wires
 * that differ (a universal build whose slices disagree).
 */
export function readFuseWire(binary: Uint8Array): Result<FuseWire, string> {
  const buffer = Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength);
  const first = buffer.indexOf(sentinel);
  if (first === -1) {
    return err('no fuse wire sentinel: not an Electron 12 or later binary');
  }
  const wire = wireAt(buffer, first + sentinel.length);
  const last = buffer.lastIndexOf(sentinel);
  if (last !== first) {
    const other = wireAt(buffer, last + sentinel.length);
    if (other === undefined || other.fuses.join(',') !== wire?.fuses.join(',')) {
      return err('the binary has two fuse wires that differ');
    }
  }
  return wire === undefined ? err('the fuse wire is cut off') : ok(wire);
}

function wireAt(buffer: Buffer, position: number): FuseWire | undefined {
  const version = buffer[position];
  const length = buffer[position + 1];
  if (version === undefined || length === undefined || position + 2 + length > buffer.length) {
    return undefined;
  }
  const bytes = buffer.subarray(position + 2, position + 2 + length);
  return { version, fuses: Array.from(bytes, (byte) => fuseStateFrom(byte)) };
}

function fuseStateFrom(byte: number): FuseState {
  switch (String.fromCodePoint(byte)) {
    case '0': {
      return 'disabled';
    }
    case '1': {
      return 'enabled';
    }
    case 'r': {
      return 'removed';
    }
    default: {
      return 'unknown';
    }
  }
}
