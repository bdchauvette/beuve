import { describe, expect, it } from 'vitest';

import { describeUraItem } from './describe-ura-item.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';

describe('describeUraItem', () => {
  it('labels a line note by where it sits on the current head', () => {
    const item = createUraItemView({
      placement: {
        kind: 'current',
        anchor: { kind: 'lines', path: 'src/b.ts', startLine: 7, endLine: 8 },
      },
    });
    expect(describeUraItem(item)).toEqual({
      severity: 'Issue',
      anchor: 'src/b.ts:7-8',
      origin: 'human',
    });
  });

  it('labels single lines, files, the whole change and each origin', () => {
    const single = createUraItemView({
      anchor: { kind: 'lines', path: 'a.ts', startLine: 2, endLine: 2 },
      placement: {
        kind: 'current',
        anchor: { kind: 'lines', path: 'a.ts', startLine: 2, endLine: 2 },
      },
      severity: 'blocker',
      origin: { kind: 'agent-insight', insightId: 'i' },
    });
    expect(describeUraItem(single)).toMatchObject({
      severity: 'Blocker',
      anchor: 'a.ts:2',
      origin: 'agent insight',
    });
    const file = createUraItemView({
      placement: { kind: 'current', anchor: { kind: 'file', path: 'README.md' } },
      origin: {
        kind: 'impact-finding',
        metric: 'cognitive-complexity',
        functionName: 'f',
        value: 20,
        threshold: 15,
        percentile: 90,
      },
    });
    expect(describeUraItem(file)).toMatchObject({ anchor: 'README.md', origin: 'ImpactGate' });
    const change = createUraItemView({
      placement: { kind: 'current', anchor: { kind: 'change' } },
    });
    expect(describeUraItem(change).anchor).toBe('whole change');
  });

  it('keeps the original anchor of an outdated item and says why', () => {
    const item = createUraItemView({ placement: { kind: 'outdated', reason: 'lines-changed' } });
    expect(describeUraItem(item)).toMatchObject({
      anchor: 'src/a.ts:3-4',
      outdated: 'outdated: the lines changed',
    });
    expect(
      describeUraItem(
        createUraItemView({ placement: { kind: 'outdated', reason: 'no-line-mapping' } }),
      ).outdated,
    ).toBe('outdated: its head is gone');
  });
});
