import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { IpcResult, OpenedConfigView } from '#contract/ipc-contract.ts';
import { errorFrom } from '#x/error/error-from.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

/** Opens the reviewer's language server configuration for editing (ADR 0111). */
export interface LanguageServerConfigServices {
  /**
   * Opens `language-servers.json` in the reviewer's own program for JSON files. When none of the
   * places has one, an empty one is created in the first (the XDG location) so there is
   * something to edit. When several exist, the one that wins, the last, is opened. Beuve never
   * writes to a file that exists: it only reads these.
   */
  readonly open: () => Promise<IpcResult<OpenedConfigView>>;
}

export interface LanguageServerConfigServicesOptions {
  /** The files, earliest first (`languageServersConfigPaths`). */
  readonly paths: readonly string[];
  /** Electron's `shell.openPath`: resolves to `''` on success, else a message. */
  readonly openPath: (file: string) => Promise<string>;
  readonly logger: Logger;
}

export function createLanguageServerConfigServices(
  options: LanguageServerConfigServicesOptions,
): LanguageServerConfigServices {
  const { logger } = options;
  return {
    open: async (): Promise<IpcResult<OpenedConfigView>> => {
      const existing = await lastExisting(options.paths);
      let target = existing;
      let isCreated = false;
      if (target === undefined) {
        const [first] = options.paths;
        if (first === undefined) {
          return err({ code: 'not-wired', message: 'there is nowhere to keep a configuration' });
        }
        const created = await createEmpty(first);
        if (!created.ok) {
          logger.warn('could not create the language server configuration', {
            file: first,
            error: created.error,
          });
          return err({ code: 'internal', message: `Could not create ${first}: ${created.error}` });
        }
        target = first;
        isCreated = true;
      }
      const failure = await options.openPath(target);
      if (failure !== '') {
        logger.warn('could not open the language server configuration', { file: target, failure });
        return err({ code: 'internal', message: `Could not open ${target}: ${failure}` });
      }
      return ok({ path: target, created: isCreated });
    },
  };
}

/** The last of `paths` that exists: the file that wins where several differ. */
async function lastExisting(paths: readonly string[]): Promise<string | undefined> {
  for (const file of paths.toReversed()) {
    try {
      await using _handle = await open(file, 'r');
      return file;
    } catch {
      continue;
    }
  }
  return undefined;
}

type Created = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** An empty object, not overwriting a file that appeared in the meantime. */
async function createEmpty(file: string): Promise<Created> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
  } catch (error: unknown) {
    return { ok: false, error: errorFrom(error).message };
  }
  try {
    await writeFile(file, '{}\n', { flag: 'wx', mode: 0o644 });
    return { ok: true };
  } catch (error: unknown) {
    if (Error.isError(error) && 'code' in error && error.code === 'EEXIST') {
      return { ok: true };
    }
    return { ok: false, error: errorFrom(error).message };
  }
}
