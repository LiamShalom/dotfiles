---
name: visual-companion
description: "Show the operator mockups, wireframes, diagrams, flowcharts and side-by-side visual options, and read back what they chose. For UI design rounds you choose the surface: a Session Board canvas (board-canvas.mjs), where the operator draws and writes and you read it back, or the preview route or a local page when the choice needs clicking; other visuals go in a live browser tab. Use in any session, at any stage (brainstorm, design, execute, quick-fix, debugging, plain questions), whenever seeing something would be clearer than reading it: a UI layout choice, a before/after, an architecture or data-flow diagram, a state machine. Open it without asking first."
---

# Visual Companion

## UI design: choose the surface

For each round of product UI (layout directions, screens, flows, wireframes, before/after,
design feedback), choose where to show it and say your choice in one line:

- **Canvas** when the operator will mark up static screens (compare options, sketch, point with
  arrows) or the rounds should stay together as history. It is an infinite tldraw canvas in
  this session's pane, one per feature, each round under the last. The operator draws, writes
  sticky notes and points with arrows on it, and you read all of that back (steps below).
- **Preview route or a local HTML page in the pane** (`board-browser.mjs`) when the decision
  depends on clicking, states or motion, which the canvas cannot show.

Canvas steps:

1. Screenshot the real UI: the preview route (`design` skill) at 1280 and 390 wide, and the
   reference screen. Never draw product UI by hand.
2. Write the round to `$CLAUDE_JOB_DIR/tmp/<feature>-round-<n>.json`. Image paths are relative
   to that file. Give each option a letter, and put your pick and why in `note`:

   ```json
   { "title": "Round 1 · Pricing page",
     "note": "My pick: B. The plan cards read first; the table stays one click away.",
     "options": [
       { "label": "A · Table first", "images": ["a-1280.png", "a-390.png"], "link": "<preview url>?d=a" },
       { "label": "B · Cards first", "images": ["b-1280.png", "b-390.png"], "text": "Cards, then the table", "link": "<preview url>?d=b" } ] }
   ```
3. `node ~/session-board/scripts/board-canvas.mjs add "<feature>" <round.json> "<what to look at
   and decide>"`. The canvas opens in front of this session's pane. When the operator is looking
   at another chat, the output says so: tell them where it is.
4. Ask for the answer in the terminal ("A, B or C?"). Before the next round, and whenever they
   say they marked something, run `board-canvas.mjs read "<feature>"`. It prints every shape as
   JSON (`"by": "you"` is the operator's: a note's text, the frame it is on, what an arrow points
   from and to) and saves a PNG of the canvas. Look at the PNG for sketches that have no text;
   `--frame "<label>"` gives one option up close.
5. The next round is another `add` to the same canvas. `board-canvas.mjs list` shows every
   canvas, including ones the operator drew on their own; read those the same way when they ask
   you to build what they sketched.

