import path from 'node:path';
import process from 'node:process';

import type { ResolvedTool } from '#internal/deps/plan-install.ts';

import type { ToolchainFinder, ToolRequest } from '../create-toolchain-finder.ts';

/** What fake toolchain discovery saw: every lookup, by executable. */
export interface FakeToolchains extends ToolchainFinder {
  readonly lookups: readonly string[];
}

/**
 * Toolchain discovery for tests (ADR 0058): `commands` maps an executable (`npm`, `bun`) to the
 * fake that stands in for it; anything else is not installed. No login shell is run.
 */
export function fakeToolchains(commands: ReadonlyMap<string, string> = new Map()): FakeToolchains {
  const lookups: string[] = [];
  const directories = new Set(Array.from(commands.values(), (command) => path.dirname(command)));
  return {
    lookups,
    searchPath: async (): Promise<string> => {
      await Promise.resolve();
      return [...directories, ...(process.env['PATH'] ?? '').split(path.delimiter)].join(
        path.delimiter,
      );
    },
    environment: async (): Promise<Readonly<Record<string, string>>> => {
      await Promise.resolve();
      return { MISE_FAKE: '1' };
    },
    find: async ({ candidate }: ToolRequest): Promise<ResolvedTool | undefined> => {
      await Promise.resolve();
      lookups.push(candidate.executable);
      const command = commands.get(candidate.executable);
      if (command === undefined) {
        return undefined;
      }
      return {
        executable: candidate.executable,
        command: [command],
        version: '9.9.9',
        env: { PATH: [path.dirname(command), process.env['PATH'] ?? ''].join(path.delimiter) },
      };
    },
  };
}
