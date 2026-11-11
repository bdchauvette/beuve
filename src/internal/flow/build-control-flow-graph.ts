import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type {
  ControlFlowGraph,
  FlowEdgeKind,
  FlowFailure,
  FlowGraphEdge,
  FlowGraphNode,
  FlowNodeKind,
} from './control-flow-graph.ts';
import type { CaseRule, FlowRules, StatementRule } from './flow-rules.ts';
import type { FlowSyntaxNode } from './flow-syntax-node.ts';
import { summarizeSource } from './summarize-source.ts';

export interface FlowOptions {
  /** One-based lines to mark: the lines the review changed. */
  readonly changedLines: ReadonlySet<number>;
  /** Largest graph to build; bigger functions give a `too-large` failure. Default 200. */
  readonly maxNodes?: number;
}

const defaultMaxNodes = 200;
const maxLabelLength = 40;

/**
 * Builds the control-flow graph of one function (ADR 0028): straight-line statements merge into
 * blocks, branches and loops get their own nodes, nested functions stay inside their block's label.
 * Expected failures (`too-large`, a node that is no function) are results, not exceptions.
 */
export function buildControlFlowGraph(
  functionNode: FlowSyntaxNode,
  rules: FlowRules,
  options: FlowOptions,
): Result<ControlFlowGraph, FlowFailure> {
  if (!rules.functions.includes(functionNode.type)) {
    return err({ kind: 'unsupported', reason: `${functionNode.type} is not a function` });
  }
  const body = functionNode.childForFieldName(rules.bodyField);
  if (body === null) {
    return err({ kind: 'unsupported', reason: 'the function has no body' });
  }
  return new ControlFlowBuilder(rules, options).build({ node: functionNode, body });
}

/** A statement, or a function, and the body its header precedes. */
interface Bodied {
  readonly node: FlowSyntaxNode;
  readonly body: FlowSyntaxNode;
}

/** An edge waiting for its target: the next node created becomes where it points. */
interface Pending {
  readonly from: number;
  readonly kind: FlowEdgeKind;
}

interface JumpRequest {
  readonly kind: 'return' | 'throw' | 'break' | 'continue';
  readonly label: string | undefined;
}

/** Something `break` or `continue` can leave: a loop, a switch or a labeled statement. */
interface JumpScope {
  readonly kind: 'loop' | 'switch' | 'label';
  readonly labels: readonly string[];
  /** Where `continue` goes; loops only. */
  readonly continueTo: number | undefined;
  readonly breaks: Pending[];
}

/** An enclosing `try`: where exceptions go and which finalizer abrupt exits must pass through. */
interface TryScope {
  readonly kind: 'try';
  region: 'body' | 'catch';
  readonly catchId: number | undefined;
  readonly finallyId: number | undefined;
  /** Jumps that entered the finalizer and still have to leave it. */
  readonly abrupt: JumpRequest[];
}

type Scope = JumpScope | TryScope;

interface Draft {
  readonly id: number;
  readonly kind: FlowNodeKind;
  readonly label: string;
  readonly startLine: number;
  readonly endLine: number;
  statements: number;
}

interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

class ControlFlowBuilder {
  private readonly rules: FlowRules;
  private readonly changedLines: ReadonlySet<number>;
  private readonly maxNodes: number;
  private readonly drafts: Draft[] = [];
  private readonly edges: FlowGraphEdge[] = [];
  private readonly edgeKeys = new Set<string>();
  private readonly scopes: Scope[] = [];
  /** Labels waiting for the loop or switch they name. */
  private pendingLabels: string[] = [];
  /** The next straight-line statement must start a new block (a loop-back target). */
  private sealed = false;
  private exitId = -1;

  constructor(rules: FlowRules, options: FlowOptions) {
    this.rules = rules;
    this.changedLines = options.changedLines;
    this.maxNodes = options.maxNodes ?? defaultMaxNodes;
  }

