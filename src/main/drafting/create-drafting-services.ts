import { mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  AutoeditedNoteView,
  AutoeditNoteRequest,
  AutoeditSuggestionDraftView,
  IpcResult,
} from '#contract/ipc-contract.ts';
import { buildNoteDraftPrompt } from '#internal/chat/build-note-draft-prompt.ts';
import type { NoteDraftRefusal } from '#internal/chat/build-note-draft-prompt.ts';
import type { NoteDraftSuggestion } from '#internal/chat/note-draft.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { UraHeadTexts } from '#internal/ura/compile-ura-artifact.ts';
import type { ModelError } from '#internal/llm/language-model.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { describeModelError } from '../models/describe-model-error.ts';
import { resolveLanguageModel } from '../models/resolve-language-model.ts';
import type { ModelResolverDeps } from '../models/resolve-language-model.ts';
import type { RequestOptions } from '../request-options.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { readSuggestionTexts } from '../ura/read-suggestion-texts.ts';
import type { SuggestionTextsSubject } from '../ura/read-suggestion-texts.ts';
import { checkAutoeditSuggestions } from './check-autoedit-suggestions.ts';
import { loadNoteDiff } from './load-note-diff.ts';
import { parseAutoeditAnswer } from './parse-autoedit-answer.ts';

/** A drafting request as the IPC handler passes it: the renderer's, less its `requestId`. */
export type NoteAutoeditRequest = Omit<AutoeditNoteRequest, 'requestId'>;

/** Note drafting (ADR 0125): one-off model requests outside the chat. */
export interface DraftingServices {
  /**
   * ✨ Autoedit: one request on the `draft` role whose prompt is the draft, its suggestions with
   * their lines' text at its head, and the hunks near its anchor, run in an empty scratch
   * directory with no repository access. The answer's body and checked suggestions come back for
   * the form; nothing is stored and the chat's queue is not involved. A cancelled request answers
   * `cancelled`; a model failure is a `failed` answer, never an error.
   */
  readonly autoeditNote: (
    request: NoteAutoeditRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<AutoeditedNoteView>>;
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

  const autoedit = async (
    request: NoteAutoeditRequest,
    signal: AbortSignal,
  ): Promise<IpcResult<AutoeditedNoteView>> => {
    const diff = await loadNoteDiff(context, {
      sessionId: request.sessionId,
      headSha: request.headSha,
      signal,
    });
    if (signal.aborted) {
      return cancelled();
    }
    if (!diff.ok) {
      return diff;
    }
    const { files, repository } = diff.value;
    const existing = request.suggestions ?? [];
    const headFiles = { repository, headSha: request.headSha, logger };
    const draftTexts = await readHeadTexts(
      headFiles,
      existing.map((suggestion) => suggestion.path),
    );
    const resolved = await resolveLanguageModel({ role: 'draft' }, options.models);
    if (!resolved.ok) {
      return ok(failedFrom(resolved.error));
    }
    const { model } = resolved.value;
    const prompt = buildNoteDraftPrompt(
      {
        draft: {
          severity: request.severity,
          blocking: request.blocking ?? false,
          title: request.title,
          body: request.body,
          anchor: request.anchor,
          suggestions: existing.map((suggestion) => {
            return draftSuggestionFrom(suggestion, draftTexts.get(request.headSha));
          }),
        },
        files,
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
    const parsed = parseAutoeditAnswer(answered.value.value);
    if (!parsed.ok) {
      return ok(failedFrom({ kind: 'invalid-output', reason: parsed.error }));
    }
    const answerTexts = await readHeadTexts(
      headFiles,
      parsed.value.suggestions.map((suggestion) => suggestion.path),
    );
    const checked = checkAutoeditSuggestions(parsed.value.suggestions, {
      existing,
      shownLines: prompt.value.shownLines,
      headSha: request.headSha,
      texts: answerTexts,
    });
    return ok({
      outcome: 'autoedited',
      body: parsed.value.body,
      suggestions: checked.suggestions,
      droppedSuggestions: checked.dropped + parsed.value.malformed,
      model: answered.value.model,
    });
  };

  return {
    autoeditNote: async (request, requestOptions = {}): Promise<IpcResult<AutoeditedNoteView>> => {
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
        return await autoedit(request, signal);
      } catch (error: unknown) {
        logger.error('note drafting failed unexpectedly', { error: errorFrom(error) });
        return err({ code: 'internal', message: 'Autoediting the note failed unexpectedly.' });
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

/** Where a note's head files are read from. */
interface HeadFiles {
  readonly repository: GitRepository;
  readonly headSha: string;
  readonly logger: Logger;
}

/**
 * The text of `paths` at the note's head (ADR 0162's reads); a read that fails is logged and
 * reads as no files, so their lines show as unreadable and suggestions on them are dropped.
 */
async function readHeadTexts(
  { repository, headSha, logger }: HeadFiles,
  paths: readonly string[],
): Promise<UraHeadTexts> {
  if (paths.length === 0) {
    return new Map();
  }
  const subject: SuggestionTextsSubject = {
    headSha: headSha as SuggestionTextsSubject['headSha'],
    suggestions: paths.map((suggestionPath) => {
      return { path: suggestionPath };
    }),
  };
  const texts = await readSuggestionTexts(repository, [subject]);
  if (texts.ok) {
    return texts.value;
  }
  logger.warn('could not read the files of a note draft’s suggestions', { error: texts.error });
  return new Map();
}

/** A form's suggestion with the text its lines have at the head, when that file could be read. */
function draftSuggestionFrom(
  suggestion: AutoeditSuggestionDraftView,
  texts: ReadonlyMap<string, string> | undefined,
): NoteDraftSuggestion {
  const { path: filePath, startLine, endLine, replacement } = suggestion;
  const text = texts?.get(filePath);
  if (text === undefined || endLine < startLine) {
    return { path: filePath, startLine, endLine, replacement };
  }
  const lines = text.split('\n');
  if (endLine > lines.length) {
    return { path: filePath, startLine, endLine, replacement };
  }
  return {
    path: filePath,
    startLine,
    endLine,
    replacement,
    headText: lines.slice(startLine - 1, endLine).join('\n'),
  };
}

function cancelled(): IpcResult<never> {
  return err({ code: 'cancelled', message: 'cancelled' });
}

function failedFrom(error: ModelError): AutoeditedNoteView {
  return { outcome: 'failed', errorKind: error.kind, message: describeModelError(error) };
}

function refusedFrom(refusal: NoteDraftRefusal): AutoeditedNoteView {
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
          'too long to autoedit.',
      };
    }
    case 'suggestions-too-long': {
      return {
        outcome: 'failed',
        errorKind: 'refused',
        message:
          `The note’s suggestions are longer than ${String(refusal.maxChars)} characters together, ` +
          'too long to autoedit.',
      };
    }
  }
}
