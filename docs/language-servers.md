# Language servers

Beuve shows what the language servers say about a file as underlines in the diff, a count in the file's header and the message when you hover (ADR 0111). TypeScript and JavaScript work out of the box, and so does Go once `gopls` is installed. Anything else that speaks LSP is added in a configuration file you own.

## The configuration file

`language-servers.json` is read from two places, and neither has to exist: `$XDG_CONFIG_HOME/beuve/` (`~/.config/beuve/` when that is unset) on every platform, then beuve's own settings folder (on macOS `~/Library/Application Support/beuve/`). Where both have a setting, the second wins. Settings, Language servers, opens the file for you and creates an empty one in the first place if there is none. Beuve only reads these files. After saving, run Review, Restart Language Servers, which reads them again.

A file that is not valid, or has a key beuve does not know, is left out, and the reason shows beside the diagnostics of the next file you look at (the ⓘ in its header). Beuve's own servers keep working.

There is a complete example in [examples/language-servers.json](examples/language-servers.json): Python through Pyright and Ruff, a Go override and a per-repository switch.

## What a server's entry says

Every field is optional for a server beuve already has, because the entry only changes what it names. A server of your own needs a `command` and `extensions`.

- `enabled`: `false` turns a server off.
- `diagnostics`: `false` hides this server's diagnostics but keeps it answering hover, go to definition, call hierarchy and symbols. Use it for a linter that is too noisy to read but that you would rather keep than remove. A server with diagnostics off is not asked for them, so it is not even started for them.
- `command` and `args`: the program, found on the `PATH` your login shell gives, or an absolute path. It is run without a shell.
- `extensions`: file extension to LSP language id, such as `".go": "go"`. A file can be handled by several servers.
- `rootMarkers`: names of files or directories (`go.mod`, `pyproject.toml`) that mark a project. The server for a file runs in the nearest directory, from the file up to the checkout, that has one, so a repository with several projects gets one server each.
- `initializationOptions` and `settings`: handed to the server as it starts and when it asks for configuration.
- `env` and `inheritEnv`: variables to set, and names of variables of your own environment to pass on. Servers get a small allow-list (`PATH`, `HOME`, locale and temp directories) and nothing else, so a token in your shell never reaches one.
- `source`: `path` (the default) or `project`, a program from the checked-out repository, written as a path relative to it. See below.
- `diagnosticsQuietMs`: how long a server must be quiet before its answer counts as final. Raise it for a server that sends its checks in stages.

## Choosing servers for a language

`languages` says which servers serve a language, by LSP language id (`python`, `go`, `typescript`), as Zed's per-language `language_servers` does. Each entry has `servers`, a list in the order the servers are tried, and `enabled`.

```json
{
  "languages": { "python": { "servers": ["ruff", "!pyright", "..."] }, "go": { "enabled": false } }
}
```

- A name keeps that server for the language, and the listed servers come first, in the list's order.
- `!name` leaves a server out for the language only. It keeps serving its other languages.
- `...` stands for the servers the list does not name, and goes where it is written. A list without `...` keeps only the servers it names; a list of only `!name` entries keeps the rest.
- `enabled: false` turns the language off for every server. A server left with no language is not started.

This is for a language you want handled differently without removing a server (`enabled: false` on a server removes it for all its languages). A name that does not serve the language is reported beside the diagnostics, and the rest of the list still applies. Order is among the places the servers already hold, so one language's list does not reorder another's. A server's origin does not change, so `languages` never makes a built-in server count as your own.

## Merging and per-repository overrides

The `servers` of both files merge by server and by field; a later field replaces an earlier one. Two fields combine instead, because beuve's own definitions keep safety settings in them: `env` merges variable by variable and `inheritEnv` adds names, so setting one variable on `gopls` does not drop the others. A variable can still be given a new value.

`overrides` is a list of `{ "match", "servers", "languages" }` (each of the last two optional) applied in order over `servers` and `languages`; `languages` merges per language id and per field. A match is either `{ "path": ... }`, a glob against your own clone (a leading `~` is your home directory), or `{ "remote": ... }`, a glob against `host/owner/repo` of a pull request. In a glob `*` stays inside one directory and `**` crosses them.

## Trust

Beuve reviews code written by others, so nothing in the reviewed repository decides which programs run: this file is never read from a repository. A server from `path` is a program you installed. A server with `source: project` runs code that came with the branch, so it is allowed only because your own file asked for it, and the path must stay inside the checkout after links are followed. How trust is granted beyond that is not decided yet.

Your login shell is asked for its environment once at startup and again for each checkout, so tools such as direnv and mise take effect, under their own trust. If that cannot be read, servers get beuve's own environment and a note says so.

## Built-in servers

- **TypeScript and JavaScript** run from beuve's own copy of TypeScript. Beuve does not use the project's.
- **Go** uses `gopls` from your `PATH` and a server for each `go.mod`. Beuve sets `GOTOOLCHAIN=local`, so a `toolchain` line in the reviewed `go.mod` cannot make Go download one, and `GOPROXY=off`, so a missing dependency is an error and not a download: install dependencies in beuve's terminal, then restart the servers. It does not pass on your `GOFLAGS` (with `-mod=mod` Go edits `go.mod` in the checkout). Go's own analyzers arrive after the type check, so a Go file takes about three seconds to settle.
- **Python** and everything else are configured. The example runs Pyright for types and Ruff for lint, both on every `.py` file; each diagnostic names the server that reported it. Install them yourself (`npm install -g pyright`, `pip install ruff`).

## Limits

Diagnostics are shown at the session head only. A sheet at an older commit shows a small ⓘ and none. Servers are started only when a file they handle is shown, and stopped after five idle minutes.
