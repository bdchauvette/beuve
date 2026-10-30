/**
 * Whether an OpenAI-compatible base URL points off this machine (ADR 0071), for the form's live
 * warning: anything but `localhost`, `*.localhost`, `127.0.0.0/8` and `::1`, an unparsable URL
 * included. Main decides the same for stored entries. Pure.
 */
export function isRemoteBaseUrl(url: string): boolean {
  const host = URL.parse(url)?.hostname.toLowerCase();
  if (host === undefined) {
    return true;
  }
  const isLoopback =
    host === 'localhost' || host === '[::1]' || host.endsWith('.localhost') || isIpv4Loopback(host);
  return !isLoopback;
}

const decimalPart = /^\d{1,3}$/u;

/** `127.a.b.c` with four decimal parts, each 0–255. */
function isIpv4Loopback(host: string): boolean {
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => decimalPart.test(part) && Number(part) <= 255)
  );
}
