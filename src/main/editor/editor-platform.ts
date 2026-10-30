import type { Result } from '#x/result/result.ts';

import type { EditorProbe } from './find-editor.ts';

/** Everything the editor services take from the machine, so tests launch nothing real. */
export interface EditorPlatform extends EditorProbe {
  readonly spawn: (command: string, args: readonly string[]) => Promise<Result<void, string>>;
  /** Opens an editor URL; absent outside Electron. Only allow-listed URLs are ever passed. */
  readonly openExternal?: (url: string) => Promise<void>;
}
