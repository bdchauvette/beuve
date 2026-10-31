import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { build } from 'electron-builder';
import type { Configuration } from 'electron-builder';

type Environment = Readonly<Record<string, string | undefined>>;

type Signing =
  | { readonly kind: 'ad-hoc' }
  | { readonly kind: 'developer-id'; readonly notarization: string | undefined };

/** In the order electron-builder tries them. `APPLE_API_KEY` is the path of the `.p8` file. */
const notarizationCredentials: readonly (readonly [string, readonly string[]])[] = [
  ['Apple ID', ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']],
  ['App Store Connect API key', ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']],
  ['keychain profile', ['APPLE_KEYCHAIN_PROFILE']],
];

await distMac();

/**
 * Builds the Apple silicon dmg and zip into `out/` from `electron-builder.yml` (ADR 0048). The
 * default, for personal use, is ad-hoc signed. With a Developer ID certificate in `CSC_LINK` (or `CSC_NAME` naming one in the keychain) the app is
 * signed with the hardened runtime, and notarized when a complete set of Apple credentials is in
 * the environment. Without one it is ad-hoc signed, without the hardened runtime, and says so: such
 * a build runs only where Gatekeeper is told to allow it (docs/packaging.md). Run after
 * `npm run build`; `npm run dist:mac` does both. `BEUVE_BUILD_VERSION` overrides the version in the
 * app and in the artifact names without touching `package.json` (untagged CI builds, ADR 0049).
 */
async function distMac(): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('dist:mac needs macOS (hdiutil, codesign, notarytool); use dist:linux-dir here');
    process.exitCode = 1;
    return;
  }
  const signing = chooseSigning(process.env);
  describeSigning(signing);
  const artifacts = await build({
    mac: [],
    config: configFor(signing, process.env['BEUVE_BUILD_VERSION']),
    publish: 'never',
  });
  for (const artifact of artifacts) {
    const { size } = await stat(artifact);
    console.log(`dist:mac: ${path.relative(process.cwd(), artifact)} ${mib(size)}`);
  }
}

function chooseSigning(env: Environment): Signing {
  const isSet = (name: string): boolean => (env[name] ?? '') !== '';
  if (!isSet('CSC_LINK') && !isSet('CSC_NAME')) {
    return { kind: 'ad-hoc' };
  }
  const complete = notarizationCredentials.find(([, names]) => {
    return names.every((name) => isSet(name));
  });
  return { kind: 'developer-id', notarization: complete?.[0] };
}

function describeSigning(signing: Signing): void {
  if (signing.kind === 'ad-hoc') {
    console.warn(
      'dist:mac: no CSC_LINK or CSC_NAME, so this is an ad-hoc signed, unnotarized build ' +
        'without the hardened runtime. Gatekeeper blocks it on other Macs; see docs/packaging.md.',
    );
    return;
  }
  if (signing.notarization === undefined) {
    console.log(
      'dist:mac: signing with Developer ID; no complete Apple credentials, so NOT notarizing',
    );
  } else {
    console.log(
      `dist:mac: signing with Developer ID and notarizing with the ${signing.notarization}`,
    );
  }
}

/**
 * Overrides merged over `electron-builder.yml`. Ad-hoc builds drop the hardened runtime: library
 * validation would reject ad-hoc signed frameworks, and the alternative entitlement
 * (`disable-library-validation`) would weaken a signed build too.
 */
function configFor(signing: Signing, version: string | undefined): Configuration {
  const base = signingConfig(signing);
  if (version === undefined || version === '') {
    return base;
  }
  return { ...base, extraMetadata: { version } };
}

function signingConfig(signing: Signing): Configuration {
  if (signing.kind === 'ad-hoc') {
    return { mac: { identity: '-', hardenedRuntime: false, notarize: false } };
  }
  return { forceCodeSigning: true, mac: { notarize: signing.notarization !== undefined } };
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
