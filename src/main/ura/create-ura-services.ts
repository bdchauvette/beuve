import type {
  CreateUraItemRequest,
  ExportUraRequest,
  IpcResult,
  ListUraItemsRequest,
  ReorderUraItemsRequest,
  SetUraVerdictRequest,
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
import type { ChatFinding } from '#internal/chat/chat-review.ts';
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
import { stageReviewFinding } from '#internal/ura/stage-review-finding.ts';
import { transitionUraItem } from '#internal/ura/transition-ura-item.ts';
import { updateUraItem } from '#internal/ura/update-ura-item.ts';
import { writeVerdictChoice } from '#internal/ura/write-verdict-choice.ts';
import type { UraArtifact, UraSummary } from '#internal/ura/ura-artifact.ts';
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
  readonly readAgentReview: (sessionId: string) => Promise<IpcResult<AgentReviewDocument>>;
  /** Tells listeners a session's items moved, because its head did. */
  readonly observeHead: (sessionId: string) => void;
  /** Subscribes to `ura:changed`; returns the unsubscribe function. */
  readonly onChanged: (listener: (sessionId: string) => void) => () => void;
}

/** What {@link UraServices.compileArtifact} compiles at and with. */
export interface CompileArtifactOptions {
  readonly headSha: CommitSha;
  /** The base tip the caller resolved for this operation, so the fork point can't move (ADR 0079). */
  readonly baseTip?: CommitSha;
  readonly verdict?: UraVerdictView;
}

/** The `beuve.ura/1` payload and its XML form. */
export interface AgentReviewDocument {
  readonly review: AgentReview;
  readonly xml: string;
}

/** A staged item, and whether staging created it or found it already there. */
interface StagedItem {
  readonly item: UraItem;
  readonly created: boolean;
}

/** The head and base tip an export was compiled for, pinned by the caller. */
interface PinnedHead {
  readonly headSha: CommitSha;
  readonly baseTip: CommitSha | undefined;
}

export interface UraServicesOptions {
  readonly context: SessionContext;
  /** Line mappings kept, one per (repository, older head, current head). Defaults to 64. */
  readonly cacheSize?: number;
}

interface Head {
  readonly sessionId: string;
  readonly headSha: CommitSha;
  readonly repository: GitRepository;
}

/**
 * Composes the URA domain with sessions, git and the chat's `/review` answers. Items
 * written against an older head are re-anchored on every read from the git diff between the two
 * heads (cached, since commits never change); nothing about placement is stored. Every change is
 * announced through `onChanged`, whoever made it.
 */
