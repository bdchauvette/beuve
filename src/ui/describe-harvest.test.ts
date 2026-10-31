import { describe } from 'vitest';

import type { ReviewEditPreviewView } from '#contract/ipc-contract.ts';

import { describeHarvest } from './describe-harvest.ts';
import { test } from './testing/test.ts';

describe('describeHarvest', () => {
  test('counts what staging adds and what it leaves alone', ({ expect }) => {
    expect(describeHarvest([])).toBe('The review edits match the reviewed head: nothing to stage.');
    expect(
      describeHarvest([
        edit('create', 'suggestion'),
        edit('create', 'note'),
        edit('attach', 'note'),
      ]),
    ).toBe('Stage 1 suggestion and 2 notes with a diff.');
    expect(describeHarvest([edit('unchanged', 'suggestion'), edit('unchanged', 'note')])).toBe(
      'Nothing new to stage; 2 already staged.',
    );
  });
});

function edit(
  action: ReviewEditPreviewView['action'],
  kind: ReviewEditPreviewView['kind'],
): ReviewEditPreviewView {
  return { action, kind, anchor: { kind: 'change' }, title: 't', diff: '' };
}
