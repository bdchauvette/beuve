/**
 * The highlighted language a `#!` line names (ADR 0120): `#!/usr/bin/env -S python3 -u` is
 * `python`, `#!/bin/bash -e` is `shellscript`. Reads through `env` (its options and `NAME=value`
 * assignments) and drops a version suffix (`python3.12`, `perl5`). Undefined for no line, a line
 * that is not a shebang, or an interpreter beuve has no grammar for. Pure.
 */
export function languageFromShebang(line: string | undefined): string | undefined {
  if (line?.startsWith('#!') !== true) {
    return undefined;
  }
  const words = line.slice(2).trim().split(whitespace);
  let program = baseName(words[0] ?? '');
  if (program === 'env') {
    program = baseName(
      words.slice(1).find((word) => {
        return isProgram(word);
      }) ?? '',
    );
  }
  const name = program.replace(versionSuffix, '');
  if (!Object.hasOwn(interpreters, name)) {
    return undefined;
  }
  return interpreters[name];
}

const whitespace = /\s+/u;
const versionSuffix = /[\d.]+$/u;

const interpreters: Readonly<Record<string, string>> = Object.freeze({
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  dash: 'shellscript',
  ksh: 'shellscript',
  mksh: 'shellscript',
  ash: 'shellscript',
  fish: 'fish',
  python: 'python',
  pypy: 'python',
  ruby: 'ruby',
  perl: 'perl',
  node: 'javascript',
  nodejs: 'javascript',
  bun: 'javascript',
  deno: 'typescript',
  'ts-node': 'typescript',
  tsx: 'typescript',
  awk: 'awk',
  gawk: 'awk',
  mawk: 'awk',
  nawk: 'awk',
});

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A word of an `env` line that names the program: not an option and not an assignment. */
function isProgram(word: string): boolean {
  return !word.startsWith('-') && !word.includes('=');
}
