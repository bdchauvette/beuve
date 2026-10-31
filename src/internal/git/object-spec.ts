import type { CommitSha } from './object-id.ts';
import type { RevisionName } from './parse-revision-name.ts';
import type { TreePath } from './parse-tree-path.ts';

/**
 * Which object to look up, structurally, so nothing can reach `cat-file`'s line protocol that
 * would break it: a full object id, a path in a commit's tree, or a revision peeled to a commit
 * or a tree. A ref is resolved afresh by every lookup (ADR 0081: refs are never cached).
 */
export type ObjectSpec =
  | { readonly kind: 'object'; readonly oid: string }
  | { readonly kind: 'path'; readonly commit: CommitSha; readonly path: TreePath }
  | {
      readonly kind: 'ref';
      readonly ref: RevisionName | CommitSha;
      readonly peel: 'commit' | 'tree';
    };

export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';

/** What git says an object is, without its content. */
export interface ObjectInfo {
  readonly oid: string;
  readonly type: ObjectType;
  readonly size: number;
}

/** What `info` answers: the object, or why there is none. */
export type ObjectLookup =
  | ({ readonly kind: 'found' } & ObjectInfo)
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' };

/**
 * What `read` answers. `bytes` are the object's raw content (no filters, no textconv);
 * `too-large` objects were never sent over the pipe.
 */
export type ObjectContent =
  | ({ readonly kind: 'content'; readonly bytes: Buffer } & ObjectInfo)
  | ({ readonly kind: 'too-large'; readonly limit: number } & ObjectInfo)
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' };

export interface ObjectReadOptions {
  /** Abandons this request (its bytes are skipped when they arrive); never stops the process. */
  readonly signal?: AbortSignal | undefined;
  /** Larger objects answer `too-large` after an `info`, without crossing the pipe. */
  readonly maxBytes?: number;
}
