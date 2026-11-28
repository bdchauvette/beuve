import type { IpcResult, PrepareRenameView } from '#contract/ipc-contract.ts';

import type { RenameNaming } from './beuve-rename-field.ts';

/** What Suggest Rename…'s field shows for `lsp:prepare-rename`'s answer (ADR 0163). Pure. */
export function renameNamingFrom(answer: IpcResult<PrepareRenameView>): RenameNaming {
  if (!answer.ok) {
    if (answer.error.code === 'cancelled') {
      return { kind: 'cancelled' };
    }
    return { kind: 'refused', message: answer.error.message };
  }
  if (answer.value.kind === 'ready') {
    return { kind: 'ready', placeholder: answer.value.placeholder };
  }
  return { kind: 'refused', message: answer.value.message };
}
