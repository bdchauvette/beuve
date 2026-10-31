import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type {
  InstrumentationPlan,
  Probe,
  ProbeKind,
  SourceEdit,
  TracedFunction,
} from './instrumentation-plan.ts';
import { traceGlobalName } from './trace-global-name.ts';
import type { ConstructRule, FunctionRule, TraceRules } from './trace-rules.ts';
import type { TraceSyntaxNode } from './trace-syntax-node.ts';

export interface PlanRequest {
  /** Repository-relative path, carried into the plan. */
  readonly path: string;
  /** One-based head lines the hunk touches. */
  readonly changedLines: ReadonlySet<number>;
  /** More probes than this refuse with `too-large`. Defaults to 400. */
  readonly maxProbes?: number;
}

export type PlanFailure =
  { readonly kind: 'no-function' } | { readonly kind: 'too-large'; readonly probeLimit: number };

interface Target {
  readonly node: TraceSyntaxNode;
  readonly rule: FunctionRule;
}

interface Builder {
  readonly rules: TraceRules;
  readonly changedLines: ReadonlySet<number>;
  readonly probes: Probe[];
  readonly edits: SourceEdit[];
}

const recorder = `globalThis.${traceGlobalName}`;
const frame = '__beuveFrame';
const caught = '__beuveError';
const labelLength = 60;

/**
 * Plans the instrumentation of every function that innermost-encloses a changed line (ADR 0036):
 * an `enter` probe with the parameters, and a probe per `if`, ternary, `switch` and case, loop,
 * `catch`, `return` and `throw` in the function's own body (nested functions are traced only when
 * they are targets themselves). Each function body is wrapped so returns and exceptions, including
 * those thrown by callees, end its frame. Insertions never add a line break.
 */
export function planInstrumentation(
  root: TraceSyntaxNode,
  request: PlanRequest,
  rules: TraceRules,
): Result<InstrumentationPlan, PlanFailure> {
  const targets = findTargets(root, request.changedLines, rules);
  if (targets.length === 0) {
    return err({ kind: 'no-function' });
  }
  const builder: Builder = { rules, changedLines: request.changedLines, probes: [], edits: [] };
  const functions = targets.map((target, index) => planFunction(builder, target, index));
  const probeLimit = request.maxProbes ?? 400;
  if (builder.probes.length > probeLimit) {
    return err({ kind: 'too-large', probeLimit });
  }
  return ok({ path: request.path, functions, probes: builder.probes, edits: builder.edits });
}

function findTargets(
  root: TraceSyntaxNode,
  changedLines: ReadonlySet<number>,
  rules: TraceRules,
): Target[] {
  const found: { node: TraceSyntaxNode; depth: number }[] = [];
  const pending = [{ node: root, depth: 0 }];
  for (let visit = pending.pop(); visit !== undefined; visit = pending.pop()) {
    let { depth } = visit;
    if (rules.functions[visit.node.type] !== undefined) {
      found.push(visit);
      depth += 1;
    }
    for (const child of visit.node.children) {
      pending.push({ node: child, depth });
    }
  }
  const chosen = new Map<number, TraceSyntaxNode>();
  for (const line of changedLines) {
    const row = line - 1;
    let best: { node: TraceSyntaxNode; depth: number } | undefined;
    for (const candidate of found) {
      const { startPosition, endPosition } = candidate.node;
      if (
        startPosition.row <= row &&
        row <= endPosition.row &&
        (best === undefined || candidate.depth > best.depth)
      ) {
        best = candidate;
      }
    }
    if (best !== undefined) {
      chosen.set(best.node.id, best.node);
    }
  }
  const targets: Target[] = [];
  for (const node of chosen.values()) {
    const rule = rules.functions[node.type];
    if (rule !== undefined && node.childForFieldName(rule.bodyField) !== null) {
      targets.push({ node, rule });
    }
  }
  return targets.toSorted((left, right) => left.node.startIndex - right.node.startIndex);
}

