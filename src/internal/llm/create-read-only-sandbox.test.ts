import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { createReadOnlySandbox } from './create-read-only-sandbox.ts';
import { test } from './testing/test.ts';

/** `<tempDir>/repo` with a few files, and a secret beside it. */
function worktree(tempDir: string): string {
  const root = path.join(tempDir, 'repo');
  mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  mkdirSync(path.join(root, '.git'));
  writeFileSync(
    path.join(root, 'src', 'a.ts'),
    'const a = 1;\nexport function validate(x) {\n  return x;\n}\n',
  );
  writeFileSync(path.join(root, 'src', 'deep', 'b.ts'), 'validate(2);\n');
  writeFileSync(path.join(root, 'README.md'), 'Call VALIDATE( first.\n');
  writeFileSync(path.join(root, '.git', 'config'), 'validate( in git\n');
  writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0, 1]));
  writeFileSync(path.join(tempDir, 'secret.txt'), 'validate( secret\n');
  return root;
}

describe('createReadOnlySandbox', () => {
  test('reads a file with line numbers, a range of it, and caps the lines', async ({
    expect,
    tempDir,
  }) => {
    const sandbox = createReadOnlySandbox(worktree(tempDir), { maxLines: 2 });
    await expect(
      sandbox.run('read_file', '{"path":"src/a.ts","start_line":2,"end_line":3}'),
    ).resolves.toStrictEqual({
      output: '2\texport function validate(x) {\n3\t  return x;',
      denied: false,
    });
    const capped = await sandbox.run('read_file', '{"path":"src/a.ts"}');
    expect(capped.output).toBe(
      '1\tconst a = 1;\n2\texport function validate(x) {\n[lines 3-5 not shown]',
    );
  });

  test('cuts a file at the byte limit and refuses binary files', async ({ expect, tempDir }) => {
    const sandbox = createReadOnlySandbox(worktree(tempDir), { maxFileBytes: 8 });
    await expect(sandbox.run('read_file', '{"path":"src/a.ts"}')).resolves.toStrictEqual({
      output: '1\tconst a \n[cut at 8 bytes]',
      denied: false,
    });
    await expect(sandbox.run('read_file', '{"path":"logo.png"}')).resolves.toStrictEqual({
      output: 'not a readable text file: logo.png',
      denied: false,
    });
  });

  test.for([
    ['../secret.txt', 'refused: ../secret.txt is outside the working directory'],
    ['src/../../secret.txt', 'refused: src/../../secret.txt is outside the working directory'],
    ['/etc/passwd', 'refused: /etc/passwd is outside the working directory'],
    ['escape', 'refused: escape links outside the working directory'],
    [
      'src/escape-dir/secret.txt',
      'refused: src/escape-dir/secret.txt links outside the working directory',
    ],
  ] as const)('refuses %s', async ([requested, output], { expect, tempDir }) => {
    const root = worktree(tempDir);
    symlinkSync(path.join(tempDir, 'secret.txt'), path.join(root, 'escape'));
    symlinkSync(tempDir, path.join(root, 'src', 'escape-dir'));
    const sandbox = createReadOnlySandbox(root);
    await expect(
      sandbox.run('read_file', JSON.stringify({ path: requested })),
    ).resolves.toStrictEqual({ output, denied: true });
  });

  test('reads through a symbolic link that stays inside', async ({ expect, tempDir }) => {
    const root = worktree(tempDir);
    symlinkSync(path.join(root, 'src', 'a.ts'), path.join(root, 'alias.ts'));
    const read = await createReadOnlySandbox(root).run(
      'read_file',
      '{"path":"alias.ts","end_line":1}',
    );
    expect(read).toStrictEqual({ output: '1\tconst a = 1;', denied: false });
  });

  test('greps a fixed string, skipping .git, binaries and links that leave', async ({
    expect,
    tempDir,
  }) => {
    const root = worktree(tempDir);
    symlinkSync(tempDir, path.join(root, 'outside'));
    const sandbox = createReadOnlySandbox(root);
    await expect(sandbox.run('grep', '{"pattern":"validate("}')).resolves.toStrictEqual({
      output: 'src/a.ts:2: export function validate(x) {\nsrc/deep/b.ts:1: validate(2);',
      denied: false,
    });
    await expect(
      sandbox.run('grep', '{"pattern":"validate(","ignore_case":true,"glob":"*.md"}'),
    ).resolves.toStrictEqual({ output: 'README.md:1: Call VALIDATE( first.', denied: false });
    await expect(sandbox.run('grep', '{"pattern":"(a+)+$"}')).resolves.toStrictEqual({
      output: 'no matches',
      denied: false,
    });
    await expect(sandbox.run('grep', '{"pattern":"x","path":"../"}')).resolves.toMatchObject({
      denied: true,
    });
  });

  test('caps grep matches and glob paths', async ({ expect, tempDir }) => {
    const sandbox = createReadOnlySandbox(worktree(tempDir), { maxMatches: 1, maxPaths: 1 });
    await expect(sandbox.run('grep', '{"pattern":"validate("}')).resolves.toStrictEqual({
      output: 'src/a.ts:2: export function validate(x) {\n[stopped at 1 matches]',
      denied: false,
    });
    await expect(sandbox.run('glob', '{"pattern":"**/*.ts"}')).resolves.toStrictEqual({
      output: 'src/a.ts\n[stopped at 1 paths]',
      denied: false,
    });
  });

  test('globs relative paths', async ({ expect, tempDir }) => {
    const sandbox = createReadOnlySandbox(worktree(tempDir));
    await expect(sandbox.run('glob', '{"pattern":"src/**/*.ts"}')).resolves.toStrictEqual({
      output: 'src/a.ts\nsrc/deep/b.ts',
      denied: false,
    });
    await expect(sandbox.run('glob', '{"pattern":"*.{md,png}"}')).resolves.toStrictEqual({
      output: 'logo.png\nREADME.md',
      denied: false,
    });
    await expect(sandbox.run('glob', `{"pattern":"${'*'.repeat(20)}"}`)).resolves.toStrictEqual({
      output: 'invalid arguments: at most 12 wildcards',
      denied: false,
    });
  });

  test('matches regex metacharacters in a glob literally', async ({ expect, tempDir }) => {
    const root = worktree(tempDir);
    writeFileSync(path.join(root, 'a(1)+b.txt'), 'x\n');
    writeFileSync(path.join(root, 'a1b.txt'), 'x\n');
    writeFileSync(path.join(root, 'a1bb.txt'), 'x\n');
    const sandbox = createReadOnlySandbox(root);

    await expect(sandbox.run('glob', '{"pattern":"a(1)+b.txt"}')).resolves.toStrictEqual({
      output: 'a(1)+b.txt',
      denied: false,
    });
  });

  test('refuses unknown tools and rejects bad arguments',async ({ expect, tempDir }) => {
    const sandbox = createReadOnlySandbox(worktree(tempDir));
    await expect(sandbox.run('write_file', '{}')).resolves.toStrictEqual({
      output: 'refused: there is no tool named write_file',
      denied: true,
    });
    await expect(sandbox.run('read_file', '{')).resolves.toStrictEqual({
      output: 'invalid arguments: not JSON',
      denied: false,
    });
    await expect(sandbox.run('read_file', '{"path":"a","mode":"w"}')).resolves.toMatchObject({
      denied: false,
    });
    expect(sandbox.definitions.map((tool) => tool.function.name)).toStrictEqual([
      'read_file',
      'grep',
      'glob',
    ]);
  });
});
