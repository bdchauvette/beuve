import type {
  ChatAskedView,
  ChatAskRequest,
  ChatCancelledView,
  ChatCancelRequest,
  ChatClearedView,
  ChatClearRequest,
  ChatCommandRequest,
  ChatCompactedView,
  ChatCompactRequest,
  ChatDeltaView,
  ChatErrorCode,
  ChatListRequest,
  ChatListView,
  ChatMessageUpdatedView,
  ImpactFindingView,
  IpcResult,
} from '#contract/ipc-contract.ts';
import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import { askQuestion } from '#internal/chat/ask-question.ts';
import { clearChatMessages } from '#internal/chat/clear-chat-messages.ts';
import type {
  AnswerKind,
  ChatMention,
  ChatMessage,
  ChatMessageId,
  CommitSha,
  SessionId,
} from '#internal/chat/chat-message.ts';
import type { ChatDelta } from '#internal/chat/chat-model.ts';
import type { ChatSelection, ChatTask } from '#internal/chat/chat-question.ts';
import { compactConversation } from '#internal/chat/compact-conversation.ts';
import { deleteChatMessages } from '#internal/chat/delete-chat-messages.ts';
import { listChatMessages } from '#internal/chat/list-chat-messages.ts';
import { normalizePathScope } from '#internal/chat/normalize-path-scope.ts';
import { reviewChange } from '#internal/chat/review-change.ts';
import type { ReviewProgress } from '#internal/chat/review-change.ts';
import { splitAtCompaction } from '#internal/chat/split-at-compaction.ts';
import { toChatHistory } from '#internal/chat/to-chat-history.ts';
import { updateChatAnswer } from '#internal/chat/update-chat-answer.ts';
import type { ChatAnswerUpdate } from '#internal/chat/update-chat-answer.ts';
import { listTreePaths } from '#internal/git/list-tree-paths.ts';
import type { ModelError } from '#internal/llm/language-model.ts';
import { KeyedQueue } from '#x/collections/keyed-queue.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSessionHead } from '../sessions/refresh-session-head.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';

import type { ClaudeCodeSettings } from './claude-code-settings.ts';
import { describeChatError } from './describe-chat-error.ts';
import { modelErrorToChatFailure } from './model-error-to-chat-failure.ts';
import { resolveChatMentions } from './resolve-chat-mentions.ts';
import { resolveLanguageModel } from './resolve-language-model.ts';
import { toChatMessageView } from './to-chat-message-view.ts';
import { toChatQuestion } from './to-chat-question.ts';

/** The read-only Q&A chat, as the renderer reaches it (ADR 0031, 0055–0057). */
export interface ChatServices {
  /**
   * Stores the question (or command) and its answer, `streaming` when the session is idle and
   * `queued` behind its running request otherwise, and returns; the answer runs in its turn.
   */
  readonly ask: (request: ChatAskRequest) => Promise<IpcResult<ChatAskedView>>;
  readonly list: (request: ChatListRequest) => IpcResult<ChatListView>;
  readonly cancel: (request: ChatCancelRequest) => IpcResult<ChatCancelledView>;
  /**
   * `/compact` (ADR 0047): condenses the turns since the last summary into a new summary message,
   * answering once it is stored. It waits its turn in the session's queue like an answer.
   */
  readonly compact: (request: ChatCompactRequest) => Promise<IpcResult<ChatCompactedView>>;
  /** Deletes the transcript (or only the queued requests), stopping what it removes. */
  readonly clear: (request: ChatClearRequest) => IpcResult<ChatClearedView>;
  /** Stops the session's requests that were asked at a head other than `headSha`. */
  readonly observeHead: (sessionId: string, headSha: string) => void;
  /** Subscribes to `chat:delta` events; returns the unsubscribe function. */
  readonly onDelta: (listener: (event: ChatDeltaView) => void) => () => void;
  /** Subscribes to `chat:message-updated` events; returns the unsubscribe function. */
  readonly onMessageUpdated: (listener: (event: ChatMessageUpdatedView) => void) => () => void;
  /** Stops every request and waits until their Claude Code processes are gone. */
  readonly dispose: () => Promise<void>;
}

