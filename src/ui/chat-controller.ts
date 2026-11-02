import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  ChatCommandRequest,
  ChatMentionView,
  ChatStreamEvent,
} from '#contract/ipc-contract.ts';

import type { ChatEntry, ChatTranscript, LocalChatEntry } from './chat-entry.ts';
import { chatHelp } from './chat-help.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';
import { isActiveRequest } from './is-active-request.ts';
import { parseChatCommand } from './parse-chat-command.ts';
import type { ChatCommand } from './parse-chat-command.ts';
import { reduceChatTranscript } from './reduce-chat-transcript.ts';
import type { ChatTranscriptAction } from './reduce-chat-transcript.ts';

/** The slash commands that change a preference rather than talk to the model; the app runs them. */
export type ChatAppCommand = Extract<
  ChatCommand,
  {
    readonly kind:
      'editor' | 'diff' | 'generated' | 'sheets' | 'insights' | 'whitespace' | 'order' | 'sidebar';
  }
>;

/** What the chat needs from the window around it. */
export interface ChatEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The open review's session, if there is one. */
  readonly sessionId: () => string | undefined;
  /** The file the diff cursor is on, if it belongs to the open review; sent as a question's focus. */
  readonly focusPath: () => string | undefined;
  /** Puts a rejected question back in the input. */
  readonly restoreDraft: (text: string, mentions: readonly ChatMentionView[]) => void;
  /** Runs a preference command; the controller has already echoed what was typed. */
  readonly runAppCommand: (command: ChatAppCommand) => void;
}

/**
 * The chat drawer's state and flows (ADR 0031, 0047, 0055, 0056, 0057, 0072): the transcript, the
 * `chat:stream` subscription while the host is connected, and every request to main that changes
 * it. The window's own pieces (the open session, the diff cursor, preference commands) come in
 * through the {@link ChatEnvironment}; the host re-renders when `transcript` changes.
 */
