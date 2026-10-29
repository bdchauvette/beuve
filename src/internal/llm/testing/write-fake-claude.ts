import { writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Writes a scripted stand-in for the `claude` CLI (plain JavaScript, run with `process.execPath`)
 * into `directory` and returns its path. It speaks the stream-json shapes of the real capture in
 * `claude-code-stream-fixture.ts`. Its first argument picks the behaviour, the second is an
 * optional file for its own and a child's pid; Claude Code's argv follows.
 * - `echo`: succeeds with `{ args, stdin, cwd, envKeys }` as structured output.
 * - `review`: the second argument names a JSON file `{ insights, delayMs? }`; after `delayMs` it
 *   succeeds with `{ insights }` as structured output, and appends `{ args, cwd }` as one line to
 *   `<file>.calls` so tests can count runs and check the working directory and flags.
 * - `chat`: the second argument names a JSON file `{ preamble?, chunks, delayMs? }`. It writes
 *   `preamble` (text before a Grep call), then the answer as `chunks`, each a text delta when the
 *   argv has `--include-partial-messages` (as the real CLI does), waiting `delayMs` before each
 *   chunk; it succeeds with the joined chunks as `result`, and appends `{ args, cwd, stdin }` as
 *   one line to `<file>.calls`.
 * - `text-result`: succeeds with the JSON only in `result`, no `structured_output`.
 * - `garbage`: prints lines that aren't JSON and exits 0.
 * - `mismatch`: succeeds with structured output that matches no schema.
 * - `fail`: writes to stderr and exits 2.
 * - `not-logged-in`: an error result asking to `/login`, exit 1.
 * - `rate-limited`: a rejected rate-limit event and a 429 error result, exit 1.
 * - `budget`: an `error_max_budget_usd` result, exit 1.
 * - `hang`: starts a child that also hangs, records both pids, and never exits.
 * - `stubborn`: like `hang`, but ignores SIGTERM.
 * - `flood`: writes megabytes of `stream_event` lines.
 */
export function writeFakeClaude(directory: string): string {
  const file = path.join(directory, 'fake-claude.mjs');
  writeFileSync(file, source);
  return file;
}

const source = String.raw`
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const [mode, pidFile, ...args] = process.argv.slice(2);
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\n');
const init = () => emit({ type: 'system', subtype: 'init', cwd: process.cwd(), model: 'fake-model-1',
  claude_code_version: '0.0.0-fake', tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'] });
const result = (fields) => emit({ type: 'result', subtype: 'success', is_error: false,
  api_error_status: null, duration_ms: 5, num_turns: 2, total_cost_usd: 0.01,
  permission_denials: [], ...fields });

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  switch (mode) {
    case 'echo': {
      init();
      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } });
      emit({ type: 'stream_event', event: { type: 'message_stop' } });
      // macOS adds __CF_USER_TEXT_ENCODING to every spawned process; it isn't ours to assert on.
      const envKeys = Object.keys(process.env).filter((key) => key !== '__CF_USER_TEXT_ENCODING').sort();
      const value = { args, stdin, cwd: process.cwd(), envKeys };
      result({ result: JSON.stringify(value), structured_output: value,
        permission_denials: [{ tool_name: 'Bash' }] });
      break;
    }
    case 'review': {
      const script = JSON.parse(readFileSync(pidFile, 'utf8'));
      appendFileSync(pidFile + '.calls', JSON.stringify({ args, cwd: process.cwd() }) + '\n');
      init();
      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: {} }] } });
      setTimeout(() => {
        emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } });
        const value = { insights: script.insights };
        result({ result: JSON.stringify(value), structured_output: value });
      }, script.delayMs ?? 0);
      break;
    }
    case 'chat': {
      const script = JSON.parse(readFileSync(pidFile, 'utf8'));
      appendFileSync(pidFile + '.calls', JSON.stringify({ args, cwd: process.cwd(), stdin }) + '\n');
      const isStreaming = args.includes('--include-partial-messages');
      const start = () => isStreaming && emit({ type: 'stream_event', parent_tool_use_id: null,
        event: { type: 'message_start', message: { content: [] } } });
      const delta = (text) => isStreaming && emit({ type: 'stream_event', parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
      init();
      if (script.preamble !== undefined) {
        start();
        delta(script.preamble);
        emit({ type: 'assistant', message: { content: [{ type: 'text', text: script.preamble },
          { type: 'tool_use', name: 'Grep', input: {} }] } });
      }
      start();
      const chunks = [...script.chunks];
      const next = () => {
        const chunk = chunks.shift();
        if (chunk !== undefined) {
          delta(chunk);
          setTimeout(next, script.delayMs ?? 0);
          return;
        }
        const text = script.chunks.join('');
        emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
        result({ result: text });
      };
      setTimeout(next, script.delayMs ?? 0);
      break;
    }
    case 'text-result': {
      init();
      result({ result: JSON.stringify({ args: [], stdin, cwd: process.cwd(), envKeys: [] }) });
      break;
    }
    case 'garbage': {
      process.stdout.write('this is not json\n{"half":\n');
      break;
    }
    case 'mismatch': {
      init();
      result({ result: '{"wrong":1}', structured_output: { wrong: 1 } });
      break;
    }
    case 'fail': {
      process.stderr.write('fake claude crashed\n');
      process.exitCode = 2;
      break;
    }
    case 'not-logged-in': {
      init();
      result({ subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
      process.exitCode = 1;
      break;
    }
    case 'rate-limited': {
      init();
      emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1793224800 } });
      result({ subtype: 'success', is_error: true, api_error_status: 429,
        result: 'API Error: Request rejected (429)' });
      process.exitCode = 1;
      break;
    }
    case 'budget': {
      init();
      result({ subtype: 'error_max_budget_usd', is_error: true });
      process.exitCode = 1;
      break;
    }
    case 'hang':
    case 'stubborn': {
      if (mode === 'stubborn') {
        process.on('SIGTERM', () => {});
      }
      init();
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      writeFileSync(pidFile, JSON.stringify({ self: process.pid, child: child.pid }));
      setInterval(() => {}, 1000);
      break;
    }
    case 'flood': {
      init();
      const line = JSON.stringify({ type: 'stream_event', event: { pad: 'x'.repeat(1000) } }) + '\n';
      for (let i = 0; i < 4000; i += 1) {
        process.stdout.write(line);
      }
      result({ structured_output: {} });
      break;
    }
    default: {
      process.stderr.write('unknown mode ' + mode + '\n');
      process.exitCode = 64;
    }
  }
});
`;
