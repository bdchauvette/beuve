import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

/** A file of the fixture's `feature` branch and the hostile text its review must show as text. */
export interface HostileFile {
  readonly path: string;
  /** The path before a rename. */
  readonly oldPath?: string;
  /** Lines of the head side the diff shows. */
  readonly lines: readonly string[];
}

/** A repository whose `feature` branch, reviewed against `main`, renders only hostile text. */
export interface HostileRepository {
  readonly directory: string;
  readonly baseRef: 'main';
  readonly headRef: 'feature';
  readonly files: readonly HostileFile[];
  /** The file with every hostile line, and the line (1-based) of its first one. */
  readonly contents: { readonly path: string; readonly line: number };
  /** A hostile-named file with a function to peek at (its 1-based line), which another calls. */
  readonly peek: { readonly path: string; readonly line: number };
  /** A hostile-named file git does not quote, so a sheet can open it. */
  readonly sheet: string;
}

/**
 * Hostile file names. Every one is valid on Linux and on macOS (APFS): no NUL, no component over
 * 255 bytes, none differing from another only by case. A `/` makes directories, which are as
 * hostile as the rest.
 */
const hostileNames: readonly string[] = [
  '<script>alert(1)</script>.ts',
  '"><img src=x onerror=alert(1)>.ts',
  "'><svg onload=alert(1)>.ts",
  '</span></div><b>bold</b>.ts',
  '`${alert(1)}` javascript:alert(1).ts',
  'invoice\u{202E}gpj.ts',
  'line\nbreak\tand tab.ts',
  String.raw`back\slash "quoted".ts`,
  '&amp;&lt;b&gt; &#x3C;i>.ts',
  '<svg><use href=x.svg#y>.ts',
  `${'<b>'.repeat(20)}${'x'.repeat(180)}.ts`,
  'x.<img src=x onerror=alert(1)>',
];
const renamedFrom = 'old"><b onmouseover=alert(1)>.ts';
const renamedTo = "new'><i onmouseover=alert(1)>.ts";

/** Lines that would be markup if a renderer did not escape them; no NUL, which makes git call a file binary. */
const hostileLines: readonly string[] = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'><svg onload=alert(1)>",
  '</span></div></pre></code><b>bold</b>',
  '<!-- <img src=x onerror=alert(1)>',
  '--> <img src=x onerror=alert(1)>',
  '<![CDATA[ <script>alert(1)</script> ]]>',
  ']]> <img src=x onerror=alert(1)>',
  '<svg><use href="//evil.example/sprite.svg#x"/></svg>',
  '<svg><use xlink:href="data:image/svg+xml,x#y"/></svg>',
  'const t = `${alert(document.domain)}`;',
  '<a href="javascript:alert(1)">javascript:alert(1)</a>',
  '<form><button formaction="javascript:alert(1)">go</button></form>',
  '<style>*{display:none}</style><textarea><title><xmp>',
  '&lt;img src=x onerror=alert(1)&gt; &amp;amp; &#x3C;b>',
  'bidi \u{202E}evil\u{202C} \u{2067}isolate\u{2069}',
  '<?xml version="1.0"?><!DOCTYPE x>',
];
/** Git takes the hunk's function context from the nearest line above it that starts with a letter. */
const hostileContext = 'function f() { <img src=x onerror=alert(1)> </span> <script>';
const contentsPath = 'contents.ts';
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
const fillerLines = 12;
/** The 1-based line of the first line after the context line, the filler and its `}`. */
const firstTailLine = fillerLines + 3;

const execFileAsync = promisify(execFile);

/**
 * Creates the fixture at `directory`: `main` with a plain version of each file, and `feature`
 * changing each hostile-named file, every hostile line in `contents.ts` under a hostile hunk
 * context, a rename between hostile names, and a binary file with NUL bytes.
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
  await mkdir(directory, { recursive: true });
  await git('init', '--quiet', '--initial-branch=main');
  await put('package.json', '{ "name": "hostile-fixture", "private": true, "type": "module" }\n');
  await put('tsconfig.json', '{ "compilerOptions": { "strict": true, "module": "nodenext" } }\n');
  for (const name of hostileNames) {
    await put(name, 'export const before = 1;\n');
  }
  await put(renamedFrom, `export const renamed = 1;\n${'// kept\n'.repeat(8)}`);
  await put(contentsPath, contentsFile(['const a = 1;']));
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'base');
  await git('switch', '--quiet', '--create', 'feature');
  const files: HostileFile[] = [];
  for (const [index, name] of hostileNames.entries()) {
    const line = hostileLines[index % hostileLines.length] ?? '';
    await put(name, `export const before = 2;\n${line}\n`);
    files.push({ path: name, lines: [line] });
  }
  await git('mv', renamedFrom, renamedTo);
  await put(renamedTo, `export const renamed = 2;\n${'// kept\n'.repeat(8)}`);
  files.push({ path: renamedTo, oldPath: renamedFrom, lines: ['export const renamed = 2;'] });
  await put(contentsPath, contentsFile(['const a = 2;', ...hostileLines]));
  files.push({ path: contentsPath, lines: hostileLines });
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
    contents: { path: contentsPath, line: firstTailLine + 1 },
    peek: { path: peekPath, line: 1 },
    sheet: "'><svg onload=alert(1)>.ts",
  };
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

/** `contents.ts`: the hostile context line, filler, then `tail`, so the hunk is far enough down to get a context. */
function contentsFile(tail: readonly string[]): string {
  const filler = Array.from(
    { length: fillerLines },
    (_, index) => `  // line ${String(index + 2)}`,
  );
  return [hostileContext, ...filler, '}', ...tail, ''].join('\n');
}
