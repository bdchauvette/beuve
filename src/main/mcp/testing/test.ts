import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { test as baseTest } from '../../testing/test.ts';
import type { McpToolServices } from '../mcp-tool-services.ts';
import { startMcpServer } from '../start-mcp-server.ts';
import type { McpServerHandle } from '../start-mcp-server.ts';

/**
 * `src/main`'s `test` with an MCP server (ADR 0058): `mcpToken` is its bearer token and
 * `mcpServer` listens on an ephemeral loopback port (0, so tests never collide) over stub tool
 * services, and is stopped after the test.
 */
export const test = baseTest
  .extend('mcpToken', (): string => 'test-token-0123456789abcdefghijklmnopqrstuvwxyz')
  .extend('mcpServer', async ({ mcpToken, logger }, { onCleanup }): Promise<McpServerHandle> => {
    const services: McpToolServices = {
      getLspDiagnostics: async () => {
        return notImplemented();
      },
      runImpactCheck: async () => {
        await Promise.resolve();
        return ok({ breaches: [] });
      },
      runTraceProbe: async () => {
        return notImplemented();
      },
      readHumanReview: async () => {
        return notImplemented();
      },
    };
    const handle = okValueFrom(
      await startMcpServer({
        token: mcpToken,
        services,
        logger: logger.logger,
        version: '0.0.0-test',
        port: 0,
      }),
    );
    onCleanup(async () => {
      await handle.stop();
    });
    return handle;
  });

async function notImplemented(): Promise<ReturnType<typeof err<string>>> {
  await Promise.resolve();
  return err('not implemented yet');
}
