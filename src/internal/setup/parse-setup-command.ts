import { hasControlCharacters } from '#x/text/has-control-characters.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/** Why a setup command was refused, in words for the reviewer. */
export interface SetupCommandProblem {
  readonly kind: 'empty' | 'too-long' | 'control-character' | 'comment' | 'unfinished';
  readonly message: string;
}

/** Longer than any install line; a script belongs in a file the command runs. */
const maxSetupCommandLength = 2000;

const trailingSeparators = /[\s;]+$/u;
const comment = /(?:^|\s)#/u;
const unfinished = /(?:&|\||\\)$/u;

/**
 * Validates a setup command the reviewer typed (ADR 0130): one line for their shell, which beuve
 * types into a terminal inside a group (`{ …; }`, fish's `begin; …; end`) followed by a success
 * marker. Trailing `;` and spaces are dropped. Refused: an empty line, a newline or other control
 * character, a `#` comment (it would swallow the end of the group), and a line that ends in `&`,
 * `|` or `\` (backgrounded or unfinished, so the marker would not follow the command).
 */
export function parseSetupCommand(text: string): Result<string, SetupCommandProblem> {
  const command = text.trim().replace(trailingSeparators, '');
  if (command === '') {
    return err({ kind: 'empty', message: 'Enter the command that sets up a checkout.' });
  }
  if (command.length > maxSetupCommandLength) {
    return err({
      kind: 'too-long',
      message: `Keep the command under ${String(maxSetupCommandLength)} characters; put a longer one in a script.`,
    });
  }
  if (hasControlCharacters(command)) {
    return err({
      kind: 'control-character',
      message: 'The command must be one line, without tabs or control characters.',
    });
  }
  if (comment.test(command)) {
    return err({ kind: 'comment', message: 'Leave out `#` comments.' });
  }
  if (unfinished.test(command)) {
    return err({
      kind: 'unfinished',
      message:
        'The command must run in the foreground and be complete: it cannot end in &, | or \\.',
    });
  }
  return ok(command);
}
