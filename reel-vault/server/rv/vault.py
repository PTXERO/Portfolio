"""The Vault: storage + background jobs (collect, topic runs, download,
analyze, understand), source management, voting and auto-refresh."""

import importlib.util
import json
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from . import sources as S
from .db import DB, Store, norm_tags
from .embed import Embedder
from .expand import liked_authors, refresh_expansions
from .learn import TopicScorer, pick_queries, prior_score, query_stats
from .search import search
from .util import USER_AGENT, now, safe_name, to_float, to_int


def _tool_cmd(binary, module=None):
    path = shutil.which(binary)
    if path:
        return [path]
    if module and importlib.util.find_spec(module):
        return [sys.executable, "-m", module]
    return None


class Tools:
    def __init__(self):
        self.refresh()

    def refresh(self):
        self.gallery_dl = _tool_cmd("gallery-dl", "gallery_dl")
        self.yt_dlp = _tool_cmd("yt-dlp", "yt_dlp")
        self.ffmpeg = _tool_cmd("ffmpeg")
        self.ffprobe = _tool_cmd("ffprobe")
        self.tesseract = _tool_cmd("tesseract")
        self.whisper = importlib.util.find_spec("faster_whisper") is not None
        self.fastembed = importlib.util.find_spec("fastembed") is not None

    def status(self):
        return {"gallery_dl": bool(self.gallery_dl), "yt_dlp": bool(self.yt_dlp),
                "ffmpeg": bool(self.ffmpeg), "ffprobe": bool(self.ffprobe),
                "whisper": self.whisper, "tesseract": bool(self.tesseract),
                "fastembed": self.fastembed}


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind, params):
        self.id = uuid.uuid4().hex[:10]
        self.kind, self.params = kind, params
        self.state, self.created = "queued", now()
        self.started = self.finished = None
        self.log_lines, self.cancel, self.proc = [], False, None
        self.stats = {"found": 0, "new": 0, "updated": 0, "linked": 0, "downloaded": 0,
                      "analyzed": 0, "skipped": 0, "errors": 0}
        self.done, self.total = 0, 0
        self.title = params.get("title") or kind
        self.topic_id = params.get("topic_id")
        self.result = None

    def log(self, msg):
        self.log_lines.append(time.strftime("%H:%M:%S ") + str(msg).rstrip())
        del self.log_lines[:-500]

    def check(self):
        if self.cancel:
            raise Cancelled()

    def to_dict(self, full=False):
        d = {k: getattr(self, k) for k in ("id", "kind", "title", "state", "created", "started",
                                           "finished", "stats", "done", "total", "topic_id",
                                           "result")}
        d["log"] = self.log_lines if full else self.log_lines[-5:]
        return d


class Ctx:
    """What a source adapter can use."""

    def __init__(self, vault, job, src, opts, label):
        self.v, self.job, self.src, self.opts, self.label = vault, job, src, opts, label

    def log(self, msg):
        self.job.log(msg)

    def gdl_supports(self, url):
        return self.v.gdl_supports(url)

    def gdl(self, url, limit):
        v = self.v
        if not v.tools.gallery_dl:
            raise RuntimeError("gallery-dl is not installed (pip install gallery-dl)")
        cmd = v.tools.gallery_dl + ["-J", "-o", "output.jsonl=true", "-o", "videos=true",
                                    *v.cookie_args(self.src), url]
        got = 0
        for line in v.stream(self.job, cmd):
            line = line.strip()
            if not line.startswith("["):
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if isinstance(msg, list) and len(msg) >= 3 and msg[0] == 3:
                got += 1
                yield msg[1], msg[2]
                if got >= limit * 3:     # files ≠ posts; leave room for filtering
                    break
        if not got:
            v.gdl_diagnose(self.job, url, self.src)

    def ytdlp(self, target, limit, flat=False):
        v = self.v
        if not v.tools.yt_dlp:
            raise RuntimeError("yt-dlp is not installed (pip install yt-dlp)")
        cmd = v.tools.yt_dlp + ["-j", "--no-warnings", "--ignore-errors", "--no-progress",
                                "--playlist-end", str(limit), *v.cookie_args(self.src)]
        if flat:
            cmd.append("--flat-playlist")
        base = cmd + v.impersonate_args(self.src)
        mark = len(self.job.log_lines)
        got = 0
        for info in self._ytdlp_run(base + [target]):
            got += 1
            yield info
        self._explain_redirect(mark)
        # Cloudflare-style bot checks: retry once looking like a normal browser
        blocked = any("impersonat" in ln.lower() or "cloudflare" in ln.lower()
                      for ln in self.job.log_lines[mark:])
        if not got and blocked and not v.impersonate_args(self.src):
            if v.can_impersonate():
                self.job.log("  ↻ site has a bot check: retrying as a normal browser")
                mark2 = len(self.job.log_lines)
                for info in self._ytdlp_run(base + ["--impersonate", "chrome",
                                                    "--extractor-args", "generic:impersonate", target]):
                    yield info
                self._explain_redirect(mark2)
            else:
                self.job.log('  → install browser impersonation once: '
                             'python -m pip install -U "yt-dlp[default,curl-cffi]"  (then restart)')

    REGION_HINT = re.compile(r"Unsupported URL: (\S*(?:block|geo|region|country|restrict|unavailable|"
                             r"not-available|age-verif)\S*)", re.I)

    def _explain_redirect(self, mark):
        """Say plainly when a site sent us to a 'blocked in your region' page."""
        for ln in self.job.log_lines[mark:]:
            m = self.REGION_HINT.search(ln)
            if m:
                self.job.log(f"  ⚑ the site redirected to {m.group(1)} — it blocks visitors from your "
                             "location, so this source can't work from here. Switch it off in SOURCES.")
                return

    def _ytdlp_run(self, cmd):
        for line in self.v.stream(self.job, cmd):
            line = line.strip()
            if line.startswith("{"):
                try:
                    yield json.loads(line)
                except ValueError:
                    pass


