/**
 * The languages the diff view highlights (ADR 0025), by the name `@pierre/diffs` detects from a
 * file name, mapped to the Shiki grammar module that serves it. The build replaces `shiki/langs`
 * with exactly these, each a lazy chunk; every other file renders as plain text.
 */
export const highlightedLanguages: Readonly<Record<string, string>> = Object.freeze({
  typescript: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  html: 'html',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  shellscript: 'shellscript',
  bash: 'shellscript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  go: 'go',
  python: 'python',
  rust: 'rust',
  ruby: 'ruby',
  perl: 'perl',
  awk: 'awk',
  fish: 'fish',
});
