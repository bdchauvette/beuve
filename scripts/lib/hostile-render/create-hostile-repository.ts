import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { hostileCorpus } from '../../../src/ui/testing/hostile-corpus.ts';

/** A file of the fixture's `feature` branch and the hostile text its review must show as text. */
export interface HostileFile {
  readonly path: string;
  /** The path before a rename. */
  readonly oldPath?: string;
  /** Lines of the head side the diff shows. */
  readonly lines: readonly string[];
  /** The file that differs from this one only by benign text, whose card is the oracle's twin. */
  readonly twin?: string;
}

/** A repository whose `feature` branch, reviewed against `main`, renders the hostile corpus. */
export interface HostileRepository {
  readonly directory: string;
  readonly baseRef: 'main';
  readonly headRef: 'feature';
  readonly files: readonly HostileFile[];
  /** Corpus entries no repository can hold (NUL, an empty or over-long path component). */
  readonly skipped: readonly string[];
  /** The file with every hostile line, and the line (1-based) of its first one. */
  readonly contents: { readonly path: string; readonly line: number };
  /** A hostile-named file with a function to peek at (its 1-based line), which another calls. */
  readonly peek: { readonly path: string; readonly line: number };
  /** A hostile-named file git does not quote, so a sheet can open it. */
  readonly sheet: string;
  /** Names with bidi, control or invisible characters, which must show as escapes (ADR 0082). */
  readonly spoofing: readonly string[];
}

/** Names beyond the corpus for what only the app shows: invisible characters, a hostile extension. */
const appOnlyNames: ReadonlySet<string> = new Set([
  'zero\u{200B}width\u{2066}isolate\u{2069}\u{200F}.ts',
  'x.<img src=x onerror=alert(1)>',
]);
const benignName = 'benign.ts';
const renamedDirectory = 'renamed';
const contentsPath = 'contents.ts';
const benignContentsPath = 'benign-contents.ts';
/** Peek is a call hierarchy: it lists the target's callers with their file and line. */
const peekPath = "peek'><svg onload=alert(1)>.ts";
const peekFunctions: readonly string[] = [
  'export function hostileTarget(): number {',
  '  return 1; // <img src=x onerror=alert(1)>',
  '}',
  'export function hostileCaller(): number {',
  '  return hostileTarget(); // </span><script>alert(1)</script>',
  '}',
];
/** Lines between a section's context line and its change, more than git's three of context. */
const fillerLines = 8;
/** APFS and ext4 both cap a path component at 255 bytes. */
const maximumComponentBytes = 255;
/** NUL makes git call a file binary; a line break splits the line. */
const nonTextCharacters = /[\0\n\r]/u;

const execFileAsync = promisify(execFile);

/**
 * Creates the fixture at `directory` from the shared corpus (`src/ui/testing/hostile-corpus.ts`),
 * as far as a repository can hold it on Linux and macOS: `main` with a plain version of each file,
 * and `feature` changing a file named by each hostile name (beside `benign.ts`, its twin), renaming
 * `renamed/<name>.old.ts` to `renamed/<name>` (beside `renamed/benign.ts`), changing a section of
 * `contents.ts` per hostile line under that line as its hunk header's context (beside
 * `benign-contents.ts`), a hostile-named file to peek at, and a binary file with NUL bytes.
 */