export class ChatController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: ChatEnvironment;
  private state: ChatTranscript = emptyChatTranscript;
  private nextEntryId = 1;
  private readonly compactHinted = new Set<string>();
  private unsubscribe: (() => void) | undefined;

  constructor(host: ReactiveControllerHost, environment: ChatEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  private runningMessageId(): string | undefined {
    const running = this.state.entries.find((entry) => {
      return entry.kind === 'message' && isActiveRequest(entry.message);
    });
    if (running?.kind === 'message') {
      return running.message.id;
    }
    return undefined;
  }

  /** One `chat:stream` event (ADR 0072): the reducer builds the transcript from it. */
  private applyStream(event: ChatStreamEvent): void {
    if (event.sessionId !== this.environment.sessionId()) {
      return;
    }
    this.dispatch({ kind: 'stream', event });
    if (
      event.type !== 'message' ||
      event.droppedTurns === undefined ||
      this.compactHinted.has(event.sessionId)
    ) {
      return;
    }
    this.compactHinted.add(event.sessionId);
    this.note('info', 'Older turns are being dropped — /compact to keep a summary.');
  }

  private async ask(question: string, mentions: readonly ChatMentionView[]): Promise<void> {
    const bridge = this.environment.bridge();
    const sessionId = this.environment.sessionId();
    if (bridge === undefined || sessionId === undefined) {
      this.note('error', 'Open a review session first, then ask your question.');
      return;
    }
    const focusPath = this.environment.focusPath();
    const asked = await bridge.invoke('chat:ask', {
      sessionId,
      question,
      ...(focusPath !== undefined && { focus: { path: focusPath } }),
      ...(mentions.length > 0 && { mentions }),
    });
    if (!asked.ok) {
      this.note('error', asked.error.message);
      this.environment.restoreDraft(question, mentions);
      return;
    }
    if (this.environment.sessionId() === sessionId) {
      this.dispatch({ kind: 'asked', ...asked.value });
    }
  }

  /**
   * `/review` and `/summarize` (ADR 0055, 0056): chat requests like a question, so they queue
   * behind a running answer and land in the transcript as structured or calm answers.
   */
  private async request(typed: string, command: ChatCommandRequest): Promise<void> {
    const bridge = this.environment.bridge();
    const sessionId = this.environment.sessionId();
    if (bridge === undefined || sessionId === undefined) {
      this.echo(typed);
      this.note('error', `Open a review session first, then type ${typed.split(' ', 1)[0] ?? ''}.`);
      return;
    }
    const asked = await bridge.invoke('chat:ask', { sessionId, question: typed, command });
    if (!asked.ok) {
      this.echo(typed);
      this.note('error', asked.error.message);
      return;
    }
    if (this.environment.sessionId() === sessionId) {
      this.dispatch({ kind: 'asked', ...asked.value });
    }
  }

  /** `/compact` (ADR 0047): shows progress, then the stored summary where it ran. */
  private async compact(): Promise<void> {
    const bridge = this.environment.bridge();
    const sessionId = this.environment.sessionId();
    if (bridge === undefined || sessionId === undefined) {
      this.note('error', 'Open a review session first.');
      return;
    }
    const entryId = this.addEntry({ id: 0, kind: 'compaction', status: 'running' });
    const compacted = await bridge.invoke('chat:compact', { sessionId });
    if (this.environment.sessionId() !== sessionId) {
      return;
    }
    if (compacted.ok && compacted.value.outcome === 'compacted') {
      this.compactHinted.delete(sessionId);
      this.dispatch({ kind: 'compacted', summary: compacted.value.summary });
      return;
    }
    let failure: string | undefined;
    if (!compacted.ok) {
      failure = compacted.error.message;
    } else if (compacted.value.outcome === 'failed') {
      failure = compacted.value.errorMessage;
    }
    this.setState({
      ...this.state,
      entries: this.state.entries.flatMap((entry): ChatEntry[] => {
        if (entry.id !== entryId || entry.kind !== 'compaction') {
          return [entry];
        }
        if (failure === undefined) {
          return [
            {
              id: entryId,
              kind: 'note',
              tone: 'info',
              lines: ['Compaction stopped; nothing was stored.'],
            },
          ];
        }
        return [{ ...entry, status: 'failed', message: failure }];
      }),
    });
  }

  private echo(typed: string): void {
    this.addEntry({ id: 0, kind: 'input', text: typed });
  }

  private addEntry(entry: LocalChatEntry): number {
    const id = this.nextEntryId;
    this.nextEntryId += 1;
    this.setState({ ...this.state, entries: [...this.state.entries, { ...entry, id }] });
    return id;
  }

  private dispatch(action: ChatTranscriptAction): void {
    this.setState(reduceChatTranscript(this.state, action));
  }

  private setState(state: ChatTranscript): void {
    this.state = state;
    this.host.requestUpdate();
  }

  hostConnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.environment.bridge()?.on('chat:stream', (event) => {
      this.applyStream(event);
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** The drawer's entries, oldest first. */
  get entries(): readonly ChatEntry[] {
    return this.state.entries;
  }

  /** Whether a request of this window is running now. */
  get isBusy(): boolean {
    return this.runningMessageId() !== undefined;
  }

  /** Empties the transcript: another session is opening. */
  reset(): void {
    this.setState(emptyChatTranscript);
  }

  /** Adds a calm or failing line to the transcript. */
  note(tone: 'info' | 'error', ...lines: string[]): void {
    this.addEntry({ id: 0, kind: 'note', tone, lines });
  }

  /** The session's stored transcript, shown above this window's command results. */
  async load(sessionId: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const listed = await bridge.invoke('chat:list', { sessionId });
    if (listed.ok && this.environment.sessionId() === sessionId) {
      this.dispatch({ kind: 'loaded', messages: listed.value.messages });
    }
  }

  /** Runs one input line of the drawer: a question or a slash command. */
  submit(text: string, mentions: readonly ChatMentionView[] = []): void {
    const command = parseChatCommand(text);
    const typed = text.trim();
    switch (command.kind) {
      case 'empty': {
        return;
      }
      case 'question': {
        void this.ask(command.text, mentions);
        return;
      }
      case 'clear': {
        void this.clear(command.queuedOnly);
        return;
      }
      case 'summarize': {
        void this.request(typed, { kind: 'summarize' });
        return;
      }
      case 'compact': {
        void this.compact();
        return;
      }
      case 'review': {
        void this.request(typed, {
          kind: 'review',
          ...(command.pathPrefixes.length > 0 && { pathPrefixes: command.pathPrefixes }),
          ...(command.fresh && { fresh: true }),
          ...(!command.verify && { verify: false }),
          ...(command.effort !== undefined && { effort: command.effort }),
        });
        return;
      }
      case 'help': {
        this.echo(typed);
        this.note('info', ...chatHelp);
        return;
      }
      case 'invalid': {
        this.echo(typed);
        this.note('error', command.message);
        return;
      }
      case 'editor':
      case 'diff':
      case 'generated':
      case 'sheets':
      case 'insights':
      case 'whitespace':
      case 'order':
      case 'sidebar': {
        this.echo(typed);
        this.environment.runAppCommand(command);
        return;
      }
    }
  }

  /** `/clear` deletes the transcript; `/clear queue` and the queue's button only what waits. */
  async clear(isQueueOnly = false): Promise<void> {
    const bridge = this.environment.bridge();
    const sessionId = this.environment.sessionId();
    if (bridge === undefined || sessionId === undefined) {
      if (!isQueueOnly) {
        this.reset();
      }
      return;
    }
    const cleared = await bridge.invoke('chat:clear', {
      sessionId,
      ...(isQueueOnly && { queuedOnly: true }),
    });
    if (!cleared.ok) {
      this.note('error', cleared.error.message);
    } else if (isQueueOnly) {
      await this.load(sessionId);
    } else {
      this.dispatch({ kind: 'cleared' });
    }
  }

  /** Stop: the answer being written. */
  cancelRunning(): void {
    const messageId = this.runningMessageId();
    if (messageId !== undefined) {
      void this.environment.bridge()?.invoke('chat:cancel', { messageId });
    }
  }
}
