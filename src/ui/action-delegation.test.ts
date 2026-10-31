import { describe } from 'vitest';

import { ActionDelegation } from './action-delegation.ts';
import type { DelegationHost } from './action-delegation.ts';
import { actionTree } from './testing/action-tree.ts';
import type { ActionTree } from './testing/action-tree.ts';
import { test } from './testing/test.ts';

function hostOf(tree: ActionTree): DelegationHost {
  return Object.assign(new EventTarget(), {
    renderRoot: tree.root,
    addController: (): undefined => {
      return;
    },
  }) as unknown as DelegationHost;
}

describe('ActionDelegation', () => {
  test('delegates while the host is connected', ({ expect }) => {
    const tree = actionTree();
    const row = tree.element({ action: 'open', id: 'a' });
    const opened: (string | undefined)[] = [];
    const delegation = new ActionDelegation(hostOf(tree), {
      click: {
        open: ({ id }): void => {
          opened.push(id);
        },
      },
    });
    tree.dispatch('click', row);
    delegation.hostConnected();
    tree.dispatch('click', row);
    delegation.hostConnected();
    tree.dispatch('click', row);
    delegation.hostDisconnected();
    tree.dispatch('click', row);
    expect(opened).toStrictEqual(['a', 'a']);
  });
});
