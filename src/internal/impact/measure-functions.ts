import { createHash } from 'node:crypto';

import { countBooleanSequences } from './count-boolean-sequences.ts';
import type { FunctionMeasurement, SourceMeasurement } from './function-measurement.ts';
import type { ImpactNode } from './impact-node.ts';
import type { ConstructRule, FunctionRule, LanguageRules, NamerRule } from './language-rules.ts';

/** What the walk carries into a node: its owner function, nesting level, scope and given name. */
interface Frame {
  readonly node: ImpactNode;
  readonly owner: Tally | undefined;
  readonly level: number;
  readonly scope: readonly string[];
  /** A name given by the parent (`const name = …`), for a function or scope. */
  readonly name: string | undefined;
  /** The name this node's function children get (the arguments of a labelled call). */
  readonly childName: string | undefined;
  /** The parent belongs to a boolean operator sequence already counted. */
  readonly inSequence: boolean;
  /** An `else if`: counts as a decision but not as a new break in flow. */
  readonly continuation: boolean;
}

interface Tally {
  readonly name: string;
  readonly simpleName: string;
  readonly selfNames: ReadonlySet<string>;
  readonly node: ImpactNode;
  readonly rule: FunctionRule;
  cognitive: number;
  cyclomatic: number;
  maxNesting: number;
  recursive: boolean;
}

const maxNameLength = 80;
const anonymous = '<anonymous>';

/**
 * Measures every function in a tree (ADR 0015), in source order, in one iterative pass: no
 * recursion, so deep trees can't overflow the stack, and each node is visited once.
 */
export function measureFunctions(root: ImpactNode, rules: LanguageRules): SourceMeasurement {
  const tallies: Tally[] = [];
  const stack: Frame[] = [
    {
      node: root,
      owner: undefined,
      level: 0,
      scope: [],
      name: undefined,
      childName: undefined,
      inSequence: false,
      continuation: false,
    },
  ];
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const children = visit(frame, rules, tallies);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        stack.push(child);
      }
    }
  }
  return {
    functions: deduplicate(tallies.map((tally) => measurementFrom(tally))),
    parseErrors: root.hasError,
  };
}

function visit(frame: Frame, rules: LanguageRules, tallies: Tally[]): readonly Frame[] {
  const { node } = frame;
  const functionRule = rules.functions[node.type];
  if (functionRule !== undefined) {
    const tally = startTally(frame, functionRule);
    tallies.push(tally);
    return childFrames(frame, rules, {
      owner: tally,
      level: 0,
      scope: [...frame.scope, tally.simpleName],
    });
  }
  const scopeRule = rules.scopes[node.type];
  if (scopeRule !== undefined) {
    const name = ownNameOf(node, scopeRule.nameField) ?? frame.name ?? anonymous;
    return childFrames(frame, rules, { scope: [...frame.scope, name] });
  }
  const construct = rules.constructs[node.type];
  if (construct !== undefined && isOwned(frame)) {
    return visitConstruct(frame, construct, rules);
  }
  return childFrames(frame, rules, {
    inSequence: frame.inSequence && rules.transparent.includes(node.type),
  });
}

/** A frame inside a function, whose constructs count towards it. */
type OwnedFrame = Frame & { readonly owner: Tally };

function isOwned(frame: Frame): frame is OwnedFrame {
  return frame.owner !== undefined;
}

function ownNameOf(node: ImpactNode, nameField: string | undefined): string | undefined {
  if (nameField === undefined) {
    return undefined;
  }
  return fieldText(node, nameField);
}

function startTally(frame: Frame, rule: FunctionRule): Tally {
  const { node } = frame;
  const ownName = ownNameOf(node, rule.nameField);
  const modifier = node.children.find((child) => {
    return !child.isNamed && (rule.nameModifiers ?? []).includes(child.type);
  });
  const base = frame.name ?? ownName ?? anonymous;
  let simpleName = base;
  if (modifier !== undefined) {
    simpleName = `${modifier.type} ${base}`;
  }
  return {
    name: [...frame.scope, simpleName].join('.'),
    simpleName,
    selfNames: new Set([frame.name, ownName].filter((name) => name !== undefined)),
    node,
    rule,
    cognitive: 0,
    cyclomatic: 1,
    maxNesting: 0,
    recursive: false,
  };
}

function visitConstruct(
  frame: OwnedFrame,
  rule: ConstructRule,
  rules: LanguageRules,
): readonly Frame[] {
  const { node, level, owner } = frame;
  switch (rule.kind) {
    case 'branch': {
      if (frame.continuation) {
        owner.cyclomatic += 1;
      } else {
        owner.cognitive += 1 + level;
        if (rule.decision) {
          owner.cyclomatic += 1;
        }
      }
      owner.maxNesting = Math.max(owner.maxNesting, level + 1);
      const nested = new Set(rule.nestedFields.map((field) => node.childForFieldName(field)?.id));
      return childFrames(frame, rules, (child) => {
        if (nested.has(child.id)) {
          return { level: level + 1 };
        }
        return {};
      });
    }
    case 'else': {
      owner.cognitive += 1;
      owner.maxNesting = Math.max(owner.maxNesting, level + 1);
      return childFrames(frame, rules, (child) => {
        if (child.type === rule.continues) {
          return { continuation: true };
        }
        return { level: level + 1 };
      });
    }
    case 'case': {
      if (node.childForFieldName(rule.valueField) !== null) {
        owner.cyclomatic += 1;
      }
      return childFrames(frame, rules);
    }
    case 'logical': {
      const operator = node.childForFieldName(rule.operatorField)?.type;
      const isLogical = operator !== undefined && rule.operators.includes(operator);
      if (isLogical) {
        owner.cyclomatic += 1;
        if (!frame.inSequence) {
          owner.cognitive += countBooleanSequences(node, rules);
        }
      }
      return childFrames(frame, rules, { inSequence: isLogical });
    }
    case 'jump': {
      if (node.childForFieldName(rule.labelField) !== null) {
        owner.cognitive += 1;
      }
      return childFrames(frame, rules);
    }
    case 'call': {
      owner.recursive ||= isSelfCall(node, owner, rule);
      return childFrames(frame, rules);
    }
  }
}

