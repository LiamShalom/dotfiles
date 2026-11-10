#!/usr/bin/env python3
"""LSP proxy for TypeScript 7's native language server (`tsc --lsp --stdio`).

Claude Code shows type errors after an edit when the server pushes them. TS 7 only answers
pull requests (`textDocument/diagnostic`), so after each change this proxy pulls and pushes
the result.

Subagents share their session's LSP connection but edit in their own git worktrees, and a
TS 7 server keeps a full program (about 3.5 GB) for every worktree it has an open file in.
So the proxy runs one server per worktree root. The root the session used last stops after
TS7_LSP_IDLE_SECONDS without activity; every other root stops after
TS7_LSP_INACTIVE_ROOT_SECONDS and forgets its open files, which frees a finished subagent's
memory. A server over TS7_LSP_MAX_MEMORY_MB is restarted. When more than TS7_LSP_MAX_WARM
servers run on the machine, the least recently used stops. The next message for a stopped
root restarts its server and reopens its files.
"""
import atexit
import copy
import ctypes
import glob
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
from collections import OrderedDict

IDLE_SECONDS = float(os.environ.get("TS7_LSP_IDLE_SECONDS", "900"))
INACTIVE_ROOT_SECONDS = float(os.environ.get("TS7_LSP_INACTIVE_ROOT_SECONDS", "180"))
MAX_MEMORY_MB = float(os.environ.get("TS7_LSP_MAX_MEMORY_MB", "10240"))
MAX_WARM = int(os.environ.get("TS7_LSP_MAX_WARM", "8"))
CHECK_SECONDS = float(os.environ.get("TS7_LSP_CHECK_SECONDS", "15"))
MIN_WARM_SECONDS = float(os.environ.get("TS7_LSP_MIN_WARM_SECONDS", "60"))
DEBOUNCE_SECONDS = 0.15
RELATED_DOCS = 10
STATE_DIR = os.environ.get("TS7_LSP_STATE_DIR", os.path.expanduser("~/.cache/ts7-lsp"))
POOL_DIR = os.path.join(STATE_DIR, "pool")
LOG_DIR = os.path.join(STATE_DIR, "logs")
REPLAYED = {"initialized", "textDocument/didOpen", "textDocument/didChange",
            "textDocument/didClose", "workspace/didChangeConfiguration"}
DOC_EVENTS = {"textDocument/didOpen", "textDocument/didChange", "textDocument/didSave"}
LANGUAGE_IDS = {".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
                ".tsx": "typescriptreact", ".js": "javascript", ".mjs": "javascript",
                ".cjs": "javascript", ".jsx": "javascriptreact"}


def read_message(stream):
    length = None
    while True:
        line = stream.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            break
        key, _, value = line.partition(b":")
        if key.strip().lower() == b"content-length":
            length = int(value)
    if length is None:
        return None
    body = stream.read(length)
    return json.loads(body) if len(body) == length else None


def write_message(stream, lock, msg):
    body = json.dumps(msg, separators=(",", ":")).encode()
    with lock:
        stream.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        stream.flush()


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def memory_mb(pid):
    """Memory footprint as Activity Monitor shows it. RSS misses compressed and swapped pages."""
    if sys.platform == "darwin":
        try:
            buf = ctypes.create_string_buffer(512)
            # rusage_info_v0: a 16-byte uuid, then uint64 fields; ri_phys_footprint is the 8th.
            if ctypes.CDLL("/usr/lib/libproc.dylib").proc_pid_rusage(pid, 0, buf) == 0:
                return int.from_bytes(buf.raw[72:80], sys.byteorder) / 2**20
        except OSError:
            pass
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True).stdout
        return int(out.strip()) / 1024
    except (OSError, ValueError):
        return None


def utf16_offset(text, line, character):
    pos = 0
    for _ in range(line):
        newline = text.find("\n", pos)
        if newline < 0:
            return len(text)
        pos = newline + 1
    units = 0
    while units < character and pos < len(text) and text[pos] != "\n":
        units += 2 if ord(text[pos]) > 0xFFFF else 1
        pos += 1
    return pos


