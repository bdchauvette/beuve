import { describe } from 'vitest';

import { isOwnClick } from './is-own-click.ts';
import { actionTree } from './testing/action-tree.ts';
import { test } from './testing/test.ts';

describe('isOwnClick', () => {
  test('is true only for a click on the host, not one retargeted from its shadow root', ({
    expect,
  }) => {
    const tree = actionTree();
    const host = tree.element({});
    const button = tree.element({ action: 'prefix' });
    const fromInside = tree.dispatch('click', button, {}, [host]);
    const onHost = tree.dispatch('click', host);
    expect(isOwnClick(fromInside, host as unknown as EventTarget)).toBe(false);
    expect(isOwnClick(onHost, host as unknown as EventTarget)).toBe(true);
  });
});
