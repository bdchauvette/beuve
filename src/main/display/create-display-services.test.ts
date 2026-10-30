import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { createDisplayServices } from './create-display-services.ts';
import { test } from '../testing/test.ts';

describe('createDisplayServices', () => {
  test('defaults to split, whitespace shown, the sidebar right and generated files collapsed, and persists changes beside other keys', async ({
    expect,
    tempDir,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(file, JSON.stringify({ preferredEditor: 'zed', diffLayout: 'diagonal' }));
    const display = createDisplayServices(file);
    await expect(display.get()).resolves.toStrictEqual({
      ok: true,
      value: {
        layout: 'split',
        ignoreWhitespace: false,
        sidebarSide: 'right',
        showGenerated: false,
        showInsights: true,
        reviewOrder: 'path',
      },
    });
    await expect(display.set({ layout: 'unified' })).resolves.toStrictEqual({
      ok: true,
      value: {
        layout: 'unified',
        ignoreWhitespace: false,
        sidebarSide: 'right',
        showGenerated: false,
        showInsights: true,
        reviewOrder: 'path',
      },
    });
    await display.set({ ignoreWhitespace: true });
    await display.set({ sidebarSide: 'left' });
    await display.set({ showGenerated: true });
    await display.set({ showInsights: false });
    await display.set({ reviewOrder: 'imports' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({
      preferredEditor: 'zed',
      diffLayout: 'unified',
      ignoreWhitespace: true,
      sidebarSide: 'left',
      showGenerated: true,
      showInsights: false,
      reviewOrder: 'imports',
    });
    await expect(createDisplayServices(file).get()).resolves.toStrictEqual({
      ok: true,
      value: {
        layout: 'unified',
        ignoreWhitespace: true,
        sidebarSide: 'left',
        showGenerated: true,
        showInsights: false,
        reviewOrder: 'imports',
      },
    });
  });

  test('remembers in memory without a file', async ({ expect }) => {
    const display = createDisplayServices();
    await display.set({ ignoreWhitespace: true });
    await expect(display.get()).resolves.toStrictEqual({
      ok: true,
      value: {
        layout: 'split',
        ignoreWhitespace: true,
        sidebarSide: 'right',
        showGenerated: false,
        showInsights: true,
        reviewOrder: 'path',
      },
    });
  });
});