/** What a child frame takes from its node instead of inheriting it. */
type FrameOverride = Partial<
  Pick<Frame, 'owner' | 'level' | 'scope' | 'inSequence' | 'continuation'>
>;

/**
 * Frames for a node's children: inheriting `frame`, overridden by `override`, which is one for all
 * children or one per child. Names flow from namer parents to the child in their value field.
 */
function childFrames(
  frame: Frame,
  rules: LanguageRules,
  override: FrameOverride | ((child: ImpactNode) => FrameOverride) = {},
): readonly Frame[] {
  const { node } = frame;
  const naming = namesFor(node, rules.namers[node.type]);
  return node.children.map((child): Frame => {
    let own = override;
    if (typeof own === 'function') {
      own = own(child);
    }
    let name = frame.childName;
    if (child.id === naming.valueId) {
      name = naming.name;
    }
    let childName: string | undefined;
    if (child.id === naming.argumentsId) {
      childName = naming.name;
    }
    return {
      node: child,
      owner: own.owner ?? frame.owner,
      level: own.level ?? frame.level,
      scope: own.scope ?? frame.scope,
      name,
      childName,
      inSequence: own.inSequence ?? false,
      continuation: own.continuation ?? false,
    };
  });
}

interface Naming {
  readonly name: string | undefined;
  readonly valueId: number | undefined;
  readonly argumentsId: number | undefined;
}

function namesFor(node: ImpactNode, rule: NamerRule | undefined): Naming {
  if (rule === undefined) {
    return { name: undefined, valueId: undefined, argumentsId: undefined };
  }
  switch (rule.kind) {
    case 'field': {
      return {
        name: fieldText(node, rule.nameField),
        valueId: node.childForFieldName(rule.valueField)?.id,
        argumentsId: undefined,
      };
    }
    case 'fixed': {
      return {
        name: rule.name,
        valueId: node.childForFieldName(rule.valueField)?.id,
        argumentsId: undefined,
      };
    }
    case 'call': {
      const callArguments = node.childForFieldName(rule.argumentsField);
      const label = callArguments?.children.find((child) => rule.labelTypes.includes(child.type));
      const callee = fieldText(node, rule.calleeField) ?? anonymous;
      return {
        name: shorten(`${callee}(${label?.text ?? '…'})`),
        valueId: undefined,
        argumentsId: callArguments?.id,
      };
    }
  }
}

function isSelfCall(
  node: ImpactNode,
  owner: Tally,
  rule: Extract<ConstructRule, { kind: 'call' }>,
): boolean {
  const callee = node.childForFieldName(rule.calleeField);
  if (callee === null) {
    return false;
  }
  const object = callee.childForFieldName(rule.objectField);
  if (object === null) {
    return owner.selfNames.has(callee.text);
  }
  const property = callee.childForFieldName(rule.propertyField);
  return (
    rule.selfTypes.includes(object.type) && property !== null && owner.selfNames.has(property.text)
  );
}

function measurementFrom(tally: Tally): FunctionMeasurement {
  const { node, rule } = tally;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const body = normalize(node.childForFieldName(rule.bodyField)?.text ?? '');
  let cognitive = tally.cognitive;
  if (tally.recursive) {
    cognitive += 1;
  }
  return {
    name: tally.name,
    startLine,
    endLine,
    metrics: {
      cognitive,
      cyclomatic: tally.cyclomatic,
      lines: endLine - startLine + 1,
      maxNesting: tally.maxNesting,
      parameters: countParameters(node, rule),
    },
    textHash: digest(normalize(node.text)),
    bodyHash: digest(body),
    bodyLength: body.length,
  };
}

function countParameters(node: ImpactNode, rule: FunctionRule): number {
  const list = node.childForFieldName(rule.parametersField);
  if (list === null) {
    const { parameterField } = rule;
    if (parameterField === undefined || node.childForFieldName(parameterField) === null) {
      return 0;
    }
    return 1;
  }
  return list.children.filter((child) => child.isNamed && child.type !== 'comment').length;
}

/** Appends `#2`, `#3` … to repeated names (overload implementations, same-named callbacks). */
function deduplicate(measurements: readonly FunctionMeasurement[]): readonly FunctionMeasurement[] {
  const seen = new Map<string, number>();
  return measurements.map((measurement) => {
    const count = (seen.get(measurement.name) ?? 0) + 1;
    seen.set(measurement.name, count);
    if (count === 1) {
      return measurement;
    }
    return { ...measurement, name: `${measurement.name}#${String(count)}` };
  });
}

function fieldText(node: ImpactNode, field: string): string | undefined {
  const child = node.childForFieldName(field);
  if (child === null) {
    return undefined;
  }
  return shorten(child.text);
}

function shorten(text: string): string {
  const single = text.slice(0, maxNameLength * 4).replaceAll(/\s+/gu, ' ');
  if (single.length > maxNameLength) {
    return `${single.slice(0, maxNameLength - 1)}…`;
  }
  return single;
}

function normalize(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function digest(text: string): string {
  return createHash('sha1').update(text).digest('base64url');
}
