import type { ImpactFindingView } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import type { CommitSha } from '#internal/review/agent-insight.ts';
import type { ReviewFile, ReviewInput, ReviewScope } from '#internal/review/review-input.ts';

import type { ReviewDiff } from '../sessions/load-review-diff.ts';

export interface ReviewInputParts {
  /** The diff `session:get-review` shows; must not be `up-to-date`. */
  readonly diff: ReviewDiff;
  readonly worktreePath: string;
  /** Normalized with `normalizePathScope`; empty means the whole diff. */
  readonly pathPrefixes: readonly string[];
  /** The cached ImpactGate findings for the same diff, if they were computed. */
  readonly impactFindings: readonly ImpactFindingView[] | undefined;
}

/**
 * Maps the session and git domains' review diff, and ImpactGate's findings, into the review
 * domain's input (ADR 0019): files under `pathPrefixes` (a prefix matches that path and everything
 * below it), and an interdiff that fell back to the full change passed as `full`.
 */
export function toReviewInput(parts: ReviewInputParts): ReviewInput {
  const { diff, pathPrefixes } = parts;
  const headSha = diff.refreshed.session.headSha;
  const files = diff.files
    .map((file) => toReviewFile(file))
    .filter((file) => isSelected(file, pathPrefixes));
  const paths = new Set(files.map((file) => file.path));
  const findings = (parts.impactFindings ?? [])
    .filter((finding) => paths.has(finding.path))
    .map(({ path, functionName, startLine, endLine, value, limit, trend }) => ({
      path,
      functionName,
      startLine,
      endLine,
      value,
      limit,
      trend,
    }));
  return {
    sessionId: diff.refreshed.session.id,
    scope: toScope(diff, headSha),
    worktreePath: parts.worktreePath,
    files,
    pathScope: pathPrefixes,
    ...(parts.impactFindings !== undefined && { impactFindings: findings }),
  };
}

function toReviewFile(file: DiffFile): ReviewFile {
  const common = { binary: file.binary, patch: file.patch };
  switch (file.status) {
    case 'added':
    case 'deleted':
    case 'modified': {
      return { path: file.path, status: file.status, ...common };
    }
    case 'renamed':
    case 'copied': {
      return { path: file.newPath, previousPath: file.oldPath, status: file.status, ...common };
    }
  }
}

function isSelected(file: ReviewFile, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) {
    return true;
  }
  const candidates = [file.path, file.previousPath].filter((path) => path !== undefined);
  return prefixes.some((prefix) =>
    candidates.some((path) => path === prefix || path.startsWith(`${prefix}/`)),
  );
}

function toScope(diff: ReviewDiff, headSha: CommitSha): ReviewScope {
  const baseSha = diff.baseSha;
  const { scope } = diff;
  if (scope.kind === 'interdiff' && scope.outcome.kind !== 'fallback') {
    return {
      kind: 'interdiff',
      outcome: scope.outcome.kind,
      baseSha,
      fromHeadSha: scope.fromHeadSha as CommitSha,
      headSha,
    };
  }
  return { kind: 'full', baseSha, headSha };
}
