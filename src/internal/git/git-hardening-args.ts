/**
 * Global options that make git's output predictable and keep repository-controlled config from
 * running programs: no pager, literal pathspecs, unquoted UTF-8 paths, no colour, no fsmonitor
 * or hooks, and standard `a/` `b/` diff prefixes. Every git process beuve starts gets them.
 */
export const gitHardeningArgs: readonly string[] = [
  '--no-pager',
  '--literal-pathspecs',
  '-c',
  'core.quotepath=off',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'color.ui=false',
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.mnemonicPrefix=false',
  '-c',
  'diff.relative=false',
];
