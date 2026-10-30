import type {
  ChatAskedView,
  ChatAskRequest,
  ChatCancelledView,
  ChatCancelRequest,
  ChatClearedView,
  ChatClearRequest,
  ChatCompactedView,
  ChatCompactRequest,
  ChatDeltaView,
  ChatErrorCode,
  ChatListRequest,
  ChatListView,
  ChatMessageUpdatedView,
  IpcResult,
} from '#contract/ipc-contract.ts';
import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import { askQuestion } from '#internal/chat/ask-question.ts';
import { clearChatMessages } from '#internal/chat/clear-chat-messages.ts';
import type {
  ChatMention,
  ChatMessage,
  ChatMessageId,
  CommitSha,
  SessionId,
} from '#internal/chat/chat-message.ts';
import type { ChatDelta } from '#internal/chat/chat-model.ts';
import type { ChatSelection, ChatTurn } from '#internal/chat/chat-question.ts';
import { compactConversation } from '#internal/chat/compact-conversation.ts';
import { listChatMessages } from '#internal/chat/list-chat-messages.ts';
import { splitAtCompaction } from '#internal/chat/split-at-compaction.ts';
import { toChatHistory } from '#internal/chat/to-chat-history.ts';
import { updateChatAnswer } from '#internal/chat/update-chat-answer.ts';
import type { ChatAnswerUpdate } from '#internal/chat/update-chat-answer.ts';
import { listTreePaths } from '#internal/git/list-tree-paths.ts';
import type { ImpactFindingView } from '#contract/ipc-contract.ts';
import type { ModelError } from '#internal/llm/language-model.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import type { ClaudeCodeSettings } from '../review/claude-code-settings.ts';
import { resolveLanguageModel } from '../review/resolve-language-model.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSessionHead } from '../sessions/refresh-session-head.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';

import { describeChatError } from './describe-chat-error.ts';
import { modelErrorToChatFailure } from './model-error-to-chat-failure.ts';
import type { ChatFailure } from './model-error-to-chat-failure.ts';
import { resolveChatMentions } from './resolve-chat-mentions.ts';
import { toChatMessageView } from './to-chat-message-view.ts';
import { toChatQuestion } from './to-chat-question.ts';

/** The read-only Q&A chat, as the renderer reaches it (ADR 0031). */
export interface ChatServices {
  /** Stores the question and a streaming answer, starts the answer in the background, returns. */
  readonly ask: (request: ChatAskRequest) => Promise<IpcResult<ChatAskedView>>;
  readonly list: (request: ChatListRequest) => IpcResult<ChatListView>;
  readonly cancel: (request: ChatCancelRequest) => IpcResult<ChatCancelledView>;
  /**
   * `/compact` (ADR 0047): condenses the turns since the last summary into a new summary message,
   * answering once it is stored. It occupies the session like an answer does.
   */
  readonly compact: (request: ChatCompactRequest) => Promise<IpcResult<ChatCompactedView>>;
  /** Deletes the session's transcript; an answer in flight is stopped and not stored. */
  readonly clear: (request: ChatClearRequest) => IpcResult<ChatClearedView>;
  /** Aborts the session's answer in flight if it was asked at a head other than `headSha`. */
  readonly observeHead: (sessionId: string, headSha: string) => void;
  /** Subscribes to `chat:delta` events; returns the unsubscribe function. */
  readonly onDelta: (listener: (event: ChatDeltaView) => void) => () => void;
  /** Subscribes to `chat:message-updated` events; returns the unsubscribe function. */
  readonly onMessageUpdated: (listener: (event: ChatMessageUpdatedView) => void) => () => void;
  /** Aborts every answer and waits until their Claude Code processes are gone. */
  readonly dispose: () => Promise<void>;
}

export interface ChatServicesOptions {
  readonly context: SessionContext;
  readonly impact: ImpactServices;
  readonly worktrees: SessionWorktrees;
  readonly claude?: ClaudeCodeSettings;
  /** The session's stated intent (a pull request's title and body), put in the prompt. */
  readonly intentFor?: (sessionId: string) => string | undefined;
  /** Least time between stores of the streaming preview. Defaults to 1 second. */
  readonly previewIntervalMs?: number;
}

interface Job {
  readonly sessionId: string;
  readonly headSha: string;
  /** The streaming answer's id, or the id the summary of a `/compact` will get. */
  readonly messageId: string;
  readonly controller: AbortController;
  /** The raw answer streamed so far. */
  streamed: string;
  done: Promise<void>;
}