function planFunction(builder: Builder, target: Target, index: number): TracedFunction {
  const { node, rule } = target;
  const { rules } = builder;
  const body = node.childForFieldName(rule.bodyField);
  const name = functionName(node, rules);
  const traced: TracedFunction = {
    index,
    name,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
  if (body === null) {
    return traced;
  }
  const parameters = readParameters(node, rule, rules);
  const enter = addProbe(builder, {
    kind: 'enter',
    fn: index,
    line: traced.startLine,
    label: name,
    inHunk: isTouched(builder, rowsBetween(node, body)),
    parameters: parameters.map((parameter) => parameter.name),
  });
  const values = parameters.map((parameter) => parameter.value).join(',');
  const opening = `const ${frame}=${recorder}.enter(${String(enter.id)},[${values}]);try{`;
  const closing =
    `}catch(${caught}){throw ${recorder}.unwind(${frame},${caught})}` +
    `finally{${recorder}.exit(${frame})}`;
  const span = body.endIndex - body.startIndex;
  if (rules.blocks.includes(body.type)) {
    addEdit(builder, { offset: bodyStart(body, rules), text: opening, side: 'open', span });
    addEdit(builder, { offset: body.endIndex - 1, text: closing, side: 'close', span });
  } else {
    const returned = addProbe(builder, {
      kind: 'return',
      fn: index,
      line: body.startPosition.row + 1,
      label: label(body.text),
      inHunk: isTouched(builder, nodeRows(body)),
    });
    const returning = `return ${recorder}.returns(${frame},${String(returned.id)},(`;
    addEdit(builder, {
      offset: body.startIndex,
      text: `{${opening}${returning}`,
      side: 'open',
      span,
    });
    addEdit(builder, { offset: body.endIndex, text: `))${closing}}`, side: 'close', span });
  }
  planBody(builder, body, index);
  return traced;
}

function functionName(node: TraceSyntaxNode, rules: TraceRules): string {
  let own = node.childForFieldName(rules.nameField)?.text;
  const parent = node.parent;
  if (own === undefined && parent !== null) {
    const namer = rules.namers[parent.type];
    if (namer !== undefined) {
      own = parent.childForFieldName(namer)?.text;
    }
  }
  const scopes: string[] = [];
  for (let ancestor = node.parent; ancestor !== null; ancestor = ancestor.parent) {
    if (!rules.scopes.includes(ancestor.type)) {
      continue;
    }

    const scope = ancestor.childForFieldName(rules.nameField)?.text;
    if (scope !== undefined) {
      scopes.unshift(scope);
    }
  }
  return [...scopes, own ?? '<anonymous>'].join('.');
}

function readParameters(
  node: TraceSyntaxNode,
  rule: FunctionRule,
  rules: TraceRules,
): ParameterRead[] {
  const { parameters } = rules;
  const read: ParameterRead[] = [];
  for (const parameter of parameterNodes(node, rule, rules)) {
    let inner = unwrapParameter(parameter, parameters.wrappers);
    if (inner === undefined || parameters.ignored.includes(inner.type)) {
      continue;
    }
    const position = read.length;
    if (parameters.rest.includes(inner.type)) {
      inner = inner.children.find((child) => parameters.identifiers.includes(child.type)) ?? inner;
    }
    if (parameters.identifiers.includes(inner.type)) {
      read.push({ name: inner.text, value: inner.text });
    } else {
      let value = 'undefined';
      if (rule.hasArguments) {
        value = `arguments[${String(position)}]`;
      }
      read.push({ name: label(inner.text), value });
    }
  }
  return read;
}

/** How a traced parameter is shown, and the expression that reads its value at entry. */
interface ParameterRead {
  readonly name: string;
  readonly value: string;
}

/** A function's parameter nodes: its lone parameter (an arrow's `x`), or its list's. */
function parameterNodes(
  node: TraceSyntaxNode,
  rule: FunctionRule,
  rules: TraceRules,
): readonly TraceSyntaxNode[] {
  if (rule.parameterField !== undefined) {
    const lone = node.childForFieldName(rule.parameterField);
    if (lone !== null) {
      return [lone];
    }
  }
  if (rule.parametersField === undefined) {
    return [];
  }
  const declared = node.childForFieldName(rule.parametersField);
  return (declared?.children ?? []).filter((child) => {
    return child.isNamed && !rules.skipped.includes(child.type);
  });
}

function unwrapParameter(
  parameter: TraceSyntaxNode,
  wrappers: Readonly<Record<string, string>>,
): TraceSyntaxNode | undefined {
  let current = parameter;
  for (let field = wrappers[current.type]; field !== undefined; field = wrappers[current.type]) {
    const inner = current.childForFieldName(field);
    if (inner === null) {
      return undefined;
    }
    current = inner;
  }
  return current;
}

function bodyStart(body: TraceSyntaxNode, rules: TraceRules): number {
  let start = body.startIndex + 1;
  for (const child of body.children) {
    if (!child.isNamed || rules.skipped.includes(child.type)) {
      continue;
    }
    const isDirective =
      child.type === rules.directive.statement &&
      child.children.find((part) => part.isNamed)?.type === rules.directive.string;
    if (!isDirective) {
      break;
    }
    start = child.endIndex;
  }
  return start;
}

function planBody(builder: Builder, body: TraceSyntaxNode, fn: number): void {
  const { rules } = builder;
  const pending = [body];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (rules.functions[node.type] !== undefined) {
      continue;
    }
    const construct = rules.constructs[node.type];
    if (construct !== undefined) {
      planConstruct({ ...builder, fn }, node, construct);
    }
    for (const child of node.children.toReversed()) {
      pending.push(child);
    }
  }
}

