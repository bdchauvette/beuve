import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic } from '#x/fs/write-file-atomic.ts';

import { readSettingsFile } from './read-settings-file.ts';

const queues = new Map<string, Promise<void>>();

/**
 * Rewrites the settings file with `update` applied to its current contents, atomically and
 * owner-only (0600, `writeFileAtomic`). Updates to one file run one after another, so two writers
 * (the editor preference, remembered clone paths) never drop each other's keys.
 */
export async function updateSettingsFile(
  filePath: string,
  update: (current: Readonly<Record<string, unknown>>) => Record<string, unknown>,
): Promise<void> {
  const previous = queues.get(filePath);
  const write = async (): Promise<void> => {
    try {
      await previous;
    } catch {
      // The previous writer reports its own failure.
    }
    const contents = update(await readSettingsFile(filePath));
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFileAtomic(filePath, `${JSON.stringify(contents, undefined, 2)}\n`, {
      mode: 0o600,
    });
  };
  const current = write();
  queues.set(filePath, current);
  try {
    await current;
  } finally {
    if (queues.get(filePath) === current) {
      queues.delete(filePath);
    }
  }
}
