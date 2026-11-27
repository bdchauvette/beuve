import type { IpcResult } from '#contract/ipc-contract.ts';
import type { UraHeadTexts } from '#internal/ura/compile-ura-artifact.ts';
import type { UraItem } from '#internal/ura/ura-item.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/**
 * Refuses an item whose suggestions name a file that is not text at its head, or lines past the
 * file's end (ADR 0162): the domain reads no files, so main checks before storing. An insertion may
 * sit one past the last line.
 */
export function checkSuggestionRanges(item: UraItem, texts: UraHeadTexts): IpcResult<void> {
  const files = texts.get(item.headSha);
  for (const { path, startLine, endLine } of item.suggestions) {
    const text = files?.get(path);
    const shown = revealFormatControls(path);
    if (text === undefined) {
      return err({
        code: 'invalid-request',
        message: `${shown} is not a text file at ${item.headSha.slice(0, 7)}`,
      });
    }
    const count = lineCountOf(text);
    if (startLine > count + 1 || endLine > count) {
      return err({
        code: 'invalid-request',
        message: `${shown} has ${String(count)} lines at ${item.headSha.slice(0, 7)}; a suggestion names lines ${String(startLine)}–${String(endLine)}`,
      });
    }
  }
  return ok(undefined);
}

function lineCountOf(text: string): number {
  if (text === '') {
    return 0;
  }
  const count = text.split('\n').length;
  if (text.endsWith('\n')) {
    return count - 1;
  }
  return count;
}