  private finish(name: string, functionNode: FlowSyntaxNode): ControlFlowGraph {
    const reachable = this.reachableFromEntry();
    const kept = this.drafts.filter((draft) => reachable.has(draft.id) || draft.id === this.exitId);
    const renumbered = new Map(
      kept.map((draft, index) => {
        return [draft.id, index];
      }),
    );
    const nodes: FlowGraphNode[] = kept.map((draft, index) => {
      return {
        id: index,
        kind: draft.kind,
        label: labelOf(draft),
        startLine: draft.startLine,
        endLine: draft.endLine,
        changed: this.touchesChange(draft),
      };
    });
    const edges: FlowGraphEdge[] = [];
    for (const edge of this.edges) {
      const from = renumbered.get(edge.from);
      const to = renumbered.get(edge.to);
      if (from !== undefined && to !== undefined) {
        edges.push({ from, to, kind: edge.kind });
      }
    }
    return {
      name,
      startLine: functionNode.startPosition.row + 1,
      endLine: functionNode.endPosition.row + 1,
      nodes,
      edges,
    };
  }

  private reachableFromEntry(): Set<number> {
    const seen = new Set<number>([0]);
    const queue = [0];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      for (const edge of this.edges) {
        if (edge.from !== next || seen.has(edge.to)) {
          continue;
        }

        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    return seen;
  }

  private touchesChange(range: LineRange): boolean {
    for (let line = range.startLine; line <= range.endLine; line++) {
      if (this.changedLines.has(line)) {
        return true;
      }
    }
    return false;
  }

  private nameOf(functionNode: FlowSyntaxNode): string {
    const own = functionNode.childForFieldName(this.rules.nameField);
    if (own !== null) {
      return summarizeSource(own.text, maxLabelLength);
    }
    const parent = functionNode.parent;
    if (parent === null) {
      return '';
    }
    const assigned = fieldOf(parent, this.rules.namers[parent.type]);
    if (assigned === undefined) {
      return '';
    }
    return summarizeSource(assigned.text, maxLabelLength);
  }

  private lowerStatements(statements: readonly FlowSyntaxNode[], pendings: Pending[]): Pending[] {
    let current = pendings;
    for (const statement of statements) {
      if (current.length === 0 || this.drafts.length > this.maxNodes) {
        break;
      }
      current = this.lowerStatement(statement, current);
    }
    return current;
  }

  private lowerStatement(node: FlowSyntaxNode, pendings: Pending[]): Pending[] {
    if (this.rules.skipped.includes(node.type)) {
      return pendings;
    }
    if (this.rules.blocks.includes(node.type)) {
      return this.lowerStatements(this.statementsOf(node), pendings);
    }
    const rule = this.rules.statements[node.type];
    if (rule === undefined) {
      return this.lowerSimple(node, pendings);
    }
    switch (rule.kind) {
      case 'if': {
        return this.lowerIf(node, rule, pendings);
      }
      case 'loop': {
        return this.lowerLoop(node, rule, pendings);
      }
      case 'switch': {
        return this.lowerSwitch(node, rule, pendings);
      }
      case 'try': {
        return this.lowerTry(node, rule, pendings);
      }
      case 'return':
      case 'throw': {
        return this.lowerLeaf(rule.kind, node, pendings);
      }
      case 'break':
      case 'continue': {
        return this.lowerJump(node, rule, pendings);
      }
      case 'labeled': {
        return this.lowerLabeled(node, rule, pendings);
      }
    }
  }

  private lowerSimple(node: FlowSyntaxNode, pendings: Pending[]): Pending[] {
    const open = this.openDraft(pendings);
    if (!this.sealed && open?.kind === 'block') {
      open.statements++;
      this.drafts[open.id] = { ...open, endLine: node.endPosition.row + 1 };
      return pendings;
    }
    const id = this.addNode('block', summarizeSource(node.text, maxLabelLength), rangeOf(node));
    this.connect(pendings, id);
    return [{ from: id, kind: 'next' }];
  }

  /** The draft a lone `next` edge waits on: the block a straight-line statement can join. */
  private openDraft(pendings: readonly Pending[]): Draft | undefined {
    const [only, ...rest] = pendings;
    if (only?.kind !== 'next' || rest.length > 0) {
      return undefined;
    }
    return this.drafts[only.from];
  }

  private lowerLeaf(
    kind: 'return' | 'throw',
    node: FlowSyntaxNode,
    pendings: Pending[],
  ): Pending[] {
    const id = this.addNode(kind, summarizeSource(node.text, maxLabelLength), rangeOf(node));
    this.connect(pendings, id);
    this.route([id], { kind, label: undefined }, this.scopes.length - 1);
    return [];
  }

  private lowerJump(
    node: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'break' | 'continue' }>,
    pendings: Pending[],
  ): Pending[] {
    const [from] = this.lowerSimple(node, pendings);
    if (from !== undefined) {
      const label = node.childForFieldName(rule.labelField)?.text;
      this.route([from.from], { kind: rule.kind, label }, this.scopes.length - 1);
    }
    return [];
  }

