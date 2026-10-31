import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { ParserServicesWithTypeInformation, TSESTree } from '@typescript-eslint/utils';
import type ts from 'typescript';

import type { SignatureNode } from './no-inline-object-type-in-signature.ts';

type MessageIds = 'sameTypeParams';

type Options = [{ readonly allowedPairs?: readonly (readonly [string, string])[] }];

const leadingUnderscore = /^_/u;

const defaultPairs: readonly (readonly [string, string])[] = [
  ['a', 'b'],
  ['first', 'last'],
  ['left', 'right'],
  ['lhs', 'rhs'],
  ['x', 'y'],
  ['before', 'after'],
  ['previous', 'next'],
  ['old', 'new'],
  ['start', 'end'],
  ['min', 'max'],
  ['actual', 'expected'],
];

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
 * Two positional parameters of the same type are easy to swap and the compiler can't tell. Pass an
 * options object, or give the type a brand. Exactly two parameters whose names form an allowlisted
 * pair (`a`/`b`, `left`/`right`, `actual`/`expected`, …) are fine, as are callbacks passed
 * straight to a call, methods that implement or override, overloads, and declaration files (which
 * describe an API someone else defined). Type-aware.
 */
export const noSameTypePositionalParams = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Forbid positional parameters of the same type that can be swapped' },
    schema: [
      {
        type: 'object',
        properties: {
          allowedPairs: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
    messages: {
      sameTypeParams:
        '`{{names}}` all have the type `{{type}}`, so a call can swap them without an error. Take an options object or brand the types.',
    },
  },
  create(context, [options]) {
    if (context.filename.endsWith('.d.ts')) {
      return {};
    }
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const pairs = (options.allowedPairs ?? defaultPairs).map(([first, second]) => {
      return [normalized(first), normalized(second)] as const;
    });

    const firstDuplicateGroup = (
      parameters: readonly TSESTree.Parameter[],
    ): DuplicateGroup | undefined => {
      const groups = new Map<ts.Type, TSESTree.Parameter[]>();
      for (const parameter of parameters) {
        const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(parameter));
        const members = groups.getOrInsert(type, []);
        members.push(parameter);
      }
      for (const [type, members] of groups) {
        if (members.length >= 2) {
          return { type, members };
        }
      }
      return undefined;
    };

    return {
      [signatureSelector](node: SignatureNode): void {
        const parameters = node.params.filter((parameter) => isPositional(parameter));
        if (parameters.length < 2 || isExempt(node, services)) {
          return;
        }
        const group = firstDuplicateGroup(parameters);
        if (group === undefined) {
          return;
        }
        if (parameters.length === 2 && isAllowedPair(parameters, pairs)) {
          return;
        }
        const [, second] = group.members;
        context.report({
          node: second ?? node,
          messageId: 'sameTypeParams',
          data: {
            names: group.members.map((member) => nameOf(member) ?? '(pattern)').join('`, `'),
            type: checker.typeToString(group.type),
          },
        });
      },
    };
  },
});

/** Parameters that share one type. */
interface DuplicateGroup {
  readonly type: ts.Type;
  readonly members: TSESTree.Parameter[];
}

function normalized(name: string): string {
  return name.toLowerCase().replace(leadingUnderscore, '');
}

function isPositional(parameter: TSESTree.Parameter): boolean {
  return (
    parameter.type !== AST_NODE_TYPES.RestElement &&
    !(parameter.type === AST_NODE_TYPES.Identifier && parameter.name === 'this')
  );
}

function nameOf(start: TSESTree.Parameter): string | undefined {
  let parameter: TSESTree.Node = start;
  for (;;) {
    if (parameter.type === AST_NODE_TYPES.AssignmentPattern) {
      parameter = parameter.left;
    } else if (parameter.type === AST_NODE_TYPES.TSParameterProperty) {
      parameter = parameter.parameter;
    } else {
      break;
    }
  }
  if (parameter.type === AST_NODE_TYPES.Identifier) {
    return parameter.name;
  }
  return undefined;
}

function isAllowedPair(
  parameters: readonly TSESTree.Parameter[],
  pairs: readonly (readonly [string, string])[],
): boolean {
  const [first, second] = parameters.map((parameter) => nameOf(parameter));
  if (first === undefined || second === undefined) {
    return false;
  }
  const one = normalized(first);
  const two = normalized(second);
  return pairs.some(([left, right]) => {
    return (one === left && two === right) || (one === right && two === left);
  });
}

function isExempt(node: SignatureNode, services: ParserServicesWithTypeInformation): boolean {
  return isCallArgument(node) || isDictatedMethod(node, services) || isOverloadRelated(node);
}

