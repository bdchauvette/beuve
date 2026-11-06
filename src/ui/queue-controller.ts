import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { BeuveApi, IpcResult, ReviewQueueView } from '#contract/ipc-contract.ts';

/** What the review queue needs from the window around it. */
export interface QueueEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
}

/**
 * The window's copy of the review queue (ADR 0113): read with `queue:get` when it is shown,
 * refreshed on request with `queue:refresh`, and kept current by `queue:updated` while the host is
 * connected. Sorting, grouping and filtering happen in the view, from the display preferences.
 */
export class QueueController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: QueueEnvironment;
  private shown: ReviewQueueView | undefined;
  private failure = '';
  private unsubscribe: (() => void) | undefined;

  constructor(host: ReactiveControllerHost, environment: QueueEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  private apply(answer: IpcResult<ReviewQueueView>): void {
    if (answer.ok) {
      this.shown = answer.value;
      this.failure = '';
    } else {
      this.failure = answer.error.message;
    }
    this.host.requestUpdate();
  }

  hostConnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.environment.bridge()?.on('queue:updated', (queue) => {
      this.apply({ ok: true, value: queue });
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** The last snapshot main sent; `undefined` before the first. */
  get queue(): ReviewQueueView | undefined {
    return this.shown;
  }

  /** Why the queue could not be read, or `''`. */
  get error(): string {
    return this.failure;
  }

  /** Reads the queue; main refreshes it first when it is stale and pushes the result. */
  async load(): Promise<void> {
    const answer = await this.environment.bridge()?.invoke('queue:get');
    if (answer !== undefined) {
      this.apply(answer);
    }
  }

  /** Asks main to refresh now; it answers once the refresh is done. */
  async refresh(): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    if (this.shown !== undefined) {
      this.shown = { ...this.shown, isRefreshing: true };
      this.host.requestUpdate();
    }
    this.apply(await bridge.invoke('queue:refresh'));
  }
}