export async function createHostileRepository(
  directory: string,
  signal: AbortSignal,
): Promise<HostileRepository> {
  const git = async (...args: readonly string[]): Promise<void> => {
    await execFileAsync('git', ['-C', directory, ...args], { signal, env: gitEnvironment() });
  };
  const put = async (relative: string, text: string | Uint8Array): Promise<void> => {
    const file = path.join(directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, { signal });
  };
  const corpus = hostileCorpus();
  const names = corpus.names.filter((input) => isRepositoryPath(input.text));
  const lines = corpus.contents.filter((input) => isRepositoryLine(input.text));
  const named = [...names.map((input) => input.text), ...appOnlyNames];
  const renamed = names.map((input, index) => ({
    from: `${renamedDirectory}/${input.text}.old.ts`,
    to: `${renamedDirectory}/${input.text}`,
    index,
  }));
  const renamedBenign = {
    from: `${renamedDirectory}/benign.old.ts`,
    to: `${renamedDirectory}/${benignName}`,
    index: names.length,
  };
  await mkdir(directory, { recursive: true });
  await git('init', '--quiet', '--initial-branch=main');
  await put('package.json', '{ "name": "hostile-fixture", "private": true, "type": "module" }\n');
  await put('tsconfig.json', '{ "compilerOptions": { "strict": true, "module": "nodenext" } }\n');
  for (const name of [...named, benignName]) {
    await put(name, 'export const before = 1;\n');
  }
  for (const rename of [...renamed, renamedBenign]) {
    await put(rename.from, renamedFile(rename.index, 1));
  }
  await put(
    contentsPath,
    contentsFile(
      lines.map((input) => input.text),
      'base',
    ),
  );
  await put(
    benignContentsPath,
    contentsFile(
      lines.map(() => 'benign'),
      'base',
    ),
  );
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'base');
  await git('switch', '--quiet', '--create', 'feature');
  const files: HostileFile[] = [];
  for (const name of [...named, benignName]) {
    await put(name, 'export const before = 2;\n');
    files.push({
      path: name,
      lines: ['export const before = 2;'],
      ...(name !== benignName && !appOnlyNames.has(name) && { twin: benignName }),
    });
  }
  for (const rename of [...renamed, renamedBenign]) {
    await git('mv', rename.from, rename.to);
    await put(rename.to, renamedFile(rename.index, 2));
    files.push({
      path: rename.to,
      oldPath: rename.from,
      lines: [`export const renamed${String(rename.index)} = 2;`],
      ...(rename !== renamedBenign && { twin: renamedBenign.to }),
    });
  }
  await put(
    contentsPath,
    contentsFile(
      lines.map((input) => input.text),
      'feature',
    ),
  );
  files.push({
    path: contentsPath,
    lines: lines.map((input) => input.text),
    twin: benignContentsPath,
  });
  await put(
    benignContentsPath,
    contentsFile(
      lines.map(() => 'benign'),
      'feature',
    ),
  );
  files.push({ path: benignContentsPath, lines: ['benign'] });
  await put(peekPath, `${peekFunctions.join('\n')}\n`);
  files.push({ path: peekPath, lines: peekFunctions });
  await put('binary-with-nul.bin', new Uint8Array([0x3c, 0x62, 0x3e, 0, 0x3c, 0x2f, 0x62, 0x3e]));
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'feature <img src=x onerror=alert(1)>');
  return {
    directory,
    baseRef: 'main',
    headRef: 'feature',
    files,
    skipped: [...corpus.names, ...corpus.contents]
      .filter((input) => !names.includes(input) && !lines.includes(input))
      .map((input) => input.label),
    contents: { path: contentsPath, line: firstChangedLine() },
    peek: { path: peekPath, line: 1 },
    sheet: "'><svg onload=alert(1)>.ts",
    spoofing: [
      'invoice\u{202E}gpj.ts\u{202C}\u{2066}x\u{2069}.ts',
      'line\nbreak\there.ts',
      'zero\u{200B}width\u{2066}isolate\u{2069}\u{200F}.ts',
    ],
  };
}

/** A path both file systems hold as written: no NUL and no empty, `.`, `..` or over-long component. */
function isRepositoryPath(name: string): boolean {
  return (
    !name.includes('\0') &&
    name
      .split('/')
      .every(
        (component) =>
          component !== '' &&
          component !== '.' &&
          component !== '..' &&
          new TextEncoder().encode(component).length <= maximumComponentBytes,
      )
  );
}

/** A line git diffs as text: no NUL (which makes the file binary) and no line break. */
function isRepositoryLine(line: string): boolean {
  return !nonTextCharacters.test(line);
}

/** Commits as a fixed author, ignoring the user's and the system's git configuration. */
function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
}

/** A renamed file whose every line names `index`, so git pairs each rename with its own source. */
function renamedFile(index: number, value: number): string {
  const kept = Array.from({ length: 8 }, (_, line) => `// kept ${String(index)}.${String(line)}\n`);
  return `export const renamed${String(index)} = ${String(value)};\n${kept.join('')}`;
}

/**
 * One section per line, as the corpus's patches have it: the line as the context git prints after
 * `@@` (`function f() { <line>`, the nearest line above the hunk that starts with a letter), then
 * filler, then the line itself, kept, and `const a = '<line>';`, which `feature` changes to
 * `const a = "<line>";` and follows with the line again.
 */
function contentsFile(lines: readonly string[], side: 'base' | 'feature'): string {
  const filler = Array.from({ length: fillerLines }, (_, index) => `  // line ${String(index)}`);
  return `${lines
    .flatMap((line) => [
      `function f() { ${line}`,
      ...filler,
      '}',
      line,
      ...(side === 'base' ? [`const a = '${line}';`] : [`const a = "${line}";`, line]),
    ])
    .join('\n')}\n`;
}

/** The 1-based line of the first section's first changed line in `feature`. */
function firstChangedLine(): number {
  return fillerLines + 4;
}
