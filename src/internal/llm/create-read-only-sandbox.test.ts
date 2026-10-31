import { describe } from 'vitest';

import { createReadOnlySandbox } from './create-read-only-sandbox.ts';
import { createMemoryTree } from './testing/create-memory-tree.ts';
import type { MemoryEntry } from './testing/create-memory-tree.ts';
import { test } from './testing/test.ts';

/** A commit's tree with a few files; `extra` adds or replaces entries. */
function tree(
  extra: Readonly<Record<string, MemoryEntry>> = {},
): ReturnType<typeof createMemoryTree> {
  return createMemoryTree({
    'src/a.ts': 'const a = 1;\nexport function validate(x) {\n  return x;\n}\n',
    'src/deep/b.ts': 'validate(2);\n',
    'README.md': 'Call VALIDATE( first.\n',
    'logo.png': Uint8Array.from([0x89, 0x50, 0, 1]),
    ...extra,
  });
}

describe('createReadOnlySandbox', () => {
  test('reads a file with line numbers, a range of it, and caps the lines', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(tree(), { maxLines: 2 });
    await expect(
      sandbox.run({
        name: 'read_file',
        arguments: '{"path":"src/a.ts","start_line":2,"end_line":3}',
      }),
    ).resolves.toStrictEqual({
      output: '2\texport function validate(x) {\n3\t  return x;',
      denied: false,
    });
    const capped = await sandbox.run({ name: 'read_file', arguments: '{"path":"src/a.ts"}' });
    expect(capped.output).toBe(
      '1\tconst a = 1;\n2\texport function validate(x) {\n[lines 3-5 not shown]',
    );
  });

  test('cuts a file at the byte limit and refuses binary files', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(tree(), { maxFileBytes: 8 });
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"src/a.ts"}' }),
    ).resolves.toStrictEqual({
      output: '1\tconst a \n[cut at 8 bytes]',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"logo.png"}' }),
    ).resolves.toStrictEqual({
      output: 'not a readable text file: logo.png',
      denied: false,
    });
  });

  test('refuses a file larger than the read limit without reading it', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(tree({ 'big.txt': 'x'.repeat(100) }), {
      maxBlobBytes: 64,
    });
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"big.txt"}' }),
    ).resolves.toStrictEqual({
      output: 'not a readable text file: big.txt',
      denied: false,
    });
  });

  test('detects binary content past the first bytes, within what is shown', async ({ expect }) => {
    const late = Buffer.concat([Buffer.from('a'.repeat(9000)), Buffer.from([0])]);
    const sandbox = createReadOnlySandbox(tree({ 'late.bin': late }));
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"late.bin"}' }),
    ).resolves.toStrictEqual({
      output: 'not a readable text file: late.bin',
      denied: false,
    });
  });

  test.for([
    ['../secret.txt', 'refused: ../secret.txt is outside the working directory'],
    ['src/../../secret.txt', 'refused: src/../../secret.txt is outside the working directory'],
    ['/etc/passwd', 'refused: /etc/passwd is outside the working directory'],
    ['escape', 'refused: escape links outside the working directory'],
    ['absolute', 'refused: absolute links outside the working directory'],
    [
      'src/escape-dir/secret.txt',
      'refused: src/escape-dir/secret.txt links outside the working directory',
    ],
    ['loop', 'refused: loop has too many links'],
  ] as const)('refuses %s', async ([requested, output], { expect }) => {
    const sandbox = createReadOnlySandbox(
      tree({
        escape: { link: '../secret.txt' },
        absolute: { link: '/etc/passwd' },
        'src/escape-dir': { link: '../..' },
        loop: { link: 'loop' },
      }),
    );
    await expect(
      sandbox.run({ name: 'read_file', arguments: JSON.stringify({ path: requested }) }),
    ).resolves.toStrictEqual({ output, denied: true });
  });

  test('follows links that stay inside the tree, in any component', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(
      tree({ 'alias.ts': { link: 'src/a.ts' }, 'lib/source': { link: '../src' } }),
    );
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"alias.ts","end_line":1}' }),
    ).resolves.toStrictEqual({ output: '1\tconst a = 1;', denied: false });
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"lib/source/deep/b.ts"}' }),
    ).resolves.toStrictEqual({ output: '1\tvalidate(2);\n2\t', denied: false });
    await expect(
      sandbox.run({ name: 'grep', arguments: '{"pattern":"validate(","path":"lib/source/deep"}' }),
    ).resolves.toStrictEqual({
      output: 'src/deep/b.ts:1: validate(2);',
      denied: false,
    });
  });

  test('says not found for untracked paths and refuses directories as files', async ({
    expect,
  }) => {
    const sandbox = createReadOnlySandbox(tree());
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"SRC/a.ts"}' }),
    ).resolves.toStrictEqual({
      output: 'not found: SRC/a.ts',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"src/a.ts/x"}' }),
    ).resolves.toStrictEqual({
      output: 'not found: src/a.ts/x',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"src"}' }),
    ).resolves.toStrictEqual({
      output: 'not a readable text file: src',
      denied: false,
    });
  });

  test('greps a fixed string, skipping binaries and links', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(tree({ 'outside.md': { link: 'validate( link' } }));
    await expect(
      sandbox.run({ name: 'grep', arguments: '{"pattern":"validate("}' }),
    ).resolves.toStrictEqual({
      output: 'src/a.ts:2: export function validate(x) {\nsrc/deep/b.ts:1: validate(2);',
      denied: false,
    });
    await expect(
      sandbox.run({
        name: 'grep',
        arguments: '{"pattern":"validate(","ignore_case":true,"glob":"*.md"}',
      }),
    ).resolves.toStrictEqual({ output: 'README.md:1: Call VALIDATE( first.', denied: false });
    await expect(
      sandbox.run({ name: 'grep', arguments: '{"pattern":"(a+)+$"}' }),
    ).resolves.toStrictEqual({
      output: 'no matches',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'grep', arguments: '{"pattern":"x","path":"../"}' }),
    ).resolves.toMatchObject({
      denied: true,
    });
  });

  test('caps grep matches and glob paths', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(tree(), { maxMatches: 1, maxPaths: 1 });
    await expect(
      sandbox.run({ name: 'grep', arguments: '{"pattern":"validate("}' }),
    ).resolves.toStrictEqual({
      output: 'src/a.ts:2: export function validate(x) {\n[stopped at 1 matches]',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'glob', arguments: '{"pattern":"**/*.ts"}' }),
    ).resolves.toStrictEqual({
      output: 'src/a.ts\n[stopped at 1 paths]',
      denied: false,
    });
  });

  test('globs tracked files in git order, leaving links out', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(tree({ 'src/link.ts': { link: 'a.ts' } }));
    await expect(
      sandbox.run({ name: 'glob', arguments: '{"pattern":"src/**/*.ts"}' }),
    ).resolves.toStrictEqual({
      output: 'src/a.ts\nsrc/deep/b.ts',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'glob', arguments: '{"pattern":"*.{md,png}"}' }),
    ).resolves.toStrictEqual({
      output: 'README.md\nlogo.png',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'glob', arguments: `{"pattern":"${'*'.repeat(20)}"}` }),
    ).resolves.toStrictEqual({
      output: 'invalid arguments: at most 12 wildcards',
      denied: false,
    });
  });

  test('matches regex metacharacters in a glob literally', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(
      tree({ 'a(1)+b.txt': 'x\n', 'a1b.txt': 'x\n', 'a1bb.txt': 'x\n' }),
    );
    await expect(
      sandbox.run({ name: 'glob', arguments: '{"pattern":"a(1)+b.txt"}' }),
    ).resolves.toStrictEqual({
      output: 'a(1)+b.txt',
      denied: false,
    });
  });

  test('refuses unknown tools and rejects bad arguments', async ({ expect }) => {
    const sandbox = createReadOnlySandbox(tree());
    await expect(sandbox.run({ name: 'write_file', arguments: '{}' })).resolves.toStrictEqual({
      output: 'refused: there is no tool named write_file',
      denied: true,
    });
    await expect(sandbox.run({ name: 'read_file', arguments: '{' })).resolves.toStrictEqual({
      output: 'invalid arguments: not JSON',
      denied: false,
    });
    await expect(
      sandbox.run({ name: 'read_file', arguments: '{"path":"a","mode":"w"}' }),
    ).resolves.toMatchObject({
      denied: false,
    });
    expect(sandbox.definitions.map((tool) => tool.function.name)).toStrictEqual([
      'read_file',
      'grep',
      'glob',
    ]);
  });
});
