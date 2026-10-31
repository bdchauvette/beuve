import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Where to write a fake `--version` command, its file name, and what it prints. */
export interface VersionCommand {
  readonly directory: string;
  readonly name: string;
  readonly output: string;
}

/**
 * Writes an executable `sh` script at `<directory>/<name>` that prints `output` for `--version`
 * and fails otherwise, a stand-in for an installed `claude` (ADR 0070). Returns its path.
 */
export function writeVersionCommand({ directory, name, output }: VersionCommand): string {
  const file = path.join(directory, name);
  writeFileSync(
    file,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '%s\\n' '${output.replaceAll("'", '')}'; exit 0; fi\nexit 3\n`,
  );
  chmodSync(file, 0o755);
  return file;
}
