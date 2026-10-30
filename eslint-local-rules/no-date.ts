import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import type ts from 'typescript';

type MessageIds = 'noDateGlobal' | 'noDateType' | 'noDateValue';

type GlobalUse = 'instanceof' | 'prototype';

interface Options {
  /** Members that may be read on a Date value, besides the always-allowed `toTemporalInstant`. */
  readonly allowMembers?: readonly string[];
  /** Uses of the global `Date` that are allowed, for code that inspects foreign values. */
  readonly allowGlobalUses?: readonly GlobalUse[];
}

/**
 * Bans the legacy `Date` API (ADR 0059): the global (`new Date()`, `Date.now()`, `Date.parse()`,
 * `Date.UTC()`, …), `Date` in types, and every use of a `Date`-typed value except converting it
 * at once with `date.toTemporalInstant()`. Type-aware.
 */
export const noDate = ESLintUtils.RuleCreator.withoutDocs<[Options], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid Date; use Temporal' },
    schema: [
      {
        type: 'object',
        properties: {
          allowMembers: { type: 'array', items: { type: 'string' } },
          allowGlobalUses: {
            type: 'array',
            items: { type: 'string', enum: ['instanceof', 'prototype'] },
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
    messages: {
      noDateGlobal:
        '`{{usage}}` uses the legacy Date API. Use Temporal: `Temporal.Now.instant()`, `Temporal.Instant.from(iso)`, `Temporal.Instant.compare(a, b)`, `Temporal.Now.plainDateISO(timeZone)`.',
      noDateType: "Don't type values as `Date`; use a Temporal type such as `Temporal.Instant`.",
      noDateValue:
        'This is a `Date`. Convert it where it enters the code with `.toTemporalInstant()` and use the Temporal value instead.',
    },
  },
  create(context, [options]) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const allowedMembers = new Set(['toTemporalInstant', ...(options.allowMembers ?? [])]);
    const allowedGlobalUses = new Set<GlobalUse>(options.allowGlobalUses);

    const isDate = (node: TSESTree.Node): boolean =>
      isDateType(
        checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node)),
        services.program,
      );

    const checkValue = (node: TSESTree.Expression): void => {
      if (isGlobalDateExpression(context, node) || !isDate(node)) {
        return;
      }
      const { parent } = node;
      if (
        parent.type === AST_NODE_TYPES.MemberExpression &&
        parent.object === node &&
        !parent.computed &&
        allowedMembers.has(parent.property.name)
      ) {
        return;
      }
      context.report({ node, messageId: 'noDateValue' });
    };

    return {
      Identifier(node): void {
        if (node.name !== 'Date' || !isGlobalReference(context, node)) {
          return;
        }
        if (isTypePosition(node)) {
          context.report({ node, messageId: 'noDateType' });
          return;
        }
        const use = globalUse(node);
        if (use.allowedAs !== undefined && allowedGlobalUses.has(use.allowedAs)) {
          return;
        }
        context.report({ node, messageId: 'noDateGlobal', data: { usage: use.text } });
      },
      'MemberExpression, CallExpression, NewExpression'(
        node: TSESTree.MemberExpression | TSESTree.CallExpression | TSESTree.NewExpression,
      ): void {
        checkValue(node);
      },
      'Program:exit'(): void {
        const scopes = context.sourceCode.scopeManager?.scopes ?? [];
        for (const scope of scopes) {
          for (const reference of scope.references) {
            if (
              reference.isValueReference &&
              reference.isRead() &&
              reference.identifier.type === AST_NODE_TYPES.Identifier
            ) {
              checkValue(reference.identifier);
            }
          }
        }
      },
    };
  },
});

function isDateType(type: ts.Type, program: ts.Program): boolean {
  if (type.isUnion()) {
    return type.types.some((member) => isDateType(member, program));
  }
  const symbol = type.getSymbol();
  return (
    symbol?.getName() === 'Date' &&
    (symbol.getDeclarations() ?? []).some((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    )
  );
}

function isGlobalReference(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  node: TSESTree.Identifier,
): boolean {
  const { parent } = node;
  if (
    (parent.type === AST_NODE_TYPES.MemberExpression &&
      parent.property === node &&
      !parent.computed) ||
    (parent.type === AST_NODE_TYPES.Property && parent.key === node && !parent.computed) ||
    (parent.type === AST_NODE_TYPES.TSQualifiedName && parent.right === node)
  ) {
    return false;
  }
  let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined && variable.defs.length > 0) {
      return false;
    }
    scope = scope.upper;
  }
  return true;
}

function isTypePosition(node: TSESTree.Identifier): boolean {
  return (
    node.parent.type === AST_NODE_TYPES.TSTypeReference ||
    node.parent.type === AST_NODE_TYPES.TSQualifiedName ||
    node.parent.type === AST_NODE_TYPES.TSClassImplements ||
    node.parent.type === AST_NODE_TYPES.TSInterfaceHeritage
  );
}

function globalUse(node: TSESTree.Identifier): {
  readonly text: string;
  readonly allowedAs?: GlobalUse;
} {
  const { parent } = node;
  if (parent.type === AST_NODE_TYPES.NewExpression && parent.callee === node) {
    return { text: 'new Date()' };
  }
  if (parent.type === AST_NODE_TYPES.CallExpression && parent.callee === node) {
    return { text: 'Date()' };
  }
  if (parent.type === AST_NODE_TYPES.MemberExpression && parent.object === node) {
    const name = parent.property.type === AST_NODE_TYPES.Identifier ? parent.property.name : '…';
    return name === 'prototype'
      ? { text: 'Date.prototype', allowedAs: 'prototype' }
      : { text: `Date.${name}` };
  }
  return parent.type === AST_NODE_TYPES.BinaryExpression &&
    parent.operator === 'instanceof' &&
    parent.right === node
    ? { text: 'instanceof Date', allowedAs: 'instanceof' }
    : { text: 'Date' };
}

function isGlobalDateExpression(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  node: TSESTree.Expression,
): boolean {
  const target =
    node.type === AST_NODE_TYPES.NewExpression || node.type === AST_NODE_TYPES.CallExpression
      ? node.callee
      : node.type === AST_NODE_TYPES.MemberExpression
        ? node.object
        : node;
  return (
    target.type === AST_NODE_TYPES.Identifier &&
    target.name === 'Date' &&
    isGlobalReference(context, target)
  );
}
