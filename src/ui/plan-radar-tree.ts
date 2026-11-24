import type { DiffFileView } from '#contract/ipc-contract.ts';

/** Changed Files Only switches between the package neighborhood and the changed files alone. */
export type RadarTreeMode = 'neighborhood' | 'diff-only';

/** Directories to nest under, or one flat list of full paths. */
export type RadarTreeLayout = 'tree' | 'flat';

/** How the tree is shown on top of the mode: nested or flat, narrowed by a filter. */
export interface RadarTreeDisplay {
  readonly layout: RadarTreeLayout;
  /** Terms a path must all contain, ignoring case; blank shows everything. */
  readonly query: string;
}

const unfilteredTree: RadarTreeDisplay = { layout: 'tree', query: '' };
const whitespace = /\s+/u;

/** The radar tree's git lanes; `ignored` is the dimmed lane generated files take (ADR 0052). */
export type RadarGitStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'ignored';

/** What the radar tree shows, as `@pierre/trees` takes it. */
export interface RadarTreePlan {
  readonly paths: readonly string[];
  /** Directories to open, each with all its ancestors. */
  readonly expandedPaths: readonly string[];
  readonly gitStatus: readonly { readonly path: string; readonly status: RadarGitStatus }[];
  /** For each changed file, the package root it belongs to (`''` for the repository root). */
  readonly packageOf: ReadonlyMap<string, string>;
}

export interface RadarTreeInput {
  /** Every path at the head (`session:get-tree`); empty until it has loaded. */
  readonly paths: readonly string[];
  readonly packageRoots: readonly string[];
  readonly files: readonly Pick<DiffFileView, 'path' | 'status'>[];
}

/**
 * The radar tree's contents (ADR 0026). Neighborhood mode lists every tracked path, plus deleted
 * files the head no longer has, and opens the directories leading to each changed file, so its
 * package and the siblings around it are in view while untouched packages stay closed. Diff-only
 * mode lists the changed files alone, all directories open. Both badge changed files with their
 * git status and map each to its innermost package root.
 */
export function planRadarTree(
  input: RadarTreeInput,
  mode: RadarTreeMode,
  display: RadarTreeDisplay = unfilteredTree,
): RadarTreePlan {
  const changed = input.files.map((file) => file.path);
  const paths = pathsMatching(treePaths(input, mode), display.query);
  const shown = new Set(paths);
  const roots = input.packageRoots.toSorted((a, b) => b.length - a.length);
  return {
    paths,
    expandedPaths: expandedPathsFrom({ display, paths, changed }),
    gitStatus: input.files
      .filter((file) => shown.has(file.path))
      .map((file) => {
        return { path: file.path, status: gitStatusOf(file.status) };
      }),
    packageOf: new Map(
      changed.map((path) => {
        return [path, innermostRoot(roots, path)];
      }),
    ),
  };
}

interface ExpansionInput {
  readonly display: RadarTreeDisplay;
  readonly paths: readonly string[];
  readonly changed: readonly string[];
}

/**
 * A flat list has no directories to open. A filter opens the way to every match; otherwise the
 * way to each changed file.
 */
function expandedPathsFrom({ display, paths, changed }: ExpansionInput): readonly string[] {
  if (display.layout === 'flat') {
    return [];
  }
  let opened = changed;
  if (display.query.trim() !== '') {
    opened = paths;
  }
  const expanded = new Set(opened.flatMap((path) => ancestorsOf(path)));
  return [...expanded].toSorted((a, b) => a.localeCompare(b));
}

/** The paths containing every whitespace-separated term of `query`, ignoring case. */
function pathsMatching(paths: readonly string[], query: string): readonly string[] {
  const terms = query.toLowerCase().split(whitespace).filter(Boolean);
  if (terms.length === 0) {
    return paths;
  }
  return paths.filter((path) => {
    const lowered = path.toLowerCase();
    return terms.every((term) => lowered.includes(term));
  });
}

function treePaths(input: RadarTreeInput, mode: RadarTreeMode): readonly string[] {
  const changed = input.files.map((file) => file.path);
  if (mode === 'diff-only') {
    return changed;
  }
  return [...new Set([...input.paths, ...changed])];
}

/** `a/b/c.ts` → `a`, `a/b`. */
function ancestorsOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function innermostRoot(rootsLongestFirst: readonly string[], path: string): string {
  return rootsLongestFirst.find((root) => root === '' || path.startsWith(`${root}/`)) ?? '';
}

function gitStatusOf(status: DiffFileView['status']): RadarGitStatus {
  if (status === 'copied') {
    return 'added';
  }
  return status;
}
