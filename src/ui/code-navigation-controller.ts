import type { ReactiveControllerHost } from 'lit';

import type { BeuveApi, ReviewView } from '#contract/ipc-contract.ts';

import type { StatusNotice } from './describe-editor-open.ts';
import { flowStateFrom } from './flow-state-from.ts';
import type { FlowState } from './flow-state.ts';
import { peekStateFrom } from './peek-state-from.ts';
import type { PeekChildren, PeekState } from './peek-state.ts';
import { runSheetAction } from './run-sheet-action.ts';
import type { SheetAction } from './run-sheet-action.ts';

/** What code navigation needs from the window around it. */
export interface CodeNavigationEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The open review; an answer that finds another one open is dropped. */
  readonly review: () => ReviewView | undefined;
  readonly notify: (notice: StatusNotice) => void;
}

interface CodeNavigationSnapshot {
  readonly peek: PeekState | undefined;
  readonly flow: FlowState | undefined;
}

const initial: CodeNavigationSnapshot = {
  peek: undefined,
  flow: undefined,
};

/**
 * The ways out of the diff into code: the call-stack peek (incoming callers, expanded node by
 * node), the control-flow portal, and definitions and permalinks opened as sheets (ADR 0067). At
 * most one of the peek and the flow is open. Each request names the review it was asked in and
 * drops its answer if another is open by then. The host re-renders when a getter's value changes.
 */
export class CodeNavigationController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: CodeNavigationEnvironment;
  private snapshot: CodeNavigationSnapshot = initial;

  constructor(host: ReactiveControllerHost, environment: CodeNavigationEnvironment) {
    this.host = host;
    this.environment = environment;
  }

  private patch(change: Partial<CodeNavigationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.host.requestUpdate();
  }

  /** The call-stack peek of one file card, once asked for. */
  get peek(): PeekState | undefined {
    return this.snapshot.peek;
  }

  /** The control-flow portal of one file card, once asked for. */
  get flow(): FlowState | undefined {
    return this.snapshot.flow;
  }

  /** A new review is showing: its portals start closed. */
  reset(): void {
    this.patch({ peek: undefined, flow: undefined });
  }

  closePeek(): void {
    this.patch({ peek: undefined });
  }

  closeFlow(): void {
    this.patch({ flow: undefined });
  }

  /** The incoming callers of the function around `line`; a file without a head line says so. */
  async openPeek(path: string, line: number | undefined): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      return;
    }
    if (line === undefined) {
      this.patch({
        flow: undefined,
        peek: {
          path,
          line,
          status: 'error',
          message: 'This file has no head-side change to peek at.',
        },
      });
      return;
    }
    const pending: PeekState = { path, line, status: 'loading' };
    this.patch({ flow: undefined, peek: pending });
    const answer = await bridge.invoke('lsp:call-hierarchy', {
      sessionId: review.session.id,
      expectedHeadSha: review.headSha,
      path,
      line,
      direction: 'incoming',
    });
    if (this.snapshot.peek !== pending || this.environment.review() !== review) {
      return;
    }
    this.patch({ peek: peekStateFrom(path, line, answer) });
  }

  /** The callers of one node of the open peek. */
  async expandPeek(nodeId: string): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    const { peek } = this.snapshot;
    if (bridge === undefined || review === undefined || peek?.status !== 'ready') {
      return;
    }
    const withChildren = (state: PeekState, children: PeekChildren): PeekState => {
      if (state.status === 'ready') {
        return { ...state, children: new Map(state.children).set(nodeId, children) };
      }
      return state;
    };
    this.patch({ peek: withChildren(peek, { status: 'loading' }) });
    const answer = await bridge.invoke('lsp:call-hierarchy', {
      sessionId: review.session.id,
      expectedHeadSha: review.headSha,
      path: peek.path,
      line: peek.line ?? 1,
      direction: 'incoming',
      nodeId,
    });
    const current = this.snapshot.peek;
    if (current?.status !== 'ready' || current.root.id !== peek.root.id) {
      return;
    }
    if (answer.ok) {
      this.patch({ peek: withChildren(current, { status: 'ready', calls: answer.value.calls }) });
    } else {
      this.patch({
        peek: withChildren(current, { status: 'error', message: answer.error.message }),
      });
    }
  }

  /** The control-flow graph of the function around `line`. */
  async openFlow(path: string, line: number | undefined): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      return;
    }
    if (line === undefined) {
      this.patch({
        peek: undefined,
        flow: {
          path,
          line,
          status: 'error',
          message: 'This file has no head-side change to draw a flow for.',
        },
      });
      return;
    }
    const pending: FlowState = { path, line, status: 'loading' };
    this.patch({ peek: undefined, flow: pending });
    const answer = await bridge.invoke('flow:get-graph', {
      sessionId: review.session.id,
      path,
      line,
    });
    if (this.snapshot.flow !== pending || this.environment.review() !== review) {
      return;
    }
    this.patch({ flow: flowStateFrom(path, line, answer) });
  }

  /**
   * Definitions open in sheet windows, permalinks go to the clipboard or browser (ADR 0067); the
   * outcome is a notice.
   */
  async runSheet(action: SheetAction): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      return;
    }
    const outcome = await runSheetAction(
      {
        bridge,
        sessionId: review.session.id,
        headSha: review.headSha,
        baseSha: review.baseSha,
      },
      action,
    );
    this.environment.notify(outcome);
  }
}
