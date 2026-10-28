import type { FunctionMetrics } from './function-measurement.ts';

/** Where a function sat on one side of the change, and how complex it was there. */
export interface FunctionSnapshot {
  readonly startLine: number;
  readonly endLine: number;
  readonly metrics: FunctionMetrics;
}

interface FunctionImpactCommon {
  /** Qualified name on the head side (the base side for removed functions). */
  readonly name: string;
  /** Its lines intersect the diff: changed lines on the head side or removed lines on the base side. */
  readonly inDiff: boolean;
  /** Head minus base, with an absent side counting as zeros. */
  readonly delta: FunctionMetrics;
}

/**
 * How the change moved one function (ADR 0015). `percentile` ranks the head cognitive complexity
 * among all head functions of the analyzed files (0–100, mid-rank). `unchanged` entries appear
 * only when the diff touches them (a function moved without edits).
 */
export type FunctionImpact = FunctionImpactCommon &
  (
    | { readonly change: 'added'; readonly head: FunctionSnapshot; readonly percentile: number }
    | { readonly change: 'removed'; readonly base: FunctionSnapshot }
    | {
        readonly change: 'modified' | 'unchanged';
        readonly base: FunctionSnapshot;
        readonly head: FunctionSnapshot;
        readonly percentile: number;
      }
    | {
        /** Paired by identical body under a different name. */
        readonly change: 'renamed';
        readonly previousName: string;
        readonly base: FunctionSnapshot;
        readonly head: FunctionSnapshot;
        readonly percentile: number;
      }
  );

/** Totals for one side-by-side file. */
export interface FileAggregate {
  readonly baseFunctions: number;
  readonly headFunctions: number;
  readonly baseCognitive: number;
  readonly headCognitive: number;
  readonly cognitiveDelta: number;
  /** Highest head cognitive complexity in the file, 0 without functions. */
  readonly maxCognitive: number;
  readonly changedFunctions: number;
  readonly findings: number;
}

/** `no-source`: neither side has text (binary files, submodules). */
export type SkipReason = 'unsupported-language' | 'too-large' | 'parse-failed' | 'no-source';

export type FileImpact =
  | {
      readonly status: 'analyzed';
      readonly path: string;
      readonly previousPath?: string;
      readonly language: string;
      /** Either side had syntax errors; metrics near them may be off. */
      readonly parseErrors: boolean;
      readonly aggregate: FileAggregate;
      /** Changed or diff-touched functions, by head line (base line for removed ones). */
      readonly functions: readonly FunctionImpact[];
    }
  | {
      readonly status: 'skipped';
      readonly path: string;
      readonly previousPath?: string;
      readonly reason: SkipReason;
    };

/**
 * A changed function over the cognitive limit: staging material for a URA item.
 * `trend` compares with the base: `introduced` (was within the limit or didn't exist),
 * `worsened`, `unchanged` or `improved` (still over it).
 */
export interface ImpactFinding {
  readonly kind: 'cognitive-complexity';
  readonly path: string;
  readonly functionName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly value: number;
  readonly limit: number;
  readonly baseValue: number | undefined;
  readonly trend: 'introduced' | 'worsened' | 'unchanged' | 'improved';
  readonly percentile: number;
}

/** The whole ImpactGate result: plain, JSON-serializable data. */
export interface ImpactReport {
  readonly cognitiveMax: number;
  /** Head functions the percentiles rank against: every function in the analyzed head files. */
  readonly population: number;
  readonly files: readonly FileImpact[];
  readonly findings: readonly ImpactFinding[];
  readonly totals: {
    readonly analyzedFiles: number;
    readonly skippedFiles: number;
    readonly added: number;
    readonly removed: number;
    readonly modified: number;
    readonly cognitiveDelta: number;
    readonly findings: number;
  };
}
