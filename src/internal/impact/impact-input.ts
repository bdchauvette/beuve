import type { Result } from '#pkg/result/result.ts';

import type { SourceMeasurement } from './function-measurement.ts';
import type { ImpactNode } from './impact-node.ts';
import type { SkipReason } from './impact-report.ts';

/** A 1-based inclusive line range. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** The diff's lines: removed ones by base line number, added ones by head line number. */
export interface ChangedLines {
  readonly base: readonly LineRange[];
  readonly head: readonly LineRange[];
}

/**
 * One changed file as main assembles it from the git domain. A side's text is `undefined` when the
 * file doesn't exist there (added or deleted). `previousPath` is the base path of a rename.
 */
export interface ImpactSourceFile {
  readonly path: string;
  readonly previousPath?: string | undefined;
  readonly baseText: string | undefined;
  readonly headText: string | undefined;
  readonly changedLines: ChangedLines;
}

/**
 * Parses `text` as the language of `path` and returns what `use` makes of the tree, which is only
 * valid during the call. The syntax domain's `SyntaxParser.parse` satisfies this; any failure
 * `kind` it reports other than `unsupported-language` or `too-large` reads as `parse-failed`.
 */
export type ParseSource = <T>(
  path: string,
  text: string,
  use: (root: ImpactNode, language: string) => T,
) => Promise<Result<T, { readonly kind: string }>>;

/** A file whose sides are already measured: the pure input of `assessImpact`. */
export type MeasuredFile =
  | {
      readonly status: 'measured';
      readonly path: string;
      readonly previousPath?: string | undefined;
      readonly language: string;
      readonly base: SourceMeasurement | undefined;
      readonly head: SourceMeasurement | undefined;
      readonly changedLines: ChangedLines;
    }
  | {
      readonly status: 'skipped';
      readonly path: string;
      readonly previousPath?: string | undefined;
      readonly reason: SkipReason;
    };
