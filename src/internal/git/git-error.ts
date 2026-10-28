import type { GitVersion } from './parse-git-version.ts';

/** Why a git operation could not produce its result. Every variant is an expected failure. */
export type GitError =
  | { readonly kind: 'git-not-found'; readonly gitBinary: string }
  | { readonly kind: 'not-a-repository'; readonly path: string; readonly stderr: string }
  | { readonly kind: 'unsafe-repository'; readonly path: string; readonly stderr: string }
  | {
      readonly kind: 'unsupported-git-version';
      readonly found: GitVersion | undefined;
      readonly required: string;
    }
  | { readonly kind: 'invalid-argument'; readonly argument: string; readonly reason: string }
  | { readonly kind: 'unknown-revision'; readonly revision: string }
  | { readonly kind: 'no-merge-base'; readonly left: string; readonly right: string }
  | {
      readonly kind: 'command-failed';
      readonly args: readonly string[];
      readonly exitCode: number | undefined;
      readonly signal: string | undefined;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: 'timeout'; readonly args: readonly string[]; readonly timeoutMs: number }
  | {
      readonly kind: 'output-too-large';
      readonly args: readonly string[];
      readonly maxBufferBytes: number;
    }
  | {
      readonly kind: 'unexpected-output';
      readonly args: readonly string[];
      readonly message: string;
    }
  | { readonly kind: 'worktree-conflict'; readonly path: string; readonly reason: string };
