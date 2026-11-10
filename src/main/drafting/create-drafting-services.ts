import { mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ExpandedNoteView, ExpandNoteRequest, IpcResult } from '#contract/ipc-contract.ts';
import { buildNoteDraftPrompt } from '#internal/chat/build-note-draft-prompt.ts';
import type { NoteDraftRefusal } from '#internal/chat/build-note-draft-prompt.ts';
import { noteBodyFrom } from '#internal/chat/note-body-from.ts';
import type { ModelError } from '#internal/llm/language-model.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { describeModelError } from '../models/describe-model-error.ts';
import { resolveLanguageModel } from '../models/resolve-language-model.ts';
import type { ModelResolverDeps } from '../models/resolve-language-model.ts';
import type { RequestOptions } from '../request-options.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { loadNoteDiff } from './load-note-diff.ts';

/** A drafting request as the IPC handler passes it: the renderer's, less its `requestId`. */
export type NoteExpansionRequest = Omit<ExpandNoteRequest, 'requestId'>;

/** Note drafting (ADR 0125): one-off model requests outside the chat. */
export interface DraftingServices {
  /**
   * "Expand on this": one request on the `draft` role whose prompt is the draft and the hunks
   * near its anchor at its head, run in an empty scratch directory with no repository access.
   * Nothing is stored and the chat's queue is not involved. A cancelled request answers
   * `cancelled`; a model failure is an `expanded`-or-`failed` answer, never an error.
   */
  readonly expandNote: (
    request: NoteExpansionRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<ExpandedNoteView>>;
  /** Stops every request in flight and waits for them to end. */
  readonly dispose: () => Promise<void>;
}

export interface DraftingServicesOptions {
  readonly context: SessionContext;
  /** The registry the `draft` role resolves through (ADR 0070). */
  readonly models: ModelResolverDeps;
  /** Per request; defaults to two minutes. */
  readonly timeout?: Temporal.Duration;
}

const defaultTimeout = Temporal.Duration.from({ minutes: 2 });

/** Builds the drafting services; see {@link DraftingServices}. */
export function createDraftingServices(options: DraftingServicesOptions): DraftingServices {
  const { context } = options;
  const { logger } = context;
  const timeout = options.timeout ?? defaultTimeout;
  const running = new Set<Running>();
  let isDisposed = false;

  const expand = async (
    request: NoteExpansionRequest,
    signal: AbortSignal,
  ): Promise<IpcResult<ExpandedNoteView>> => {
    const files = await loadNoteDiff(context, {
      sessionId: request.sessionId,
      headSha: request.headSha,
      signal,
    });
    if (signal.aborted) {
      return cancelled();
    }
    if (!files.ok) {
      return files;
    }
    const resolved = await resolveLanguageModel({ role: 'draft' }, options.models);
    if (!resolved.ok) {
      return ok(failedFrom(resolved.error));
    }
    const { model } = resolved.value;
    const prompt = buildNoteDraftPrompt(
      {
        draft: {
          severity: request.severity,
          title: request.title,
          body: request.body,
          anchor: request.anchor,
        },
        files: files.value,
      },
      model.capabilities,
    );
    if (!prompt.ok) {
      return ok(refusedFrom(prompt.error));
    }
    await using directory = await mkdtempDisposable(path.join(os.tmpdir(), 'beuve-note-draft-'));
    const answered = await model.runText({
      system: prompt.value.system,
      messages: prompt.value.messages,
      cwd: directory.path,
      timeout,
      signal,
      effort: 'low',
    });
    if (!answered.ok) {
      if (answered.error.kind === 'cancelled') {
        return cancelled();
      }
      return ok(failedFrom(answered.error));
    }
    const body = noteBodyFrom(answered.value.value);
    if (body === '') {
      return ok(failedFrom({ kind: 'invalid-output', reason: 'the answer was empty' }));
    }
    return ok({ outcome: 'expanded', body, model: answered.value.model });
  };

  return {
    expandNote: async (request, requestOptions = {}): Promise<IpcResult<ExpandedNoteView>> => {
      if (isDisposed) {
        return err({ code: 'refused', message: 'beuve is quitting.' });
      }
      const controller = new AbortController();
      const signal = AbortSignal.any(
        [controller.signal, requestOptions.signal].filter((candidate) => candidate !== undefined),
      );
      const settled = Promise.withResolvers<undefined>();
      const entry: Running = { controller, settled: settled.promise };
      running.add(entry);
      try {
        return await expand(request, signal);
      } catch (error: unknown) {
        logger.error('note drafting failed unexpectedly', { error: errorFrom(error) });
        return err({ code: 'internal', message: 'Expanding the note failed unexpectedly.' });
      } finally {
        running.delete(entry);
        settled.resolve(undefined);
      }
    },

    dispose: async (): Promise<void> => {
      isDisposed = true;
      const pending = [...running];
      for (const entry of pending) {
        entry.controller.abort(new DOMException('disposed', 'AbortError'));
      }
      await Promise.all(pending.map(async (entry) => entry.settled));
    },
  };
}

/** A request in flight: how to stop it, and when it has ended. */
interface Running {
  readonly controller: AbortController;
  readonly settled: Promise<undefined>;
}

function cancelled(): IpcResult<never> {
  return err({ code: 'cancelled', message: 'cancelled' });
}

function failedFrom(error: ModelError): ExpandedNoteView {
  return { outcome: 'failed', errorKind: error.kind, message: describeModelError(error) };
}

function refusedFrom(refusal: NoteDraftRefusal): ExpandedNoteView {
  switch (refusal.kind) {
    case 'empty': {
      return { outcome: 'failed', errorKind: 'refused', message: 'Write a title or a body first.' };
    }
    case 'too-long': {
      return {
        outcome: 'failed',
        errorKind: 'refused',
        message:
          `The note is already longer than ${String(refusal.maxChars)} characters, ` +
          'too long to expand.',
      };
    }
  }
}
