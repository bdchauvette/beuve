import type { GitError } from '#internal/git/git-error.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository, RepositoryProbe } from '#internal/git/open-repository.ts';
import { anySignal } from '#x/async/any-signal.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SessionContext } from './session-context.ts';

/**
 * Opens `directory` for one request. The probe (`--version`, `--show-toplevel`) runs once per
 * directory, shared by concurrent opens and kept in `context.caches.probes`; the handle is new
 * each time and bound to `context.git` and `signal`, so no request's signal reaches another's
 * commands (ADR 0079, 0081).
 */
export async function openSessionRepository(
  context: SessionContext,
  directory: string,
  signal?: AbortSignal,
): Promise<Result<GitRepository, GitError>> {
  const probe = await context.caches.probes.get(
    directory,
    async (shared): Promise<Result<RepositoryProbe, GitError>> => {
      const opened = await openRepository(directory, {
        ...context.git,
        objectReaders: context.caches.objectReaders,
        signal: anySignal(context.git.signal, shared),
      });
      if (opened.ok) {
        return ok({ root: opened.value.root, version: opened.value.version });
      }
      return opened;
    },
    { signal },
  );
  if (probe === 'aborted') {
    return err({ kind: 'aborted', args: ['--version'] });
  }
  if (!probe.ok) {
    return probe;
  }
  return openRepository(directory, {
    ...context.git,
    objectReaders: context.caches.objectReaders,
    signal: anySignal(context.git.signal, signal),
    probe: probe.value,
  });
}
