import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { delegateActions } from './delegate-actions.ts';
import type { DelegatedActions } from './delegate-actions.ts';

/** A Lit element: a controller host with a render root. */
export type DelegationHost = ReactiveControllerHost &
  HTMLElement & { readonly renderRoot: EventTarget };

/**
 * Delegates a component's actions (ADR 0074) while it is connected: {@link delegateActions} on
 * its render root, or on the host itself with `on: 'host'` (after every listener in the shadow
 * root, so one that stops propagation there keeps the event from it). Add it with
 * `this.addController(new ActionDelegation(this, { click: { … } }))` in the constructor.
 */
export class ActionDelegation implements ReactiveController {
  private readonly host: DelegationHost;
  private readonly actions: DelegatedActions;
  private readonly on: 'render-root' | 'host';
  private controller: AbortController | undefined;

  constructor(
    host: DelegationHost,
    actions: DelegatedActions,
    on: 'render-root' | 'host' = 'render-root',
  ) {
    this.host = host;
    this.actions = actions;
    this.on = on;
  }

  hostConnected(): void {
    this.controller?.abort();
    this.controller = new AbortController();
    const root = this.on === 'host' ? this.host : this.host.renderRoot;
    delegateActions(root, this.actions, { signal: this.controller.signal });
  }

  hostDisconnected(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
}
