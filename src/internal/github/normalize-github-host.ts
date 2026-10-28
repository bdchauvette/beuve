const labelCharacters = /^[a-z\d-]+$/;

/**
 * `host` lowercased, if it is a plain DNS hostname (`github.com`, `ghe.example.com`): no scheme,
 * port, path or leading dash, so it is safe to pass as an argument and to put in a URL.
 */
export function normalizeGithubHost(host: string): string | undefined {
  const lower = host.toLowerCase();
  if (lower.length === 0 || lower.length > 253) {
    return undefined;
  }
  const labels = lower.split('.');
  return labels.every((label) => isLabel(label)) ? lower : undefined;
}

function isLabel(label: string): boolean {
  return (
    label.length <= 63 &&
    labelCharacters.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  );
}
