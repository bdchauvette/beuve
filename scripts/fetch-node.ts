import { createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { errorFrom } from '../src/x/error/error-from.ts';

import { fetchNodeBinary } from './lib/node-runtime/fetch-node-binary.ts';
import type { FetchNodeError } from './lib/node-runtime/fetch-node-binary.ts';
import pinned from './node-runtime.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '..');
/** Pauses before each retry, in milliseconds. */
const retryPauses = [2000, 5000, 15_000];

await fetchNode();

/**
 * Puts the pinned Node (`scripts/node-runtime.json`, ADR 0084) at `vendor/node/<target>/node`,
 * where `electron-builder.yml` takes it from as `resources/node/node`. `--target` defaults to this
 * machine (`darwin-arm64`, `linux-x64`). Downloads go to `vendor/node/cache` and are verified
 * against the pinned SHA-256 before use; a second run with the same pin does nothing.
 * `npm run dist:*` runs it first. Behind a proxy, set `NODE_USE_ENV_PROXY=1`.
 */
async function fetchNode(): Promise<void> {
  const { values } = parseArgs({
    options: { target: { type: 'string', default: `${process.platform}-${process.arch}` } },
  });
  const target = values.target;
  const sha256 = (pinned.sha256 as Readonly<Record<string, string>>)[target];
  if (sha256 === undefined) {
    console.error(
      `fetch-node: no pinned Node for ${target}; beuve ships ${Object.keys(pinned.sha256).join(' and ')}`,
    );
    process.exitCode = 1;
    return;
  }
  const fetched = await fetchNodeBinary({
    version: pinned.version,
    target,
    sha256,
    cacheDirectory: path.join(root, 'vendor', 'node', 'cache'),
    outputDirectory: path.join(root, 'vendor', 'node', target),
    download: downloadWithRetries,
  });
  if (!fetched.ok) {
    console.error(`fetch-node: ${describe(fetched.error)}`);
    process.exitCode = 1;
    return;
  }
  const { binary, downloaded, extracted } = fetched.value;
  const what = downloaded ? 'downloaded and verified' : extracted ? 'extracted' : 'up to date';
  console.log(
    `fetch-node: Node ${pinned.version} for ${target} ${what}: ${path.relative(root, binary)}`,
  );
}

async function downloadWithRetries(url: string, destination: string): Promise<void> {
  for (const pause of [...retryPauses, undefined]) {
    try {
      await download(url, destination);
      return;
    } catch (error: unknown) {
      if (pause === undefined) {
        throw error;
      }
      console.warn(`fetch-node: ${errorFrom(error).message}; retrying in ${String(pause)} ms`);
      await delay(pause);
    }
  }
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${url} answered ${String(response.status)}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function describe(error: FetchNodeError): string {
  switch (error.kind) {
    case 'download-failed': {
      return `could not download ${error.url}: ${error.message}`;
    }
    case 'checksum-mismatch': {
      return `${error.url} has SHA-256 ${error.actual}, not the pinned ${error.expected}; nothing was extracted`;
    }
    case 'extract-failed': {
      return `could not extract node from ${error.archive}: ${error.message}`;
    }
  }
}
