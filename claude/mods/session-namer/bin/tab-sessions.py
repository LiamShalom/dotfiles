#!/usr/bin/env python3
"""Print the Claude sessions in the focused Ghostty tab as JSON.

Usage: tab-sessions.py <own-session-id>
Output: {"tab": [{"title", "sessionId", "name", "color"}], "ownNamed": bool}, own pane
unmatched. A pane that is not a live Claude session has sessionId/name/color null.
"""
import glob
import json
import os
import re
import subprocess
import sys

HOME = os.path.expanduser("~")
SESSIONS_DIR = os.path.join(HOME, ".claude", "sessions")
PROJECTS_DIR = os.path.join(HOME, ".claude", "projects")
STATUSLINE_CACHE = os.path.join(HOME, ".claude", "statusline-cache")
# Same rule as the session-chrome mod: the registry keeps a name after /clear moved it to
# the previous conversation, so a set name must also be the one the status line shows.
KEPT_NAME_SOURCES = {"user", "collision"}
CHUNK = 1 << 20
MAX_TAIL = 64 << 20

TAB_SCRIPT = """
tell application "Ghostty"
  set out to ""
  repeat with t in terminals of selected tab of front window
    set out to out & (name of t) & linefeed
  end repeat
  return out
end tell
"""


def tab_titles():
    run = subprocess.run(["osascript", "-e", TAB_SCRIPT], capture_output=True, text=True, timeout=5)
    if run.returncode != 0:
        return []
    # Claude prefixes its terminal title with a status glyph ("✳ ", "◐ ").
    return [re.sub(r"^[^\w(]+\s+", "", line).strip() for line in run.stdout.splitlines() if line.strip()]


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def live_sessions():
    found = {}
    for path in glob.glob(os.path.join(SESSIONS_DIR, "*.json")):
        try:
            with open(path) as f:
                s = json.load(f)
        except (OSError, ValueError):
            continue
        if s.get("kind") == "interactive" and s.get("sessionId") and alive(int(s.get("pid", 0))):
            found[s["sessionId"]] = s
    return list(found.values())


def last_values(session_id, types):
    """Newest value of each transcript entry type, read from the end of the file."""
    paths = glob.glob(os.path.join(PROJECTS_DIR, "*", session_id + ".jsonl"))
    if not paths:
        return {}
    want = {t: '"type":"%s"' % t for t in types}
    got = {}
    with open(paths[0], "rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        tail = b""
        read = 0
        while pos > 0 and read < MAX_TAIL and len(got) < len(want):
            step = min(CHUNK, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step) + tail
            lines = buf.split(b"\n")
            tail = lines[0] if pos > 0 else b""
            for raw in reversed(lines[1:] if pos > 0 else lines):
                line = raw.decode("utf-8", "replace")
                for t, needle in want.items():
                    if t not in got and line.startswith("{" + needle):
                        try:
                            got[t] = json.loads(line)
                        except ValueError:
                            pass
            read += step
    return got


def describe(s):
    meta = last_values(s["sessionId"], ["agent-color", "custom-title", "ai-title"])
    labels = []
    if s.get("nameSource") == "user" and s.get("name"):
        labels.append(s["name"])
    if "custom-title" in meta:
        labels.append(meta["custom-title"].get("customTitle", ""))
    if "ai-title" in meta:
        labels.append(meta["ai-title"].get("aiTitle", ""))
    color = meta.get("agent-color", {}).get("agentColor")
    return {
        "sessionId": s["sessionId"],
        "name": labels[0] if labels else None,
        "labels": [l.lower() for l in labels if l],
        "color": None if color in (None, "default") else color,
    }


def matches(title, labels):
    t = title.lower()
    return any(t == l or t.startswith(l + " ") for l in labels)


def own_named(entry):
    if not entry or entry.get("nameSource") not in KEPT_NAME_SOURCES or not entry.get("name"):
        return False
    try:
        with open(os.path.join(STATUSLINE_CACHE, entry["sessionId"] + ".json")) as f:
            shown = json.load(f).get("name")
    except (OSError, ValueError):
        return False
    return shown == entry["name"]


def main():
    own = sys.argv[1] if len(sys.argv) > 1 else ""
    live = live_sessions()
    mine = next((s for s in live if s["sessionId"] == own), None)
    others = [describe(s) for s in live if s["sessionId"] != own]
    tab = []
    for title in tab_titles():
        hit = next((s for s in others if matches(title, s["labels"])), None)
        if hit:
            others.remove(hit)
        tab.append({
            "title": title,
            "sessionId": hit and hit["sessionId"],
            "name": hit and hit["name"],
            "color": hit and hit["color"],
        })
    json.dump({"tab": tab, "ownNamed": own_named(mine)}, sys.stdout)


if __name__ == "__main__":
    main()
