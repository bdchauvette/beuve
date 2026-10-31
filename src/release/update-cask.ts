const sha256Digest = /^[0-9a-f]{64}$/;
const versionLine = /^( *version )".*"$/m;
const sha256Line = /^( *sha256 )".*"$/m;

/** The release a cask is pointed at. */
export interface CaskRelease {
  readonly version: string;
  /** Hex SHA-256 of the release's arm64 zip. */
  readonly sha256: string;
}

/**
 * Returns the cask source with its `version` and `sha256` replaced. Throws an `Error` when either
 * line is missing, so a reformatted cask fails the release instead of going stale.
 */
export function updateCask(source: string, { version, sha256 }: CaskRelease): string {
  if (!sha256Digest.test(sha256)) {
    throw new Error(`not a SHA-256 digest: ${sha256}`);
  }
  const versioned = replaceOnce(source, { line: versionLine, value: version });
  return replaceOnce(versioned, { line: sha256Line, value: sha256 });
}

interface LineReplacement {
  readonly line: RegExp;
  readonly value: string;
}

function replaceOnce(source: string, { line, value }: LineReplacement): string {
  if (!line.test(source)) {
    throw new Error(`cask has no line matching ${String(line)}`);
  }
  return source.replace(line, (_match, prefix: string) => `${prefix}"${value}"`);
}
