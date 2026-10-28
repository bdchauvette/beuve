const tokenPattern = /\b(?:gh[opsuar]_\w{16,}|github_pat_\w{16,}|[\da-f]{40})\b/g;

/** `text` with GitHub-token-shaped substrings (`ghp_…`, `gho_…`, `github_pat_…`, 40-hex) replaced. */
export function redactSecrets(text: string): string {
  return text.replaceAll(tokenPattern, '[redacted]');
}
