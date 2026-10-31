import { AST_NODE_TYPES, AST_TOKEN_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'useBlockBody';

const statementNeedsParens = /^(\{|function\b|class\b)/u;
const leadingWhitespace = /^[\t ]*/u;

type Reason = 'multi-line' | 'followed by a comma' | 'not a trivial expression';

/**
 * An arrow function keeps an expression body only when it is trivial: one line, not a list
 * element followed by a comma, and a simple expression (identifier, literal, member chain, call
 * with simple arguments, unary or binary of simple operands, template literal without functions).
 * Anything else gets a block with `return`, or a bare statement when the declared return type is
 * `void` (or `Promise<void>` for an async arrow whose body is an `await`, so no promise is
 * dropped). Lint runs on Prettier output, so a multi-line
 * arrow is one Prettier had to break.
 */
export const arrowBodyBraces = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Require a block body for arrow functions that are not trivial' },
    schema: [],
    fixable: 'code',
    messages: {
      useBlockBody: 'Use a block body: this expression-bodied arrow is {{reason}}.',
    },
  },
  create(context) {
    const { sourceCode } = context;

    return {
      ArrowFunctionExpression(node): void {
        if (node.body.type === AST_NODE_TYPES.BlockStatement) {
          return;
        }
        const reason = reasonForBraces(node, sourceCode);
        if (reason !== undefined) {
          context.report({
            node,
            messageId: 'useBlockBody',
            data: { reason },
            fix: (fixer) => {
              return fixFor(fixer, node, sourceCode);
            },
          });
        }
      },
    };
  },
});

function reasonForBraces(
  node: TSESTree.ArrowFunctionExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): Reason | undefined {
  if (node.loc.start.line !== node.loc.end.line) {
    return 'multi-line';
  }
  const after = sourceCode.getTokenAfter(node);
  if (after?.type === AST_TOKEN_TYPES.Punctuator && after.value === ',') {
    return 'followed by a comma';
  }
  if (isSimple(node.body, true)) {
    return undefined;
  }
  return 'not a trivial expression';
}

function isSimple(start: TSESTree.Node, isAwaitAllowedAtStart: boolean): boolean {
  let node = start;
  let isAwaitAllowed = isAwaitAllowedAtStart;
  for (;;) {
    if (
      node.type === AST_NODE_TYPES.ChainExpression ||
      node.type === AST_NODE_TYPES.TSNonNullExpression ||
      node.type === AST_NODE_TYPES.TSAsExpression ||
      node.type === AST_NODE_TYPES.TSSatisfiesExpression
    ) {
      node = node.expression;
    } else if (
      node.type === AST_NODE_TYPES.UnaryExpression ||
      node.type === AST_NODE_TYPES.SpreadElement
    ) {
      node = node.argument;
      isAwaitAllowed = false;
    } else {
      break;
    }
  }
  switch (node.type) {
    case AST_NODE_TYPES.Identifier:
    case AST_NODE_TYPES.Literal:
    case AST_NODE_TYPES.ThisExpression:
    case AST_NODE_TYPES.Super: {
      return true;
    }
    case AST_NODE_TYPES.TemplateLiteral: {
      return node.expressions.every((expression) => isSimple(expression, false));
    }
    case AST_NODE_TYPES.MemberExpression: {
      return isSimple(node.object, false) && (!node.computed || isSimple(node.property, false));
    }
    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.NewExpression: {
      return isSimple(node.callee, false) && node.arguments.every((a) => isSimple(a, false));
    }
    case AST_NODE_TYPES.BinaryExpression:
    case AST_NODE_TYPES.LogicalExpression: {
      return isSimple(node.left, false) && isSimple(node.right, false);
    }
    case AST_NODE_TYPES.AwaitExpression: {
      return isAwaitAllowed && isSimple(node.argument, false);
    }
    default: {
      return false;
    }
  }
}

