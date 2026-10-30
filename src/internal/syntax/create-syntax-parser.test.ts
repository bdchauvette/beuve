import { describe } from 'vitest';

import { createSyntaxParser } from './create-syntax-parser.ts';
import type { SyntaxNode } from './syntax-node.ts';
import { test } from './testing/test.ts';

describe('createSyntaxParser', () => {
  test('parses TypeScript, TSX and JavaScript by path', async ({ expect }) => {
    const parser = createSyntaxParser();
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

    expect(typescript).toStrictEqual({ ok: true, value: ['function_declaration'] });
    expect(tsx.ok && tsx.value.language).toBe('tsx');
    expect(tsx.ok && tsx.value.types).toContain('jsx_self_closing_element');
    expect(javascript).toStrictEqual({ ok: true, value: ['javascript', 'A'] });
  });

  test('reports positions and syntax errors without failing', async ({ expect }) => {
    const parser = createSyntaxParser();
    const parsed = await parser.parse('a.ts', '\n\nfunction (', (root) => ({
      hasError: root.hasError,
      start: root.namedChildren[0]?.startPosition,
    }));
    expect(parsed).toStrictEqual({
      ok: true,
      value: { hasError: true, start: { row: 2, column: 0 } },
    });
  });

  test('refuses unsupported and oversized sources', async ({ expect }) => {
    const parser = createSyntaxParser();
    const small = createSyntaxParser({ maxSourceLength: 4 });
    await expect(parser.parse('notes.md', '# hi', () => 1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unsupported-language', path: 'notes.md' },
    });
    await expect(small.parse('a.ts', 'let a = 1;', () => 1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'too-large', length: 10, limit: 4 },
    });
  });

  test('loads grammars from a wasm directory and reports missing ones', async ({
    expect,
    wasmDirectory,
  }) => {
    const copied = createSyntaxParser({ wasmDirectory });
    await expect(copied.parse('a.ts', 'let a = 1;', (root) => root.type)).resolves.toStrictEqual({
      ok: true,
      value: 'program',
    });
    const missing = await copied.parse('a.js', 'let a = 1;', (root) => root.type);
    expect(missing.ok ? undefined : missing.error.kind).toBe('load-failed');
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
