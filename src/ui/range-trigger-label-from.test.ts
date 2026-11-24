import { describe } from 'vitest';

import { rangeTriggerLabelFrom } from './range-trigger-label-from.ts';
import { test } from './testing/test.ts';

describe('rangeTriggerLabelFrom', () => {
  test('names what the diff shows for each range', ({ expect }) => {
    expect(rangeTriggerLabelFrom('Interdiff · exact', { kind: 'since-last' })).toBe(
      'Interdiff · exact',
    );
    expect(rangeTriggerLabelFrom('Full review', { kind: 'whole' })).toBe('Whole change');
    expect(
      rangeTriggerLabelFrom('Interdiff · exact', { kind: 'since-checkpoint', checkpointId: 'c1' }),
    ).toBe('Interdiff · exact since an earlier save');
  });
});
