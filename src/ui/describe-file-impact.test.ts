import { describe, expect, it } from 'vitest';

import type { FileImpactView, ImpactFindingView } from '#contract/ipc-contract.ts';

import { describeFileImpact } from './describe-file-impact.ts';

const analyzed: FileImpactView = {
  status: 'analyzed',
  path: 'src/auth.ts',
  language: 'typescript',
  parseErrors: false,
  aggregate: {
    baseFunctions: 2,
    headFunctions: 3,
    baseCognitive: 4,
    headCognitive: 30,
    cognitiveDelta: 26,
    maxCognitive: 22,
    changedFunctions: 2,
    findings: 1,
  },
  functions: [],
};

function finding(functionName: string, value: number, percentile: number): ImpactFindingView {
  return {
    kind: 'cognitive-complexity',
    path: 'src/auth.ts',
    functionName,
    startLine: 3,
    endLine: 30,
    value,
    limit: 15,
    trend: 'introduced',
    percentile,
  };
}

describe('describeFileImpact', () => {
  it('warns with the worst finding of the file', () => {
    expect(
      describeFileImpact(analyzed, [
        finding('minor', 16, 80),
        finding('handleAuth', 22, 96.4),
        { ...finding('elsewhere', 40, 99), path: 'src/other.ts' },
      ]),
    ).toMatchObject({
      tone: 'warning',
      text: 'cognitive 22 (max 15) in handleAuth · 96th pctl · +1 more',
    });
    expect(describeFileImpact(analyzed, [finding('f', 16, 1)])?.text).toContain('1st pctl');
    expect(describeFileImpact(analyzed, [finding('f', 16, 12)])?.text).toContain('12th pctl');
    expect(describeFileImpact(analyzed, [finding('f', 16, 23)])?.text).toContain('23rd pctl');
  });

  it('summarizes a file without findings', () => {
    expect(
      describeFileImpact(
        {
          ...analyzed,
          aggregate: {
            ...analyzed.aggregate,
            changedFunctions: 1,
            cognitiveDelta: -2,
            maxCognitive: 7,
          },
        },
        [],
      ),
    ).toEqual({
      tone: 'neutral',
      text: 'cognitive -2 · max 7 · 1 function changed',
      title: '',
    });
  });

  it('stays quiet when no function changed', () => {
    expect(
      describeFileImpact(
        { ...analyzed, aggregate: { ...analyzed.aggregate, changedFunctions: 0 } },
        [],
      ),
    ).toBeUndefined();
  });

  it('says why a file was skipped, except for languages ImpactGate does not read', () => {
    expect(
      describeFileImpact({ status: 'skipped', path: 'a.ts', reason: 'too-large' }, []),
    ).toMatchObject({ tone: 'neutral', text: 'skipped: too large' });
    expect(
      describeFileImpact({ status: 'skipped', path: 'a.md', reason: 'unsupported-language' }, []),
    ).toBeUndefined();
    expect(describeFileImpact(undefined, [])).toBeUndefined();
  });
});