When board-canvas.mjs says Session Board is not running, publish the round as a claude.ai
Artifact (the `Artifact` tool: each option's screenshots, your pick and why, the preview links),
give the operator its link, and say why in one line.

## Artifact pages first

For everything visual that is not a UI design round (diagrams, flowcharts, review and approval
pages, a clickable prototype the operator asked to click through):

Write each screen as a local HTML page and open it in Session Board's pane by default; use the
local server below only as the fallback. In the pane the page gets the claude.ai Artifact
runtime (`window.claude.use`: `db`, `comments`, `sample`, `artifact`, `user`, `downloads`; the same
API, see "Pages that work like Claude artifacts" in `~/session-board/README.md`), a Comment
button whose comments arrive in this session as prompts, and a reload whenever the file changes.

1. Load the `artifact-design` skill (and `artifact-diagramming` for a diagram) before you
   write the page. Write a complete page (doctype, head, body) to
   `$CLAUDE_JOB_DIR/tmp/<topic>.html` (or the session scratchpad).
2. Give each option a letter and a heading, and put your pick and its reason at the top.
   For product UI, use a clickable copy captured with `~/.claude/bin/page-snapshot.mjs`
   (the preview route, the reference screen), with working buttons and states in JS, not
   a hand-drawn lookalike.
3. Open it in the pane in the same turn:
   `node ~/session-board/scripts/board-browser.mjs <file.html> "<what to look at and decide>"`.
4. To read the operator's choice back, have the page save it with `db`
   (`(await claude.use('db'))?.doc('choice/current').set({ option: 'B' })`), and read it with
   `node ~/session-board/scripts/artifact.mjs db <file.html> get choice/current`. Their
   comments come to you as prompts (`Comment on <file> at "<element>" …`); all of them:
   `artifact.mjs comments <file.html>`. For the next round, edit the same file: the pane
   reloads it. Never open a new file for each iteration.
5. Before each next round, write down the operator's last message word for word and what it
   settles. Every option in the new round keeps what he settled (if he said the tabs become
   navbar items, no option nests them). A short or vague word ("sort", "better", "inspo")
   applies to the question he raised last; if it still fits two readings, ask in one line
   before you build. Research you add answers his question, not your pick.

Publish a claude.ai Artifact (the `Artifact` tool) only when someone other than the operator
must open the page. Use the local server when Session Board is not running (board-browser.mjs
says so). Say in one line why you used the fallback.

## Local server (fallback)

Browser-based companion for showing mockups, diagrams, and options. It works in any session.
**Do not ask permission to open it.** When a question is visual, start the server (or reuse a
running one) and show the screen in the same turn. Scripts live in
`~/.claude/skills/visual-companion/scripts/`; `scripts/…` below means that folder. Always pass
`--project-dir <repo root>` (files land in `.superpowers/brainstorm/`; `/tmp` gets wiped).

## When to Use

Decide per-question, not per-session. The test: **would the user understand this better by seeing it than reading it?**

**Show it** when the content itself is visual. UI design goes on the surface you chose (above); the rest
goes on a page:

- **UI mockups** (canvas) — wireframes, layouts, navigation structures, component designs
- **Architecture diagrams** — system components, data flow, relationship maps
- **Side-by-side visual comparisons** (canvas, for UI) — comparing two layouts, two color schemes, two design directions
- **Design polish** (canvas) — when the question is about look and feel, spacing, visual hierarchy
- **Spatial relationships** — state machines, flowcharts, entity relationships rendered as diagrams

**Use the terminal** when the content is text or tabular:

- **Requirements and scope questions** — "what does X mean?", "which features are in scope?"
- **Conceptual A/B/C choices** — picking between approaches described in words
- **Tradeoff lists** — pros/cons, comparison tables
- **Technical decisions** — API design, data modeling, architectural approach selection
- **Clarifying questions** — anything where the answer is words, not a visual preference

A question *about* a UI topic is not automatically a visual question. "What kind of wizard do you want?" is conceptual — use the terminal. "Which of these wizard layouts feels right?" is visual — show it (canvas or preview).

## How It Works

The server watches a directory for HTML files and serves the newest one to the browser. You write HTML content to `screen_dir`, the user sees it in their browser and can click to select options. Selections are recorded to `state_dir/events` that you read on your next turn.

**Content fragments vs full documents:** If your HTML file starts with `<!DOCTYPE` or `<html`, the server serves it as-is (just injects the helper script). Otherwise, the server automatically wraps your content in the frame template — adding the header, CSS theme, connection status, and all interactive infrastructure. **Write content fragments by default.** Only write full documents when you need complete control over the page.

## Starting a Session

For SideShift product UI, route through the `design` skill before writing a screen. Read
`~/dotfiles/claude/references/ui-taste.md` and `unslop.md`, identify the shared components,
and render those React components on a development preview route. Show them on the surface you
chose (above); use this local server only for diagrams when Session Board is not running, and
never substitute hand-built HTML lookalikes for product UI. The comparison should embed or link to the real preview. A chosen direction
stays chosen when the operator rejects its visual finish.

```bash
# --open auto-opens their browser on
# the first screen; --project-dir persists mockups and enables same-port restart.
bash scripts/start-server.sh --project-dir /path/to/project --open

# Returns: {"type":"server-started","port":52341,
#           "url":"http://localhost:52341/?key=ab12…",
#           "screen_dir":"/path/to/project/.superpowers/brainstorm/12345-1706000000/content",
#           "state_dir":"/path/to/project/.superpowers/brainstorm/12345-1706000000/state"}
```

Save `screen_dir` and `state_dir` from the response. With `--open`, the browser opens itself when you push the first screen — you don't need to ask the user to open it, but still share the URL as a fallback (headless/remote setups won't auto-open).

**The URL contains a session key (`?key=…`).** The server rejects any request
without it, so always give the user the **complete** URL from the `url` field —
never strip the query string, and never hand out a bare `http://host:port`. The
key gates HTTP and WebSocket access so a stray browser tab or another machine on
the network can't read the screens or inject events. After the first load the
browser remembers the key via a cookie, so reloads and `/files/*` assets work
without repeating it.

