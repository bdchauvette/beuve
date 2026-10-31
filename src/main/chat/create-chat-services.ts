import { mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  ChatErrorCode,
  ChatListRequest,
  ChatListView,
  ChatStreamEvent,
  ImpactFindingView,
  IpcResult,
  ModelRole,
  ModelTestView,
} from '#contract/ipc-contract.ts';
import { answerPartsFrom } from '#internal/chat/answer-parts-from.ts';
import type { AnswerEnding } from '#internal/chat/answer-parts-from.ts';
import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import { applyModelEvent } from '#internal/chat/apply-model-event.ts';
import type { ModelStreamEvent, StreamedParts } from '#internal/chat/apply-model-event.ts';
import { askQuestion } from '#internal/chat/ask-question.ts';
import { clearChatMessages } from '#internal/chat/clear-chat-messages.ts';
import type {
  AnswerKind,
  ChatMention,
  ChatMessage,
  ChatMessageId,
  Citation,
  CommitSha,
  SessionId,
} from '#internal/chat/chat-message.ts';
import type { ChatReview } from '#internal/chat/chat-review.ts';
import type { ChatPartEvent } from '#internal/chat/chat-part-event.ts';
import { chatPartsFrom } from '#internal/chat/chat-parts-from.ts';
import { chatTextFrom } from '#internal/chat/chat-text-from.ts';
import type { ChatQuestion, ChatSelection, ChatTask } from '#internal/chat/chat-question.ts';
import { compactConversation } from '#internal/chat/compact-conversation.ts';
import { deleteChatMessages } from '#internal/chat/delete-chat-messages.ts';
import { listChatMessages } from '#internal/chat/list-chat-messages.ts';
import { normalizePathScope } from '#internal/chat/normalize-path-scope.ts';
import { reviewChange } from '#internal/chat/review-change.ts';
import type { ReviewProgress } from '#internal/chat/review-change.ts';
import { splitAtCompaction } from '#internal/chat/split-at-compaction.ts';
import { streamedPartsFrom } from '#internal/chat/streamed-parts-from.ts';
import { chatHistoryFrom } from '#internal/chat/chat-history-from.ts';
import { updateChatAnswer } from '#internal/chat/update-chat-answer.ts';
import type { ChatAnswerUpdate } from '#internal/chat/update-chat-answer.ts';
import { listTreePaths } from '#internal/git/list-tree-paths.ts';
import type { LanguageModel, ModelError } from '#internal/llm/language-model.ts';
import { KeyedQueue } from '#x/collections/keyed-queue.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSessionHead } from '../sessions/refresh-session-head.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees, WorktreeLease } from '../worktrees/create-session-worktrees.ts';
import { worktreeFailure } from '../worktrees/worktree-failure.ts';

import type { ClaudeCodeSettings } from './claude-code-settings.ts';
import { describeChatActivity } from './describe-chat-activity.ts';
import { describeChatError } from './describe-chat-error.ts';
import { chatFailureFromModelError } from './chat-failure-from-model-error.ts';
import { resolveChatMentions } from './resolve-chat-mentions.ts';
import { describeModelError } from '../models/describe-model-error.ts';
import { bindModelTree } from './bind-model-tree.ts';
import { createSandboxTree } from './create-sandbox-tree.ts';
import { resolveLanguageModel } from '../models/resolve-language-model.ts';
import type { ModelResolverDeps, ResolvedModel } from '../models/resolve-language-model.ts';
import { chatMessageViewFrom } from './chat-message-view-from.ts';
import { chatPartViewFrom } from './chat-part-view-from.ts';
import { chatQuestionFrom } from './chat-question-from.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

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
  readonly observeHead: (sessionId: string, headSha: CommitSha) => void;
  /** Subscribes to `chat:stream` events (ADR 0072); returns the unsubscribe function. */
  readonly onStream: (listener: (event: ChatStreamEvent) => void) => () => void;
  /**
   * Settings' Test (ADR 0070): one tiny request to a registry entry, queued like a question
   * (ADR 0057) in a queue of its own, in an empty scratch directory. Never rejects.
   */
  readonly testModel: (entryId: string) => Promise<ModelTestView>;
  /** Stops every request and waits until their Claude Code processes are gone. */
  readonly dispose: () => Promise<void>;
}

