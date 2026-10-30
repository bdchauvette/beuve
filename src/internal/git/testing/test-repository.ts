import type { CommitSha } from '../object-id.ts';

/** A throwaway repository for integration tests, driven through async git; file writes are synchronous. */
export interface TestRepository {
  /** Real (symlink-free) path of the repository's top level. */
  readonly directory: string;
  /** Runs git in the repository and resolves to trimmed stdout; rejects on failure. */
  readonly git: (...args: string[]) => Promise<string>;
  /** Writes a file relative to the repository, creating parent directories. */
  readonly write: (file: string, content: string | Uint8Array) => void;
  /** Stages everything and commits, returning the new commit's sha. */
  readonly commit: (message: string) => Promise<CommitSha>;
  /** A fresh empty temporary directory, removed with the repository's home. */
  readonly scratch: () => string;
}

/**
 * A repository built once per worker and copied into each test that asks for it (ADR 0058).
 * `build` gets an empty repository on `main` and returns plain data (shas, paths), which every
 * copy shares; `name` keys the cache, so it must be unique per build function.
 */
export interface RepositoryTemplate<T> {
  readonly name: string;
  readonly build: (repo: TestRepository) => T | Promise<T>;
}
