const prefix = 'beuve://';

/**
 * Holds `beuve://` links (ADR 0098) that arrive before the app can act on them: macOS delivers
 * `open-url` during launch, and a first Linux launch has the link in its argv. `push` ignores
 * anything that is not a `beuve://` argument, so callers can hand it a whole argv.
 */
export class LinkInbox {
  private readonly waiting: string[] = [];
  private handler: ((link: string) => void) | undefined;

  /** Passes the link on, or keeps it until {@link attach}. */
  push(argument: string): void {
    if (!argument.toLowerCase().startsWith(prefix)) {
      return;
    }
    if (this.handler === undefined) {
      this.waiting.push(argument);
      return;
    }
    this.handler(argument);
  }

  /** Delivers the links kept so far, in order, then every later one. */
  attach(handler: (link: string) => void): void {
    this.handler = handler;
    for (const link of this.waiting.splice(0)) {
      handler(link);
    }
  }
}
