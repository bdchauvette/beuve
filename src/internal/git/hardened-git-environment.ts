import process from 'node:process';

/**
 * The environment every git process beuve starts runs with: inherited `GIT_*` variables are
 * dropped so the caller's environment can't redirect git to another repository, prompts and
 * pagers are disabled, optional locks and replace objects are off, and messages are in the C
 * locale so failures can be classified.
 */
export function hardenedGitEnvironment(): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([key]) => !key.toUpperCase().startsWith('GIT_'),
  );
  return {
    ...Object.fromEntries(inherited),
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    LC_ALL: 'C',
    LANGUAGE: 'C',
  };
}
