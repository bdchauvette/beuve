import { AST_NODE_TYPES, ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type { ParserServicesWithTypeInformation, TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';

import { tailOf } from '#x/text/tail-of.ts';

type MessageIds = 'forward' | 'forwardOneOf';

type Context = Readonly<TSESLint.RuleContext<MessageIds, []>>;

type Call = TSESTree.CallExpression | TSESTree.NewExpression;

type FunctionNode =
  TSESTree.ArrowFunctionExpression | TSESTree.FunctionDeclaration | TSESTree.FunctionExpression;

/** A signal the call could forward, written as the expression that reads it. */
interface Candidate {
  readonly text: string;
  /** Source text of the variable's initializer, to drop the signals it derives from. */
  readonly derivedFrom?: string;
  /** A destructuring parameter that must gain `signal` before `signal` can be read. */
  readonly pattern?: TSESTree.ObjectPattern;
}

/** Where the callee takes its signal. */
type Slot =
  | { readonly kind: 'parameter'; readonly index: number }
  | { readonly kind: 'option'; readonly index: number }
  | { readonly kind: 'any'; readonly array: TSESTree.ArrayExpression };

interface Types {
  readonly services: ParserServicesWithTypeInformation;
  readonly checker: ts.TypeChecker;
}

type Fix = (fixer: TSESLint.RuleFixer) => TSESLint.RuleFix;

/** A call that must forward its one candidate signal, and where the callee takes it. */
interface Forwarding {
  readonly node: Call;
  readonly slots: readonly Slot[];
  readonly candidate: Candidate;
}

/** A signal to write into one slot of a call. */
interface Insertion {
  readonly node: Call;
  readonly slot: Slot;
  /** The expression that reads the signal. */
  readonly value: string;
}

/** Text to add to a list: `item` after its last element, or `alone` in place of an empty one. */
interface Appended {
  readonly item: string;
  readonly alone: string;
}

const functionTypes = new Set<string>([
  AST_NODE_TYPES.ArrowFunctionExpression,
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.FunctionExpression,
]);
const whitespace = /\s+/gu;
const identifierCharacter = /[\w$#]/u;

/**
 * Reports a call whose callee takes an `AbortSignal`, as a parameter or as an options-bag `signal`,
 * when the call passes none and a signal is in scope (ADR 0075). In scope, nearest function first:
 * a parameter typed `AbortSignal`, a parameter with a `signal` property (an options bag, a
 * controller, the Vitest test context, even when it is destructured without `signal`), a local
 * variable typed `AbortSignal` or `AbortController`, and a class field typed `AbortSignal` or
 * `AbortController` that the same method reads (`this.field`, `this.field.signal`). Module-level
 * signals never count. A signal derived from another (`AbortSignal.any([signal, …])`) replaces it.
 * `AbortSignal.any([…])` must include a signal in scope. Fixes when exactly one signal is in scope
 * and the options bag is an object literal or absent. Type-aware.
 */
export const forwardAbortSignal = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: { description: 'Forward an AbortSignal in scope to every callee that accepts one' },
    schema: [],
    defaultOptions: [],
    messages: {
      forward:
        '`{{callee}}` takes an AbortSignal and `{{signal}}` is in scope: forward it, or disable this line with the reason the work must outlive it (ADR 0075).',
      forwardOneOf:
        '`{{callee}}` takes an AbortSignal and {{signals}} are in scope: forward the one that bounds this work (ADR 0075).',
    },
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const types: Types = { services, checker: services.program.getTypeChecker() };

    const check = (node: Call): void => {
      if (isSkippedCallee(types, node)) {
        return;
      }
      const slots = signalSlots(types, node);
      if (slots.length === 0) {
        return;
      }
      const candidates = candidatesFor(context, types, node);
      if (
        candidates.length === 0 ||
        isCandidatePassed(context, node, candidates) ||
        slots.some((slot) => isSatisfied(types, node, slot))
      ) {
        return;
      }
      const callee = calleeText(context, node);
      const [only, ...others] = candidates;
      if (only === undefined) {
        return;
      }
      if (others.length > 0) {
        context.report({
          node,
          messageId: 'forwardOneOf',
          data: { callee, signals: candidates.map(({ text }) => `\`${text}\``).join(', ') },
        });
        return;
      }
      const fix = fixFor(context, { node, slots, candidate: only });
      context.report({
        node,
        messageId: 'forward',
        data: { callee, signal: only.text },
        ...(fix !== undefined && { fix }),
      });
    };

    return {
      CallExpression: check,
      NewExpression: check,
    };
  },
});

