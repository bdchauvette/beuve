import type { EditorId, EditorOpenFailure } from '#contract/ipc-contract.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { EditorDefinition } from './editor-definitions.ts';
import type { FoundEditor } from './find-editor.ts';

/** A known editor and where it was found, if anywhere. */
export interface DetectedEditor {
  readonly definition: EditorDefinition;
  readonly found: FoundEditor | undefined;
}

/** An installed editor and where it was found. */
export interface ChosenEditor {
  readonly definition: EditorDefinition;
  readonly found: FoundEditor;
}

/** The reviewer's stored choice and every known editor, as detected now. */
export interface EditorChoiceInput {
  readonly preferred: EditorId | undefined;
  readonly detected: readonly DetectedEditor[];
}

/** Why no editor can open: the failure code and a sentence for the reviewer. */
export interface EditorChoiceFailure {
  readonly failure: Extract<
    EditorOpenFailure,
    'no-editor-found' | 'editor-not-chosen' | 'editor-unavailable'
  >;
  readonly message: string;
}

const whereToChoose = 'Choose one in Settings › Editors.';

/**
 * Which editor opens a file (ADR 0141). The chosen editor, and only it: when it is missing or no
 * longer configured, the answer says so instead of starting another one. With no choice, the
 * one installed editor when there is exactly one; with several, the reviewer is asked to choose,
 * and with none, to install one or add their own to `settings.json`. Pure.
 */
export function chooseEditor({
  preferred,
  detected,
}: EditorChoiceInput): Result<ChosenEditor, EditorChoiceFailure> {
  if (preferred !== undefined) {
    const entry = detected.find(({ definition }) => definition.id === preferred);
    if (entry === undefined) {
      return err({
        failure: 'editor-unavailable',
        message: `Your editor “${preferred}” is not configured any more. ${whereToChoose}`,
      });
    }
    if (entry.found === undefined) {
      return err({
        failure: 'editor-unavailable',
        message: `${entry.definition.name}, your chosen editor, was not found. Install it, set its "command" in settings.json, or choose another in Settings › Editors.`,
      });
    }
    return ok({ definition: entry.definition, found: entry.found });
  }
  const installed: ChosenEditor[] = [];
  for (const { definition, found } of detected) {
    if (found !== undefined) {
      installed.push({ definition, found });
    }
  }
  const [only, ...others] = installed;
  if (only === undefined) {
    return err({
      failure: 'no-editor-found',
      message:
        'No editor found: install one, or add yours under "editors" in settings.json (Settings › Editors).',
    });
  }
  if (others.length > 0) {
    const names = installed.map(({ definition }) => definition.name).join(', ');
    return err({
      failure: 'editor-not-chosen',
      message: `Several editors were found (${names}). ${whereToChoose}`,
    });
  }
  return ok(only);
}
