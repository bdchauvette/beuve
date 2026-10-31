import path from 'node:path';

import { z } from 'zod';

/** Caps on what one tool call may read or return. Every field has a default. */
export interface SandboxLimits {
  /** Bytes of one file shown. Defaults to 256 KiB; a longer file is cut and says so. */
  readonly maxFileBytes?: number;
  /** Lines `read_file` returns at most. Defaults to 2000. */
  readonly maxLines?: number;
  /** Matches `grep` returns at most. Defaults to 100. */
  readonly maxMatches?: number;
  /** Paths `glob` returns at most. Defaults to 500. */
  readonly maxPaths?: number;
  /** A file larger than this is not read at all. Defaults to 16 MiB. */
  readonly maxBlobBytes?: number;
}

/** A file tracked at the sandbox's commit. `mode` is git's: `100644`, `100755` or `120000` (a link). */
export interface SandboxFile {
  readonly path: string;
  readonly mode: string;
  readonly objectId: string;
}

/** What reading one tracked file gave. */
export type SandboxBytes =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large'; readonly size: number }
  | { readonly kind: 'unreadable' };

export interface SandboxGrepQuery {
  readonly pattern: string;
  readonly ignoreCase: boolean;
  /** A tracked file or directory to search; the whole tree if absent. */
  readonly scope?: string;
  /** Only matches in files it accepts count. */
  readonly accept: (path: string) => boolean;
  readonly maxMatches: number;
  readonly maxLineChars: number;
}

export interface SandboxGrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * The tracked content of one commit, which the sandbox reads instead of a checkout (TOCTOU
 * finding 4, ADR 0087). Main serves it from git objects. Each method answers `undefined` (or
 * `unreadable`) when git fails; the tool call then says so.
 */
export interface SandboxTree {
  /** Every tracked file and symbolic link, in git's path order. */
  readonly files: () => Promise<readonly SandboxFile[] | undefined>;
  /** A file's raw bytes, or `too-large` past `maxBytes` (then nothing is read). */
  readonly read: (file: SandboxFile, maxBytes: number) => Promise<SandboxBytes>;
  /** Lines holding a fixed string, in git's order, stopped one match past `maxMatches`. */
  readonly grep: (query: SandboxGrepQuery) => Promise<SandboxGrepResult | undefined>;
}

/** The matches of a grep, and whether it stopped at its cap. */
export interface SandboxGrepResult {
  readonly matches: readonly SandboxGrepMatch[];
  readonly isCapped: boolean;
}

/** A tool definition in the OpenAI chat completions `tools` shape. */
export interface SandboxToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

/** What a tool call answers: text for the model, and whether the call was refused. */
export interface SandboxResult {
  readonly output: string;
  readonly denied: boolean;
}

/** Read-only file tools over one commit's tree, for a model without its own harness. */
export interface ReadOnlySandbox {
  readonly definitions: readonly SandboxToolDefinition[];
  /** Runs one call with the model's raw JSON arguments. Never rejects. */
  readonly run: (call: SandboxCall) => Promise<SandboxResult>;
}

/** A tool call as the model wrote it: the tool's name and its raw JSON arguments. */
export interface SandboxCall {
  readonly name: string;
  readonly arguments: string;
}

interface Listing {
  /** Paths to files and links, in git's order. */
  readonly byPath: ReadonlyMap<string, SandboxFile>;
  /** Every directory that holds a tracked file, `''` (the root) included. */
  readonly directories: ReadonlySet<string>;
}

const maxLineChars = 300;
const symlinkMode = '120000';
/** Links followed while resolving one path; past this the path is refused, like `ELOOP`. */
const maxSymlinkHops = 8;
/** A link's target is a path, so its blob is small; a larger one is not followed. */
const maxLinkTargetBytes = 4096;

const readFileArguments = z.strictObject({
  path: z.string().min(1).max(4096),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
});
const grepArguments = z.strictObject({
  pattern: z.string().min(1).max(1000),
  path: z.string().min(1).max(4096).optional(),
  glob: z.string().min(1).max(1000).optional(),
  ignore_case: z.boolean().optional(),
});
const globArguments = z.strictObject({ pattern: z.string().min(1).max(1000) });

/** More wildcards than this could make matching one path slow, so such a glob is refused. */
const maxWildcards = 12;
const wildcards = /[*?]/gu;
const negation = /^!/u;
const matchesNothing = /(?!)/u;
/** A glob's special tokens and the characters a regular expression would read as syntax. */
const globToken = /\*\*\/|\*\*|\*|\?|\{|\}|,|\[[^\]]+\]|[.+^$()|\\[\]/]/gu;

