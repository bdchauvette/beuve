import type { TSESTree } from '@typescript-eslint/utils';

/** One `property: value` pair in a style template, with interpolations as `${…}`. */
export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

/**
 * The declarations in a Lit `css` template, in order. Interpolations are joined in as `${…}` so a
 * value with one stays whole; comments are dropped. Selectors such as `label:first-child` can read
 * as a declaration, which is harmless for rules that look for property names no selector uses.
 */
export function cssDeclarationsFrom(node: TSESTree.TemplateLiteral): CssDeclaration[] {
  const text = node.quasis
    .map((quasi) => {
      return quasi.value.cooked ?? quasi.value.raw;
    })
    .join('${…}')
    .replaceAll(/\/\*[\s\S]*?\*\//gu, ' ');
  const declarations: CssDeclaration[] = [];
  for (const match of text.matchAll(/(?:^|[\s;{])(-{0,2}[a-z][\w-]*)\s*:\s*([^;{}]*)/gu)) {
    const [, property, value] = match;
    if (property !== undefined && value !== undefined) {
      declarations.push({ property, value: value.trim() });
    }
  }
  return declarations;
}