def apply_change(text, change):
    if "range" not in change:
        return change["text"]
    start, end = change["range"]["start"], change["range"]["end"]
    a = utf16_offset(text, start["line"], start["character"])
    b = utf16_offset(text, end["line"], end["character"])
    return text[:a] + change["text"] + text[b:]


def uri_path(uri):
    if not isinstance(uri, str) or not uri.startswith("file://"):
        return None
    return urllib.parse.unquote(urllib.parse.urlparse(uri).path)


def find_server(starts):
    override = os.environ.get("TS7_LSP_TSC")
    if override:
        return override
    arch = {"x86_64": "x64", "aarch64": "arm64"}.get(platform.machine(), platform.machine())
    candidates = [(f"typescript-{sys.platform}-{arch}", "tsc"), (f"native-preview-{sys.platform}-{arch}", "tsgo")]
    for start in filter(None, starts):
        d = os.path.abspath(start)
        while True:
            for package, binary in candidates:
                exe = os.path.join(d, "node_modules", "@typescript", package, "lib", binary)
                if os.access(exe, os.X_OK):
                    return exe
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    return None


class Server:
    """One TS 7 server process for one worktree root, with that root's open files."""

    def __init__(self, proxy, root, exe, index):
        self.proxy = proxy
        self.root = root
        self.exe = exe
        self.name = os.path.basename(root) or root
        self.index = index
        self.child = None
        self.child_lock = threading.Lock()
        self.docs = OrderedDict()
        self.pending = {}
        self.waiters = {}
        self.inflight = 0
        self.last_active = time.time()
        self.lost_active = 0.0

    def log(self, text):
        self.proxy.log(f"[{self.name}] {text}")

    def alive(self):
        return self.child is not None and self.child.poll() is None

    def send(self, msg):
        child = self.child
        if child is None:
            return
        try:
            write_message(child.stdin, self.child_lock, msg)
        except (BrokenPipeError, OSError, ValueError):
            self.log("write to server failed")

    def forward(self, msg):
        if msg.get("id") is not None:
            self.pending[msg["id"]] = msg.get("method")
        self.send(msg)

    def start(self):
        stderr = open(self.proxy.log_path, "ab")
        self.child = subprocess.Popen([self.exe, "--lsp", "--stdio"], cwd=self.root,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr)
        threading.Thread(target=self.reader, args=(self.child,), daemon=True).start()
        self.register()
        self.log(f"server started pid={self.child.pid} exe={self.exe}")

    def ensure(self):
        """Start the server if it is stopped. Returns True when it restarted and replayed."""
        if self.alive():
            return False
        self.start()
        if self.proxy.init_params is None:
            return False
        began = time.time()
        self.request("initialize", self.init_params(), timeout=60)
        self.send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        if self.proxy.config_params is not None:
            self.send({"jsonrpc": "2.0", "method": "workspace/didChangeConfiguration",
                       "params": self.proxy.config_params})
        for uri in self.docs:
            self.send_open(uri)
        self.log(f"replayed {len(self.docs)} open files in {time.time() - began:.2f}s")
        return True

    def init_params(self):
        params = copy.deepcopy(self.proxy.init_params)
        params["processId"] = os.getpid()
        params["rootUri"] = "file://" + urllib.parse.quote(self.root)
        params["rootPath"] = self.root
        params["workspaceFolders"] = self.folders()
        return params

    def folders(self):
        return [{"uri": "file://" + urllib.parse.quote(self.root), "name": self.name}]

    def send_open(self, uri):
        doc = self.docs[uri]
        self.send({"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {
            "textDocument": {"uri": uri, "languageId": doc["languageId"],
                             "version": doc["version"], "text": doc["text"]}}})

    def stop(self, reason, forget_docs=False):
        child, self.child = self.child, None
        self.unregister()
        for waiter in list(self.waiters.values()):
            waiter[0].set()
        for rid in list(self.pending):
            self.proxy.send_client({"jsonrpc": "2.0", "id": rid,
                                    "error": {"code": -32803, "message": "TypeScript server stopped"}})
        self.pending.clear()
        if forget_docs:
            for uri in self.docs:
                self.proxy.forget(uri)
            self.docs.clear()
        if child is None:
            return
        try:
            child.terminate()
            child.wait(5)
        except subprocess.TimeoutExpired:
            child.kill()
        except OSError:
            pass
        self.log(f"server stopped ({reason})")

    def request(self, method, params, timeout):
        with self.proxy.state:
            rid = self.proxy.new_request_id()
            waiter = [threading.Event(), None]
            self.waiters[rid] = waiter
            self.inflight += 1
        try:
            self.send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
            waiter[0].wait(timeout)
            return waiter[1]
        finally:
            with self.proxy.state:
                self.waiters.pop(rid, None)
                self.inflight -= 1

    def reader(self, child):
        while True:
            try:
                msg = read_message(child.stdout)
            except (OSError, ValueError):
                msg = None
            if msg is None:
                break
            mid, method = msg.get("id"), msg.get("method")
            if method is None:
                if isinstance(mid, str) and mid.startswith("ts7proxy-"):
                    waiter = self.waiters.get(mid)
                    if waiter:
                        waiter[1] = msg
                        waiter[0].set()
                    continue
                # No state lock here: the main thread holds it while writing to the server,
                # and a full pipe in both directions would deadlock.
                self.pending.pop(mid, None)
                if mid == self.proxy.client_init_id and isinstance(msg.get("result"), dict):
                    self.proxy.request_full_sync(msg["result"])
                self.proxy.send_client(msg)
            elif mid is not None:
                self.answer_server_request(msg)
            else:
                self.proxy.send_client(msg)
        with self.proxy.state:
            if child is self.child:
                self.log(f"server exited unexpectedly code={child.poll()}")
                self.child = None
                self.unregister()
                for rid in list(self.pending):
                    self.proxy.send_client({"jsonrpc": "2.0", "id": rid,
                                            "error": {"code": -32803, "message": "TypeScript server exited"}})
                self.pending.clear()
            for waiter in list(self.waiters.values()):
                waiter[0].set()

    def answer_server_request(self, msg):
        # The server blocks until these are answered, so the proxy answers them itself
        # instead of depending on what the client implements.
        method = msg.get("method")
        params = msg.get("params") or {}
        if method == "workspace/configuration":
            result = [None] * len(params.get("items", []))
        elif method == "workspace/workspaceFolders":
            result = self.folders()
        elif method == "workspace/applyEdit":
            result = {"applied": False}
        else:
            result = None
        self.send({"jsonrpc": "2.0", "id": msg["id"], "result": result})

    # --- machine-wide pool -----------------------------------------------------------

    def pool_file(self):
        return os.path.join(POOL_DIR, f"{os.getpid()}-{self.index}.json")

    def register(self):
        if not self.alive():
            return
        tmp = self.pool_file() + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"proxy_pid": os.getpid(), "child_pid": self.child.pid,
                       "last_active": self.last_active, "cwd": self.root}, f)
        os.replace(tmp, self.pool_file())

    def unregister(self):
        try:
            os.remove(self.pool_file())
        except OSError:
            pass


