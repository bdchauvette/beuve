import type { ServerDefinition } from './server-definition.ts';

export interface TypescriptServerOptions {
  /** Absolute path of the `typescript-language-server` executable; otherwise it is discovered. */
  readonly command?: string;
  /** Extra arguments placed before `--stdio`, e.g. a CLI script when `command` is a Node binary. */
  readonly leadingArgs?: readonly string[];
  /**
   * `tsserver.js` (or TypeScript's `lib` directory) to use. Pin it to beuve's own TypeScript for
   * untrusted workspaces: without it the server loads the workspace's `node_modules/typescript`.
   */
  readonly tsserverPath?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The registry entry for `typescript-language-server --stdio` (TypeScript and JavaScript).
 * Automatic type acquisition is off (it would run npm and reach the network) and tsserver logging
 * is off (it would write a `.log` directory into the workspace).
 */
export function typescriptServerDefinition(
  options: TypescriptServerOptions = {},
): ServerDefinition {
  const tsserver: Record<string, unknown> = { logVerbosity: 'off', trace: 'off' };
  if (options.tsserverPath !== undefined) {
    tsserver['path'] = options.tsserverPath;
  }
  return {
    id: 'typescript',
    command: options.command ?? 'typescript-language-server',
    args: [...(options.leadingArgs ?? []), '--stdio'],
    languageIds: {
      '.ts': 'typescript',
      '.mts': 'typescript',
      '.cts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.jsx': 'javascriptreact',
    },
    initializationOptions: {
      disableAutomaticTypingAcquisition: true,
      hostInfo: 'beuve',
      tsserver,
    },
    ...(options.env !== undefined && { env: options.env }),
    diagnosticsQuiet: Temporal.Duration.from({ milliseconds: 500 }),
  };
}
