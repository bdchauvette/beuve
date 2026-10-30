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
  return builder.probes.length > probeLimit
    ? err({ kind: 'too-large', probeLimit })
    : ok({ path: request.path, functions, probes: builder.probes, edits: builder.edits });
}

function findTargets(
  root: TraceSyntaxNode,
  changedLines: ReadonlySet<number>,
  rules: TraceRules,
): Target[] {
  const found: { node: TraceSyntaxNode; depth: number }[] = [];
  const pending = [{ node: root, depth: 0 }];
  for (let visit = pending.pop(); visit !== undefined; visit = pending.pop()) {
    const isFunction = rules.functions[visit.node.type] !== undefined;
    if (isFunction) {
      found.push(visit);
    }
    for (const child of visit.node.children) {
      pending.push({ node: child, depth: visit.depth + (isFunction ? 1 : 0) });
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
    inHunk: isTouched(builder, node.startPosition.row, body.startPosition.row),
    parameters: parameters.map((parameter) => parameter.name),
  });
  const values = parameters.map((parameter) => parameter.value).join(',');
  const opening = `const ${frame}=${recorder}.enter(${String(enter.id)},[${values}]);try{`;
  const closing =
    `}catch(${caught}){throw ${recorder}.unwind(${frame},${caught})}` +
    `finally{${recorder}.exit(${frame})}`;
  const span = body.endIndex - body.startIndex;
  if (rules.blocks.includes(body.type)) {
    addEdit(builder, bodyStart(body, rules), opening, 'open', span);
    addEdit(builder, body.endIndex - 1, closing, 'close', span);
  } else {
    const returned = addProbe(builder, {
      kind: 'return',
      fn: index,
      line: body.startPosition.row + 1,
      label: label(body.text),
      inHunk: isTouched(builder, body.startPosition.row, body.endPosition.row),
    });
    const returning = `return ${recorder}.returns(${frame},${String(returned.id)},(`;
    addEdit(builder, body.startIndex, `{${opening}${returning}`, 'open', span);
    addEdit(builder, body.endIndex, `))${closing}}`, 'close', span);
  }
  planBody(builder, body, index);
  return traced;
}

function functionName(node: TraceSyntaxNode, rules: TraceRules): string {
  let own = node.childForFieldName(rules.nameField)?.text;
  const parent = node.parent;
  const namer = parent === null ? undefined : rules.namers[parent.type];
  if (own === undefined && parent !== null && namer !== undefined) {
    own = parent.childForFieldName(namer)?.text;
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
): { name: string; value: string }[] {
  const { parameters } = rules;
  const lone =
    rule.parameterField === undefined ? undefined : node.childForFieldName(rule.parameterField);
  const declared =
    rule.parametersField === undefined ? undefined : node.childForFieldName(rule.parametersField);
  const list =
    lone === undefined || lone === null
      ? (declared?.children ?? []).filter(
          (child) => child.isNamed && !rules.skipped.includes(child.type),
        )
      : [lone];
  const read: { name: string; value: string }[] = [];
  for (const parameter of list) {
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
      const value = rule.hasArguments ? `arguments[${String(position)}]` : 'undefined';
      read.push({ name: label(inner.text), value });
    }
  }
  return read;
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
      planConstruct(builder, node, construct, fn);
    }
    for (const child of node.children.toReversed()) {
      pending.push(child);
    }
  }
}

function planConstruct(
  builder: Builder,
  node: TraceSyntaxNode,
  rule: ConstructRule,
  fn: number,
): void {
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
          inHunk: isTouched(builder, condition.startPosition.row, condition.endPosition.row),
        });
        wrapValue(builder, condition, `branch(${frame},${String(probe.id)},(`, rule.kind === 'if');
      }
      return;
    }
    case 'switch': {
      planSwitch(builder, node, rule, fn);
      return;
    }
    case 'loop': {
      planLoop(builder, node, rule.bodyField, fn);
      return;
    }
    case 'catch': {
      const body = node.childForFieldName(rule.bodyField);
      if (body === null) {
        return;
      }
      const parameter = node.childForFieldName(rule.parameterField);
      const value =
        parameter !== null && builder.rules.parameters.identifiers.includes(parameter.type)
          ? parameter.text
          : 'undefined';
      const probe = addProbe(builder, {
        kind: 'catch',
        fn,
        line,
        label: label(node.text.slice(0, body.startIndex - node.startIndex)),
        inHunk: isTouched(builder, node.startPosition.row, body.startPosition.row),
      });
      const text = `${recorder}.caught(${frame},${String(probe.id)},${value});`;
      addEdit(builder, body.startIndex + 1, text, 'open', node.endIndex - node.startIndex);
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
        inHunk: isTouched(builder, node.startPosition.row, node.endPosition.row),
      });
      const method = kind === 'return' ? 'returns' : 'throws';
      const value = node.children.find(
        (child, position) =>
          position > 0 && child.isNamed && !builder.rules.skipped.includes(child.type),
      );
      if (value === undefined) {
        const [keyword] = node.children;
        const text = ` ${recorder}.${method}(${frame},${String(probe.id)},undefined)`;
        addEdit(builder, keyword?.endIndex ?? node.startIndex, text, 'open', 0);
        return;
      }
      wrapValue(builder, value, `${method}(${frame},${String(probe.id)},(`, false);
      return;
    }
  }
}

