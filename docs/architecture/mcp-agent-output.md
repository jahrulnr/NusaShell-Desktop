# MCP agent-readable output (Files + Terminal)

## Goal

Make `nusashell.files` and `nusashell.terminal` tool results easy for models to
operate on across Linux and Windows, without breaking UI consumers that need
typed payloads (and raw PTY ANSI).

## Dual representation

Every successful tool call returns both:

| Field | Audience | Shape |
| --- | --- | --- |
| `content[0].text` | Agent / model projection | Stable, lean, plain-text receipt |
| `structuredContent` | Host UI / bridge | Typed JSON object (existing fields) |

Domain projection prefers the MCP text body when present; `structuredContent`
stays on the canonical `AgentToolResult` for cards, Terminal xterm, and Files UI.

## Terminal text receipt

```text
ok=true
exit_code=0
shell=bash
shell_path=/bin/bash
cwd=/home/user
timed_out=false
truncated=false

=== stdout ===
…
=== stderr ===
…
```

PTY `read` uses `=== output ===` and sets `ansi_stripped=true` in the text
header. Structured `stdout` keeps raw ANSI for the UI.

## Files text receipt

Lean headers + body sections. Examples:

- `list` / `tree`: `count=` plus `d`/`f` lines (dirs first)
- `read`: `path=` / `lines=` / `truncated=` then `=== content ===`
- `grep`: `path:line:text` lines with `count=` / `truncated=`
- Mutating tools: short `ok=true` key lines (`written=true`, `path=…`)

Structured objects keep the previous field names (`items`, `content`, `meta`, …).

## Windows shell selection

`exec` / `open` accept `shell` as a **kind** or an executable path:

| Kind | Windows executable | Exec argv |
| --- | --- | --- |
| `auto` | prefer `pwsh` → `powershell` → Git `bash` → `cmd` | per kind |
| `bash` | Git Bash `bash.exe` (PATH + common install dirs) | `-lc` |
| `zsh` | `zsh.exe` when present | `-lc` |
| `pwsh` / `powershell` | `pwsh.exe` / `powershell.exe` | `-NoLogo -NoProfile -NonInteractive -Command` |
| `cmd` | `%ComSpec%` / `cmd.exe` | `/d /s /c` |
| `wsl` | `wsl.exe` | `-e bash -lc` |

Unix `auto` keeps `$SHELL`, else `/bin/bash`. Tool `shells` lists discovered
kinds so agents can pick without guessing paths.

## Why not JSON-as-text only

Raw `JSON.stringify` forces models to unescape multiline `stdout` / file
`content`. Key=value projection of structured blobs also JSON-escapes those
fields. A dedicated text receipt keeps stream bodies verbatim while metadata
stays scannable as `key=value` lines.