  private lowerIf(
    node: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'if' }>,
    pendings: Pending[],
  ): Pending[] {
    const condition = node.childForFieldName(rule.conditionField);
    if (condition === null) {
      return this.lowerSimple(node, pendings);
    }
    const id = this.addNode('condition', this.conditionLabel(condition), rangeOf(condition));
    this.connect(pendings, id);
    const consequence = node.childForFieldName(rule.consequenceField);
    const alternative = node.childForFieldName(rule.alternativeField);
    const whenTrue: Pending[] = [{ from: id, kind: 'true' }];
    const whenFalse: Pending[] = [{ from: id, kind: 'false' }];
    let thenEnds = whenTrue;
    if (consequence !== null) {
      thenEnds = this.lowerStatement(consequence, whenTrue);
    }
    let elseBody: FlowSyntaxNode | undefined;
    if (alternative !== null) {
      elseBody = this.unwrap(alternative, rule.alternativeWrapper);
    }
    let elseEnds = whenFalse;
    if (elseBody !== undefined) {
      elseEnds = this.lowerStatement(elseBody, whenFalse);
    }
    return [...thenEnds, ...elseEnds];
  }

  private lowerLoop(
    node: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'loop' }>,
    pendings: Pending[],
  ): Pending[] {
    const body = node.childForFieldName(rule.bodyField);
    if (body === null) {
      return this.lowerSimple(node, pendings);
    }
    if (rule.form === 'pre') {
      return this.lowerPreLoop({ node, body }, pendings);
    }
    return this.lowerPostLoop({ node, body }, rule, pendings);
  }

  private lowerPreLoop(loop: Bodied, pendings: Pending[]): Pending[] {
    const id = this.addNode('loop', this.headerLabel(loop), headerRange(loop));
    this.connect(pendings, id);
    const scope = this.openJumpScope('loop', id);
    const ends = this.lowerStatement(loop.body, [{ from: id, kind: 'true' }]);
    this.scopes.pop();
    for (const end of ends) {
      this.addEdge({ from: end.from, to: id, kind: loopBackKind(end.kind) });
    }
    return [{ from: id, kind: 'false' }, ...scope.breaks];
  }

  private lowerPostLoop(
    { node, body }: Bodied,
    rule: Extract<StatementRule, { kind: 'loop' }>,
    pendings: Pending[],
  ): Pending[] {
    const condition = fieldOf(node, rule.conditionField);
    const id = this.addNode('loop', this.postLoopLabel(condition), rangeOf(condition ?? node));
    const firstBodyDraft = this.drafts.length;
    const scope = this.openJumpScope('loop', id);
    this.sealed = true;
    const ends = this.lowerStatement(body, pendings);
    this.sealed = false;
    this.scopes.pop();
    this.connect(ends, id);
    const first = this.drafts[firstBodyDraft];
    if (first !== undefined) {
      this.addEdge({ from: id, to: first.id, kind: 'loop-back' });
    }
    return [{ from: id, kind: 'false' }, ...scope.breaks];
  }

  private lowerSwitch(
    node: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'switch' }>,
    pendings: Pending[],
  ): Pending[] {
    const body = node.childForFieldName(rule.bodyField);
    if (body === null) {
      return this.lowerSimple(node, pendings);
    }
    const id = this.addNode(
      'switch',
      this.headerLabel({ node, body }),
      headerRange({ node, body }),
    );
    this.connect(pendings, id);
    const scope = this.openJumpScope('switch', undefined);
    let fallthrough: Pending[] = [];
    let hasDefault = false;
    for (const clause of body.children) {
      const caseRule = rule.cases[clause.type];
      if (caseRule === undefined) {
        continue;
      }
      const isDefault = caseRule.valueField === undefined;
      hasDefault ||= isDefault;
      const caseId = this.addNode(
        'case',
        this.caseLabel(clause, caseRule),
        caseRange(clause, caseRule),
      );
      this.addEdge({ from: id, to: caseId, kind: caseEdgeKind(isDefault) });
      this.connect(fallthrough, caseId);
      const statements = this.caseStatements(clause, caseRule);
      fallthrough = this.lowerStatements(statements, [{ from: caseId, kind: 'next' }]);
    }
    this.scopes.pop();
    const ends = [...fallthrough, ...scope.breaks];
    if (!hasDefault) {
      ends.push({ from: id, kind: 'default' });
    }
    return ends;
  }

  private lowerTry(
    node: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'try' }>,
    pendings: Pending[],
  ): Pending[] {
    const body = node.childForFieldName(rule.bodyField);
    if (body === null) {
      return this.lowerSimple(node, pendings);
    }
    const handler = node.childForFieldName(rule.handlerField);
    const finalizer = node.childForFieldName(rule.finalizerField);
    const tryId = this.addNode('try', 'try', headerRange({ node, body }));
    this.connect(pendings, tryId);
    let catchId: number | undefined;
    if (handler !== null) {
      catchId = this.addNode(
        'catch',
        this.clauseLabel(handler, rule),
        headerRange({ node: handler, body: this.clauseBody(handler, rule) }),
      );
    }
    let finallyId: number | undefined;
    if (finalizer !== null) {
      finallyId = this.addNode(
        'finally',
        'finally',
        headerRange({ node: finalizer, body: this.clauseBody(finalizer, rule) }),
      );
    }
    const scope: TryScope = { kind: 'try', region: 'body', catchId, finallyId, abrupt: [] };
    this.scopes.push(scope);
    let ends = this.lowerStatement(body, [{ from: tryId, kind: 'next' }]);
    if (handler !== null && catchId !== undefined) {
      this.addEdge({ from: tryId, to: catchId, kind: 'exception' });
      scope.region = 'catch';
      ends = [
        ...ends,
        ...this.lowerStatement(this.clauseBody(handler, rule), [{ from: catchId, kind: 'next' }]),
      ];
    } else if (finallyId !== undefined) {
      this.addEdge({ from: tryId, to: finallyId, kind: 'exception' });
      scope.abrupt.push({ kind: 'throw', label: undefined });
    }
    this.scopes.pop();
    if (finalizer === null || finallyId === undefined) {
      return ends;
    }
    this.connect(ends, finallyId);
    const finallyEnds = this.lowerStatement(this.clauseBody(finalizer, rule), [
      { from: finallyId, kind: 'next' },
    ]);
    const sources = [...new Set(finallyEnds.map((pending) => pending.from))];
    for (const request of scope.abrupt) {
      this.route(sources, request, this.scopes.length - 1);
    }
    if (ends.length === 0) {
      return [];
    }
    return finallyEnds;
  }

  private lowerLabeled(
    node: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'labeled' }>,
    pendings: Pending[],
  ): Pending[] {
    const label = node.childForFieldName(rule.labelField)?.text;
    const body = node.childForFieldName(rule.bodyField);
    if (label === undefined || body === null) {
      return this.lowerSimple(node, pendings);
    }
    const bodyRule = this.rules.statements[body.type];
    if (bodyRule?.kind === 'loop' || bodyRule?.kind === 'switch') {
      this.pendingLabels.push(label);
      return this.lowerStatement(body, pendings);
    }
    const scope = this.openJumpScope('label', undefined, [label]);
    const ends = this.lowerStatement(body, pendings);
    this.scopes.pop();
    return [...ends, ...scope.breaks];
  }

  private openJumpScope(
    kind: JumpScope['kind'],
    continueTo: number | undefined,
    labels: readonly string[] = this.pendingLabels,
  ): JumpScope {
    const scope: JumpScope = { kind, labels: [...labels], continueTo, breaks: [] };
    this.pendingLabels = [];
    this.scopes.push(scope);
    return scope;
  }

  /** Sends a jump from `sources` outwards from scope `depth`, through finalizers, to its target. */
  private route(sources: readonly number[], request: JumpRequest, depth: number): void {
    for (let index = depth; index >= 0; index--) {
      const scope = this.scopes[index];
      if (scope === undefined) {
        continue;
      }
      if (scope.kind === 'try') {
        if (this.routeThroughTry(sources, request, scope)) {
          return;
        }
      } else if (this.routeToScope(sources, request, scope)) {
        return;
      }
    }
    if (request.kind !== 'return' && request.kind !== 'throw') {
      return;
    }
    for (const source of sources) {
      this.addEdge({ from: source, to: this.exitId, kind: exitEdgeKinds[request.kind] });
    }
  }

  private routeThroughTry(
    sources: readonly number[],
    request: JumpRequest,
    scope: TryScope,
  ): boolean {
    if (request.kind === 'throw' && scope.region === 'body' && scope.catchId !== undefined) {
      for (const source of sources) {
        this.addEdge({ from: source, to: scope.catchId, kind: 'exception' });
      }
      return true;
    }
    if (scope.finallyId === undefined) {
      return false;
    }
    for (const source of sources) {
      this.addEdge({ from: source, to: scope.finallyId, kind: 'finally' });
    }
    const isKnown = scope.abrupt.some((other) => {
      return other.kind === request.kind && other.label === request.label;
    });
    if (!isKnown) {
      scope.abrupt.push(request);
    }
    return true;
  }

  private routeToScope(
    sources: readonly number[],
    request: JumpRequest,
    scope: JumpScope,
  ): boolean {
    const isNamed = request.label !== undefined;
    if (isNamed && !scope.labels.includes(request.label)) {
      return false;
    }
    if (request.kind === 'break') {
      if (!isNamed && scope.kind === 'label') {
        return false;
      }
      scope.breaks.push(
        ...sources.map((from): Pending => {
          return { from, kind: 'break' };
        }),
      );
      return true;
    }
    if (request.kind === 'continue' && scope.continueTo !== undefined) {
      for (const source of sources) {
        this.addEdge({ from: source, to: scope.continueTo, kind: 'continue' });
      }
      return true;
    }
    return false;
  }

  private addNode(kind: FlowNodeKind, label: string, range: LineRange): number {
    const id = this.drafts.length;
    this.drafts.push({ id, kind, label, ...range, statements: 1 });
    this.sealed = false;
    return id;
  }

  private connect(pendings: readonly Pending[], to: number): void {
    for (const pending of pendings) {
      this.addEdge({ from: pending.from, to, kind: pending.kind });
    }
  }

  private addEdge(edge: FlowGraphEdge): void {
    const key = `${String(edge.from)}>${String(edge.to)}:${edge.kind}`;
    if (this.edgeKeys.has(key)) {
      return;
    }

    this.edgeKeys.add(key);
    this.edges.push(edge);
  }

  private statementsOf(block: FlowSyntaxNode): readonly FlowSyntaxNode[] {
    return block.children.filter((child) => child.isNamed);
  }

  private unwrap(node: FlowSyntaxNode, wrapper: string): FlowSyntaxNode | undefined {
    if (node.type === wrapper) {
      return this.statementsOf(node).findLast((child) => !this.rules.skipped.includes(child.type));
    }
    return node;
  }

  private conditionLabel(condition: FlowSyntaxNode): string {
    let text = condition.text;
    if (this.rules.transparent.includes(condition.type)) {
      text = text.slice(1, -1);
    }
    return summarizeSource(text, maxLabelLength);
  }

  private postLoopLabel(condition: FlowSyntaxNode | undefined): string {
    if (condition === undefined) {
      return 'while';
    }
    return `while (${this.conditionLabel(condition)})`;
  }

  private headerLabel(statement: Bodied): string {
    return summarizeSource(headerText(statement), maxLabelLength);
  }

  private caseLabel(clause: FlowSyntaxNode, rule: CaseRule): string {
    const value = fieldOf(clause, rule.valueField);
    if (value === undefined) {
      return 'default';
    }
    return `case ${summarizeSource(value.text, maxLabelLength)}`;
  }

  private caseStatements(clause: FlowSyntaxNode, rule: CaseRule): readonly FlowSyntaxNode[] {
    const value = fieldOf(clause, rule.valueField);
    return this.statementsOf(clause).filter((child) => child.id !== value?.id);
  }

  private clauseBody(
    clause: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'try' }>,
  ): FlowSyntaxNode {
    return clause.childForFieldName(rule.clauseBodyField) ?? clause;
  }

  private clauseLabel(
    clause: FlowSyntaxNode,
    rule: Extract<StatementRule, { kind: 'try' }>,
  ): string {
    return summarizeSource(
      headerText({ node: clause, body: this.clauseBody(clause, rule) }),
      maxLabelLength,
    );
  }

  /** A block body's statements, or an arrow's expression body as the value it returns. */
  private lowerFunctionBody(body: FlowSyntaxNode, start: Pending[]): Pending[] {
    if (this.rules.blocks.includes(body.type)) {
      return this.lowerStatements(this.statementsOf(body), start);
    }
    return this.lowerLeaf('return', body, start);
  }

  build({ node: functionNode, body }: Bodied): Result<ControlFlowGraph, FlowFailure> {
    const name = this.nameOf(functionNode);
    let entryLabel = name;
    if (entryLabel === '') {
      entryLabel = 'function';
    }
    const entry = this.addNode('entry', entryLabel, {
      startLine: functionNode.startPosition.row + 1,
      endLine: body.startPosition.row + 1,
    });
    this.exitId = this.addNode('exit', 'end', {
      startLine: functionNode.endPosition.row + 1,
      endLine: functionNode.endPosition.row + 1,
    });
    const start: Pending[] = [{ from: entry, kind: 'next' }];
    this.connect(this.lowerFunctionBody(body, start), this.exitId);
    if (this.drafts.length > this.maxNodes) {
      return err({ kind: 'too-large', nodeLimit: this.maxNodes });
    }
    return ok(this.finish(name, functionNode));
  }
}

