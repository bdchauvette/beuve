import { describe } from 'vitest';

import { delegateActions } from './delegate-actions.ts';
import type { ActionData } from './dispatch-action.ts';
import { actionTree } from './testing/action-tree.ts';
import { test } from './testing/test.ts';
import { withPayload } from './with-payload.ts';

function lineFrom({ line }: ActionData): number | undefined {
  const parsed = Number(line);
  if (line === undefined || !Number.isSafeInteger(parsed)) {
    return undefined;
  }
  return parsed;
}

describe('withPayload', () => {
  test('runs with the payload it parses, and not without one', ({ expect, signal }) => {
    const tree = actionTree();
    const lines: number[] = [];
    delegateActions(
      tree.root,
      {
        click: {
          go: withPayload(lineFrom, (line: number): void => {
            lines.push(line);
          }),
        },
      },
      { signal },
    );
    tree.dispatch('click', tree.element({ action: 'go', line: '12' }));
    tree.dispatch('click', tree.element({ action: 'go', line: 'x' }));
    tree.dispatch('click', tree.element({ action: 'go' }));
    expect(lines).toStrictEqual([12]);
  });
});
