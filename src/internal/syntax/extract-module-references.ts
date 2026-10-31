import type { SyntaxNode } from './syntax-node.ts';

/** How a module is referenced: `static` (`import … from`), `export-from`, `dynamic` (`import()`) or `require`. */
export type ModuleReferenceKind = 'static' | 'export-from' | 'dynamic' | 'require';

/** One module specifier written in a TypeScript or JavaScript source, as written. */
export interface ModuleReference {
  readonly specifier: string;
  readonly kind: ModuleReferenceKind;
  /** `import type …` / `export type … from`: erased at run time. */
  readonly isTypeOnly: boolean;
}

/**
 * The modules a TypeScript, TSX or JavaScript tree refers to: `import … from 'x'`, `import 'x'`,
 * `import x = require('x')`, `export … from 'x'`, `import('x')` and `require('x')` with a string
 * literal, in source order. Computed specifiers are skipped. Call it inside a `parse` callback.
 */
export function extractModuleReferences(root: SyntaxNode): readonly ModuleReference[] {
  const references: ModuleReference[] = [];
  const pending: SyntaxNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    const reference = referenceFrom(node);
    if (reference !== undefined) {
      references.push(reference);
    }
    for (let index = node.namedChildren.length - 1; index >= 0; index -= 1) {
      const child = node.namedChildren[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return references;
}

function referenceFrom(node: SyntaxNode): ModuleReference | undefined {
  switch (node.type) {
    case 'import_statement': {
      const source = node.childForFieldName('source') ?? requireClauseSource(node);
      if (source === undefined) {
        return undefined;
      }
      return makeReference(
        source,
        requireClauseSource(node) === undefined ? 'static' : 'require',
        node,
      );
    }
    case 'export_statement': {
      const source = node.childForFieldName('source');
      if (source === null) {
        return undefined;
      }
      return makeReference(source, 'export-from', node);
    }
    case 'call_expression': {
      return callReference(node);
    }
    default: {
      return undefined;
    }
  }
}

function requireClauseSource(statement: SyntaxNode): SyntaxNode | undefined {
  const clause = statement.namedChildren.find((child) => child.type === 'import_require_clause');
  return clause?.namedChildren.find((child) => child.type === 'string');
}

function callReference(call: SyntaxNode): ModuleReference | undefined {
  const callee = call.childForFieldName('function');
  const argument = call.childForFieldName('arguments')?.namedChildren[0];
  if (callee === null || argument?.type !== 'string') {
    return undefined;
  }
  if (callee.type === 'import') {
    return makeReference(argument, 'dynamic', call);
  }
  if (callee.type === 'identifier' && callee.text === 'require') {
    return makeReference(argument, 'require', call);
  }
  return undefined;
}

function makeReference(
  literal: SyntaxNode,
  kind: ModuleReferenceKind,
  statement: SyntaxNode,
): ModuleReference | undefined {
  const specifier = literal.text.slice(1, -1);
  if (specifier === '') {
    return undefined;
  }
  return {
    specifier,
    kind,
    isTypeOnly: statement.children.some((child) => !child.isNamed && child.type === 'type'),
  };
}