function planSwitch(
  builder: Builder,
  node: TraceSyntaxNode,
  rule: Extract<ConstructRule, { kind: 'switch' }>,
  fn: number,
): void {
  const value = node.childForFieldName(rule.valueField);
  if (value !== null) {
    const probe = addProbe(builder, {
      kind: 'switch',
      fn,
      line: node.startPosition.row + 1,
      label: label(inner(value, builder.rules).text),
      inHunk: isTouched(builder, value.startPosition.row, value.endPosition.row),
    });
    wrapValue(builder, value, `value(${frame},${String(probe.id)},(`, true);
  }
  const cases = node.childForFieldName(rule.bodyField)?.children ?? [];
  for (const clause of cases) {
    const caseRule = rule.cases[clause.type];
    const delimiter = clause.children.find(
      (child) => !child.isNamed && child.type === rule.caseDelimiter,
    );
    if (caseRule === undefined || delimiter === undefined) {
      continue;
    }
    const isDefault =
      caseRule.valueField === undefined || clause.childForFieldName(caseRule.valueField) === null;
    const probe = addProbe(builder, {
      kind: isDefault ? 'default' : 'case',
      fn,
      line: clause.startPosition.row + 1,
      label: label(clause.text.slice(0, delimiter.startIndex - clause.startIndex)),
      inHunk: isTouched(builder, clause.startPosition.row, delimiter.startPosition.row),
    });
    const text = `${recorder}.mark(${frame},${String(probe.id)});`;
    addEdit(builder, delimiter.endIndex, text, 'open', clause.endIndex - clause.startIndex);
  }
}

function planLoop(builder: Builder, node: TraceSyntaxNode, bodyField: string, fn: number): void {
  const body = node.childForFieldName(bodyField);
  if (body === null) {
    return;
  }
  const head = node.text.slice(0, body.startIndex - node.startIndex);
  const tail = node.text.slice(body.endIndex - node.startIndex);
  const probe = addProbe(builder, {
    kind: 'loop',
    fn,
    line: node.startPosition.row + 1,
    label: label(tail.trim() === '' ? head : `${head} … ${tail}`),
    inHunk: isTouched(builder, node.startPosition.row, body.startPosition.row),
  });
  let outer = node;
  while (outer.parent !== null && builder.rules.labels.includes(outer.parent.type)) {
    outer = outer.parent;
  }
  const id = String(probe.id);
  const outerSpan = outer.endIndex - outer.startIndex;
  addEdit(builder, outer.startIndex, `{${recorder}.loop(${frame},${id});`, 'open', outerSpan);
  addEdit(builder, outer.endIndex, '}', 'close', outerSpan);
  const bodySpan = body.endIndex - body.startIndex;
  addEdit(builder, body.startIndex, `{${recorder}.iterate(${frame},${id});`, 'open', bodySpan);
  addEdit(builder, body.endIndex, '}', 'close', bodySpan);
}

/** Wraps an expression in a recorder call that returns it; `isDelimited` keeps `if (…)` parens. */
function wrapValue(
  builder: Builder,
  node: TraceSyntaxNode,
  call: string,
  isDelimited: boolean,
): void {
  const isKeepsDelimiters = isDelimited && builder.rules.delimited.includes(node.type);
  const start = isKeepsDelimiters ? node.startIndex + 1 : node.startIndex;
  const end = isKeepsDelimiters ? node.endIndex - 1 : node.endIndex;
  addEdit(builder, start, `${recorder}.${call}`, 'open', end - start);
  addEdit(builder, end, '))', 'close', end - start);
}

function inner(node: TraceSyntaxNode, rules: TraceRules): TraceSyntaxNode {
  return rules.delimited.includes(node.type)
    ? (node.children.find((child) => child.isNamed) ?? node)
    : node;
}

function addProbe(builder: Builder, probe: Omit<Probe, 'id'>): Probe {
  const added = { id: builder.probes.length, ...probe };
  builder.probes.push(added);
  return added;
}

function addEdit(
  builder: Builder,
  offset: number,
  text: string,
  side: SourceEdit['side'],
  span: number,
): void {
  builder.edits.push({ offset, text, side, span, order: builder.edits.length });
}

/** Any changed line within zero-based rows `from`..`to`. */
function isTouched(builder: Builder, from: number, to: number): boolean {
  for (let row = from; row <= to; row += 1) {
    if (builder.changedLines.has(row + 1)) {
      return true;
    }
  }
  return false;
}

function label(text: string): string {
  const flat = text.replaceAll(/\s+/gu, ' ').trim();
  return flat.length <= labelLength ? flat : `${flat.slice(0, labelLength - 1)}…`;
}
