import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/**
 * What the store needs from Electron's `safeStorage` (Keychain on macOS, libsecret or kwallet on
 * Linux), declared here so main's services need no Electron and tests inject a double.
 */
export interface SecretCipher {
  readonly isAvailable: () => Promise<boolean>;
  readonly encrypt: (plainText: string) => Promise<Buffer>;
  readonly decrypt: (encrypted: Buffer) => Promise<string>;
  /** `os` for a real keychain or keyring, `basic` for Electron's fixed-key fallback on Linux. */
  readonly backend: () => 'os' | 'basic';
}

/** API keys, encrypted at rest and readable only in main (ADR 0068, 0070). */
export interface SecretStore {
  readonly status: () => Promise<'os' | 'basic' | 'unavailable'>;
  readonly has: (ref: string) => Promise<boolean>;
  /** The key in clear, for main to hand to an adapter; `undefined` when unset or unreadable. */
  readonly get: (ref: string) => Promise<string | undefined>;
  readonly set: (ref: string, secret: string) => Promise<Result<undefined, string>>;
  readonly remove: (ref: string) => Promise<void>;
}

/**
 * Keeps secrets in `filePath` (`<userData>/model-secrets.json`, never `settings.json`) as
 * base64 of the cipher's output, written atomically with mode 0600 (ADR 0070). Without a cipher
 * or a file, or when encryption is unavailable, nothing can be stored and `set` fails. Values
 * never appear in logs, errors or anything this returns but `get`.
 */
export function createSecretStore(options: {
  readonly filePath?: string;
  readonly cipher?: SecretCipher;
}): SecretStore {
  const { filePath, cipher } = options;
  let writes: Promise<unknown> = Promise.resolve();
  const isUsable = async (): Promise<boolean> =>
    filePath !== undefined && cipher !== undefined && (await cipher.isAvailable());
  const change = async (
    update: (secrets: Record<string, string>) => Record<string, string>,
  ): Promise<void> => {
    if (filePath === undefined) {
      return;
    }
    const previous = writes;
    const run = async (): Promise<void> => {
      await settled(previous);
      const secrets = update(await readSecrets(filePath));
      const next = { version: 1, secrets };
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, undefined, 2)}\n`, { mode: 0o600 });
      await rename(temporary, filePath);
    };
    const current = run();
    writes = settled(current);
    await current;
  };
  return {
    status: async (): Promise<'os' | 'basic' | 'unavailable'> =>
      cipher !== undefined && (await isUsable()) ? cipher.backend() : 'unavailable',
    has: async (ref): Promise<boolean> => {
      const secrets = await readSecrets(filePath);
      return secrets[ref] !== undefined;
    },
    get: async (ref): Promise<string | undefined> => {
      const secrets = await readSecrets(filePath);
      const stored = secrets[ref];
      if (cipher === undefined || stored === undefined || !(await cipher.isAvailable())) {
        return undefined;
      }
      try {
        return await cipher.decrypt(Buffer.from(Uint8Array.fromBase64(stored)));
      } catch {
        return undefined;
      }
    },
    set: async (ref, secret): Promise<Result<undefined, string>> => {
      if (cipher === undefined || !(await isUsable())) {
        return err('API keys cannot be stored: no system keychain or keyring is available.');
      }
      const bytes = await cipher.encrypt(secret);
      const encrypted = bytes.toBase64();
      await change((secrets) => ({ ...secrets, [ref]: encrypted }));
      return ok(undefined);
    },
    remove: async (ref): Promise<void> => {
      await change((secrets) =>
        Object.fromEntries(Object.entries(secrets).filter(([key]) => key !== ref)),
      );
    },
  };
}

/** The stored ciphertexts by reference; a missing or malformed file holds none. */
async function readSecrets(filePath: string | undefined): Promise<Record<string, string>> {
  if (filePath === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    parsed = undefined;
  }
  const secrets =
    typeof parsed === 'object' && parsed !== null && 'secrets' in parsed
      ? parsed.secrets
      : undefined;
  const entries = typeof secrets === 'object' && secrets !== null ? Object.entries(secrets) : [];
  return Object.fromEntries(
    entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** Waits for `promise` and ignores how it ended: writes stay in order after a failure. */
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // The writer that failed reports it.
  }
}
