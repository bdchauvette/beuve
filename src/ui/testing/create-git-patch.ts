/** One file's change, as `git diff` would print it. */
export interface GitPatchInput {
  readonly oldPath: string;
  /** Differs from `oldPath` for a rename. */
  readonly newPath: string;
  /** Hunk lines, each starting with ` `, `+` or `-`. */
  readonly lines: readonly string[];
  /** The text git prints after the hunk range (`@@ -10,2 +10,2 @@ <context>`). */
  readonly context: string;
}

/** The C escapes git's `quote_c_style` writes; other control characters are octal. */
const escapes: Readonly<Record<string, string>> = {
  '\u{7}': String.raw`\a`,
  '\b': String.raw`\b`,
  '\t': String.raw`\t`,
  '\n': String.raw`\n`,
  '\v': String.raw`\v`,
  '\f': String.raw`\f`,
  '\r': String.raw`\r`,
  '"': String.raw`\"`,
  '\\': String.raw`\\`,
};

/**
 * The patch `git diff` (with `core.quotepath=off`, as beuve runs it) prints for `input`: one hunk
 * from line 10 on both sides, so the renderer adds a separator before it. Paths git would quote
 * (a `"`, `\` or control character) are quoted the way git's `quote_c_style` does.
 */
export function createGitPatch(input: GitPatchInput): string {
  const oldCount = input.lines.filter((line) => !line.startsWith('+')).length;
  const newCount = input.lines.filter((line) => !line.startsWith('-')).length;
  return [
    `diff --git ${gitPathFrom(`a/${input.oldPath}`)} ${gitPathFrom(`b/${input.newPath}`)}`,
    ...renameLines(input),
    'index 1111111..2222222 100644',
    `--- ${gitPathFrom(`a/${input.oldPath}`)}`,
    `+++ ${gitPathFrom(`b/${input.newPath}`)}`,
    `@@ -10,${String(oldCount)} +10,${String(newCount)} @@ ${input.context}`.trimEnd(),
    ...input.lines,
    '',
  ].join('\n');
}

function renameLines(input: GitPatchInput): readonly string[] {
  if (input.oldPath === input.newPath) {
    return [];
  }
  return [
    'similarity index 60%',
    `rename from ${gitPathFrom(input.oldPath)}`,
    `rename to ${gitPathFrom(input.newPath)}`,
  ];
}

/** `path` as git prints it: bare, or in quotes with C escapes and octal for other control characters. */
function gitPathFrom(path: string): string {
  const characters = Array.from(path, (character) => {
    const escaped = escapes[character];
    if (escaped !== undefined) {
      return escaped;
    }
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x7f || code < 0x20) {
      return `\\${code.toString(8).padStart(3, '0')}`;
    }
    return character;
  });
  const body = characters.join('');
  if (body === path) {
    return path;
  }
  return `"${body}"`;
}
