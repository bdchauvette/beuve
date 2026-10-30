import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'bindingInRepeat' | 'callInRepeat';

type FunctionNode =
  TSESTree.ArrowFunctionExpression | TSESTree.FunctionDeclaration | TSESTree.FunctionExpression;

/** Lit's event binding: `@name=` at the end of the text before an expression. */
const eventBinding = /@([^\s"'>/=]+)=["']?$/u;

const repeatingMethods = new Set(['map', 'flatMap']);
const repeatingFunctions = new Set(['repeat', 'map']);

/**
 * Bans Lit event bindings (`@click=${…}`) in templates made once per item (ADR 0074): inside a
 * callback of `.map(…)`, `.flatMap(…)`, `repeat(…)` or Lit's `map(…)`, and in a render method or
 * function such a callback calls, directly or through others in the same file. Each binding is a
 * listener per item; delegate the event with `delegateActions` on the component's root and mark
 * the item with `data-action`.
 */
export const noListenerInRepeatedTemplate = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid Lit event bindings in templates repeated per item' },
    schema: [],
    messages: {
      bindingInRepeat:
        '`@{{event}}` binds a listener per item of a repeated template. Mark the element with `data-action` and handle it with `delegateActions` on the component root.',
      callInRepeat:
        '`{{name}}` renders event bindings and is called per item of a repeated template. Mark its elements with `data-action` and handle them with `delegateActions` on the component root.',
    },
  },
  create(context) {
    const templates: { readonly node: TSESTree.TaggedTemplateExpression; event: string }[] = [];
    const calls: { readonly node: TSESTree.Node; readonly name: string }[] = [];
    const named = new Map<string, FunctionNode>();

    return {
      TaggedTemplateExpression(node): void {
        const event = boundEvent(node);
        if (event !== undefined) {
          templates.push({ node, event });
        }
      },
      CallExpression(node): void {
        const name = calleeName(node.callee);
        if (name !== undefined) {
          calls.push({ node, name });
        }
        if (isRepeatingCall(node)) {
          for (const argument of node.arguments) {
            const reference = calleeName(argument);
            if (reference !== undefined) {
              calls.push({ node: argument, name: reference });
            }
          }
        }
      },
      FunctionDeclaration(node): void {
        if (node.id !== null) {
          named.set(node.id.name, node);
        }
      },
      'MethodDefinition, PropertyDefinition'(
        node: TSESTree.MethodDefinition | TSESTree.PropertyDefinition,
      ): void {
        const { key, value } = node;
        if (
          value !== null &&
          key.type === AST_NODE_TYPES.Identifier &&
          (value.type === AST_NODE_TYPES.FunctionExpression ||
            value.type === AST_NODE_TYPES.ArrowFunctionExpression)
        ) {
          named.set(`this.${key.name}`, value);
        }
      },
      'Program:exit'(): void {
        const binding = bindingFunctions(templates, calls, named);
        for (const { node, event } of templates) {
          if (isInRepeatCallback(node)) {
            context.report({ node, messageId: 'bindingInRepeat', data: { event } });
          }
        }
        for (const { node, name } of calls) {
          const target = named.get(name);
          if (target !== undefined && binding.has(target) && isInRepeat(node)) {
            context.report({ node, messageId: 'callInRepeat', data: { name } });
          }
        }
      },
    };
  },
});

function boundEvent(node: TSESTree.TaggedTemplateExpression): string | undefined {
  const { tag } = node;
  if (tag.type !== AST_NODE_TYPES.Identifier || (tag.name !== 'html' && tag.name !== 'svg')) {
    return undefined;
  }
  const beforeExpressions = node.quasi.quasis.slice(0, -1);
  for (const quasi of beforeExpressions) {
    const match = eventBinding.exec(quasi.value.raw);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return undefined;
}

/** `this.name` or `name`, for calls and references the rule can resolve within the file. */
function calleeName(node: TSESTree.Node): string | undefined {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  return node.type === AST_NODE_TYPES.MemberExpression &&
    node.object.type === AST_NODE_TYPES.ThisExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
    ? `this.${node.property.name}`
    : undefined;
}

function isRepeatingCall(node: TSESTree.CallExpression): boolean {
  const { callee } = node;
  return callee.type === AST_NODE_TYPES.Identifier
    ? repeatingFunctions.has(callee.name)
    : callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.type === AST_NODE_TYPES.Identifier &&
        repeatingMethods.has(callee.property.name);
}

/** Functions that render a binding themselves or call one that does, to a fixed point. */
function bindingFunctions(
  templates: readonly { readonly node: TSESTree.Node }[],
  calls: readonly { readonly node: TSESTree.Node; readonly name: string }[],
  named: ReadonlyMap<string, FunctionNode>,
): Set<FunctionNode> {
  const found = new Set<FunctionNode>();
  const addEnclosing = (node: TSESTree.Node): number => {
    const before = found.size;
    for (const enclosing of enclosingFunctions(node)) {
      found.add(enclosing);
    }
    return found.size - before;
  };
  for (const { node } of templates) {
    addEnclosing(node);
  }
  let isGrowing = true;
  while (isGrowing) {
    isGrowing = false;
    for (const { node, name } of calls) {
      const target = named.get(name);
      if (target !== undefined && found.has(target) && addEnclosing(node) > 0) {
        isGrowing = true;
      }
    }
  }
  return found;
}

function enclosingFunctions(node: TSESTree.Node): FunctionNode[] {
  const functions: FunctionNode[] = [];
  for (let current = node.parent; current !== undefined; current = current.parent ?? undefined) {
    if (isFunction(current)) {
      functions.push(current);
    }
  }
  return functions;
}

function isFunction(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionDeclaration
  );
}

/** Inside a function passed to a repeating call. */
function isInRepeatCallback(node: TSESTree.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent ?? undefined) {
    if (
      isFunction(current) &&
      current.parent.type === AST_NODE_TYPES.CallExpression &&
      current.parent.callee !== current &&
      isRepeatingCall(current.parent)
    ) {
      return true;
    }
  }
  return false;
}

/** Inside a repeating callback, or passed to a repeating call by reference. */
function isInRepeat(node: TSESTree.Node): boolean {
  return (
    isInRepeatCallback(node) ||
    (node.parent?.type === AST_NODE_TYPES.CallExpression &&
      node.parent.callee !== node &&
      isRepeatingCall(node.parent))
  );
}
