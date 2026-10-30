import { positionEncodings } from './position-encodings.ts';

/**
 * What beuve tells servers it can do. Deliberately read-only: no `workspace.applyEdit`, no
 * `workspaceEdit`, no rename, code actions, formatting, completion or file operations, so a
 * well-behaved server never proposes a change. Full-text document sync only; UTF-16 positions are
 * preferred but UTF-8 and UTF-32 are accepted and converted.
 */
export const clientCapabilities = Object.freeze({
  general: {
    positionEncodings: [positionEncodings.utf16, positionEncodings.utf8, positionEncodings.utf32],
  },
  workspace: {
    applyEdit: false,
    configuration: true,
    workspaceFolders: true,
    didChangeConfiguration: { dynamicRegistration: false },
  },
  window: {
    workDoneProgress: true,
    showDocument: { support: false },
  },
  textDocument: {
    synchronization: {
      dynamicRegistration: false,
      willSave: false,
      willSaveWaitUntil: false,
      didSave: false,
    },
    publishDiagnostics: {
      relatedInformation: true,
      versionSupport: true,
      tagSupport: { valueSet: [1, 2] },
      codeDescriptionSupport: true,
    },
    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
    callHierarchy: { dynamicRegistration: false },
    definition: { dynamicRegistration: false, linkSupport: true },
    typeDefinition: { dynamicRegistration: false, linkSupport: true },
    references: { dynamicRegistration: false },
    hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
    documentSymbol: {
      dynamicRegistration: false,
      hierarchicalDocumentSymbolSupport: true,
    },
  },
});
