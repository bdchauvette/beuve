import type { JsonRpcHandlerOutcome } from '#jsonrpc/json-rpc-connection.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { WorkspaceFolder } from './lsp-protocol.ts';

export interface ServerRequestContext {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly workspaceFolders: readonly WorkspaceFolder[];
}

const methodNotFound = -32_601;

/**
 * Answers requests a server sends to the client, minimally and without side effects. Edits are
 * refused (`workspace/applyEdit` → `applied: false`), UI requests are declined, registrations and
 * refresh requests are acknowledged and ignored, and anything else is "method not found".
 */
export function answerServerRequest(
  method: string,
  params: unknown,
  context: ServerRequestContext,
): JsonRpcHandlerOutcome {
  switch (method) {
    case 'workspace/applyEdit': {
      return ok({ applied: false, failureReason: 'beuve is a read-only review tool' });
    }
    case 'workspace/configuration': {
      return ok(configurationItems(params).map((section) => lookUp(context.settings, section)));
    }
    case 'workspace/workspaceFolders': {
      return ok(context.workspaceFolders);
    }
    case 'window/showDocument': {
      return ok({ success: false });
    }
    case 'window/workDoneProgress/create':
    case 'window/showMessageRequest':
    case 'client/registerCapability':
    case 'client/unregisterCapability':
    case 'workspace/codeLens/refresh':
    case 'workspace/semanticTokens/refresh':
    case 'workspace/inlayHint/refresh':
    case 'workspace/inlineValue/refresh':
    case 'workspace/diagnostic/refresh':
    case 'workspace/foldingRange/refresh': {
      return ok(undefined);
    }
    default: {
      return err({ code: methodNotFound, message: `beuve does not handle ${method}` });
    }
  }
}

function configurationItems(params: unknown): (string | undefined)[] {
  if (typeof params !== 'object' || params === null || !('items' in params)) {
    return [];
  }
  const { items } = params;
  if (Array.isArray(items)) {
    return items.map((item: unknown) => sectionOf(item));
  }
  return [];
}

function sectionOf(item: unknown): string | undefined {
  if (
    typeof item === 'object' &&
    item !== null &&
    'section' in item &&
    typeof item.section === 'string'
  ) {
    return item.section;
  }
  return undefined;
}

function lookUp(settings: Readonly<Record<string, unknown>>, section: string | undefined): unknown {
  if (section === undefined || section === '') {
    return settings;
  }
  let current: unknown = settings;
  for (const key of section.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Readonly<Record<string, unknown>>)[key];
  }
  return current;
}
