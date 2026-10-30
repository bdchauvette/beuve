import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { readSettingsFile } from './read-settings-file.ts';
import { updateSettingsFile } from './update-settings-file.ts';
import { test } from '../testing/test.ts';

describe('updateSettingsFile', () => {
  test('keeps every key when writers overlap', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'nested', 'settings.json');
    await Promise.all([
      updateSettingsFile(file, (current) => ({ ...current, a: 1 })),
      updateSettingsFile(file, (current) => ({ ...current, b: 2 })),
      updateSettingsFile(file, (current) => ({ ...current, c: 3 })),
    ]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({ a: 1, b: 2, c: 3 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(path.dirname(file))).toStrictEqual(['settings.json']);
  });

  test('reads a malformed file as empty', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(file, '[1, 2');
    await expect(readSettingsFile(file)).resolves.toStrictEqual({});
    await expect(readSettingsFile(path.join(tempDir, 'missing.json'))).resolves.toStrictEqual({});
  });
});
