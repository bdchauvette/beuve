import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/** What {@link writeFileAtomic} writes: text (as UTF-8), bytes, or chunks of either. */
export type AtomicFileData =
  string | Uint8Array | Iterable<string | Uint8Array> | AsyncIterable<string | Uint8Array>;

export interface WriteFileAtomicOptions {
  /** Permission bits, set when the file is created; the umask can only clear bits. */
  readonly mode: number;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Replaces `file` with `data` so that readers see the old contents or the new, never a part. The
 * data goes to a new temporary file beside it (a unique name, created exclusively with
 * `options.mode`), which is flushed to disk and renamed over `file`; the directory is then
 * flushed too where the platform allows it. On failure, an abort included, the temporary file is
 * removed and `file` is untouched. Concurrent writers never mix: the last rename wins whole.
 */
export async function writeFileAtomic(
  file: string,
  data: AtomicFileData,
  options: WriteFileAtomicOptions,
): Promise<void> {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  await using pending = new AsyncDisposableStack();
  {
    await using handle = await open(temporary, 'wx', options.mode);
    pending.defer(async (): Promise<void> => {
      await rm(temporary, { force: true });
    });
    await handle.writeFile(data, { signal: options.signal });
    await handle.sync();
  }
  await rename(temporary, file);
  pending.move();
  await syncDirectory(directory);
}

/** Codes from file systems that can't open or flush a directory; the rename is still atomic. */
const unsupportedSyncCodes = new Set(['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM', 'EACCES']);

/** Makes the rename durable: `fsync` on the directory, which Windows does not offer. */
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  try {
    await using handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === undefined || !unsupportedSyncCodes.has(code)) {
      throw error;
    }
  }
}
