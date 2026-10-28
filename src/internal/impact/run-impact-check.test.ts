import { describe, expect, it } from 'vitest';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';

import type { Result } from '#pkg/result/result.ts';

import type { ImpactSourceFile } from './impact-input.ts';
import type { ImpactNode } from './impact-node.ts';
import { runImpactCheck } from './run-impact-check.ts';
import { parseTestSource } from './testing/parse-test-source.ts';

/** A `ParseSource` over the real grammar that fails on cue by file name. */
async function parse<T>(
  path: string,
  text: string,
  use: (root: ImpactNode, language: string) => T,
): Promise<Result<T, { readonly kind: string }>> {
  if (path.endsWith('.md')) {
    return err({ kind: 'unsupported-language' });
  }
  if (path.endsWith('.huge.ts')) {
    return err({ kind: 'too-large' });
  }
  if (path.endsWith('.wasm-broken.ts')) {
    return err({ kind: 'load-failed' });
  }
  return ok(use(await parseTestSource(text), path.endsWith('.py.ts') ? 'python' : 'typescript'));
}

const base = `
export function score(items: number[]): number {
  let total = 0;
  for (const item of items) {
    total += item;
  }
  return total;
}

export function untouched(): number {
  return 1;
}

export function retired(): void {}
`;

const head = `
export function score(items: number[]): number {
  let total = 0;
  for (const item of items) {
    if (item > 0) {
      if (item > 10) {
        if (item > 100 && item < 1000) {
          total += item;
        } else if (item > 50) {
          total -= 1;
        } else {
          for (let i = 0; i < item; i += 1) {
            while (i > 2) {
              if (i % 2 === 0 || i % 3 === 0) {
                total += 1;
              }
            }
          }
        }
      }
    }
  }
  return total;
}

export function untouched(): number {
  return 1;
}

export function fresh(flag: boolean): number {
  return flag ? 1 : 0;
}
`;

describe('runImpactCheck', () => {
  it('scores how a change moved each function and flags new breaches', async () => {
    const files: ImpactSourceFile[] = [
      {
        path: 'src/score.ts',
        baseText: base,
        headText: head,
        changedLines: {
          base: [
            { start: 5, end: 5 },
            { start: 14, end: 14 },
          ],
          head: [
            { start: 5, end: 22 },
            { start: 30, end: 33 },
          ],
        },
      },
    ];

    const report = await runImpactCheck(files, parse, { cognitiveMax: 15 });

    expect(report.population).toBe(3);
    expect(report.totals).toEqual({
      analyzedFiles: 1,
      skippedFiles: 0,
      added: 1,
      removed: 1,
      modified: 1,
      // score 1 → 32, fresh +1, retired −0
      cognitiveDelta: 32,
      findings: 1,
    });
    const [file] = report.files;
    expect(
      file?.status === 'analyzed' && file.functions.map(({ name, change }) => `${change} ${name}`),
    ).toEqual(['modified score', 'removed retired', 'added fresh']);
    expect(file?.status === 'analyzed' && file.aggregate).toEqual({
      baseFunctions: 3,
      headFunctions: 3,
      baseCognitive: 1,
      headCognitive: 33,
      cognitiveDelta: 32,
      maxCognitive: 32,
      changedFunctions: 3,
      findings: 1,
    });
    expect(file?.status === 'analyzed' && file.functions[0]).toMatchObject({
      inDiff: true,
      base: { startLine: 2, endLine: 8, metrics: { cognitive: 1, maxNesting: 1 } },
      head: { startLine: 2, metrics: { cognitive: 32, maxNesting: 7 } },
      delta: { cognitive: 31, maxNesting: 6 },
      percentile: 83.3,
    });
    expect(report.findings).toEqual([
      {
        kind: 'cognitive-complexity',
        path: 'src/score.ts',
        functionName: 'score',
        startLine: 2,
        endLine: 24,
        value: 32,
        limit: 15,
        baseValue: 1,
        trend: 'introduced',
        percentile: 83.3,
      },
    ]);
  });

  it('treats added and deleted files as all-added and all-removed', async () => {
    const report = await runImpactCheck(
      [
        {
          path: 'new.ts',
          baseText: undefined,
          headText: 'function a() {}',
          changedLines: { base: [], head: [{ start: 1, end: 1 }] },
        },
        {
          path: 'old.ts',
          baseText: 'function b() {}',
          headText: undefined,
          changedLines: { base: [{ start: 1, end: 1 }], head: [] },
        },
      ],
      parse,
    );
    expect(
      report.files.map(
        (file) => file.status === 'analyzed' && file.functions.map(({ change }) => change),
      ),
    ).toEqual([['added'], ['removed']]);
    expect(report.cognitiveMax).toBe(15);
  });

  it('reports a moved but unedited function only because the diff touches it', async () => {
    const before = 'function a() { return 1; }\nfunction b() { return 2; }\n';
    const after = 'function b() { return 2; }\nfunction a() { return 1; }\n';
    const report = await runImpactCheck(
      [
        {
          path: 'm.ts',
          previousPath: 'n.ts',
          baseText: before,
          headText: after,
          changedLines: { base: [{ start: 1, end: 1 }], head: [{ start: 2, end: 2 }] },
        },
      ],
      parse,
    );
    const [file] = report.files;
    expect(file).toMatchObject({ status: 'analyzed', path: 'm.ts', previousPath: 'n.ts' });
    expect(
      file?.status === 'analyzed' &&
        file.functions.map(({ name, change, inDiff }) => [name, change, inDiff]),
    ).toEqual([['a', 'unchanged', true]]);
  });

  it('skips files it cannot analyze instead of failing', async () => {
    const side = { baseText: 'x', headText: 'y', changedLines: { base: [], head: [] } };
    const report = await runImpactCheck(
      [
        { path: 'README.md', ...side },
        { path: 'a.huge.ts', ...side },
        { path: 'a.wasm-broken.ts', ...side },
        { path: 'a.py.ts', ...side },
        {
          path: 'image.ts',
          baseText: undefined,
          headText: undefined,
          changedLines: { base: [], head: [] },
        },
      ],
      parse,
    );
    expect(report.files.map((file) => file.status === 'skipped' && file.reason)).toEqual([
      'unsupported-language',
      'too-large',
      'parse-failed',
      'unsupported-language',
      'no-source',
    ]);
    expect(report.totals).toMatchObject({ analyzedFiles: 0, skippedFiles: 5 });
    expect(structuredClone(report)).toEqual(report);
  });
});