export interface ChatServicesOptions {
  readonly context: SessionContext;
  readonly impact: Pick<ImpactServices, 'getImpact'>;
  readonly worktrees: Pick<SessionWorktrees, 'acquire'>;
  /** Request timeouts; how the CLI entry runs is in `models.claude`. */
  readonly claude?: ClaudeCodeSettings;
  /** The model registry each role resolves through (ADR 0070). */
  readonly models: ModelResolverDeps;
  /** The session's stated intent (a pull request's title and body), put in question prompts. */
  readonly intentFor?: (sessionId: string) => string | undefined;
  /** Least time between stores of the streaming preview. Defaults to 1 second. */
  readonly previewInterval?: Temporal.Duration;
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
  /** The answer's parts so far (ADR 0072). */
  streamed: StreamedParts;
  /** `streaming` once the first part arrived. */
  status: 'submitted' | 'streaming';
  /** The status line last pushed, so an unchanged one isn't pushed again. */
  activity?: string;
}

/** Settings' Test of one registry entry; `settle` answers its `models:test` call. */
interface ProbeJob {
  readonly kind: 'probe';
  readonly sessionId: string;
  readonly headSha: string;
  readonly entryId: string;
  readonly controller: AbortController;
  readonly settle: (view: ModelTestView) => void;
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
      readonly status: 'done';
      /** The validated text, or a `/review`'s findings. */
      readonly ending: Extract<AnswerEnding, { kind: 'text' | 'findings' }>;
      readonly citations: readonly Citation[];
      readonly review?: ChatReview;
      /** Earlier turns the prompt dropped for size. */
      readonly droppedTurns: number;
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly code: ChatErrorCode };

/** What {@link createChatServices}' `prepare` reads before a request asks its models. */
interface Preparation {
  readonly withImpact: boolean;
  /** The models the request will ask; a checkout is leased only if one of them reads it. */
  readonly models: readonly LanguageModel[];
}

/** One model call of an answer: the question, the role it serves and what it runs against. */
interface ModelAsk {
  readonly input: ChatQuestion;
  readonly role: ModelRole;
  readonly resolved: ResolvedModel;
  readonly prepared: Prepared;
}

/** The refusal of a request when the session's queue is full (ADR 0057). */
interface QueueFull {
  readonly code: 'refused';
  readonly message: string;
}

/** A queued `/compact`, and the answer its `chat:compact` call waits for. */
interface QueuedCompaction {
  readonly done: Promise<IpcResult<ChatCompactedView>>;
}

/**
 * What a request runs against: the diff, the head's files from git objects, and a checkout only
 * when one of its models reads one (ADR 0087). Disposing releases the checkout.
 */
interface Prepared extends Disposable {
  readonly diff: ReviewDiff;
  readonly worktreePath: string | undefined;
  readonly worktreePaths: ReadonlySet<string> | undefined;
  readonly findings: readonly ImpactFindingView[] | undefined;
  /** Binds a resolved model to the head's tree, for adapters whose tools read objects. */
  readonly bind: (model: LanguageModel) => LanguageModel;
}

/**
 * Answers questions and runs `/review`, `/summarize` and `/compact` in the background (ADR 0031's
 * recipe, ADR 0055–0057). `ask` stores the question and its answer and returns; each session runs
 * one request at a time and queues the rest in order, at most `maxQueued` waiting. A request
 * builds the same diff `session:get-review` shows, adds the cached ImpactGate findings, the stored
 * history before its question and the head's paths, checks the head out (ADR 0020) and asks
 * the model there. Its progress and text become parts (ADR 0072), pushed as part events as they
 * arrive and stored at most once per interval; every status change is stored, then pushed. Cancelling stops one request, the rest of
 * the queue goes on; moving the head stops the requests asked at the old head; clearing and
 * quitting stop everything.
 */
