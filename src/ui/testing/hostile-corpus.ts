import { snippetPathFrom } from '../snippet-path-from.ts';

import { createGitPatch } from './create-git-patch.ts';
import type { GitPatchInput } from './create-git-patch.ts';
import { inParsedText } from './in-parsed-text.ts';
import type { DiffHtmlOptions } from './render-diff-html.ts';

/** One hostile string: a file name, a line of code, a language or a code block's info string. */
export interface HostileInput {
  readonly label: string;
  readonly text: string;
}

/** A patch with hostile text, its benign twin, and how to render both. */
export interface HostileDiffCase extends HostileInput {
  readonly options: DiffHtmlOptions;
  readonly hostile: string;
  readonly benign: string;
  /** What the hostile render must show as text, as the HTML parser leaves it. */
  readonly visible: readonly string[];
}

/** A whole file, as a sheet, peek or chat code block shows it. */
export interface HostileFile {
  readonly name: string;
  readonly contents: string;
  readonly lang?: string;
}

/** A file with hostile text, its benign twin, and what the hostile one must show as text. */
export interface HostileFileCase extends HostileInput {
  readonly hostile: HostileFile;
  readonly benign: HostileFile;
  readonly visible: readonly string[];
}

/** A hostile language: rendering must fail before any HTML is built. */
export interface HostileDiffLanguageCase extends HostileInput {
  readonly options: DiffHtmlOptions & { readonly language: string };
  readonly patch: string;
}

/** A hostile language for a whole file: rendering must fail before any HTML is built. */
export interface HostileFileLanguageCase extends HostileInput {
  readonly file: HostileFile & { readonly lang: string };
}

/**
 * The hostile-input corpus of ADR 0077, one source for both layers: `pierre-diffs-escaping.test.ts`
 * renders it in Node through the code paths `@pierre/diffs` builds its HTML with, and
 * `scripts/check-hostile-render.ts` renders it in the built app, with the production CSP and
 * the Trusted Types policy.
 */
export interface HostileCorpus {
  /** File names a repository can hold on Linux and macOS, plus NUL, which only a patch can. */
  readonly names: readonly HostileInput[];
  /** Lines of code (or a language, or an info string) that would be markup if not escaped. */
  readonly contents: readonly HostileInput[];
  /** Each name changed in place, in every view. */
  readonly fileNames: readonly HostileDiffCase[];
  /** A rename from `<name>.old.ts` to each name, split with the card's separators. */
  readonly renames: readonly HostileDiffCase[];
  /** Each line kept, removed and added, in every view. */
  readonly lines: readonly HostileDiffCase[];
  /** Each line as the hunk header's context after `@@`, in every view. */
  readonly hunkContexts: readonly HostileDiffCase[];
  /** Each hunk header context where it is printed: unified, with `metadata` separators. */
  readonly shownHunkContexts: readonly HostileDiffCase[];
  /** Each line as a language override of a diff. */
  readonly diffLanguages: readonly HostileDiffLanguageCase[];
  /** A sheet of a file with each name, holding every hostile line. */
  readonly sheets: readonly HostileFileCase[];
  /** A chat code block whose info string, and contents, are each line. */
  readonly codeBlocks: readonly HostileFileCase[];
  /** Each line as the language of a sheet. */
  readonly sheetLanguages: readonly HostileFileLanguageCase[];
}

/** The corpus, built fresh on each call. */
export function hostileCorpus(): HostileCorpus {
  const names = hostileNames();
  const contents = hostileContents();
  const everyLine = contents.map((input) => input.text).join('\n');
  return {
    names,
    contents,
    fileNames: inEveryView(names).map((input) => ({
      ...input,
      hostile: patchNamed(input.text, input.text),
      benign: patchNamed('benign.ts', 'benign.ts'),
      visible: [inParsedText(input.text)],
    })),
    renames: names.map((input) => ({
      ...input,
      options: { diffStyle: 'split', hunkSeparators: 'line-info' },
      hostile: patchNamed(`${input.text}.old.ts`, input.text),
      benign: patchNamed('benign.old.ts', 'benign.ts'),
      visible: [inParsedText(input.text)],
    })),
    lines: inEveryView(contents).map((input) => ({
      ...input,
      hostile: patchWithLine(input.text),
      benign: patchWithLine('benign'),
      visible: [inParsedText(input.text)],
    })),
    hunkContexts: inEveryView(contents).map((input) => ({
      ...input,
      hostile: patchWithContext(input.text),
      benign: patchWithContext('benign'),
      visible: [],
    })),
    shownHunkContexts: contents.map((input) => ({
      ...input,
      options: { diffStyle: 'unified', hunkSeparators: 'metadata' },
      hostile: patchWithContext(input.text),
      benign: patchWithContext('benign'),
      visible: [`function f() { ${inParsedText(input.text)}`],
    })),
    diffLanguages: contents.map((input) => ({
      ...input,
      options: { diffStyle: 'unified', hunkSeparators: 'line-info', language: input.text },
      patch: patchWithLine('const a = 1;'),
    })),
    sheets: names.map((input) => ({
      ...input,
      hostile: { name: input.text, contents: everyLine },
      benign: { name: 'benign.ts', contents: 'benign\n'.repeat(20) },
      visible: [inParsedText(input.text), inParsedText(everyLine.replaceAll('\n', ''))],
    })),
    codeBlocks: contents.map((input) => ({
      ...input,
      hostile: { name: snippetPathFrom(input.text), contents: input.text },
      benign: { name: snippetPathFrom('ts'), contents: 'benign' },
      visible: [inParsedText(input.text)],
    })),
    sheetLanguages: contents.map((input) => ({
      ...input,
      file: { name: 'a.ts', contents: 'const a = 1;', lang: input.text },
    })),
  };
}

