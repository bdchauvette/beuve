import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { stepSheetHistory } from './step-sheet-history.ts';
import type { SheetHistory, SheetHistoryStep, SheetPlace } from './step-sheet-history.ts';

function place(path: string, line?: number): SheetPlace {
  if (line === undefined) {
    return { path, range: undefined };
  }
  return { path, range: { startLine: line, startCharacter: 0, endLine: line, endCharacter: 4 } };
}

function start(): SheetHistory {
  return { places: [place('a.ts', 1)], index: 0 };
}

describe('stepSheetHistory', () => {
  test('goes back and forward, and a visit drops the places ahead', ({ expect }) => {
    const once = stepSheetHistory(start(), visit(place('b.ts', 2)));
    const visited = stepSheetHistory(once, visit(place('c.ts', 3)));
    expect(visited.index).toBe(2);
    const back = stepSheetHistory(stepSheetHistory(visited, { kind: 'back' }), { kind: 'back' });
    expect(back.places[back.index]).toStrictEqual(place('a.ts', 1));
    expect(stepSheetHistory(back, { kind: 'forward' }).index).toBe(1);
    const branched = stepSheetHistory(back, { kind: 'visit', place: place('d.ts') });
    expect(branched.places.map((entry) => entry.path)).toStrictEqual(['a.ts', 'd.ts']);
    expect(branched.index).toBe(1);
  });

  test('stays put at either end and on a visit to the same place', ({ expect }) => {
    const history = start();
    expect(stepSheetHistory(history, { kind: 'back' })).toBe(history);
    expect(stepSheetHistory(history, { kind: 'forward' })).toBe(history);
    expect(stepSheetHistory(history, { kind: 'visit', place: place('a.ts', 1) })).toBe(history);
    expect(stepSheetHistory(history, { kind: 'visit', place: place('a.ts', 2) }).index).toBe(1);
  });

  test('keeps the latest hundred places', ({ expect }) => {
    let history = start();
    for (let line = 2; line <= 150; line += 1) {
      history = stepSheetHistory(history, { kind: 'visit', place: place('a.ts', line) });
    }
    expect(history.places).toHaveLength(100);
    expect(history.places[0]?.range?.startLine).toBe(51);
    expect(history.index).toBe(99);
  });
});

function visit(next: SheetPlace): SheetHistoryStep {
  return { kind: 'visit', place: next };
}
