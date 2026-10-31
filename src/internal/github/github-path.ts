/**
 * A tagged template for API paths that percent-encodes each interpolated segment, so an owner,
 * repository or branch name can't add path segments or a query:
 * ``githubPath`/repos/${owner}/${repo}/pulls/${number}` ``.
 */
export function githubPath(
  strings: TemplateStringsArray,
  ...values: readonly (string | number)[]
): string {
  return strings.reduce((path, text, index) => {
    const value = values[index];
    if (value === undefined) {
      return path + text;
    }
    return path + text + encodeURIComponent(String(value));
  }, '');
}