/** A method of a signal itself, and Node's `…Sync` functions, which ignore their `signal`. */
function isSkippedCallee(types: Types, node: Call): boolean {
  const { callee } = node;
  return (
    calleeName(callee)?.endsWith('Sync') === true ||
    (callee.type === AST_NODE_TYPES.MemberExpression &&
      isAbortSignalType(types.checker, typeOf(types, callee.object)))
  );
}

/** `name` for `name(…)` and `object.name(…)`. */
function calleeName(callee: Call['callee']): string | undefined {
  if (callee.type === AST_NODE_TYPES.MemberExpression) {
    if (callee.property.type === AST_NODE_TYPES.Identifier) {
      return callee.property.name;
    }
    return undefined;
  }
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  return undefined;
}

function typeOf(types: Types, node: TSESTree.Node): ts.Type {
  return types.checker.getTypeAtLocation(types.services.esTreeNodeToTSNodeMap.get(node));
}

function isAbortSignalType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.some((member) => isAbortSignalType(checker, member));
  }
  return (type.getSymbol() ?? type.aliasSymbol)?.getName() === 'AbortSignal';
}

/** Every parameter of the resolved signature that takes a signal, itself or as `signal`. */
function signalSlots(types: Types, node: Call): readonly Slot[] {
  const anyArray = abortSignalAnyArray(node);
  if (anyArray !== undefined) {
    return [{ kind: 'any', array: anyArray }];
  }
  const tsNode = types.services.esTreeNodeToTSNodeMap.get(node);
  const signature = types.checker.getResolvedSignature(tsNode);
  if (signature === undefined) {
    return [];
  }
  const spread = node.arguments.findIndex((arg) => arg.type === AST_NODE_TYPES.SpreadElement);
  const slots: Slot[] = [];
  for (const [index, parameter] of signature.getParameters().entries()) {
    if (isRestParameter(parameter) || (spread !== -1 && spread <= index)) {
      return [];
    }
    const type = types.checker.getTypeOfSymbolAtLocation(parameter, tsNode);
    if (isAbortSignalType(types.checker, type)) {
      slots.push({ kind: 'parameter', index });
    } else if (hasSignalProperty(types.checker, type, tsNode)) {
      slots.push({ kind: 'option', index });
    }
  }
  return slots;
}

function abortSignalAnyArray(node: Call): TSESTree.ArrayExpression | undefined {
  const { callee } = node;
  const [first] = node.arguments;
  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    first?.type === AST_NODE_TYPES.ArrayExpression &&
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'AbortSignal' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'any'
  ) {
    return first;
  }
  return undefined;
}

function isRestParameter(parameter: ts.Symbol): boolean {
  const declaration = parameter.valueDeclaration;
  return (
    declaration !== undefined &&
    ts.isParameter(declaration) &&
    declaration.dotDotDotToken !== undefined
  );
}

function hasSignalProperty(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): boolean {
  return unionMembers(type).some((member) => {
    if ((member.flags & ts.TypeFlags.Object) === 0 && !member.isIntersection()) {
      return false;
    }
    const signal = checker.getPropertyOfType(member, 'signal');
    return (
      signal !== undefined &&
      isAbortSignalType(checker, checker.getTypeOfSymbolAtLocation(signal, at))
    );
  });
}

/** The members of a union, or the type itself. */
function unionMembers(type: ts.Type): readonly ts.Type[] {
  if (type.isUnion()) {
    return type.types;
  }
  return [type];
}

/** The signals in scope at the nearest function that has any, without those others derive from. */
function candidatesFor(context: Context, types: Types, node: Call): readonly Candidate[] {
  const found: Candidate[] = [];
  let scope = context.sourceCode.getScope(node);
  while (scope.upper !== null && scope.type !== TSESLint.Scope.ScopeType.module) {
    found.push(...variableCandidates(types, scope, node));
    const { block } = scope;
    if (
      block.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      block.type === AST_NODE_TYPES.FunctionDeclaration ||
      block.type === AST_NODE_TYPES.FunctionExpression
    ) {
      found.push(...patternCandidates(types, block), ...fieldCandidates(types, block));
      if (found.length > 0) {
        break;
      }
    }
    scope = scope.upper;
  }
  const underived = found.filter((candidate) => {
    return found.every((other) => other === candidate || !isDerivedFrom(other, candidate.text));
  });
  return underived.filter((candidate, index) => {
    return underived.findIndex(({ text }) => text === candidate.text) === index;
  });
}

