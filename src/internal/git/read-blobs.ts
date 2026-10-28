import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { GitError } from './git-error.ts';
import { isObjectId } from './is-object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** A blob to read, by full object name. `mode` is the file mode from the diff, when known. */
export interface BlobRequest {
  readonly objectId: string;
  readonly mode?: string | undefined;
}

/**
 * What a blob holds, as far as a reader of source text cares. Binary means a NUL byte in the
 * first 8000 bytes (git's own heuristic). A gitlink (mode `160000`) names a commit in another
 * repository, so it is never read.
 */
export type BlobContent =
  | { readonly kind: 'text'; readonly text: string; readonly size: number }
  | { readonly kind: 'binary'; readonly size: number }
  | { readonly kind: 'too-large'; readonly size: number; readonly limit: number }
  | { readonly kind: 'submodule' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'not-a-blob'; readonly type: string };

export interface ReadBlobsOptions {
  /** Blobs larger than this many bytes are reported as `too-large` without being read. Defaults to 1 MiB. */
  readonly maxBlobBytes?: number;
}

interface ObjectInfo {
  readonly objectId: string;
  readonly type: string | undefined;
  readonly size: number;
}

const defaultMaxBlobBytes = 1024 * 1024;
const gitlinkMode = '160000';
const binaryProbeBytes = 8000;
const headerAllowanceBytes = 160;

/**
 * Reads many blobs with two `git cat-file` processes whatever their number: `--batch-check` for
 * types and sizes, then `--batch` for the text blobs within the limit, parsed by byte count.
 * Results are keyed by object id; duplicates are read once.
 */
export async function readBlobs(
  repository: GitRepository,
  requests: readonly BlobRequest[],
  options: ReadBlobsOptions = {},
): Promise<Result<ReadonlyMap<string, BlobContent>, GitError>> {
  const limit = options.maxBlobBytes ?? defaultMaxBlobBytes;
  const contents = new Map<string, BlobContent>();
  const pending = new Set<string>();
  for (const { objectId, mode } of requests) {
    if (!isObjectId(objectId)) {
      return err({ kind: 'invalid-argument', argument: objectId, reason: 'not a full object id' });
    }
    if (mode === gitlinkMode) {
      contents.set(objectId, { kind: 'submodule' });
    } else if (!contents.has(objectId)) {
      pending.add(objectId);
    }
  }
  if (pending.size === 0) {
    return ok(contents);
  }
  const infos = await checkObjects(repository, [...pending]);
  if (!infos.ok) {
    return infos;
  }
  const wanted: ObjectInfo[] = [];
  for (const info of infos.value) {
    const verdict = classify(info, limit);
    if (verdict === undefined) {
      wanted.push(info);
    } else {
      contents.set(info.objectId, verdict);
    }
  }
  const read = await readContents(repository, wanted);
  if (!read.ok) {
    return read;
  }
  for (const [objectId, bytes] of read.value) {
    contents.set(objectId, toContent(bytes));
  }
  return ok(contents);
}

async function checkObjects(
  repository: GitRepository,
  objectIds: readonly string[],
): Promise<Result<readonly ObjectInfo[], GitError>> {
  const args = ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)', '--buffer'];
  const output = await repository.exec(args, { input: lines(objectIds) });
  if (!output.ok) {
    return output;
  }
  const rows = output.value.toString('utf8').split('\n').slice(0, objectIds.length);
  const infos: ObjectInfo[] = [];
  for (const [index, objectId] of objectIds.entries()) {
    const info = parseInfo(rows[index] ?? '', objectId);
    if (info === undefined) {
      return err({
        kind: 'unexpected-output',
        args,
        message: `bad batch-check line for ${objectId}`,
      });
    }
    infos.push(info);
  }
  return ok(infos);
}

function lines(values: readonly string[]): string {
  return values.map((value) => `${value}\n`).join('');
}

function parseInfo(row: string, objectId: string): ObjectInfo | undefined {
  const [name, type, size] = row.split(' ', 3);
  if (name !== objectId) {
    return undefined;
  }
  if (type === 'missing') {
    return { objectId, type: undefined, size: 0 };
  }
  const bytes = Number(size);
  return type === undefined || !Number.isSafeInteger(bytes)
    ? undefined
    : { objectId, type, size: bytes };
}

function classify(info: ObjectInfo, limit: number): BlobContent | undefined {
  if (info.type === undefined) {
    return { kind: 'missing' };
  }
  if (info.type !== 'blob') {
    return { kind: 'not-a-blob', type: info.type };
  }
  return info.size > limit ? { kind: 'too-large', size: info.size, limit } : undefined;
}

async function readContents(
  repository: GitRepository,
  infos: readonly ObjectInfo[],
): Promise<Result<ReadonlyMap<string, Buffer>, GitError>> {
  const read = new Map<string, Buffer>();
  if (infos.length === 0) {
    return ok(read);
  }
  const args = ['cat-file', '--batch', '--buffer'];
  const total = infos.reduce((sum, info) => sum + info.size + headerAllowanceBytes, 0);
  const output = await repository.exec(args, {
    input: lines(infos.map((info) => info.objectId)),
    maxBufferBytes: total + 1024,
  });
  if (!output.ok) {
    return output;
  }
  let offset = 0;
  for (const info of infos) {
    const newline = output.value.indexOf(0x0a, offset);
    const header = newline === -1 ? '' : output.value.toString('utf8', offset, newline);
    const start = newline + 1;
    const end = start + info.size;
    if (header !== `${info.objectId} blob ${String(info.size)}` || output.value[end] !== 0x0a) {
      return err({
        kind: 'unexpected-output',
        args,
        message: `bad batch record for ${info.objectId}`,
      });
    }
    read.set(info.objectId, output.value.subarray(start, end));
    offset = end + 1;
  }
  return ok(read);
}

function toContent(bytes: Buffer): BlobContent {
  const probe = bytes.subarray(0, binaryProbeBytes);
  return probe.includes(0)
    ? { kind: 'binary', size: bytes.length }
    : { kind: 'text', text: new TextDecoder('utf-8').decode(bytes), size: bytes.length };
}
