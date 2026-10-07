#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────
#  SEARCH//NET auto-updating launcher
#
#  Run this ONCE and leave it. It:
#    • starts the SEARCH//NET server,
#    • checks GitHub for new commits on a loop,
#    • pulls and restarts the server when there are updates,
#    • restarts the server if it ever crashes.
#  Your phone reconnects on its own when the server comes back.
#
#    python searchnet/server/run.py
#    python searchnet/server/run.py --port 8765 --phone-host 192.168.1.20
#    python searchnet/server/run.py --interval 30        # seconds between update checks
#    python searchnet/server/run.py --no-update          # just keep it running, don't pull
#
#  Any option you don't recognize is passed straight to the server.
# ─────────────────────────────────────────────────────────────────

import argparse
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent          # the git repo root (portfolio)
SERVER = HERE / "reelvault.py"


def git(*args, timeout=120):
    try:
        r = subprocess.run(["git", *args], cwd=str(REPO), capture_output=True,
                           text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except (subprocess.SubprocessError, FileNotFoundError, OSError) as e:
        return 1, str(e)


def head():
    code, out = git("rev-parse", "HEAD")
    return out if code == 0 else ""


def requirements_changed(before, after):
    if not before or not after or before == after:
        return False
    code, out = git("diff", "--name-only", before, after)
    return code == 0 and "requirements.txt" in out


def pip_install():
    req = HERE / "requirements.txt"
    if req.exists():
        print("  dependencies changed — updating…", flush=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(req)])


class Server:
    def __init__(self, args):
        self.args = args
        self.proc = None

    def start(self):
        cmd = [sys.executable, str(SERVER), *self.args]
        # the launcher owns the browser-open, so the server never opens its own
        if "--no-browser" not in cmd:
            cmd.append("--no-browser")
        self.proc = subprocess.Popen(cmd, cwd=str(REPO))

    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def stop(self):
        if self.alive():
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

    def restart(self):
        self.stop()
        time.sleep(1)
        self.start()


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--interval", type=int, default=45, help="seconds between update checks")
    ap.add_argument("--no-update", action="store_true", help="don't pull from GitHub, just keep running")
    ap.add_argument("--branch", default="", help="git branch to track (default: current)")
    ap.add_argument("-h", "--help", action="store_true")
    known, passthrough = ap.parse_known_args()
    if known.help:
        print(__doc__)
        return

    if not SERVER.exists():
        sys.exit(f"Can't find the server at {SERVER}. Run this from inside the project folder.")

    is_git = git("rev-parse", "--is-inside-work-tree")[0] == 0
    update = not known.no_update and is_git
    if not known.no_update and not is_git:
        print("  (not a git checkout — auto-update off; downloaded ZIP instead of git clone?)")

    branch = known.branch
    if update and not branch:
        branch = git("rev-parse", "--abbrev-ref", "HEAD")[1] or "main"

    srv = Server(passthrough)
    srv.start()
    print("\n  SEARCH//NET launcher running." + (f"  Watching GitHub ({branch}) every {known.interval}s."
          if update else "  Auto-update off."))
    print("  Leave this window open. Press Ctrl+C to stop everything.\n", flush=True)

    opened = False
    try:
        while True:
            for _ in range(max(1, known.interval)):
                time.sleep(1)
                if not srv.alive():
                    print("  server stopped — restarting…", flush=True)
                    srv.start()
                if not opened:      # open the local page once, after the first start
                    opened = True
                    try:
                        import webbrowser
                        port = next((passthrough[i + 1] for i, a in enumerate(passthrough)
                                     if a == "--port"), "8765")
                        webbrowser.open(f"http://127.0.0.1:{port}/searchnet/#setup")
                    except Exception:      # noqa: BLE001
                        pass
            if not update:
                continue
            before = head()
            code, out = git("pull", "--ff-only", "origin", branch)
            after = head()
            if code != 0:
                print(f"  update check failed (will retry): {out.splitlines()[-1] if out else code}",
                      flush=True)
            elif after and before and after != before:
                print(f"\n  ⬇ update found — pulling and restarting ({before[:7]} → {after[:7]})",
                      flush=True)
                if requirements_changed(before, after):
                    pip_install()
                srv.restart()
                print("  ✓ updated. Your phone will reconnect automatically.\n", flush=True)
    except KeyboardInterrupt:
        print("\n  stopping…")
        srv.stop()
        print("  bye")


if __name__ == "__main__":
    main()
