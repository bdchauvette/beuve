/**
 * Whether `event` started on `host` itself rather than inside its shadow root. A listener on the
 * host sees `event.target === host` for both, since targets in a shadow root are retargeted to
 * it, so a scrim that closes on a click outside its panel reads the composed path instead.
 */
export function isOwnClick(event: Event, host: EventTarget): boolean {
  return event.composedPath()[0] === host;
}
