import path from 'node:path';

import { createLspMultiplexer } from '../create-lsp-multiplexer.ts';
import type { LspMultiplexer } from '../create-lsp-multiplexer.ts';
import { typescriptServerDefinition } from '../typescript-server-definition.ts';
import { createTypescriptProject } from './create-typescript-project.ts';
import type { TypescriptProject } from './create-typescript-project.ts';

/** A {@link TypescriptProject} with a multiplexer running the real typescript-language-server. */
export interface TypescriptWorkspace {
  readonly project: TypescriptProject;
  readonly lsp: LspMultiplexer;
}

/**
 * Creates the project under `parent` and a multiplexer over beuve's own typescript-language-server
 * and TypeScript. The server starts on the first request; the caller disposes `lsp`.
 */
export function createTypescriptWorkspace(parent: string): TypescriptWorkspace {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
  return {
    project: createTypescriptProject(parent),
    lsp: createLspMultiplexer({
      servers: [
        typescriptServerDefinition({
          tsserverPath: path.join(
            repositoryRoot,
            'node_modules',
            'typescript',
            'lib',
            'tsserver.js',
          ),
        }),
      ],
      searchDirectories: [path.join(repositoryRoot, 'node_modules', '.bin')],
      requestTimeout: Temporal.Duration.from({ seconds: 30 }),
      diagnosticsTimeout: Temporal.Duration.from({ seconds: 45 }),
    }),
  };
}
