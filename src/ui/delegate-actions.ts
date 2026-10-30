import { dispatchAction } from './dispatch-action.ts';
import type { ActionHandlers } from './dispatch-action.ts';

/** Handlers by event type, each typed by its event. */
export type DelegatedActions = {
  readonly [K in keyof HTMLElementEventMap]?: ActionHandlers<HTMLElementEventMap[K]>;
};

/** Teardown: aborting `signal` removes every listener `delegateActions` added. */
export interface DelegateActionsOptions {
  readonly signal: AbortSignal;
}

/**
 * Event delegation (ADR 0074): one listener per event type on `root`, a component's shadow root
 * or a host whose shadow root holds the actions, which runs {@link dispatchAction} over that
 * shadow root's elements: the innermost `data-action` with a handler for the event's type.
 */
export function delegateActions(
  root: EventTarget,
  actions: DelegatedActions,
  options: DelegateActionsOptions,
): void {
  const scope = scopeOf(root);
  for (const [type, handlers] of Object.entries(actions) as [string, ActionHandlers<Event>][]) {
    root.addEventListener(
      type,
      (event) => {
        dispatchAction(event, scope, handlers);
      },
      { signal: options.signal },
    );
  }
}

/** The tree whose elements `root` handles: a shadow root itself, or a host's shadow root. */
function scopeOf(root: EventTarget): unknown {
  if ('mode' in root && 'host' in root) {
    return root;
  }
  const { shadowRoot } = root as { readonly shadowRoot?: unknown };
  return shadowRoot ?? (root as unknown as { getRootNode: () => unknown }).getRootNode();
}
