// eslint-disable-next-line no-restricted-imports -- moves a whole file aside; it replaces nothing.
import { appendFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

import type { LogSink } from './create-logger.ts';

export interface LogFileOptions {
  /** The file this run writes, e.g. `~/Library/Logs/beuve/main.log`. */
  readonly path: string;
  /** Where the previous run's file is moved, replacing the run before it. */
  readonly previousPath: string;
}

/**
 * A {@link LogSink} that appends each line to a file of this run's own: the last run's file moves
 * to `previousPath` first, so the log holds two runs at most. The directory is created 0700 and the
 * file 0600, since lines can name repositories and paths. Like the logger, it never throws: a line
 * it can't write is dropped.
 */
export function openLogFile(options: LogFileOptions): LogSink {
  try {
    mkdirSync(path.dirname(options.path), { recursive: true, mode: 0o700 });
    renameSync(options.path, options.previousPath);
  } catch {
    // No log yet, or no directory: the first append says whether it can be written.
  }
  return (line: string): void => {
    try {
      appendFileSync(options.path, `${line}\n`, { mode: 0o600 });
    } catch {
      // Logging never throws.
    }
  };
}
