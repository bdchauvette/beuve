const sha256Digest = /^[0-9a-f]{64}$/;
const versionLine = /^( *version )".*"$/m;
const sha256Line = /^( *sha256 )".*"$/m;

/**
 * Returns the cask source with its `version` and `sha256` replaced. Throws an `Error` when either
 * line is missing, so a reformatted cask fails the release instead of going stale.
 */
export function updateCask(source: string, version: string, sha256: string): string {
  if (!sha256Digest.test(sha256)) {
    throw new Error(`not a SHA-256 digest: ${sha256}`);
  }
  return replaceOnce(replaceOnce(source, versionLine, version), sha256Line, sha256);
}

function replaceOnce(source: string, line: RegExp, value: string): string {
  if (!line.test(source)) {
    throw new Error(`cask has no line matching ${String(line)}`);
  }
  return source.replace(line, (_match, prefix: string) => `${prefix}"${value}"`);
}
