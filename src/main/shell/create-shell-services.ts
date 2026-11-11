import type { IpcResult, OpenedView, OpenUrlRequest } from '#contract/ipc-contract.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

/** The system browser for links the renderer shows (chat answers). */
export interface ShellServices {
  readonly openUrl: (request: OpenUrlRequest) => Promise<IpcResult<OpenedView>>;
}

export interface ShellServicesOptions {
  /** `shell.openExternal`; absent outside Electron, where opening answers `not-wired`. */
  readonly openExternal?: (url: string) => Promise<void>;
}

/**
 * `shell:open-url` opens an absolute `https:` or `http:` URL, as the URL parser normalizes it, in
 * the default browser; anything else (`file:`, `javascript:`, `data:`, other schemes, relative or
 * unparsable text) is `invalid-request` and never reaches the shell (ADR 0040, amended).
 */
export function createShellServices(options: ShellServicesOptions): ShellServices {
  return {
    openUrl: async ({ url }): Promise<IpcResult<OpenedView>> => {
      const parsed = URL.parse(url);
      if (parsed === null || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
        return err({
          code: 'invalid-request',
          message: 'Only http and https links open from beuve.',
        });
      }
      if (options.openExternal === undefined) {
        return err({ code: 'not-wired', message: 'no browser outside Electron' });
      }
      await options.openExternal(parsed.href);
      return ok({ opened: true });
    },
  };
}
