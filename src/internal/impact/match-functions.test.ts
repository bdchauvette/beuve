import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import type { FunctionMeasurement } from './function-measurement.ts';
import { matchFunctions } from './match-functions.ts';

describe('matchFunctions', () => {
  test('pairs by name, then identical bodies as renames, then adds and removes', ({ expect }) => {
    const base = [
      fn('kept', { hash: 'a' }),
      fn('A.old', { hash: 'long-body', length: 40 }),
      fn('gone', { hash: 'b' }),
      fn('tiny', { hash: 'same-tiny', length: 4 }),
    ];
    const head = [
      fn('A.renamed', { hash: 'long-body', length: 40 }),
      fn('kept', { hash: 'c' }),
      fn('fresh', { hash: 'same-tiny', length: 4 }),
    ];
    expect(matchFunctions({ base, head }).map((pair) => describePair(pair))).toStrictEqual([
      'renamed A.old -> A.renamed',
      'matched kept',
      'added fresh',
      'removed gone',
      'removed tiny',
    ]);
  });

  test('pairs each base body at most once', ({ expect }) => {
    const base = [fn('one', { hash: 'shared', length: 40 })];
    const head = [
      fn('two', { hash: 'shared', length: 40 }),
      fn('three', { hash: 'shared', length: 40 }),
    ];
    expect(matchFunctions({ base, head }).map((pair) => describePair(pair))).toStrictEqual([
      'renamed one -> two',
      'added three',
    ]);
  });
});

/** A function body as matching sees it: its hash, and its length (default 10). */
interface TestBody {
  readonly hash: string;
  readonly length?: number;
}

function fn(
  name: string,
  { hash: bodyHash, length: bodyLength = 10 }: TestBody,
): FunctionMeasurement {
  return {
    name,
    startLine: 1,
    endLine: 2,
    metrics: { cognitive: 0, cyclomatic: 1, lines: 2, maxNesting: 0, parameters: 0 },
    textHash: `${name}:${bodyHash}`,
    bodyHash,
    bodyLength,
  };
}

function describePair(pair: ReturnType<typeof matchFunctions>[number]): string {
  switch (pair.kind) {
    case 'added': {
      return `added ${pair.head.name}`;
    }
    case 'removed': {
      return `removed ${pair.base.name}`;
    }
    case 'matched': {
      return `matched ${pair.head.name}`;
    }
    case 'renamed': {
      return `renamed ${pair.base.name} -> ${pair.head.name}`;
    }
  }
}