function variableCandidates(
  types: Types,
  scope: TSESLint.Scope.Scope,
  node: Call,
): readonly Candidate[] {
  const found: Candidate[] = [];
  for (const variable of scope.variables) {
    const [definition] = variable.defs;
    if (definition?.name.type !== AST_NODE_TYPES.Identifier) {
      continue;
    }
    if (definition.type === TSESLint.Scope.DefinitionType.Parameter) {
      const candidate = parameterCandidate(types, definition.name);
      if (candidate !== undefined) {
        found.push(candidate);
      }
    } else if (
      definition.type === TSESLint.Scope.DefinitionType.Variable &&
      definition.node.range[1] <= node.range[0] &&
      !isWrittenBy(variable, node)
    ) {
      const candidate = localCandidate(types, definition.name, definition.node.init);
      if (candidate !== undefined) {
        found.push(candidate);
      }
    }
  }
  return found;
}

/** Whether `node` is part of a value being written to `variable`, which cannot carry it yet. */
function isWrittenBy(variable: TSESLint.Scope.Variable, node: Call): boolean {
  return variable.references.some(({ writeExpr }) => {
    return (
      writeExpr !== null &&
      writeExpr !== undefined &&
      writeExpr.range[0] <= node.range[0] &&
      node.range[1] <= writeExpr.range[1]
    );
  });
}

function parameterCandidate(types: Types, name: TSESTree.Identifier): Candidate | undefined {
  const type = typeOf(types, name);
  if (isAbortSignalType(types.checker, type)) {
    return { text: name.name };
  }
  const tsNode = types.services.esTreeNodeToTSNodeMap.get(name);
  if (!isDirectParameter(name) || !hasSignalProperty(types.checker, type, tsNode)) {
    return undefined;
  }
  return { text: `${name.name}${optionalChain(type)}.signal` };
}

function isDirectParameter(name: TSESTree.Identifier): boolean {
  const { parent } = name;
  return (
    functionTypes.has(parent.type) ||
    (parent.type === AST_NODE_TYPES.AssignmentPattern &&
      parent.left === name &&
      functionTypes.has(parent.parent.type))
  );
}

