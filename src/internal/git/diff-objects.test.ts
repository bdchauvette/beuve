import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepository } from './testing/create-test-repository.ts';
import type { TestRepository } from './testing/create-test-repository.ts';
import { diffObjects } from './diff-objects.ts';
import { openRepository } from './open-repository.ts';
import type { GitRepository } from './open-repository.ts';

describe('diffObjects', () => {
  let repo: TestRepository;
  let git: GitRepository;
  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  it('diffs two commits into parsed files with patch text', async () => {
    repo.write('kept.txt', 'one\ntwo\n');
    repo.write('space name.txt', 'x\n');
    const from = repo.commit('from');
    repo.write('kept.txt', 'one\nTWO\n');
    repo.write('space name.txt', 'y\n');
    const to = repo.commit('to');
    const result = await diffObjects(git, from, to);
    expect(result).toMatchObject({
      ok: true,
      value: [
        { status: 'modified', path: 'kept.txt', hunks: [{ oldStart: 1, newStart: 1 }] },
        { status: 'modified', path: 'space name.txt' },
      ],
    });
    if (result.ok) {
      expect(result.value[0]?.patch.startsWith('diff --git a/kept.txt b/kept.txt\n')).toBe(true);
    }
  });

  it('ignores all whitespace on request, keeping head line numbers', async () => {
    repo.write('code.py', 'a\nif x:\n  y=1\nz\n');
    repo.write('spaces.txt', 'one\n');
    const from = repo.commit('from');
    repo.write('code.py', 'a\nif x:\n    y = 1\nz\nnew\n');
    repo.write('spaces.txt', 'one   \n');
    const to = repo.commit('to');
    const shown = await diffObjects(git, from, to);
    expect(shown).toMatchObject({ ok: true, value: [{ path: 'code.py' }, { path: 'spaces.txt' }] });
    const ignored = await diffObjects(git, from, to, { ignoreWhitespace: true });
    expect(ignored).toMatchObject({
      ok: true,
      value: [{ path: 'code.py', hunks: [{ newStart: 2, newCount: 4 }] }],
    });
    if (!ignored.ok) {
      return;
    }

    expect(ignored.value).toHaveLength(1);
    expect(ignored.value[0]?.hunks[0]?.lines.filter((line) => line.kind !== 'context')).toEqual([
      { kind: 'added', content: 'new', newLine: 5, noNewline: false },
    ]);
  });

  it('limits to literal paths and controls context', async () => {
    repo.write('a.txt', '1\n2\n3\n4\n5\n');
    repo.write('*.txt', 'star\n');
    const from = repo.commit('from');
    repo.write('a.txt', '1\n2\nthree\n4\n5\n');
    repo.write('*.txt', 'STAR\n');
    const to = repo.commit('to');
    const result = await diffObjects(git, from, to, { paths: ['*.txt'], contextLines: 0 });
    expect(result).toMatchObject({ ok: true, value: [{ path: '*.txt' }] });
    const narrow = await diffObjects(git, from, to, { paths: ['a.txt'], contextLines: 0 });
    expect(narrow).toMatchObject({ ok: true, value: [{ hunks: [{ oldStart: 3, oldCount: 1 }] }] });
    await expect(diffObjects(git, from, to, { contextLines: -1 })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
  });

  it('never runs textconv or external diff programs from repository config', async () => {
    const marker = path.join(repo.scratch(), 'ran');
    const program = path.join(repo.scratch(), 'program');
    writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\necho converted\n`);
    chmodSync(program, 0o755);
    repo.write('.gitattributes', '*.txt diff=evil\n');
    repo.write('a.txt', 'before\n');
    const from = repo.commit('from');
    repo.write('a.txt', 'after\n');
    const to = repo.commit('to');
    repo.git('config', 'diff.evil.textconv', program);
    repo.git('config', 'diff.external', program);
    const result = await diffObjects(git, from, to);
    expect(result).toMatchObject({
      ok: true,
      value: [{ hunks: [{ lines: [{ content: 'before' }, { content: 'after' }] }] }],
    });
    expect(existsSync(marker)).toBe(false);
  });
});
