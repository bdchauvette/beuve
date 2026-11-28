import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

/** Whether `node` calls `EditorView.theme` or `EditorView.baseTheme`, whose spec is CSS (ADR 0162). */
export function isCodemirrorThemeCall(node: TSESTree.CallExpression): boolean {
  const { callee } = node;
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'EditorView' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    (callee.property.name === 'theme' || callee.property.name === 'baseTheme')
  );
}
