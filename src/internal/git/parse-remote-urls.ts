/** A remote's configured fetch URL. */
export interface RemoteUrl {
  readonly name: string;
  /** As written in the config, before any `url.<base>.insteadOf` rewrite. */
  readonly url: string;
}

const keyPattern = /^remote\.(.+)\.url$/su;

/**
 * Parses `git config --null --get-regexp '^remote\..+\.url$'`: NUL-terminated entries, each
 * `<key>\n<value>`. A remote with several URLs keeps them all, in config order. Pure.
 */
export function parseRemoteUrls(output: string): RemoteUrl[] {
  const remotes: RemoteUrl[] = [];
  for (const entry of output.split('\0')) {
    const newline = entry.indexOf('\n');
    if (newline === -1) {
      continue;
    }
    const name = keyPattern.exec(entry.slice(0, newline))?.[1];
    const url = entry.slice(newline + 1);
    if (name !== undefined && url !== '') {
      remotes.push({ name, url });
    }
  }
  return remotes;
}
