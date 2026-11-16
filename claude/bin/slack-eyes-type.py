#!/usr/bin/env python3
# Types a prompt into a running background Claude Code session, the way Session Board types into
# one it does not show: attach in a pseudo-terminal, wait for the screen to settle, type, press
# Enter, detach (closing the attach leaves the session running). The prompt comes on stdin.
#   slack-eyes-type.py <claude binary> <session id> < prompt.txt
# Exit 0 when the prompt was sent; 1 when the attach failed or ended first.
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

READY_TIMEOUT = 15.0
# Session Board's rule: ready once the attach has drawn for this long.
SETTLE = 1.2

claude, session = sys.argv[1], sys.argv[2]
text = sys.stdin.read()
if not text.strip():
    sys.exit('empty prompt')

pid, fd = pty.fork()
if pid == 0:
    os.execv(claude, [claude, 'attach', session])

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
output = bytearray()


def pump(seconds):
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return False
        if not data:
            return False
        output.extend(data)
        # Claude Code asks the terminal for its cursor position and attributes; answer like one.
        if b'\x1b[6n' in data:
            os.write(fd, b'\x1b[1;1R')
        if b'\x1b[c' in data:
            os.write(fd, b'\x1b[?62;22c')
    return True


def done(code, message=''):
    try:
        os.kill(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass
    try:
        os.close(fd)
    except OSError:
        pass
    if message:
        print(message, file=sys.stderr)
    sys.exit(code)


start = time.time()
first = None
while time.time() - start < READY_TIMEOUT:
    if not pump(0.1):
        done(1, 'the attach ended before it was ready: ' + output.decode('utf8', 'replace')[-300:])
    if output and first is None:
        first = time.time()
    if first is not None and time.time() - first >= SETTLE:
        break
else:
    done(1, 'the attach drew nothing in time')

if b'has exited' in output:
    done(1, 'the session has exited')

# Newlines become ESC CR, which Claude Code reads as a line break inside one prompt.
os.write(fd, text.replace('\r\n', '\n').replace('\n', '\x1b\r').encode('utf8'))
if not pump(0.4):
    done(1, 'the attach ended while typing')
os.write(fd, b'\r')
pump(1.0)
done(0)
