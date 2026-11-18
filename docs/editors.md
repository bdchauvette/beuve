# Editors

Open in Editor (⌥⌘O / Ctrl+Shift+O) and Review › Review Edits › Open in Editor open a file at a line in your editor (ADR 0033, 0088, 0139). Beuve knows Zed, Gram, VS Code and Cursor, and you can add any editor that opens a file from a command line.

## Choosing an editor

Choose in Settings › Editors (Review › Editor Settings… opens it). That is the only place: neither the menu nor the chat sets it. The choice is stored as `preferredEditor` in beuve's `settings.json`.

Beuve only opens the editor you chose. If it is not found, or `settings.json` no longer defines it, Open in Editor says so and opens nothing; it never starts another editor instead. Until you choose, beuve uses your editor if exactly one is installed, and asks you to choose if there are several.

Settings › Editors shows every editor, whether it was found and where (the command it runs, or on macOS the app it opens by URL when no command was found), and any problem with your configuration.

## Adding your own

Settings › Editors › Open settings.json opens the file (on macOS `~/Library/Application Support/beuve/settings.json`, on Linux `~/.config/beuve/settings.json`), creating it if there is none. Add an `editors` object, keyed by an id of lowercase letters, digits and dashes:

```json
{
  "editors": {
    "helix": {
      "name": "Helix",
      "command": "kitty",
      "args": ["--single-instance", "hx", "{file}:{line}:{column}"]
    }
  }
}
```

- `command`: the program, as an absolute path, a path starting with `~/`, or a name found on `PATH`. It is run directly, without a shell. macOS apps started from the Dock don't see your shell's `PATH`, so an absolute path is the safe choice there.
- `args`: the arguments, one array entry each. `{file}` (the absolute path), `{line}` and `{column}` (1-based) are filled in; one argument must hold `{file}`. Nothing is split or quoted, so a path with spaces stays one argument. Without `args`, beuve passes just the file.
- `name`: what menus and messages call it; the id when absent.
- `enabled`: `false` hides an editor, such as a built-in you don't use.

A terminal editor (Helix, Vim, Neovim) needs a terminal to run in, because beuve starts editors without one: make the terminal the `command` and the editor part of `args`, as above.

An entry with a built-in's id (`zed`, `gram`, `vscode`, `cursor`) changes only what it names. Giving it a `command` replaces every place beuve looks for that editor, including the macOS app, so you get that program or a clear "not found". Editors you add have no URL form; on macOS, point `command` at the command-line tool inside the app.

Beuve reads `editors` every time it opens a file, so changes apply at once; Settings reads them again when its window regains focus. An entry with a mistake (an unknown key, a wrong type, an unknown `{placeholder}`) is left out, and the reason shows in Settings › Editors and in the log; the rest keep working. Beuve never rewrites `editors`, and it leaves a `settings.json` that is not valid JSON untouched rather than replace it.

A fuller example is in [examples/editors-settings.json](examples/editors-settings.json).

## Built-in editors

| Editor  | Command looked for                                                                                              | Arguments                       | macOS app fallback                    |
| ------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| Zed     | `zed`, `zeditor` on `PATH`; `Zed.app/Contents/MacOS/cli`; `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` | `{file}:{line}:{column}`        | `Zed.app`, `zed://`                   |
| Gram    | `gram` on `PATH`; `Gram.app/Contents/MacOS/cli`; `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`          | `{file}:{line}:{column}`        | `Gram.app`, `gram://`                 |
| VS Code | `code` on `PATH`; `Visual Studio Code.app/Contents/Resources/app/bin/code`; the same directories                | `--goto {file}:{line}:{column}` | `Visual Studio Code.app`, `vscode://` |
| Cursor  | `cursor` on `PATH`; `Cursor.app/Contents/Resources/app/bin/cursor`; the same directories                        | `--goto {file}:{line}:{column}` | `Cursor.app`, `cursor://`             |

Apps are looked for in `/Applications` and `~/Applications`.