function optionalChain(type: ts.Type): string {
  const isNullable =
    type.isUnion() &&
    type.types.some((member) => {
      return (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0;
    });
  if (isNullable) {
    return '?';
  }
  return '';
}

function localCandidate(
  types: Types,
  name: TSESTree.Identifier,
  init: TSESTree.Expression | null,
): Candidate | undefined {
  const type = typeOf(types, name);
  if (isAbortSignalType(types.checker, type)) {
    return {
      text: name.name,
      ...(init !== null && {
        derivedFrom: types.services.esTreeNodeToTSNodeMap.get(init).getText(),
      }),
    };
  }
  if (!isAbortController(type)) {
    return undefined;
  }
  return { text: `${name.name}${optionalChain(type)}.signal` };
}

function isAbortController(type: ts.Type): boolean {
  return unionMembers(type).some((member) => member.getSymbol()?.getName() === 'AbortController');
}

/** A destructured parameter whose type has a `signal` it leaves out, such as a test context. */
function patternCandidates(types: Types, fn: FunctionNode): readonly Candidate[] {
  const found: Candidate[] = [];
  for (const parameter of fn.params) {
    const pattern = withoutDefault(parameter);
    if (
      pattern.type !== AST_NODE_TYPES.ObjectPattern ||
      pattern.properties.some((property) => {
        return property.type === AST_NODE_TYPES.RestElement || propertyName(property) === 'signal';
      })
    ) {
      continue;
    }
    const tsNode = types.services.esTreeNodeToTSNodeMap.get(pattern);
    if (hasSignalProperty(types.checker, types.checker.getTypeAtLocation(tsNode), tsNode)) {
      found.push({ text: 'signal', pattern });
    }
  }
  return found;
}

function withoutDefault(parameter: TSESTree.Parameter): TSESTree.Parameter | TSESTree.BindingName {
  if (parameter.type === AST_NODE_TYPES.AssignmentPattern) {
    return parameter.left;
  }
  return parameter;
}

function propertyName(
  property: TSESTree.Property | TSESTree.RestElement | TSESTree.SpreadElement,
): string | undefined {
  if (
    property.type === AST_NODE_TYPES.Property &&
    !property.computed &&
    property.key.type === AST_NODE_TYPES.Identifier
  ) {
    return property.key.name;
  }
  return undefined;
}

/** `AbortSignal` and `AbortController` fields of the enclosing class that this method reads. */
function fieldCandidates(types: Types, fn: FunctionNode): readonly Candidate[] {
  const owner = fn.parent;
  const isMethod =
    (owner.type === AST_NODE_TYPES.MethodDefinition ||
      owner.type === AST_NODE_TYPES.PropertyDefinition) &&
    owner.value === fn;
  if (!isMethod) {
    return [];
  }
  const read = thisMembersIn(fn);
  const found: Candidate[] = [];
  const fields = owner.parent.body.filter((member): member is TSESTree.PropertyDefinition => {
    return member.type === AST_NODE_TYPES.PropertyDefinition && !member.static;
  });
  for (const member of fields) {
    const key = fieldKey(member);
    if (key === undefined) {
      continue;
    }
    const type = typeOf(types, member.key);
    if (isAbortSignalType(types.checker, type) && read.has(key)) {
      found.push({ text: `this.${key}` });
    } else if (isAbortController(type) && read.has(`${key}.signal`)) {
      found.push({ text: `this.${key}${optionalChain(type)}.signal` });
    }
  }
  return found;
}

function fieldKey(member: TSESTree.PropertyDefinition): string | undefined {
  if (member.computed) {
    return undefined;
  }
  if (member.key.type === AST_NODE_TYPES.PrivateIdentifier) {
    return `#${member.key.name}`;
  }
  if (member.key.type === AST_NODE_TYPES.Identifier) {
    return member.key.name;
  }
  return undefined;
}

/** `field` for each `this.field`, and `field.signal` for each `this.field.signal`, in `fn`. */
function thisMembersIn(fn: FunctionNode): ReadonlySet<string> {
  const read = new Set<string>();
  const visit = (node: TSESTree.Node): void => {
    const key = thisMemberKey(node);
    if (key !== undefined) {
      read.add(key);
      if (isSignalRead(node.parent)) {
        read.add(`${key}.signal`);
      }
    }
    for (const child of childNodes(node)) {
      visit(child);
    }
  };
  visit(fn.body);
  return read;
}

function thisMemberKey(node: TSESTree.Node): string | undefined {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression ||
    node.object.type !== AST_NODE_TYPES.ThisExpression ||
    node.computed
  ) {
    return undefined;
  }
  if (node.property.type === AST_NODE_TYPES.PrivateIdentifier) {
    return `#${node.property.name}`;
  }
  return node.property.name;
}

function isSignalRead(node: TSESTree.Node | undefined): boolean {
  return (
    node?.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === 'signal'
  );
}

function childNodes(node: TSESTree.Node): readonly TSESTree.Node[] {
  const children: TSESTree.Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') {
      continue;
    }
    const values: unknown[] = [value].flat();
    children.push(...values.filter((child) => isNode(child)));
  }
  return children;
}

function isNode(value: unknown): value is TSESTree.Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly type?: unknown }).type === 'string'
  );
}

/** Whether `candidate`'s initializer reads the signal written as `source`. */
function isDerivedFrom(candidate: Candidate, source: string): boolean {
  const from = candidate.derivedFrom;
  const at = from?.indexOf(source) ?? -1;
  return (
    from !== undefined &&
    at !== -1 &&
    !isIdentifierCharacter(from.charAt(at - 1)) &&
    !isIdentifierCharacter(from.charAt(at + source.length))
  );
}

function isIdentifierCharacter(character: string): boolean {
  return character !== '' && identifierCharacter.test(character);
}

/** Whether a signal in scope is already an argument, or an element of `AbortSignal.any([…])`. */
function isCandidatePassed(
  context: Context,
  node: Call,
  candidates: readonly Candidate[],
): boolean {
  const texts = new Set(candidates.map(({ text }) => normalized(text)));
  const isCandidate = (expression: TSESTree.Node | null): boolean => {
    return expression !== null && texts.has(normalized(context.sourceCode.getText(expression)));
  };
  const anyArray = abortSignalAnyArray(node);
  if (anyArray === undefined) {
    return node.arguments.some((arg) => isCandidate(arg));
  }
  return anyArray.elements.some((element) => isCandidate(element));
}

