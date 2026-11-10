import type { LineRange } from './target-from.ts';

/** A file a chat answer names: a repository path at the head, with the lines it points at. */
export interface FileReference {
  readonly path: string;
  /** 1-based, inclusive; absent when the text names the file alone. */
  readonly lines: LineRange | undefined;
}

/** The lines written after a path, the most specific first: `:12`, `:12-20`, `:12:5`, and GitHub's `#L12` and `#L12-L20`. */
const lineSuffixes = [
  /:(\d+):\d+$/u,
  /:(\d+)$/u,
  /:(\d+)[-–](\d+)$/u,
  /#L(\d+)$/u,
  /#L(\d+)-L?(\d+)$/u,
] as const;
const dotSlash = /^\.\//u;

/** A name and the lines written after it. */
interface WrittenPlace {
  readonly name: string;
  readonly lines: LineRange | undefined;
}

/**
 * The files of a review a chat answer may name (ADR 0128): the head tree's paths and the diff's.
 * {@link resolve} reads `path`, `path:12`, `path:12-20`, `path:12:5` or `path#L12-L20` and answers
 * only for a path that is in the index, so prose that merely looks like a path stays text. A
 * path may be written from a directory boundary (`ui/foo.ts` for `src/ui/foo.ts`) when only one
 * file ends that way, or absolute (a checkout's own path before the repository's).
 */
export class FileReferenceIndex {
  private readonly paths: ReadonlySet<string>;
  /** Each proper suffix after a `/` to its one path; `undefined` when several paths end so. */
  private readonly suffixes: ReadonlyMap<string, string | undefined>;

  constructor(paths: Iterable<string>) {
    const known = new Set(paths);
    const suffixes = new Map<string, string | undefined>();
    for (const path of known) {
      let slash = path.indexOf('/');
      while (slash !== -1) {
        const suffix = path.slice(slash + 1);
        if (suffixes.has(suffix)) {
          suffixes.set(suffix, undefined);
        } else {
          suffixes.set(suffix, path);
        }
        slash = path.indexOf('/', slash + 1);
      }
    }
    this.paths = known;
    this.suffixes = suffixes;
  }

  private pathOf(name: string): string | undefined {
    if (name.startsWith('/')) {
      return this.absolutePathOf(name);
    }
    const relative = name.replace(dotSlash, '');
    if (this.paths.has(relative)) {
      return relative;
    }
    if (!relative.includes('.') && !relative.includes('/')) {
      return undefined;
    }
    return this.suffixes.get(relative);
  }

  /** The longest tail of an absolute path that is a whole repository path. */
  private absolutePathOf(name: string): string | undefined {
    let slash = name.indexOf('/');
    while (slash !== -1) {
      const tail = name.slice(slash + 1);
      if (this.paths.has(tail)) {
        return tail;
      }
      slash = name.indexOf('/', slash + 1);
    }
    return undefined;
  }

  /** Whether the index knows no files (a review still loading). */
  get isEmpty(): boolean {
    return this.paths.size === 0;
  }

  /** The reference `text` spells out whole, or `undefined` when it names no known file. */
  resolve(text: string): FileReference | undefined {
    const { name, lines } = writtenPlaceFrom(text);
    const path = this.pathOf(name);
    if (path === undefined) {
      return undefined;
    }
    return { path, lines };
  }
}

function writtenPlaceFrom(text: string): WrittenPlace {
  for (const suffix of lineSuffixes) {
    const match = suffix.exec(text);
    if (match !== null) {
      return { name: text.slice(0, match.index), lines: linesFrom(match[1], match[2]) };
    }
  }
  return { name: text, lines: undefined };
}

function linesFrom(start: string | undefined, end: string | undefined): LineRange | undefined {
  const first = Number(start);
  if (start === undefined || !Number.isSafeInteger(first) || first < 1) {
    return undefined;
  }
  const last = Number(end);
  if (end === undefined || !Number.isSafeInteger(last) || last < first) {
    return { start: first, end: first };
  }
  return { start: first, end: last };
}
