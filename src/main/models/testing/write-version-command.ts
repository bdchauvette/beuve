import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Writes an executable `sh` script at `<directory>/<name>` that prints `output` for `--version`
 * and fails otherwise, a stand-in for an installed `claude` (ADR 0070). Returns its path.
 */
export function writeVersionCommand(directory: string, name: string, output: string): string {
  const file = path.join(directory, name);
  writeFileSync(
    file,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '%s\\n' '${output.replaceAll("'", '')}'; exit 0; fi\nexit 3\n`,
  );
  chmodSync(file, 0o755);
  return file;
}
