import type { CommitSha } from '../object-id.ts';

/** A throwaway repository for integration tests, driven synchronously. */
export interface TestRepository {
  /** Real (symlink-free) path of the repository's top level. */
  readonly directory: string;
  /** Runs git in the repository and returns trimmed stdout; throws on failure. */
  readonly git: (...args: string[]) => string;
  /** Writes a file relative to the repository, creating parent directories. */
  readonly write: (file: string, content: string | Uint8Array) => void;
  /** Stages everything and commits, returning the new commit's sha. */
  readonly commit: (message: string) => CommitSha;
  /** A fresh empty temporary directory, removed by `cleanup`. */
  readonly scratch: () => string;
  readonly cleanup: () => void;
}

/**
 * A repository built once per worker and copied into each test that asks for it (ADR 0058).
 * `build` gets an empty repository on `main` and returns plain data (shas, paths), which every
 * copy shares; `name` keys the cache, so it must be unique per build function.
 */
export interface RepositoryTemplate<T> {
  readonly name: string;
  readonly build: (repo: TestRepository) => T;
}