**Finding connection info:** The server writes its startup JSON to `$STATE_DIR/server-info`. If you launched the server in the background and didn't capture stdout, read that file to get the URL and port. When using `--project-dir`, check `<project>/.superpowers/brainstorm/` for the session directory.

**Note:** Pass the project root as `--project-dir` so mockups persist in `.superpowers/brainstorm/` and survive server restarts. Without it, files go to `/tmp` and get cleaned up. Remind the user to add `.superpowers/` to `.gitignore` if it's not already there.

**Launching the server by platform:**

**Claude Code:**
```bash
# Default mode works — the script backgrounds the server itself.
bash scripts/start-server.sh --project-dir /path/to/project --open
```

On Windows, the script auto-detects and switches to foreground mode (which blocks the tool call). Use `run_in_background: true` on the Bash tool call so the server survives across conversation turns, then read `$STATE_DIR/server-info` on the next turn to get the URL and port.

**Codex:**
```bash
# Codex reaps background processes. The script auto-detects CODEX_CI and
# switches to foreground mode. Run it normally — no extra flags needed.
bash scripts/start-server.sh --project-dir /path/to/project --open
```

**Gemini CLI:**
```bash
# Use --foreground and set is_background: true on your shell tool call
# so the process survives across turns
bash scripts/start-server.sh --project-dir /path/to/project --open --foreground
```

**Copilot CLI:**
```bash
# Start it with Copilot CLI's non-blocking/background shell mechanism so the
# server survives across turns. Keep --foreground so the harness, not the
# script, owns backgrounding. The launcher is a .sh, so invoke it via bash
# (on Windows, call Git Bash's bash.exe from the PowerShell tool).
bash scripts/start-server.sh --project-dir /path/to/project --open --foreground
```

**Other environments:** The server must keep running in the background across conversation turns. If your environment reaps detached processes, use `--foreground` and launch the command with your platform's background execution mechanism.

If the URL is unreachable from your browser (common in remote/containerized setups), bind a non-loopback host:

```bash
bash scripts/start-server.sh \
  --project-dir /path/to/project \
  --host 0.0.0.0 \
  --url-host localhost
```

Use `--url-host` to control what hostname is printed in the returned URL JSON.

## The Loop

1. **Check server is alive**, then **write HTML** to a new file in `screen_dir`:
   - **Required: confirm the server is alive before referring to the URL or pushing a screen.** Check that `$STATE_DIR/server-info` exists and `$STATE_DIR/server-stopped` does not. If it has shut down, restart it with `start-server.sh` using the **same `--project-dir`** — it reuses the same port, so the user's open tab reconnects on its own (it shows a "paused" overlay while the server is down) and you don't need to send a new URL. The server auto-exits after 4 hours idle (configurable with `--idle-timeout-minutes`).
   - Use semantic filenames: `platform.html`, `visual-style.html`, `layout.html`
   - **Never reuse filenames** — each screen gets a fresh file
   - Use your file-creation tool — **never use cat/heredoc** (dumps noise into terminal)
   - Server automatically serves the newest file

2. **Tell user what to expect and end your turn:**
   - Remind them of the URL (every step, not just first)
   - Give a brief text summary of what's on screen (e.g., "Showing 3 layout options for the homepage")
   - Ask them to respond in the terminal: "Take a look and let me know what you think. Click to select an option if you'd like."

3. **On your next turn** — after the user responds in the terminal:
   - Read `$STATE_DIR/events` if it exists — this contains the user's browser interactions (clicks, selections) as JSON lines
   - Merge with the user's terminal text to get the full picture
   - The terminal message is the primary feedback; `state_dir/events` provides structured interaction data

4. **Iterate or advance** — if feedback changes current screen, write a new file (e.g., `layout-v2.html`). Only move to the next question when the current step is validated.

5. **Unload when returning to terminal** — when the next step doesn't need the browser (e.g., a clarifying question, a tradeoff discussion), push a waiting screen to clear the stale content:

   ```html
   <!-- filename: waiting.html (or waiting-2.html, etc.) -->
   <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
     <p class="subtitle">Continuing in terminal...</p>
   </div>
   ```

   This prevents the user from staring at a resolved choice while the conversation has moved on. When the next visual question comes up, push a new content file as usual.

6. Repeat until done.

## Writing Content Fragments

