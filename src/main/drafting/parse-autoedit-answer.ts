import { z } from 'zod';

import { noteBodyFrom } from '#internal/chat/note-body-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/** A suggestion as an autoedit answer proposes it, well-formed but not yet checked. */
export interface ProposedSuggestion {
  /** The prompt's id (s1, s2, …) of the suggestion it revises; absent for a new one. */
  readonly id?: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly replacement: string;
}

/** An autoedit answer's body and well-formed suggestions, and how many entries were malformed. */
export interface ParsedAutoeditAnswer {
  readonly body: string;
  readonly suggestions: readonly ProposedSuggestion[];
  readonly malformed: number;
}

const answerSchema = z.object({
  body: z.string(),
  suggestions: z.array(z.unknown()).max(10_000).optional(),
});

const suggestionSchema = z
  .object({
    id: z.string().min(1).max(20).optional(),
    path: z.string().min(1).max(4096),
    startLine: z.number().int().min(1).max(10_000_000),
    endLine: z.number().int().min(0).max(10_000_000),
    replacement: z.string().max(1_000_000),
  })
  .refine((suggestion) => {
    return suggestion.endLine >= suggestion.startLine - 1;
  }, 'endLine comes before startLine - 1');

const wholeFence = /^(`{3,}|~{3,})[ \t]*(?:json)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/u;

/**
 * Reads an ✨ Autoedit answer (ADR 0125, amendment "Autoedit: body and suggestions"): one JSON
 * object `{ body, suggestions }`, unwrapped when the model fenced it despite the instructions.
 * The body is unwrapped as an expansion's is (`noteBodyFrom`) and must not be empty; each
 * suggestion is checked for shape on its own, so a malformed one is counted and left out rather
 * than failing the answer. The error is why the answer as a whole is unusable. Pure.
 */
export function parseAutoeditAnswer(answer: string): Result<ParsedAutoeditAnswer, string> {
  const trimmed = answer.trim();
  const json = wholeFence.exec(trimmed)?.[2] ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return err('the answer was not JSON');
  }
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) {
    return err('the answer had no note body');
  }
  const body = noteBodyFrom(parsed.data.body);
  if (body === '') {
    return err('the answer was empty');
  }
  const suggestions: ProposedSuggestion[] = [];
  let malformed = 0;
  const entries = parsed.data.suggestions ?? [];
  for (const entry of entries) {
    const suggestion = suggestionSchema.safeParse(entry);
    if (suggestion.success) {
      const { id, ...rest } = suggestion.data;
      suggestions.push({ ...(id !== undefined && { id }), ...rest });
    } else {
      malformed += 1;
    }
  }
  return ok({ body, suggestions, malformed });
}
