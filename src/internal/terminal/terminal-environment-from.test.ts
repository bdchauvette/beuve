import { test } from '#testing/test.ts';

import { terminalEnvironmentFrom } from './terminal-environment-from.ts';
import type { TerminalEnvironmentSource } from './terminal-environment-from.ts';

test('passes the user environment on and adds TERM and the BEUVE variables', ({ expect }) => {
  const environment = terminalEnvironmentFrom({
    ...source(),
    inherited: { PATH: '/bin', HOME: '/home/u', EMPTY: undefined },
  });
  expect(environment).toMatchObject({
    PATH: '/bin',
    HOME: '/home/u',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'beuve',
    TERM_PROGRAM_VERSION: '1.2.3',
    BEUVE_CHECKOUT: '/c',
    BEUVE_HEAD_SHA: 'abc',
    BEUVE_SESSION_ID: 's1',
    BEUVE_REPOSITORY: '/r',
  });
  expect(environment).not.toHaveProperty('EMPTY');
});

test('drops what only Electron needs', ({ expect }) => {
  const environment = terminalEnvironmentFrom({
    ...source(),
    inherited: {
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_ENABLE_LOGGING: '1',
      NODE_OPTIONS: '--inspect',
      CHROME_DESKTOP: 'x.desktop',
      LANG: 'en_US.UTF-8',
    },
  });
  expect(Object.keys(environment)).not.toContain('ELECTRON_RUN_AS_NODE');
  expect(Object.keys(environment)).not.toContain('ELECTRON_ENABLE_LOGGING');
  expect(Object.keys(environment)).not.toContain('NODE_OPTIONS');
  expect(Object.keys(environment)).not.toContain('CHROME_DESKTOP');
  expect(environment['LANG']).toBe('en_US.UTF-8');
});

test('overrides a TERM the parent set', ({ expect }) => {
  const environment = terminalEnvironmentFrom({ ...source(), inherited: { TERM: 'dumb' } });
  expect(environment['TERM']).toBe('xterm-256color');
});

/** The source minus the environment each test passes. */
type SourceWithoutEnvironment = Omit<TerminalEnvironmentSource, 'inherited'>;

function source(): SourceWithoutEnvironment {
  return {
    checkout: '/c',
    headSha: 'abc',
    sessionId: 's1',
    repositoryPath: '/r',
    version: '1.2.3',
  };
}
