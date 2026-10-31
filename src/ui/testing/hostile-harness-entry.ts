import '../beuve-chat-drawer.ts';
import { installTrustedTypesPolicy } from '../install-trusted-types-policy.ts';

import { HostileHarness } from './hostile-harness.ts';
import { installPassThroughPolicy } from './install-pass-through-policy.ts';

/** Set by the test build: `pass-through` only with `--pass-through-policy` (the negative control). */
declare const hostileHarnessPolicy: 'sanitizing' | 'pass-through';

// The test build's page only (`node scripts/build.ts --hostile-harness`), never shipped: the
// production entries' order, so the default policy is in place before anything renders (ADR 0077).
if (hostileHarnessPolicy === 'pass-through') {
  installPassThroughPolicy();
} else {
  installTrustedTypesPolicy();
}

Object.defineProperty(globalThis, 'hostileHarness', { value: new HostileHarness(document.body) });
