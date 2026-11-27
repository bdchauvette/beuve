import { describe } from 'vitest';

import type { ReviewEditPreviewView } from '#contract/ipc-contract.ts';

import { describeHarvest } from './describe-harvest.ts';
import { test } from './testing/test.ts';

describe('describeHarvest', () => {
  test('counts what staging adds and what it leaves alone', ({ expect }) => {
    expect(describeHarvest([])).toBe('The review edits match the reviewed head: nothing to stage.');
    expect(
      describeHarvest([
        edit('create', 'suggestions', 2),
        edit('attach', 'suggestions', 1),
        edit('create', 'note'),
        edit('update', 'note'),
      ]),
    ).toBe('Stage 3 suggestions in 2 notes and 2 notes with a diff.');
    expect(describeHarvest([edit('attach', 'suggestions', 1)])).toBe(
      'Stage 1 suggestion in 1 note.',
    );
    expect(describeHarvest([edit('unchanged', 'suggestions', 1), edit('unchanged', 'note')])).toBe(
      'Nothing new to stage; 2 already staged.',
    );
  });
});

function edit(
  action: ReviewEditPreviewView['action'],
  kind: ReviewEditPreviewView['kind'],
  count = 0,
): ReviewEditPreviewView {
  const suggestions = Array.from({ length: count }, (_, index) => {
    return { path: 'a.ts', startLine: index + 1, endLine: index + 1, diff: '' };
  });
  return { action, kind, anchor: { kind: 'change' }, title: 't', suggestions, diff: '' };
}
