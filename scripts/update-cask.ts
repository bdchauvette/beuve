import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { updateCask } from '../src/release/update-cask.ts';

updateCaskFile();

/**
 * `node scripts/update-cask.ts <version> <sha256>` rewrites `Casks/beuve.rb` in place (ADR 0049).
 */
function updateCaskFile(): void {
  const [version, sha256] = process.argv.slice(2);
  if (version === undefined || sha256 === undefined) {
    console.error('usage: update-cask.ts <version> <sha256 of the arm64 zip>');
    process.exitCode = 2;
    return;
  }
  const file = 'Casks/beuve.rb';
  writeFileSync(file, updateCask(readFileSync(file, 'utf8'), version, sha256));
}
