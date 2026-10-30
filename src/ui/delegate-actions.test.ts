import { describe } from 'vitest';

import { delegateActions } from './delegate-actions.ts';
import type { ActionData } from './dispatch-action.ts';
import { actionTree } from './testing/action-tree.ts';
import { test } from './testing/test.ts';

describe('delegateActions', () => {
  test('runs the innermost action with its data, event and element', ({ expect, signal }) => {
    const tree = actionTree();
    const row = tree.element({ action: 'open', id: 'b' });
    const label = tree.element({}, row);
    const runs: [ActionData, string, unknown][] = [];
    delegateActions(
      tree.root,
      {
        click: {
          open: (data, event, element): void => {
            runs.push([data, event.type, element]);
          },
        },
      },
      { signal },
    );
    tree.dispatch('click', label);
    expect(runs).toStrictEqual([[{ action: 'open', id: 'b' }, 'click', row]]);
  });

  test('passes over an action without a handler to an ancestor’s', ({ expect, signal }) => {
    const tree = actionTree();
    const card = tree.element({ action: 'activate', index: '3' });
    const button = tree.element({ action: 'unknown' }, card);
    const runs: string[] = [];
    delegateActions(
      tree.root,
      {
        click: {
          activate: ({ index = '' }): void => {
            runs.push(index);
          },
        },
      },
      { signal },
    );
    tree.dispatch('click', button);
    expect(runs).toStrictEqual(['3']);
  });

  test('runs only the innermost of nested actions', ({ expect, signal }) => {
    const tree = actionTree();
    const row = tree.element({ action: 'select' });
    const button = tree.element({ action: 'remove' }, row);
    const runs: string[] = [];
    delegateActions(
      tree.root,
      {
        click: {
          select: (): void => {
            runs.push('select');
          },
          remove: (): void => {
            runs.push('remove');
          },
        },
      },
      { signal },
    );
    tree.dispatch('click', button);
    expect(runs).toStrictEqual(['remove']);
  });

  test('leaves elements in a nested shadow root to their component', ({ expect, signal }) => {
    const tree = actionTree();
    const host = tree.element({ action: 'activate' });
    const inner = tree.element({ action: 'remove' }, host, { nested: true });
    const runs: string[] = [];
    delegateActions(
      tree.root,
      {
        click: {
          activate: (): void => {
            runs.push('activate');
          },
          remove: (): void => {
            runs.push('remove');
          },
        },
      },
      { signal },
    );
    tree.dispatch('click', inner);
    expect(runs).toStrictEqual(['activate']);
  });

  test('stops at the root', ({ expect, signal }) => {
    const tree = actionTree();
    const outside = tree.element({ action: 'open' });
    const plain = tree.element({});
    const runs: string[] = [];
    delegateActions(
      tree.root,
      {
        click: {
          open: (): void => {
            runs.push('open');
          },
        },
      },
      { signal },
    );
    tree.dispatch('click', plain, {}, [outside]);
    expect(runs).toStrictEqual([]);
  });

  test('handles each event type with its own handlers', ({ expect, signal }) => {
    const tree = actionTree();
    const row = tree.element({ action: 'row' });
    const runs: string[] = [];
    delegateActions(
      tree.root,
      {
        click: {
          row: (): void => {
            runs.push('click');
          },
        },
        dblclick: {
          row: (): void => {
            runs.push('dblclick');
          },
        },
      },
      { signal },
    );
    tree.dispatch('dblclick', row);
    tree.dispatch('click', row);
    tree.dispatch('keydown', row, { key: 'Enter' });
    expect(runs).toStrictEqual(['dblclick', 'click']);
  });

  test('never handles a chord, which only the menu dispatches', ({ expect, signal }) => {
    const tree = actionTree();
    const row = tree.element({ action: 'row' });
    const keys: string[] = [];
    delegateActions(
      tree.root,
      {
        keydown: {
          row: (_data, event): void => {
            keys.push(event.key);
          },
        },
      },
      { signal },
    );
    tree.dispatch('keydown', row, { key: 'd', ctrlKey: true, metaKey: false });
    tree.dispatch('keydown', row, { key: 'd', ctrlKey: false, metaKey: true });
    tree.dispatch('keydown', row, { key: 'ArrowUp', ctrlKey: false, metaKey: false, altKey: true });
    tree.dispatch('keydown', row, { key: 'Enter', ctrlKey: false, metaKey: false });
    expect(keys).toStrictEqual(['ArrowUp', 'Enter']);
  });

  test('handles a chord typed in a text field or a form, which keep their keys', ({
    expect,
    signal,
  }) => {
    const tree = actionTree();
    const editor = tree.element({ action: 'editor' });
    const form = Object.assign(tree.element({}, editor), { localName: 'form' });
    const field = Object.assign(tree.element({}, editor), { localName: 'textarea' });
    const editable = Object.assign(tree.element({}, editor), { isContentEditable: true });
    const button = Object.assign(tree.element({}, form), { localName: 'button' });
    const keys: string[] = [];
    delegateActions(
      tree.root,
      {
        keydown: {
          editor: (_data, event): void => {
            keys.push(event.key);
          },
        },
      },
      { signal },
    );
    tree.dispatch('keydown', field, { key: 'Enter', ctrlKey: false, metaKey: true });
    tree.dispatch('keydown', editable, { key: 'Enter', ctrlKey: true, metaKey: false });
    tree.dispatch('keydown', button, { key: 's', ctrlKey: true, metaKey: false });
    tree.dispatch('keydown', editor, { key: 'd', ctrlKey: true, metaKey: false });
    expect(keys).toStrictEqual(['Enter', 'Enter', 's']);
  });

  test.for(['pointerover', 'pointerout', 'mouseover', 'mouseout', 'focusin', 'focusout'])(
    'runs %s as enter and leave',
    (type, { expect, signal }) => {
      const tree = actionTree();
      const row = tree.element({ action: 'hover' });
      const label = tree.element({}, row);
      const outside = tree.element({});
      const runs: unknown[] = [];
      delegateActions(
        tree.root,
        {
          [type]: {
            hover: (_data: ActionData, event: Event): void => {
              runs.push((event as PointerEvent).relatedTarget);
            },
          },
        },
        { signal },
      );
      tree.dispatch(type, label, { relatedTarget: row });
      tree.dispatch(type, row, { relatedTarget: outside });
      tree.dispatch(type, row, { relatedTarget: undefined });
      expect(runs).toStrictEqual([outside, undefined]);
    },
  );

  test('removes its listeners when the signal aborts', ({ expect, signal }) => {
    const tree = actionTree();
    const row = tree.element({ action: 'open' });
    const controller = new AbortController();
    signal.addEventListener(
      'abort',
      () => {
        controller.abort();
      },
      { once: true },
    );
    const runs: string[] = [];
    delegateActions(
      tree.root,
      {
        click: {
          open: (): void => {
            runs.push('open');
          },
        },
      },
      { signal: controller.signal },
    );
    tree.dispatch('click', row);
    controller.abort();
    tree.dispatch('click', row);
    expect(runs).toStrictEqual(['open']);
  });

  test('handles a host’s shadow root from the host', ({ expect, signal }) => {
    const shadowRoot = { mode: 'open' };
    const host = Object.assign(new EventTarget(), { shadowRoot });
    const tree = actionTree();
    const button = tree.element({ action: 'open' }, undefined, shadowRoot);
    const runs: string[] = [];
    delegateActions(
      host,
      {
        click: {
          open: (): void => {
            runs.push('open');
          },
        },
      },
      { signal },
    );
    const event = new Event('click', { bubbles: true });
    Object.defineProperty(event, 'composedPath', { value: () => [button, host] });
    host.dispatchEvent(event);
    expect(runs).toStrictEqual(['open']);
  });
});
