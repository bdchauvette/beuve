import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'nameTheType';

/** A node that has parameters and a return type. */
export type SignatureNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.TSCallSignatureDeclaration
  | TSESTree.TSConstructorType
  | TSESTree.TSConstructSignatureDeclaration
  | TSESTree.TSDeclareFunction
  | TSESTree.TSEmptyBodyFunctionExpression
  | TSESTree.TSFunctionType
  | TSESTree.TSMethodSignature;

const signatureSelector = [
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'TSCallSignatureDeclaration',
  'TSConstructorType',
  'TSConstructSignatureDeclaration',
  'TSDeclareFunction',
  'TSEmptyBodyFunctionExpression',
  'TSFunctionType',
  'TSMethodSignature',
].join(', ');

/**
 * Bans object type literals anywhere in a function's parameter types or return type, nested ones
 * (`Promise<{ … }>`, `(event: { … }) => void`) included. Name the type with an interface or a
 * type alias, so callers and errors can refer to it.
 */
export const noInlineObjectTypeInSignature = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Forbid inline object types in function signatures' },
    schema: [],
    messages: {
      nameTheType:
        'Name this object type with an `interface` or `type` alias instead of writing it inline in a signature.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const reported = new Set<TSESTree.Node>();

    return {
      [signatureSelector](node: SignatureNode): void {
        for (const root of signatureTypeRoots(node)) {
          for (const literal of typeLiteralsIn(root, sourceCode)) {
            if (reported.has(literal)) {
              continue;
            }

            reported.add(literal);
            context.report({ node: literal, messageId: 'nameTheType' });
          }
        }
      },
    };
  },
});

function signatureTypeRoots(node: SignatureNode): TSESTree.Node[] {
  const roots: TSESTree.Node[] = [];
  for (const parameter of node.params) {
    const annotation = parameterAnnotation(parameter);
    if (annotation !== undefined) {
      roots.push(annotation);
    }
  }
  if (node.returnType !== undefined) {
    roots.push(node.returnType);
  }
  return roots;
}

function parameterAnnotation(start: TSESTree.Node): TSESTree.TSTypeAnnotation | undefined {
  let parameter = start;
  for (;;) {
    if (parameter.type === AST_NODE_TYPES.AssignmentPattern) {
      parameter = parameter.left;
    } else if (parameter.type === AST_NODE_TYPES.TSParameterProperty) {
      parameter = parameter.parameter;
    } else {
      break;
    }
  }
  switch (parameter.type) {
    case AST_NODE_TYPES.Identifier:
    case AST_NODE_TYPES.ObjectPattern:
    case AST_NODE_TYPES.ArrayPattern:
    case AST_NODE_TYPES.RestElement: {
      return parameter.typeAnnotation;
    }
    default: {
      return undefined;
    }
  }
}

function typeLiteralsIn(
  root: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.TSTypeLiteral[] {
  const found: TSESTree.TSTypeLiteral[] = [];
  const visit = (node: TSESTree.Node): void => {
    if (node.type === AST_NODE_TYPES.TSTypeLiteral) {
      found.push(node);
    }
    const keys = sourceCode.visitorKeys[node.type] ?? [];
    for (const key of keys) {
      const child: unknown = (node as unknown as Record<string, unknown>)[key];
      const items: unknown[] = Array.isArray(child) ? child : [child];
      for (const item of items) {
        if (isNode(item)) {
          visit(item);
        }
      }
    }
  };
  visit(root);
  return found;
}

function isNode(value: unknown): value is TSESTree.Node {
  return typeof value === 'object' && value !== null && 'type' in value;
}
