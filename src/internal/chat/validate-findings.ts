import path from 'node:path';

import type { ChatQuestion } from './chat-question.ts';
import type { ChatReview } from './chat-review.ts';
import type { ModelFinding } from './finding-output-schema.ts';
import type { FindingSeverity } from './finding-severities.ts';
import { parseHunkRanges } from './parse-hunk-ranges.ts';
import type { HeadRange } from './parse-hunk-ranges.ts';

export interface FindingLimits {
  readonly maxFindings: number;
  /** Findings the model rated below this are dropped. */
  readonly minConfidence: number;
}

/** How many model findings were dropped, by reason; the verification pass adds `unconfirmed`. */
export type FindingDrops = Omit<ChatReview['dropped'], 'unconfirmed'>;

export interface ValidatedFindings {
  /** In diff file order, then by line. */
  readonly findings: readonly ModelFinding[];
  readonly dropped: FindingDrops;
  /** Kept findings whose line range was narrowed to the hunks it touches. */
  readonly clamped: number;
}

/**
 * Keeps only findings a reviewer can act on in the diff they're shown (ADR 0019, 0055): each must
 * name a head-side
 * text file of the diff (paths are normalized from `./x` or an absolute worktree path) and touch
 * one of its hunks; its range is narrowed to the touched hunks. Text is trimmed, titles made one
 * line, duplicates and low-confidence findings dropped, and the rest ranked (severity, then
 * confidence) and capped. Pure and deterministic.
 */
export function validateFindings(
  raw: readonly ModelFinding[],
  input: Pick<ChatQuestion, 'files' | 'worktreePath'>,
  limits: FindingLimits,
): ValidatedFindings {
  const hunksByPath = new Map<string, { order: number; ranges: HeadRange[] }>();
  for (const [order, file] of input.files.entries()) {
    if (file.status !== 'deleted' && !file.binary) {
      hunksByPath.set(file.path, { order, ranges: parseHunkRanges(file.patch) });
    }
  }

  const drops = { unknownFile: 0, outsideDiff: 0, lowConfidence: 0, duplicate: 0, overLimit: 0 };
  let clamped = 0;
  const seen = new Set<string>();
  const candidates: { finding: ModelFinding; order: number; index: number }[] = [];
  for (const [index, finding] of raw.entries()) {
    const filePath = normalizePath(finding.path, input.worktreePath);
    const file = filePath === undefined ? undefined : hunksByPath.get(filePath);
    if (filePath === undefined || file === undefined) {
      drops.unknownFile += 1;
      continue;
    }
    const range = clampToHunks(finding.startLine, finding.endLine, file.ranges);
    if (range === undefined) {
      drops.outsideDiff += 1;
      continue;
    }
    const confidence = Math.min(Math.max(finding.confidence, 0), 1);
    if (confidence < limits.minConfidence) {
      drops.lowConfidence += 1;
      continue;
    }
    const title = finding.title.replaceAll(whitespace, ' ').trim().slice(0, 200);
    const key = `${filePath}\0${String(range.start)}\0${String(range.end)}\0${title.toLowerCase()}`;
    if (seen.has(key)) {
      drops.duplicate += 1;
      continue;
    }
    seen.add(key);
    if (range.isClamped) {
      clamped += 1;
    }
    candidates.push({
      finding: {
        ...finding,
        path: filePath,
        startLine: range.start,
        endLine: range.end,
        title,
        body: finding.body.trim(),
        confidence,
      },
      order: file.order,
      index,
    });
  }

  const ranked = candidates.toSorted((a, b) => {
    return (
      severityRank(b.finding.severity) - severityRank(a.finding.severity) ||
      b.finding.confidence - a.finding.confidence ||
      a.index - b.index
    );
  });
  const kept = ranked.slice(0, Math.max(0, limits.maxFindings));
  drops.overLimit = ranked.length - kept.length;
  const findings = kept
    .toSorted((a, b) => {
      return (
        a.order - b.order ||
        a.finding.startLine - b.finding.startLine ||
        a.finding.endLine - b.finding.endLine ||
        a.index - b.index
      );
    })
    .map((candidate) => candidate.finding);
  return { findings, dropped: drops, clamped };
}

const whitespace = /\s+/gu;
const leadingDotSlashes = /^(?:\.\/)+/u;

function normalizePath(raw: string, worktreePath: string | undefined): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (path.isAbsolute(trimmed)) {
    if (worktreePath === undefined) {
      return undefined;
    }
    const relative = path.relative(worktreePath, trimmed);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      return undefined;
    }
    return relative.split(path.sep).join('/');
  }
  return trimmed.replace(leadingDotSlashes, '');
}

function clampToHunks(
  lineStart: number,
  lineEnd: number,
  ranges: readonly HeadRange[],
): { start: number; end: number; isClamped: boolean } | undefined {
  const low = Math.min(lineStart, lineEnd);
  const high = Math.max(lineStart, lineEnd);
  const touched = ranges.filter((range) => range.start <= high && range.end >= low);
  const first = touched[0];
  const last = touched.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const start = Math.max(low, first.start);
  const end = Math.min(high, last.end);
  return { start, end, isClamped: start !== low || end !== high };
}

function severityRank(severity: FindingSeverity): number {
  switch (severity) {
    case 'info': {
      return 0;
    }
    case 'warning': {
      return 1;
    }
    case 'risk': {
      return 2;
    }
  }
}
