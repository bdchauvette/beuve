import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { formatReleaseNotes } from './format-release-notes.ts';
import type { ReleaseNotesInput } from './format-release-notes.ts';

function base(): Omit<ReleaseNotesInput, 'commits'> {
  return { repository: 'o/r', version: '1.2.0', previousTag: 'v1.1.0' };
}

describe('formatReleaseNotes', () => {
  test('groups conventional commits in a fixed order and puts the rest under other changes', ({
    expect,
  }) => {
    const notes = formatReleaseNotes({
      ...base(),
      commits: [
        { hash: 'a1', subject: 'docs: explain' },
        { hash: 'b2', subject: 'fix(git)!: stop eating refs' },
        { hash: 'c3', subject: 'feat(ui): chips' },
        { hash: 'd4', subject: 'Merge something odd' },
        { hash: 'e5', subject: 'chore(cask): beuve 1.1.0' },
        { hash: 'f6', subject: 'ci: matrix' },
      ],
    });
    const headings = Array.from(notes.matchAll(/^## (.+)$/gm), (match) => match[1]);
    expect(headings).toStrictEqual([
      'Features',
      'Fixes',
      'Documentation',
      'Other changes',
      'Install',
    ]);
    expect(notes).toContain('- **ui:** chips (c3)');
    expect(notes).toContain('- **BREAKING** **git:** stop eating refs (b2)');
    expect(notes).toContain('- Merge something odd (d4)');
    expect(notes).not.toContain('chore(cask)');
    expect(notes).not.toContain('(e5)');
    expect(notes).toContain('- ci: matrix (f6)');
    expect(notes).toContain('https://github.com/o/r/compare/v1.1.0...v1.2.0');
  });

  test('says so when there are no changes, and marks a first release', ({ expect }) => {
    const notes = formatReleaseNotes({ ...base(), previousTag: undefined, commits: [] });
    expect(notes).toContain('No user-facing changes.');
    expect(notes).toContain('First release.');
  });
});
