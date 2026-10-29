import { describe, expect, it } from 'vitest';

import { formatReleaseNotes } from './format-release-notes.ts';

const headingPattern = /^## (.+)$/gm;
const base = { repository: 'o/r', version: '1.2.0', previousTag: 'v1.1.0' } as const;

describe('formatReleaseNotes', () => {
  it('groups conventional commits in a fixed order and puts the rest under other changes', () => {
    const notes = formatReleaseNotes({
      ...base,
      commits: [
        { hash: 'a1', subject: 'docs: explain' },
        { hash: 'b2', subject: 'fix(git)!: stop eating refs' },
        { hash: 'c3', subject: 'feat(ui): chips' },
        { hash: 'd4', subject: 'Merge something odd' },
        { hash: 'e5', subject: 'chore(cask): beuve 1.1.0' },
        { hash: 'f6', subject: 'ci: matrix' },
      ],
    });
    const headings = Array.from(notes.matchAll(headingPattern), (match) => match[1]);
    expect(headings).toEqual(['Features', 'Fixes', 'Documentation', 'Other changes', 'Install']);
    expect(notes).toContain('- **ui:** chips (c3)');
    expect(notes).toContain('- **BREAKING** **git:** stop eating refs (b2)');
    expect(notes).toContain('- Merge something odd (d4)');
    expect(notes).not.toContain('chore(cask)');
    expect(notes).not.toContain('(e5)');
    expect(notes).toContain('- ci: matrix (f6)');
    expect(notes).toContain('https://github.com/o/r/compare/v1.1.0...v1.2.0');
  });

  it('says so when there are no changes, and marks a first release', () => {
    const notes = formatReleaseNotes({ ...base, previousTag: undefined, commits: [] });
    expect(notes).toContain('No user-facing changes.');
    expect(notes).toContain('First release.');
  });
});
