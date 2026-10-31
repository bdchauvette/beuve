import type {
  SandboxBytes,
  SandboxFile,
  SandboxGrepMatch,
  SandboxGrepQuery,
  SandboxTree,
} from '../create-read-only-sandbox.ts';

/** A file's content, or a symbolic link to `link` (its target text). */
export type MemoryEntry = string | Uint8Array | { readonly link: string };

/**
 * A {@link SandboxTree} over files held in memory, for the sandbox's own tests: paths in sorted
 * order, links as blobs holding their target, and a grep that behaves like `git grep -F -I`
 * (binary files skipped, ASCII case folding). Main's real tree reads git objects.
 */
export function createMemoryTree(entries: Readonly<Record<string, MemoryEntry>>): SandboxTree {
  const paths = Object.keys(entries).toSorted(byCodeUnits);
  const bytesOf = (file: string): Uint8Array => {
    const entry = entries[file] ?? '';
    if (typeof entry === 'string') {
      return Buffer.from(entry);
    }
    if (entry instanceof Uint8Array) {
      return entry;
    }
    return Buffer.from(entry.link);
  };
  const files: SandboxFile[] = paths.map((file, index) => {
    const entry = entries[file];
    const isLink = typeof entry === 'object' && !(entry instanceof Uint8Array);
    let mode = '100644';
    if (isLink) {
      mode = '120000';
    }
    return { path: file, mode, objectId: index.toString(16).padStart(40, '0') };
  });
  const read = (file: SandboxFile, maxBytes: number): SandboxBytes => {
    const bytes = bytesOf(file.path);
    if (bytes.length > maxBytes) {
      return { kind: 'too-large', size: bytes.length };
    }
    return { kind: 'bytes', bytes };
  };
  const grep = (query: SandboxGrepQuery): GrepAnswer => {
    const fold = (text: string): string => {
      if (query.ignoreCase) {
        return text.toLowerCase();
      }
      return text;
    };
    const matches: SandboxGrepMatch[] = [];
    for (const file of paths) {
      const isInScope =
        query.scope === undefined || file === query.scope || file.startsWith(`${query.scope}/`);
      const bytes = bytesOf(file);
      if (!isInScope || bytes.subarray(0, 8000).includes(0) || !query.accept(file)) {
        continue;
      }
      for (const [index, line] of Buffer.from(bytes).toString('utf8').split('\n').entries()) {
        if (!fold(line).includes(fold(query.pattern))) {
          continue;
        }
        if (matches.length === query.maxMatches) {
          return { matches, isCapped: true };
        }
        matches.push({ path: file, line: index + 1, text: line.slice(0, query.maxLineChars) });
      }
    }
    return { matches, isCapped: false };
  };
  /* eslint-disable @typescript-eslint/require-await -- the port is async; the fake answers at once. */
  return {
    files: async (): Promise<readonly SandboxFile[]> => {
      return files;
    },
    read: async (file, maxBytes): Promise<SandboxBytes> => {
      return read(file, maxBytes);
    },
    grep: async (query): Promise<GrepAnswer> => {
      return grep(query);
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}

interface GrepAnswer {
  readonly matches: readonly SandboxGrepMatch[];
  readonly isCapped: boolean;
}

/** The order git sorts paths in, for these ASCII test paths: by code unit. */
function byCodeUnits(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}
