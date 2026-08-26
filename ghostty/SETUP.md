# Ghostty terminal setup

**Self-contained.** Everything needed is in this file — no other downloads, no
theme files, no dotfiles repo to clone. Hand this file to a coding agent and it
can do the whole thing.

Verified on **Ghostty 1.3.1**, macOS (Apple Silicon), 2026-08-16.

---

## Notes for an AI agent executing this

- Read the whole file before running anything. Steps are **idempotent** — safe to
  re-run.
- **Do not go looking for a "Blazer" theme file to download.** Blazer ships inside
  Ghostty. Installing a theme is not a step. If a step seems to be missing, it isn't.
- **Step 6 cannot be automated** and is not a failure. It needs a human to click a
  macOS permission dialog. Stop and ask; do not retry in a loop.
- Verification is Step 5. `ghostty +validate-config` exits non-zero on a bad config —
  use the exit code, not the absence of output.
- On Linux, read the *Non-macOS* section at the bottom **before** writing the config;
  four lines need changing or the config will warn.

---

## What this gives you

A dark terminal on Ghostty's built-in **Blazer** theme, with the ANSI palette
hand-brightened on top — Blazer's background is kept, but its pastel reds/greens/
blues are replaced with saturated ones so diff output, `ls` colors and syntax
highlighting read clearly. Plus:

| | |
|---|---|
| Font | JetBrains Mono Nerd Font, 14pt (Nerd Font = icons in starship/powerline prompts) |
| Window | 12px padding, native tab-style titlebar, block cursor |
| Quake terminal | `⌘` + `` ` `` drops a terminal down from the top of the screen, from anywhere |
| Splits | `⌘D` right, `⌘⇧D` down, `⌘⌥`+arrows to move, `⌘⇧↵` to zoom one split |
| Selecting text | copies to clipboard automatically |
| Shell integration | `⌘↑`/`⌘↓` jump between prompts, new splits inherit the current directory |
| Reload config | `⌘⇧R` |

---

## Step 1 — Install Ghostty

```bash
brew install --cask ghostty
```

Not on Homebrew, or not on macOS? See <https://ghostty.org/docs/install>.

## Step 2 — Install the font

```bash
brew install --cask font-jetbrains-mono-nerd-font
```

This is the one genuine external dependency. Skip it and the config still applies,
but any Nerd Font glyphs in your shell prompt render as `􀃊` boxes.

## Step 3 — Write the config

Target path (macOS and Linux both):

```bash
mkdir -p ~/.config/ghostty
```

Write the block below to `~/.config/ghostty/config`. If a config already exists,
back it up first — this replaces it wholesale:

```bash
[ -f ~/.config/ghostty/config ] && cp ~/.config/ghostty/config ~/.config/ghostty/config.bak
```

```ini
# ---- appearance ----
theme = Blazer

# ---- overrides on top of Blazer (keep its bg, brighten everything else) ----
cursor-color = #ffffff
# normal colors (brighter/more saturated than Blazer's pastels)
palette = 1=#ff6b6b
palette = 2=#5fd75f
palette = 3=#ffc857
palette = 4=#6b9fff
palette = 5=#d76bd7
palette = 6=#5fd7d7
palette = 7=#e6edf5
# bright colors
palette = 9=#ff8f8f
palette = 10=#87e587
palette = 11=#ffdb70
palette = 12=#8fb7ff
palette = 13=#e587e5
palette = 14=#87e5e5
palette = 15=#ffffff

font-family = JetBrainsMono Nerd Font
font-size = 14
window-padding-x = 12
window-padding-y = 12
macos-titlebar-style = tabs
cursor-style = block
mouse-hide-while-typing = true
copy-on-select = clipboard

# ---- shell integration (enables ⌘↑/⌘↓ prompt jump, cwd inheritance, sudo) ----
shell-integration = zsh
shell-integration-features = cursor,sudo,title