function isCallArgument(node: SignatureNode): boolean {
  const { parent } = node;
  return (
    (parent.type === AST_NODE_TYPES.CallExpression ||
      parent.type === AST_NODE_TYPES.NewExpression) &&
    parent.arguments.some((argument) => argument === node)
  );
}

/** An `override`, or a method one of the class's `implements` interfaces declares. */
function isDictatedMethod(
  node: SignatureNode,
  services: ParserServicesWithTypeInformation,
): boolean {
  const method = node.parent;
  if (
    method.type !== AST_NODE_TYPES.MethodDefinition &&
    method.type !== AST_NODE_TYPES.TSAbstractMethodDefinition
  ) {
    return false;
  }
  if (method.override) {
    return true;
  }
  if (method.kind === 'constructor') {
    return false;
  }
  const checker = services.program.getTypeChecker();
  const key = services.esTreeNodeToTSNodeMap.get(method.key);
  const name = checker.getSymbolAtLocation(key)?.escapedName;
  if (name === undefined) {
    return false;
  }
  return method.parent.parent.implements.some((heritage) => {
    const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(heritage));
    return checker.getPropertiesOfType(type).some((property) => property.escapedName === name);
  });
}

function isOverloadRelated(node: SignatureNode): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.TSEmptyBodyFunctionExpression: {
      return true;
    }
    case AST_NODE_TYPES.TSDeclareFunction: {
      return isOverloadedDeclaration(node);
    }
    case AST_NODE_TYPES.FunctionDeclaration: {
      return isOverloadedDeclaration(node);
    }
    case AST_NODE_TYPES.FunctionExpression: {
      return isOverloadedMethod(node);
    }
    case AST_NODE_TYPES.TSMethodSignature: {
      return siblingsOf(node).filter((sibling) => isSameSignature(sibling, node)).length > 1;
    }
    default: {
      return false;
    }
  }
}

function isOverloadedDeclaration(
  node: TSESTree.FunctionDeclaration | TSESTree.TSDeclareFunction,
): boolean {
  const name = node.id?.name;
  if (name === undefined) {
    return false;
  }
  const siblings = siblingsOf(node).map((sibling) => {
    if (
      sibling.type === AST_NODE_TYPES.ExportNamedDeclaration ||
      sibling.type === AST_NODE_TYPES.ExportDefaultDeclaration
    ) {
      return sibling.declaration;
    }
    return sibling;
  });
  const sameName = siblings.filter((sibling) => {
    return (
      (sibling?.type === AST_NODE_TYPES.FunctionDeclaration ||
        sibling?.type === AST_NODE_TYPES.TSDeclareFunction) &&
      sibling.id?.name === name
    );
  });
  return sameName.length > 1;
}

function isOverloadedMethod(node: TSESTree.FunctionExpression): boolean {
  const method = node.parent;
  if (method.type !== AST_NODE_TYPES.MethodDefinition) {
    return false;
  }
  const name = methodName(method);
  return (
    name !== undefined &&
    method.parent.body.some((member) => {
      return (
        member.type === AST_NODE_TYPES.MethodDefinition &&
        member !== method &&
        member.static === method.static &&
        member.value.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression &&
        methodName(member) === name
      );
    })
  );
}

function methodName(
  member: TSESTree.MethodDefinition | TSESTree.TSAbstractMethodDefinition,
): string | undefined {
  if (member.key.type === AST_NODE_TYPES.Identifier && !member.computed) {
    return member.key.name;
  }
  return undefined;
}

function siblingsOf(node: TSESTree.Node): readonly TSESTree.Node[] {
  let container: TSESTree.Node | undefined = node.parent;
  if (
    container?.type === AST_NODE_TYPES.ExportNamedDeclaration ||
    container?.type === AST_NODE_TYPES.ExportDefaultDeclaration
  ) {
    container = container.parent;
  }
  switch (container?.type) {
    case AST_NODE_TYPES.Program:
    case AST_NODE_TYPES.BlockStatement:
    case AST_NODE_TYPES.TSModuleBlock:
    case AST_NODE_TYPES.TSInterfaceBody: {
      return container.body;
    }
    default: {
      return [];
    }
  }
}

function isSameSignature(sibling: TSESTree.Node, node: TSESTree.TSMethodSignature): boolean {
  return (
    sibling.type === AST_NODE_TYPES.TSMethodSignature &&
    sibling.key.type === AST_NODE_TYPES.Identifier &&
    node.key.type === AST_NODE_TYPES.Identifier &&
    sibling.key.name === node.key.name
  );
}
