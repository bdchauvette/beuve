import type { KeyPlatform } from '#contract/command-catalog.ts';

/**
 * The keyboard layout for a platform name, Node's (`darwin`) or the browser's (`MacIntel`):
 * macOS, else Linux's. Pure.
 */
export function keyPlatformOf(platform: string | undefined): KeyPlatform {
  if (platform === 'darwin' || platform?.startsWith('Mac') === true) {
    return 'mac';
  }
  return 'linux';
}
