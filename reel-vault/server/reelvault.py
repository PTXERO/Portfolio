#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────
#  REEL//VAULT — local backend
#
#  Collects videos from X/Twitter (via gallery-dl) and ~1000 other
#  sites (via yt-dlp), stores their metadata in SQLite with a
#  full-text index, downloads the files, optionally transcribes
#  speech (faster-whisper) and reads on-screen text (tesseract),
#  and serves a JSON API + the web UI on http://127.0.0.1:8765.
#
#  Standard library only. External tools are optional and are
#  detected at startup — see reel-vault/README.md.
# ─────────────────────────────────────────────────────────────────

import argparse
import csv
import difflib
import importlib.util
import io
import json
import mimetypes
import queue
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent           # reel-vault/
SITE_ROOT = APP_DIR.parent      # portfolio root (UI pages use ../site.config.js etc.)
DEFAULT_SYNONYMS = HERE / "synonyms.json"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

# FTS columns and their bm25 weights (higher = matters more)
FTS_COLS = ["text", "hashtags", "author", "transcript", "ocr", "tags"]
FTS_WEIGHTS = [1.0, 2.0, 1.5, 0.8, 0.6, 2.5]

STOPWORDS = set("""a an and are as at be but by for from has have he her his i if in
into is it its just me my no not of on or our so that the their them then there
these they this to too up us was we were what when which who will with you your
rt via amp https http www com t co""".split())


def now() -> int:
    return int(time.time())


def safe_name(s: str, maxlen: int = 80) -> str:
    s = re.sub(r"[^\w.-]+", "_", str(s or "unknown")).strip("._")
    return (s or "unknown")[:maxlen]


