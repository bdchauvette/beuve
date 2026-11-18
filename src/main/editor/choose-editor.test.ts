import { describe } from 'vitest';

import { chooseEditor } from './choose-editor.ts';
import type { DetectedEditor } from './choose-editor.ts';
import { getEditorDefinition } from './testing/get-editor-definition.ts';
import { test } from '../testing/test.ts';

/** Zed, Gram and VS Code, with the ones named installed. */
function detected(...installed: readonly string[]): DetectedEditor[] {
  return (['zed', 'gram', 'vscode'] as const).map((id): DetectedEditor => {
    const definition = getEditorDefinition(id);
    if (installed.includes(id)) {
      return { definition, found: { kind: 'cli', command: `/bin/${id}` } };
    }
    return { definition, found: undefined };
  });
}

describe('chooseEditor', () => {
  test('opens the chosen editor when it is installed', ({ expect }) => {
    expect(chooseEditor({ preferred: 'gram', detected: detected('zed', 'gram') })).toMatchObject({
      ok: true,
      value: { definition: { id: 'gram' }, found: { command: '/bin/gram' } },
    });
  });

  test('never falls through to another editor when the chosen one is missing', ({ expect }) => {
    expect(chooseEditor({ preferred: 'gram', detected: detected('zed', 'vscode') })).toStrictEqual({
      ok: false,
      error: {
        failure: 'editor-unavailable',
        message:
          'Gram, your chosen editor, was not found. Install it, set its "command" in settings.json, or choose another in Settings › Editors.',
      },
    });
  });

  test('names a choice that is no longer configured', ({ expect }) => {
    expect(chooseEditor({ preferred: 'helix', detected: detected('zed') })).toMatchObject({
      ok: false,
      error: {
        failure: 'editor-unavailable',
        message: expect.stringContaining('“helix”') as string,
      },
    });
  });

  test('without a choice, uses the only installed editor', ({ expect }) => {
    expect(chooseEditor({ preferred: undefined, detected: detected('vscode') })).toMatchObject({
      ok: true,
      value: { definition: { id: 'vscode' } },
    });
  });

  test('without a choice, asks for one when several are installed', ({ expect }) => {
    expect(
      chooseEditor({ preferred: undefined, detected: detected('zed', 'vscode') }),
    ).toStrictEqual({
      ok: false,
      error: {
        failure: 'editor-not-chosen',
        message:
          'Several editors were found (Zed, VS Code). Choose one in Review › Open With or in Settings › Editors.',
      },
    });
  });

  test('without a choice or an installed editor, says how to get one', ({ expect }) => {
    expect(chooseEditor({ preferred: undefined, detected: detected() })).toMatchObject({
      ok: false,
      error: {
        failure: 'no-editor-found',
        message: expect.stringContaining('settings.json') as string,
      },
    });
  });
});