/** A builder working inside one traced function, whose probes it numbers. */
interface FunctionBuilder extends Builder {
  readonly fn: number;
}

function planConstruct(builder: FunctionBuilder, node: TraceSyntaxNode, rule: ConstructRule): void {
  const { fn } = builder;
  const line = node.startPosition.row + 1;
  switch (rule.kind) {
    case 'if':
    case 'ternary': {
      const condition = node.childForFieldName(rule.conditionField);
      if (condition !== null) {
        const probe = addProbe(builder, {
          kind: rule.kind,
          fn,
          line,
          label: label(inner(condition, builder.rules).text),
          inHunk: isTouched(builder, nodeRows(condition)),
        });
        wrapValue(builder, condition, {
          call: `branch(${frame},${String(probe.id)},(`,
          isDelimited: rule.kind === 'if',
        });
      }
      return;
    }
    case 'switch': {
      planSwitch(builder, node, rule);
      return;
    }
    case 'loop': {
      planLoop(builder, node, rule.bodyField);
      return;
    }
    case 'catch': {
      const body = node.childForFieldName(rule.bodyField);
      if (body === null) {
        return;
      }
      const parameter = node.childForFieldName(rule.parameterField);
      let value = 'undefined';
      if (parameter !== null && builder.rules.parameters.identifiers.includes(parameter.type)) {
        value = parameter.text;
      }
      const probe = addProbe(builder, {
        kind: 'catch',
        fn,
        line,
        label: label(node.text.slice(0, body.startIndex - node.startIndex)),
        inHunk: isTouched(builder, rowsBetween(node, body)),
      });
      addEdit(builder, {
        offset: body.startIndex + 1,
        text: `${recorder}.caught(${frame},${String(probe.id)},${value});`,
        side: 'open',
        span: node.endIndex - node.startIndex,
      });
      return;
    }
    case 'return':
    case 'throw': {
      const kind: ProbeKind = rule.kind;
      const probe = addProbe(builder, {
        kind,
        fn,
        line,
        label: label(node.text),
        inHunk: isTouched(builder, nodeRows(node)),
      });
      const method = exitMethods[rule.kind];
      const value = node.children.find((child, position) => {
        return position > 0 && child.isNamed && !builder.rules.skipped.includes(child.type);
      });
      if (value === undefined) {
        const [keyword] = node.children;
        addEdit(builder, {
          offset: keyword?.endIndex ?? node.startIndex,
          text: ` ${recorder}.${method}(${frame},${String(probe.id)},undefined)`,
          side: 'open',
          span: 0,
        });
        return;
      }
      wrapValue(builder, value, {
        call: `${method}(${frame},${String(probe.id)},(`,
        isDelimited: false,
      });
      return;
    }
  }
}

function planSwitch(
  builder: FunctionBuilder,
  node: TraceSyntaxNode,
  rule: Extract<ConstructRule, { kind: 'switch' }>,
): void {
  const { fn } = builder;
  const value = node.childForFieldName(rule.valueField);
  if (value !== null) {
    const probe = addProbe(builder, {
      kind: 'switch',
      fn,
      line: node.startPosition.row + 1,
      label: label(inner(value, builder.rules).text),
      inHunk: isTouched(builder, nodeRows(value)),
    });
    wrapValue(builder, value, { call: `value(${frame},${String(probe.id)},(`, isDelimited: true });
  }
  const cases = node.childForFieldName(rule.bodyField)?.children ?? [];
  for (const clause of cases) {
    const caseRule = rule.cases[clause.type];
    const delimiter = clause.children.find((child) => {
      return !child.isNamed && child.type === rule.caseDelimiter;
    });
    if (caseRule === undefined || delimiter === undefined) {
      continue;
    }
    const isDefault =
      caseRule.valueField === undefined || clause.childForFieldName(caseRule.valueField) === null;
    let kind: ProbeKind = 'case';
    if (isDefault) {
      kind = 'default';
    }
    const probe = addProbe(builder, {
      kind,
      fn,
      line: clause.startPosition.row + 1,
      label: label(clause.text.slice(0, delimiter.startIndex - clause.startIndex)),
      inHunk: isTouched(builder, rowsBetween(clause, delimiter)),
    });
    addEdit(builder, {
      offset: delimiter.endIndex,
      text: `${recorder}.mark(${frame},${String(probe.id)});`,
      side: 'open',
      span: clause.endIndex - clause.startIndex,
    });
  }
}

