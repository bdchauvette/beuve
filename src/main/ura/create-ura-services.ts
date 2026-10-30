import type {
  CreateUraItemRequest,
  ExportUraRequest,
  IpcResult,
  ListUraItemsRequest,
  ReorderUraItemsRequest,
  SetUraVerdictRequest,
  StageImpactFindingRequest,
  StageReviewFindingRequest,
  TransitionUraItemRequest,
  UpdateUraItemRequest,
  UraExportView,
  UraItemView,
  UraListView,
  UraOrderView,
  UraPlacementView,
  UraStagedView,
  UraVerdictStateView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import type { ChatMessageId } from '#internal/chat/chat-message.ts';
import { findChatMessage } from '#internal/chat/find-chat-message.ts';
import { buildAgentReview } from '#internal/ura/build-agent-review.ts';
import type { AgentReview } from '#internal/ura/build-agent-review.ts';
import { compileUraArtifact } from '#internal/ura/compile-ura-artifact.ts';
import { createUraItem } from '#internal/ura/create-ura-item.ts';
import { deriveUraVerdict } from '#internal/ura/derive-ura-verdict.ts';
import { editUraItem } from '#internal/ura/edit-ura-item.ts';
import { findUraItem } from '#internal/ura/find-ura-item.ts';
import { findUraItemByOrigin } from '#internal/ura/find-ura-item-by-origin.ts';
import { insertUraItem } from '#internal/ura/insert-ura-item.ts';
import type { LineMapping } from '#internal/ura/line-mapping.ts';
import { listUraItems } from '#internal/ura/list-ura-items.ts';
import { listUraPostings } from '#internal/ura/list-ura-postings.ts';
import { reanchorUraAnchor } from '#internal/ura/reanchor-ura-anchor.ts';
import { recordUraPostings } from '#internal/ura/record-ura-postings.ts';
import { renderAgentReviewXml } from '#internal/ura/render-agent-review-xml.ts';
import { readVerdictChoice } from '#internal/ura/read-verdict-choice.ts';
import { reorderUraItems } from '#internal/ura/reorder-ura-items.ts';
import { settleVerdictChoice } from '#internal/ura/settle-verdict-choice.ts';
import { stageImpactFinding } from '#internal/ura/stage-impact-finding.ts';
import { stageReviewFinding } from '#internal/ura/stage-review-finding.ts';
import { transitionUraItem } from '#internal/ura/transition-ura-item.ts';
import { updateUraItem } from '#internal/ura/update-ura-item.ts';
import { writeVerdictChoice } from '#internal/ura/write-verdict-choice.ts';
import type { UraArtifact } from '#internal/ura/ura-artifact.ts';
import type {
  CommitSha,
  SessionId,
  UraDeps,
  UraItem,
  UraItemError,
  UraItemId,
  UraStatus,
  UraStoreError,
} from '#internal/ura/ura-item.ts';
import type { UraPosting } from '#internal/ura/ura-posting.ts';
import type { UraVerdictChoice } from '#internal/ura/ura-verdict-choice.ts';
import { LruCache } from '#x/collections/lru-cache.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { buildLineMapping } from './build-line-mapping.ts';
import { renderUraExport } from './render-ura-export.ts';
import { uraItemViewFrom } from './ura-item-view-from.ts';
import { uraSummaryFrom } from './ura-summary-from.ts';
import { verdictNoticeFrom } from './verdict-notice-from.ts';
import { uraFailure } from './ura-failure.ts';

/** The URA staging dock (Zone 3) as the renderer and the MCP server reach it (ADR 0023, 0027). */
export interface UraServices {
  readonly list: (request: ListUraItemsRequest) => Promise<IpcResult<UraListView>>;
  readonly create: (request: CreateUraItemRequest) => Promise<IpcResult<UraItemView>>;
  readonly update: (request: UpdateUraItemRequest) => Promise<IpcResult<UraItemView>>;
  readonly transition: (request: TransitionUraItemRequest) => Promise<IpcResult<UraItemView>>;
  readonly reorder: (request: ReorderUraItemsRequest) => IpcResult<UraOrderView>;
  /** Stages a `/review` finding from its stored answer (ADR 0055); again returns its item. */
  readonly stageReviewFinding: (
    request: StageReviewFindingRequest,
  ) => Promise<IpcResult<UraStagedView>>;
  readonly stageImpactFinding: (
    request: StageImpactFindingRequest,
  ) => Promise<IpcResult<UraStagedView>>;
  readonly setVerdict: (request: SetUraVerdictRequest) => IpcResult<UraVerdictStateView>;
  readonly export: (request: ExportUraRequest) => Promise<IpcResult<UraExportView>>;
  /**
   * The artifact with the chosen verdict (or `verdict`), for exporters main runs itself, such as
   * posting to GitHub (ADR 0039). `headSha` is the head the caller checked (ADR 0078): the
   * artifact is compiled at it, without reading the session's head again.
   */
  readonly compileArtifact: (
    sessionId: string,
    options: CompileArtifactOptions,
  ) => Promise<IpcResult<UraArtifact>>;
  /** The session's postings, so a review isn't posted twice. */
  readonly listPostings: (sessionId: string) => readonly UraPosting[];
  /** Records that a posted review carried these items, and announces the change. */
  readonly recordPostings: (sessionId: string, postings: readonly UraPosting[]) => void;
  /** The `beuve.ura/1` payload and its XML form, with the derived verdict, for MCP. */
  readonly readAgentReview: (
    sessionId: string,
  ) => Promise<IpcResult<{ readonly review: AgentReview; readonly xml: string }>>;
  /** Tells listeners a session's items moved, because its head did. */
  readonly observeHead: (sessionId: string) => void;
  /** Subscribes to `ura:changed`; returns the unsubscribe function. */
  readonly onChanged: (listener: (sessionId: string) => void) => () => void;
}

/** What {@link UraServices.compileArtifact} compiles at and with. */
export interface CompileArtifactOptions {
  readonly headSha: CommitSha;
  readonly verdict?: UraVerdictView;
}

export interface UraServicesOptions {
  readonly context: SessionContext;
  readonly impact: ImpactServices;
  /** Line mappings kept, one per (repository, older head, current head). Defaults to 64. */
  readonly cacheSize?: number;
}

interface Head {
  readonly sessionId: string;
  readonly headSha: string;
  readonly repository: GitRepository;
}

/**
 * Composes the URA domain with sessions, git, the chat's `/review` answers and ImpactGate. Items
 * written against an older head are re-anchored on every read from the git diff between the two
 * heads (cached, since commits never change); nothing about placement is stored. Every change is
 * announced through `onChanged`, whoever made it.
 */
export function createUraServices(options: UraServicesOptions): UraServices {
  type StoreResult<T> = Result<T, UraItemError | UraStoreError>;
  const { context, impact } = options;
  const { db, logger } = context;
  const deps: UraDeps = context.deps;
  const listeners = new Set<(sessionId: string) => void>();
  const mappings = new LruCache<string, Promise<LineMapping | undefined>>(options.cacheSize ?? 64);

  /**
   * The session's verdict choice, dropped first if the head moved since it was made or staged
   * blockers have made it impossible.
   */
  const settledChoice = (
    sessionId: string,
    headSha: string,
    items: readonly UraItem[],
  ): UraVerdictChoice =>
    settleVerdictChoice(
      db,
      sessionId as SessionId,
      headSha,
      items.filter((item) => item.status.kind === 'staged').map((item) => item.severity),
      Temporal.Now.instant(),
    );

  const changed = (sessionId: string): void => {
    const items = listUraItems(db, sessionId as SessionId);
    const session = loadSession(context, sessionId);
    if (items.ok && session.ok) {
      settledChoice(sessionId, session.value.headSha, items.value);
    }
    for (const listener of listeners) {
      try {
        listener(sessionId);
      } catch (error: unknown) {
        logger.warn('ura change listener failed', { error });
      }
    }
  };

  const mappingFor = async (head: Head, fromHeadSha: string): Promise<LineMapping | undefined> => {
    const key = [head.repository.root, fromHeadSha, head.headSha].join('\0');
    const cached = mappings.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const building = buildLineMapping(head.repository, fromHeadSha, head.headSha);
    mappings.set(key, building);
    const mapping = await building;
    if (mapping === undefined) {
      mappings.delete(key);
    }
    return mapping;
  };

  const mappingsFor = async (head: Head, items: readonly UraItem[]): Promise<LineMapping[]> => {
    const older = [...new Set(items.map((item) => item.headSha as string))].filter(
      (sha) => sha !== head.headSha,
    );
    const built = await Promise.all(older.map(async (sha) => mappingFor(head, sha)));
    return built.filter((mapping) => mapping !== undefined);
  };

  const placer = async (
    head: Head,
    items: readonly UraItem[],
  ): Promise<(item: UraItem) => UraPlacementView> => {
    const built = await mappingsFor(head, items);
    const byHead = new Map(built.map((mapping) => [mapping.fromHeadSha, mapping] as const));
    return (item: UraItem): UraPlacementView => {
      if (item.headSha === head.headSha) {
        return { kind: 'current', anchor: item.anchor };
      }
      const mapping = byHead.get(item.headSha);
      return mapping === undefined
        ? { kind: 'outdated', reason: 'no-line-mapping' }
        : reanchorUraAnchor(item.anchor, mapping.files);
    };
  };

  const postingsFor = (sessionId: string): ReadonlyMap<string, UraPosting> =>
    new Map(
      listUraPostings(db, sessionId as SessionId).map((posting) => [posting.itemId, posting]),
    );

  const headOf = async (sessionId: string): Promise<IpcResult<Head>> => {
    const loaded = loadSession(context, sessionId);
    if (!loaded.ok) {
      return loaded;
    }
    const refreshed = await refreshSession(context, loaded.value);
    return refreshed.ok
      ? ok({
          sessionId: refreshed.value.session.id,
          headSha: refreshed.value.session.headSha,
          repository: refreshed.value.repository,
        })
      : refreshed;
  };

  const viewOne = async (item: UraItem): Promise<IpcResult<UraItemView>> => {
    const head = await headOf(item.sessionId);
    if (!head.ok) {
      return head;
    }
    const place = await placer(head.value, [item]);
    return ok(uraItemViewFrom(item, place(item), postingsFor(item.sessionId).get(item.id)));
  };

  const stored = <T>(result: StoreResult<T>): IpcResult<T> =>
    result.ok ? result : uraFailure(logger, result.error);

  /** Inserts a promoted or staged item; a repeat returns the existing one, restaged if withdrawn. */
  const stageOnce = (item: UraItem): StoreResult<{ item: UraItem; created: boolean }> => {
    const inserted = insertUraItem(db, item);
    if (inserted.ok) {
      return ok({ item, created: true });
    }
    if (inserted.error.kind !== 'duplicate-item' || inserted.error.reason === 'id-taken') {
      return inserted;
    }
    const existing = findUraItemByOrigin(db, item);
    if (!existing.ok) {
      return existing;
    }
    if (existing.value === undefined) {
      return inserted;
    }
    if (existing.value.status.kind !== 'withdrawn') {
      return ok({ item: existing.value, created: false });
    }
    const restaged = transitionUraItem(existing.value, { kind: 'staged' }, Temporal.Now.instant());
    if (!restaged.ok) {
      return restaged;
    }
    const saved = updateUraItem(db, restaged.value);
    return saved.ok ? ok({ item: restaged.value, created: false }) : saved;
  };

  const staged = async (
    result: IpcResult<{ item: UraItem; created: boolean }>,
  ): Promise<IpcResult<UraStagedView>> => {
    if (!result.ok) {
      return result;
    }
    changed(result.value.item.sessionId);
    const view = await viewOne(result.value.item);
    return view.ok ? ok({ item: view.value, created: result.value.created }) : view;
  };

  /**
   * A choice made at `headSha`, read without settling it: a head pinned by the caller may already
   * be an older one, and settling against it would drop a choice made at the newer head.
   */
  const choiceAt = (
    sessionId: string,
    headSha: string,
    items: readonly UraItem[],
  ): UraVerdictView | undefined => {
    const { chosen, headSha: chosenAt } = readVerdictChoice(db, sessionId);
    const isBlocked =
      chosen === 'approve' &&
      items.some((item) => item.status.kind === 'staged' && item.severity === 'blocker');
    return chosenAt === headSha && !isBlocked ? chosen : undefined;
  };

  const compile = async (
    sessionId: string,
    verdict: ExportUraRequest['verdict'],
    pinnedHeadSha?: CommitSha,
  ): Promise<IpcResult<UraArtifact>> => {
    const diff = await loadReviewDiff(
      context,
      sessionId,
      pinnedHeadSha === undefined ? {} : { headSha: pinnedHeadSha },
    );
    if (!diff.ok) {
      return diff;
    }
    const { refreshed } = diff.value;
    const summary = uraSummaryFrom(diff.value);
    const items = listUraItems(db, summary.sessionId);
    if (!items.ok) {
      return uraFailure(logger, items.error);
    }
    const head: Head = {
      sessionId: summary.sessionId,
      headSha: summary.headSha,
      repository: refreshed.repository,
    };
    const live = items.value.filter((item) => item.status.kind === 'staged');
    const chosen =
      verdict ??
      (pinnedHeadSha === undefined
        ? settledChoice(summary.sessionId, summary.headSha, items.value).chosen
        : choiceAt(summary.sessionId, pinnedHeadSha, items.value));
    const artifact = compileUraArtifact({
      summary,
      items: items.value,
      lineMappings: await mappingsFor(head, live),
      ...(chosen !== undefined && { verdict: chosen }),
    });
    return artifact.ok ? artifact : uraFailure(logger, artifact.error);
  };

  const verdictState = (
    sessionId: string,
    headSha: string,
    items: readonly UraItem[],
  ): Omit<UraVerdictStateView, 'sessionId'> => {
    const choice = settledChoice(sessionId, headSha, items);
    return {
      derivedVerdict: deriveStagedVerdict(items),
      ...(choice.chosen !== undefined && { chosenVerdict: choice.chosen }),
      ...(choice.cleared !== undefined && { verdictNotice: verdictNoticeFrom(choice.cleared) }),
    };
  };

  return {
    list: async ({ sessionId }): Promise<IpcResult<UraListView>> => {
      const head = await headOf(sessionId);
      if (!head.ok) {
        return head;
      }
      const items = listUraItems(db, head.value.sessionId as SessionId);
      if (!items.ok) {
        return uraFailure(logger, items.error);
      }
      const place = await placer(head.value, items.value);
      const postings = postingsFor(head.value.sessionId);
      const views = items.value.map((item) =>
        uraItemViewFrom(item, place(item), postings.get(item.id)),
      );
      return ok({
        sessionId: head.value.sessionId,
        headSha: head.value.headSha,
        items: views,
        ...verdictState(head.value.sessionId, head.value.headSha, items.value),
      });
    },

    create: async (request): Promise<IpcResult<UraItemView>> => {
      const head = await headOf(request.sessionId);
      if (!head.ok) {
        return head;
      }
      let headSha = head.value.headSha;
      if (request.headSha !== undefined && request.headSha !== headSha) {
        const written = await resolveRevision(head.value.repository, request.headSha);
        if (!written.ok || written.value !== request.headSha) {
          return err({ code: 'not-found', message: `no such commit: ${request.headSha}` });
        }
        headSha = written.value;
      }
      const patch = request.suggestedPatch ?? '';
      const item = createUraItem(
        {
          sessionId: head.value.sessionId as SessionId,
          headSha: headSha as CommitSha,
          anchor: request.anchor,
          severity: request.severity,
          origin: request.origin ?? { kind: 'human' },
          title: request.title,
          body: request.body,
          ...(patch.trim() !== '' && { suggestion: patch }),
        },
        deps,
      );
      if (!item.ok) {
        return uraFailure(logger, item.error);
      }
      const inserted = insertUraItem(db, item.value);
      if (!inserted.ok) {
        return uraFailure(logger, inserted.error);
      }
      changed(item.value.sessionId);
      const place = await placer(head.value, [item.value]);
      return ok(uraItemViewFrom(item.value, place(item.value)));
    },

    update: async ({ itemId, suggestedPatch, ...text }): Promise<IpcResult<UraItemView>> => {
      const found = findUraItem(db, itemId as UraItemId);
      if (!found.ok) {
        return uraFailure(logger, found.error);
      }
      const edit = {
        ...text,
        ...(suggestedPatch !== undefined && {
          suggestion: suggestedPatch.trim() === '' ? '' : suggestedPatch,
        }),
      };
      const edited = editUraItem(found.value, edit, Temporal.Now.instant());
      if (!edited.ok) {
        return uraFailure(logger, edited.error);
      }
      const saved = updateUraItem(db, edited.value);
      if (!saved.ok) {
        return uraFailure(logger, saved.error);
      }
      changed(edited.value.sessionId);
      return viewOne(edited.value);
    },

    transition: async ({ itemId, to }): Promise<IpcResult<UraItemView>> => {
      const found = findUraItem(db, itemId as UraItemId);
      if (!found.ok) {
        return uraFailure(logger, found.error);
      }
      let status: UraStatus = { kind: to === 'staged' ? 'staged' : 'withdrawn' };
      if (to === 'addressed') {
        const head = await headOf(found.value.sessionId);
        if (!head.ok) {
          return head;
        }
        status = { kind: 'addressed', atSha: head.value.headSha as CommitSha, by: 'reviewer' };
      }
      const moved = transitionUraItem(found.value, status, Temporal.Now.instant());
      if (!moved.ok) {
        return uraFailure(logger, moved.error);
      }
      const saved = updateUraItem(db, moved.value);
      if (!saved.ok) {
        return uraFailure(logger, saved.error);
      }
      changed(moved.value.sessionId);
      return viewOne(moved.value);
    },

    reorder: ({ sessionId, itemIds }): IpcResult<UraOrderView> => {
      const reordered = reorderUraItems(db, sessionId as SessionId, itemIds as UraItemId[]);
      if (!reordered.ok) {
        return uraFailure(logger, reordered.error);
      }
      changed(sessionId);
      return ok({ sessionId, itemIds });
    },

    stageReviewFinding: async ({
      messageId,
      finding,
      severity,
    }): Promise<IpcResult<UraStagedView>> => {
      const message = findChatMessage(db, messageId as ChatMessageId);
      if (!message.ok) {
        return message.error.kind === 'message-not-found'
          ? err({ code: 'not-found', message: 'no such answer' })
          : err({ code: 'internal', message: 'stored chat data is corrupt' });
      }
      const answer = message.value;
      const found = answer.role === 'assistant' ? answer.review?.findings[finding] : undefined;
      if (found === undefined) {
        return err({ code: 'not-found', message: 'that answer has no such review finding' });
      }
      const item = stageReviewFinding(
        found,
        { sessionId: answer.sessionId, headSha: answer.headSha, messageId, finding },
        deps,
        severity,
      );
      return staged(item.ok ? stored(stageOnce(item.value)) : uraFailure(logger, item.error));
    },

    stageImpactFinding: async ({
      sessionId,
      path,
      functionName,
    }): Promise<IpcResult<UraStagedView>> => {
      const report = await impact.getImpact({ sessionId });
      if (!report.ok) {
        return report;
      }
      const finding = report.value.findings.find(
        (candidate) => candidate.path === path && candidate.functionName === functionName,
      );
      if (finding === undefined) {
        return err({
          code: 'not-found',
          message: `ImpactGate has no finding for ${functionName} in ${path} at the current head`,
        });
      }
      const item = stageImpactFinding(
        { ...finding, baseValue: finding.baseValue },
        {
          sessionId: report.value.sessionId as SessionId,
          headSha: report.value.headSha as CommitSha,
        },
        deps,
      );
      return staged(item.ok ? stored(stageOnce(item.value)) : uraFailure(logger, item.error));
    },

    setVerdict: ({ sessionId, verdict, expectedHeadSha }): IpcResult<UraVerdictStateView> => {
      const loaded = loadSession(context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      if (loaded.value.headSha !== expectedHeadSha) {
        return err({
          code: 'stale-review',
          message: 'new commits arrived since this review was loaded; review them first',
        });
      }
      const items = listUraItems(db, loaded.value.id);
      if (!items.ok) {
        return uraFailure(logger, items.error);
      }
      const blockers = items.value
        .filter((item) => item.status.kind === 'staged' && item.severity === 'blocker')
        .map((item) => item.id);
      if (verdict === 'approve' && blockers.length > 0) {
        return uraFailure(logger, { kind: 'approve-with-blockers', itemIds: blockers });
      }
      const derived = deriveStagedVerdict(items.value);
      const written = writeVerdictChoice(
        db,
        loaded.value.id,
        verdict === undefined || verdict === derived
          ? {}
          : { chosen: verdict, headSha: expectedHeadSha },
        Temporal.Now.instant(),
      );
      if (!written.ok) {
        return uraFailure(logger, written.error);
      }
      changed(sessionId);
      return ok({ sessionId, ...verdictState(sessionId, expectedHeadSha, items.value) });
    },

    export: async ({ sessionId, target, verdict }): Promise<IpcResult<UraExportView>> => {
      const artifact = await compile(sessionId, verdict);
      return artifact.ok ? ok(renderUraExport(artifact.value, target)) : artifact;
    },

    compileArtifact: async (sessionId, { headSha, verdict }): Promise<IpcResult<UraArtifact>> =>
      compile(sessionId, verdict, headSha),

    listPostings: (sessionId): readonly UraPosting[] => listUraPostings(db, sessionId as SessionId),

    recordPostings: (sessionId, postings): void => {
      recordUraPostings(db, postings);
      changed(sessionId);
    },

    readAgentReview: async (
      sessionId,
    ): Promise<IpcResult<{ review: AgentReview; xml: string }>> => {
      const artifact = await compile(sessionId, undefined);
      return artifact.ok
        ? ok({
            review: buildAgentReview(artifact.value),
            xml: renderAgentReviewXml(artifact.value),
          })
        : artifact;
    },

    observeHead: changed,

    onChanged: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

function deriveStagedVerdict(items: readonly UraItem[]): UraVerdictView {
  return deriveUraVerdict(
    items.filter((item) => item.status.kind === 'staged').map((item) => item.severity),
  );
}
