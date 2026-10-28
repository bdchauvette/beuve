import { mkdirSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Makes `<directory>/node_modules/vitest` a link to beuve's own Vitest, so a throwaway project
 * can play the user's clone with its dependencies installed. Test-only (ADR 0013).
 */
export function linkTestVitest(directory: string): void {
  mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
  symlinkSync(
    path.dirname(require.resolve('vitest/package.json')),
    path.join(directory, 'node_modules', 'vitest'),
    'dir',
  );
}
