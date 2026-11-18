import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic } from '#x/fs/write-file-atomic.ts';

const queues = new Map<string, Promise<void>>();

/**
 * Rewrites the settings file with `update` applied to its current contents, atomically and
 * owner-only (0600, `writeFileAtomic`). Updates to one file run one after another, so two writers
 * (the editor preference, remembered clone paths) never drop each other's keys. The reviewer edits
 * the file by hand too (`editors`, ADR 0141), so a file that exists but is not a JSON object is
 * never replaced: the update throws instead, and the reviewer's text stays as it is.
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
    const contents = update(await readForUpdate(filePath));
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

/** The file's object, `{}` when it doesn't exist; throws when its text is not a JSON object. */
async function readForUpdate(filePath: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (Error.isError(error) && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${filePath} is not valid JSON, so beuve left it unchanged; fix it and try again`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} does not hold a JSON object, so beuve left it unchanged`);
  }
  return parsed as Record<string, unknown>;
}
