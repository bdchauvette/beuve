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
  readonly id: 'docs' | 'changes' | 'config-and-mechanical';
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
 * Puts a review's files in reading order (ADR 0065). Markdown files that are ordinary changes
 * form a group at the start, in path order, since they tend to explain the change. Config and
 * mechanical files form their own group at the end, by reason and then path. The rest are in path
 * order, or with `edges` the files that use others before the files they use, like a newspaper:
 * entry points first, helpers after. A depth-first walk places each file right before the
 * dependencies it reaches, so a file's helpers sit just below it. An edge that closes a cycle is
 * ignored, so cycles break the same way every time. Edges to files outside the group are ignored.
 * Pure.
 */
export function orderReviewFiles(
  files: readonly OrderableFile[],
  edges: readonly DependencyEdge[] = [],
): readonly OrderedGroup[] {
  type MechanicalFile = OrderableFile & { readonly mechanical: MechanicalReason };
  const ordinary = files.filter((file) => file.mechanical === undefined).map((file) => file.path);
  const docs = ordinary
    .filter((path) => {
      return isMarkdown(path);
    })
    .toSorted(comparePaths);
  const primary = ordinary.filter((path) => {
    return !isMarkdown(path);
  });
  const mechanical = files
    .filter((file): file is MechanicalFile => {
      return file.mechanical !== undefined;
    })
    .toSorted((a, b) => {
      return reasonRank[a.mechanical] - reasonRank[b.mechanical] || comparePaths(a.path, b.path);
    });
  const groups: OrderedGroup[] = [];
  if (docs.length > 0) {
    groups.push({ id: 'docs', label: 'Docs', paths: docs });
  }
  if (primary.length > 0) {
    groups.push({
      id: 'changes',
      label: changesLabel(edges),
      paths: dependentsFirst(primary, edges),
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

function changesLabel(edges: readonly DependencyEdge[]): string {
  if (edges.length > 0) {
    return 'Changes, importers first';
  }
  return 'Changes';
}

const markdownPath = /\.(?:md|mdx|markdown)$/i;

function isMarkdown(path: string): boolean {
  return markdownPath.test(path);
}

/** Reverse depth-first post-order: every file lands before the files it uses. */
function dependentsFirst(paths: readonly string[], edges: readonly DependencyEdge[]): string[] {
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
  /** Iterative depth-first post-order from `root`. */
  const walk = (root: string): void => {
    if (state.has(root)) {
      return;
    }
    const stack: { readonly path: string; readonly next: string[] }[] = [];
    const enter = (path: string): void => {
      state.set(path, 'walking');
      stack.push({
        path,
        next: [...(dependenciesOf.get(path) ?? [])].toSorted(comparePaths),
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
  };
  for (const root of sorted.toReversed()) {
    walk(root);
  }
  return ordered.toReversed();
}

/** Code-point order, like git's own file order, whatever the locale. */
function comparePaths(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}