export interface ChatServicesOptions {
  readonly context: SessionContext;
  readonly impact: Pick<ImpactServices, 'getImpact'>;
  readonly worktrees: Pick<SessionWorktrees, 'ensure'>;
  readonly claude?: ClaudeCodeSettings;
  /** The session's stated intent (a pull request's title and body), put in question prompts. */
  readonly intentFor?: (sessionId: string) => string | undefined;
  /** Least time between stores of the streaming preview. Defaults to 1 second. */
  readonly previewIntervalMs?: number;
  /** Requests that may wait behind a session's running one (ADR 0057). Defaults to 10. */
  readonly maxQueued?: number;
}

/** A question, `/review` or `/summarize`, and the answer it fills. */
interface AnswerJob {
  readonly kind: 'answer';
  readonly sessionId: string;
  readonly headSha: string;
  readonly question: ChatMessage;
  readonly assistant: ChatMessage;
  readonly request: ChatAskRequest;
  readonly selections: readonly ChatSelection[];
  readonly controller: AbortController;
  /** Stored as `queued`, so starting it must say so. */
  readonly wasQueued: boolean;
  /** The raw answer streamed so far. */
  streamed: string;
}

/** A `/compact`; `settle` answers its `chat:compact` call. */
interface CompactJob {
  readonly kind: 'compact';
  readonly sessionId: string;
  readonly headSha: string;
  /** The id the summary will get. */
  readonly messageId: string;
  readonly controller: AbortController;
  readonly settle: (result: IpcResult<ChatCompactedView>) => void;
}

type Outcome =
  | {
      readonly status: 'complete';
      readonly answer: ChatAnswerUpdate;
      /** Earlier turns the prompt dropped for size. */
      readonly droppedTurns: number;
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly code: ChatErrorCode };

/** What a request runs against: the diff, its checkout and its files. */
interface Prepared {
  readonly diff: ReviewDiff;
  readonly worktreePath: string;
  readonly worktreePaths: ReadonlySet<string> | undefined;
  readonly findings: readonly ImpactFindingView[] | undefined;
}

/**
 * Answers questions and runs `/review`, `/summarize` and `/compact` in the background (ADR 0031's
 * recipe, ADR 0055–0057). `ask` stores the question and its answer and returns; each session runs
 * one request at a time and queues the rest in order, at most `maxQueued` waiting. A request
 * builds the same diff `session:get-review` shows, adds the cached ImpactGate findings, the stored
 * history before its question and the head's paths, checks the head out (ADR 0020) and asks
 * Claude Code there. Deltas are pushed as they arrive and the preview is stored at most once per
 * interval; every state change is stored, then pushed. Cancelling stops one request, the rest of
 * the queue goes on; moving the head stops the requests asked at the old head; clearing and
 * quitting stop everything.
 */
