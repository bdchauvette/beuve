import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { test as vitestTest, vi } from 'vitest';

import { openDatabase } from '#sqlite/open-database.ts';
import { createLogger } from '#x/log/create-logger.ts';
import type { Logger } from '#x/log/create-logger.ts';

/** Controls the faked `Temporal.Now` and `Date` of a `clock` test (ADR 0058, 0059). */
export interface Clock {
  /** Moves the clock to `instant`. */
  readonly set: (instant: Temporal.Instant | string) => void;
  /** Moves the clock forward by `duration`. */
  readonly advance: (duration: Temporal.DurationLike) => void;
}

/** Registers a resource to be closed after the test and returns it. */
export type Closing = <T extends { readonly close: () => void }>(resource: T) => T;

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
 * - `tempDir`: a fresh empty directory under `tempRoot`, removed after the test.
 * - `db`: an empty in-memory SQLite database (`openDatabase(':memory:')`), closed after the test.
 * - `logger`: a {@link RecordingLogger}.
 * - `closing`: `closing(resource)` returns `resource` and calls its `close()` after the test, for
 *   resources a shared directory (which cannot import vitest) creates, such as the JSON-RPC fake peer.
 * - `clock`: fakes `Temporal.Now` and `Date` (timers stay real) starting at
 *   `2026-10-28T12:00:00Z`, restored after the test. Fake time is global to the test file, so a
 *   test that uses it must be declared with `{ concurrent: false }`; `local/require-sequential-fake-time`
 *   enforces this.
 */
export const test = vitestTest
  .extend('tempRoot', { scope: 'worker' }, ({}, { onCleanup }) => {
    const prefix = path.join(os.tmpdir(), 'beuve-test-');
    const root = realpathSync(mkdtempSync(prefix));
    onCleanup(() => {
      rmSync(root, { recursive: true, force: true });
    });
    return root;
  })
  .extend('tempDir', ({ tempRoot }, { onCleanup }) => {
    const directory = mkdtempSync(path.join(tempRoot, 'test-'));
    onCleanup(() => {
      rmSync(directory, { recursive: true, force: true });
    });
    return directory;
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
    const resources: { readonly close: () => void }[] = [];
    onCleanup(() => {
      for (const resource of resources.toReversed()) {
        resource.close();
      }
    });
    return (resource) => {
      resources.push(resource);
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
