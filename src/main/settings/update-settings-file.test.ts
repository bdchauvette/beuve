import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSettingsFile } from './read-settings-file.ts';
import { updateSettingsFile } from './update-settings-file.ts';

describe('updateSettingsFile', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'beuve-settings-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps every key when writers overlap', async () => {
    const file = path.join(directory, 'nested', 'settings.json');
    await Promise.all([
      updateSettingsFile(file, (current) => ({ ...current, a: 1 })),
      updateSettingsFile(file, (current) => ({ ...current, b: 2 })),
      updateSettingsFile(file, (current) => ({ ...current, c: 3 })),
    ]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('reads a malformed file as empty', async () => {
    const file = path.join(directory, 'settings.json');
    writeFileSync(file, '[1, 2');
    expect(await readSettingsFile(file)).toEqual({});
    expect(await readSettingsFile(path.join(directory, 'missing.json'))).toEqual({});
  });
});