# ---- Quake / drop-down terminal (iTerm2 hotkey window) ----
keybind = global:cmd+grave_accent=toggle_quick_terminal
quick-terminal-position = top

# ---- splits (⌘D right, ⌘⇧D down; ⌘⌥arrows to move) ----
keybind = super+d=new_split:right
keybind = super+shift+d=new_split:down
keybind = super+alt+left=goto_split:left
keybind = super+alt+right=goto_split:right
keybind = super+alt+up=goto_split:up
keybind = super+alt+down=goto_split:down
keybind = super+shift+enter=toggle_split_zoom

# ---- misc ----
keybind = super+shift+r=reload_config
# ⌥ sends Meta for keybinds; set to `left` if you type é/£/etc.
macos-option-as-alt = true
```

**Change `shell-integration = zsh`** to `bash`, `fish`, or `elvish` if that's your
shell. Wrong value here silently disables `⌘↑`/`⌘↓` and directory inheritance —
everything else still works, which makes it easy to miss.

## Step 4 — Confirm the font resolved

```bash
ghostty +show-face --string="A"
```

Expect `found in face “JetBrainsMono Nerd Font”`. Any other face name means Step 2
didn't take and you're on a fallback font.

## Step 5 — Validate the config

```bash
ghostty +validate-config --config-file="$HOME/.config/ghostty/config"; echo "exit=$?"
```

`exit=0` means good. Anything else prints the offending line — fix it before moving on.
This is what catches a misspelled theme name: `theme = Blazr` exits 1 with
`theme "Blazr" not found, tried path …`. (Theme names are case-insensitive, so
`blazer` is fine.)

## Step 6 — Reload

Press `⌘⇧R` in a running Ghostty window, or just restart the app. Colors, font and
splits all work from here.

## Step 7 — Grant the global-hotkey permission (human required)

The `⌘` + `` ` `` drop-down terminal is the one thing that needs a human click,
because it's a *global* hotkey — it fires even when Ghostty isn't focused, and macOS
gates that behind Accessibility.

**System Settings → Privacy & Security → Accessibility → enable Ghostty.**

macOS usually prompts on first use. If it never prompts, add Ghostty manually with
the `+` button. Everything else in this setup works without it.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Boxes / `?` instead of prompt icons | Step 2 skipped. Fonts are per-user — check `ls ~/Library/Fonts \| grep -i jetbrains`. |
| `⌘` + `` ` `` does nothing | Step 7. Accessibility permission not granted. |
| Colors look washed out / pastel | The `palette` lines didn't make it into the file — you're seeing Blazer's own muted palette (its red is `#b87a7a`; this setup's is `#ff6b6b`). Check with `ghostty +show-config \| grep 'palette = 1='`. Order within the file does *not* matter — explicit keys beat the theme either way round. |
| `⌘↑` / `⌘↓` do nothing | `shell-integration` doesn't match your actual shell (Step 3). |
| `⌥` no longer types `é` `£` `#` | `macos-option-as-alt = true` is doing that deliberately. Set it to `left` to get the right ⌥ key back for typing. |

Useful for poking around: `ghostty +list-themes`, `ghostty +list-keybinds`,
`ghostty +show-config`, `ghostty +list-actions`.

---

## Non-macOS

The config is portable except for four lines. On **Linux**:

- Delete `macos-titlebar-style = tabs` and `macos-option-as-alt = true` — macOS-only keys.
- `super` in the keybinds means the Super/Windows key, not Cmd. If that clashes with
  your window manager, rewrite those seven `keybind` lines to `ctrl+shift+…`.
- Change `global:cmd+grave_accent` to `global:super+grave_accent`. Global hotkeys on
  Linux need a compositor that allows them — on Wayland this may not work at all, in
  which case drop the line and the `quick-terminal-position` under it.

Everything else — theme, palette, font, padding, splits, shell integration — works
unchanged. Ghostty does not support Windows natively; use it under WSLg or pick a
different terminal.
