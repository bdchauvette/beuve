import { describe } from 'vitest';

import type { DiffDisplayView } from '#contract/ipc-contract.ts';

import { displayChangeFor } from './display-change-for.ts';
import type { DisplayCommandId } from './display-change-for.ts';
import { createDiffDisplay } from './testing/create-diff-display.ts';
import { test } from './testing/test.ts';

describe('displayChangeFor', () => {
  test.for([
    ['diff-split', { layout: 'split' }],
    ['diff-inline', { layout: 'unified' }],
    ['order-path', { reviewOrder: 'path' }],
    ['order-imports', { reviewOrder: 'imports' }],
    ['order-calls', { reviewOrder: 'calls' }],
    ['sheets-window', { sheets: 'window' }],
    ['sheets-inline', { sheets: 'inline' }],
  ] as const)('%s sets %j regardless of the display', ([id, change], { expect }) => {
    expect(displayChangeFor(id, createDiffDisplay())).toStrictEqual(change);
    expect(
      displayChangeFor(id, createDiffDisplay({ layout: 'unified', reviewOrder: 'calls' })),
    ).toStrictEqual(change);
  });

  test.for([
    ['whitespace', 'ignoreWhitespace', false, true],
    ['whitespace', 'ignoreWhitespace', true, false],
    ['toggle-generated', 'showGenerated', false, true],
    ['toggle-generated', 'showGenerated', true, false],
    ['toggle-insights', 'showInsights', true, false],
    ['toggle-insights', 'showInsights', false, true],
    ['toggle-skip-reviewed', 'skipReviewed', false, true],
    ['toggle-skip-reviewed', 'skipReviewed', true, false],
  ] as const)('%s flips %s from %s to %s', ([id, key, from, to], { expect }) => {
    const command: DisplayCommandId = id;
    expect(displayChangeFor(command, createDiffDisplay({ [key]: from }))).toStrictEqual({
      [key]: to,
    });
  });

  test('treats an unset skip-reviewed as off', ({ expect }) => {
    const display: DiffDisplayView = {
      layout: 'split',
      ignoreWhitespace: false,
      sidebarSide: 'right',
      showGenerated: false,
      showInsights: true,
      reviewOrder: 'path',
    };
    expect(displayChangeFor('toggle-skip-reviewed', display)).toStrictEqual({ skipReviewed: true });
  });
});
