"""Scripted LSP client that exercises ts7_lsp_proxy.py against a real TS 7 repo (in memory only).

Run: /opt/homebrew/bin/python3.12 tests/test_proxy.py   (TS7_LSP_TEST_REPO=<repo> to change the repo)
"""
import glob, json, os, shutil, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
import tempfile
PROXY = os.path.join(os.path.dirname(HERE), "scripts", "ts7_lsp_proxy.py")
PY = "/opt/homebrew/bin/python3.12"
REPO = os.environ.get("TS7_LSP_TEST_REPO", "/Users/liamshalom/sideshift-monorepo")
STATE = tempfile.mkdtemp(prefix="ts7-lsp-test-")
FILE = os.path.join(REPO, "lib/crawlzo.ts")
URI = "file://" + FILE
BASE = open(FILE).read()
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


class Client:
    def __init__(self, **env):
        e = dict(os.environ, CLAUDE_PROJECT_DIR=REPO, TS7_LSP_STATE_DIR=STATE, **{k: str(v) for k, v in env.items()})
        self.p = subprocess.Popen([PY, PROXY], cwd=REPO, env=e, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.msgs, self.lock, self.n = [], threading.Lock(), 0
        threading.Thread(target=self.reader, daemon=True).start()

    def reader(self):
        f = self.p.stdout
        while True:
            hdr = b""
            while not hdr.endswith(b"\r\n\r\n"):
                ch = f.read(1)
                if not ch:
                    return
                hdr += ch
            n = int(hdr.split(b"Content-Length:")[1].split(b"\r\n")[0])
            with self.lock:
                self.msgs.append((time.time(), json.loads(f.read(n))))

    def send(self, obj):
        b = json.dumps(obj).encode()
        self.p.stdin.write(b"Content-Length: %d\r\n\r\n" % len(b) + b)
        self.p.stdin.flush()

    def notify(self, method, params):
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def wait(self, pred, timeout, since=0.0):
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                for t, m in self.msgs:
                    if t >= since and pred(m):
                        return t, m
            time.sleep(0.02)
        return None, None

    def request(self, method, params, timeout=60):
        self.n += 1
        rid = self.n
        self.send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        return self.wait(lambda m: m.get("id") == rid and "method" not in m, timeout)[1]

    def initialize(self):
        r = self.request("initialize", {"processId": os.getpid(), "rootUri": "file://" + REPO,
                                        "capabilities": {"textDocument": {"publishDiagnostics": {}}},
                                        "workspaceFolders": [{"uri": "file://" + REPO, "name": "repo"}]})
        self.notify("initialized", {})
        return r

    def wait_diag(self, needle, timeout, since, uri=URI):
        def pred(m):
            return (m.get("method") == "textDocument/publishDiagnostics" and m["params"]["uri"] == uri
                    and any(needle in d.get("message", "") for d in m["params"]["diagnostics"]))
        t, m = self.wait(pred, timeout, since)
        return (t - since if t else None), m

    def log_text(self):
        logs = glob.glob(os.path.join(STATE, "logs", f"*-{self.p.pid}.log"))
        return open(logs[0]).read() if logs else ""


def pool_entries():
    return glob.glob(os.path.join(STATE, "pool", "*.json"))


def server_pids(client):
    out = subprocess.run(["pgrep", "-P", str(client.p.pid)], capture_output=True, text=True).stdout.split()
    return out


shutil.rmtree(STATE, ignore_errors=True)

# 1. Errors after open and after an edit; symbols; idle stop and replay.
a = Client(TS7_LSP_IDLE_SECONDS=5, TS7_LSP_CHECK_SECONDS=1, TS7_LSP_MIN_WARM_SECONDS=0)
r = a.initialize()
sync = (r or {}).get("result", {}).get("capabilities", {}).get("textDocumentSync")
check("initialize answered, full-text sync requested", isinstance(sync, dict) and sync.get("change") == 1, str(sync))
t0 = time.time()
a.notify("textDocument/didOpen", {"textDocument": {"uri": URI, "languageId": "typescript", "version": 1,
                                                   "text": BASE + "\nconst __p1: number = 'x';\n"}})
dt, _ = a.wait_diag("not assignable to type 'number'", 60, t0)
check("type error pushed after opening a file (first load)", dt is not None, f"{dt:.2f}s" if dt else "")
t0 = time.time()
a.notify("textDocument/didChange", {"textDocument": {"uri": URI, "version": 2},
                                    "contentChanges": [{"text": BASE + "\nconst __p2: string = 7;\n"}]})
dt, m = a.wait_diag("not assignable to type 'string'", 30, t0)
stale = m and any("type 'number'" in d["message"] for d in m["params"]["diagnostics"])
check("new error pushed after an edit, old one gone", dt is not None and not stale, f"{dt:.2f}s" if dt else "")
t0 = time.time()
sym = a.request("textDocument/documentSymbol", {"textDocument": {"uri": URI}})
check("documentSymbol answered", bool(sym and sym.get("result")), f"{len((sym or {}).get('result') or [])} symbols in {time.time()-t0:.2f}s")
refs = a.request("workspace/symbol", {"query": "Crawlzo"})
check("workspace/symbol answered", bool(refs and refs.get("result") is not None), f"{len((refs or {}).get('result') or [])} matches")
check("server registered in the pool", len(pool_entries()) == 1)
time.sleep(8)
check("idle server stopped", "server stopped (idle" in a.log_text() and not server_pids(a) and not pool_entries(),
      f"children={server_pids(a)}")
t0 = time.time()
a.notify("textDocument/didChange", {"textDocument": {"uri": URI, "version": 3},
                                    "contentChanges": [{"text": BASE + "\nconst __p3: boolean = 1;\n"}]})
dt, _ = a.wait_diag("not assignable to type 'boolean'", 60, t0)
check("edit after idle stop: restart, replay, error pushed", dt is not None and "replayed 1 open files" in a.log_text(),
      f"{dt:.2f}s" if dt else "")
a.request("shutdown", None)
a.notify("exit", None)
try:
    a.p.wait(10)
    exited = True
except subprocess.TimeoutExpired:
    exited = False
check("shutdown and exit: proxy exits, pool entry removed", exited and not pool_entries())

# 2. Machine-wide limit: three servers, limit two, least recently used stops.
clients = []
for i in range(3):
    c = Client(TS7_LSP_IDLE_SECONDS=600, TS7_LSP_CHECK_SECONDS=1, TS7_LSP_MIN_WARM_SECONDS=0, TS7_LSP_MAX_WARM=2)
    c.initialize()
    t0 = time.time()
    c.notify("textDocument/didOpen", {"textDocument": {"uri": URI, "languageId": "typescript", "version": 1,
                                                       "text": BASE + f"\nconst __q{i}: number = 'x';\n"}})
    c.wait_diag("not assignable to type 'number'", 60, t0)
    clients.append(c)
    time.sleep(1.5)
time.sleep(5)
stopped = [i for i, c in enumerate(clients) if "limit 2" in c.log_text()]
check("pool limit 2 with 3 servers: oldest stopped", stopped == [0] and len(pool_entries()) == 2,
      f"stopped={stopped} pool={len(pool_entries())}")
for c in clients:
    c.p.terminate()
time.sleep(2)
check("terminated proxies leave no servers behind", all(not server_pids(c) for c in clients) and not pool_entries())

# 3. One server per worktree root; an inactive root stops, forgets its files, and reopens on demand.
OTHER = tempfile.mkdtemp(prefix="ts7-lsp-root-")
subprocess.run(["git", "init", "-q", OTHER], check=True)
with open(os.path.join(OTHER, "tsconfig.json"), "w") as f:
    f.write('{"compilerOptions": {"strict": true, "noEmit": true}}')
OTHER_FILE = os.path.join(OTHER, "a.ts")
with open(OTHER_FILE, "w") as f:
    f.write("export const ok = 1;\n")
OTHER_URI = "file://" + OTHER_FILE
c = Client(TS7_LSP_IDLE_SECONDS=600, TS7_LSP_INACTIVE_ROOT_SECONDS=4, TS7_LSP_CHECK_SECONDS=1, TS7_LSP_MIN_WARM_SECONDS=0)
c.initialize()
t0 = time.time()
c.notify("textDocument/didOpen", {"textDocument": {"uri": URI, "languageId": "typescript", "version": 1,
                                                   "text": BASE + "\nconst __r1: number = 'x';\n"}})
c.wait_diag("not assignable to type 'number'", 60, t0)
t0 = time.time()
c.notify("textDocument/didOpen", {"textDocument": {"uri": OTHER_URI, "languageId": "typescript", "version": 1,
                                                   "text": "const __o1: number = 'x';\n"}})
dt, _ = c.wait_diag("not assignable to type 'number'", 60, t0, OTHER_URI)
name = os.path.basename(OTHER)
pids = server_pids(c)
check("second root gets its own server and its errors", dt is not None and len(pids) == 2
      and f"[{name}] server started" in c.log_text(), f"children={pids}")
time.sleep(2)
check("previous root keeps its server for the inactive-root time after the switch", len(server_pids(c)) == 2,
      f"children={server_pids(c)}")
for v in range(2, 7):
    c.notify("textDocument/didChange", {"textDocument": {"uri": URI, "version": v},
                                        "contentChanges": [{"text": BASE + f"\nconst __r{v}: number = 'x';\n"}]})
    time.sleep(2)
pids = server_pids(c)
check("inactive root stopped and forgot its files, active root kept",
      f"[{name}] server stopped (inactive root" in c.log_text() and len(pids) == 1, f"children={pids}")
t0 = time.time()
c.notify("textDocument/didChange", {"textDocument": {"uri": OTHER_URI, "version": 2},
                                    "contentChanges": [{"text": "const __o2: string = 7;\n"}]})
dt, _ = c.wait_diag("not assignable to type 'string'", 60, t0, OTHER_URI)
check("edit in a forgotten file: root restarts, file reopened, error pushed",
      dt is not None and f"[{name}] replayed 1 open files" in c.log_text(), f"{dt:.2f}s" if dt else "")
c.p.terminate()
time.sleep(2)
check("terminated proxy leaves no servers behind for any root", not server_pids(c) and not pool_entries())

# 4. Memory limit: a server over the limit restarts and keeps working.
m = Client(TS7_LSP_IDLE_SECONDS=600, TS7_LSP_CHECK_SECONDS=1, TS7_LSP_MAX_MEMORY_MB=1)
m.initialize()
t0 = time.time()
m.notify("textDocument/didOpen", {"textDocument": {"uri": URI, "languageId": "typescript", "version": 1,
                                                   "text": BASE + "\nconst __m1: number = 'x';\n"}})
m.wait_diag("not assignable to type 'number'", 60, t0)
time.sleep(3)
check("server over the memory limit stopped", "limit 1 MB" in m.log_text() and not server_pids(m))
t0 = time.time()
m.notify("textDocument/didChange", {"textDocument": {"uri": URI, "version": 2},
                                    "contentChanges": [{"text": BASE + "\nconst __m2: string = 7;\n"}]})
dt, _ = m.wait_diag("not assignable to type 'string'", 60, t0)
check("edit after a memory stop: restart, replay, error pushed", dt is not None, f"{dt:.2f}s" if dt else "")
m.p.terminate()
time.sleep(2)
shutil.rmtree(OTHER, ignore_errors=True)
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