function hostileNames(): readonly HostileInput[] {
  return [
    { label: 'script tag', text: '<script>alert(1)</script>.ts' },
    { label: 'attribute breakout', text: '"><img src=x onerror=alert(1)>.ts' },
    { label: 'single-quote breakout', text: "'><svg onload=alert(1)>.ts" },
    { label: 'closing tags', text: '</span></bdi></div><b>bold</b>.ts' },
    { label: 'quotes and backticks', text: `'single' "double" \`tick\` \${x}.ts` },
    { label: 'javascript URL', text: 'javascript:alert(1).ts' },
    { label: 'bidi overrides', text: 'invoice\u{202E}gpj.ts\u{202C}\u{2066}x\u{2069}.ts' },
    { label: 'NUL', text: 'nul\0name.ts' },
    { label: 'newline and tab', text: 'line\nbreak\there.ts' },
    { label: 'backslash', text: String.raw`back\slash\".ts` },
    { label: 'entities', text: '&amp;&lt;&#x3C;script&gt;.ts' },
    { label: 'use reference', text: '<svg><use href="//evil.example/#x"/></svg>.ts' },
    { label: 'very long', text: `${'<b>'.repeat(80)}${'x'.repeat(4000)}.ts` },
    { label: 'deep path', text: `${'d<i>r/'.repeat(60)}f.ts` },
  ];
}

function hostileContents(): readonly HostileInput[] {
  return [
    { label: 'script tag', text: '<script>alert(1)</script>' },
    { label: 'attribute breakout', text: '"><img src=x onerror=alert(1)>' },
    { label: 'closing tags', text: '</span></div></pre></code><b>bold</b>' },
    { label: 'comment open', text: '<!-- <img src=x onerror=alert(1)>' },
    { label: 'comment close', text: '--> <img src=x onerror=alert(1)>' },
    { label: 'CDATA', text: '<![CDATA[ <script>alert(1)</script> ]]>' },
    { label: 'CDATA close', text: ']]> <img src=x onerror=alert(1)>' },
    { label: 'svg use', text: '<svg><use href="//evil.example/sprite.svg#x"/></svg>' },
    { label: 'template literal', text: '`${alert(document.domain)}`' },
    { label: 'javascript URL', text: '<a href="javascript:alert(1)">x</a>' },
    { label: 'raw-text openers', text: '<style>*{}</style><textarea><title><xmp>' },
    { label: 'entities', text: '&lt;img src=x onerror=alert(1)&gt; &amp;amp;' },
    { label: 'bidi and NUL', text: 'a\u{202E}b\0c\u{2067}d' },
    { label: 'processing instruction', text: '<?xml version="1.0"?><!DOCTYPE x>' },
  ];
}

/** Each of `inputs` in split and unified views, with the card's separators and with hunk headers. */
function inEveryView(
  inputs: readonly HostileInput[],
): readonly (HostileInput & { readonly options: DiffHtmlOptions })[] {
  return inputs.flatMap((input) =>
    (['split', 'unified'] as const).flatMap((diffStyle) =>
      (['line-info', 'metadata'] as const).map((hunkSeparators) => ({
        ...input,
        options: { diffStyle, hunkSeparators },
      })),
    ),
  );
}

function patchNamed(oldPath: string, newPath: string): string {
  return createGitPatch({ ...benignChange(), oldPath, newPath });
}

function patchWithLine(payload: string): string {
  return createGitPatch({
    ...benignChange(),
    lines: [` ${payload}`, `-const a = '${payload}';`, `+const a = "${payload}";`, `+${payload}`],
  });
}

function patchWithContext(payload: string): string {
  return createGitPatch({ ...benignChange(), context: `function f() { ${payload}` });
}

function benignChange(): GitPatchInput {
  return {
    oldPath: 'a.ts',
    newPath: 'a.ts',
    lines: [' const kept = 1;', '-const a = 1;', '+const a = 2;'],
    context: 'function f() {',
  };
}