class Proxy:
    def __init__(self, exe):
        self.exe = exe
        cwd = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        self.root_cache = {}
        self.default_root = self.find_root(cwd) or os.path.abspath(cwd)
        self.out = sys.stdout.buffer
        self.out_lock = threading.Lock()
        self.state = threading.RLock()
        self.servers = {}
        self.active = None
        self.init_params = None
        self.client_init_id = None
        self.client_pulls = False
        self.config_params = None
        self.next_id = 0
        self.diag_due = {}
        self.primary = set()
        self.published = {}
        os.makedirs(POOL_DIR, exist_ok=True)
        os.makedirs(LOG_DIR, exist_ok=True)
        self.log_path = os.path.join(LOG_DIR, f"{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}.log")
        self.log_lock = threading.Lock()
        self.prune_logs()

    def log(self, text):
        with self.log_lock, open(self.log_path, "a") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {text}\n")

    def prune_logs(self):
        cutoff = time.time() - 7 * 86400
        for path in glob.glob(os.path.join(LOG_DIR, "*.log")):
            try:
                if os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except OSError:
                pass

    def send_client(self, msg):
        write_message(self.out, self.out_lock, msg)

    def new_request_id(self):
        self.next_id += 1
        return f"ts7proxy-{self.next_id}"

    @staticmethod
    def request_full_sync(result):
        # Full-text sync keeps the proxy's copy of each open file exact for replay.
        caps = result.setdefault("capabilities", {})
        sync = caps.get("textDocumentSync")
        if isinstance(sync, dict):
            sync["change"] = 1
        elif isinstance(sync, int) and sync:
            caps["textDocumentSync"] = 1

    # --- routing ---------------------------------------------------------------------

    def find_root(self, path):
        """The nearest directory with a `.git` entry; a worktree has a `.git` file."""
        d = os.path.abspath(path)
        seen = []
        while True:
            if d in self.root_cache:
                root = self.root_cache[d]
                break
            seen.append(d)
            if os.path.exists(os.path.join(d, ".git")):
                root = d
                break
            parent = os.path.dirname(d)
            if parent == d:
                root = None
                break
            d = parent
        for s in seen:
            self.root_cache[s] = root
        return root

    def root_for(self, uri):
        path = uri_path(uri)
        if path is None:
            return None
        return self.find_root(os.path.dirname(path)) or self.default_root

    def server(self, root):
        server = self.servers.get(root)
        if server is None:
            exe = self.exe if root == self.default_root else (find_server([root]) or self.exe)
            server = Server(self, root, exe, len(self.servers))
            self.servers[root] = server
        return server

    def server_for(self, params):
        uri = (params.get("textDocument") or {}).get("uri") or (params.get("item") or {}).get("uri")
        root = self.root_for(uri)
        if root is not None:
            return self.server(root)
        if self.active is not None:
            return self.active
        return self.server(self.default_root)

    def mark_active(self, server):
        now = time.time()
        if self.active is not None and self.active is not server:
            self.active.lost_active = now
        server.last_active = now
        self.active = server

    def live_servers(self):
        return [s for s in self.servers.values() if s.alive()]

    def stop_all(self, reason):
        for server in self.live_servers():
            server.stop(reason)

    # --- client messages -----------------------------------------------------------

    def handle_client(self, msg):
        method, mid = msg.get("method"), msg.get("id")
        if method is None:
            return
        if method == "exit":
            self.stop_all("client exit")
            os._exit(0)
        params = msg.get("params") or {}
        with self.state:
            if method == "initialize":
                self.init_params = copy.deepcopy(params)
                text_caps = (self.init_params.get("capabilities") or {}).get("textDocument") or {}
                self.client_pulls = "diagnostic" in text_caps
                self.client_init_id = mid
                self.log(f"client initialize; client pulls diagnostics: {self.client_pulls}")
                server = self.server(self.default_root)
                self.mark_active(server)
                if not server.alive():
                    server.start()
                server.forward(msg)
                return
            if method == "shutdown":
                self.stop_all("client shutdown")
                self.send_client({"jsonrpc": "2.0", "id": mid, "result": None})
                return
            if method == "workspace/didChangeConfiguration":
                self.config_params = copy.deepcopy(params)
            if method in ("initialized", "workspace/didChangeConfiguration") or (
                    method.startswith("$/") and method != "$/cancelRequest"):
                for server in self.live_servers():
                    server.send(msg)
                return
            if method == "$/cancelRequest":
                for server in self.live_servers():
                    if params.get("id") in server.pending:
                        server.send(msg)
                return
            server = self.server_for(params)
            self.mark_active(server)
            uri, action = self.track_document(server, method, params)
            restarted = server.ensure()
            if restarted:
                if action != "skip" and method not in REPLAYED:
                    server.forward(msg)
            else:
                if action in ("open", "open+forward"):
                    server.send_open(uri)
                if action in ("forward", "open+forward"):
                    server.forward(msg)
            if uri and method in DOC_EVENTS and action != "skip" and not self.client_pulls:
                self.schedule(server, uri)
        if method not in ("textDocument/didChange", "$/cancelRequest"):
            self.log(f"client {method}")

    def track_document(self, server, method, params):
        """Update the root's copy of the file. Returns (uri, what to send to the server).

        A root that stopped while inactive forgot its files, but the client still thinks they
        are open, so the proxy reopens a file the next time the client mentions it.
        """
        doc = params.get("textDocument") or {}
        uri = doc.get("uri")
        if uri is None:
            return None, "forward"
        docs = server.docs
        if method == "textDocument/didOpen":
            docs[uri] = {"languageId": doc.get("languageId", "typescript"),
                         "version": doc.get("version", 0), "text": doc.get("text", "")}
            docs.move_to_end(uri)
            return uri, "forward"
        if method == "textDocument/didClose":
            if uri not in docs:
                return uri, "skip"
            docs.pop(uri)
            self.forget(uri)
            return uri, "forward"
        if method == "textDocument/didChange":
            changes = params.get("contentChanges", [])
            if uri in docs:
                entry = docs[uri]
                for change in changes:
                    entry["text"] = apply_change(entry["text"], change)
                entry["version"] = doc.get("version", entry["version"])
                docs.move_to_end(uri)
                return uri, "forward"
            text = changes[-1]["text"] if changes and "range" not in changes[-1] else None
            return uri, "open" if self.reopen(server, uri, doc.get("version", 0), text) else "skip"
        if uri not in docs and uri_path(uri) and self.reopen(server, uri, 0, None):
            return uri, "open+forward"
        return uri, "forward"

    @staticmethod
    def reopen(server, uri, version, text):
        path = uri_path(uri)
        if text is None:
            try:
                with open(path, encoding="utf-8") as f:
                    text = f.read()
            except (OSError, UnicodeDecodeError, TypeError):
                return False
        language = LANGUAGE_IDS.get(os.path.splitext(path or "")[1], "typescript")
        server.docs[uri] = {"languageId": language, "version": version, "text": text}
        return True

    def forget(self, uri):
        self.diag_due.pop(uri, None)
        self.published.pop(uri, None)
        self.primary.discard(uri)

    # --- diagnostics -----------------------------------------------------------------

    def schedule(self, server, uri):
        due = time.time() + DEBOUNCE_SECONDS
        self.diag_due[uri] = due
        self.primary.add(uri)
        related = [u for u in reversed(server.docs) if u != uri][:RELATED_DOCS]
        for other in related:
            self.diag_due.setdefault(other, due + 0.2)

    def diagnostics_loop(self):
        while True:
            time.sleep(0.05)
            now = time.time()
            with self.state:
                due = [u for u, t in self.diag_due.items() if t <= now]
                for uri in due:
                    del self.diag_due[uri]
            for uri in due:
                self.publish(uri)

    def publish(self, uri):
        with self.state:
            server = self.servers.get(self.root_for(uri))
            doc = server.docs.get(uri) if server else None
            if doc is None or not server.alive():
                return
            version = doc["version"]
            primary = uri in self.primary
            self.primary.discard(uri)
        began = time.time()
        resp = server.request("textDocument/diagnostic", {"textDocument": {"uri": uri}}, timeout=60)
        result = (resp or {}).get("result")
        if not isinstance(result, dict) or result.get("kind", "full") != "full":
            server.log(f"diagnostics unavailable for {uri}: {(resp or {}).get('error')}")
            return
        # Hints (severity 4, such as unused variables) are noise for agents; lint reports them.
        items = [d for d in result.get("items", []) if d.get("severity") != 4]
        key = json.dumps(items, sort_keys=True)
        if not primary and self.published.get(uri) == key:
            return
        self.published[uri] = key
        self.send_client({"jsonrpc": "2.0", "method": "textDocument/publishDiagnostics",
                          "params": {"uri": uri, "version": version, "diagnostics": items}})
        server.log(f"pushed {len(items)} diagnostics for {os.path.basename(uri)} "
                   f"in {time.time() - began:.2f}s")

    # --- limits ----------------------------------------------------------------------

    @staticmethod
    def read_pool():
        entries = []
        for path in glob.glob(os.path.join(POOL_DIR, "*.json")):
            try:
                with open(path) as f:
                    entry = json.load(f)
            except (OSError, ValueError):
                continue
            if pid_alive(entry.get("proxy_pid", 0)) and pid_alive(entry.get("child_pid", 0)):
                entries.append(entry)
            else:
                try:
                    os.remove(path)
                except OSError:
                    pass
        return entries

    def monitor_loop(self):
        while True:
            time.sleep(CHECK_SECONDS)
            with self.state:
                for server in self.live_servers():
                    server.register()
                    self.check_limits(server)

    def check_limits(self, server):
        due_roots = {self.root_for(u) for u in self.diag_due}
        if server.pending or server.inflight or server.root in due_roots:
            return
        memory = memory_mb(server.child.pid)
        if memory is not None and memory > MAX_MEMORY_MB:
            # Kept files reopen on the next message, so this only clears memory the server
            # accumulated; files of inactive roots are already gone.
            server.stop(f"memory {memory:.0f} MB, limit {MAX_MEMORY_MB:.0f} MB")
            return
        now = time.time()
        idle = now - server.last_active
        # The timer starts when the root stops being the active one, so a session that was
        # quiet for a while does not lose its own server the moment a subagent starts work.
        inactive = now - max(server.last_active, server.lost_active)
        if server is not self.active and inactive >= INACTIVE_ROOT_SECONDS:
            server.stop(f"inactive root, idle {idle:.0f}s", forget_docs=True)
            return
        if idle >= IDLE_SECONDS:
            server.stop(f"idle {idle:.0f}s")
            return
        live = self.read_pool()
        if len(live) <= MAX_WARM:
            return
        cold = [e for e in live if now - e["last_active"] >= MIN_WARM_SECONDS]
        if cold and min(cold, key=lambda e: (e["last_active"], e["child_pid"]))["child_pid"] == server.child.pid:
            server.stop(f"{len(live)} servers running, limit {MAX_WARM}")

    def run(self):
        threading.Thread(target=self.diagnostics_loop, daemon=True).start()
        threading.Thread(target=self.monitor_loop, daemon=True).start()
        stdin = sys.stdin.buffer
        while True:
            msg = read_message(stdin)
            if msg is None:
                break
            self.handle_client(msg)
        self.stop_all("client closed")

    def unregister_all(self):
        for server in self.servers.values():
            server.unregister()


def main():
    exe = find_server([os.environ.get("CLAUDE_PROJECT_DIR"), os.getcwd()])
    if exe is None:
        fallback = shutil.which("typescript-language-server")
        if fallback:
            os.execvp(fallback, [fallback, "--stdio"])
        sys.stderr.write("ts7-lsp: no TypeScript 7 server found in node_modules and no "
                         "typescript-language-server on PATH\n")
        sys.exit(1)
    proxy = Proxy(exe)

    def shutdown(*_):
        proxy.stop_all("signal")
        os._exit(0)

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, shutdown)
    atexit.register(proxy.unregister_all)
    proxy.run()


if __name__ == "__main__":
    main()