function fixFor(
  fixer: TSESLint.RuleFixer,
  node: TSESTree.ArrowFunctionExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESLint.RuleFix {
  const { body } = node;
  const arrow = sourceCode.getTokenBefore(body, { filter: (token) => token.value === '=>' });
  if (arrow === null) {
    return fixer.replaceText(node, sourceCode.getText(node));
  }
  const inner = indentContinuationLines(sourceCode, body);
  const statement = statementFor(node, inner);

  const comments = sourceCode.getAllComments().filter((comment) => {
    return comment.range[0] >= arrow.range[1] && comment.range[1] <= node.range[1];
  });
  const before = comments.filter((comment) => comment.range[1] <= body.range[0]);
  const afterwards = comments.filter((comment) => comment.range[0] >= body.range[1]);

  const indent = lineIndent(sourceCode, node);
  const inside = `${indent}  `;
  const lines = [
    ...before.map((comment) => commentText(comment, inside)),
    `${inside}${statement}`,
    ...afterwards.map((comment) => commentText(comment, inside)),
  ];
  return fixer.replaceTextRange(
    [arrow.range[1], node.range[1]],
    ` {\n${lines.join('\n')}\n${indent}}`,
  );
}

/** The block's one statement: the body itself when nothing is returned, else `return body;`. */
function statementFor(node: TSESTree.ArrowFunctionExpression, inner: string): string {
  if (isReturnless(node, node.body)) {
    return `${statementStart(inner)};`;
  }
  return `return ${returned(node.body, inner)};`;
}

/** Prettier writes `return (a = b);` and `return (a, b);`. */
function returned(body: TSESTree.Node, text: string): string {
  if (
    body.type === AST_NODE_TYPES.SequenceExpression ||
    body.type === AST_NODE_TYPES.AssignmentExpression
  ) {
    return `(${text})`;
  }
  return text;
}

/** An expression statement can't start with `{`, `function` or `class`. */
function statementStart(text: string): string {
  if (statementNeedsParens.test(text)) {
    return `(${text})`;
  }
  return text;
}

function isReturnless(node: TSESTree.ArrowFunctionExpression, body: TSESTree.Node): boolean {
  if (body.type === AST_NODE_TYPES.UnaryExpression && body.operator === 'void') {
    return true;
  }
  const annotation = node.returnType?.typeAnnotation;
  if (annotation === undefined) {
    return false;
  }
  if (annotation.type === AST_NODE_TYPES.TSVoidKeyword) {
    return true;
  }
  return (
    node.async &&
    body.type === AST_NODE_TYPES.AwaitExpression &&
    annotation.type === AST_NODE_TYPES.TSTypeReference &&
    annotation.typeName.type === AST_NODE_TYPES.Identifier &&
    annotation.typeName.name === 'Promise' &&
    annotation.typeArguments?.params.length === 1 &&
    annotation.typeArguments.params[0]?.type === AST_NODE_TYPES.TSVoidKeyword
  );
}

function commentText(comment: TSESTree.Comment, indent: string): string {
  if (comment.type === AST_TOKEN_TYPES.Line) {
    return `${indent}//${comment.value}`;
  }
  return `${indent}/*${comment.value}*/`;
}

function lineIndent(sourceCode: Readonly<TSESLint.SourceCode>, node: TSESTree.Node): string {
  const line = sourceCode.lines[node.loc.start.line - 1] ?? '';
  return leadingWhitespace.exec(line)?.[0] ?? '';
}

/** The body's text with its continuation lines pushed in one level, except inside templates. */
function indentContinuationLines(
  sourceCode: Readonly<TSESLint.SourceCode>,
  body: TSESTree.Node,
): string {
  const text = sourceCode.getText(body);
  const start = body.range[0];
  const protectedRanges = sourceCode
    .getTokens(body)
    .filter((token) => token.type === AST_TOKEN_TYPES.Template)
    .map((token) => token.range);
  let result = '';
  let offset = 0;
  for (const line of text.split('\n')) {
    const absolute = start + offset;
    const isInsideTemplate = protectedRanges.some(([from, to]) => absolute > from && absolute < to);
    if (offset !== 0 && !isInsideTemplate && line.trim() !== '') {
      result += '  ';
    }
    result += line;
    offset += line.length + 1;
    if (offset <= text.length) {
      result += '\n';
    }
  }
  return result;
}
