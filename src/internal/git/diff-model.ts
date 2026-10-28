/**
 * What happened to a file. Modes are git's octal strings (`100644`, `100755`, `120000` symlink,
 * `160000` submodule). A pure rename or copy (100% similar, same mode) reports no modes, so they
 * are `undefined` there; everywhere else git always states them.
 */
export type FileChange =
  | { readonly status: 'added'; readonly path: string; readonly mode: string }
  | { readonly status: 'deleted'; readonly path: string; readonly mode: string }
  | {
      readonly status: 'modified';
      readonly path: string;
      readonly oldMode: string;
      readonly newMode: string;
    }
  | {
      readonly status: 'renamed' | 'copied';
      readonly oldPath: string;
      readonly newPath: string;
      /** Git's similarity index, 0–100. */
      readonly similarity: number;
      readonly oldMode: string | undefined;
      readonly newMode: string | undefined;
    };

/** One file's section of a unified diff. */
export type DiffFile = FileChange & {
  /** Git printed "Binary files … differ"; there are no hunks. */
  readonly binary: boolean;
  /** Either side is a gitlink (mode `160000`); hunks show `Subproject commit` lines. */
  readonly submodule: boolean;
  /** Blob names from the `index` line, when present (all zeros for an absent side). */
  readonly oldObject: string | undefined;
  readonly newObject: string | undefined;
  readonly hunks: readonly DiffHunk[];
  /** This file's exact patch text, from `diff --git` through its last line, newline-terminated. */
  readonly patch: string;
};

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  /** The full `@@ -a,b +c,d @@ …` line. */
  readonly header: string;
  /** The function or section context git prints after the second `@@`, or `''`. */
  readonly section: string;
  readonly lines: readonly DiffLine[];
}

/**
 * A hunk line without its `' '`/`+`/`-` prefix. `content` keeps a trailing `\r` for CRLF files so
 * line-ending changes stay visible. `noNewline` marks the last line of a side that git flagged with
 * "\ No newline at end of file".
 */
export type DiffLine =
  | {
      readonly kind: 'context';
      readonly content: string;
      readonly oldLine: number;
      readonly newLine: number;
      readonly noNewline: boolean;
    }
  | {
      readonly kind: 'added';
      readonly content: string;
      readonly newLine: number;
      readonly noNewline: boolean;
    }
  | {
      readonly kind: 'removed';
      readonly content: string;
      readonly oldLine: number;
      readonly noNewline: boolean;
    };

/** Why a patch couldn't be parsed; `line` is 1-based within the input. */
export interface DiffParseError {
  readonly kind: 'malformed-diff';
  readonly line: number;
  readonly message: string;
}