/**
 * Answers questions in the background (ADR 0031's recipe, ADR 0022's lifecycle). `ask` stores the
 * question and a `streaming` answer and returns; the job builds the same diff `session:get-review`
 * shows, adds the cached ImpactGate findings, the stored history and the head's paths, checks the
 * head out (ADR 0020) and asks Claude Code there. Deltas are pushed as they arrive and the preview
 * is stored at most once per interval; the final state is stored, then pushed.
 *
 * One answer is in flight per session: a question asked meanwhile is refused with a message, not
 * queued, because answers cost quota and the reviewer can cancel (ADR 0032). Cancelling, moving
 * the head, clearing and quitting abort the answer.
 */
export function createChatServices(options: ChatServicesOptions): ChatServices {
  /** Why an answer was aborted; the `AbortSignal` reason. `cleared` also means nothing is stored. */
  type AbortReason = 'cancelled' | 'head-changed' | 'cleared' | 'app-quit';

  type Outcome =
    | {
        readonly status: 'complete';
        readonly answer: ChatAnswerUpdate;
        /** Earlier turns the prompt dropped for size. */
        readonly droppedTurns: number;
      }
    | { readonly status: 'cancelled' }
    | { readonly status: 'failed'; readonly code: ChatErrorCode };

  /** What a question or a compaction runs against: the diff, its checkout and its files. */
  interface Prepared {
    readonly diff: ReviewDiff;
    readonly worktreePath: string;
    readonly worktreePaths: ReadonlySet<string> | undefined;
    readonly findings: readonly ImpactFindingView[] | undefined;
  }

  const { context, impact, worktrees } = options;
  const { db, logger } = context;
  const claude = options.claude ?? {};
  const previewIntervalMs = options.previewIntervalMs ?? 1000;
  const jobs = new Map<string, Job>();
  const deltaListeners = new Set<(event: ChatDeltaView) => void>();
  const updateListeners = new Set<(event: ChatMessageUpdatedView) => void>();
  let isDisposed = false;

  const notify = <T>(listeners: ReadonlySet<(event: T) => void>, event: T): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        logger.warn('chat listener failed', { error });
      }
    }
  };

  const abort = (job: Job, reason: AbortReason): void => {
    if (job.controller.signal.aborted) {
      return;
    }

    logger.info('chat answer aborted', { messageId: job.messageId, reason });
    job.controller.abort(reason);
  };

  const observeHead = (sessionId: string, headSha: string): void => {
    const job = jobs.get(sessionId);
    if (job !== undefined && job.headSha !== headSha) {
      abort(job, 'head-changed');
    }
  };

  const prepare = async (
    job: Job,
    options: { readonly withImpact: boolean },
  ): Promise<Result<Prepared, Outcome>> => {
    const isAborted = (): boolean => job.controller.signal.aborted;
    const unavailable = (): Result<never, Outcome> =>
      err({ status: 'failed', code: 'chat-unavailable' });
    const diff = await loadReviewDiff(context, job.sessionId);
    if (isAborted()) {
      return err({ status: 'cancelled' });
    }
    if (!diff.ok) {
      return unavailable();
    }
    const { refreshed } = diff.value;
    if (refreshed.session.headSha !== job.headSha) {
      abort(job, 'head-changed');
      return err({ status: 'cancelled' });
    }
    let findings: readonly ImpactFindingView[] | undefined;
    if (options.withImpact) {
      const impactView = await impact.getImpact({ sessionId: job.sessionId });
      findings =
        impactView.ok && impactView.value.headSha === job.headSha
          ? impactView.value.findings
          : undefined;
    }
    const worktree = await worktrees.ensure(
      refreshed.repository,
      job.sessionId,
      refreshed.session.headSha,
    );
    if (isAborted()) {
      return err({ status: 'cancelled' });
    }
    if (!worktree.ok) {
      gitFailure(logger, worktree.error);
      return unavailable();
    }
    const tree = await listTreePaths(refreshed.repository, refreshed.session.headSha);
    return ok({
      diff: diff.value,
      worktreePath: worktree.value,
      worktreePaths: tree.ok ? new Set(tree.value) : undefined,
      findings,
    });
  };

  const answer = async (
    job: Job,
    assistant: ChatMessage,
    request: ChatAskRequest,
    conversation: Conversation,
  ): Promise<Outcome> => {
    const { signal } = job.controller;
    const prepared = await prepare(job, { withImpact: true });
    if (!prepared.ok) {
      return prepared.error;
    }
    const input = toChatQuestion({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: request.question,
      history: conversation.history,
      summary: conversation.summary,
      selections: conversation.selections,
      focus: request.focus,
      impactFindings: prepared.value.findings,
      intent: options.intentFor?.(job.sessionId),
      worktreePaths: prepared.value.worktreePaths,
    });
    const model = await resolveLanguageModel(claude, logger);
    if (!model.ok) {
      return { status: 'failed', code: 'not-installed' };
    }
    let lastStoredAt = 0;
    const onDelta = (delta: ChatDelta): void => {
      if (signal.aborted) {
        return;
      }
      job.streamed = delta.kind === 'reset' ? '' : job.streamed + delta.text;
      notify(deltaListeners, {
        sessionId: job.sessionId,
        messageId: job.messageId,
        kind: delta.kind,
        text: delta.kind === 'reset' ? '' : delta.text,
      });
      const now = Date.now();
      if (!(now - lastStoredAt >= previewIntervalMs)) {
        return;
      }

      lastStoredAt = now;
      updateChatAnswer(db, assistant.id, { status: 'streaming', content: job.streamed });
    };
    const asked = await askQuestion<ModelError>(input, {
      model: model.value,
      signal,
      onDelta,
      ...(claude.timeoutMs !== undefined && { timeoutMs: claude.timeoutMs }),
    });
    if (asked.ok) {
      return {
        status: 'complete',
        answer: {
          status: 'complete',
          content: asked.value.answer,
          citations: asked.value.citations,
        },
        droppedTurns: asked.value.prompt.omittedTurns,
      };
    }
    if (asked.error.kind !== 'model') {
      return { status: 'failed', code: 'internal' };
    }
    const failure: ChatFailure = modelErrorToChatFailure(asked.error.error);
    // Keep what streamed before the stop, so the reviewer doesn't lose a long answer.
    return failure.kind === 'cancelled'
      ? { status: 'cancelled' }
      : { status: 'failed', code: failure.code };
  };

  const finish = (job: Job, assistant: ChatMessage, outcome: Outcome): void => {
    if (jobs.get(job.sessionId) === job) {
      jobs.delete(job.sessionId);
    }
    if (job.controller.signal.reason === 'cleared') {
      return;
    }
    const update: ChatAnswerUpdate =
      outcome.status === 'complete'
        ? outcome.answer
        : outcome.status === 'cancelled'
          ? { status: 'cancelled', content: job.streamed }
          : { status: 'failed', errorCode: outcome.code, content: job.streamed };
    const stored = updateChatAnswer(db, assistant.id, update);
    if (!stored.ok) {
      logger.warn('chat answer not stored', { error: stored.error });
      return;
    }
    const final: ChatMessage = { ...assistant, ...update, citations: update.citations ?? [] };
    const droppedTurns = outcome.status === 'complete' ? outcome.droppedTurns : 0;
    notify(updateListeners, {
      message: toChatMessageView(final),
      ...(droppedTurns > 0 && { droppedTurns }),
    });
  };

  /** Runs `/compact` for a job: the turns since the last summary become one summary message. */
  const condense = async (
    job: Job,
    summary: string | undefined,
    turns: readonly ChatTurn[],
  ): Promise<Result<ChatMessage, Outcome>> => {
    const prepared = await prepare(job, { withImpact: false });
    if (!prepared.ok) {
      return prepared;
    }
    const model = await resolveLanguageModel(claude, logger);
    if (!model.ok) {
      return err({ status: 'failed', code: 'not-installed' });
    }
    const question = toChatQuestion({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: '',
      history: [],
      focus: undefined,
      impactFindings: undefined,
      worktreePaths: prepared.value.worktreePaths,
    });
    const compacted = await compactConversation<ModelError>(
      {
        baseSha: question.baseSha,
        headSha: question.headSha,
        worktreePath: question.worktreePath,
        files: question.files,
        ...(question.worktreePaths !== undefined && { worktreePaths: question.worktreePaths }),
        ...(summary !== undefined && { summary }),
        turns,
      },
      {
        model: model.value,
        signal: job.controller.signal,
        ...(claude.timeoutMs !== undefined && { timeoutMs: claude.timeoutMs }),
      },
    );
    if (!compacted.ok) {
      if (compacted.error.kind === 'nothing-to-compact') {
        return err({ status: 'failed', code: 'internal' });
      }
      const failure = modelErrorToChatFailure(compacted.error.error);
      return err(
        failure.kind === 'cancelled'
          ? { status: 'cancelled' }
          : { status: 'failed', code: failure.code },
      );
    }
    return ok({
      id: job.messageId as ChatMessageId,
      sessionId: job.sessionId as SessionId,
      headSha: job.headSha as CommitSha,
      role: 'summary',
      content: compacted.value.content,
      citations: compacted.value.citations,
      mentions: [],
      createdAt: context.deps.now().toISOString(),
    });
  };

  const jobOfMessage = (messageId: string): Job | undefined => {
    for (const job of jobs.values()) {
      if (job.messageId === messageId) {
        return job;
      }
    }
    return undefined;
  };

  /** A `streaming` answer no job is writing (the app died mid-answer) is shown as cancelled. */
  const settleOrphan = (message: ChatMessage): ChatMessage => {
    if (
      message.role !== 'assistant' ||
      message.status !== 'streaming' ||
      jobOfMessage(message.id) !== undefined
    ) {
      return message;
    }
    updateChatAnswer(db, message.id, {
      status: 'cancelled',
      content: message.content,
      citations: message.citations,
    });
    return { ...message, status: 'cancelled' };
  };

  return {
    ask: async (request): Promise<IpcResult<ChatAskedView>> => {
      if (isDisposed) {
        return err({ code: 'not-wired', message: 'beuve is quitting' });
      }
      if (jobs.has(request.sessionId)) {
        return refusedWhileStreaming();
      }
      const head = await refreshSessionHead(context, request.sessionId);
      if (!head.ok) {
        return head;
      }
      const { sessionId, headSha } = head.value;
      if (jobs.has(sessionId)) {
        return refusedWhileStreaming();
      }
      let mentions: readonly ChatMention[] = [];
      let selections: readonly ChatSelection[] = [];
      if (request.mentions !== undefined && request.mentions.length > 0) {
        const diff = await loadReviewDiff(context, sessionId);
        if (!diff.ok) {
          return diff;
        }
        const resolved = await resolveChatMentions(context, diff.value, request.mentions);
        if (!resolved.ok) {
          return resolved;
        }
        if (jobs.has(sessionId)) {
          return refusedWhileStreaming();
        }
        ({ mentions, selections } = resolved.value);
      }
      const stored = listChatMessages(db, sessionId as SessionId);
      if (!stored.ok) {
        logger.error('chat history is corrupt', { error: stored.error });
        return err({ code: 'internal', message: 'stored chat history is corrupt' });
      }
      const createdAt = context.deps.now().toISOString();
      const common = { sessionId: sessionId as SessionId, headSha: headSha as CommitSha };
      const question: ChatMessage = {
        ...common,
        id: context.deps.newId() as ChatMessageId,
        role: 'user',
        content: request.question.trim(),
        citations: [],
        mentions,
        createdAt,
      };
      const assistant: ChatMessage = {
        ...common,
        id: context.deps.newId() as ChatMessageId,
        role: 'assistant',
        status: 'streaming',
        content: '',
        citations: [],
        mentions: [],
        createdAt,
      };
      for (const message of [question, assistant]) {
        const appended = appendChatMessage(db, message);
        if (!appended.ok) {
          return err({ code: 'not-found', message: 'no such session' });
        }
      }
      const job: Job = {
        sessionId,
        headSha,
        messageId: assistant.id,
        controller: new AbortController(),
        streamed: '',
        done: Promise.resolve(),
      };
      jobs.set(sessionId, job);
      const conversation: Conversation = {
        history: toChatHistory(stored.value),
        summary: splitAtCompaction(stored.value).summary?.content,
        selections,
      };
      job.done = (async (): Promise<void> => {
        let outcome: Outcome;
        try {
          outcome = await answer(job, assistant, request, conversation);
        } catch (error: unknown) {
          logger.error('chat answer failed unexpectedly', { error });
          outcome = { status: 'failed', code: 'internal' };
        }
        finish(job, assistant, outcome);
      })();
      return ok({ question: toChatMessageView(question), answer: toChatMessageView(assistant) });
    },

    list: ({ sessionId }): IpcResult<ChatListView> => {
      const session = loadSession(context, sessionId);
      if (!session.ok) {
        return session;
      }
      const listed = listChatMessages(db, session.value.id);
      if (!listed.ok) {
        logger.error('chat history is corrupt', { error: listed.error });
        return err({ code: 'internal', message: 'stored chat history is corrupt' });
      }
      const messages = listed.value.map((message) => settleOrphan(message));
      return ok({
        sessionId: session.value.id,
        messages: messages.map((message) => toChatMessageView(message)),
      });
    },

    cancel: (request): IpcResult<ChatCancelledView> => {
      const job =
        'messageId' in request ? jobOfMessage(request.messageId) : jobs.get(request.sessionId);
      if (job === undefined) {
        return ok({ cancelled: false });
      }
      abort(job, 'cancelled');
      return ok({ cancelled: true });
    },

    compact: async ({ sessionId: requested }): Promise<IpcResult<ChatCompactedView>> => {
      if (isDisposed) {
        return err({ code: 'not-wired', message: 'beuve is quitting' });
      }
      if (jobs.has(requested)) {
        return refusedWhileStreaming();
      }
      const head = await refreshSessionHead(context, requested);
      if (!head.ok) {
        return head;
      }
      const { sessionId, headSha } = head.value;
      if (jobs.has(sessionId)) {
        return refusedWhileStreaming();
      }
      const stored = listChatMessages(db, sessionId as SessionId);
      if (!stored.ok) {
        logger.error('chat history is corrupt', { error: stored.error });
        return err({ code: 'internal', message: 'stored chat history is corrupt' });
      }
      const turns = toChatHistory(stored.value);
      if (turns.length === 0) {
        return err({
          code: 'refused',
          message: 'Nothing to compact yet: there is no question since the last summary.',
        });
      }
      const job: Job = {
        sessionId,
        headSha,
        messageId: context.deps.newId(),
        controller: new AbortController(),
        streamed: '',
        done: Promise.resolve(),
      };
      jobs.set(sessionId, job);
      let outcome: Result<ChatMessage, Outcome>;
      const running = (async (): Promise<Result<ChatMessage, Outcome>> => {
        try {
          return await condense(job, splitAtCompaction(stored.value).summary?.content, turns);
        } catch (error: unknown) {
          logger.error('chat compaction failed unexpectedly', { error });
          return err({ status: 'failed', code: 'internal' });
        }
      })();
      const settle = async (): Promise<void> => {
        await running;
      };
      job.done = settle();
      try {
        outcome = await running;
      } finally {
        if (jobs.get(sessionId) === job) {
          jobs.delete(sessionId);
        }
      }
      if (job.controller.signal.aborted) {
        return ok({ outcome: 'cancelled' });
      }
      if (!outcome.ok) {
        const failed = outcome.error;
        return ok(
          failed.status === 'failed'
            ? {
                outcome: 'failed',
                errorCode: failed.code,
                errorMessage: describeChatError(failed.code),
              }
            : { outcome: 'cancelled' },
        );
      }
      const appended = appendChatMessage(db, outcome.value);
      return appended.ok
        ? ok({ outcome: 'compacted', summary: toChatMessageView(outcome.value) })
        : err({ code: 'not-found', message: 'no such session' });
    },

    clear: ({ sessionId }): IpcResult<ChatClearedView> => {
      const session = loadSession(context, sessionId);
      if (!session.ok) {
        return session;
      }
      const job = jobs.get(session.value.id);
      if (job !== undefined) {
        jobs.delete(job.sessionId);
        abort(job, 'cleared');
      }
      return ok({ removed: clearChatMessages(db, session.value.id) });
    },

    observeHead,

    onDelta: (listener): (() => void) => {
      deltaListeners.add(listener);
      return (): void => {
        deltaListeners.delete(listener);
      };
    },

    onMessageUpdated: (listener): (() => void) => {
      updateListeners.add(listener);
      return (): void => {
        updateListeners.delete(listener);
      };
    },

    dispose: async (): Promise<void> => {
      isDisposed = true;
      const stopping = Array.from(jobs.values(), async (job) => {
        abort(job, 'app-quit');
        return job.done;
      });
      await Promise.all(stopping);
    },
  };
}

/** What a question is asked with besides the diff: the conversation and the reviewer's selections. */
interface Conversation {
  readonly history: readonly ChatTurn[];
  readonly summary: string | undefined;
  readonly selections: readonly ChatSelection[];
}

function refusedWhileStreaming(): Result<never, { code: 'refused'; message: string }> {
  return err({
    code: 'refused',
    message:
      'An answer or /compact is still running. Cancel it or wait for it before asking again.',
  });
}
