import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { BeuveApi, IpcError, SetupStatusView } from '#contract/ipc-contract.ts';

import type { StatusNotice } from './describe-editor-open.ts';

/** The session and head on screen. */
export interface SetupTarget {
  readonly sessionId: string;
  readonly headSha: string;
}

/** What Run Setup needs from the window around it. */
export interface SetupEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The review on screen, or `undefined` when there is none. */
  readonly target: () => SetupTarget | undefined;
  readonly notify: (notice: StatusNotice) => void;
  /** Shows the terminal panel and has it run the stored command (`setup:run`). */
  readonly startRun: () => void;
}

/** The open setup command dialog. */
export interface SetupDialog {
  readonly repository: string;
  readonly command: string;
  readonly error: string;
  /** The dialog was opened by Run Setup, so saving also runs the command. */
  readonly runsAfterSave: boolean;
}

/** A ready status, with what Run Setup needs from it. */
type ReadySetup = Extract<SetupStatusView, { readonly kind: 'ready' }>;

/**
 * Run Setup and Edit Setup Command… in the review (ADR 0130). Run Setup asks for the repository's
 * command when it has none, then has the terminal panel type it; once per head whose checkout is
 * not set up, a repository that has a command gets a notice offering Run Setup, and a finished
 * setup offers Restart Language Servers. Nothing runs without the reviewer's click. The host
 * renders {@link SetupController.dialog}.
 */
export class SetupController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: SetupEnvironment;
  /** The session and head the offer was last considered for. */
  private offeredFor = '';
  private unsubscribe: (() => void) | undefined;

  /** The setup command dialog, while it is open. */
  dialog: SetupDialog | undefined;

  constructor(host: ReactiveControllerHost, environment: SetupEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  private subscribe(): void {
    if (this.unsubscribe !== undefined) {
      return;
    }
    this.unsubscribe = this.environment.bridge()?.on('setup:finished', (event) => {
      const target = this.environment.target();
      if (target?.sessionId !== event.sessionId) {
        return;
      }
      this.environment.notify({
        tone: 'info',
        text: 'Setup finished. Language servers started before it do not see what it installed.',
        action: { label: 'Restart Language Servers', command: 'restart-language-servers' },
      });
    });
  }

  private async offer(target: SetupTarget): Promise<void> {
    const status = await this.environment
      .bridge()
      ?.invoke('setup:status', { sessionId: target.sessionId, expectedHeadSha: target.headSha });
    const current = this.environment.target();
    if (current === undefined || status?.ok !== true || scopeOf(current) !== scopeOf(target)) {
      return;
    }
    const { value } = status;
    if (value.kind !== 'ready' || value.isSetUp || value.command === undefined) {
      return;
    }
    this.environment.notify({
      tone: 'info',
      text: 'This checkout is not set up yet.',
      action: { label: 'Run Setup', command: 'run-setup' },
    });
  }

  /** The status for the review on screen, or `undefined` after saying why there is none. */
  private async readyStatus(): Promise<ReadySetup | undefined> {
    const bridge = this.environment.bridge();
    const target = this.environment.target();
    if (bridge === undefined || target === undefined) {
      return undefined;
    }
    const status = await bridge.invoke('setup:status', {
      sessionId: target.sessionId,
      expectedHeadSha: target.headSha,
    });
    if (!status.ok) {
      this.fail(status.error);
      return undefined;
    }
    if (status.value.kind === 'no-remote') {
      this.environment.notify({
        tone: 'info',
        text: 'Run Setup needs a GitHub-style remote: its command is kept per repository.',
      });
      return undefined;
    }
    return status.value;
  }

  private open(request: DialogRequest): void {
    this.dialog = {
      repository: request.ready.repository,
      command: request.command,
      error: '',
      runsAfterSave: request.runsAfterSave,
    };
    this.host.requestUpdate();
  }

  private fail(error: IpcError): void {
    if (error.code !== 'cancelled') {
      this.environment.notify({ tone: 'error', text: error.message });
    }
  }

  hostConnected(): void {
    this.subscribe();
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Call when the review may have changed: a head seen for the first time may get the offer. */
  observe(): void {
    this.subscribe();
    const target = this.environment.target();
    if (target === undefined) {
      return;
    }
    const scope = scopeOf(target);
    if (scope === this.offeredFor) {
      return;
    }
    this.offeredFor = scope;
    void this.offer(target);
  }

  /** Run Setup: asks for the command first when the repository has none. */
  async run(): Promise<void> {
    const ready = await this.readyStatus();
    if (ready === undefined) {
      return;
    }
    if (ready.command === undefined) {
      this.open({ ready, command: ready.suggestion, runsAfterSave: true });
      return;
    }
    this.environment.startRun();
  }

  /** Edit Setup Command…: the stored command, or the suggestion when there is none. */
  async edit(): Promise<void> {
    const ready = await this.readyStatus();
    if (ready !== undefined) {
      this.open({ ready, command: ready.command ?? ready.suggestion, runsAfterSave: false });
    }
  }

  /** The dialog's Save: stores the command, then runs it when Run Setup opened the dialog. */
  async save(command: string): Promise<void> {
    const { dialog } = this;
    const bridge = this.environment.bridge();
    const target = this.environment.target();
    if (dialog === undefined || bridge === undefined || target === undefined) {
      return;
    }
    const saved = await bridge.invoke('setup:set-command', {
      sessionId: target.sessionId,
      command,
    });
    if (!saved.ok) {
      this.dialog = { ...dialog, command, error: saved.error.message };
      this.host.requestUpdate();
      return;
    }
    this.dialog = undefined;
    this.host.requestUpdate();
    if (dialog.runsAfterSave) {
      this.environment.startRun();
      return;
    }
    this.environment.notify({
      tone: 'info',
      text: `Setup command saved for ${saved.value.repository}.`,
    });
  }

  /** Closes the dialog without saving. */
  cancel(): void {
    this.dialog = undefined;
    this.host.requestUpdate();
  }
}

/** What the dialog opens with. */
interface DialogRequest {
  readonly ready: ReadySetup;
  readonly command: string;
  readonly runsAfterSave: boolean;
}

function scopeOf(target: SetupTarget): string {
  return `${target.sessionId}\0${target.headSha}`;
}