function planLoop(builder: FunctionBuilder, node: TraceSyntaxNode, bodyField: string): void {
  const body = node.childForFieldName(bodyField);
  if (body === null) {
    return;
  }
  const head = node.text.slice(0, body.startIndex - node.startIndex);
  const tail = node.text.slice(body.endIndex - node.startIndex);
  let shown = head;
  if (tail.trim() !== '') {
    shown = `${head} … ${tail}`;
  }
  const probe = addProbe(builder, {
    kind: 'loop',
    fn: builder.fn,
    line: node.startPosition.row + 1,
    label: label(shown),
    inHunk: isTouched(builder, rowsBetween(node, body)),
  });
  let outer = node;
  while (outer.parent !== null && builder.rules.labels.includes(outer.parent.type)) {
    outer = outer.parent;
  }
  const id = String(probe.id);
  const outerSpan = outer.endIndex - outer.startIndex;
  addEdit(builder, {
    offset: outer.startIndex,
    text: `{${recorder}.loop(${frame},${id});`,
    side: 'open',
    span: outerSpan,
  });
  addEdit(builder, { offset: outer.endIndex, text: '}', side: 'close', span: outerSpan });
  const bodySpan = body.endIndex - body.startIndex;
  addEdit(builder, {
    offset: body.startIndex,
    text: `{${recorder}.iterate(${frame},${id});`,
    side: 'open',
    span: bodySpan,
  });
  addEdit(builder, { offset: body.endIndex, text: '}', side: 'close', span: bodySpan });
}

/** The recorder call that wraps a value, and whether the node's own `if (…)` parens stay. */
interface ValueWrap {
  readonly call: string;
  readonly isDelimited: boolean;
}

/** Wraps an expression in a recorder call that returns it; `isDelimited` keeps `if (…)` parens. */
function wrapValue(
  builder: Builder,
  node: TraceSyntaxNode,
  { call, isDelimited }: ValueWrap,
): void {
  let start = node.startIndex;
  let end = node.endIndex;
  if (isDelimited && builder.rules.delimited.includes(node.type)) {
    start += 1;
    end -= 1;
  }
  addEdit(builder, { offset: start, text: `${recorder}.${call}`, side: 'open', span: end - start });
  addEdit(builder, { offset: end, text: '))', side: 'close', span: end - start });
}

function inner(node: TraceSyntaxNode, rules: TraceRules): TraceSyntaxNode {
  if (rules.delimited.includes(node.type)) {
    return node.children.find((child) => child.isNamed) ?? node;
  }
  return node;
}

function addProbe(builder: Builder, probe: Omit<Probe, 'id'>): Probe {
  const added = { id: builder.probes.length, ...probe };
  builder.probes.push(added);
  return added;
}

function addEdit(builder: Builder, edit: Omit<SourceEdit, 'order'>): void {
  builder.edits.push({ ...edit, order: builder.edits.length });
}

/** Zero-based rows, both ends included. */
interface RowSpan {
  readonly first: number;
  readonly last: number;
}

function nodeRows(node: TraceSyntaxNode): RowSpan {
  return { first: node.startPosition.row, last: node.endPosition.row };
}

/** The rows from where `start` begins to where `end` begins: a construct's header. */
function rowsBetween(start: TraceSyntaxNode, end: TraceSyntaxNode): RowSpan {
  return { first: start.startPosition.row, last: end.startPosition.row };
}

/** Any changed line within the rows. */
function isTouched(builder: Builder, { first, last }: RowSpan): boolean {
  for (let row = first; row <= last; row += 1) {
    if (builder.changedLines.has(row + 1)) {
      return true;
    }
  }
  return false;
}

function label(text: string): string {
  const flat = text.replaceAll(/\s+/gu, ' ').trim();
  if (flat.length <= labelLength) {
    return flat;
  }
  return `${flat.slice(0, labelLength - 1)}…`;
}

const exitMethods = { return: 'returns', throw: 'throws' } as const;
