import type { IpcError } from '#contract/ipc-contract.ts';
import type { GitError } from '#internal/git/git-error.ts';

/**
 * Maps a git failure to an IPC error with a short message the reviewer can act on. Raw command
 * output stays in main's log; only the subcommand name crosses to the renderer.
 */
export function ipcErrorFromGitError(error: GitError): IpcError {
  switch (error.kind) {
    case 'git-not-found': {
      return { code: 'git-unavailable', message: 'git is not installed or not on PATH' };
    }
    case 'unsupported-git-version': {
      return {
        code: 'git-unavailable',
        message: `git ${error.required} or newer is required (found ${error.found?.raw ?? 'unknown'})`,
      };
    }
    case 'not-a-repository': {
      return { code: 'not-a-repository', message: `not a git repository: ${error.path}` };
    }
    case 'unsafe-repository': {
      return {
        code: 'not-a-repository',
        message: `git refuses to use ${error.path}: it is owned by another user`,
      };
    }
    case 'invalid-argument': {
      return { code: 'invalid-request', message: `${error.argument}: ${error.reason}` };
    }
    case 'unknown-revision': {
      return { code: 'unknown-revision', message: `no such commit: ${error.revision}` };
    }
    case 'no-merge-base': {
      return { code: 'git-failed', message: 'the base and head share no history' };
    }
    case 'timeout': {
      return { code: 'git-failed', message: `git ${subcommand(error.args)} timed out` };
    }
    case 'aborted': {
      return { code: 'git-failed', message: `git ${subcommand(error.args)} was cancelled` };
    }
    case 'output-too-large': {
      return { code: 'git-failed', message: `git ${subcommand(error.args)} output is too large` };
    }
    case 'command-failed':
    case 'unexpected-output': {
      return { code: 'git-failed', message: `git ${subcommand(error.args)} failed` };
    }
    case 'worktree-conflict': {
      return { code: 'git-failed', message: `worktree conflict at ${error.path}` };
    }
  }
}

function subcommand(args: readonly string[]): string {
  return args[0] ?? '';
}
