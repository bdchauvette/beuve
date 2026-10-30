import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { minimumSplitWidth } from './minimum-split-width.ts';
import { planDiffLayout } from './plan-diff-layout.ts';

describe('planDiffLayout', () => {
  test('splits modifications and renames by default', ({ expect }) => {
    expect(planDiffLayout('modified', 'split', 1400)).toStrictEqual({
      style: 'split',
      reason: 'preference',
    });
    expect(planDiffLayout('renamed', 'split', undefined)).toStrictEqual({
      style: 'split',
      reason: 'preference',
    });
    expect(planDiffLayout('copied', 'split', minimumSplitWidth).style).toBe('split');
  });

  test('shows new and deleted files full width, in one column', ({ expect }) => {
    for (const status of ['added', 'deleted'] as const) {
      expect(planDiffLayout(status, 'split', 1400)).toStrictEqual({
        style: 'unified',
        reason: 'single-sided',
      });
      expect(planDiffLayout(status, 'unified', 600).reason).toBe('single-sided');
    }
  });

  test('follows an inline preference', ({ expect }) => {
    expect(planDiffLayout('modified', 'unified', 1400)).toStrictEqual({
      style: 'unified',
      reason: 'preference',
    });
  });

  test('falls back to inline while the stream is too narrow for two columns', ({ expect }) => {
    expect(planDiffLayout('modified', 'split', minimumSplitWidth - 1)).toStrictEqual({
      style: 'unified',
      reason: 'narrow',
    });
    expect(planDiffLayout('modified', 'unified', 400).reason).toBe('preference');
  });
});
