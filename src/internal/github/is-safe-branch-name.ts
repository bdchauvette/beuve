const branchCharacters = /^[\w./-]+$/u;

/**
 * Whether `name` is in a conservative subset of `git check-ref-format --branch`: word characters,
 * `.`, `/` and `-`, no empty or dot-led segment, no `..`, and no leading `-` or trailing `.lock`.
 * Such a name is safe in a refspec and an API path. Pure.
 */
export function isSafeBranchName(name: string): boolean {
  return (
    name.length <= 250 &&
    branchCharacters.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    name.split('/').every((segment) => !segment.startsWith('.'))
  );
}