/**
 * Whether the call passes something where `slot` takes a signal: any argument for a signal
 * parameter, a literal with `signal` or a spread, or a value whose type has a `signal`.
 */
function isSatisfied(types: Types, node: Call, slot: Slot): boolean {
  if (slot.kind === 'any') {
    return false;
  }
  const arg = node.arguments[slot.index];
  if (arg === undefined || slot.kind === 'parameter') {
    return arg !== undefined;
  }
  if (arg.type === AST_NODE_TYPES.ObjectExpression) {
    return arg.properties.some((property) => {
      return property.type === AST_NODE_TYPES.SpreadElement || propertyName(property) === 'signal';
    });
  }
  const tsNode = types.services.esTreeNodeToTSNodeMap.get(arg);
  return hasSignalProperty(types.checker, types.checker.getTypeAtLocation(tsNode), tsNode);
}

function normalized(text: string): string {
  return text.replaceAll('?.', '.');
}

function calleeText(context: Context, node: Call): string {
  const text = context.sourceCode.getText(node.callee).replaceAll(whitespace, '');
  if (text.length > 40) {
    return `…${tailOf(text, 39)}`;
  }
  return text;
}

function fixFor(
  context: Context,
  { node, slots, candidate }: Forwarding,
): TSESLint.ReportFixFunction | undefined {
  const insert = slots
    .map((slot) => {
      return insertion(context, { node, slot, value: candidate.text });
    })
    .find((fix) => fix !== undefined);
  if (insert === undefined) {
    return undefined;
  }
  const { pattern } = candidate;
  if (pattern === undefined) {
    return insert;
  }
  if (isBound(context, node, 'signal')) {
    return undefined;
  }
  return (fixer): TSESLint.RuleFix[] => {
    const lastProperty = pattern.properties.at(-1);
    if (lastProperty === undefined) {
      const end = pattern.typeAnnotation?.range[0] ?? pattern.range[1];
      return [fixer.replaceTextRange([pattern.range[0], end], '{ signal }'), insert(fixer)];
    }
    return [fixer.insertTextAfter(lastProperty, ', signal'), insert(fixer)];
  };
}

function insertion(context: Context, { node, slot, value }: Insertion): Fix | undefined {
  if (slot.kind === 'any') {
    return appendTo(slot.array, slot.array.elements, { item: value, alone: `[${value}]` });
  }
  const property = signalProperty(value);
  const arg = node.arguments[slot.index];
  if (arg?.type === AST_NODE_TYPES.ObjectExpression) {
    return appendTo(arg, arg.properties, { item: property, alone: `{ ${property} }` });
  }
  const closing = context.sourceCode.getLastToken(node);
  if (arg !== undefined || closing?.value !== ')') {
    return undefined;
  }
  const fill = 'undefined, '.repeat(slot.index - node.arguments.length);
  const added = `${fill}${signalArgument(slot, value)}`;
  const last = node.arguments.at(-1);
  if (last === undefined) {
    return (fixer): TSESLint.RuleFix => fixer.insertTextBefore(closing, added);
  }
  return (fixer): TSESLint.RuleFix => fixer.insertTextAfter(last, `, ${added}`);
}

/** `signal` in shorthand when the value is a variable named `signal`. */
function signalProperty(value: string): string {
  if (value === 'signal') {
    return 'signal';
  }
  return `signal: ${value}`;
}

function signalArgument(slot: Slot, value: string): string {
  if (slot.kind === 'parameter') {
    return value;
  }
  return `{ ${signalProperty(value)} }`;
}

function appendTo(
  container: TSESTree.Node,
  items: readonly (TSESTree.Node | null)[],
  { item, alone }: Appended,
): Fix | undefined {
  const last = items.at(-1);
  if (last === null) {
    return undefined;
  }
  if (last === undefined) {
    return (fixer): TSESLint.RuleFix => fixer.replaceText(container, alone);
  }
  return (fixer): TSESLint.RuleFix => fixer.insertTextAfter(last, `, ${item}`);
}

function isBound(context: Context, node: TSESTree.Node, name: string): boolean {
  let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(node);
  while (scope !== null) {
    if (scope.set.has(name)) {
      return true;
    }
    scope = scope.upper;
  }
  return false;
}