export function createChatServices(options: ChatServicesOptions): ChatServices {
  /** Why a request was stopped; the `AbortSignal` reason. `cleared` also means nothing is stored. */
  type AbortReason = 'cancelled' | 'head-changed' | 'cleared' | 'app-quit';
  type Job = AnswerJob | CompactJob;

  const { context, impact, worktrees } = options;
  const { db, logger } = context;
  const claude = options.claude ?? {};
  const previewIntervalMs = options.previewIntervalMs ?? 1000;
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

  const publish = (message: ChatMessage, droppedTurns = 0): void => {
    notify(updateListeners, {
      message: toChatMessageView(message),
      ...(droppedTurns > 0 && { droppedTurns }),
    });
  };

  const abort = (job: Job, reason: AbortReason): void => {
    if (job.controller.signal.aborted) {
      return;
    }

    logger.info('chat request aborted', { kind: job.kind, reason });
    job.controller.abort(reason);
  };

  /** Settles a request that never ran: an answer is stored as `cancelled`, a compaction answered. */
  const drop = (job: Job, shouldStore: boolean): void => {
    job.controller.abort('cancelled');
    if (job.kind === 'compact') {
      job.settle(ok({ outcome: 'cancelled' }));
      return;
    }
    if (!shouldStore) {
      return;
    }
    const update: ChatAnswerUpdate = { status: 'cancelled', content: '' };
    if (updateChatAnswer(db, job.assistant.id, update).ok) {
      publish({ ...job.assistant, ...update, citations: [] });
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

  /** The stored messages before `job`'s question: the conversation it was asked in. */
  const conversationBefore = (job: AnswerJob): Result<ChatMessage[], Outcome> => {
    const stored = listChatMessages(db, job.sessionId as SessionId);
    if (!stored.ok) {
      logger.error('chat history is corrupt', { error: stored.error });
      return err({ status: 'failed', code: 'internal' });
    }
    const at = stored.value.findIndex((message) => message.id === job.question.id);
    return ok(at === -1 ? stored.value : stored.value.slice(0, at));
  };

  const streamInto = (job: AnswerJob): ((delta: ChatDelta) => void) => {
    let lastStoredAt = 0;
    return (delta: ChatDelta): void => {
      if (job.controller.signal.aborted) {
        return;
      }
      job.streamed = delta.kind === 'reset' ? '' : job.streamed + delta.text;
      notify(deltaListeners, {
        sessionId: job.sessionId,
        messageId: job.assistant.id,
        kind: delta.kind,
        text: delta.kind === 'reset' ? '' : delta.text,
      });
      const now = Date.now();
      if (!(now - lastStoredAt >= previewIntervalMs)) {
        return;
      }

      lastStoredAt = now;
      updateChatAnswer(db, job.assistant.id, { status: 'streaming', content: job.streamed });
    };
  };

  const answerQuestion = async (job: AnswerJob): Promise<Outcome> => {
    const before = conversationBefore(job);
    if (!before.ok) {
      return before.error;
    }
    const prepared = await prepare(job, { withImpact: true });
    if (!prepared.ok) {
      return prepared.error;
    }
    const input = toChatQuestion({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: job.request.question,
      history: toChatHistory(before.value),
      summary: splitAtCompaction(before.value).summary?.content,
      selections: job.selections,
      focus: job.request.focus,
      impactFindings: prepared.value.findings,
      intent: options.intentFor?.(job.sessionId),
      worktreePaths: prepared.value.worktreePaths,
    });
    return askModel(job, input);
  };

  /** `/summarize` (ADR 0056): from the diff and the code only, never the stated intent. */
  const summarize = async (job: AnswerJob): Promise<Outcome> => {
    const prepared = await prepare(job, { withImpact: false });
    if (!prepared.ok) {
      return prepared.error;
    }
    const input = toChatQuestion({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: '',
      task: { kind: 'abstract' },
      history: [],
      focus: undefined,
      impactFindings: undefined,
      worktreePaths: prepared.value.worktreePaths,
    });
    return askModel(job, input);
  };

  const askModel = async (
    job: AnswerJob,
    input: ReturnType<typeof toChatQuestion>,
  ): Promise<Outcome> => {
    const model = await resolveLanguageModel(claude, logger);
    if (!model.ok) {
      return { status: 'failed', code: 'not-installed' };
    }
    const asked = await askQuestion<ModelError>(input, {
      model: model.value,
      signal: job.controller.signal,
      onDelta: streamInto(job),
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
    return asked.error.kind === 'model'
      ? toOutcome(asked.error.error)
      : { status: 'failed', code: 'internal' };
  };

  /** `/review` (ADR 0055): findings, verified unless `--no-verify`, or an earlier answer reused. */
  const review = async (
    job: AnswerJob,
    command: Extract<ChatCommandRequest, { kind: 'review' }>,
  ): Promise<Outcome> => {
    const pathScope = normalizePathScope(command.pathPrefixes ?? []);
    const before = conversationBefore(job);
    if (!before.ok) {
      return before.error;
    }
    const earlier = command.fresh === true ? undefined : findReview(before.value, job, pathScope);
    if (earlier !== undefined) {
      return earlier;
    }
    const progress = (text: string): void => {
      notify(deltaListeners, {
        sessionId: job.sessionId,
        messageId: job.assistant.id,
        kind: 'progress',
        text,
      });
    };
    progress('Building the review diff');
    const prepared = await prepare(job, { withImpact: true });
    if (!prepared.ok) {
      return prepared.error;
    }
    if (prepared.value.diff.scope.kind === 'up-to-date') {
      return { status: 'failed', code: 'nothing-to-review' };
    }
    const task: ChatTask = { kind: 'review', pathScope, maxFindings: 12 };
    const input = toChatQuestion({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: '',
      task,
      history: [],
      focus: undefined,
      impactFindings: prepared.value.findings,
      intent: options.intentFor?.(job.sessionId),
      worktreePaths: prepared.value.worktreePaths,
    });
    if (input.files.length === 0) {
      return { status: 'failed', code: 'nothing-to-review' };
    }
    const model = await resolveLanguageModel(claude, logger, command.effort);
    const verifier =
      command.verify === false ? undefined : await resolveLanguageModel(claude, logger, 'low');
    if (!model.ok || verifier?.ok === false) {
      return { status: 'failed', code: 'not-installed' };
    }
    let toolUses = 0;
    const onProgress = (event: ReviewProgress): void => {
      switch (event.kind) {
        case 'reviewing': {
          progress(`Claude Code is reviewing ${plural(event.files, 'file')}`);
          return;
        }
        case 'model': {
          if (event.progress.kind === 'tool-use') {
            toolUses += 1;
            progress(`Claude Code is reading the worktree (${plural(toolUses, 'tool call')})`);
          }
          return;
        }
        case 'verifying': {
          progress(`Checking ${plural(event.findings, 'finding')} against the code`);
          return;
        }
      }
    };
    const reviewed = await reviewChange<ModelError>(input, {
      model: model.value,
      ...(verifier?.ok === true && { verifier: verifier.value }),
      signal: job.controller.signal,
      onProgress,
      ...(claude.timeoutMs !== undefined && { timeoutMs: claude.timeoutMs }),
    });
    if (!reviewed.ok) {
      return reviewed.error.kind === 'model'
        ? toOutcome(reviewed.error.error)
        : { status: 'failed', code: 'internal' };
    }
    logger.info('chat review answered', {
      findings: reviewed.value.review.findings.length,
      unconfirmed: reviewed.value.review.dropped.unconfirmed,
      verification: reviewed.value.review.verification,
    });
    return {
      status: 'complete',
      answer: {
        status: 'complete',
        content: reviewed.value.content,
        citations: reviewed.value.citations,
        review: reviewed.value.review,
      },
      droppedTurns: 0,
    };
  };

  const runAnswer = async (job: AnswerJob): Promise<void> => {
    if (job.wasQueued) {
      const started: ChatAnswerUpdate = { status: 'streaming', content: '' };
      if (updateChatAnswer(db, job.assistant.id, started).ok) {
        publish({ ...job.assistant, ...started });
      }
    }
    let outcome: Outcome;
    try {
      const { command } = job.request;
      outcome =
        command === undefined
          ? await answerQuestion(job)
          : command.kind === 'review'
            ? await review(job, command)
            : await summarize(job);
    } catch (error: unknown) {
      logger.error('chat answer failed unexpectedly', { error });
      outcome = { status: 'failed', code: 'internal' };
    }
    finish(job, outcome);
  };

  const finish = (job: AnswerJob, outcome: Outcome): void => {
    if (job.controller.signal.reason === 'cleared') {
      return;
    }
    const update: ChatAnswerUpdate =
      outcome.status === 'complete'
        ? outcome.answer
        : outcome.status === 'cancelled'
          ? { status: 'cancelled', content: job.streamed }
          : { status: 'failed', errorCode: outcome.code, content: job.streamed };
    const stored = updateChatAnswer(db, job.assistant.id, update);
    if (!stored.ok) {
      logger.warn('chat answer not stored', { error: stored.error });
      return;
    }
    publish(
      { ...job.assistant, ...update, citations: update.citations ?? [] },
      outcome.status === 'complete' ? outcome.droppedTurns : 0,
    );
  };

  /** Runs `/compact`: the turns since the last summary become one summary message. */
  const runCompaction = async (job: CompactJob): Promise<void> => {
    let result: IpcResult<ChatCompactedView>;
    try {
      result = await condense(job);
    } catch (error: unknown) {
      logger.error('chat compaction failed unexpectedly', { error });
      result = ok({
        outcome: 'failed',
        errorCode: 'internal',
        errorMessage: describeChatError('internal'),
      });
    }
    job.settle(job.controller.signal.aborted ? ok({ outcome: 'cancelled' }) : result);
  };

  const condense = async (job: CompactJob): Promise<IpcResult<ChatCompactedView>> => {
    const failed = (outcome: Outcome): IpcResult<ChatCompactedView> =>
      ok(
        outcome.status === 'failed'
          ? {
              outcome: 'failed',
              errorCode: outcome.code,
              errorMessage: describeChatError(outcome.code),
            }
          : { outcome: 'cancelled' },
      );
    const stored = listChatMessages(db, job.sessionId as SessionId);
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
    const prepared = await prepare(job, { withImpact: false });
    if (!prepared.ok) {
      return failed(prepared.error);
    }
    const model = await resolveLanguageModel(claude, logger);
    if (!model.ok) {
      return failed({ status: 'failed', code: 'not-installed' });
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
    const summary = splitAtCompaction(stored.value).summary?.content;
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
      return failed(
        compacted.error.kind === 'nothing-to-compact'
          ? { status: 'failed', code: 'internal' }
          : toOutcome(compacted.error.error),
      );
    }
    if (job.controller.signal.aborted) {
      return ok({ outcome: 'cancelled' });
    }
    const message: ChatMessage = {
      id: job.messageId as ChatMessageId,
      sessionId: job.sessionId as SessionId,
      headSha: job.headSha as CommitSha,
      role: 'summary',
      content: compacted.value.content,
      citations: compacted.value.citations,
      mentions: [],
      createdAt: context.deps.now().toISOString(),
    };
    const appended = appendChatMessage(db, message);
    return appended.ok
      ? ok({ outcome: 'compacted', summary: toChatMessageView(message) })
      : err({ code: 'not-found', message: 'no such session' });
  };

  const queue = new KeyedQueue<string, Job>(
    async (job) => (job.kind === 'answer' ? runAnswer(job) : runCompaction(job)),
    options.maxQueued ?? 10,
  );

  const jobOfMessage = (messageId: string): AnswerJob | undefined =>
    queue
      .all()
      .find((job): job is AnswerJob => job.kind === 'answer' && job.assistant.id === messageId);

  /** A `queued` or `streaming` answer no job is writing (the app died) is shown as cancelled. */
  const settleOrphan = (message: ChatMessage): ChatMessage => {
    if (
      message.role !== 'assistant' ||
      (message.status !== 'streaming' && message.status !== 'queued') ||
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

  const observeHead = (sessionId: string, headSha: string): void => {
    const running = queue.running(sessionId);
    if (running !== undefined && running.headSha !== headSha) {
      abort(running, 'head-changed');
    }
    const stale = queue.remove(sessionId, (waiting) => waiting.headSha !== headSha);
    for (const job of stale) {
      drop(job, true);
    }
  };

  /**
   * Takes requests in the order they were made: the head refresh and mention reads before a
   * request is queued take varying time, and the queue must follow the reviewer's order.
   */
  let intake: Promise<unknown> = Promise.resolve();
  const inOrder = async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = intake;
    const turn = (async (): Promise<T> => {
      await settled(previous);
      return task();
    })();
    intake = settled(turn);
    return turn;
  };

  const queueFull = (): Result<never, { code: 'refused'; message: string }> =>
    err({
      code: 'refused',
      message: `${String(options.maxQueued ?? 10)} requests are already waiting. Wait, cancel one or clear the queue.`,
    });

  return {
    ask: async (request): Promise<IpcResult<ChatAskedView>> =>
      inOrder(async (): Promise<IpcResult<ChatAskedView>> => {
        if (isDisposed) {
          return err({ code: 'not-wired', message: 'beuve is quitting' });
        }
        const head = await refreshSessionHead(context, request.sessionId);
        if (!head.ok) {
          return head;
        }
        const { sessionId, headSha } = head.value;
        let mentions: readonly ChatMention[] = [];
        let selections: readonly ChatSelection[] = [];
        if (
          request.command === undefined &&
          request.mentions !== undefined &&
          request.mentions.length > 0
        ) {
          const diff = await loadReviewDiff(context, sessionId);
          if (!diff.ok) {
            return diff;
          }
          const resolved = await resolveChatMentions(context, diff.value, request.mentions);
          if (!resolved.ok) {
            return resolved;
          }
          ({ mentions, selections } = resolved.value);
        }
        if (queue.isFull(sessionId)) {
          return queueFull();
        }
        const createdAt = context.deps.now().toISOString();
        const common = { sessionId: sessionId as SessionId, headSha: headSha as CommitSha };
        const isQueued = queue.isBusy(sessionId);
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
          kind: answerKindOf(request.command),
          status: isQueued ? 'queued' : 'streaming',
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
        queue.enqueue(sessionId, {
          kind: 'answer',
          sessionId,
          headSha,
          question,
          assistant,
          request,
          selections,
          controller: new AbortController(),
          wasQueued: isQueued,
          streamed: '',
        });
        return ok({ question: toChatMessageView(question), answer: toChatMessageView(assistant) });
      }),

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
        'messageId' in request
          ? jobOfMessage(request.messageId)
          : queue
              .all()
              .find(
                (candidate) =>
                  candidate.kind === 'compact' && candidate.sessionId === request.sessionId,
              );
      if (job === undefined) {
        return ok({ cancelled: false });
      }
      if (queue.running(job.sessionId) === job) {
        abort(job, 'cancelled');
      } else {
        queue.remove(job.sessionId, (waiting) => waiting === job);
        drop(job, true);
      }
      return ok({ cancelled: true });
    },

    compact: async ({ sessionId: requested }): Promise<IpcResult<ChatCompactedView>> => {
      const queued = await inOrder(
        async (): Promise<IpcResult<{ done: Promise<IpcResult<ChatCompactedView>> }>> => {
          if (isDisposed) {
            return err({ code: 'not-wired', message: 'beuve is quitting' });
          }
          const head = await refreshSessionHead(context, requested);
          if (!head.ok) {
            return head;
          }
          const { sessionId, headSha } = head.value;
          if (queue.isFull(sessionId)) {
            return queueFull();
          }
          const settled = Promise.withResolvers<IpcResult<ChatCompactedView>>();
          queue.enqueue(sessionId, {
            kind: 'compact',
            sessionId,
            headSha,
            messageId: context.deps.newId(),
            controller: new AbortController(),
            settle: settled.resolve,
          });
          return ok({ done: settled.promise });
        },
      );
      return queued.ok ? queued.value.done : queued;
    },

    clear: ({ sessionId, queuedOnly }): IpcResult<ChatClearedView> => {
      const session = loadSession(context, sessionId);
      if (!session.ok) {
        return session;
      }
      const id = session.value.id;
      const waiting = queue.remove(id, () => true);
      if (queuedOnly === true) {
        const messages = waiting.flatMap((job) =>
          job.kind === 'answer' ? [job.question.id, job.assistant.id] : [],
        );
        for (const job of waiting) {
          drop(job, false);
        }
        return ok({ removed: deleteChatMessages(db, id, messages) });
      }
      for (const job of waiting) {
        drop(job, false);
      }
      const running = queue.running(id);
      if (running !== undefined) {
        abort(running, 'cleared');
      }
      return ok({ removed: clearChatMessages(db, id) });
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
      for (const job of queue.all()) {
        if (queue.running(job.sessionId) === job) {
          abort(job, 'app-quit');
        } else {
          queue.remove(job.sessionId, (waiting) => waiting === job);
          drop(job, false);
        }
      }
      await queue.idle();
    },
  };
}

/** A model failure as an answer's outcome; a cancellation keeps what streamed (ADR 0031). */
function toOutcome(error: ModelError): Outcome {
  const failed = modelErrorToChatFailure(error);
  return failed.kind === 'cancelled'
    ? { status: 'cancelled' }
    : { status: 'failed', code: failed.code };
}

/** Waits for `promise` and ignores how it ended. */
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Only the order matters here; the request reports its own failure.
  }
}

function answerKindOf(command: ChatCommandRequest | undefined): AnswerKind {
  switch (command?.kind) {
    case undefined: {
      return 'answer';
    }
    case 'review': {
      return 'review';
    }
    case 'summarize': {
      return 'abstract';
    }
  }
}

/**
 * The latest completed `/review` before `job` at its head and with exactly its scope (ADR 0024's
 * reuse rule, now over the transcript), repeated as this answer's outcome.
 */
function findReview(
  messages: readonly ChatMessage[],
  job: AnswerJob,
  pathScope: readonly string[],
): Outcome | undefined {
  const earlier = messages.findLast(
    (message) =>
      message.role === 'assistant' &&
      message.kind === 'review' &&
      message.status === 'complete' &&
      message.headSha === job.headSha &&
      message.review !== undefined &&
      hasSameScope(message.review.pathScope, pathScope),
  );
  if (earlier?.role !== 'assistant' || earlier.review === undefined) {
    return undefined;
  }
  return {
    status: 'complete',
    answer: {
      status: 'complete',
      content: earlier.content,
      citations: earlier.citations,
      review: { ...earlier.review, reusedFrom: earlier.review.reusedFrom ?? earlier.id },
    },
    droppedTurns: 0,
  };
}

function hasSameScope(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((prefix, index) => prefix === right[index]);
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
