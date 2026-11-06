import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { defaultReviewQueuePrefs } from '#contract/default-review-queue-prefs.ts';

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
        showDiagnostics: true,
        reviewOrder: 'path',
        skipReviewed: false,
        reviewQueue: defaultReviewQueuePrefs,
        reviewQueueBranchPrefixes: ['claude/'],
        fontFamilyMono: '',
        fontFamilySans: '',
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
        showDiagnostics: true,
        reviewOrder: 'path',
        skipReviewed: false,
        reviewQueue: defaultReviewQueuePrefs,
        reviewQueueBranchPrefixes: ['claude/'],
        fontFamilyMono: '',
        fontFamilySans: '',
      },
    });
    await display.set({ ignoreWhitespace: true });
    await display.set({ sidebarSide: 'left' });
    await display.set({ showGenerated: true });
    await display.set({ showInsights: false });
    await display.set({ reviewOrder: 'imports' });
    await display.set({ skipReviewed: true });
    await display.set({ fontFamilyMono: ' "JetBrains Mono", monospace ' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({
      preferredEditor: 'zed',
      diffLayout: 'unified',
      ignoreWhitespace: true,
      sidebarSide: 'left',
      showGenerated: true,
      showInsights: false,
      showDiagnostics: true,
      reviewOrder: 'imports',
      skipReviewed: true,
      reviewQueue: defaultReviewQueuePrefs,
      reviewQueueBranchPrefixes: ['claude/'],
      fontFamilyMono: '"JetBrains Mono", monospace',
      fontFamilySans: '',
    });
    await expect(createDisplayServices(file).get()).resolves.toStrictEqual({
      ok: true,
      value: {
        layout: 'unified',
        ignoreWhitespace: true,
        sidebarSide: 'left',
        showGenerated: true,
        showInsights: false,
        showDiagnostics: true,
        reviewOrder: 'imports',
        skipReviewed: true,
        reviewQueue: defaultReviewQueuePrefs,
        reviewQueueBranchPrefixes: ['claude/'],
        fontFamilyMono: '"JetBrains Mono", monospace',
        fontFamilySans: '',
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
        showDiagnostics: true,
        reviewOrder: 'path',
        skipReviewed: false,
        reviewQueue: defaultReviewQueuePrefs,
        reviewQueueBranchPrefixes: ['claude/'],
        fontFamilyMono: '',
        fontFamilySans: '',
      },
    });
  });

  test('keeps the review queue preferences and branch prefixes, dropping malformed ones', async ({
    expect,
    tempDir,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({ reviewQueue: { sort: 'sideways' }, reviewQueueBranchPrefixes: 'claude/' }),
    );
    const display = createDisplayServices(file);
    await expect(display.get()).resolves.toMatchObject({
      value: { reviewQueue: defaultReviewQueuePrefs, reviewQueueBranchPrefixes: ['claude/'] },
    });
    const reviewQueue = {
      ...defaultReviewQueuePrefs,
      sort: 'largest',
      group: 'repository',
    } as const;
    await display.set({
      reviewQueue,
      reviewQueueBranchPrefixes: [' agent/ ', 'agent/', '../x', 'codex/'],
    });
    await expect(createDisplayServices(file).get()).resolves.toMatchObject({
      value: { reviewQueue, reviewQueueBranchPrefixes: ['agent/', 'codex/'] },
    });
    await display.set({ reviewQueueBranchPrefixes: [] });
    await expect(display.get()).resolves.toMatchObject({
      value: { reviewQueueBranchPrefixes: [] },
    });
  });

  test('reads a stored font that is not a font-family list as none', async ({
    expect,
    tempDir,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({ fontFamilyMono: 'Menlo; color: red', fontFamilySans: 'Inter, sans-serif' }),
    );
    await expect(createDisplayServices(file).get()).resolves.toMatchObject({
      value: { fontFamilyMono: '', fontFamilySans: 'Inter, sans-serif' },
    });
  });
});
