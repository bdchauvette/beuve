import { mkdtempDisposableSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { test as vitestTest, vi } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { removeTree } from '#x/fs/remove-tree.ts';
import { createLogger } from '#x/log/create-logger.ts';
import type { Logger } from '#x/log/create-logger.ts';

/** Controls the faked `Temporal.Now` and `Date` of a `clock` test (ADR 0058, 0059). */
export interface Clock {
  /** Moves the clock to `instant`. */
  readonly set: (instant: Temporal.Instant | string) => void;
  /** Moves the clock forward by `duration`. */
  readonly advance: (duration: Temporal.DurationLike) => void;
}

/**
 * What `closing` can release: a `Disposable`, an `AsyncDisposable`, or anything with a `close()`
 * or `dispose()` (synchronous or not).
 */
export type Closable =
  | Disposable
  | AsyncDisposable
  | { readonly close: () => void | PromiseLike<void> }
  | { readonly dispose: () => void | PromiseLike<void> };

/** Registers a resource to be released after the test and returns it. */
export type Closing = <T extends Closable>(resource: T) => T;

/** A logger that records each serialized line instead of writing it. */
export interface RecordingLogger {
  readonly logger: Logger;
  /** Parsed JSON lines, oldest first. */
  readonly lines: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Vitest's `test` with beuve's domain-free fixtures (ADR 0058). Tests run concurrently by default,
 * so every fixture is per test unless it is read-only:
 *
 * - `tempRoot` (worker): a real, symlink-free temporary directory removed when the worker ends.
 * - `tempDir`: a fresh empty directory under `tempRoot`, removed after the test, read-only
 *   checkouts in it included (`removeTree`).
 * - `db`: an empty in-memory SQLite database (`openDatabase(':memory:')`), closed after the test.
 * - `logger`: a {@link RecordingLogger}.
 * - `closing`: `closing(resource)` returns `resource` and releases it after the test, last in first
 *   out: `Symbol.asyncDispose` or `Symbol.dispose` when it has one, else `close()` or `dispose()`,
 *   awaited. For resources a shared directory (which cannot import vitest) creates, such as the
 *   JSON-RPC fake peer, and for services a test builds itself instead of a `try`/`finally`.
 * - `clock`: fakes `Temporal.Now` and `Date` (timers stay real) starting at
 *   `2026-10-28T12:00:00Z`, restored after the test. Fake time is global to the test file, so a
 *   test that uses it must be declared with `{ concurrent: false }`; `local/require-sequential-fake-time`
 *   enforces this.
 */
export const test = vitestTest
  .extend('tempRoot', { scope: 'worker' }, ({}, { onCleanup }) => {
    const prefix = path.join(realpathSync(os.tmpdir()), 'beuve-test-');
    const root = mkdtempDisposableSync(prefix);
    onCleanup(async () => {
      await removeTree(root.path);
    });
    return root.path;
  })
  .extend('tempDir', ({ tempRoot }, { onCleanup }) => {
    const directory = mkdtempDisposableSync(path.join(tempRoot, 'test-'));
    onCleanup(async () => {
      await removeTree(directory.path);
    });
    return directory.path;
  })
  .extend('db', ({}, { onCleanup }): DatabaseSync => {
    const db = openDatabase(':memory:');
    onCleanup(() => {
      db.close();
    });
    return db;
  })
  .extend('logger', (): RecordingLogger => {
    const lines: Readonly<Record<string, unknown>>[] = [];
    const logger = createLogger('test', {
      level: 'debug',
      sink: (line): void => {
        lines.push(JSON.parse(line) as Readonly<Record<string, unknown>>);
      },
    });
    return { logger, lines };
  })
  .extend('closing', ({}, { onCleanup }): Closing => {
    const resources = new AsyncDisposableStack();
    onCleanup(async () => resources.disposeAsync());
    return (resource) => {
      // eslint-disable-next-line unicorn/no-computed-property-existence-check -- the dispose symbols live on prototypes, which `Object.hasOwn` misses.
      if (Symbol.asyncDispose in resource || Symbol.dispose in resource) {
        resources.use(resource);
      } else if ('close' in resource) {
        resources.defer(async () => resource.close());
      } else {
        resources.defer(async () => resource.dispose());
      }
      return resource;
    };
  })
  .extend('clock', ({}, { onCleanup }): Clock => {
    vi.useFakeTimers({
      toFake: ['Date', 'Temporal'],
      now: Temporal.Instant.from('2026-10-28T12:00:00Z'),
    });
    onCleanup(() => {
      vi.useRealTimers();
    });
    return {
      set: (instant): void => {
        vi.setSystemTime(Temporal.Instant.from(instant).toString());
      },
      advance: (duration): void => {
        vi.setSystemTime(Temporal.Now.instant().add(duration).toString());
      },
    };
  });
