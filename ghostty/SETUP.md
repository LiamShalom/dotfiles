# Ghostty terminal setup

**Self-contained.** Everything needed is in this file — no other downloads, no
dotfiles repo to clone. The two theme files are written out in full in Step 3.
Hand this file to a coding agent and it can do the whole thing.

Verified on **Ghostty 1.3.1**, macOS (Apple Silicon), 2026-10-06.

---

## Notes for an AI agent executing this

- Read the whole file before running anything. Steps are **idempotent** — safe to
  re-run.
- **Do not download a theme.** `blazer-bright` and `blazer-bright-light` are custom
  files, not Ghostty built-ins and not on any theme site. Step 3 writes both. Skip
  them and the config fails validation with `theme "blazer-bright-light" not found`.
- **Step 7 cannot be automated** and is not a failure. It needs a human to click a
  macOS permission dialog. Stop and ask; do not retry in a loop.
- Verification is Step 5. `ghostty +validate-config` exits non-zero on a bad config —
  use the exit code, not the absence of output.
- On Linux, read the *Non-macOS* section at the bottom **before** writing the config;
  four lines need changing or the config will warn.

---

## What this gives you

A terminal that follows the macOS light/dark appearance with a matched pair of
themes. The dark half, **blazer-bright**, is Ghostty's Blazer navy with the ANSI
palette hand-brightened — its pastel reds/greens/blues replaced with saturated ones
so diff output, `ls` colors and syntax highlighting read clearly. The light half,
**blazer-bright-light**, uses the same hues darkened to clear WCAG AA on an
off-white background. Plus:

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

## Step 3 — Write the theme files and the config

Target paths (macOS and Linux both):

```bash
mkdir -p ~/.config/ghostty/themes
```

> **Using the dotfiles repo?** `~/dotfiles/install.sh` symlinks `ghostty/config`
> and the `ghostty/themes/` folder into these paths. Run it and go to Step 4.

### 3a — Theme files

Ghostty looks up a theme name in `~/.config/ghostty/themes/` before its built-in
set. The filenames must match exactly, with no extension.

Write this to `~/.config/ghostty/themes/blazer-bright`:

```ini
# Blazer, with the palette brightened/saturated for the dark navy background.
# Dark half of the light/dark pair in ../config.
palette = 0=#000000
palette = 1=#ff6b6b
palette = 2=#5fd75f
palette = 3=#ffc857
palette = 4=#6b9fff
palette = 5=#d76bd7
palette = 6=#5fd7d7
palette = 7=#e6edf5
palette = 8=#4c4c4c
palette = 9=#ff8f8f
palette = 10=#87e587
palette = 11=#ffdb70
palette = 12=#8fb7ff
palette = 13=#e587e5
palette = 14=#87e5e5
palette = 15=#ffffff
background = #0d1926
foreground = #d9e6f2
cursor-color = #ffffff
cursor-text = #0d1926
selection-background = #c1ddff
selection-foreground = #000000
```

Write this to `~/.config/ghostty/themes/blazer-bright-light`:

```ini
# Light counterpart to blazer-bright: same hues, darkened for contrast on a
# cool off-white. Every slot clears WCAG AA (4.5:1) against the background.
# Slots 7/15 are dark greys, not light ones: they invert the DARK theme's
# "brightest = most emphasis" intent rather than the literal colour name.
palette = 0=#1a2733
palette = 1=#e01919
palette = 2=#2e822e
palette = 3=#956a11
palette = 4=#276be7
palette = 5=#b242b2
palette = 6=#2c7d7d
palette = 7=#45525f
palette = 8=#5c6b7a
palette = 9=#bd0a0a
palette = 10=#1d6c1d
palette = 11=#765906
palette = 12=#0b53d5
palette = 13=#9c299c
palette = 14=#1c6868
palette = 15=#0d1926
background = #f7f9fc
foreground = #1a2733
cursor-color = #0d1926
cursor-text = #f7f9fc
selection-background = #cfe0f5
selection-foreground = #0d1926
```

### 3b — Config

Write the block below to `~/.config/ghostty/config`. If a config already exists,
back it up first — this replaces it wholesale:

```bash
[ -f ~/.config/ghostty/config ] && cp ~/.config/ghostty/config ~/.config/ghostty/config.bak
```

```ini
# ---- appearance ----
# Follows the macOS system appearance automatically (System Settings >
# Appearance). Both halves live in ./themes/ ; the palette tuning that used to
# sit here is baked into blazer-bright so it can't leak onto the light theme.
theme = light:blazer-bright-light,dark:blazer-bright

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
This is what catches a missing or misnamed theme file: skip Step 3a and it exits 1
with `theme "blazer-bright-light" not found, tried path …`.

## Step 6 — Reload

Press `⌘⇧R` in a running Ghostty window, or just restart the app. Colors, font and
splits all work from here.

From a script or an agent, reload the running app over AppleScript (Ghostty 1.3+):

```bash
osascript -e 'tell application "Ghostty" to perform action "reload_config" on focused terminal of selected tab of front window'
```

It prints `true` on success. Do **not** send a Unix signal to reload: a signal
Ghostty does not handle kills the app and every shell in it.

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
| Ghostty's default colors, not the navy/off-white theme | The theme files are missing from `~/.config/ghostty/themes/`, so Ghostty dropped the `theme` line. Step 5 shows it as `theme "…" not found`. Write the files (Step 3a), then reload (Step 6) — a running app does not see new theme files until it reloads. |
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
