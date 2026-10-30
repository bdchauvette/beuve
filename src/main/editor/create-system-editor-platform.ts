import { accessSync, appendFileSync, constants, statSync } from 'node:fs';
import process from 'node:process';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { EditorPlatform } from './editor-platform.ts';
import { spawnDetached } from './spawn-detached.ts';

export interface SystemEditorPlatformOptions {
  /** `shell.openExternal` in the app. */
  readonly openExternal?: (url: string) => Promise<void>;
  /**
   * Test hook: append each launch as a JSON line to this file instead of starting anything. Main
   * passes it only from an unpackaged app's `BEUVE_EDITOR_LAUNCH_LOG` (`readDevelopmentOverrides`).
   */
  readonly launchLog?: string;
}

/** The real machine: `process.env`, the file system and detached child processes. */
export function createSystemEditorPlatform(
  options: SystemEditorPlatformOptions = {},
): EditorPlatform {
  const { launchLog, openExternal } = options;
  const record = (entry: object): void => {
    if (launchLog !== undefined) {
      appendFileSync(launchLog, `${JSON.stringify(entry)}\n`);
    }
  };
  return {
    platform: process.platform,
    env: process.env,
    exists: isExecutableOrDirectory,
    spawn: async (command, args): Promise<Result<void, string>> => {
      if (launchLog === undefined) {
        return spawnDetached(command, args);
      }
      record({ command, args });
      return ok(undefined);
    },
    ...(openExternal !== undefined && {
      openExternal: async (url: string): Promise<void> => {
        if (launchLog === undefined) {
          await openExternal(url);
        } else {
          record({ url });
        }
      },
    }),
  };
}

function isExecutableOrDirectory(file: string): boolean {
  try {
    const stats = statSync(file);
    if (stats.isDirectory()) {
      return file.endsWith('.app');
    }
    accessSync(file, constants.X_OK);
    return stats.isFile();
  } catch {
    return false;
  }
}
