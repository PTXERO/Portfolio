"""HTTP server: static UI, media with range requests, JSON API, access key."""

import argparse
import csv
import hmac
import io
import json
import mimetypes
import re
import socket
import sys
import time
import traceback
import urllib.parse
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import sources as S
from .db import norm_tags
from .related import related
from .search import search
from .util import to_int
from .vault import Vault

HERE = Path(__file__).resolve().parent.parent      # reel-vault/server
APP_DIR = HERE.parent                              # reel-vault/
SITE_ROOT = APP_DIR.parent                         # portfolio root
EXPORT_COLS = ["id", "platform", "media", "url", "author", "author_name", "posted_at", "duration",
               "likes", "reposts", "replies", "views", "hashtags", "tags", "starred", "file",
               "text", "transcript", "ocr", "notes"]
LOOPBACK = ("127.0.0.1", "localhost", "[::1]", "::1")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))     # no packet is sent; picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(BaseHTTPRequestHandler):
    vault: Vault = None
    allowed_origins: set = set()
    port = 8765
    server_version = "ReelVault/2.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        line = args[0] if args else ""
        if "/api/jobs" not in line and "/media/" not in line:
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # ── auth ────────────────────────────────────────────────────
    def _host(self):
        return (self.headers.get("Host") or "").lower()

    def _authorized(self):
        key = self.vault.store.access_key
        hostname = self._host().rsplit(":", 1)[0] if not self._host().startswith("[") \
            else self._host().split("]")[0] + "]"
        client = self.client_address[0]
        if (client.startswith("127.") or client == "::1") and hostname in LOOPBACK:
            return True     # this computer, addressed as localhost (no DNS rebinding)
        given = self.headers.get("X-RV-Key") or ""
        if not given and self.headers.get("Cookie"):
            c = SimpleCookie()
            try:
                c.load(self.headers["Cookie"])
                given = c["rv_key"].value if "rv_key" in c else ""
            except Exception:        # noqa: BLE001
                given = ""
        return bool(given) and hmac.compare_digest(given, key)

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return not origin or origin == f"http://{self._host()}" or origin in self.allowed_origins

    def _cookie_header(self):
        return {"Set-Cookie": f"rv_key={self.vault.store.access_key}; Path=/; Max-Age=31536000; "
                              "SameSite=Lax; HttpOnly"}

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin in self.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-RV-Key")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, code, obj=None, body=None, ctype="application/json", headers=None):
        if body is None:
            body = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _body(self):
        n = to_int(self.headers.get("Content-Length"), 0)
        if n <= 0:
            return {}
        if n > 5_000_000:
            raise ValueError("body too large")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            raise ValueError("invalid JSON body")

    def do_OPTIONS(self):
        self.send_response(204 if self._origin_ok() else 403)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        u = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(u.path)
        params = {k: v[-1] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if not self._origin_ok():
                return self._send(403, {"error": "origin not allowed (see --allow-origin)"})
            # pairing link: ?key=… sets a cookie, then drops the key from the URL
            if "key" in params and method == "GET":
                if hmac.compare_digest(params["key"], self.vault.store.access_key):
                    rest = urllib.parse.urlencode({k: v for k, v in params.items() if k != "key"})
                    return self._send(302, body=b"", headers={
                        "Location": u.path + ("?" + rest if rest else ""), **self._cookie_header()})
            if path.startswith("/api/"):
                parts = path[5:].strip("/").split("/")
                if parts[0] == "pair" and method == "POST":
                    ok = hmac.compare_digest(str(self._body().get("key", "")).strip(),
                                             self.vault.store.access_key)
                    time.sleep(0 if ok else 1.0)      # slow down guessing
                    return self._send(200 if ok else 401, {"ok": ok},
                                      headers=self._cookie_header() if ok else None)
                if not self._authorized():
                    return self._send(401, {"error": "access key required", "auth": False})
                return self._api(method, parts, params)
            if method != "GET":
                return self._send(405, {"error": "method not allowed"})
            if path.startswith("/media/"):
                if not self._authorized():
                    return self._send(401, {"error": "access key required"})
                return self._file(self.vault.media_dir, path[7:])
            if path in ("/", ""):
                return self._send(302, body=b"", headers={"Location": "/reel-vault/"})
            return self._file(SITE_ROOT, path.lstrip("/"))
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:      # noqa: BLE001
            traceback.print_exc()
            self._send(500, {"error": str(e)})

    def _file(self, root: Path, rel: str):
        root = root.resolve()
        f = (root / rel).resolve()
        if not f.is_relative_to(root):
            return self._send(403, {"error": "forbidden"})
        if f.is_dir():
            if not self.path.split("?")[0].endswith("/"):
                return self._send(301, body=b"", headers={"Location": self.path.split("?")[0] + "/"})
            f = f / "index.html"
        rel_parts = f.relative_to(root).parts
        if not f.is_file() or any(p.startswith(".") for p in rel_parts) or \
                (root == SITE_ROOT.resolve() and "data" in rel_parts and "reel-vault" in rel_parts):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        size = f.stat().st_size
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and size:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else end
            elif m.group(2):
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(206 if m else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "private, max-age=3600" if root == self.vault.media_dir.resolve()
                         else "no-cache")
        if m:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self._cors()
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(f, "rb") as fh:
            fh.seek(start)
            left = length
            while left > 0:
                chunk = fh.read(min(1 << 16, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    # ── API ─────────────────────────────────────────────────────
    def _api(self, method, parts, params):  # noqa: C901 — a flat route table reads best
        v = self.vault
        route, arg = parts[0], (parts[1] if len(parts) > 1 else None)
        sub = parts[2] if len(parts) > 2 else None
        ok = lambda o=None: self._send(200, o if o is not None else {"ok": True})  # noqa: E731
        nf = lambda: self._send(404, {"error": "not found"})  # noqa: E731

        if route == "status":
            v.tools.refresh()
            c = v.db.one("SELECT count(*) n, sum(file IS NOT NULL) files, "
                         "sum(coalesce(transcript,'') != '') speech FROM items")
            vec = v.db.one("SELECT count(*) n FROM vectors")["n"]
            return ok({"ok": True, "auth": True, "tools": v.tools.status(), "counts": c,
                       "vectors": vec, "semantic": v.embed.enabled(),
                       "semantic_error": v.embed.error, "data_dir": str(v.data_dir),
                       "settings": v.store.settings,
                       "topics": v.db.one("SELECT count(*) n FROM topics")["n"],
                       "phone_url": f"http://{lan_ip()}:{self.port}/reel-vault/?key={v.store.access_key}",
                       "key": v.store.access_key})

        if route == "search":
            return ok(search(v.db, v.store, params, semantic=v.semantic_scores))

        if route == "items" and arg:
            if sub == "related":
                items, terms = related(v, arg)
                return ok({"items": items, "terms": terms})
            if sub == "play":
                return ok({"url": v.play_url(arg)})
            if sub == "topics":
                return ok({"topics": v.db.q(
                    "SELECT t.topic_id, t.label, t.score, p.name FROM topic_items t "
                    "JOIN topics p ON p.id=t.topic_id WHERE t.item_id=?", (arg,))})
            if method == "GET":
                it = v.db.get(arg)
                if it and it.get("segments"):
                    it["segments"] = json.loads(it["segments"])
                return ok(it) if it else nf()
            if method == "PATCH":
                b, upd = self._body(), {}
                if "tags" in b:
                    upd["tags"] = norm_tags(b["tags"])
                if "notes" in b:
                    upd["notes"] = str(b["notes"])[:20000]
                if "starred" in b:
                    upd["starred"] = 1 if b["starred"] else 0
                v.db.update(arg, upd)
                return ok(v.db.get(arg) or {})
            if method == "DELETE":
                return ok({"deleted": v.delete(arg, params.get("keep_file") != "1")})

        if route == "bulk" and method == "POST":
            b = self._body()
            ids = [str(i) for i in (b.get("ids") or [])][:10000]
            action, value = b.get("action"), b.get("value")
            if action in ("tag", "untag"):
                v.tag(ids, value, remove=action == "untag")
            elif action in ("star", "unstar"):
                for i in ids:
                    v.db.update(i, {"starred": 1 if action == "star" else 0})
            elif action == "delete":
                ids = [i for i in ids if v.delete(i, not b.get("keep_files"))]
            elif action in ("download", "analyze"):
                return ok(v.submit(action, {"ids": ids, "analyze": bool(b.get("analyze")),
                                            "title": f"{action} {len(ids)} item(s)"}).to_dict())
            elif action == "vote" and b.get("topic_id"):
                for i in ids:
                    v.vote(b["topic_id"], i, to_int(value))
            else:
                return self._send(400, {"error": "unknown action"})
            return ok({"ok": True, "count": len(ids)})

        if route == "collect" and method == "POST":
            b = self._body()
            if not (b.get("queries") or b.get("urls")):
                return self._send(400, {"error": "nothing to collect"})
            n = len(b.get("queries") or []) + len(b.get("urls") or [])
            b.setdefault("title", f"collect · {n} search(es)/link(s)")
            return ok(v.submit("collect", b).to_dict())

        # ── sources ─────────────────────────────────────────────
        if route == "sources":
            if arg == "presets":
                return ok({"presets": S.PRESETS})
            if arg == "probe" and method == "POST":
                return ok({"candidates": v.probe(self._body().get("text", ""))})
            if not arg:
                if method == "GET":
                    return ok({"sources": v.list_sources()})
                if method == "POST":
                    b = self._body()
                    if b.get("preset"):
                        d = S.source_from_preset(b["preset"], b.get("param", ""))
                        d.update({k: b[k] for k in ("name", "limit_per") if b.get(k)})
                        return ok(v.add_source(d))
                    return ok(v.add_source(b))
            if arg and sub == "test" and method == "POST":
                if not v.get_source(arg):
                    return nf()
                b = self._body()
                return ok(v.submit("test", {"source_id": arg, "query": b.get("query") or "",
                                            "title": f"test source · {b.get('query') or ''}"}).to_dict())
            if arg and method == "PATCH":
                return ok(v.update_source(arg, self._body()))
            if arg and method == "DELETE":
                v.delete_source(arg)
                return ok()

        # ── topics ──────────────────────────────────────────────
        if route == "topics":
            if not arg:
                if method == "GET":
                    return ok({"topics": v.list_topics()})
                if method == "POST":
                    b = self._body()
                    seeds = b.get("seeds") or [b.get("name", "")]
                    t = v.create_topic(b.get("name") or seeds[0], seeds, b.get("settings"),
                                       b.get("sources"))
                    if b.get("run", True):
                        v.submit("topic", {"topic_id": t["id"], "title": f"topic · {t['name']}"})
                        t = v.topic(t["id"])
                    return ok(t)
            t = v.topic(arg)
            if not t:
                return nf()
            if not sub:
                if method == "GET":
                    return ok(t)
                if method == "PATCH":
                    return ok(v.update_topic(arg, self._body()))
                if method == "DELETE":
                    v.delete_topic(arg)
                    return ok()
            if sub == "run" and method == "POST":
                if t["running"]:
                    return self._send(409, {"error": "already running"})
                return ok(v.submit("topic", {"topic_id": arg, "title": f"topic · {t['name']}"}).to_dict())
            if sub == "feed":
                return ok(v.topic_feed(arg, params))
            if sub == "vote" and method == "POST":
                b = self._body()
                return ok({"counts": v.vote(arg, str(b["item_id"]), to_int(b.get("label")))})
            if sub == "insights":
                return ok(v.insights(arg))
            if sub == "queries" and method == "POST":
                b = self._body()
                act, q = b.get("action"), str(b.get("query", "")).strip()
                if not q:
                    return self._send(400, {"error": "empty query"})
                v.set_query(arg, q, enabled=act == "enable" if act in ("enable", "disable") else None,
                            add=act == "add", delete=act == "delete")
                return ok()
            if sub == "follow" and method == "POST":
                b = self._body()
                return ok(v.follow_author(arg, b.get("author", ""), b.get("platform", ""),
                                          b.get("author_url")))
            if sub == "more" and method == "POST":       # "find more like this item"
                b = self._body()
                _, terms = related(v, b["item_id"], limit=1)
                it = v.db.get(b["item_id"]) or {}
                picks = [("#" + h) for h in (it.get("hashtags") or "").split()[:2]] + terms[:3]
                for q in picks:
                    v.set_query(arg, q, add=True)
                v.vote(arg, b["item_id"], 1)
                return ok(v.submit("topic", {"topic_id": arg, "title": f"more like this · {t['name']}"})
                          .to_dict() | {"queries": picks})

        if route == "jobs":
            if not arg:
                jobs = sorted(v.jobs.values(), key=lambda j: -j.created)
                return ok({"jobs": [j.to_dict() for j in jobs]})
            if sub == "cancel" and method == "POST":
                j = v.cancel(arg)
                return ok(j.to_dict()) if j else nf()
            j = v.jobs.get(arg)
            return ok(j.to_dict(True)) if j else nf()

        if route == "understand" and method == "POST":
            return ok(v.submit("understand", {"title": "understand library (semantic)"}).to_dict())

        if route == "synonyms":
            if method == "PUT":
                v.store.save_synonyms(self._body().get("groups") or [])
            return ok({"groups": v.store.groups})

        if route == "settings":
            if arg == "reset-key" and method == "POST":
                v.store.reset_key()
                return ok({"key": v.store.access_key})
            if method == "PUT":
                v.store.save_settings(self._body())
            return ok(v.store.settings)

        if route == "export":
            p = dict(params, limit="500", offset="0")
            rows, off = [], 0
            while True:
                p["offset"] = str(off)
                res = search(v.db, v.store, p)
                rows += res["items"]
                off += 500
                if off >= res["total"] or not res["items"]:
                    break
            if params.get("ids"):
                keep = set(params["ids"].split(","))
                rows = [r for r in rows if r["id"] in keep]
            stamp = time.strftime("%Y%m%d-%H%M")
            fmt = params.get("format")
            if fmt == "csv":
                buf = io.StringIO()
                w = csv.DictWriter(buf, fieldnames=EXPORT_COLS, extrasaction="ignore")
                w.writeheader()
                w.writerows(rows)
                return self._send(200, body=buf.getvalue().encode("utf-8-sig"),
                                  ctype="text/csv; charset=utf-8", headers={
                                      "Content-Disposition": f'attachment; filename="reelvault-{stamp}.csv"'})
            if fmt == "urls":
                return self._send(200, body="\n".join(r["url"] for r in rows if r.get("url")).encode(),
                                  ctype="text/plain; charset=utf-8", headers={
                                      "Content-Disposition": f'attachment; filename="reelvault-{stamp}.txt"'})
            return self._send(200, body=json.dumps(rows, indent=1, default=str).encode(), headers={
                "Content-Disposition": f'attachment; filename="reelvault-{stamp}.json"'})

        return self._send(404, {"error": "no such endpoint"})


def main(argv=None):
    ap = argparse.ArgumentParser(description="REEL//VAULT server")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="0.0.0.0",
                    help="0.0.0.0 = reachable from your phone on the same Wi-Fi (default); "
                         "127.0.0.1 = this computer only")
    ap.add_argument("--data", default=str(APP_DIR / "data"),
                    help="where the database and videos are stored (default: reel-vault/data)")
    ap.add_argument("--allow-origin", action="append", default=[],
                    help="extra web origin allowed to call the API, e.g. https://you.github.io")
    ap.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    a = ap.parse_args(argv)

    data = Path(a.data).expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    Handler.vault = Vault(data)
    Handler.port = a.port
    Handler.allowed_origins = {"https://ptxero.github.io"} | {o.rstrip("/") for o in a.allow_origin}
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    key = Handler.vault.store.access_key
    print("\n  REEL//VAULT")
    print(f"  this computer : http://127.0.0.1:{a.port}/reel-vault/")
    if a.host != "127.0.0.1":
        print(f"  your phone    : http://{lan_ip()}:{a.port}/reel-vault/?key={key}")
        print("                  (same Wi-Fi; or scan the QR code in SETUP on this computer)")
    print(f"  data          : {data}")
    print("  tools         : " + ", ".join(f"{k}={'yes' if x else 'no'}"
                                            for k, x in Handler.vault.tools.status().items()) + "\n")
    if not a.no_browser:
        try:
            import webbrowser
            webbrowser.open(f"http://127.0.0.1:{a.port}/reel-vault/#setup")
        except Exception:        # noqa: BLE001
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
