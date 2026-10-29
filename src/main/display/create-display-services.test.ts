import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDisplayServices } from './create-display-services.ts';

describe('createDisplayServices', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'beuve-display-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('defaults to split with whitespace shown, and persists changes beside other keys', async () => {
    const file = path.join(directory, 'settings.json');
    writeFileSync(file, JSON.stringify({ preferredEditor: 'zed', diffLayout: 'diagonal' }));
    const display = createDisplayServices(file);
    expect(await display.get()).toEqual({
      ok: true,
      value: { layout: 'split', ignoreWhitespace: false },
    });
    expect(await display.set({ layout: 'unified' })).toEqual({
      ok: true,
      value: { layout: 'unified', ignoreWhitespace: false },
    });
    await display.set({ ignoreWhitespace: true });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      preferredEditor: 'zed',
      diffLayout: 'unified',
      ignoreWhitespace: true,
    });
    expect(await createDisplayServices(file).get()).toEqual({
      ok: true,
      value: { layout: 'unified', ignoreWhitespace: true },
    });
  });

  it('remembers in memory without a file', async () => {
    const display = createDisplayServices();
    await display.set({ ignoreWhitespace: true });
    expect(await display.get()).toEqual({
      ok: true,
      value: { layout: 'split', ignoreWhitespace: true },
    });
  });
});
