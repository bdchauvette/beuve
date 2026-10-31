/**
 * Repository paths that git C-quotes wherever it quotes (`"`, `\`, tab, newline) or that are not
 * ASCII, built at run time. Each is a valid file name on Linux and on macOS (APFS rejects only
 * `/` and NUL), and the non-ASCII one is NFC, which macOS keeps as is.
 */
export function hostilePathNames(): readonly string[] {
  return [
    'quote"d.ts',
    String.raw`back\slash.ts`,
    'tab\there.ts',
    'new\nline.ts',
    'gr\u{FC}\u{DF}e-\u{E9}t\u{E9}.ts',
    'dir "with" quotes/inner\tfile.ts',
  ];
}
