import path from 'node:path';

import type { ModelInsight } from './insight-output-schema.ts';
import type { InsightSeverity } from './insight-severities.ts';
import { parseHunkRanges } from './parse-hunk-ranges.ts';
import type { HeadRange } from './parse-hunk-ranges.ts';
import type { ReviewInput } from './review-input.ts';

export interface InsightLimits {
  readonly maxInsights: number;
  /** Insights the model rated below this are dropped. */
  readonly minConfidence: number;
}

/** How many model insights were dropped, by reason. */
export interface InsightDrops {
  /** Not a head-side text file of the diff (deleted, binary, outside the worktree or unknown). */
  readonly unknownFile: number;
  /** In a diff file but not touching any of its hunks. */
  readonly outsideDiff: number;
  readonly lowConfidence: number;
  readonly duplicate: number;
  /** Beyond `maxInsights`, after ranking by severity and confidence. */
  readonly overLimit: number;
}

export interface ValidatedInsights {
  /** In diff file order, then by line. */
  readonly insights: readonly ModelInsight[];
  readonly dropped: InsightDrops;
  /** Kept insights whose line range was narrowed to the hunks it touches. */
  readonly clamped: number;
}

/**
 * Keeps only insights a reviewer can act on in the diff they're shown: each must name a head-side
 * text file of the diff (paths are normalized from `./x` or an absolute worktree path) and touch
 * one of its hunks; its range is narrowed to the touched hunks. Text is trimmed, titles made one
 * line, duplicates and low-confidence insights dropped, and the rest ranked (severity, then
 * confidence) and capped. Pure and deterministic.
 */
export function validateInsights(
  raw: readonly ModelInsight[],
  input: Pick<ReviewInput, 'files' | 'worktreePath'>,
  limits: InsightLimits,
): ValidatedInsights {
  const hunksByPath = new Map<string, { order: number; ranges: HeadRange[] }>();
  for (const [order, file] of input.files.entries()) {
    if (file.status !== 'deleted' && !file.binary) {
      hunksByPath.set(file.path, { order, ranges: parseHunkRanges(file.patch) });
    }
  }

  const drops = { unknownFile: 0, outsideDiff: 0, lowConfidence: 0, duplicate: 0, overLimit: 0 };
  let clamped = 0;
  const seen = new Set<string>();
  const candidates: { insight: ModelInsight; order: number; index: number }[] = [];
  for (const [index, insight] of raw.entries()) {
    const filePath = normalizePath(insight.path, input.worktreePath);
    const file = filePath === undefined ? undefined : hunksByPath.get(filePath);
    if (filePath === undefined || file === undefined) {
      drops.unknownFile += 1;
      continue;
    }
    const range = clampToHunks(insight.lineStart, insight.lineEnd, file.ranges);
    if (range === undefined) {
      drops.outsideDiff += 1;
      continue;
    }
    const confidence = Math.min(Math.max(insight.confidence, 0), 1);
    if (confidence < limits.minConfidence) {
      drops.lowConfidence += 1;
      continue;
    }
    const title = insight.title.replaceAll(whitespace, ' ').trim().slice(0, 200);
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
      insight: {
        ...insight,
        path: filePath,
        lineStart: range.start,
        lineEnd: range.end,
        title,
        body: insight.body.trim(),
        confidence,
      },
      order: file.order,
      index,
    });
  }

  const ranked = candidates.toSorted(
    (a, b) =>
      severityRank(b.insight.severity) - severityRank(a.insight.severity) ||
      b.insight.confidence - a.insight.confidence ||
      a.index - b.index,
  );
  const kept = ranked.slice(0, Math.max(0, limits.maxInsights));
  drops.overLimit = ranked.length - kept.length;
  const insights = kept
    .toSorted(
      (a, b) =>
        a.order - b.order ||
        a.insight.lineStart - b.insight.lineStart ||
        a.insight.lineEnd - b.insight.lineEnd ||
        a.index - b.index,
    )
    .map((candidate) => candidate.insight);
  return { insights, dropped: drops, clamped };
}

const whitespace = /\s+/gu;
const leadingDotSlashes = /^(?:\.\/)+/u;

function normalizePath(raw: string, worktreePath: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(worktreePath, trimmed);
    return relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
      ? undefined
      : relative.split(path.sep).join('/');
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

function severityRank(severity: InsightSeverity): number {
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
