import type { SecretCipher } from '../create-secret-store.ts';

/**
 * A stand-in for Electron's `safeStorage` (ADR 0070): XOR with a fixed byte, so the stored bytes
 * never contain the clear text, reversible so `get` works. `available: false` is a machine
 * without a keychain or keyring.
 */
export function createFakeCipher(
  options: { readonly available?: boolean; readonly backend?: 'os' | 'basic' } = {},
): SecretCipher {
  return {
    isAvailable: async (): Promise<boolean> => {
      await Promise.resolve();
      return options.available ?? true;
    },
    encrypt: async (plainText): Promise<Buffer> => {
      await Promise.resolve();
      return flip(Buffer.from(plainText, 'utf8'));
    },
    decrypt: async (encrypted): Promise<string> => {
      await Promise.resolve();
      return flip(encrypted).toString('utf8');
    },
    backend: (): 'os' | 'basic' => options.backend ?? 'os',
  };
}

function flip(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.map((byte) => byte ^ 0x5a));
}
