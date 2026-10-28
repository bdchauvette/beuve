const names = [
  'file',
  'module',
  'namespace',
  'package',
  'class',
  'method',
  'property',
  'field',
  'constructor',
  'enum',
  'interface',
  'function',
  'variable',
  'constant',
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'key',
  'null',
  'enum-member',
  'struct',
  'event',
  'operator',
  'type-parameter',
] as const;

/** LSP `SymbolKind` (1–26) as a lowercase word; unknown kinds are `unknown`. */
export function symbolKindName(kind: number): string {
  return names[kind - 1] ?? 'unknown';
}
