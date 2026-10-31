import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

/**
 * Whether something other than the function itself dictates its parameters (ADR 0086): it is
 * passed straight to a call or `new` (a `String.replaceAll` replacer, a `.map` callback), or it
 * is the value of an explicitly typed binding: a variable declarator or class property with a
 * type annotation, the operand of `satisfies`, or a property of an object literal that is one of
 * those. Only a function or arrow expression can be dictated; a declaration names its own.
 */
export function isSignatureDictated(node: TSESTree.Node): boolean {
  if (
    node.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
    node.type !== AST_NODE_TYPES.FunctionExpression
  ) {
    return false;
  }
  const { parent } = node;
  if (parent.type === AST_NODE_TYPES.Property && parent.value === node) {
    return isTypedValue(parent.parent);
  }
  return isCallArgument(node) || isTypedValue(node);
}

function isCallArgument(node: TSESTree.Node): boolean {
  const { parent } = node;
  return (
    (parent?.type === AST_NODE_TYPES.CallExpression ||
      parent?.type === AST_NODE_TYPES.NewExpression) &&
    parent.arguments.some((argument) => argument === node)
  );
}

/** Whether `node` is the value of an annotated declarator or class property, or `satisfies` one. */
function isTypedValue(node: TSESTree.Node): boolean {
  const { parent } = node;
  switch (parent?.type) {
    case AST_NODE_TYPES.VariableDeclarator: {
      return parent.init === node && parent.id.typeAnnotation !== undefined;
    }
    case AST_NODE_TYPES.PropertyDefinition: {
      return parent.value === node && parent.typeAnnotation !== undefined;
    }
    case AST_NODE_TYPES.TSSatisfiesExpression: {
      return parent.expression === node;
    }
    default: {
      return false;
    }
  }
}