def to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def to_float(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def parse_date(v):
    """gallery-dl dates look like '2024-05-01 13:45:10'; yt-dlp gives a
    unix timestamp or 'YYYYMMDD'. Returns a unix timestamp or None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%Y%m%d"):
        try:
            return int(datetime.strptime(s[:19], fmt)
                       .replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            pass
    try:
        return int(datetime.fromisoformat(s).timestamp())
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────────
#  Tools / capabilities
# ─────────────────────────────────────────────────────────────────

def _tool_cmd(binary: str, module: str | None = None):
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

    def status(self):
        return {
            "gallery_dl": bool(self.gallery_dl),
            "yt_dlp": bool(self.yt_dlp),
            "ffmpeg": bool(self.ffmpeg),
            "ffprobe": bool(self.ffprobe),
            "whisper": self.whisper,
            "tesseract": bool(self.tesseract),
        }


# ─────────────────────────────────────────────────────────────────
#  Database
# ─────────────────────────────────────────────────────────────────

ITEM_FIELDS = [
    "id", "platform", "post_id", "url", "media_url", "author", "author_name",
    "text", "hashtags", "lang", "posted_at", "duration", "width", "height",
    "likes", "reposts", "replies", "views", "thumbnail", "file", "thumb_file",
    "transcript", "segments", "ocr", "tags", "notes", "starred", "source",
    "collected_at",
]
# Fields refreshed when an item is collected again (user data is kept)
META_FIELDS = [
    "platform", "post_id", "url", "media_url", "author", "author_name", "text",
    "hashtags", "lang", "posted_at", "duration", "width", "height", "likes",
    "reposts", "replies", "views", "thumbnail",
]

_FTS_VALUES = ("{p}.rowid, coalesce({p}.text,''), coalesce({p}.hashtags,''), "
               "coalesce({p}.author,'')||' '||coalesce({p}.author_name,''), "
               "coalesce({p}.transcript,''), coalesce({p}.ocr,''), coalesce({p}.tags,'')")

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS items(
  id TEXT PRIMARY KEY, platform TEXT, post_id TEXT, url TEXT, media_url TEXT,
  author TEXT, author_name TEXT, text TEXT DEFAULT '', hashtags TEXT DEFAULT '',
  lang TEXT, posted_at INTEGER, duration REAL, width INTEGER, height INTEGER,
  likes INTEGER DEFAULT 0, reposts INTEGER DEFAULT 0, replies INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0, thumbnail TEXT, file TEXT, thumb_file TEXT,
  transcript TEXT DEFAULT '', segments TEXT, ocr TEXT DEFAULT '',
  tags TEXT DEFAULT '', notes TEXT DEFAULT '', starred INTEGER DEFAULT 0,
  source TEXT, collected_at INTEGER
);
CREATE INDEX IF NOT EXISTS items_posted ON items(posted_at);
CREATE INDEX IF NOT EXISTS items_author ON items(author);
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  {", ".join(FTS_COLS)}, content='items', content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS items_vocab USING fts5vocab(items_fts, 'row');
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, {", ".join(FTS_COLS)})
    VALUES ({_FTS_VALUES.format(p="new")});
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, {", ".join(FTS_COLS)})
    VALUES ('delete', {_FTS_VALUES.format(p="old")});
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, {", ".join(FTS_COLS)})
    VALUES ('delete', {_FTS_VALUES.format(p="old")});
  INSERT INTO items_fts(rowid, {", ".join(FTS_COLS)})
    VALUES ({_FTS_VALUES.format(p="new")});
END;
"""


def norm_tags(tags) -> str:
    if isinstance(tags, str):
        tags = re.split(r"[,\s]+", tags)
    out = []
    for t in tags or []:
        t = re.sub(r"[^\w-]+", "", str(t).lower().lstrip("#"))
        if t and t not in out:
            out.append(t)
    return " ".join(out)


class DB:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()
        self._vocab = None
        self._vocab_version = -1
        self.version = 0     # bumped on every write; invalidates vocab cache

    def q(self, sql, params=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql, params=()):
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def exec(self, sql, params=()):
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            self.version += 1
            return cur

    def upsert(self, item: dict) -> str:
        """Insert or refresh an item. Returns 'new' or 'updated'."""
        item = {k: item.get(k) for k in ITEM_FIELDS if k in item}
        item.setdefault("collected_at", now())
        with self.lock:
            exists = self.conn.execute(
                "SELECT 1 FROM items WHERE id=?", (item["id"],)).fetchone()
            if exists:
                sets = [f for f in META_FIELDS if item.get(f) is not None]
                if sets:
                    self.conn.execute(
                        f"UPDATE items SET {', '.join(f + '=?' for f in sets)} WHERE id=?",
                        [item[f] for f in sets] + [item["id"]])
                result = "updated"
            else:
                cols = list(item.keys())
                self.conn.execute(
                    f"INSERT INTO items({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [item[c] for c in cols])
                result = "new"
            self.conn.commit()
            self.version += 1
        return result

    def get(self, item_id):
        return self.one("SELECT * FROM items WHERE id=?", (item_id,))

    def update(self, item_id, fields: dict):
        fields = {k: v for k, v in fields.items() if k in ITEM_FIELDS and k != "id"}
        if not fields:
            return
        self.exec(f"UPDATE items SET {', '.join(k + '=?' for k in fields)} WHERE id=?",
                  list(fields.values()) + [item_id])

    def vocab(self):
        """Indexed (stemmed) terms, used for fuzzy / typo matching."""
        with self.lock:
            if self._vocab_version != self.version:
                self._vocab = [r[0] for r in self.conn.execute(
                    "SELECT term FROM items_vocab WHERE length(term) > 2 "
                    "ORDER BY doc DESC LIMIT 50000")]
                self._vocab_version = self.version
            return self._vocab


# ─────────────────────────────────────────────────────────────────
#  Synonyms & settings
# ─────────────────────────────────────────────────────────────────

class Store:
    """Small JSON files in the data dir (settings, synonyms)."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.settings_path = data_dir / "settings.json"
        self.syn_path = data_dir / "synonyms.json"
        self.settings = {
            "cookies_file": "", "cookies_browser": "",
            "whisper_model": "base", "ocr_every": 0,
        }
        if self.settings_path.exists():
            try:
                self.settings.update(json.loads(self.settings_path.read_text()))
            except (OSError, ValueError):
                pass
        self.load_synonyms()

    def save_settings(self, new: dict):
        for k in self.settings:
            if k in new:
                self.settings[k] = new[k]
        self.settings_path.write_text(json.dumps(self.settings, indent=2))

    def load_synonyms(self):
        src = self.syn_path if self.syn_path.exists() else DEFAULT_SYNONYMS
        try:
            groups = json.loads(src.read_text()).get("groups", [])
        except (OSError, ValueError):
            groups = []
        self.set_groups(groups)

    def set_groups(self, groups):
        self.groups = [[str(w).strip().lower() for w in g if str(w).strip()]
                       for g in groups if isinstance(g, list)]
        self.groups = [g for g in self.groups if len(g) > 1]
        self.syn = {}
        for g in self.groups:
            for w in g:
                self.syn.setdefault(w, set()).update(x for x in g if x != w)

    def save_synonyms(self, groups):
        self.set_groups(groups)
        self.syn_path.write_text(json.dumps({"groups": self.groups}, indent=1))

    def synonyms(self, word):
        return sorted(self.syn.get(word.lower(), ()))


# ─────────────────────────────────────────────────────────────────
#  Search
# ─────────────────────────────────────────────────────────────────

TOKEN_RE = re.compile(r'(-?)(?:([A-Za-z_]+):)?(?:"([^"]*)"|(\S+))')
FIELD_ALIASES = {
    "author": "author", "from": "author", "by": "author", "user": "author",
    "tag": "tag", "tags": "tag", "site": "platform", "platform": "platform",
    "text": "text", "caption": "text", "said": "transcript", "speech": "transcript",
    "transcript": "transcript", "screen": "ocr", "ocr": "ocr", "hashtag": "hashtags",
}


def fts_quote(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def parse_query(q: str):
    """Split a query into terms.
       words, "exact phrases", -exclude, #hashtag, @author,
       author:x  tag:x  site:x  said:x (speech)  screen:x (on-screen text),
       OR between words switches to match-any."""
    terms, filters, any_mode = [], {"author": [], "tag": [], "platform": []}, False
    for m in TOKEN_RE.finditer(q or ""):
        neg, field, phrase, word = m.group(1) == "-", m.group(2), m.group(3), m.group(4)
        if word == "OR" and not neg and not field:
            any_mode = True
            continue
        text = phrase if phrase is not None else word
        if field:
            f = FIELD_ALIASES.get(field.lower())
            if f is None:          # unknown "x:y" → treat as a plain word
                text, f = f"{field}:{text}", None
            elif f in ("author", "tag", "platform"):
                filters[f].append((neg, text.lstrip("@#").lower()))
                continue
        else:
            f = None
            if text.startswith("@") and len(text) > 1:
                filters["author"].append((neg, text[1:].lower()))
                continue
            if text.startswith("#") and len(text) > 1:
                text, f = text[1:], "hashtags"
        words = re.findall(r"\w+", text.lower())
        if not words:
            continue
        terms.append({"neg": neg, "words": words, "phrase": phrase is not None or len(words) > 1,
                      "col": f, "raw": text})
    return terms, filters, any_mode


def expand_term(term, store: Store, db: DB, opts):
    """Return the list of FTS variants for one term plus display info."""
    raw = " ".join(term["words"])
    variants = [(raw, False)]           # (text, is_prefix)
    syns, fuzzy = [], []
    if not term["phrase"] or len(term["words"]) > 1:
        if opts.get("synonyms", True) and not term["neg"]:
            syns = store.synonyms(raw)
            variants += [(s, False) for s in syns]
        if not term["phrase"]:
            if opts.get("partial", True):
                variants.append((raw, True))
            if opts.get("fuzzy", True) and not term["neg"] and len(raw) >= 4:
                vocab = db.vocab()
                cands = difflib.get_close_matches(raw, vocab, n=6, cutoff=0.78)
                fuzzy = [c for c in cands if c != raw][:4]
                variants += [(c, True) for c in fuzzy]
    parts = []
    for text, prefix in variants:
        p = fts_quote(text) + ("*" if prefix else "")
        if p not in parts:
            parts.append(p)
    return parts, {"term": raw, "synonyms": syns, "fuzzy": fuzzy, "neg": term["neg"]}


def build_match(terms, store, db, opts, any_mode, cols):
    pos, neg, info, highlight = [], [], [], set()
    col_filter = ""
    if cols and set(cols) != set(FTS_COLS):
        col_filter = "{" + " ".join(c for c in cols if c in FTS_COLS) + "} : "
    for t in terms:
        parts, meta = expand_term(t, store, db, opts)
        info.append(meta)
        expr = "(" + " OR ".join(parts) + ")"
        if t["col"]:
            cf = "{hashtags tags}" if t["col"] == "hashtags" else "{" + t["col"] + "}"
            expr = f"{cf} : {expr}"
        elif col_filter:
            expr = col_filter + expr
        (neg if t["neg"] else pos).append(expr)
        if not t["neg"]:
            highlight.add(meta["term"])
            highlight.update(meta["synonyms"])
            highlight.update(meta["fuzzy"])
    joiner = " OR " if any_mode else " AND "
    return (joiner.join(pos) if pos else None,
            " OR ".join(neg) if neg else None, info, sorted(highlight))


SORTS = {
    "newest": "i.posted_at DESC", "oldest": "i.posted_at ASC",
    "likes": "i.likes DESC", "views": "i.views DESC", "reposts": "i.reposts DESC",
    "engagement": "(i.likes + 2*i.reposts + i.replies) DESC",
    "longest": "i.duration DESC", "shortest": "i.duration ASC",
    "collected": "i.collected_at DESC", "author": "lower(i.author) ASC",
}


def _flag(v):
    return str(v).lower() in ("1", "true", "yes", "on")


def search(db: DB, store: Store, p: dict):
    """p: flat dict of query params (strings)."""
    terms, qfilters, any_mode = parse_query(p.get("q", ""))
    if p.get("mode") == "any":
        any_mode = True
    opts = {k: _flag(p.get(k, "1")) for k in ("synonyms", "fuzzy", "partial")}
    cols = [c for c in (p.get("fields") or "").split(",") if c]
    pos, neg, info, highlight = build_match(terms, store, db, opts, any_mode, cols)

    where, params = [], []
    if neg:
        where.append("i.rowid NOT IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)")
        params.append(neg)

    def add_like(cols_, val, negate):
        cond = " OR ".join(f"lower(coalesce({c},'')) LIKE ?" for c in cols_)
        where.append(("NOT " if negate else "") + f"({cond})")
        params.extend([f"%{val}%"] * len(cols_))

    for negate, a in qfilters["author"]:
        add_like(["i.author", "i.author_name"], a, negate)
    for negate, t in qfilters["tag"]:
        where.append(("NOT " if negate else "") + "(' '||i.tags||' ' LIKE ?)")
        params.append(f"% {t} %")
    for negate, pl in qfilters["platform"]:
        where.append(("NOT " if negate else "") + "(i.platform = ?)")
        params.append(pl)

    if p.get("platform"):
        pls = p["platform"].split(",")
        where.append(f"i.platform IN ({','.join('?' * len(pls))})")
        params += pls
    if p.get("author"):
        add_like(["i.author", "i.author_name"], p["author"].lower().lstrip("@"), False)
    for t in [t for t in (p.get("tag") or "").split(",") if t]:
        where.append("(' '||i.tags||' ' LIKE ?)")
        params.append(f"% {t.lower()} %")
    for h in [h for h in (p.get("hashtag") or "").split(",") if h]:
        where.append("(' '||lower(i.hashtags)||' ' LIKE ?)")
        params.append(f"% {h.lower().lstrip('#')} %")
    if p.get("source"):
        where.append("i.source LIKE ?")
        params.append(f"%{p['source']}%")
    rng = [("date_from", "i.posted_at >= ?", parse_date), ("date_to", "i.posted_at <= ?",
           lambda v: (parse_date(v) or 0) + 86399),
           ("dur_min", "i.duration >= ?", to_float), ("dur_max", "i.duration <= ?", to_float),
           ("likes_min", "i.likes >= ?", to_int), ("views_min", "i.views >= ?", to_int),
           ("reposts_min", "i.reposts >= ?", to_int)]
    for key, cond, conv in rng:
        if p.get(key) not in (None, ""):
            v = conv(p[key])
            if v is not None:
                where.append(cond)
                params.append(v)
    if p.get("has_file") in ("1", "0"):
        where.append("i.file IS NOT NULL" if p["has_file"] == "1" else "i.file IS NULL")
    if p.get("has_speech") == "1":
        where.append("coalesce(i.transcript,'') != ''")
    if p.get("has_ocr") == "1":
        where.append("coalesce(i.ocr,'') != ''")
    if p.get("starred") == "1":
        where.append("i.starred = 1")
    shape = p.get("shape")
    if shape == "portrait":
        where.append("i.height > i.width * 1.1")
    elif shape == "landscape":
        where.append("i.width > i.height * 1.1")
    elif shape == "square":
        where.append("i.width > 0 AND abs(i.width - i.height) <= i.width * 0.1")

    w = (" AND " + " AND ".join(where)) if where else ""
    if pos:
        base = (f"FROM items_fts JOIN items i ON i.rowid = items_fts.rowid "
                f"WHERE items_fts MATCH ?{w}")
        base_params = [pos] + params
        score = f"bm25(items_fts, {', '.join(map(str, FTS_WEIGHTS))})"
    else:
        base = f"FROM items i WHERE 1=1{w}"
        base_params = params
        score = "0"

    sort = p.get("sort") or "relevance"
    order = SORTS.get(sort)
    if order is None:
        order = "score ASC, i.posted_at DESC" if pos else "i.posted_at DESC"
    limit = max(1, min(to_int(p.get("limit"), 60), 500))
    offset = max(0, to_int(p.get("offset"), 0))

    try:
        light = db.q(f"SELECT i.platform, i.author, i.hashtags, i.tags {base}", base_params)
        rows = db.q(f"SELECT i.*, {score} AS score {base} ORDER BY {order} "
                    f"LIMIT ? OFFSET ?", base_params + [limit, offset])
    except sqlite3.OperationalError as e:
        return {"error": f"Bad query: {e}", "items": [], "total": 0,
                "expansions": info, "highlight": highlight, "facets": {}}

    def top(counter, n):
        return [{"value": k, "count": v} for k, v in
                sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]

    plat, auth, hashes, tags = {}, {}, {}, {}
    for r in light:
        plat[r["platform"] or "?"] = plat.get(r["platform"] or "?", 0) + 1
        if r["author"]:
            auth[r["author"]] = auth.get(r["author"], 0) + 1
        for h in (r["hashtags"] or "").split():
            hashes[h.lower()] = hashes.get(h.lower(), 0) + 1
        for t in (r["tags"] or "").split():
            tags[t] = tags.get(t, 0) + 1
    for r in rows:
        r.pop("segments", None)     # fetched per item in the detail view
    return {
        "total": len(light), "items": rows, "offset": offset, "limit": limit,
        "expansions": info, "highlight": highlight,
        "facets": {"platform": top(plat, 20), "author": top(auth, 25),
                   "hashtag": top(hashes, 30), "tag": top(tags, 30)},
    }


def similar(db: DB, store: Store, item_id: str, limit=12):
    it = db.get(item_id)
    if not it:
        return []
    blob = " ".join([it.get("text") or "", it.get("hashtags") or "",
                     it.get("transcript") or "", it.get("ocr") or "", it.get("tags") or ""])
    counts = {}
    for w in re.findall(r"[^\W\d_]{3,}", blob.lower()):
        if w not in STOPWORDS:
            counts[w] = counts.get(w, 0) + 1
    hashtags = set((it.get("hashtags") or "").lower().split())
    words = sorted(counts, key=lambda w: (-(counts[w] + (3 if w in hashtags else 0)), -len(w)))[:14]
    if not words:
        rows = db.q("SELECT * FROM items WHERE author=? AND id!=? ORDER BY posted_at DESC LIMIT ?",
                    (it.get("author"), item_id, limit))
    else:
        match = " OR ".join(fts_quote(w) for w in words)
        rows = db.q(
            f"SELECT i.*, bm25(items_fts, {', '.join(map(str, FTS_WEIGHTS))}) AS score "
            "FROM items_fts JOIN items i ON i.rowid=items_fts.rowid "
            "WHERE items_fts MATCH ? AND i.id != ? ORDER BY score LIMIT ?",
            (match, item_id, limit))
    for r in rows:
        r.pop("segments", None)
    return rows


# ─────────────────────────────────────────────────────────────────
#  Collect: source → URL → metadata
# ─────────────────────────────────────────────────────────────────

X_HOSTS = ("x.com", "twitter.com", "mobile.twitter.com", "www.x.com", "www.twitter.com",
           "mobile.x.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com")


def is_x_url(url: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return host in X_HOSTS


def build_x_search(q: str, opt: dict) -> str:
    """Turn a keyword + filters into an X advanced-search string."""
    parts = [q.strip()]
    if opt.get("videos_only", True):
        parts.append("filter:videos")
    if to_int(opt.get("min_likes")):
        parts.append(f"min_faves:{to_int(opt['min_likes'])}")
    if to_int(opt.get("min_reposts")):
        parts.append(f"min_retweets:{to_int(opt['min_reposts'])}")
    if opt.get("since"):
        parts.append(f"since:{opt['since']}")
    if opt.get("until"):
        parts.append(f"until:{opt['until']}")
    if opt.get("lang"):
        parts.append(f"lang:{opt['lang']}")
    if opt.get("exclude_replies", True):
        parts.append("-filter:replies")
    return " ".join(p for p in parts if p)


def source_url(src: dict, opt: dict) -> str:
    kind, val = src.get("type", "url"), (src.get("value") or "").strip()
    handle = val.lstrip("@").strip("/").split("/")[-1]
    if kind == "search":
        tab = "top" if opt.get("search_tab") == "top" else "live"
        q = urllib.parse.quote(build_x_search(val, opt))
        return f"https://x.com/search?q={q}&f={tab}"
    if kind == "hashtag":
        return source_url({"type": "search", "value": "#" + val.lstrip("#")}, opt)
    if kind == "user":
        return f"https://x.com/{handle}/media"
    if kind == "likes":
        return f"https://x.com/{handle}/likes"
    if kind == "bookmarks":
        return "https://x.com/i/bookmarks"
    if kind == "list":
        return val if val.startswith("http") else f"https://x.com/i/lists/{val}"
    return val


def item_from_gdl(url: str, kw: dict, source: str, include_gifs=True):
    """gallery-dl twitter kwdict (one media file) → item dict."""
    mtype = kw.get("type")
    ok = ("video",) + (("animated_gif",) if include_gifs else ())
    if mtype not in ok and not url.startswith("ytdl:"):
        return None
    tid = str(kw.get("tweet_id") or "")
    if not tid:
        return None
    author = kw.get("author") or kw.get("user") or {}
    num = to_int(kw.get("num"), 1)
    handle = author.get("name") or "i"
    return {
        "id": f"x:{tid}" + (f"_{num}" if num > 1 else ""),
        "platform": "x", "post_id": tid,
        "url": f"https://x.com/{handle}/status/{tid}",
        "media_url": None if url.startswith("ytdl:") else url,
        "author": handle, "author_name": author.get("nick") or "",
        "text": kw.get("content") or "",
        "hashtags": " ".join(kw.get("hashtags") or []),
        "lang": kw.get("lang"),
        "posted_at": parse_date(kw.get("date")),
        "duration": to_float(kw.get("duration")),
        "width": to_int(kw.get("width")), "height": to_int(kw.get("height")),
        "likes": to_int(kw.get("favorite_count")), "reposts": to_int(kw.get("retweet_count")),
        "replies": to_int(kw.get("reply_count")), "views": to_int(kw.get("view_count")),
        "thumbnail": None, "source": source,
    }


def item_from_ytdlp(info: dict, source: str):
    if not info.get("id"):
        return None
    if info.get("_type") in ("playlist", "multi_video"):
        return None
    plat = (info.get("extractor_key") or info.get("extractor") or "web").lower()
    plat = {"twitter": "x", "twitterbroadcast": "x"}.get(plat, plat.split(":")[0])
    title, desc = info.get("title") or "", info.get("description") or ""
    text = desc if title and desc.startswith(title[:40]) else "\n".join(x for x in (title, desc) if x)
    tags = info.get("tags") or []
    tags += re.findall(r"#(\w+)", text)
    return {
        "id": f"{plat}:{info['id']}", "platform": plat, "post_id": str(info["id"]),
        "url": info.get("webpage_url") or info.get("original_url"),
        "media_url": None,
        "author": info.get("uploader_id") or info.get("channel_id") or info.get("uploader") or "",
        "author_name": info.get("uploader") or info.get("channel") or "",
        "text": text, "hashtags": " ".join(dict.fromkeys(t.replace(" ", "") for t in tags)),
        "lang": info.get("language"),
        "posted_at": parse_date(info.get("timestamp") or info.get("release_timestamp")
                                or info.get("upload_date")),
        "duration": to_float(info.get("duration")),
        "width": to_int(info.get("width")), "height": to_int(info.get("height")),
        "likes": to_int(info.get("like_count")), "reposts": to_int(info.get("repost_count")),
        "replies": to_int(info.get("comment_count")), "views": to_int(info.get("view_count")),
        "thumbnail": info.get("thumbnail"), "source": source,
    }


# ─────────────────────────────────────────────────────────────────
#  Jobs
# ─────────────────────────────────────────────────────────────────

class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind, params):
        self.id = uuid.uuid4().hex[:10]
        self.kind, self.params = kind, params
        self.state, self.created = "queued", now()
        self.started = self.finished = None
        self.log_lines, self.cancel = [], False
        self.proc = None
        self.stats = {"found": 0, "new": 0, "updated": 0, "downloaded": 0,
                      "analyzed": 0, "skipped": 0, "errors": 0}
        self.done, self.total = 0, 0
        self.title = params.get("title") or kind

    def log(self, msg):
        line = time.strftime("%H:%M:%S ") + str(msg).rstrip()
        self.log_lines.append(line)
        del self.log_lines[:-400]

    def check(self):
        if self.cancel:
            raise Cancelled()

    def to_dict(self, full=False):
        d = {k: getattr(self, k) for k in ("id", "kind", "title", "state", "created",
                                           "started", "finished", "stats", "done", "total")}
        d["log"] = self.log_lines if full else self.log_lines[-6:]
        return d


class Vault:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.media_dir = data_dir / "media"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.db = DB(data_dir / "vault.db")
        self.store = Store(data_dir)
        self.tools = Tools()
        self.jobs: dict[str, Job] = {}
        self.queue: "queue.Queue[Job]" = queue.Queue()
        self._whisper = None
        threading.Thread(target=self._worker, daemon=True).start()

    # ── job plumbing ────────────────────────────────────────────
    def submit(self, kind, params):
        job = Job(kind, params)
        self.jobs[job.id] = job
        old = sorted(self.jobs.values(), key=lambda j: j.created)[:-50]
        for j in old:
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
                job.log(traceback.format_exc(limit=3))
            job.finished = now()
            job.proc = None

    def _cookie_args(self):
        s = self.store.settings
        if s.get("cookies_file"):
            return ["--cookies", s["cookies_file"]]
        if s.get("cookies_browser"):
            return ["--cookies-from-browser", s["cookies_browser"]]
        return []

    def _stream(self, job, cmd, timeout=1800):
        """Run cmd, yield stdout lines; stderr goes to the job log."""
        job.log("$ " + " ".join(c if " " not in c else repr(c) for c in cmd[-6:]))
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace", bufsize=1)
        job.proc = proc

        def pump_err():
            for line in proc.stderr:
                if line.strip():
                    job.log(line.strip()[:300])
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
                    job.log("timed out")
                    break
                yield line
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            t.join(timeout=2)
            job.proc = None

    # ── collect ─────────────────────────────────────────────────
    def _run_collect(self, job: Job):
        p = job.params
        sources = p.get("sources") or []
        limit = max(1, min(to_int(p.get("limit"), 50), 5000))
        new_ids = []
        job.total = len(sources)
        for src in sources:
            job.check()
            url = source_url(src, p)
            label = f"{src.get('type')}:{src.get('value') or ''}".strip(":")
            job.log(f"▶ {label}  →  {url}")
            if not url:
                job.done += 1
                continue
            try:
                if is_x_url(url):
                    got = self._collect_gdl(job, url, label, limit, p, new_ids)
                else:
                    got = self._collect_ytdlp(job, url, label, limit, new_ids)
                job.log(f"  {got} video(s) from {label}")
            except Cancelled:
                raise
            except Exception as e:
                job.stats["errors"] += 1
                job.log(f"  failed: {e}")
            job.done += 1
        job.log(f"collected {job.stats['found']} ({job.stats['new']} new)")
        if p.get("download") and new_ids:
            self._download_many(job, new_ids, analyze=p.get("analyze"))

    def _save(self, job, item, new_ids):
        res = self.db.upsert(item)
        job.stats["found"] += 1
        job.stats[res] += 1
        if res == "new" or not (self.db.get(item["id"]) or {}).get("file"):
            new_ids.append(item["id"])

    def _collect_gdl(self, job, url, label, limit, p, new_ids):
        if not self.tools.gallery_dl:
            raise RuntimeError("gallery-dl is not installed (pip install gallery-dl)")
        cmd = self.tools.gallery_dl + ["-J", "-o", "output.jsonl=true", "-o", "videos=true",
                                       *self._cookie_args(), url]
        got, seen = 0, set()
        for line in self._stream(job, cmd):
            line = line.strip()
            if not line.startswith("["):
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if not isinstance(msg, list) or not msg:
                continue
            if msg[0] == -1 and len(msg) > 1:
                job.log(f"  gallery-dl: {msg[1]}")
                continue
            if msg[0] != 3 or len(msg) < 3:
                continue
            item = item_from_gdl(msg[1], msg[2], label, p.get("include_gifs", True))
            if not item or item["id"] in seen:
                continue
            seen.add(item["id"])
            self._save(job, item, new_ids)
            got += 1
            if got >= limit:
                break
        if not got:
            self._gdl_diagnose(job, url)
        return got

    def _gdl_diagnose(self, job, url):
        """In JSONL mode gallery-dl swallows extractor errors (e.g. login
        required), so an empty result is re-checked once to say why."""
        cmd = self.tools.gallery_dl + ["-J", "--range", "1", "-o", "videos=true",
                                       *self._cookie_args(), url]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=90).stdout
            msgs = json.loads(out or "[]")
        except (subprocess.SubprocessError, ValueError, OSError):
            return
        for m in msgs:
            if isinstance(m, list) and m and m[0] == -1 and len(m) > 1:
                err = m[1] if isinstance(m[1], dict) else {"message": str(m[1])}
                job.stats["errors"] += 1
                job.log(f"  ✕ {err.get('error', 'error')}: {err.get('message', '')}")
                if err.get("error") == "AuthRequired" or "cookie" in str(err.get("message")):
                    job.log("  → X needs a logged-in session: set a cookies file or browser in SETUP")
                return
        job.log("  (no videos matched)")

    def _collect_ytdlp(self, job, url, label, limit, new_ids):
        if not self.tools.yt_dlp:
            raise RuntimeError("yt-dlp is not installed (pip install yt-dlp)")
        cmd = self.tools.yt_dlp + ["-j", "--no-warnings", "--ignore-errors", "--no-progress",
                                   "--playlist-end", str(limit), *self._cookie_args(), url]
        got = 0
        for line in self._stream(job, cmd):
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                info = json.loads(line)
            except ValueError:
                continue
            item = item_from_ytdlp(info, label)
            if not item:
                continue
            self._save(job, item, new_ids)
            got += 1
            if got >= limit:
                break
        return got

    # ── download ────────────────────────────────────────────────
    def _run_download(self, job: Job):
        self._download_many(job, job.params.get("ids") or [], job.params.get("analyze"))

    def _download_many(self, job, ids, analyze=False):
        job.total, job.done = len(ids), 0
        job.log(f"downloading {len(ids)} video(s)")
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
            except Exception as e:
                job.stats["errors"] += 1
                job.log(f"  {item_id}: {e}")
            job.done += 1

    def download(self, job, item_id) -> bool:
        it = self.db.get(item_id)
        if not it:
            return False
        if it.get("file") and (self.media_dir / it["file"]).exists():
            return False
        rel_dir = Path(safe_name(it["platform"])) / safe_name(it["author"] or "unknown")
        out_dir = self.media_dir / rel_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = safe_name(it["id"].split(":", 1)[-1])
        dest = None
        if it.get("media_url") and it["media_url"].startswith("http"):
            dest = out_dir / (stem + ".mp4")
            job.log(f"  ↓ {it['id']} (direct)")
            self._fetch(job, it["media_url"], dest)
        else:
            if not self.tools.yt_dlp:
                raise RuntimeError("yt-dlp is required to download this item")
            job.log(f"  ↓ {it['id']} (yt-dlp)")
            cmd = self.tools.yt_dlp + [
                "--no-warnings", "--no-progress", "--no-playlist",
                "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
                "--merge-output-format", "mp4",
                "-o", str(out_dir / (stem + ".%(ext)s")), *self._cookie_args(), it["url"]]
            for _ in self._stream(job, cmd, timeout=3600):
                pass
            found = sorted(f for f in out_dir.glob(stem + ".*")
                           if f.suffix not in (".part", ".ytdl", ".jpg", ".webp"))
            dest = found[0] if found else None
            if not dest:
                raise RuntimeError("yt-dlp produced no file")
        fields = {"file": str(dest.relative_to(self.media_dir))}
        fields.update(self._probe(dest, it))
        thumb = self._thumbnail(dest, fields.get("duration") or it.get("duration"))
        if thumb:
            fields["thumb_file"] = str(thumb.relative_to(self.media_dir))
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

    def _probe(self, path: Path, it: dict) -> dict:
        if not self.tools.ffprobe:
            return {}
        try:
            out = subprocess.run(self.tools.ffprobe + [
                "-v", "error", "-select_streams", "v:0", "-show_entries",
                "stream=width,height:format=duration", "-of", "json", str(path)],
                capture_output=True, text=True, timeout=60).stdout
            d = json.loads(out or "{}")
        except (subprocess.SubprocessError, ValueError, OSError):
            return {}
        st = (d.get("streams") or [{}])[0]
        res = {}
        if not it.get("duration") and d.get("format", {}).get("duration"):
            res["duration"] = to_float(d["format"]["duration"])
        if not it.get("width") and st.get("width"):
            res["width"], res["height"] = st["width"], st["height"]
        return res

    def _thumbnail(self, path: Path, duration):
        if not self.tools.ffmpeg:
            return None
        thumb = path.with_suffix(".thumb.jpg")
        at = min(1.0, (duration or 2) / 3)
        try:
            subprocess.run(self.tools.ffmpeg + [
                "-y", "-loglevel", "error", "-ss", f"{at:.2f}", "-i", str(path),
                "-frames:v", "1", "-vf", "scale=480:-2", str(thumb)],
                capture_output=True, timeout=60)
        except (subprocess.SubprocessError, OSError):
            return None
        return thumb if thumb.exists() else None

    # ── analyze (speech + on-screen text) ───────────────────────
    def _run_analyze(self, job: Job):
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
            except Exception as e:
                job.stats["errors"] += 1
                job.log(f"  {item_id}: {e}")
            job.done += 1

    def analyze(self, job, item_id) -> bool:
        it = self.db.get(item_id)
        if not it or not it.get("file"):
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
        return True

    def _transcribe(self, path: Path):
        from faster_whisper import WhisperModel   # optional dependency
        size = self.store.settings.get("whisper_model") or "base"
        if not self._whisper or self._whisper[0] != size:
            self._whisper = (size, WhisperModel(size, device="auto", compute_type="int8"))
        segments, _info = self._whisper[1].transcribe(str(path), vad_filter=True)
        return [{"s": round(s.start, 2), "e": round(s.end, 2), "t": s.text.strip()}
                for s in segments if s.text.strip()]

    def _ocr(self, job, path: Path, duration):
        duration = duration or 30
        every = to_float(self.store.settings.get("ocr_every")) or max(2.0, duration / 20)
        lines, seen = [], set()
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(self.tools.ffmpeg + [
                "-loglevel", "error", "-i", str(path), "-vf",
                f"fps=1/{every:.2f},scale=1280:-2", "-frames:v", "40",
                str(Path(tmp) / "f%03d.png")], capture_output=True, timeout=600)
            for frame in sorted(Path(tmp).glob("*.png")):
                job.check()
                out = subprocess.run(self.tools.tesseract + [str(frame), "stdout", "--psm", "11"],
                                     capture_output=True, text=True, timeout=60).stdout
                for ln in out.splitlines():
                    ln = " ".join(ln.split())
                    key = ln.lower()
                    if len(re.findall(r"[A-Za-z0-9]", ln)) >= 3 and key not in seen:
                        seen.add(key)
                        lines.append(ln)
        return "\n".join(lines)

    # ── deletion ────────────────────────────────────────────────
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
        self.db.exec("DELETE FROM items WHERE id=?", (item_id,))
        return True


# ─────────────────────────────────────────────────────────────────
#  HTTP
# ─────────────────────────────────────────────────────────────────

EXPORT_COLS = ["id", "platform", "url", "author", "author_name", "posted_at", "duration",
               "likes", "reposts", "replies", "views", "hashtags", "tags", "starred",
               "file", "text", "transcript", "ocr", "notes"]


class Handler(BaseHTTPRequestHandler):
    vault: Vault = None
    allowed_origins: set = set()
    allowed_hosts: set = set()
    server_version = "ReelVault/1.0"

    def log_message(self, fmt, *args):
        if "/api/jobs" not in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # ── security: only local hosts / known origins ──────────────
    def _guard(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        if host not in self.allowed_hosts:
            self._send(403, {"error": "forbidden host"})
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in self.allowed_origins:
            self._send(403, {"error": f"origin {origin} not allowed (use --allow-origin)"})
            return False
        return True

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin in self.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
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
        if not self._guard():
            return
        self.send_response(204)
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
        if not self._guard():
            return
        u = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(u.path)
        params = {k: v[-1] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if path.startswith("/api/"):
                return self._api(method, path[5:].strip("/").split("/"), params)
            if method != "GET":
                return self._send(405, {"error": "method not allowed"})
            if path.startswith("/media/"):
                return self._file(self.vault.media_dir, path[7:])
            if path in ("/", ""):
                return self._send(302, body=b"", headers={"Location": "/reel-vault/"})
            return self._file(SITE_ROOT, path.lstrip("/"))
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"error": str(e)})

    def _file(self, root: Path, rel: str):
        root = root.resolve()
        f = (root / rel).resolve()
        if not f.is_relative_to(root):
            return self._send(403, {"error": "forbidden"})
        if f.is_dir():
            if not self.path.split("?")[0].endswith("/"):
                return self._send(301, body=b"", headers={"Location": self.path + "/"})
            f = f / "index.html"
        if not f.is_file() or any(part.startswith(".") for part in f.relative_to(root).parts):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        size = f.stat().st_size
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
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
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(206 if m else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
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

    # ── API routes ──────────────────────────────────────────────
    def _api(self, method, parts, params):
        v = self.vault
        route = parts[0] if parts else ""
        arg = parts[1] if len(parts) > 1 else None
        sub = parts[2] if len(parts) > 2 else None

        if route == "status" and method == "GET":
            v.tools.refresh()
            c = v.db.one("SELECT count(*) n, sum(file IS NOT NULL) files, "
                         "sum(coalesce(transcript,'') != '') speech FROM items")
            return self._send(200, {"ok": True, "tools": v.tools.status(), "counts": c,
                                    "data_dir": str(v.data_dir),
                                    "settings": v.store.settings})

        if route == "search" and method == "GET":
            return self._send(200, search(v.db, v.store, params))

        if route == "items" and arg:
            if sub == "similar" and method == "GET":
                return self._send(200, {"items": similar(v.db, v.store, arg)})
            if method == "GET":
                it = v.db.get(arg)
                if it and it.get("segments"):
                    it["segments"] = json.loads(it["segments"])
                return self._send(200 if it else 404, it or {"error": "not found"})
            if method == "PATCH":
                b = self._body()
                upd = {}
                if "tags" in b:
                    upd["tags"] = norm_tags(b["tags"])
                if "notes" in b:
                    upd["notes"] = str(b["notes"])[:20000]
                if "starred" in b:
                    upd["starred"] = 1 if b["starred"] else 0
                v.db.update(arg, upd)
                return self._send(200, v.db.get(arg) or {})
            if method == "DELETE":
                ok = v.delete(arg, params.get("keep_file") != "1")
                return self._send(200, {"deleted": ok})

        if route == "bulk" and method == "POST":
            b = self._body()
            ids = [str(i) for i in (b.get("ids") or [])][:10000]
            action, value = b.get("action"), b.get("value")
            if action in ("tag", "untag"):
                add = norm_tags(value).split()
                for i in ids:
                    it = v.db.get(i)
                    if not it:
                        continue
                    cur = (it.get("tags") or "").split()
                    new = cur + [t for t in add if t not in cur] if action == "tag" \
                        else [t for t in cur if t not in add]
                    v.db.update(i, {"tags": " ".join(new)})
                return self._send(200, {"ok": True, "count": len(ids)})
            if action in ("star", "unstar"):
                for i in ids:
                    v.db.update(i, {"starred": 1 if action == "star" else 0})
                return self._send(200, {"ok": True, "count": len(ids)})
            if action == "delete":
                n = sum(1 for i in ids if v.delete(i, not b.get("keep_files")))
                return self._send(200, {"ok": True, "count": n})
            if action in ("download", "analyze"):
                job = v.submit(action, {"ids": ids, "analyze": bool(b.get("analyze")),
                                        "title": f"{action} {len(ids)} item(s)"})
                return self._send(200, job.to_dict())
            return self._send(400, {"error": "unknown action"})

        if route == "collect" and method == "POST":
            b = self._body()
            srcs = [s for s in (b.get("sources") or [])
                    if isinstance(s, dict) and (s.get("value") or s.get("type") == "bookmarks")]
            if not srcs:
                return self._send(400, {"error": "no sources"})
            b["sources"] = srcs[:500]
            b.setdefault("title", f"collect · {len(srcs)} source(s)")
            return self._send(200, v.submit("collect", b).to_dict())

        if route == "jobs":
            if not arg and method == "GET":
                jobs = sorted(v.jobs.values(), key=lambda j: -j.created)
                return self._send(200, {"jobs": [j.to_dict() for j in jobs]})
            if arg and sub == "cancel" and method == "POST":
                j = v.cancel(arg)
                return self._send(200 if j else 404, j.to_dict() if j else {"error": "no job"})
            if arg and method == "GET":
                j = v.jobs.get(arg)
                return self._send(200 if j else 404, j.to_dict(True) if j else {"error": "no job"})

        if route == "synonyms":
            if method == "GET":
                return self._send(200, {"groups": v.store.groups})
            if method == "PUT":
                v.store.save_synonyms(self._body().get("groups") or [])
                return self._send(200, {"groups": v.store.groups})

        if route == "settings" and method in ("GET", "PUT"):
            if method == "PUT":
                v.store.save_settings(self._body())
            return self._send(200, v.store.settings)

        if route == "export" and method == "GET":
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
            if params.get("format") == "csv":
                buf = io.StringIO()
                w = csv.DictWriter(buf, fieldnames=EXPORT_COLS, extrasaction="ignore")
                w.writeheader()
                w.writerows(rows)
                return self._send(200, body=buf.getvalue().encode("utf-8-sig"),
                                  ctype="text/csv; charset=utf-8",
                                  headers={"Content-Disposition":
                                           f'attachment; filename="reelvault-{stamp}.csv"'})
            if params.get("format") == "urls":
                body = "\n".join(r["url"] for r in rows if r.get("url")).encode()
                return self._send(200, body=body, ctype="text/plain; charset=utf-8",
                                  headers={"Content-Disposition":
                                           f'attachment; filename="reelvault-{stamp}.txt"'})
            return self._send(200, body=json.dumps(rows, indent=1, default=str).encode(),
                              headers={"Content-Disposition":
                                       f'attachment; filename="reelvault-{stamp}.json"'})

        return self._send(404, {"error": "no such endpoint"})


def main(argv=None):
    ap = argparse.ArgumentParser(description="REEL//VAULT local server")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data", default=str(APP_DIR / "data"),
                    help="where the database and videos are stored (default: reel-vault/data)")
    ap.add_argument("--allow-origin", action="append", default=[],
                    help="extra web origin allowed to use the API, e.g. https://you.github.io")
    ap.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    a = ap.parse_args(argv)

    data = Path(a.data).expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    Handler.vault = Vault(data)
    local = [f"127.0.0.1:{a.port}", f"localhost:{a.port}"]
    Handler.allowed_hosts = set(local)
    Handler.allowed_origins = {f"http://{h}" for h in local} | {"https://ptxero.github.io"} \
        | {o.rstrip("/") for o in a.allow_origin}

    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = f"http://127.0.0.1:{a.port}/reel-vault/"
    tools = Handler.vault.tools.status()
    print("REEL//VAULT running at", url)
    print("data:", data)
    print("tools:", ", ".join(f"{k}={'yes' if v else 'no'}" for k, v in tools.items()))
    if not a.no_browser:
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
