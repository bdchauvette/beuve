import { createRuleTester } from './create-rule-tester.ts';
import { noElectronAsNode } from './no-electron-as-node.ts';

createRuleTester().run('no-electron-as-node', noElectronAsNode, {
  valid: [
    "import { spawn } from 'node:child_process'; spawn('/usr/bin/node', ['--version']);",
    "import childProcess from 'node:child_process'; childProcess.spawn('node', []);",
    // `fork` of something other than child_process.
    "import { fork } from './git-fork.ts'; fork();",
    'declare const repo: { fork: () => void }; repo.fork();',
    "const env = { NODE_ENV: 'test', ELECTRON_RUN: '1' };",
  ],
  invalid: [
    {
      code: "const env = { ELECTRON_RUN_AS_NODE: '1' };",
      errors: [{ messageId: 'runAsNode' }],
    },
    {
      code: "const env: Record<string, string> = {}; env['ELECTRON_RUN_AS_NODE'] = '1';",
      errors: [{ messageId: 'runAsNode' }],
    },
    {
      code: 'declare const env: Record<string, string>; const on = env.ELECTRON_RUN_AS_NODE;',
      errors: [{ messageId: 'runAsNode' }],
    },
    {
      code: 'const line = `${"x"}ELECTRON_RUN_AS_NODE=1`;',
      errors: [{ messageId: 'runAsNode' }],
    },
    {
      code: "import { fork } from 'node:child_process'; fork('child.js');",
      errors: [{ messageId: 'fork' }],
    },
    {
      code: "import { fork as start } from 'child_process'; start('child.js');",
      errors: [{ messageId: 'fork' }],
    },
    {
      code: "import childProcess from 'node:child_process'; childProcess.fork('child.js');",
      errors: [{ messageId: 'fork' }],
    },
    {
      code: "import * as cp from 'node:child_process'; cp['fork']('child.js');",
      errors: [{ messageId: 'fork' }],
    },
  ],
});
