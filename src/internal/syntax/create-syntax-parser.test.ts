import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSyntaxParser } from './create-syntax-parser.ts';
import { listWasmAssets } from './list-wasm-assets.ts';
import type { SyntaxNode } from './syntax-node.ts';

describe('createSyntaxParser', () => {
  const parser = createSyntaxParser();

  it('parses TypeScript, TSX and JavaScript by path', async () => {
    const typescript = await parser.parse('a.ts', 'function f(a: number): void {}', (root) =>
      root.namedChildren.map((node) => node.type),
    );
    const tsx = await parser.parse('a.tsx', 'const x = <div a={1} />;', (root, language) => ({
      language,
      hasJsx: root.text.includes('<div'),
      types: shape(root),
    }));
    const javascript = await parser.parse('a.mjs', 'class A { m() {} }', (root, language) => [
      language,
      root.namedChildren[0]?.childForFieldName('name')?.text,
    ]);

    expect(typescript).toEqual({ ok: true, value: ['function_declaration'] });
    expect(tsx.ok && tsx.value.language).toBe('tsx');
    expect(tsx.ok && tsx.value.types).toContain('jsx_self_closing_element');
    expect(javascript).toEqual({ ok: true, value: ['javascript', 'A'] });
  });

  it('reports positions and syntax errors without failing', async () => {
    const parsed = await parser.parse('a.ts', '\n\nfunction (', (root) => ({
      hasError: root.hasError,
      start: root.namedChildren[0]?.startPosition,
    }));
    expect(parsed).toEqual({ ok: true, value: { hasError: true, start: { row: 2, column: 0 } } });
  });

  it('refuses unsupported and oversized sources', async () => {
    const small = createSyntaxParser({ maxSourceLength: 4 });
    expect(await parser.parse('notes.md', '# hi', () => 1)).toEqual({
      ok: false,
      error: { kind: 'unsupported-language', path: 'notes.md' },
    });
    expect(await small.parse('a.ts', 'let a = 1;', () => 1)).toEqual({
      ok: false,
      error: { kind: 'too-large', length: 10, limit: 4 },
    });
  });

  describe('with a wasm directory', () => {
    let directory = '';

    beforeAll(async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'beuve-wasm-'));
      for (const asset of listWasmAssets()) {
        if (asset.language !== 'javascript') {
          await copyFile(asset.sourcePath, path.join(directory, asset.fileName));
        }
      }
    });

    afterAll(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    it('loads grammars from it and reports missing ones', async () => {
      const copied = createSyntaxParser({ wasmDirectory: directory });
      expect(await copied.parse('a.ts', 'let a = 1;', (root) => root.type)).toEqual({
        ok: true,
        value: 'program',
      });
      const missing = await copied.parse('a.js', 'let a = 1;', (root) => root.type);
      expect(missing.ok ? undefined : missing.error.kind).toBe('load-failed');
    });
  });
});

function shape(root: SyntaxNode): string[] {
  const types: string[] = [];
  const stack: SyntaxNode[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    types.push(node.type);
    stack.push(...node.children);
  }
  return types;
}
