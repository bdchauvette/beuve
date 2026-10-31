import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { ClaudeCodeSettings } from '../chat/claude-code-settings.ts';

/** One recorded run of the fake `claude`. */
export interface ClaudeCall {
  readonly args: string[];
  readonly cwd: string;
  readonly stdin: string;
}

/** The fake `claude` answering a script file, with its call log (ADR 0031). */
export interface ScriptedClaude {
  /** Pass as `MainServicesOptions.claude`. */
  readonly settings: ClaudeCodeSettings;
  /** Changes what the fake answers next, keeping its call log. */
  readonly rescript: (chunks: string[], delayMs?: number) => void;
  /** Every run so far, oldest first. */
  readonly calls: () => ClaudeCall[];
}

/** What a scripted run says; see `writeFakeClaude` for the fields. */
export interface ClaudeScript {
  readonly preamble?: string;
  readonly chunks: string[];
  /** Milliseconds the fake waits before each chunk (its own protocol, not a timer). */
  readonly delayMs?: number;
  readonly structured?: object;
}

/** The fake `claude` script, and where its scripted turn is written. */
export interface ScriptedClaudeFile {
  readonly fakeClaudePath: string;
  readonly directory: string;
  readonly name: string;
}

/** Writes `script` to `<directory>/<name>.json` and runs the fake `claude` in `chat` mode on it. */
export function createScriptedClaude(
  { fakeClaudePath, directory, name }: ScriptedClaudeFile,
  script: ClaudeScript,
): ScriptedClaude {
  const file = path.join(directory, `${name}.json`);
  const write = (chunks: string[], delayMs: number | undefined, extra: object): void => {
    writeFileSync(file, JSON.stringify({ ...extra, chunks, delayMs: delayMs ?? 0 }));
  };
  write(script.chunks, script.delayMs, {
    preamble: script.preamble ?? 'Looking.',
    ...script.structured,
  });
  return {
    settings: { command: process.execPath, leadingArgs: [fakeClaudePath, 'chat', file] },
    rescript: (chunks, delayMs): void => {
      write(chunks, delayMs, {});
    },
    calls: (): ClaudeCall[] => {
      const log = `${file}.calls`;
      if (!existsSync(log)) {
        return [];
      }
      const lines = readFileSync(log, 'utf8').trim().split('\n');
      return lines.map((line) => JSON.parse(line) as ClaudeCall);
    },
  };
}