/**
 * `read_file`, `grep` and `glob` over one commit's tracked files for the OpenAI-compatible
 * adapter (ADR 0071, 0087). Nothing writes, runs or fetches, and nothing touches the filesystem:
 * every byte comes from git objects at the pinned commit, so a checkout changing underneath (a
 * swapped symlink, a file written into it) can't change what the model reads. Paths are
 * repository-relative and case-sensitive; one that leaves the tree lexically (`..`, an absolute
 * path) is refused. A symbolic link is a blob holding its target: `read_file` and a `grep` scope
 * follow links within the tree, resolving every component lexically (at most 8 links), and refuse
 * a target that is absolute or leaves the tree; `grep` and `glob` list only regular files.
 * `grep` matches a fixed string (`git grep -F`), never a regular expression, so a model-written
 * pattern can't hang main's event loop. Sizes, lines, matches and paths are capped, and a capped
 * answer says so.
 */
export function createReadOnlySandbox(
  tree: SandboxTree,
  limits: SandboxLimits = {},
): ReadOnlySandbox {
  /** Where a requested path leads in the tree. */
  type Resolved =
    | { readonly kind: 'file'; readonly file: SandboxFile }
    | { readonly kind: 'directory'; readonly path: string }
    | { readonly kind: 'refused'; readonly output: string; readonly denied: boolean };
  const caps = {
    maxFileBytes: limits.maxFileBytes ?? 256 * 1024,
    maxLines: limits.maxLines ?? 2000,
    maxMatches: limits.maxMatches ?? 100,
    maxPaths: limits.maxPaths ?? 500,
    maxBlobBytes: limits.maxBlobBytes ?? 16 * 1024 * 1024,
  };
  let listed: Promise<Listing | undefined> | undefined;
  const listing = async (): Promise<Listing | undefined> => {
    listed ??= (async (): Promise<Listing | undefined> => {
      const files = await tree.files();
      if (files === undefined) {
        return undefined;
      }
      return listingFrom(files);
    })();
    return listed;
  };

  /** Where `requested` leads, following links inside the tree, or why it is refused. */
  const resolve = async (requested: string): Promise<Resolved> => {
    const outside = {
      kind: 'refused',
      output: `refused: ${requested} is outside the working directory`,
      denied: true,
    } as const;
    const notFound = { kind: 'refused', output: `not found: ${requested}`, denied: false } as const;
    const lexical = path.posix.normalize(requested);
    if (lexical === '..' || path.posix.isAbsolute(lexical) || lexical.startsWith('../')) {
      return outside;
    }
    const files = await listing();
    if (files === undefined) {
      throw new Error('the tree could not be listed');
    }
    let remaining = segmentsOf(lexical);
    let resolved: string[] = [];
    let hops = 0;
    for (let segment = remaining.shift(); segment !== undefined; segment = remaining.shift()) {
      const file = files.byPath.get([...resolved, segment].join('/'));
      if (file?.mode === symlinkMode) {
        hops += 1;
        if (hops > maxSymlinkHops) {
          return {
            kind: 'refused',
            output: `refused: ${requested} has too many links`,
            denied: true,
          };
        }
        const target = await linkTarget(tree, file);
        if (target === undefined) {
          return notFound;
        }
        const joined = path.posix.normalize(path.posix.join(resolved.join('/'), target));
        if (joined === '..' || path.posix.isAbsolute(target) || joined.startsWith('../')) {
          return {
            kind: 'refused',
            output: `refused: ${requested} links outside the working directory`,
            denied: true,
          };
        }
        remaining = [...segmentsOf(joined), ...remaining];
        resolved = [];
        continue;
      }
      if (file !== undefined && remaining.length > 0) {
        return notFound;
      }
      resolved.push(segment);
    }
    const found = resolved.join('/');
    const file = files.byPath.get(found);
    if (file !== undefined) {
      return { kind: 'file', file };
    }
    if (files.directories.has(found)) {
      return { kind: 'directory', path: found };
    }
    return notFound;
  };

  const readFileTool = async (input: z.infer<typeof readFileArguments>): Promise<SandboxResult> => {
    const resolved = await resolve(input.path);
    if (resolved.kind === 'refused') {
      return { output: resolved.output, denied: resolved.denied };
    }
    let text: SandboxText | undefined;
    if (resolved.kind === 'file') {
      text = await readText(tree, resolved.file, caps);
    }
    if (text === undefined) {
      return { output: `not a readable text file: ${input.path}`, denied: false };
    }
    const lines = text.content.split('\n');
    const start = input.start_line ?? 1;
    const end = Math.min(input.end_line ?? lines.length, lines.length, start + caps.maxLines - 1);
    const width = String(end).length;
    const numbered = lines
      .slice(start - 1, end)
      .map((line, offset) => `${String(start + offset).padStart(width)}\t${line}`);
    const output = [...numbered];
    if (text.isCut) {
      output.push(`[cut at ${String(caps.maxFileBytes)} bytes]`);
    }
    if (end < (input.end_line ?? lines.length) && !text.isCut) {
      output.push(`[lines ${String(end + 1)}-${String(input.end_line ?? lines.length)} not shown]`);
    }
    return { output: output.join('\n'), denied: false };
  };

  const grepTool = async (input: z.infer<typeof grepArguments>): Promise<SandboxResult> => {
    const scope = await resolve(input.path ?? '.');
    if (scope.kind === 'refused') {
      return { output: scope.output, denied: scope.denied };
    }
    let matcher: RegExp | null | undefined;
    if (input.glob !== undefined) {
      matcher = globMatcher(input.glob);
    }
    if (matcher === null) {
      return tooManyWildcards();
    }
    const files = await listing();
    let scopePath: string;
    if (scope.kind === 'file') {
      scopePath = scope.file.path;
    } else {
      scopePath = scope.path;
    }
    const found = await tree.grep({
      pattern: input.pattern,
      ignoreCase: input.ignore_case === true,
      ...(scopePath !== '' && { scope: scopePath }),
      accept: (file) => {
        return (
          files?.byPath.get(file)?.mode !== symlinkMode &&
          (matcher === undefined || matcher.test(file) || matcher.test(path.posix.basename(file)))
        );
      },
      maxMatches: caps.maxMatches,
      maxLineChars,
    });
    if (found === undefined) {
      return { output: 'the grep call failed', denied: false };
    }
    const lines = found.matches.map((match) => {
      return `${match.path}:${String(match.line)}: ${match.text}`;
    });
    if (lines.length === 0) {
      return { output: 'no matches', denied: false };
    }
    if (found.isCapped) {
      lines.push(`[stopped at ${String(caps.maxMatches)} matches]`);
    }
    return { output: lines.join('\n'), denied: false };
  };

  const globTool = async (input: z.infer<typeof globArguments>): Promise<SandboxResult> => {
    const matcher = globMatcher(input.pattern);
    if (matcher === null) {
      return tooManyWildcards();
    }
    const files = await listing();
    if (files === undefined) {
      return { output: 'the glob call failed', denied: false };
    }
    const found: string[] = [];
    let isCapped = false;
    for (const file of files.byPath.values()) {
      if (file.mode === symlinkMode || !matcher.test(file.path)) {
        continue;
      }
      if (found.length === caps.maxPaths) {
        isCapped = true;
        break;
      }
      found.push(file.path);
    }
    if (found.length === 0) {
      return { output: 'no files', denied: false };
    }
    if (isCapped) {
      found.push(`[stopped at ${String(caps.maxPaths)} paths]`);
    }
    return { output: found.join('\n'), denied: false };
  };

  return {
    definitions,
    run: async ({ name, arguments: rawArguments }): Promise<SandboxResult> => {
      let source = rawArguments;
      if (source === '') {
        source = '{}';
      }
      let json: unknown;
      try {
        json = JSON.parse(source);
      } catch {
        return { output: 'invalid arguments: not JSON', denied: false };
      }
      try {
        switch (name) {
          case 'read_file': {
            const parsed = readFileArguments.safeParse(json);
            if (parsed.success) {
              return await readFileTool(parsed.data);
            }
            return invalidArguments(parsed.error);
          }
          case 'grep': {
            const parsed = grepArguments.safeParse(json);
            if (parsed.success) {
              return await grepTool(parsed.data);
            }
            return invalidArguments(parsed.error);
          }
          case 'glob': {
            const parsed = globArguments.safeParse(json);
            if (parsed.success) {
              return await globTool(parsed.data);
            }
            return invalidArguments(parsed.error);
          }
          default: {
            return { output: `refused: there is no tool named ${name}`, denied: true };
          }
        }
      } catch {
        return { output: `the ${name} call failed`, denied: false };
      }
    },
  };
}

