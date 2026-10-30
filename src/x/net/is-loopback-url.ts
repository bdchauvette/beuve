import { isIP } from 'node:net';

/**
 * Whether `url` names this machine: `localhost` (and its subdomains), `127.0.0.0/8` or `::1`
 * (ADR 0071, the non-loopback warning). Anything else, an unparsable URL included, may send the diff off the machine.
 */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
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
