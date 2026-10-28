import type {
  ChatAskedView,
  ChatAskRequest,
  ChatCancelledView,
  ChatCancelRequest,
  ChatClearedView,
  ChatClearRequest,
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
  ChatMessage,
  ChatMessageId,
  CommitSha,
  SessionId,
} from '#internal/chat/chat-message.ts';
import type { ChatDelta } from '#internal/chat/chat-model.ts';
import type { ChatQuestion, ChatTurn } from '#internal/chat/chat-question.ts';
import { listChatMessages } from '#internal/chat/list-chat-messages.ts';
import { toChatHistory } from '#internal/chat/to-chat-history.ts';
import { updateChatAnswer } from '#internal/chat/update-chat-answer.ts';
import type { ChatAnswerUpdate } from '#internal/chat/update-chat-answer.ts';
import { listTreePaths } from '#internal/git/list-tree-paths.ts';
import type { ModelError } from '#internal/llm/language-model.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import type { ClaudeCodeSettings } from '../review/claude-code-settings.ts';
import { resolveLanguageModel } from '../review/resolve-language-model.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSessionHead } from '../sessions/refresh-session-head.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';

import { modelErrorToChatFailure } from './model-error-to-chat-failure.ts';
import type { ChatFailure } from './model-error-to-chat-failure.ts';
import { toChatMessageView } from './to-chat-message-view.ts';
import { toChatQuestion } from './to-chat-question.ts';

/** The read-only Q&A chat, as the renderer reaches it (ADR 0031). */
export interface ChatServices {
  /** Stores the question and a streaming answer, starts the answer in the background, returns. */
  readonly ask: (request: ChatAskRequest) => Promise<IpcResult<ChatAskedView>>;
  readonly list: (request: ChatListRequest) => IpcResult<ChatListView>;
  readonly cancel: (request: ChatCancelRequest) => IpcResult<ChatCancelledView>;
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
  /** Least time between stores of the streaming preview. Defaults to 1 second. */
  readonly previewIntervalMs?: number;
}

interface Job {
  readonly sessionId: string;
  readonly headSha: string;
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
    | { readonly status: 'complete'; readonly answer: ChatAnswerUpdate }
    | { readonly status: 'cancelled' }
    | { readonly status: 'failed'; readonly code: ChatErrorCode };

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
    question: string,
    history: readonly ChatTurn[],
    focus: ChatAskRequest['focus'],
  ): Promise<Result<ChatQuestion, Outcome>> => {
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
    const impactView = await impact.getImpact({ sessionId: job.sessionId });
    const findings =
      impactView.ok && impactView.value.headSha === job.headSha
        ? impactView.value.findings
        : undefined;
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
    return ok(
      toChatQuestion({
        diff: diff.value,
        worktreePath: worktree.value,
        question,
        history,
        focus,
        impactFindings: findings,
        worktreePaths: tree.ok ? new Set(tree.value) : undefined,
      }),
    );
  };

  const answer = async (
    job: Job,
    assistant: ChatMessage,
    request: ChatAskRequest,
    history: readonly ChatTurn[],
  ): Promise<Outcome> => {
    const { signal } = job.controller;
    const input = await prepare(job, request.question, history, request.focus);
    if (!input.ok) {
      return input.error;
    }
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
    const asked = await askQuestion<ModelError>(input.value, {
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
    notify(updateListeners, { message: toChatMessageView(final) });
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
        createdAt,
      };
      const assistant: ChatMessage = {
        ...common,
        id: context.deps.newId() as ChatMessageId,
        role: 'assistant',
        status: 'streaming',
        content: '',
        citations: [],
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
      const history = toChatHistory(stored.value);
      job.done = (async (): Promise<void> => {
        let outcome: Outcome;
        try {
          outcome = await answer(job, assistant, request, history);
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

    cancel: ({ messageId }): IpcResult<ChatCancelledView> => {
      const job = jobOfMessage(messageId);
      if (job === undefined) {
        return ok({ cancelled: false });
      }
      abort(job, 'cancelled');
      return ok({ cancelled: true });
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

function refusedWhileStreaming(): Result<never, { code: 'refused'; message: string }> {
  return err({
    code: 'refused',
    message: 'An answer is still streaming. Cancel it or wait for it before asking again.',
  });
}
