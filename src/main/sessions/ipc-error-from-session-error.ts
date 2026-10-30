import type { IpcError } from '#contract/ipc-contract.ts';
import type { SessionError } from '#internal/session/session.ts';

/** Maps a session-domain failure to an IPC error. Corrupt rows are internal faults. */
export function ipcErrorFromSessionError(error: SessionError): IpcError {
  switch (error.kind) {
    case 'invalid-commit-sha': {
      return { code: 'invalid-request', message: `not a full commit id: ${error.value}` };
    }
    case 'invalid-session-id': {
      return { code: 'invalid-request', message: 'sessionId is not a session id' };
    }
    case 'invalid-source': {
      return { code: 'invalid-request', message: error.reason };
    }
    case 'session-not-found': {
      return { code: 'not-found', message: 'no such session' };
    }
    case 'duplicate-session': {
      return { code: 'internal', message: 'a session for this change already exists' };
    }
    case 'corrupt-row': {
      return { code: 'internal', message: 'stored session data is corrupt' };
    }
  }
}
