import type { Logger } from '#x/log/create-logger.ts';

import { GitObjectReader } from './git-object-reader.ts';
import type { ObjectReaderStats } from './git-object-reader.ts';
import { gitRunner } from './git-runner.ts';

export interface ObjectReaderPoolOptions {
  readonly gitBinary?: string;
  /** Each reader stops after this long idle. Defaults to 30 s. */
  readonly idleTimeout?: Temporal.Duration;
  /** A request stuck at the head of a reader's queue this long restarts it. Defaults to 30 s. */
  readonly requestTimeout?: Temporal.Duration;
  readonly logger?: Logger;
}

/**
 * One {@link GitObjectReader} per repository root, made on first use, for a process that opens
 * the same repositories again and again (ADR 0087). Main keeps one in its git caches and passes
 * it to `openRepository`; only the git domain can get a reader out of it (the method is keyed by
 * {@link gitRunner}), so everything else reaches objects through typed operations. Disposing
 * stops every reader.
 */
export class ObjectReaderPool implements AsyncDisposable {
  readonly #options: ObjectReaderPoolOptions;
  readonly #readers = new Map<string, GitObjectReader>();
  #isDisposed = false;

  constructor(options: ObjectReaderPoolOptions = {}) {
    this.#options = options;
  }

  /** Each root's reader statistics, for tests and diagnostics. */
  get stats(): ReadonlyMap<string, ObjectReaderStats> {
    return new Map(
      Array.from(this.#readers, ([root, reader]) => {
        return [root, reader.stats];
      }),
    );
  }

  /** The reader for `root`, started lazily; `undefined` once the pool is disposed. */
  [gitRunner](root: string, gitBinary: string | undefined): GitObjectReader | undefined {
    if (this.#isDisposed) {
      return undefined;
    }
    const key = `${gitBinary ?? this.#options.gitBinary ?? 'git'}\0${root}`;
    let reader = this.#readers.get(key);
    if (reader === undefined) {
      reader = new GitObjectReader({
        ...this.#options,
        root,
        ...(gitBinary !== undefined && { gitBinary }),
      });
      this.#readers.set(key, reader);
    }
    return reader;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#isDisposed = true;
    const readers = this.#readers.values().toArray();
    this.#readers.clear();
    await Promise.all(readers.map(async (reader) => reader[Symbol.asyncDispose]()));
  }
}