Write just the content that goes inside the page. The server wraps it in the frame template automatically (header, theme CSS, connection status, and all interactive infrastructure).

**Minimal example:**

```html
<h2>Which layout works better?</h2>
<p class="subtitle">Consider readability and visual hierarchy</p>

<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Single Column</h3>
      <p>Clean, focused reading experience</p>
    </div>
  </div>
  <div class="option" data-choice="b" onclick="toggleSelect(this)">
    <div class="letter">B</div>
    <div class="content">
      <h3>Two Column</h3>
      <p>Sidebar navigation with main content</p>
    </div>
  </div>
</div>
```

That's it. No `<html>`, no CSS, no `<script>` tags needed. The server provides all of that.

## CSS Classes Available

The frame template provides these CSS classes for your content:

### Options (A/B/C choices)

```html
<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Title</h3>
      <p>Description</p>
    </div>
  </div>
</div>
```

**Multi-select:** Add `data-multiselect` to the container to let users select multiple options. Each click toggles the item's selected styling.

```html
<div class="options" data-multiselect>
  <!-- same option markup — users can select/deselect multiple -->
</div>
```

### Cards (visual designs)

```html
<div class="cards">
  <div class="card" data-choice="design1" onclick="toggleSelect(this)">
    <div class="card-image"><!-- mockup content --></div>
    <div class="card-body">
      <h3>Name</h3>
      <p>Description</p>
    </div>
  </div>
</div>
```

### Mockup container

```html
<div class="mockup">
  <div class="mockup-header">Preview: Dashboard Layout</div>
  <div class="mockup-body"><!-- your mockup HTML --></div>
</div>
```

### Split view (side-by-side)

```html
<div class="split">
  <div class="mockup"><!-- left --></div>
  <div class="mockup"><!-- right --></div>
</div>
```

### Pros/Cons

```html
<div class="pros-cons">
  <div class="pros"><h4>Pros</h4><ul><li>Benefit</li></ul></div>
  <div class="cons"><h4>Cons</h4><ul><li>Drawback</li></ul></div>
</div>
```

### Mock elements (wireframe building blocks)

```html
<div class="mock-nav">Logo | Home | About | Contact</div>
<div style="display: flex;">
  <div class="mock-sidebar">Navigation</div>
  <div class="mock-content">Main content area</div>
</div>
<button class="mock-button">Action Button</button>
<input class="mock-input" placeholder="Input field">
<div class="placeholder">Placeholder area</div>
```

### Typography and sections

- `h2` — page title
- `h3` — section heading
- `.subtitle` — secondary text below title
- `.section` — content block with bottom margin
- `.label` — small uppercase label text

## Browser Events Format

When the user clicks options in the browser, their interactions are recorded to `$STATE_DIR/events` (one JSON object per line). The file is cleared automatically when you push a new screen.

```jsonl
{"type":"click","choice":"a","text":"Option A - Simple Layout","timestamp":1706000101}
{"type":"click","choice":"c","text":"Option C - Complex Grid","timestamp":1706000108}
{"type":"click","choice":"b","text":"Option B - Hybrid","timestamp":1706000115}
```

The full event stream shows the user's exploration path — they may click multiple options before settling. The last `choice` event is typically the final selection, but the pattern of clicks can reveal hesitation or preferences worth asking about.

If `$STATE_DIR/events` doesn't exist, the user didn't interact with the browser — use only their terminal text.

## Design Tips

- **Scale fidelity to the question** — wireframes for layout, polish for polish questions
- **Explain the question on each page** — "Which layout feels more professional?" not just "Pick one"
- **Iterate before advancing** — if feedback changes current screen, write a new version
- **2-4 options max** per screen
- **Use real content when it matters** — for a photography portfolio, use actual images (Unsplash). Placeholder content obscures design issues.
- **Keep mockups simple** — focus on layout and structure, not pixel-perfect design

## File Naming

- Use semantic names: `platform.html`, `visual-style.html`, `layout.html`
- Never reuse filenames — each screen must be a new file
- For iterations: append version suffix like `layout-v2.html`, `layout-v3.html`
- Server serves newest file by modification time

## Cleaning Up

```bash
bash scripts/stop-server.sh $SESSION_DIR
```

If the session used `--project-dir`, mockup files persist in `.superpowers/brainstorm/` for later reference. Only `/tmp` sessions get deleted on stop.

## Reference

- Frame template (CSS reference): `scripts/frame-template.html`
- Helper script (client-side): `scripts/helper.js`
