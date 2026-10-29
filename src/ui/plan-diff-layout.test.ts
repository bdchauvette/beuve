import { describe, expect, it } from 'vitest';

import { minimumSplitWidth } from './minimum-split-width.ts';
import { planDiffLayout } from './plan-diff-layout.ts';

describe('planDiffLayout', () => {
  it('splits modifications and renames by default', () => {
    expect(planDiffLayout('modified', 'split', 1400)).toEqual({
      style: 'split',
      reason: 'preference',
    });
    expect(planDiffLayout('renamed', 'split', undefined)).toEqual({
      style: 'split',
      reason: 'preference',
    });
    expect(planDiffLayout('copied', 'split', minimumSplitWidth).style).toBe('split');
  });

  it('shows new and deleted files full width, in one column', () => {
    for (const status of ['added', 'deleted'] as const) {
      expect(planDiffLayout(status, 'split', 1400)).toEqual({
        style: 'unified',
        reason: 'single-sided',
      });
      expect(planDiffLayout(status, 'unified', 600).reason).toBe('single-sided');
    }
  });

  it('follows an inline preference', () => {
    expect(planDiffLayout('modified', 'unified', 1400)).toEqual({
      style: 'unified',
      reason: 'preference',
    });
  });

  it('falls back to inline while the stream is too narrow for two columns', () => {
    expect(planDiffLayout('modified', 'split', minimumSplitWidth - 1)).toEqual({
      style: 'unified',
      reason: 'narrow',
    });
    expect(planDiffLayout('modified', 'unified', 400).reason).toBe('preference');
  });
});