const definitions: readonly SandboxToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a text file tracked at the reviewed commit, with line numbers. Paths are relative to the repository root and case-sensitive.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository-relative path.' },
          start_line: { type: 'integer', minimum: 1, description: 'First line, 1-based.' },
          end_line: { type: 'integer', minimum: 1, description: 'Last line, inclusive.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Find lines containing a fixed string (not a regular expression) in the files tracked at the reviewed commit. Answers path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The exact text to find.' },
          path: {
            type: 'string',
            description: 'A file or directory to search; the root if omitted.',
          },
          glob: { type: 'string', description: 'Only files matching this glob, e.g. **/*.ts.' },
          ignore_case: { type: 'boolean' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description:
        'List files tracked at the reviewed commit whose repository-relative path matches a glob such as src/**/*.ts.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
];

function listingFrom(files: readonly SandboxFile[]): Listing {
  const byPath = new Map(
    files.map((file) => {
      return [file.path, file];
    }),
  );
  const directories = new Set<string>(['']);
  for (const file of files) {
    for (
      let slash = file.path.indexOf('/');
      slash !== -1;
      slash = file.path.indexOf('/', slash + 1)
    ) {
      directories.add(file.path.slice(0, slash));
    }
  }
  return { byPath, directories };
}

/** A normalized relative path's segments; none for the root. */
function segmentsOf(normalized: string): string[] {
  if (normalized === '.' || normalized === '') {
    return [];
  }
  return normalized.split('/').filter(Boolean);
}

