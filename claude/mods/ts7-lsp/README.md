# ts7-lsp

Personal Claude Code plugin, from Don's harness (2026-11-10). It loads from `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`. It connects Claude Code to the
TypeScript 7 native language server (`tsc --lsp --stdio`) in the project's `node_modules`.

- **Type errors after edits.** Claude Code only listens for pushed diagnostics, and TS 7 only
  answers pull requests. `scripts/ts7_lsp_proxy.py` pulls after each change and pushes the
  result. Claude Code attaches them to the agent's next tool result. Hints (severity 4) are
  dropped.
- **Navigation.** The `LSP` tool's definitions, references, callers and symbols go straight to
  the server.
- **One server per worktree.** Subagents share their session's connection but edit in their own
  git worktrees, and a server keeps a full program (about 3.5 GB) for each worktree it has open
  files in. So the proxy runs one server per git root (the nearest directory with `.git`; files
  outside a repo go to the session's root). Subagents keep their type errors after edits.
- **Memory limits.**
  - The root the session used last stops after `TS7_LSP_IDLE_SECONDS` (600) idle and reopens
    its files on the next message.
  - Any other root stops `TS7_LSP_INACTIVE_ROOT_SECONDS` (180) after the session moves away
    from it, and forgets its files. A file the client mentions again is reopened from the
    client's text or from disk.
  - A server over `TS7_LSP_MAX_MEMORY_MB` (6144, Activity Monitor's figure) restarts when it
    is not busy.
  - When more than `TS7_LSP_MAX_WARM` (3) servers run on the machine, the least recently
    used stops (after 60 s idle).
  - Set these in `.lsp.json` under `env`. The first type check on a restarted server reloads
    the repo, which takes up to about 30 s.

Replaces `typescript-lsp@claude-plugins-official`, which needs `typescript-language-server`
and the `tsserver` that TS 7 no longer ships. Without a TS 7 binary in `node_modules`, the
proxy runs `typescript-language-server` from `PATH` if present, else it exits with an error.

| Task | Command |
|---|---|
| Turn off | remove `:~/.claude/mods/ts7-lsp` from `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` |
| Logs | `~/.cache/ts7-lsp/logs/` (one file per session, kept 7 days) |
| Warm servers now | `ls ~/.cache/ts7-lsp/pool/` |
| Test | `~/.claude/bin/heavy /opt/homebrew/bin/python3.12 -I tests/test_proxy.py` |

Changes take effect in new sessions.