export function createChatServices(options: ChatServicesOptions): ChatServices {
  /** Why a request was stopped; the `AbortSignal` reason. `cleared` also means nothing is stored. */
  type AbortReason = 'cancelled' | 'head-changed' | 'cleared' | 'app-quit';
  type Job = AnswerJob | CompactJob | ProbeJob;

  const { context, impact, worktrees } = options;
  const { db, logger } = context;
  const claude = options.claude ?? {};
  const previewInterval = options.previewInterval ?? Temporal.Duration.from({ seconds: 1 });
  const streamListeners = new Set<(event: ChatStreamEvent) => void>();
  let isDisposed = false;

  const notify = (event: ChatStreamEvent): void => {
    for (const listener of streamListeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        logger.warn('chat listener failed', { error });
      }
    }
  };

  const publish = (message: ChatMessage, droppedTurns = 0): void => {
    notify({
      type: 'message',
      sessionId: message.sessionId,
      messageId: message.id,
      message: chatMessageViewFrom(message),
      ...(droppedTurns > 0 && { droppedTurns }),
    });
  };

  const pushStatus = (job: AnswerJob, activity?: string): void => {
    if (activity !== undefined) {
      job.activity = activity;
    }
    notify({
      type: 'status',
      sessionId: job.sessionId,
      messageId: job.assistant.id,
      status: job.status,
      ...(activity !== undefined && { activity }),
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
    if (job.kind === 'probe') {
      job.settle({
        outcome: 'failed',
        elapsedMs: 0,
        errorKind: 'cancelled',
        message: 'Cancelled.',
      });
      return;
    }
    if (job.kind === 'compact') {
      job.settle(ok({ outcome: 'cancelled' }));
      return;
    }
    if (!shouldStore) {
      return;
    }
    const update: ChatAnswerUpdate = { status: 'cancelled', parts: [] };
    if (updateChatAnswer(db, job.assistant.id, update).ok) {
      publish({ ...job.assistant, ...update, citations: [] });
    }
  };

  const resolve = async (role: ModelRole): Promise<Result<ResolvedModel, Outcome>> => {
    const resolved = await resolveLanguageModel({ role }, options.models);
    if (resolved.ok) {
      return resolved;
    }
    return err(outcomeFrom(resolved.error));
  };

  const prepare = async (
    job: AnswerJob | CompactJob,
    preparation: Preparation,
  ): Promise<Result<Prepared, Outcome>> => {
    const isAborted = (): boolean => job.controller.signal.aborted;
    const unavailable = (): Result<never, Outcome> => {
      return err({ status: 'failed', code: 'chat-unavailable' });
    };
    const diff = await loadReviewDiff(context, job.sessionId, { signal: job.controller.signal });
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
    if (preparation.withImpact) {
      const impactView = await impact.getImpact(
        { sessionId: job.sessionId },
        { signal: job.controller.signal },
      );
      if (impactView.ok && impactView.value.headSha === job.headSha) {
        findings = impactView.value.findings;
      }
    }
    if (isAborted()) {
      return err({ status: 'cancelled' });
    }
    let worktree: WorktreeLease | undefined;
    if (preparation.models.some((model) => model.capabilities.checkout)) {
      const leased = await worktrees.acquire(
        refreshed.repository,
        { kind: 'session-head', sessionId: job.sessionId, headSha: refreshed.session.headSha },
        { signal: job.controller.signal },
      );
      if (isAborted()) {
        if (leased.ok) {
          leased.value[Symbol.dispose]();
        }
        return err({ status: 'cancelled' });
      }
      if (!leased.ok) {
        worktreeFailure(logger, leased.error);
        return unavailable();
      }
      worktree = leased.value;
    }
    const paths = await listTreePaths(refreshed.repository, refreshed.session.headSha);
    const tree = createSandboxTree(context, {
      repository: refreshed.repository,
      commit: refreshed.session.headSha,
      signal: job.controller.signal,
    });
    let worktreePaths: ReadonlySet<string> | undefined;
    if (paths.ok) {
      worktreePaths = new Set(paths.value);
    }
    return ok({
      diff: diff.value,
      worktreePath: worktree?.path,
      worktreePaths,
      findings,
      bind: (model): LanguageModel => {
        return bindModelTree(model, tree);
      },
      [Symbol.dispose]: (): void => {
        worktree?.[Symbol.dispose]();
      },
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
    if (at === -1) {
      return ok(stored.value);
    }
    return ok(stored.value.slice(0, at));
  };

  /**
   * Folds the model's progress and text into the answer's parts (ADR 0072): pushes each part
   * event, says `streaming` on the first part, and stores the parts at most once per interval.
   */
  const streamInto = (job: AnswerJob): ((event: ModelStreamEvent) => void) => {
    let lastStored: Stopwatch | undefined;
    return (event: ModelStreamEvent): void => {
      if (job.controller.signal.aborted) {
        return;
      }
      const applied = applyModelEvent(job.streamed, event);
      job.streamed = applied.state;
      if (applied.events.length === 0) {
        return;
      }
      if (job.status === 'submitted') {
        job.status = 'streaming';
        pushStatus(job);
        lastStored = undefined;
      }
      for (const partEvent of applied.events) {
        notify(streamEventFrom(job, partEvent));
      }
      if (
        lastStored !== undefined &&
        Temporal.Duration.compare(lastStored.elapsed(), previewInterval) < 0
      ) {
        return;
      }

      lastStored = new Stopwatch();
      updateChatAnswer(db, job.assistant.id, { status: 'streaming', parts: job.streamed.parts });
    };
  };

  const answerQuestion = async (job: AnswerJob): Promise<Outcome> => {
    const before = conversationBefore(job);
    if (!before.ok) {
      return before.error;
    }
    const model = await resolve('chat');
    if (!model.ok) {
      return model.error;
    }
    const prepared = await prepare(job, { withImpact: true, models: [model.value.model] });
    if (!prepared.ok) {
      return prepared.error;
    }
    using _checkout = prepared.value;
    const input = chatQuestionFrom({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: job.request.question,
      history: chatHistoryFrom(before.value),
      summary: summaryTextOf(before.value),
      selections: job.selections,
      focus: job.request.focus,
      impactFindings: prepared.value.findings,
      intent: options.intentFor?.(job.sessionId),
      worktreePaths: prepared.value.worktreePaths,
    });
    return await askModel(job, {
      input,
      role: 'chat',
      resolved: model.value,
      prepared: prepared.value,
    });
  };

  /** `/summarize` (ADR 0056): from the diff and the code only, never the stated intent. */
  const summarize = async (job: AnswerJob): Promise<Outcome> => {
    const model = await resolve('summarize');
    if (!model.ok) {
      return model.error;
    }
    const prepared = await prepare(job, { withImpact: false, models: [model.value.model] });
    if (!prepared.ok) {
      return prepared.error;
    }
    using _checkout = prepared.value;
    const input = chatQuestionFrom({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: '',
      task: { kind: 'abstract' },
      history: [],
      focus: undefined,
      impactFindings: undefined,
      worktreePaths: prepared.value.worktreePaths,
    });
    return await askModel(job, {
      input,
      role: 'summarize',
      resolved: model.value,
      prepared: prepared.value,
    });
  };

  const askModel = async (
    job: AnswerJob,
    { input, role, resolved, prepared }: ModelAsk,
  ): Promise<Outcome> => {
    const { name } = resolved;
    const stream = streamInto(job);
    const report = (event: ModelStreamEvent): void => {
      stream(event);
      const activity = describeChatActivity(name, event);
      if (activity !== undefined && activity !== job.activity && !job.controller.signal.aborted) {
        pushStatus(job, activity);
      }
    };
    pushStatus(job, askingStatus(role, name));
    const asked = await askQuestion<ModelError>(input, {
      model: prepared.bind(resolved.model),
      signal: job.controller.signal,
      onDelta: (delta): void => {
        report({ kind: 'text', delta });
      },
      onProgress: (progress): void => {
        report({ kind: 'progress', progress });
      },
      ...(claude.timeout !== undefined && { timeout: claude.timeout }),
    });
    if (asked.ok) {
      return {
        status: 'done',
        ending: { kind: 'text', text: asked.value.answer },
        citations: asked.value.citations,
        droppedTurns: asked.value.prompt.omittedTurns,
      };
    }
    if (asked.error.kind === 'model') {
      return outcomeFrom(asked.error.error);
    }
    return { status: 'failed', code: 'internal' };
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
    if (command.fresh !== true) {
      const earlier = findReview(before.value, job, pathScope);
      if (earlier !== undefined) {
        return earlier;
      }
    }
    const progress = (text: string): void => {
      pushStatus(job, text);
    };
    const stream = streamInto(job);
    progress('Building the review diff');
    const model = await resolve('review');
    if (!model.ok) {
      return model.error;
    }
    let verifier: Result<ResolvedModel, Outcome> | undefined;
    if (command.verify !== false) {
      verifier = await resolve('verify');
    }
    if (verifier?.ok === false) {
      return verifier.error;
    }
    const models = [model.value.model];
    if (verifier?.ok === true) {
      models.push(verifier.value.model);
    }
    const prepared = await prepare(job, { withImpact: true, models });
    if (!prepared.ok) {
      return prepared.error;
    }
    using _checkout = prepared.value;
    if (prepared.value.diff.scope.kind === 'up-to-date') {
      return { status: 'failed', code: 'nothing-to-review' };
    }
    const task: ChatTask = { kind: 'review', pathScope, maxFindings: 12 };
    const input = chatQuestionFrom({
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
    const { name } = model.value;
    let toolUses = 0;
    let checking = 'Checking the findings against the code';
    const onProgress = (event: ReviewProgress): void => {
      switch (event.kind) {
        case 'reviewing': {
          progress(`${name} is reviewing ${plural(event.files, 'file')}`);
          return;
        }
        case 'model': {
          stream({ kind: 'progress', progress: event.progress });
          if (event.pass === 'verify') {
            if (event.progress.kind === 'tool-start') {
              progress(`${checking}: ${event.progress.description}`);
            }
            return;
          }
          if (event.progress.kind === 'tool-start') {
            toolUses += 1;
            progress(
              `${name} is reading the worktree (${plural(toolUses, 'tool call')}): ${event.progress.description}`,
            );
          } else if (toolUses === 0 && event.progress.kind === 'thinking') {
            progress(`${name} is thinking`);
          }
          return;
        }
        case 'verifying': {
          checking = `Checking ${plural(event.findings, 'finding')} against the code`;
          progress(checking);
          return;
        }
      }
    };
    const reviewed = await reviewChange<ModelError>(input, {
      model: prepared.value.bind(model.value.model),
      ...(verifier?.ok === true && { verifier: prepared.value.bind(verifier.value.model) }),
      ...(command.effort !== undefined && { effort: command.effort }),
      verifierEffort: 'low',
      signal: job.controller.signal,
      onProgress,
      ...(claude.timeout !== undefined && { timeout: claude.timeout }),
    });
    if (!reviewed.ok) {
      if (reviewed.error.kind === 'model') {
        return outcomeFrom(reviewed.error.error);
      }
      return { status: 'failed', code: 'internal' };
    }
    logger.info('chat review answered', {
      findings: reviewed.value.review.findings.length,
      unconfirmed: reviewed.value.review.dropped.unconfirmed,
      verification: reviewed.value.review.verification,
    });
    return {
      status: 'done',
      ending: { kind: 'findings', count: reviewed.value.review.findings.length },
      citations: reviewed.value.citations,
      review: reviewed.value.review,
      droppedTurns: 0,
    };
  };

  const runAnswer = async (job: AnswerJob): Promise<void> => {
    if (
      job.wasQueued &&
      updateChatAnswer(db, job.assistant.id, { status: 'submitted', parts: [] }).ok
    ) {
      pushStatus(job);
    }
    let outcome: Outcome;
    try {
      outcome = await answerFor(job);
    } catch (error: unknown) {
      logger.error('chat answer failed unexpectedly', { error });
      outcome = { status: 'failed', code: 'internal' };
    }
    finish(job, outcome);
  };

  const answerFor = async (job: AnswerJob): Promise<Outcome> => {
    const { command } = job.request;
    if (command === undefined) {
      return answerQuestion(job);
    }
    if (command.kind === 'review') {
      return review(job, command);
    }
    return summarize(job);
  };

  const finish = (job: AnswerJob, outcome: Outcome): void => {
    if (job.controller.signal.reason === 'cleared') {
      return;
    }
    const update = answerUpdateFrom(job.streamed, outcome);
    const stored = updateChatAnswer(db, job.assistant.id, update);
    if (!stored.ok) {
      logger.warn('chat answer not stored', { error: stored.error });
      return;
    }
    publish(
      { ...job.assistant, ...update, citations: update.citations ?? [] },
      droppedTurnsOf(outcome),
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
    if (job.controller.signal.aborted) {
      result = ok({ outcome: 'cancelled' });
    }
    job.settle(result);
  };

  const condense = async (job: CompactJob): Promise<IpcResult<ChatCompactedView>> => {
    const failed = (outcome: Outcome): IpcResult<ChatCompactedView> => {
      return ok(compactionFailureFrom(outcome));
    };
    const stored = listChatMessages(db, job.sessionId as SessionId);
    if (!stored.ok) {
      logger.error('chat history is corrupt', { error: stored.error });
      return err({ code: 'internal', message: 'stored chat history is corrupt' });
    }
    const turns = chatHistoryFrom(stored.value);
    if (turns.length === 0) {
      return err({
        code: 'refused',
        message: 'Nothing to compact yet: there is no question since the last summary.',
      });
    }
    const model = await resolve('compact');
    if (!model.ok) {
      return failed(model.error);
    }
    const prepared = await prepare(job, { withImpact: false, models: [model.value.model] });
    if (!prepared.ok) {
      return failed(prepared.error);
    }
    using _checkout = prepared.value;
    const question = chatQuestionFrom({
      diff: prepared.value.diff,
      worktreePath: prepared.value.worktreePath,
      question: '',
      history: [],
      focus: undefined,
      impactFindings: undefined,
      worktreePaths: prepared.value.worktreePaths,
    });
    const summary = summaryTextOf(stored.value);
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
        model: prepared.value.bind(model.value.model),
        signal: job.controller.signal,
        ...(claude.timeout !== undefined && { timeout: claude.timeout }),
      },
    );
    if (!compacted.ok) {
      if (compacted.error.kind === 'nothing-to-compact') {
        return failed({ status: 'failed', code: 'internal' });
      }
      return failed(outcomeFrom(compacted.error.error));
    }
    if (job.controller.signal.aborted) {
      return ok({ outcome: 'cancelled' });
    }
    const message: ChatMessage = {
      id: job.messageId as ChatMessageId,
      sessionId: job.sessionId as SessionId,
      headSha: job.headSha as CommitSha,
      role: 'summary',
      parts: chatPartsFrom(compacted.value.content),
      citations: compacted.value.citations,
      createdAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
    };
    const appended = appendChatMessage(db, message);
    if (appended.ok) {
      return ok({ outcome: 'compacted', summary: chatMessageViewFrom(message) });
    }
    return err({ code: 'not-found', message: 'no such session' });
  };

  /**
   * Settings' Test: "ok" through the entry's adapter, in a scratch directory, timed. The directory
   * is gone by the time the Test answers.
   */
  const runProbe = async (job: ProbeJob): Promise<void> => {
    const stopwatch = new Stopwatch();
    const failed = (error: ModelError): ModelTestView => {
      return {
        outcome: 'failed',
        elapsedMs: elapsedMilliseconds(stopwatch),
        errorKind: error.kind,
        message: describeModelError(error),
      };
    };
    const probe = async (): Promise<ModelTestView> => {
      const resolved = await resolveLanguageModel({ entryId: job.entryId }, options.models);
      if (!resolved.ok) {
        return failed(resolved.error);
      }
      await using directory = await mkdtempDisposable(path.join(os.tmpdir(), 'beuve-model-test-'));
      const answered = await resolved.value.model.runText({
        system: 'This is a connection test. Reply with the single word: ok',
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        cwd: directory.path,
        timeout: Temporal.Duration.from({ minutes: 2 }),
        signal: job.controller.signal,
      });
      if (answered.ok) {
        return {
          outcome: 'ok',
          elapsedMs: elapsedMilliseconds(stopwatch),
          model: answered.value.model,
        };
      }
      return failed(answered.error);
    };
    try {
      job.settle(await probe());
    } catch (error: unknown) {
      logger.error('model test failed unexpectedly', { error });
      job.settle(failed({ kind: 'invalid-output', reason: 'internal error' }));
    }
  };

  const queue = new KeyedQueue<string, Job>(async (job) => {
    if (job.kind === 'answer') {
      return runAnswer(job);
    }
    if (job.kind === 'compact') {
      return runCompaction(job);
    }
    return runProbe(job);
  }, options.maxQueued ?? 10);

  const jobToCancel = (request: ChatCancelRequest): Job | undefined => {
    if ('messageId' in request) {
      return jobOfMessage(request.messageId);
    }
    return queue.all().find((candidate) => {
      return candidate.kind === 'compact' && candidate.sessionId === request.sessionId;
    });
  };

  const jobOfMessage = (messageId: string): AnswerJob | undefined => {
    return queue
      .all()
      .find((job): job is AnswerJob => job.kind === 'answer' && job.assistant.id === messageId);
  };

  /** An unfinished answer no job is writing (the app died) is shown, and stored, as cancelled. */
  const settleOrphan = (message: ChatMessage): ChatMessage => {
    if (
      message.role !== 'assistant' ||
      !unfinished.has(message.status) ||
      jobOfMessage(message.id) !== undefined
    ) {
      return message;
    }
    const update: ChatAnswerUpdate = {
      status: 'cancelled',
      parts: answerPartsFrom(streamedPartsFrom(message.parts), { kind: 'cancelled' }),
      citations: message.citations,
    };
    updateChatAnswer(db, message.id, update);
    return { ...message, ...update };
  };

  const observeHead = (sessionId: string, headSha: CommitSha): void => {
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

  const queueFull = (): Result<never, QueueFull> => {
    return err({
      code: 'refused',
      message: `${String(options.maxQueued ?? 10)} requests are already waiting. Wait, cancel one or clear the queue.`,
    });
  };

  return {
    ask: async (request): Promise<IpcResult<ChatAskedView>> => {
      return inOrder(async (): Promise<IpcResult<ChatAskedView>> => {
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
        const createdAt = Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
        const common = { sessionId: sessionId as SessionId, headSha: headSha as CommitSha };
        const isQueued = queue.isBusy(sessionId);
        const question: ChatMessage = {
          ...common,
          id: context.deps.newId() as ChatMessageId,
          role: 'user',
          parts: chatPartsFrom(request.question.trim(), mentions),
          citations: [],
          createdAt,
        };
        const assistant: ChatMessage = {
          ...common,
          id: context.deps.newId() as ChatMessageId,
          role: 'assistant',
          kind: answerKindOf(request.command),
          status: initialStatus(isQueued),
          parts: [],
          citations: [],
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
          streamed: { parts: [], nextId: 1, tools: {} },
          status: 'submitted',
        });
        return ok({
          question: chatMessageViewFrom(question),
          answer: chatMessageViewFrom(assistant),
        });
      });
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
        messages: messages.map((message) => chatMessageViewFrom(message)),
      });
    },

    cancel: (request): IpcResult<ChatCancelledView> => {
      const job = jobToCancel(request);
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
      const queued = await inOrder(async (): Promise<IpcResult<QueuedCompaction>> => {
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
      });
      if (queued.ok) {
        return queued.value.done;
      }
      return queued;
    },

    clear: ({ sessionId, queuedOnly }): IpcResult<ChatClearedView> => {
      const session = loadSession(context, sessionId);
      if (!session.ok) {
        return session;
      }
      const id = session.value.id;
      const waiting = queue.remove(id, () => true);
      if (queuedOnly === true) {
        const messages = waiting.flatMap((job) => {
          if (job.kind === 'answer') {
            return [job.question.id, job.assistant.id];
          }
          return [];
        });
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

    testModel: async (entryId): Promise<ModelTestView> => {
      if (isDisposed || queue.isFull(probeQueue)) {
        return {
          outcome: 'failed',
          elapsedMs: 0,
          errorKind: 'refused',
          message: refusedTestMessage(isDisposed),
        };
      }
      const settled = Promise.withResolvers<ModelTestView>();
      queue.enqueue(probeQueue, {
        kind: 'probe',
        sessionId: probeQueue,
        headSha: '',
        entryId,
        controller: new AbortController(),
        settle: settled.resolve,
      });
      return settled.promise;
    },

    onStream: (listener): (() => void) => {
      streamListeners.add(listener);
      return (): void => {
        streamListeners.delete(listener);
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

/** Statuses of an answer whose request has not ended. */
const unfinished: ReadonlySet<string> = new Set(['queued', 'submitted', 'streaming']);

/** A part event of `job`'s answer, as `chat:stream` carries it. */
function streamEventFrom(job: AnswerJob, event: ChatPartEvent): ChatStreamEvent {
  const keys = { sessionId: job.sessionId, messageId: job.assistant.id };
  switch (event.type) {
    case 'part-start':
    case 'part-end': {
      return { ...keys, type: event.type, part: chatPartViewFrom(event.part) };
    }
    case 'text-delta': {
      return { ...keys, type: 'text-delta', partId: event.partId, text: event.text };
    }
    case 'part-discard': {
      return { ...keys, type: 'part-discard', partId: event.partId };
    }
  }
}

/** The latest `/compact` summary's text, if the transcript has one (ADR 0047). */
function summaryTextOf(messages: readonly ChatMessage[]): string | undefined {
  const { summary } = splitAtCompaction(messages);
  if (summary === undefined) {
    return undefined;
  }
  return chatTextFrom(summary.parts);
}

/** The queue key of Settings' model tests, which no session id can equal (ADR 0070). */
const probeQueue = '\0settings:model-test';

/** A model failure as an answer's outcome; a cancellation keeps what streamed (ADR 0031). */
function outcomeFrom(error: ModelError): Outcome {
  const failed = chatFailureFromModelError(error);
  if (failed.kind === 'cancelled') {
    return { status: 'cancelled' };
  }
  return { status: 'failed', code: failed.code };
}

/** Whole milliseconds since `stopwatch` started, for a view. */
function elapsedMilliseconds(stopwatch: Stopwatch): number {
  return stopwatch
    .elapsed()
    .round({ smallestUnit: 'millisecond', roundingMode: 'halfExpand' })
    .total('milliseconds');
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
  const earlier = messages.findLast((message) => {
    return (
      message.role === 'assistant' &&
      message.kind === 'review' &&
      message.status === 'done' &&
      message.headSha === job.headSha &&
      message.review !== undefined &&
      hasSameScope(message.review.pathScope, pathScope)
    );
  });
  if (earlier?.role !== 'assistant' || earlier.review === undefined) {
    return undefined;
  }
  return {
    status: 'done',
    ending: { kind: 'findings', count: earlier.review.findings.length },
    citations: earlier.citations,
    review: { ...earlier.review, reusedFrom: earlier.review.reusedFrom ?? earlier.id },
    droppedTurns: 0,
  };
}

function hasSameScope(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((prefix, index) => prefix === right[index]);
}

function plural(count: number, noun: string): string {
  if (count === 1) {
    return `${String(count)} ${noun}`;
  }
  return `${String(count)} ${noun}s`;
}

function askingStatus(role: ModelRole, name: string): string {
  if (role === 'summarize') {
    return `${name} is summarizing the change`;
  }
  return `Asking ${name}`;
}

/** What `outcome` stores in the answer, after the parts that streamed. */
function answerUpdateFrom(streamed: StreamedParts, outcome: Outcome): ChatAnswerUpdate {
  switch (outcome.status) {
    case 'done': {
      return {
        status: 'done',
        parts: answerPartsFrom(streamed, outcome.ending),
        citations: outcome.citations,
        ...(outcome.review !== undefined && { review: outcome.review }),
      };
    }
    case 'cancelled': {
      return { status: 'cancelled', parts: answerPartsFrom(streamed, { kind: 'cancelled' }) };
    }
    case 'failed': {
      return {
        status: 'error',
        parts: answerPartsFrom(streamed, { kind: 'error', code: outcome.code }),
      };
    }
  }
}

function droppedTurnsOf(outcome: Outcome): number {
  if (outcome.status === 'done') {
    return outcome.droppedTurns;
  }
  return 0;
}

/** A `/compact` that ended without a summary: failed with `outcome`'s code, else cancelled. */
function compactionFailureFrom(outcome: Outcome): ChatCompactedView {
  if (outcome.status === 'failed') {
    return {
      outcome: 'failed',
      errorCode: outcome.code,
      errorMessage: describeChatError(outcome.code),
    };
  }
  return { outcome: 'cancelled' };
}

function initialStatus(isQueued: boolean): 'queued' | 'submitted' {
  if (isQueued) {
    return 'queued';
  }
  return 'submitted';
}

function refusedTestMessage(isDisposed: boolean): string {
  if (isDisposed) {
    return 'beuve is quitting.';
  }
  return 'Too many tests are waiting.';
}
