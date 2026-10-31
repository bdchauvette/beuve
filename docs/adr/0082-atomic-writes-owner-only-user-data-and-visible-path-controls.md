# 0082. Atomic writes, owner-only userData, one open per path, and paths that show their hidden characters

- Status: Accepted
- Date: 2026-10-31

## Context

The TOCTOU audit (task #27) left five follow-ups after the per-head and worktree work (ADR 0078, 0079):

- `lsp:call-hierarchy` carried no head and cached its badge spans by session alone, so an answer for one head could be badged with another head's changes.
- Four writers replaced a file by renaming a temporary file over it, each a little differently: settings and model secrets used a fixed `<file>.tmp`, the MCP discovery file a pid-unique name, and the MCP token wrote in place and then ran `chmod`. None flushed to disk, so a crash could leave an empty `settings.json` that reads as `{}`.
- Nobody had checked what modes `userData` and its files get.
- A repository can name a file `invoice<U+202E>gpj.ts`, which every view showed as `invoicest.jpg`. Zero-width and other invisible characters can make two different paths look the same.
- Two readers checked a path with `stat` and then opened it again by path.

## Decision

### Per-head call hierarchy

`lsp:call-hierarchy` joins `perHeadInvokeChannels`: its request has a required `expectedHeadSha`, main refuses with `stale-review` when the session's stored head is no longer that one, diffs at that SHA (`loadReviewDiff` with `headSha`), and keys the span cache by session and head (an LRU of 32). The view names the `headSha` it describes. The review-order service passes the head of the diff it is ordering. This amends ADR 0078's note that pinning it was separate work.

### One atomic-write helper

`writeFileAtomic(file, data, { mode, signal })` (`#x/fs/write-file-atomic.ts`) is the only way to replace a file in place:

1. it writes to `.<name>.<uuid>.tmp` in the same directory, created with `'wx'` and the given mode, so the mode is set at creation and a stale or planted temporary file is never reused;
2. it `fsync`s the file, renames it over the target, and `fsync`s the directory (skipped on Windows, and where the file system refuses to open or flush a directory);
3. on any failure, an abort included, it removes the temporary file and leaves the target untouched.

`data` may be a string, bytes or an (async) iterable of chunks. Concurrent writers never mix: each has its own temporary file and the last rename wins whole. Settings (now 0600), model secrets, the MCP token and the MCP discovery file use it. The token now gets 0600 when it is created instead of through `chmod` afterwards. It lives in `src/x` because an atomic replace belongs in a standard library (Go's `renameio`, Python's `atomicwrites`). `no-restricted-imports` bans importing `rename` or `renameSync` from `node:fs` anywhere else in shipped code.

### Owner-only `userData`

What Electron 45 does was checked on the real binary, launched under Xvfb with an empty `HOME` and umask 022:

- Chromium creates `userData` 0700 before `ready`, and its own files and directories in it (`Local Storage`, `Cache`, `DIPS`, `Trust Tokens`, …) are 0700 or 0600. On macOS it uses the same `base::CreateDirectory`, which uses mode 0700.
- beuve's own files did not follow that. `beuve.db`, `beuve.db-wal` and `beuve.db-shm` were 0644 (`node:sqlite` creates with 0644 and has no mode option), `settings.json` was 0644, and `worktrees/` was 0755.
- These were unreadable to other users only because `userData` itself was 0700. An older install, a restored backup or a `userData` the user created by hand loses that protection.

So:

- New files are owner-only from creation. `openDatabase` creates a missing database file 0600 before SQLite opens it, and SQLite gives its `-wal` and `-shm` files the database's mode, which was checked on Node 26. The atomic writer creates files 0600, and `secureUserData` creates `worktrees/` and `trace/` 0700. The trace runner's scratch parent is also created 0700.
- Existing installs are fixed once per launch, before the database opens. On macOS and Linux, `secureUserData(userData)` clears the group and other bits of `userData` and of each known path: `beuve.db` and its WAL files, `settings.json`, `model-secrets.json`, `mcp-token`, `mcp-server.json`, `worktrees/` and `trace/`. It opens each path with `O_NOFOLLOW` and changes the mode through that handle, so it never follows a symlink. It only clears bits, so a read-only file stays read-only. A missing path is skipped. A failure is logged and does not stop the launch.
- Checkouts inside `worktrees/` keep the modes git gives them. The 0700 parent is what protects them.

### Paths show their hidden characters

`revealFormatControls(text)` (`#x/text/reveal-format-controls.ts`) replaces every character that could hide or reorder text with a visible escape `⟨U+XXXX⟩` (at least four uppercase hex digits). The characters covered are:

- `Cc` (tabs, newlines, escape);
- `Cf` (the bidi embeddings, overrides and isolates U+202A–U+202E and U+2066–U+2069, the marks U+200E, U+200F and U+061C, zero-width spaces and joiners, U+FEFF, tag characters);
- lone surrogates;
- `Zl` and `Zp`;
- every `Default_Ignorable_Code_Point` (variation selectors, Hangul fillers, the combining grapheme joiner);
- every space but U+0020.

`⟨` (U+27E8) is escaped too, so the escape is injective, and `restoreFormatControls` turns a revealed text back into the original exactly.

- **The renderer** shows paths through `pathText(path)` (`src/ui/path-text.ts`). It renders each escape in a `.format-control` span (`formatControlStyles`): small, boxed and in the warning colour. The real path stays in the element's `title`. This covers:
  - card headers (old and new path);
  - the inline and window sheet title (the window's `document.title` gets the plain revealed text);
  - peek rows and their symbol names;
  - URA dock anchors and the composer's "where";
  - chat mention chips, in the transcript and in the input box, and citation pills;
  - palette file results, where each character is escaped on its own so the match highlights still line up;
  - the trace portal's test files.

  Status and chat notes that name a path use the plain revealed text.

- **The file tree.** `@pierre/trees` renders each name itself and has no display-name hook; `@pierre/diffs` renders no names, because both views turn its file header off. The radar tree is therefore given revealed paths (in the paths, the expanded paths and the git status) and maps everything it hands back (selection, the focused path, decoration lookups) through `restoreFormatControls`. The tree's escapes are plain text, without the boxed style.
- **Exported text.** The GitHub review body (`On \`path\``, the outdated-item anchors, comments moved to the body) shows paths revealed, because people read it on GitHub. An inline comment's `path` field stays raw, since GitHub anchors the comment by it. The agent JSON and XML exports and suggested-patch headers stay raw too: programs read them and must find the exact file.
- **The check.** `scripts/check-hostile-render.ts` adds names with a right-to-left override, a newline and tab, and zero-width and isolate characters. It checks that every card header, the tree's rows and a sheet's title show the escapes and contain no bidi control.

### One open per path

`local/no-check-then-open` reports a `node:fs` path check (`stat`, `lstat`, `access`, `existsSync`, `realpath` and their sync forms) followed, in the same function, by a call that opens or changes the same variable's path by name (`open`, `readFile`, `writeFile`, `createReadStream`, `rm`, `unlink`, `chmod`, …). It applies to shipped code and scripts, not to tests or their helpers. The fix is to open once and ask the handle (`handle.stat()`, `handle.readFile()`). On the codebase the rule found two places, and both were real:

- the read-only sandbox's `readCapped`;
- the LSP multiplexer's `readDocument`.

Both now open once, with `O_NONBLOCK` so that a FIFO can't block the open, and check the handle. Spawning a checked executable is not an open. It stays an accepted risk (audit #11).

## Consequences

- A crash can no longer leave a truncated settings or secrets file, and no file in `userData` is ever readable by other users, even for a moment.
- Every `userData` file beuve adds must be created owner-only, and through `writeFileAtomic` when it is replaced in place. Add a file that existing installs may hold with a looser mode to `secureUserData`'s list.
- A repository path can't disguise itself in any view beuve draws. A name with legitimate format characters, such as an emoji ZWJ sequence or a non-breaking space, shows escapes; that is the price.
- Known gaps:
  - The tree's escapes are unstyled.
  - Tooltips hold the raw path, which the browser lays out with its controls active.
  - Bidi controls inside file contents are still drawn as the code has them. Code is not a path, and the diff library renders it.
  - The rule only sees a check and an open within one function. `resolveWorkspaceFile` (realpath, then a containment check) followed by `readFile` in `create-lsp-multiplexer.ts`'s `readInsideRoot` still crosses two functions. It reads a checkout beuve made, which repository content can't change while beuve runs.
