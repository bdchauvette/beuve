import type { MechanicalReason } from './mechanical-reason.ts';

/** A file to place: its head path and, when it is config or mechanical, why. */
export interface OrderableFile {
  readonly path: string;
  readonly mechanical?: MechanicalReason | undefined;
}

/** `dependent` uses `dependency`: its imports or calls reach into it. */
export interface DependencyEdge {
  readonly dependent: string;
  readonly dependency: string;
}

export interface OrderedGroup {
  readonly id: 'changes' | 'config-and-mechanical';
  readonly label: string;
  readonly paths: readonly string[];
  /** For the config group: aligned with `paths`. */
  readonly reasons?: readonly MechanicalReason[];
}

/** Within the config group the noisiest come last. */
const reasonRank: Readonly<Record<MechanicalReason, number>> = {
  config: 0,
  'pure-rename': 1,
  'formatting-only': 2,
  generated: 3,
  lockfile: 4,
};

/**
 * Puts a review's files in reading order (ADR 0065). Config and mechanical files form their own
 * group at the end, by reason and then path. The rest are in path order, or with `edges`
 * dependencies before the files that use them: a depth-first walk visits files in path order and
 * places each file right after the dependencies it reaches, so a dependency comes first and a
 * file's helpers sit next to it. An edge that closes a cycle is ignored, so cycles break at the
 * first path in sorted order, the same way every time. Edges to files outside the review are
 * ignored. Pure.
 */
export function orderReviewFiles(
  files: readonly OrderableFile[],
  edges: readonly DependencyEdge[] = [],
): readonly OrderedGroup[] {
  const primary = files.filter((file) => file.mechanical === undefined).map((file) => file.path);
  const mechanical = files
    .filter((file): file is OrderableFile & { readonly mechanical: MechanicalReason } => {
      return file.mechanical !== undefined;
    })
    .toSorted((a, b) => {
      return reasonRank[a.mechanical] - reasonRank[b.mechanical] || comparePaths(a.path, b.path);
    });
  const groups: OrderedGroup[] = [];
  if (primary.length > 0) {
    groups.push({
      id: 'changes',
      label: edges.length > 0 ? 'Changes, dependencies first' : 'Changes',
      paths: dependenciesFirst(primary, edges),
    });
  }
  if (mechanical.length > 0) {
    groups.push({
      id: 'config-and-mechanical',
      label: 'Config and mechanical',
      paths: mechanical.map((file) => file.path),
      reasons: mechanical.map((file) => file.mechanical),
    });
  }
  return groups;
}

function dependenciesFirst(paths: readonly string[], edges: readonly DependencyEdge[]): string[] {
  const sorted = paths.toSorted(comparePaths);
  const members = new Set(sorted);
  const dependenciesOf = new Map<string, string[]>(
    sorted.map((path) => {
      return [path, []];
    }),
  );
  for (const { dependent, dependency } of edges) {
    if (dependent !== dependency && members.has(dependent) && members.has(dependency)) {
      dependenciesOf.get(dependent)?.push(dependency);
    }
  }
  const ordered: string[] = [];
  const state = new Map<string, 'walking' | 'done'>();
  for (const root of sorted) {
    walk(root, dependenciesOf, state, ordered);
  }
  return ordered;
}

/** Iterative depth-first post-order from `root`. */
function walk(
  root: string,
  dependenciesOf: ReadonlyMap<string, readonly string[]>,
  state: Map<string, 'walking' | 'done'>,
  ordered: string[],
): void {
  if (state.has(root)) {
    return;
  }
  const stack: { readonly path: string; readonly next: string[] }[] = [];
  const enter = (path: string): void => {
    state.set(path, 'walking');
    stack.push({
      path,
      next: [...(dependenciesOf.get(path) ?? [])].toSorted(comparePaths).toReversed(),
    });
  };
  enter(root);
  for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
    const dependency = frame.next.pop();
    if (dependency === undefined) {
      state.set(frame.path, 'done');
      ordered.push(frame.path);
      stack.pop();
    } else if (!state.has(dependency)) {
      enter(dependency);
    }
  }
}

/** Code-point order, like git's own file order, whatever the locale. */
function comparePaths(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
