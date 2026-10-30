import { describe } from 'vitest';

import { dispatchAction } from './dispatch-action.ts';
import { actionTree } from './testing/action-tree.ts';
import { test } from './testing/test.ts';

describe('dispatchAction', () => {
  test('runs a nested component’s actions from an outer listener, in that component’s tree', ({
    expect,
    signal,
  }) => {
    const tree = actionTree();
    const cardRoot = { mode: 'open' };
    const card = tree.element({ action: 'card' });
    const title = tree.element({ action: 'title' }, card, cardRoot);
    const label = tree.element({}, title, cardRoot);
    const runs: string[] = [];
    tree.root.addEventListener(
      'click',
      (event) => {
        dispatchAction(event, cardRoot, {
          title: (): void => {
            runs.push('title');
          },
          card: (): void => {
            runs.push('card');
          },
        });
      },
      { signal },
    );
    tree.dispatch('click', label);
    tree.dispatch('click', card);
    expect(runs).toStrictEqual(['title']);
  });

  test('does nothing without handlers for the event’s type', ({ expect, signal }) => {
    const tree = actionTree();
    const row = tree.element({ action: 'row' });
    const runs: string[] = [];
    tree.root.addEventListener(
      'click',
      (event) => {
        dispatchAction(event, tree.root, undefined);
        runs.push(event.type);
      },
      { signal },
    );
    tree.dispatch('click', row);
    expect(runs).toStrictEqual(['click']);
  });
});