class Vault:
    def __init__(self, data_dir: Path, start_threads=True):
        self.data_dir = data_dir
        self.media_dir = data_dir / "media"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.db = DB(data_dir / "vault.db")
        self.store = Store(data_dir)
        self.tools = Tools()
        self.embed = Embedder(self)
        self.jobs: dict[str, Job] = {}
        self.queue: "queue.Queue[Job]" = queue.Queue()
        self._whisper = None
        self._gdl_find = None
        self._ytdlp_ies = None
        self._learn_pending = {}
        self._learn_lock = threading.Lock()
        self._play_cache = {}
        if not self.db.one("SELECT 1 FROM sources LIMIT 1"):
            for key in S.DEFAULT_SOURCES:
                self.add_source(S.source_from_preset(key))
        if start_threads:
            threading.Thread(target=self._worker, daemon=True).start()
            threading.Thread(target=self._learner, daemon=True).start()
            threading.Thread(target=self._scheduler, daemon=True).start()

    # ═════════ jobs ═════════
    def submit(self, kind, params):
        job = Job(kind, params)
        self.jobs[job.id] = job
        for j in sorted(self.jobs.values(), key=lambda j: j.created)[:-60]:
            if j.state not in ("queued", "running"):
                self.jobs.pop(j.id, None)
        self.queue.put(job)
        return job

    def cancel(self, job_id):
        job = self.jobs.get(job_id)
        if job:
            job.cancel = True
            if job.proc and job.proc.poll() is None:
                job.proc.kill()
            if job.state == "queued":
                job.state = "cancelled"
        return job

    def _worker(self):
        while True:
            job = self.queue.get()
            if job.state == "cancelled":
                continue
            job.state, job.started = "running", now()
            try:
                getattr(self, "_run_" + job.kind)(job)
                job.state = "done"
            except Cancelled:
                job.state = "cancelled"
                job.log("cancelled")
            except Exception as e:      # keep the worker alive
                job.state = "error"
                job.log(f"ERROR: {e}")
                job.log(traceback.format_exc(limit=4))
            job.finished = now()
            job.proc = None

    def run_now(self, kind, params):
        """Run a job synchronously (tests / CLI)."""
        job = Job(kind, params)
        self.jobs[job.id] = job
        job.state = "running"
        getattr(self, "_run_" + kind)(job)
        job.state = "done"
        return job

    def cookie_args(self, src=None):
        s = self.store.settings
        if src and (src.get("options") or {}).get("cookies"):
            c = src["options"]["cookies"]
            return ["--cookies", c] if "/" in c or "\\" in c else ["--cookies-from-browser", c]
        if s.get("cookies_file"):
            return ["--cookies", s["cookies_file"]]
        if s.get("cookies_browser"):
            return ["--cookies-from-browser", s["cookies_browser"]]
        return []

    def stream(self, job, cmd, timeout=1800):
        job.log("$ " + " ".join(c if " " not in c else repr(c) for c in cmd[-4:]))
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace", bufsize=1)
        job.proc = proc

        def pump_err():
            for line in proc.stderr:
                if line.strip() and "[info]" not in line:
                    job.log("  " + line.strip()[:300])
        t = threading.Thread(target=pump_err, daemon=True)
        t.start()
        start = time.time()
        try:
            for line in proc.stdout:
                if job.cancel:
                    proc.kill()
                    raise Cancelled()
                if time.time() - start > timeout:
                    proc.kill()
                    job.log("  timed out")
                    break
                yield line
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            t.join(timeout=2)
            job.proc = None

    def gdl_supports(self, url):
        if self._gdl_find is None:
            try:
                from gallery_dl import extractor
                self._gdl_find = extractor.find
            except ImportError:
                self._gdl_find = False
        if self._gdl_find:
            try:
                ex = self._gdl_find(url)
                return ex is not None and ex.__class__.__name__ != "DirectlinkExtractor"
            except Exception:    # noqa: BLE001
                return False
        return S.domain_of(url) in S.X_HOSTS

    def can_impersonate(self):
        return importlib.util.find_spec("curl_cffi") is not None

    def impersonate_args(self, src=None):
        """Per-source option: always look like a normal browser."""
        if src and (src.get("options") or {}).get("impersonate") and self.can_impersonate():
            return ["--impersonate", "chrome", "--extractor-args", "generic:impersonate"]
        return []

    def ytdlp_supports(self, url):
        if self._ytdlp_ies is None:
            try:
                from yt_dlp.extractor import gen_extractor_classes
                self._ytdlp_ies = [c for c in gen_extractor_classes() if c.IE_NAME != "generic"]
            except ImportError:
                self._ytdlp_ies = []
        try:
            return any(c.suitable(url) for c in self._ytdlp_ies if c.working())
        except Exception:        # noqa: BLE001
            return False

    def gdl_diagnose(self, job, url, src=None):
        """JSONL mode hides extractor errors (e.g. login required)."""
        cmd = self.tools.gallery_dl + ["-J", "--range", "1", "-o", "videos=true",
                                       *self.cookie_args(src), url]
        try:
            msgs = json.loads(subprocess.run(cmd, capture_output=True, text=True,
                                             timeout=90).stdout or "[]")
        except (subprocess.SubprocessError, ValueError, OSError):
            return
        for m in msgs:
            if isinstance(m, list) and m and m[0] == -1 and len(m) > 1:
                err = m[1] if isinstance(m[1], dict) else {"message": str(m[1])}
                job.stats["errors"] += 1
                msg = f"{err.get('error', 'error')}: {err.get('message', '')}"
                job.log(f"  ✕ {msg}")
                if src and src.get("id"):
                    self.db.exec("UPDATE sources SET last_error=? WHERE id=?", (msg[:300], src["id"]))
                if err.get("error") == "AuthRequired" or "cookie" in str(err.get("message")).lower():
                    job.log("  → this site needs a login: set cookies in SETUP")
                return

    # ═════════ sources ═════════
    def list_sources(self):
        rows = self.db.q("SELECT * FROM sources ORDER BY created")
        for r in rows:
            r["options"] = json.loads(r["options"] or "{}")
            r["searchable"] = S.is_searchable(r)
        return rows

    def get_source(self, sid):
        r = self.db.one("SELECT * FROM sources WHERE id=?", (sid,))
        if r:
            r["options"] = json.loads(r["options"] or "{}")
            r["searchable"] = S.is_searchable(r)
        return r

    def add_source(self, d):
        if d.get("kind") not in S.ADAPTERS:
            raise ValueError(f"unknown source kind {d.get('kind')}")
        if d["kind"] in ("template", "url", "rss") and not (d.get("template") or "").startswith("http"):
            raise ValueError("this source needs a full http(s) URL")
        sid = uuid.uuid4().hex[:8]
        self.db.exec("INSERT INTO sources(id, name, kind, template, engine, enabled, limit_per,"
                     " needs_login, preset, options, created) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     (sid, (d.get("name") or d["kind"])[:80], d["kind"], d.get("template") or "",
                      d.get("engine") or "auto", 1 if d.get("enabled", True) else 0,
                      max(1, min(to_int(d.get("limit_per"), 20), 500)),
                      1 if d.get("needs_login") else 0, d.get("preset"),
                      json.dumps(d.get("options") or {}), now()))
        return self.get_source(sid)

    def update_source(self, sid, d):
        f = {}
        for k in ("name", "template", "engine"):
            if k in d:
                f[k] = str(d[k])
        if "enabled" in d:
            f["enabled"] = 1 if d["enabled"] else 0
        if "limit_per" in d:
            f["limit_per"] = max(1, min(to_int(d["limit_per"], 20), 500))
        if "options" in d:
            f["options"] = json.dumps(d["options"] or {})
        if f:
            self.db.exec(f"UPDATE sources SET {', '.join(k + '=?' for k in f)} WHERE id=?",
                         list(f.values()) + [sid])
        return self.get_source(sid)

    def delete_source(self, sid):
        self.db.exec("DELETE FROM sources WHERE id=?", (sid,))

    def probe(self, text):
        return S.probe(text, self.gdl_supports, self.ytdlp_supports)

    # ═════════ collecting ═════════
    def accept(self, item, opts):
        if not item or not item.get("id"):
            return False
        mode = opts.get("media", "video")
        m = item.get("media") or "video"
        return m == "video" or (mode == "all" and m == "image") or mode == "everything"

    def fetch(self, job, src, query, limit, opts):
        """Run one source for one query; yields accepted items (already saved)."""
        label = f"{src['name']}" + (f" · {query}" if query else "")
        ctx = Ctx(self, job, src, opts, label)
        adapter = S.ADAPTERS[src["kind"]]
        got, seen, err = 0, set(), ""
        try:
            for item in adapter(ctx, src, query, limit):
                job.check()
                if not self.accept(item, opts) or item["id"] in seen:
                    continue
                seen.add(item["id"])
                res = self.db.upsert(item)
                job.stats["found"] += 1
                job.stats[res] += 1
                got += 1
                yield item
                if got >= limit:
                    break
        except Cancelled:
            raise
        except Exception as e:          # noqa: BLE001 — one bad source must not stop the run
            err = str(e)[:300]
            job.stats["errors"] += 1
            job.log(f"  ✕ {label}: {err}")
        if src.get("id"):
            self.db.exec("UPDATE sources SET last_run=?, last_found=? WHERE id=?",
                         (now(), got, src["id"]))
            if err or got:          # clear an old error once a run succeeds
                self.db.exec("UPDATE sources SET last_error=? WHERE id=?", (err, src["id"]))
        job.log(f"  {got} from {label}")

    def _run_collect(self, job):
        """Ad-hoc: sources × queries, plus pasted links."""
        p = job.params
        opts = {k: p.get(k) for k in ("media", "min_likes", "since", "lang", "search_tab",
                                      "exclude_replies")}
        opts["media"] = opts["media"] or "video"
        srcs = [self.get_source(s) for s in p.get("source_ids") or []] or \
            [s for s in self.list_sources() if s["enabled"] and s["searchable"]]
        queries = [q for q in p.get("queries") or [] if q.strip()]
        links = [u for u in p.get("urls") or [] if u.strip()]
        limit = max(1, min(to_int(p.get("limit"), 20), 2000))
        job.total = len(queries) * len(srcs) + len(links)
        new_ids = []
        for q in queries:
            for s in srcs:
                job.check()
                for it in self.fetch(job, s, q, limit, opts):
                    new_ids.append(it["id"])
                job.done += 1
        for u in links:
            job.check()
            src = {"name": S.domain_of(u), "kind": "url", "template": u,
                   "engine": "gallery-dl" if S.domain_of(u) in S.X_HOSTS else "auto"}
            for it in self.fetch(job, src, "", limit, dict(opts, media=opts["media"])):
                new_ids.append(it["id"])
            job.done += 1
        job.result = {"ids": new_ids[:500]}
        self.embed.ensure(new_ids, job.log, job.check)
        if p.get("download") and new_ids:
            self._download_many(job, new_ids, p.get("analyze"))

    def _run_test(self, job):
        src = self.get_source(job.params["source_id"])
        q = job.params.get("query") or "cat"
        items = list(self.fetch(job, src, q if src["searchable"] else "", 5,
                                {"media": "all"}))
        job.result = {"count": len(items), "items": [
            {k: it.get(k) for k in ("id", "text", "thumbnail", "media", "url", "author")}
            for it in items[:5]]}

    # ═════════ topics ═════════
    TOPIC_DEFAULTS = {"breadth": 3, "media": "video", "refresh_hours": 0, "per_query": 15,
                      "queries_per_run": 0, "auto_download": 0, "web": True, "soft": [], "creators": {},
                      "anti": [], "prefs": {}, "reasons_recent": []}

    def topic(self, tid):
        t = self.db.one("SELECT * FROM topics WHERE id=?", (tid,))
        if t:
            t["seeds"] = json.loads(t["seeds"] or "[]")
            t["sources"] = json.loads(t["sources"] or "[]")
            t["settings"] = dict(self.TOPIC_DEFAULTS, **json.loads(t["settings"] or "{}"))
            t["model"] = json.loads(t["model"] or "{}")
            c = self.db.one("""SELECT count(*) n, sum(label=1) pos, sum(label=-1) neg,
                               sum(label=0) unrated, sum(label=0 AND score>=0.5) good
                               FROM topic_items WHERE topic_id=?""", (tid,))
            t["counts"] = {k: c[k] or 0 for k in c}
            t["running"] = any(j.topic_id == tid and j.state in ("queued", "running")
                               for j in self.jobs.values())
        return t

    def list_topics(self):
        return [self.topic(r["id"]) for r in
                self.db.q("SELECT id FROM topics ORDER BY coalesce(last_run, created) DESC")]

    def create_topic(self, name, seeds=None, settings=None, sources=None):
        seeds = [s.strip() for s in (seeds or [name]) if s and s.strip()]
        if not seeds:
            raise ValueError("a topic needs at least one word")
        tid = uuid.uuid4().hex[:8]
        st = dict(self.TOPIC_DEFAULTS, **(settings or {}))
        self.db.exec("INSERT INTO topics(id, name, seeds, sources, settings, created) VALUES (?,?,?,?,?,?)",
                     (tid, (name or seeds[0]).strip()[:80], json.dumps(seeds),
                      json.dumps(sources or []), json.dumps(st), now()))
        ts = now()
        self.db.many("INSERT OR IGNORE INTO topic_queries(topic_id, query, origin, enabled, weight, created)"
                     " VALUES (?,?,?,?,?,?)", [(tid, s, "seed", 1, 1.0, ts) for s in seeds])
        return self.topic(tid)

    def update_topic(self, tid, d):
        t = self.topic(tid)
        if not t:
            return None
        f = {}
        if "name" in d:
            f["name"] = str(d["name"])[:80]
        if "seeds" in d:
            seeds = [s.strip() for s in d["seeds"] if s.strip()]
            f["seeds"] = json.dumps(seeds)
            ts = now()
            self.db.many("INSERT OR IGNORE INTO topic_queries(topic_id, query, origin, enabled, weight,"
                         " created) VALUES (?,?,?,?,?,?)", [(tid, s, "seed", 1, 1.0, ts) for s in seeds])
            self.db.exec("UPDATE topic_queries SET origin='user' WHERE topic_id=? AND origin='seed' "
                         f"AND query NOT IN ({','.join('?' * len(seeds))})", [tid] + seeds)
        if "sources" in d:
            f["sources"] = json.dumps(list(d["sources"] or []))
        if "settings" in d:
            f["settings"] = json.dumps(dict(t["settings"], **(d["settings"] or {})))
        if f:
            self.db.exec(f"UPDATE topics SET {', '.join(k + '=?' for k in f)} WHERE id=?",
                         list(f.values()) + [tid])
        return self.topic(tid)

    def delete_topic(self, tid):
        for tbl in ("topic_items", "topic_hits", "topic_queries"):
            self.db.exec(f"DELETE FROM {tbl} WHERE topic_id=?", (tid,))
        self.db.exec("DELETE FROM topics WHERE id=?", (tid,))

    def set_query(self, tid, query, enabled=None, add=False, delete=False):
        if add:
            self.db.exec("INSERT OR IGNORE INTO topic_queries(topic_id, query, origin, enabled, weight, created)"
                         " VALUES (?,?,?,?,?,?)", (tid, query.strip(), "user", 1, 1.0, now()))
            self.db.exec("UPDATE topic_queries SET enabled=1 WHERE topic_id=? AND query=?",
                         (tid, query.strip()))
        elif delete:
            self.db.exec("DELETE FROM topic_queries WHERE topic_id=? AND query=? AND origin != 'seed'",
                         (tid, query))
        elif enabled is not None:
            self.db.exec("UPDATE topic_queries SET enabled=?, locked=1 WHERE topic_id=? AND query=?",
                         (1 if enabled else 0, tid, query))
        self.relearn(tid, delay=0.2)

    def link(self, tid, item_id, query, source_id):
        self.db.exec("INSERT OR IGNORE INTO topic_items(topic_id, item_id, added) VALUES (?,?,?)",
                     (tid, item_id, now()))
        self.db.exec("INSERT OR IGNORE INTO topic_hits(topic_id, item_id, query, source_id) VALUES (?,?,?,?)",
                     (tid, item_id, query, source_id or ""))

    def topic_sources(self, t):
        all_src = self.list_sources()
        if t["sources"]:
            chosen = [s for s in all_src if s["id"] in t["sources"]]
        else:
            chosen = [s for s in all_src if s["enabled"] and s["searchable"]]
        feeds = [s for s in all_src if not s["searchable"] and s["enabled"] and
                 (s["id"] in t["sources"] or s["options"].get("topic") == t["id"])]
        return [s for s in chosen if s["searchable"]], feeds

    def _run_topic(self, job):
        tid = job.params["topic_id"]
        t = self.topic(tid)
        if not t:
            raise RuntimeError("topic was deleted")
        st = t["settings"]
        breadth = to_int(st.get("breadth"), 3)
        job.log(f"◎ {t['name']}: growing searches (breadth {breadth})")
        refresh_expansions(self, tid, web=True)
        stats = query_stats(self.db, tid)
        k = to_int(st.get("queries_per_run")) or (3 + 2 * breadth)
        queries = pick_queries(stats, k)
        searchable, feeds = self.topic_sources(t)
        opts = {"media": st.get("media", "video"), "search_tab": st.get("search_tab"),
                "min_likes": st.get("min_likes"), "lang": st.get("lang")}
        per = max(1, min(to_int(st.get("per_query"), 15), 200))
        job.total = len(queries) * len(searchable) + len(feeds) + 2
        job.log(f"  {len(queries)} searches × {len(searchable)} sources: " + ", ".join(queries))
        new = []
        for q in queries:
            found_q = 0
            for s in searchable:
                job.check()
                for it in self.fetch(job, s, q, per, opts):
                    self.link(tid, it["id"], q, s["id"])
                    new.append(it["id"])
                    found_q += 1
                job.done += 1
            self.db.exec("UPDATE topic_queries SET runs=runs+1, found=found+?, last_run=? "
                         "WHERE topic_id=? AND query=?", (found_q, now(), tid, q))
            if found_q:      # score as we go so the review deck is ranked while searching
                TopicScorer(self, tid).rescore()

        # feeds you follow for this topic: keep what matches
        if feeds:
            sc = TopicScorer(self, tid)
            for s in feeds:
                job.check()
                for it in self.fetch(job, s, "", s["limit_per"], opts):
                    pr, _ = prior_score(it, sc.qterms)
                    if pr > 0.05 or s["options"].get("topic") == tid:
                        self.link(tid, it["id"], "", s["id"])
                        new.append(it["id"])
                job.done += 1

        # library sweep: things already collected that fit
        swept = 0
        for q in [r["query"] for r in stats if r["enabled"]]:
            res = search(self.db, self.store, {"q": q, "limit": "120", "fuzzy": "0",
                                               "media": "video,image" if opts["media"] != "video"
                                               else "video"})
            for it in res["items"]:
                self.link(tid, it["id"], q, "library")
                swept += 1
        job.done += 1
        self.embed.ensure(None, job.log, job.check)
        if self.embed.ready():
            sc = TopicScorer(self, tid)
            vec = sc.pos_vec if sc.pos_vec is not None else sc.seed_vec
            for iid in self.embed.nearest(vec, top=120, min_sim=0.6):
                self.link(tid, iid, "meaning", "library")
                swept += 1
        job.log(f"  + {swept} matches from your library")
        n = TopicScorer(self, tid).rescore()
        job.stats["linked"] = n
        job.done += 1
        self.db.exec("UPDATE topics SET last_run=? WHERE id=?", (now(), tid))
        dl = to_int(st.get("auto_download"))
        if dl:
            ids = [r["item_id"] for r in self.db.q(
                "SELECT t.item_id FROM topic_items t JOIN items i ON i.id=t.item_id WHERE t.topic_id=? "
                "AND t.label>=0 AND i.file IS NULL ORDER BY t.label DESC, t.score DESC LIMIT ?",
                (tid, dl))]
            self._download_many(job, ids)
        job.result = {"topic_id": tid, "new": len(set(new)), "queries": queries}

    def vote(self, tid, item_id, label):
        label = 1 if label > 0 else -1 if label < 0 else 0
        self.db.exec("INSERT OR IGNORE INTO topic_items(topic_id, item_id, added) VALUES (?,?,?)",
                     (tid, item_id, now()))
        self.db.exec("UPDATE topic_items SET label=?, labeled_at=? WHERE topic_id=? AND item_id=?",
                     (label, now(), tid, item_id))
        self.relearn(tid)
        return self.db.one("SELECT count(*) n, sum(label=1) pos, sum(label=-1) neg FROM topic_items "
                           "WHERE topic_id=?", (tid,))

    # Built-in downvote reasons → signals the scorer understands. "unrelated"
    # and "dislike" are just a normal 👎 (the model learns the item's features);
    # the others set a durable preference or a negative keyword for the topic.
    REASON_PREFS = {"short": "avoid_short", "long": "avoid_long", "ai": "no_ai", "ad": "no_ads"}
    REASON_ANTI = {"ai": ["ai", "aigenerated", "generated", "midjourney", "sora", "veo"],
                   "ad": ["ad", "ads", "advert", "sponsored", "promo", "discount", "sale"]}

    def apply_reasons(self, tid, item_id, reasons, vote=-1):
        """Record why an item was rejected and turn it into learning signal.
        Built-in reasons set prefs/anti-keywords; any other text becomes a
        user anti-keyword for this topic. Everything here is user-chosen."""
        t = self.topic(tid)
        if not t:
            return None
        st = t["settings"]
        prefs = dict(st.get("prefs") or {})
        anti = list(st.get("anti") or [])
        recent = list(st.get("reasons_recent") or [])
        for r in reasons or []:
            key = re.sub(r"[^a-z0-9 ]", "", str(r).strip().lower())
            if not key:
                continue
            if key in self.REASON_PREFS:
                prefs[self.REASON_PREFS[key]] = True
                for w in self.REASON_ANTI.get(key, []):
                    if w not in anti:
                        anti.append(w)
            elif key in ("unrelated", "dislike", "notmytype", "low quality", "lowquality"):
                pass          # the 👎 itself teaches this
            else:             # custom word the user typed (e.g. a theme they don't want)
                for w in key.split():
                    if len(w) > 1 and w not in anti:
                        anti.append(w)
                recent = [key] + [x for x in recent if x != key]
        self.update_topic(tid, {"settings": {"prefs": prefs, "anti": anti[:60],
                                              "reasons_recent": recent[:12]}})
        if vote is not None:
            self.vote(tid, item_id, vote)
        else:
            self.relearn(tid)
        return {"prefs": prefs, "anti": anti, "reasons_recent": recent[:12]}

    def clear_reason(self, tid, anti=None, pref=None):
        """Remove a reason-based filter (an anti-keyword or a preference)."""
        t = self.topic(tid)
        st = t["settings"]
        upd = {}
        if anti is not None:
            upd["anti"] = [w for w in (st.get("anti") or []) if w != anti]
        if pref is not None:
            prefs = dict(st.get("prefs") or {})
            prefs.pop(pref, None)
            upd["prefs"] = prefs
        if upd:
            self.update_topic(tid, {"settings": upd})
            self.relearn(tid)

    def relearn(self, tid, delay=0.8):
        with self._learn_lock:
            self._learn_pending[tid] = time.time() + delay

    def _learner(self):
        """Retrain topic models shortly after votes (debounced, off the request thread)."""
        votes_seen = {}
        while True:
            time.sleep(0.25)
            due = []
            with self._learn_lock:
                for tid, at in list(self._learn_pending.items()):
                    if time.time() >= at:
                        due.append(tid)
                        del self._learn_pending[tid]
            for tid in due:
                try:
                    if not self.db.one("SELECT 1 FROM topics WHERE id=?", (tid,)):
                        continue
                    n = (self.db.one("SELECT count(*) n FROM topic_items WHERE topic_id=? AND label!=0",
                                     (tid,)) or {}).get("n", 0)
                    if n and n // 5 != votes_seen.get(tid, 0) // 5:
                        refresh_expansions(self, tid, web=False)   # every 5 votes
                    votes_seen[tid] = n
                    TopicScorer(self, tid).rescore()
                except Exception:       # noqa: BLE001
                    traceback.print_exc()

    def _scheduler(self):
        """Auto-refresh topics on their schedule."""
        while True:
            time.sleep(60)
            try:
                for t in self.db.q("SELECT id, name, settings, last_run, created FROM topics"):
                    h = to_float(json.loads(t["settings"] or "{}").get("refresh_hours")) or 0
                    if h <= 0 or now() < (t["last_run"] or t["created"]) + h * 3600:
                        continue
                    if any(j.topic_id == t["id"] and j.state in ("queued", "running")
                           for j in self.jobs.values()):
                        continue
                    self.submit("topic", {"topic_id": t["id"], "title": f"auto-refresh · {t['name']}"})
            except Exception:           # noqa: BLE001
                traceback.print_exc()

    def topic_feed(self, tid, p):
        """Items of a topic. view: review (smart order) | feed | liked | nope."""
        view = p.get("view", "feed")
        limit = max(1, min(to_int(p.get("limit"), 30), 200))
        offset = max(0, to_int(p.get("offset"), 0))
        label = {"review": 0, "liked": 1, "nope": -1}.get(view)
        where, params = "t.topic_id=?", [tid]
        if label is not None:
            where += " AND t.label=?"
            params.append(label)
        if p.get("min_score"):
            where += " AND t.score >= ?"
            params.append(to_float(p["min_score"]) or 0)
        if p.get("skip"):
            skip = p["skip"].split(",")[:500]
            where += f" AND t.item_id NOT IN ({','.join('?' * len(skip))})"
            params += skip
        total = self.db.one(f"SELECT count(*) n FROM topic_items t WHERE {where}", params)["n"]
        if view == "review":
            # active learning: mostly best guesses, some uncertain ones (teach the most)
            best = self.db.q(f"SELECT t.* FROM topic_items t WHERE {where} ORDER BY t.score DESC "
                             f"LIMIT ?", params + [limit])
            unsure = self.db.q(f"SELECT t.* FROM topic_items t WHERE {where} "
                               f"ORDER BY abs(t.score - 0.5) ASC LIMIT ?", params + [limit])
            rows, seen = [], set()
            bi, ui = iter(best), iter(unsure)
            while len(rows) < limit:
                progressed = False
                for src_iter, take in ((bi, 3), (ui, 1)):
                    for _ in range(take):
                        r = next(src_iter, None)
                        if r and r["item_id"] not in seen:
                            seen.add(r["item_id"])
                            rows.append(r)
                            progressed = True
                if not progressed:
                    break
            rows = rows[:limit]
        else:
            order = {"newest": "i.posted_at DESC", "added": "t.added DESC",
                     "likes": "i.likes DESC"}.get(p.get("sort"), "t.score DESC")
            rows = self.db.q(f"SELECT t.* FROM topic_items t JOIN items i ON i.id=t.item_id "
                             f"WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
                             params + [limit, offset])
        items = self.db.get_many(r["item_id"] for r in rows)
        hits = {}
        if rows:
            ids = [r["item_id"] for r in rows]
            for h in self.db.q(f"SELECT item_id, query, source_id FROM topic_hits WHERE topic_id=? "
                               f"AND item_id IN ({','.join('?' * len(ids))})", [tid] + ids):
                hits.setdefault(h["item_id"], []).append(h)
        srcnames = {s["id"]: s["name"] for s in self.list_sources()}
        out = []
        for r in rows:
            it = items.get(r["item_id"])
            if not it:
                continue
            it.pop("segments", None)
            it["t_score"], it["t_label"] = r["score"], r["label"]
            it["why"] = json.loads(r["why"] or "{}")
            it["found_by"] = [{"query": h["query"], "source": srcnames.get(h["source_id"], h["source_id"])}
                              for h in hits.get(r["item_id"], [])][:6]
            out.append(it)
        return {"total": total, "items": out}

    def insights(self, tid):
        sc = TopicScorer(self, tid)
        pos, neg = sc.top_features(20)
        return {"queries": query_stats(self.db, tid), "likes": pos, "dislikes": neg,
                "authors": liked_authors(self.db, tid), "n_pos": sc.n_pos, "n_neg": sc.n_neg,
                "creators": list((self.topic(tid)["settings"].get("creators") or {}).values()),
                "anti": self.topic(tid)["settings"].get("anti") or [],
                "prefs": self.topic(tid)["settings"].get("prefs") or {},
                "model": "classifier + profile" if sc.w else "profile" if sc.n_pos + sc.n_neg else
                "matching only", "semantic": bool(sc.sem)}

    def follow_author(self, tid, author, platform, author_url=None):
        """Turn a creator you keep liking into a followed feed for this topic."""
        tpl, engine, kind = author_url, "auto", "url"
        if platform == "x":
            tpl, engine = f"https://x.com/{author}/media", "gallery-dl"
        elif platform == "mastodon" and author_url:
            tpl, kind = author_url.rstrip("/") + ".rss", "rss"
        elif platform == "youtube" and author_url:
            tpl, engine = author_url.rstrip("/") + "/videos", "yt-dlp"
        elif platform == "reddit":
            tpl, engine = f"https://www.reddit.com/user/{author}/submitted/", "gallery-dl"
        if not tpl:
            raise ValueError("don't know this creator's page")
        return self.add_source({"name": f"@{author} ({platform})", "kind": kind, "template": tpl,
                                "engine": engine, "options": {"topic": tid}, "limit_per": 30})

    @staticmethod
    def _creator_profile(items):
        """Everything we can measure about a creator from their collected posts,
        to improve the topic: what they post about, cadence, timing, length…"""
        import datetime
        import statistics
        from collections import Counter
        from .util import light_stem, tokens
        posts = [it for it in items if it]
        n = len(posts)
        if not n:
            return {"posts": 0}
        tags, words, hours, dows, langs, plats = (Counter() for _ in range(6))
        durs, times, likes, views = [], [], [], []
        for it in posts:
            for h in (it.get("hashtags") or "").split():
                tags[h.lower()] += 1
            for w in tokens(it.get("text")):
                if len(w) > 2 and not w.isdigit():
                    words[light_stem(w)] += 1
            if it.get("lang"):
                langs[it["lang"]] += 1
            if it.get("platform"):
                plats[it["platform"]] += 1
            if it.get("posted_at"):
                d = datetime.datetime.utcfromtimestamp(it["posted_at"])
                times.append(it["posted_at"])
                hours[d.hour] += 1
                dows[d.strftime("%a")] += 1
            if it.get("duration"):
                durs.append(it["duration"])
            likes.append(it.get("likes") or 0)
            if it.get("views"):
                views.append(it["views"])
        span = (max(times) - min(times)) / 86400 if len(times) > 1 else 0
        DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        return {
            "posts": n,
            "top_hashtags": [h for h, _ in tags.most_common(8)],
            "top_words": [w for w, _ in words.most_common(12)],
            "active_hours_utc": sorted(h for h, _ in hours.most_common(3)),
            "active_days": [d for d in DOW if d in dict(dows.most_common(3))],
            "languages": [lang for lang, _ in langs.most_common(3)],
            "platforms": [p for p, _ in plats.most_common()],
            "avg_duration": round(statistics.mean(durs), 1) if durs else None,
            "median_likes": int(statistics.median(likes)) if likes else 0,
            "median_views": int(statistics.median(views)) if views else 0,
            "first_post": min(times) if times else None,
            "last_post": max(times) if times else None,
            "span_days": round(span, 1),
            "per_week": round(n / (span / 7), 1) if span >= 7 else None,
        }

    def _run_creator(self, job):
        p = job.params
        tid = p["topic_id"]
        handle, platform, aurl = p["handle"], p.get("platform", "x"), p.get("author_url")
        job.title = f"profile @{handle}"
        job.log(f"◎ learning @{handle} ({platform}) for this topic")
        job.total = 3
        src = self.follow_author(tid, handle, platform, aurl)
        job.done = 1
        job.log("  collecting their recent posts…")
        items = list(self.fetch(job, self.get_source(src["id"]),
                                "", 40, {"media": self.topic(tid)["settings"].get("media", "video")}))
        for it in items:
            self.link(tid, it["id"], "", src["id"])
        job.done = 2
        prof = self._creator_profile(items)
        t = self.topic(tid)
        st = t["settings"]
        # feed what they post about into the topic as soft signal + searches
        soft = list(dict.fromkeys((st.get("soft") or []) + prof.get("top_hashtags", [])[:4]))
        creators = dict(st.get("creators") or {})
        creators[handle.lower()] = dict(prof, handle=handle, platform=platform,
                                        source_id=src["id"], added=now())
        self.update_topic(tid, {"settings": {"soft": soft, "creators": creators}})
        self.set_query(tid, "@" + handle.lstrip("@"), add=True)
        for h in prof.get("top_hashtags", [])[:3]:
            self.set_query(tid, "#" + h.lstrip("#"), add=True)
        self.embed.ensure([it["id"] for it in items], job.log, job.check)
        TopicScorer(self, tid).rescore()
        job.done = 3
        job.result = {"handle": handle, "platform": platform, "collected": len(items), "profile": prof}
        job.log(f"  done: {len(items)} posts, {len(prof.get('top_hashtags', []))} hashtags learned")

    def remove_creator(self, tid, handle):
        t = self.topic(tid)
        creators = dict(t["settings"].get("creators") or {})
        c = creators.pop(handle.lower(), None)
        self.update_topic(tid, {"settings": {"creators": creators}})
        if c and c.get("source_id"):
            self.delete_source(c["source_id"])

    def set_creator_meta(self, tid, handle, notes=None, attrs=None):
        """User's own labels on a creator. `attrs` is a list of {k, v, boost}
        the user types (gender, sexuality, politics, region, vibe… — anything).
        Nothing is inferred. Attribute values marked boost feed the topic's
        soft keywords so they cater the search and ranking."""
        t = self.topic(tid)
        creators = dict(t["settings"].get("creators") or {})
        c = creators.get(handle.lower())
        if not c:
            return None
        if notes is not None:
            c["notes"] = str(notes)[:4000]
        if attrs is not None:
            clean = []
            for a in attrs[:40]:
                k = str(a.get("k", "")).strip()[:40]
                val = str(a.get("v", "")).strip()[:120]
                if k or val:
                    clean.append({"k": k, "v": val, "boost": a.get("boost", True) is not False})
            c["attrs"] = clean
        self.update_topic(tid, {"settings": {"creators": creators}})
        self._apply_creator_attrs(tid)
        return c

    def _apply_creator_attrs(self, tid):
        """Merge creators' boosting attribute values into the topic's soft
        keywords, so the user's labels actually shape search + ranking."""
        t = self.topic(tid)
        st = t["settings"]
        creators = st.get("creators") or {}
        from_attrs = []
        for c in creators.values():
            for a in c.get("attrs") or []:
                if a.get("boost") and a.get("v"):
                    # split multi-word values into terms (e.g. "left leaning" → both)
                    for term in [a["v"].strip()] + a["v"].split():
                        term = term.strip().lower()
                        if len(term) > 1 and term not in from_attrs:
                            from_attrs.append(term)
        # kept separate from the user's manual soft keywords so the two never
        # clobber each other; the scorer and expansion read both lists
        self.update_topic(tid, {"settings": {"_attr_soft": from_attrs}})
        TopicScorer(self, tid).rescore()

    # ═════════ playback / download / analyze ═════════
    def resolve_play(self, item_id):
        """Return (url, headers) for an item's video so the server can fetch
        and stream it. Resolves via yt-dlp when there is no direct media URL,
        and keeps any request headers the host needs (referer, cookies…)."""
        it = self.db.get(item_id)
        if not it:
            return None, {}
        c = self._play_cache.get(item_id)
        if c and c[2] > time.time():
            return c[0], c[1]
        url, headers = None, {}
        if it.get("media_url") and it["media_url"].startswith("http"):
            url = it["media_url"]
        elif self.tools.yt_dlp and it.get("url"):
            # -j gives the chosen format's url AND the http_headers it needs
            try:
                out = subprocess.run(self.tools.yt_dlp + [
                    "-j", "--no-warnings", "--no-playlist", "-f",
                    "b[ext=mp4][vcodec^=avc1][acodec!=none]/b[ext=mp4][acodec!=none]/18/b[acodec!=none]/b",
                    *self.cookie_args(), *self.impersonate_args(),
                    it["url"]], capture_output=True, text=True, timeout=90).stdout
                info = json.loads(out.splitlines()[0]) if out.strip() else {}
                url = info.get("url")
                headers = info.get("http_headers") or {}
            except (subprocess.SubprocessError, ValueError, OSError, IndexError):
                url = None
        if url:
            self._play_cache[item_id] = (url, headers, time.time() + 2400)
        return url, headers

    def play_url(self, item_id):
        url, _ = self.resolve_play(item_id)
        return url

    def open_stream(self, item_id, rng=None, retried=False):
        """Open the upstream video (optionally a byte range) for proxying to
        the phone. Returns the urllib response, or None."""
        url, headers = self.resolve_play(item_id)
        if not url:
            return None
        h = {"User-Agent": USER_AGENT}
        h.update(headers)
        if rng:
            h["Range"] = rng
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError):
            if not retried:         # a stale signed URL: resolve fresh once
                self._play_cache.pop(item_id, None)
                return self.open_stream(item_id, rng, retried=True)
            return None

    def _run_download(self, job):
        self._download_many(job, job.params.get("ids") or [], job.params.get("analyze"))

    def _download_many(self, job, ids, analyze=False):
        job.total, job.done = len(ids), 0
        job.log(f"downloading {len(ids)} item(s)")
        for item_id in ids:
            job.check()
            try:
                if self.download(job, item_id):
                    job.stats["downloaded"] += 1
                    if analyze:
                        self.analyze(job, item_id)
                        job.stats["analyzed"] += 1
                else:
                    job.stats["skipped"] += 1
            except Cancelled:
                raise
            except Exception as e:      # noqa: BLE001
                job.stats["errors"] += 1
                job.log(f"  {item_id}: {e}")
            job.done += 1

    def download(self, job, item_id) -> bool:
        it = self.db.get(item_id)
        if not it:
            return False
        if it.get("file") and (self.media_dir / it["file"]).exists():
            return False
        out_dir = self.media_dir / safe_name(it["platform"]) / safe_name(it["author"] or "unknown")
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = safe_name(it["id"].split(":", 1)[-1])
        direct = it.get("media_url") and it["media_url"].startswith("http")
        if direct:
            ext = (it["media_url"].split("?")[0].rsplit(".", 1)[-1].lower()
                   if "." in it["media_url"].split("?")[0][-6:] else "")
            if ext not in S.VIDEO_EXT + S.IMAGE_EXT:
                ext = "mp4" if it.get("media") == "video" else "jpg"
            dest = out_dir / f"{stem}.{ext}"
            job.log(f"  ↓ {it['id']} (direct)")
            self._fetch(job, it["media_url"], dest)
        else:
            if not self.tools.yt_dlp:
                raise RuntimeError("yt-dlp is required to download this item")
            job.log(f"  ↓ {it['id']} (yt-dlp)")
            cmd = self.tools.yt_dlp + [
                "--no-warnings", "--no-progress", "--no-playlist",
                # H.264/AAC first: plays everywhere, including iPhone
                "-f", "bv*[vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
                "--merge-output-format", "mp4",
                "-o", str(out_dir / (stem + ".%(ext)s")), *self.cookie_args(), it["url"]]
            mark = len(job.log_lines)
            for _ in self.stream(job, cmd, timeout=3600):
                pass
            if not list(out_dir.glob(stem + ".*")) and self.can_impersonate() and any(
                    "impersonat" in ln.lower() or "cloudflare" in ln.lower() for ln in job.log_lines[mark:]):
                job.log("  ↻ bot check: retrying as a normal browser")
                for _ in self.stream(job, cmd[:-1] + ["--impersonate", "chrome", "--extractor-args",
                                                      "generic:impersonate", cmd[-1]], timeout=3600):
                    pass
            found = sorted(f for f in out_dir.glob(stem + ".*")
                           if f.suffix not in (".part", ".ytdl", ".jpg", ".webp")
                           and not f.name.endswith(".thumb.jpg"))
            dest = found[0] if found else None
            if not dest:
                raise RuntimeError("yt-dlp produced no file")
        fields = {"file": str(dest.relative_to(self.media_dir)).replace("\\", "/")}
        if dest.suffix.lstrip(".") in S.VIDEO_EXT:
            fields.update(self._probe(dest, it))
            thumb = self._thumbnail(dest, fields.get("duration") or it.get("duration"))
            if thumb:
                fields["thumb_file"] = str(thumb.relative_to(self.media_dir)).replace("\\", "/")
        else:
            fields["thumb_file"] = fields["file"]
        self.db.update(item_id, fields)
        return True

    def _fetch(self, job, url, dest: Path):
        tmp = dest.with_suffix(dest.suffix + ".part")
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            while True:
                job.check()
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
        tmp.replace(dest)

    def _probe(self, path, it):
        if not self.tools.ffprobe:
            return {}
        try:
            d = json.loads(subprocess.run(self.tools.ffprobe + [
                "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height:format=duration", "-of", "json", str(path)],
                capture_output=True, text=True, timeout=60).stdout or "{}")
        except (subprocess.SubprocessError, ValueError, OSError):
            return {}
        st = (d.get("streams") or [{}])[0]
        res = {}
        if not it.get("duration") and d.get("format", {}).get("duration"):
            res["duration"] = to_float(d["format"]["duration"])
        if not it.get("width") and st.get("width"):
            res["width"], res["height"] = st["width"], st["height"]
        return res

    def _thumbnail(self, path, duration):
        if not self.tools.ffmpeg:
            return None
        thumb = path.with_suffix(".thumb.jpg")
        at = min(1.0, (duration or 2) / 3)
        try:
            subprocess.run(self.tools.ffmpeg + ["-y", "-loglevel", "error", "-ss", f"{at:.2f}",
                                                "-i", str(path), "-frames:v", "1", "-vf",
                                                "scale=480:-2", str(thumb)],
                           capture_output=True, timeout=60)
        except (subprocess.SubprocessError, OSError):
            return None
        return thumb if thumb.exists() else None

    def _run_analyze(self, job):
        ids = job.params.get("ids") or []
        job.total, job.done = len(ids), 0
        for item_id in ids:
            job.check()
            try:
                it = self.db.get(item_id)
                if it and not it.get("file"):
                    job.log(f"  {item_id}: downloading first")
                    self.download(job, item_id)
                    job.stats["downloaded"] += 1
                if self.analyze(job, item_id):
                    job.stats["analyzed"] += 1
            except Cancelled:
                raise
            except Exception as e:      # noqa: BLE001
                job.stats["errors"] += 1
                job.log(f"  {item_id}: {e}")
            job.done += 1

    def analyze(self, job, item_id) -> bool:
        it = self.db.get(item_id)
        if not it or not it.get("file") or (it.get("media") or "video") != "video":
            return False
        path = self.media_dir / it["file"]
        fields = {}
        if self.tools.whisper:
            job.log(f"  🗣 transcribing {item_id}")
            segs = self._transcribe(path)
            fields["segments"] = json.dumps(segs)
            fields["transcript"] = " ".join(s["t"] for s in segs).strip()
        if self.tools.tesseract and self.tools.ffmpeg:
            job.log(f"  👁 reading on-screen text {item_id}")
            fields["ocr"] = self._ocr(job, path, it.get("duration"))
        if not fields:
            job.log("  nothing to analyze with — install faster-whisper and/or tesseract")
            return False
        self.db.update(item_id, fields)
        self.db.exec("DELETE FROM vectors WHERE item_id=?", (item_id,))   # re-understand
        self.embed.ensure([item_id])
        return True

    def _transcribe(self, path):
        from faster_whisper import WhisperModel   # optional dependency
        size = self.store.settings.get("whisper_model") or "base"
        if not self._whisper or self._whisper[0] != size:
            self._whisper = (size, WhisperModel(size, device="auto", compute_type="int8"))
        segments, _ = self._whisper[1].transcribe(str(path), vad_filter=True)
        return [{"s": round(s.start, 2), "e": round(s.end, 2), "t": s.text.strip()}
                for s in segments if s.text.strip()]

    def _ocr(self, job, path, duration):
        duration = duration or 30
        every = to_float(self.store.settings.get("ocr_every")) or max(2.0, duration / 20)
        lines, seen = [], set()
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(self.tools.ffmpeg + ["-loglevel", "error", "-i", str(path), "-vf",
                                                f"fps=1/{every:.2f},scale=1280:-2", "-frames:v", "40",
                                                str(Path(tmp) / "f%03d.png")],
                           capture_output=True, timeout=600)
            for frame in sorted(Path(tmp).glob("*.png")):
                job.check()
                out = subprocess.run(self.tools.tesseract + [str(frame), "stdout", "--psm", "11"],
                                     capture_output=True, text=True, timeout=60).stdout
                for ln in out.splitlines():
                    ln = " ".join(ln.split())
                    if len(re.findall(r"[A-Za-z0-9]", ln)) >= 3 and ln.lower() not in seen:
                        seen.add(ln.lower())
                        lines.append(ln)
        return "\n".join(lines)

    def _run_understand(self, job):
        n = self.embed.ensure(None, job.log, job.check)
        if self.embed.error:
            job.log("  ✕ " + self.embed.error)
        job.log(f"  🧠 {n} item(s) understood")
        for t in self.db.q("SELECT id FROM topics"):
            TopicScorer(self, t["id"]).rescore()

    # ═════════ items ═════════
    def delete(self, item_id, remove_file=True):
        it = self.db.get(item_id)
        if not it:
            return False
        if remove_file:
            for k in ("file", "thumb_file"):
                if it.get(k):
                    f = (self.media_dir / it[k]).resolve()
                    if f.is_relative_to(self.media_dir.resolve()) and f.exists():
                        f.unlink()
        for tbl in ("topic_items", "topic_hits", "vectors"):
            self.db.exec(f"DELETE FROM {tbl} WHERE item_id=?", (item_id,))
        self.db.exec("DELETE FROM items WHERE id=?", (item_id,))
        return True

    def tag(self, ids, value, remove=False):
        add = norm_tags(value).split()
        for i in ids:
            it = self.db.get(i)
            if it:
                cur = (it.get("tags") or "").split()
                new = [t for t in cur if t not in add] if remove else cur + [t for t in add if t not in cur]
                self.db.update(i, {"tags": " ".join(new)})

    def semantic_scores(self, text):
        return self.embed.search(text) if self.embed.enabled() else {}
