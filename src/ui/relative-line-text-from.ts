import { lineFromTarget } from './line-from-target.ts';
import type { ReviewTarget } from './target-from.ts';

/**
 * What Copy Relative Line Number puts on the clipboard (ADR 0096): the target file's
 * repository-relative path and head line as `path:line`, the form test runners take. The path
 * alone when the target has no head line; `undefined` when no file is active. Pure.
 */
export function relativeLineTextFrom(target: ReviewTarget): string | undefined {
  if (target.kind === 'change') {
    return undefined;
  }
  const line = lineFromTarget(target);
  if (line === undefined) {
    return target.file.path;
  }
  return `${target.file.path}:${String(line)}`;
}
