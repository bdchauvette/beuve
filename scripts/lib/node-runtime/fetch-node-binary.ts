import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtempDisposable,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import { errorFrom } from '../../../src/x/error/error-from.ts';
import { err } from '../../../src/x/result/err.ts';
import { ok } from '../../../src/x/result/ok.ts';
import type { Result } from '../../../src/x/result/result.ts';

export interface FetchNodeBinaryOptions {
  /** Without the `v`, e.g. `26.13.0`. */
  readonly version: string;
  /** nodejs.org's platform and architecture, e.g. `darwin-arm64`. */
  readonly target: string;
  /** The pinned SHA-256 of `node-v<version>-<target>.tar.xz`, lowercase hex. */
  readonly sha256: string;
  /** Holds verified archives between runs. */
  readonly cacheDirectory: string;
  /** Receives `node` and a stamp naming the archive it came from. */
  readonly outputDirectory: string;
  /** Writes the body of `url` to `destination`; the caller decides how (and retries). */
  readonly download: (url: string, destination: string, signal?: AbortSignal) => Promise<void>;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}

export interface FetchedNode {
  /** `<outputDirectory>/node`. */
  readonly binary: string;
  /** Whether the archive had to be downloaded (it was not cached and verified). */
  readonly downloaded: boolean;
  /** Whether `node` had to be extracted (it was missing or from another archive). */
  readonly extracted: boolean;
}

export type FetchNodeError =
  | { readonly kind: 'download-failed'; readonly url: string; readonly message: string }
  | {
      readonly kind: 'checksum-mismatch';
      readonly url: string;
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly kind: 'extract-failed'; readonly archive: string; readonly message: string };

const defaultBaseUrl = 'https://nodejs.org/dist';
const runFile = promisify(execFile);

/**
 * Makes `<outputDirectory>/node` the `bin/node` of the official Node archive for `target`
 * (ADR 0084). The archive is checked against the pinned SHA-256 before anything is extracted from
 * it, and kept in `cacheDirectory`, so a second run neither downloads nor extracts. Only the
 * `node` executable is extracted; npm, headers and docs stay in the archive.
 */
export async function fetchNodeBinary(
  options: FetchNodeBinaryOptions,
): Promise<Result<FetchedNode, FetchNodeError>> {
  const { version, target, sha256, cacheDirectory, outputDirectory, signal } = options;
  const name = `node-v${version}-${target}`;
  const archive = path.join(cacheDirectory, `${name}.tar.xz`);
  const url = `${options.baseUrl ?? defaultBaseUrl}/v${version}/${name}.tar.xz`;
  const binary = path.join(outputDirectory, 'node');
  const stampPath = path.join(outputDirectory, 'node.source');
  const stamp = `${name}.tar.xz sha256:${sha256}\n`;

  const isCached = (await sha256Of(archive)) === sha256;
  if (!isCached) {
    const fetched = await downloadVerified(options, url, archive);
    if (!fetched.ok) {
      return fetched;
    }
  }
  if ((await readText(stampPath)) === stamp && (await isFile(binary))) {
    return ok({ binary, downloaded: !isCached, extracted: false });
  }
  const extracted = await extractNode(archive, `${name}/bin/node`, binary, signal);
  if (!extracted.ok) {
    return extracted;
  }
  await writeFile(stampPath, stamp, { ...(signal !== undefined && { signal }) });
  return ok({ binary, downloaded: !isCached, extracted: true });
}

async function downloadVerified(
  options: FetchNodeBinaryOptions,
  url: string,
  archive: string,
): Promise<Result<undefined, FetchNodeError>> {
  const partial = `${archive}.partial`;
  await mkdir(path.dirname(archive), { recursive: true });
  try {
    await options.download(url, partial, options.signal);
  } catch (error: unknown) {
    await rm(partial, { force: true });
    return err({ kind: 'download-failed', url, message: errorFrom(error).message });
  }
  const actual = (await sha256Of(partial)) ?? '';
  if (actual !== options.sha256) {
    await rm(partial, { force: true });
    return err({ kind: 'checksum-mismatch', url, expected: options.sha256, actual });
  }
  await rename(partial, archive);
  return ok(undefined);
}

async function extractNode(
  archive: string,
  member: string,
  binary: string,
  signal: AbortSignal | undefined,
): Promise<Result<undefined, FetchNodeError>> {
  await mkdir(path.dirname(binary), { recursive: true });
  await using scratch = await mkdtempDisposable(path.join(path.dirname(binary), '.extract-'));
  try {
    // GNU tar and bsdtar both detect xz when reading a file.
    await runFile('tar', ['-x', '--no-same-owner', '-f', archive, '-C', scratch.path, member], {
      ...(signal !== undefined && { signal }),
    });
  } catch (error: unknown) {
    return err({ kind: 'extract-failed', archive, message: errorFrom(error).message });
  }
  const extracted = path.join(scratch.path, member);
  await chmod(extracted, 0o755);
  await rename(extracted, binary);
  return ok(undefined);
}

async function sha256Of(file: string): Promise<string | undefined> {
  const hash = createHash('sha256');
  try {
    await pipeline(createReadStream(file), hash);
  } catch {
    return undefined;
  }
  return hash.digest('hex');
}

async function isFile(file: string): Promise<boolean> {
  try {
    const stats = await stat(file);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}
