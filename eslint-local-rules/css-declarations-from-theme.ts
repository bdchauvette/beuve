import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

import type { CssDeclaration } from './css-declarations-from.ts';
import { isCodemirrorThemeCall } from './is-codemirror-theme-call.ts';

/** A declaration of a CodeMirror theme spec and the string literal that holds its value. */
export interface ThemeDeclaration extends CssDeclaration {
  readonly node: TSESTree.Node;
}

/**
 * The declarations of a CodeMirror theme spec, when `node` is a call of `EditorView.theme` or
 * `EditorView.baseTheme` with an object literal (ADR 0162): every `camelCase` key with a string or
 * number value, under any selector or `@media` key, as its `kebab-case` CSS property. Values that
 * aren't literals are left out. `undefined` for any other call.
 */
export function cssDeclarationsFromTheme(
  node: TSESTree.CallExpression,
): ThemeDeclaration[] | undefined {
  const [spec] = node.arguments;
  if (!isCodemirrorThemeCall(node) || spec?.type !== AST_NODE_TYPES.ObjectExpression) {
    return undefined;
  }
  const declarations: ThemeDeclaration[] = [];
  const visit = (object: TSESTree.ObjectExpression): void => {
    for (const property of object.properties) {
      if (property.type !== AST_NODE_TYPES.Property) {
        continue;
      }
      const { value } = property;
      if (value.type === AST_NODE_TYPES.ObjectExpression) {
        visit(value);
        continue;
      }
      const key = keyOf(property);
      if (key !== undefined && value.type === AST_NODE_TYPES.Literal && value.value !== null) {
        declarations.push({
          property: cssPropertyFrom(key),
          value: String(value.value),
          node: value,
        });
      }
    }
  };
  visit(spec);
  return declarations;
}

function keyOf(property: TSESTree.Property): string | undefined {
  const { key } = property;
  if (key.type === AST_NODE_TYPES.Identifier && !property.computed) {
    return key.name;
  }
  if (key.type === AST_NODE_TYPES.Literal && typeof key.value === 'string') {
    return key.value;
  }
  return undefined;
}

/** `borderInlineStart` → `border-inline-start`; a custom property (`--x`) stays as it is. */
function cssPropertyFrom(key: string): string {
  if (key.startsWith('--')) {
    return key;
  }
  return key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}
