import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

import { isSignatureDictated } from './is-signature-dictated.ts';

type Options = [{ readonly max?: number; readonly countVoidThis?: boolean }];

type MessageIds = 'exceed';

type Counted =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.TSDeclareFunction
  | TSESTree.TSFunctionType;

/**
 * `@typescript-eslint/max-params` (the same options, nodes and count: a leading `this: void` is
 * left out unless `countVoidThis`), except for a function whose parameters something else
 * dictates ({@link isSignatureDictated}): a callback passed as a call argument, such as a
 * `String.replaceAll` replacer, or the value of an explicitly typed binding (ADR 0086).
 */
export const maxParams = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce a maximum number of parameters, except where a callee or a type dictates them',
    },
    schema: [
      {
        type: 'object',
        properties: {
          max: { type: 'integer', minimum: 0 },
          countVoidThis: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ max: 3, countVoidThis: false }],
    messages: {
      exceed:
        '{{name}} has too many parameters ({{count}}). Maximum allowed is {{max}}; take an options object (ADR 0086).',
    },
  },
  create(context, [options]) {
    const max = options.max ?? 3;
    const isVoidThisCounted = options.countVoidThis ?? false;
    const check = (node: Counted): void => {
      if (isSignatureDictated(node)) {
        return;
      }
      let count = node.params.length;
      if (!isVoidThisCounted && isVoidThis(node.params[0])) {
        count -= 1;
      }
      if (count <= max) {
        return;
      }
      context.report({
        node,
        messageId: 'exceed',
        data: { name: nameOf(node, context.sourceCode), count, max },
      });
    };
    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
      TSDeclareFunction: check,
      TSFunctionType: check,
    };
  },
});

function isVoidThis(parameter: TSESTree.Parameter | undefined): boolean {
  return (
    parameter?.type === AST_NODE_TYPES.Identifier &&
    parameter.name === 'this' &&
    parameter.typeAnnotation?.typeAnnotation.type === AST_NODE_TYPES.TSVoidKeyword
  );
}

function nameOf(node: Counted, sourceCode: Readonly<TSESLint.SourceCode>): string {
  if (node.type === AST_NODE_TYPES.TSFunctionType) {
    return 'Function type';
  }
  if (node.type === AST_NODE_TYPES.TSDeclareFunction) {
    return `Function '${node.id?.name ?? ''}'`;
  }
  const name = ASTUtils.getFunctionNameWithKind(node, sourceCode);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