/** The text a link's blob holds, or `undefined` when it can't be read as one. */
async function linkTarget(tree: SandboxTree, link: SandboxFile): Promise<string | undefined> {
  const read = await tree.read(link, maxLinkTargetBytes);
  if (read.kind === 'bytes' && !read.bytes.includes(0) && read.bytes.length > 0) {
    return Buffer.from(read.bytes).toString('utf8');
  }
  return undefined;
}

/** How much of a file is shown, and how large a file is read at all. */
interface TextCaps {
  readonly maxFileBytes: number;
  readonly maxBlobBytes: number;
}

/** A file's text as shown, and whether it was cut at the cap. */
interface SandboxText {
  readonly content: string;
  readonly isCut: boolean;
}

/**
 * At most `maxFileBytes` of a file as UTF-8 text, or `undefined` for a file larger than
 * `maxBlobBytes`, one with a NUL byte in what is shown (binary), or one git can't read.
 */
async function readText(
  tree: SandboxTree,
  file: SandboxFile,
  caps: TextCaps,
): Promise<SandboxText | undefined> {
  const read = await tree.read(file, caps.maxBlobBytes);
  if (read.kind !== 'bytes') {
    return undefined;
  }
  const shown = read.bytes.subarray(0, caps.maxFileBytes);
  if (shown.includes(0)) {
    return undefined;
  }
  return {
    content: Buffer.from(shown).toString('utf8'),
    isCut: read.bytes.length > caps.maxFileBytes,
  };
}

function tooManyWildcards(): SandboxResult {
  return { output: `invalid arguments: at most ${String(maxWildcards)} wildcards`, denied: false };
}

function invalidArguments(error: z.ZodError): SandboxResult {
  return { output: `invalid arguments: ${z.prettifyError(error)}`, denied: false };
}

/**
 * A glob as a regular expression over `/`-separated relative paths: `**` spans directories,
 * `*` and `?` stay within one, `{a,b}` is a choice and `[…]` a class. Everything else is
 * literal. The pattern is the model's: with more than {@link maxWildcards} wildcards it is
 * refused (`null`), which bounds the backtracking of the expression it makes.
 */
function globMatcher(pattern: string): RegExp | null {
  if ((pattern.match(wildcards) ?? []).length > maxWildcards) {
    // eslint-disable-next-line unicorn/no-null -- distinct from "no glob given".
    return null;
  }
  let depth = 0;
  const source = pattern.replaceAll(globToken, (token: string): string => {
    switch (token) {
      case '**/': {
        return '(?:[^/]*/)*';
      }
      case '**': {
        return '.*';
      }
      case '*': {
        return '[^/]*';
      }
      case '?': {
        return '[^/]';
      }
      case '{': {
        depth += 1;
        return '(?:';
      }
      case '}': {
        if (depth === 0) {
          return String.raw`\}`;
        }
        depth -= 1;
        return ')';
      }
      case ',': {
        if (depth > 0) {
          return '|';
        }
        return ',';
      }
      default: {
        if (token.startsWith('[') && token.length > 2) {
          return `[${token.slice(1, -1).replaceAll('\\', '\\\\').replace(negation, '^')}]`;
        }
        return RegExp.escape(token);
      }
    }
  });
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from escaped tokens.
    return new RegExp(`^${source}${')'.repeat(depth)}$`, 'u');
  } catch {
    return matchesNothing;
  }
}