export function createUraServices(options: UraServicesOptions): UraServices {
  type StoreResult<T> = Result<T, UraItemError | UraStoreError>;
  const { context } = options;
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
    headSha: CommitSha,
    items: readonly UraItem[],
  ): UraVerdictChoice => {
    return settleVerdictChoice(db, sessionId as SessionId, {
      headSha,
      stagedSeverities: items
        .filter((item) => item.status.kind === 'staged')
        .map((item) => item.severity),
    });
  };

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
    const building = buildLineMapping(head.repository, { fromHeadSha, toHeadSha: head.headSha });
    mappings.set(key, building);
    const mapping = await building;
    if (mapping === undefined) {
      mappings.delete(key);
    }
    return mapping;
  };

  const mappingsFor = async (head: Head, items: readonly UraItem[]): Promise<LineMapping[]> => {
    const older = [...new Set(items.map((item) => item.headSha as string))].filter((sha) => {
      return sha !== head.headSha;
    });
    const built = await Promise.all(older.map(async (sha) => mappingFor(head, sha)));
    return built.filter((mapping) => mapping !== undefined);
  };

  const placer = async (
    head: Head,
    items: readonly UraItem[],
  ): Promise<(item: UraItem) => UraPlacementView> => {
    const built = await mappingsFor(head, items);
    const byHead = new Map(
      built.map((mapping) => {
        return [mapping.fromHeadSha, mapping] as const;
      }),
    );
    return (item: UraItem): UraPlacementView => {
      if (item.headSha === head.headSha) {
        return { kind: 'current', anchor: item.anchor };
      }
      const mapping = byHead.get(item.headSha);
      if (mapping === undefined) {
        return { kind: 'outdated', reason: 'no-line-mapping' };
      }
      return reanchorUraAnchor(item.anchor, mapping.files);
    };
  };

  const postingsFor = (sessionId: string): ReadonlyMap<string, UraPosting> => {
    return new Map(
      listUraPostings(db, sessionId as SessionId).map((posting) => {
        return [posting.itemId, posting];
      }),
    );
  };

  const headOf = async (sessionId: string): Promise<IpcResult<Head>> => {
    const loaded = loadSession(context, sessionId);
    if (!loaded.ok) {
      return loaded;
    }
    const refreshed = await refreshSession(context, loaded.value);
    if (refreshed.ok) {
      return ok({
        sessionId: refreshed.value.session.id,
        headSha: refreshed.value.session.headSha,
        repository: refreshed.value.repository,
      });
    }
    return refreshed;
  };

  const viewOne = async (item: UraItem): Promise<IpcResult<UraItemView>> => {
    const head = await headOf(item.sessionId);
    if (!head.ok) {
      return head;
    }
    const place = await placer(head.value, [item]);
    return ok(uraItemViewFrom(item, place(item), postingsFor(item.sessionId).get(item.id)));
  };

  const stored = <T>(result: StoreResult<T>): IpcResult<T> => {
    if (result.ok) {
      return result;
    }
    return uraFailure(logger, result.error);
  };

  /** Inserts a promoted or staged item; a repeat returns the existing one, restaged if withdrawn. */
  const stageOnce = (item: UraItem): StoreResult<StagedItem> => {
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
    if (saved.ok) {
      return ok({ item: restaged.value, created: false });
    }
    return saved;
  };

  const staged = async (result: IpcResult<StagedItem>): Promise<IpcResult<UraStagedView>> => {
    if (!result.ok) {
      return result;
    }
    changed(result.value.item.sessionId);
    const view = await viewOne(result.value.item);
    if (view.ok) {
      return ok({ item: view.value, created: result.value.created });
    }
    return view;
  };

  /**
   * A choice made at `headSha`, read without settling it: a head pinned by the caller may already
   * be an older one, and settling against it would drop a choice made at the newer head.
   */
  const choiceAt = (
    sessionId: string,
    headSha: CommitSha,
    items: readonly UraItem[],
  ): UraVerdictView | undefined => {
    const { chosen, headSha: chosenAt } = readVerdictChoice(db, sessionId);
    const isBlocked =
      chosen === 'approve' &&
      items.some((item) => item.status.kind === 'staged' && item.severity === 'blocker');
    if (chosenAt === headSha && !isBlocked) {
      return chosen;
    }
    return undefined;
  };

  const compile = async (
    sessionId: string,
    verdict: ExportUraRequest['verdict'],
    pinned?: PinnedHead,
  ): Promise<IpcResult<UraArtifact>> => {
    const pinnedHeadSha = pinned?.headSha;
    const diff = await loadReviewDiff(context, sessionId, {
      ...(pinnedHeadSha !== undefined && { headSha: pinnedHeadSha }),
      ...(pinned?.baseTip !== undefined && { baseTip: pinned.baseTip }),
    });
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
    const chosen = verdict ?? storedChoice(summary, pinnedHeadSha, items.value);
    const artifact = compileUraArtifact({
      summary,
      items: items.value,
      lineMappings: await mappingsFor(head, live),
      ...(chosen !== undefined && { verdict: chosen }),
    });
    if (artifact.ok) {
      return artifact;
    }
    return uraFailure(logger, artifact.error);
  };

  /** The reviewer's stored choice: settled at the live head, or as made at a pinned one. */
  const storedChoice = (
    summary: UraSummary,
    pinnedHeadSha: CommitSha | undefined,
    items: readonly UraItem[],
  ): UraVerdictView | undefined => {
    if (pinnedHeadSha === undefined) {
      return settledChoice(summary.sessionId, summary.headSha, items).chosen;
    }
    return choiceAt(summary.sessionId, pinnedHeadSha, items);
  };

  const stagedOrFailure = (item: Result<UraItem, UraItemError>): IpcResult<StagedItem> => {
    if (item.ok) {
      return stored(stageOnce(item.value));
    }
    return uraFailure(logger, item.error);
  };

  const verdictState = (
    sessionId: string,
    headSha: CommitSha,
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
      const views = items.value.map((item) => {
        return uraItemViewFrom(item, place(item), postings.get(item.id));
      });
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
          headSha: headSha,
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
        ...(suggestedPatch !== undefined && { suggestion: suggestionFrom(suggestedPatch) }),
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
      let status: UraStatus = { kind: 'withdrawn' };
      if (to === 'staged') {
        status = { kind: 'staged' };
      } else if (to === 'addressed') {
        const head = await headOf(found.value.sessionId);
        if (!head.ok) {
          return head;
        }
        status = { kind: 'addressed', atSha: head.value.headSha, by: 'reviewer' };
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
        if (message.error.kind === 'message-not-found') {
          return err({ code: 'not-found', message: 'no such answer' });
        }
        return err({ code: 'internal', message: 'stored chat data is corrupt' });
      }
      const answer = message.value;
      let found: ChatFinding | undefined;
      if (answer.role === 'assistant') {
        found = answer.review?.findings[finding];
      }
      if (found === undefined) {
        return err({ code: 'not-found', message: 'that answer has no such review finding' });
      }
      const item = stageReviewFinding(
        found,
        { sessionId: answer.sessionId, headSha: answer.headSha, messageId, finding },
        { deps, severity },
      );
      return staged(stagedOrFailure(item));
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
      let choice: UraVerdictChoice = {};
      if (verdict !== undefined && verdict !== derived) {
        choice = { chosen: verdict, headSha: expectedHeadSha };
      }
      const written = writeVerdictChoice(db, loaded.value.id, choice);
      if (!written.ok) {
        return uraFailure(logger, written.error);
      }
      changed(sessionId);
      return ok({ sessionId, ...verdictState(sessionId, loaded.value.headSha, items.value) });
    },

    export: async ({ sessionId, target, verdict }): Promise<IpcResult<UraExportView>> => {
      const artifact = await compile(sessionId, verdict);
      if (artifact.ok) {
        return ok(renderUraExport(artifact.value, target));
      }
      return artifact;
    },

    compileArtifact: async (
      sessionId,
      { headSha, baseTip, verdict },
    ): Promise<IpcResult<UraArtifact>> => {
      return compile(sessionId, verdict, { headSha, baseTip });
    },

    listPostings: (sessionId): readonly UraPosting[] => {
      return listUraPostings(db, sessionId as SessionId);
    },

    recordPostings: (sessionId, postings): void => {
      recordUraPostings(db, postings);
      changed(sessionId);
    },

    readAgentReview: async (sessionId): Promise<IpcResult<AgentReviewDocument>> => {
      const artifact = await compile(sessionId, undefined);
      if (artifact.ok) {
        return ok({
          review: buildAgentReview(artifact.value),
          xml: renderAgentReviewXml(artifact.value),
        });
      }
      return artifact;
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

/** An empty suggestion clears it; anything else is kept as typed. */
function suggestionFrom(patch: string): string {
  if (patch.trim() === '') {
    return '';
  }
  return patch;
}
