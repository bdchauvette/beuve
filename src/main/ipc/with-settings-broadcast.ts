import type { InvokeChannel } from '#contract/ipc-contract.ts';

import type { IpcHandlers, IpcSender } from './create-ipc-handlers.ts';

/** The channels that change a preference another window shows (ADR 0068). */
const settingsChannels = [
  'display:set',
  'editor:set-preferred',
  'editor:set-review-edits-prefix',
  'trust:set',
  'trust:remove',
  'deps:set-repository-settings',
  'deps:set-tool-path',
] as const satisfies readonly InvokeChannel[];

/** A handler's answer, as far as telling success needs it. */
interface Settled {
  readonly ok: boolean;
}

/**
 * Wraps `handlers` so that a successful change of a preference calls `changed` with the sender,
 * which main turns into `settings:changed` for every other window: the Settings window and the
 * main window stay in step without either reading the other.
 */
export function withSettingsBroadcast(
  handlers: IpcHandlers,
  changed: (sender: IpcSender | undefined) => void,
): IpcHandlers {
  const wrapped: Record<string, unknown> = { ...handlers };
  for (const channel of settingsChannels) {
    const handler = handlers[channel] as (request: unknown, sender?: IpcSender) => Promise<Settled>;
    wrapped[channel] = async (request: unknown, sender?: IpcSender): Promise<unknown> => {
      const result = await handler(request, sender);
      if (result.ok) {
        changed(sender);
      }
      return result;
    };
  }
  return wrapped as IpcHandlers;
}
