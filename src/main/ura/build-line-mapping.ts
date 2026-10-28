import { diffObjects } from '#internal/git/diff-objects.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import type { FileLineMapping, LineMapping } from '#internal/ura/line-mapping.ts';

/**
 * The URA line mapping from an older head to a later one (ADR 0023): git's zero-context diff
 * between the two commits, with renames, so only changed runs move or outdate an anchor. Added
 * and copied files can't hold an older anchor and are left out. `undefined` when the older head
 * is gone (e.g. garbage-collected after a force-push) or git fails; its items are then outdated
 * with `no-line-mapping`.
 */
export async function buildLineMapping(
  repository: GitRepository,
  fromHeadSha: string,
  toHeadSha: string,
): Promise<LineMapping | undefined> {
  const from = await resolveRevision(repository, fromHeadSha);
  if (!from.ok) {
    return undefined;
  }
  const files = await diffObjects(repository, from.value, toHeadSha as CommitSha, {
    contextLines: 0,
  });
  if (!files.ok) {
    return undefined;
  }
  return {
    fromHeadSha,
    toHeadSha,
    files: files.value.flatMap((file): FileLineMapping[] => {
      switch (file.status) {
        case 'modified': {
          return [{ kind: 'modified', path: file.path, hunks: file.hunks }];
        }
        case 'renamed': {
          return [
            { kind: 'renamed', oldPath: file.oldPath, newPath: file.newPath, hunks: file.hunks },
          ];
        }
        case 'deleted': {
          return [{ kind: 'deleted', path: file.path }];
        }
        case 'added':
        case 'copied': {
          return [];
        }
      }
    }),
  };
}
