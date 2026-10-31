import { isIP } from 'node:net';

/**
 * Whether `url` names this machine: `localhost` (and its subdomains), `127.0.0.0/8` or `::1`
 * (ADR 0071, the non-loopback warning). Anything else, an unparsable URL included, may send the diff off the machine.
 */
export function isLoopbackUrl(url: string): boolean {
  const host = URL.parse(url)?.hostname.toLowerCase();
  if (host === undefined) {
    return false;
  }
  const bare = withoutBrackets(host);
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return true;
  }
  switch (isIP(bare)) {
    case 4: {
      return bare.startsWith('127.');
    }
    case 6: {
      return bare === '::1' || bare.startsWith('::ffff:127.');
    }
    default: {
      return false;
    }
  }
}

/** `::1` for the `[::1]` a URL writes an IPv6 host as. */
function withoutBrackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }
  return host;
}
