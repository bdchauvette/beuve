import type { IpcError } from '#contract/ipc-contract.ts';
import type { LspError } from '#internal/lsp/lsp-error.ts';

/** Maps an LSP failure to an IPC error with a short message; details stay in main's log. */
export function ipcErrorFromLspError(error: LspError): IpcError {
  switch (error.kind) {
    case 'invalid-root':
    case 'path-outside-root': {
      return { code: 'invalid-request', message: 'the path is outside the review checkout' };
    }
    case 'invalid-path': {
      return { code: 'not-found', message: `${error.path} ${error.reason}` };
    }
    case 'file-too-large': {
      return { code: 'unsupported', message: `${error.path} is too large for the language server` };
    }
    case 'unsupported-language': {
      return { code: 'unsupported', message: `no language server handles ${error.path}` };
    }
    case 'unknown-node': {
      return { code: 'not-found', message: 'that call hierarchy node has expired; peek again' };
    }
    case 'server-not-found': {
      return { code: 'lsp-failed', message: `language server ${error.serverId} is not installed` };
    }
    case 'server-start-failed':
    case 'server-exited': {
      return { code: 'lsp-failed', message: `language server ${error.serverId} is not running` };
    }
    case 'capability-missing': {
      return {
        code: 'unsupported',
        message: `language server ${error.serverId} has no ${error.capability} support`,
      };
    }
    case 'request-failed':
    case 'request-timeout':
    case 'request-cancelled':
    case 'unexpected-response': {
      return {
        code: 'lsp-failed',
        message: `the language server could not answer ${error.method}`,
      };
    }
    case 'disposed': {
      return { code: 'lsp-failed', message: 'beuve is shutting down' };
    }
  }
}