const exitEdgeKinds = { return: 'next', throw: 'exception' } as const satisfies Record<
  'return' | 'throw',
  FlowEdgeKind
>;

function labelOf(draft: Draft): string {
  if (draft.statements > 1) {
    return `${draft.label} (+${String(draft.statements - 1)})`;
  }
  return draft.label;
}

/** A `next` edge out of a loop body goes back to the loop; a jump keeps its kind. */
function loopBackKind(kind: FlowEdgeKind): FlowEdgeKind {
  if (kind === 'next') {
    return 'loop-back';
  }
  return kind;
}

function caseEdgeKind(isDefault: boolean): FlowEdgeKind {
  if (isDefault) {
    return 'default';
  }
  return 'case';
}

function rangeOf(node: FlowSyntaxNode): LineRange {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** The lines from the start of `node` to where its `body` begins: the statement's own header. */
function headerRange({ node, body }: Bodied): LineRange {
  return {
    startLine: node.startPosition.row + 1,
    endLine: Math.max(node.startPosition.row, body.startPosition.row) + 1,
  };
}

function caseRange(clause: FlowSyntaxNode, rule: CaseRule): LineRange {
  const value = fieldOf(clause, rule.valueField);
  return {
    startLine: clause.startPosition.row + 1,
    endLine: (value ?? clause).startPosition.row + 1,
  };
}

/** The source of `node` that precedes its descendant `body`: the statement's own header. */
function headerText({ node, body }: Bodied): string {
  if (body === node) {
    return node.text;
  }
  const rows = body.startPosition.row - node.startPosition.row;
  let column = body.startPosition.column;
  if (rows === 0) {
    column -= node.startPosition.column;
  }
  const lines = node.text.split('\n');
  let offset = 0;
  for (let row = 0; row < rows; row++) {
    offset += (lines[row]?.length ?? 0) + 1;
  }
  return node.text.slice(0, offset + column).trim();
}

function fieldOf(
  node: FlowSyntaxNode | undefined,
  field: string | undefined,
): FlowSyntaxNode | undefined {
  if (node === undefined || field === undefined) {
    return undefined;
  }
  return node.childForFieldName(field) ?? undefined;
}
