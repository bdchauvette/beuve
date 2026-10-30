import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { diffObjects } from './diff-objects.ts';
import { test } from './testing/test.ts';

describe('diffObjects', () => {
  test('diffs two commits into parsed files with patch text', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('kept.txt', 'one\ntwo\n');
    repo.write('space name.txt', 'x\n');
    const from = await repo.commit('from');
    repo.write('kept.txt', 'one\nTWO\n');
    repo.write('space name.txt', 'y\n');
    const to = await repo.commit('to');
    const result = await diffObjects(git, from, to);
    expect(result).toMatchObject({
      ok: true,
      value: [
        { status: 'modified', path: 'kept.txt', hunks: [{ oldStart: 1, newStart: 1 }] },
        { status: 'modified', path: 'space name.txt' },
      ],
    });
    const resultValue = okValueFrom(result);
    expect(resultValue[0]?.patch.startsWith('diff --git a/kept.txt b/kept.txt\n')).toBe(true);
  });

  test('ignores all whitespace on request, keeping head line numbers', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('code.py', 'a\nif x:\n  y=1\nz\n');
    repo.write('spaces.txt', 'one\n');
    const from = await repo.commit('from');
    repo.write('code.py', 'a\nif x:\n    y = 1\nz\nnew\n');
    repo.write('spaces.txt', 'one   \n');
    const to = await repo.commit('to');
    const shown = await diffObjects(git, from, to);
    expect(shown).toMatchObject({ ok: true, value: [{ path: 'code.py' }, { path: 'spaces.txt' }] });
    const ignored = await diffObjects(git, from, to, { ignoreWhitespace: true });
    expect(ignored).toMatchObject({
      ok: true,
      value: [{ path: 'code.py', hunks: [{ newStart: 2, newCount: 4 }] }],
    });
    const ignoredValue = okValueFrom(ignored);

    expect(ignoredValue).toHaveLength(1);
    expect(
      ignoredValue[0]?.hunks[0]?.lines.filter((line) => line.kind !== 'context'),
    ).toStrictEqual([{ kind: 'added', content: 'new', newLine: 5, noNewline: false }]);
  });

  test('limits to literal paths and controls context', async ({
    expect,
    repo,
    repository: git,
  }) => {
    repo.write('a.txt', '1\n2\n3\n4\n5\n');
    repo.write('*.txt', 'star\n');
    const from = await repo.commit('from');
    repo.write('a.txt', '1\n2\nthree\n4\n5\n');
    repo.write('*.txt', 'STAR\n');
    const to = await repo.commit('to');
    const result = await diffObjects(git, from, to, { paths: ['*.txt'], contextLines: 0 });
    expect(result).toMatchObject({ ok: true, value: [{ path: '*.txt' }] });
    const narrow = await diffObjects(git, from, to, { paths: ['a.txt'], contextLines: 0 });
    expect(narrow).toMatchObject({ ok: true, value: [{ hunks: [{ oldStart: 3, oldCount: 1 }] }] });
    await expect(diffObjects(git, from, to, { contextLines: -1 })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-argument' },
    });
  });

  test('never runs textconv or external diff programs from repository config', async ({
    expect,
    repo,
    repository: git,
  }) => {
    const marker = path.join(repo.scratch(), 'ran');
    const program = path.join(repo.scratch(), 'program');
    writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\necho converted\n`);
    chmodSync(program, 0o755);
    repo.write('.gitattributes', '*.txt diff=evil\n');
    repo.write('a.txt', 'before\n');
    const from = await repo.commit('from');
    repo.write('a.txt', 'after\n');
    const to = await repo.commit('to');
    await repo.git('config', 'diff.evil.textconv', program);
    await repo.git('config', 'diff.external', program);
    const result = await diffObjects(git, from, to);
    expect(result).toMatchObject({
      ok: true,
      value: [{ hunks: [{ lines: [{ content: 'before' }, { content: 'after' }] }] }],
    });
    expect(existsSync(marker)).toBe(false);
  });
});
