"""SQLite storage: items + full-text index, topics, votes, sources, caches."""

import json
import re
import secrets
import sqlite3
import threading
from pathlib import Path

from .util import now

HERE = Path(__file__).resolve().parent.parent
DEFAULT_SYNONYMS = HERE / "synonyms.json"

FTS_COLS = ["text", "hashtags", "author", "transcript", "ocr", "tags"]
FTS_WEIGHTS = [1.0, 2.0, 1.5, 0.8, 0.6, 2.5]

ITEM_FIELDS = [
    "id", "platform", "post_id", "url", "media_url", "media", "author", "author_name",
    "author_url", "text", "hashtags", "lang", "posted_at", "duration", "width", "height",
    "likes", "reposts", "replies", "views", "thumbnail", "file", "thumb_file",
    "transcript", "segments", "ocr", "tags", "notes", "starred", "source", "collected_at",
    "byline", "dateline",
]
# refreshed when an item is collected again; user data is kept
META_FIELDS = [
    "platform", "post_id", "url", "media_url", "media", "author", "author_name", "author_url",
    "text", "hashtags", "lang", "posted_at", "duration", "width", "height", "likes",
    "reposts", "replies", "views", "thumbnail", "byline", "dateline",
]

_FTS_VALUES = ("{p}.rowid, coalesce({p}.text,''), coalesce({p}.hashtags,''), "
               "coalesce({p}.author,'')||' '||coalesce({p}.author_name,''), "
               "coalesce({p}.transcript,''), coalesce({p}.ocr,''), coalesce({p}.tags,'')")
_COLS = ", ".join(FTS_COLS)

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
  {_COLS}, content='items', content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS items_vocab USING fts5vocab(items_fts, 'row');
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, {_COLS}) VALUES ({_FTS_VALUES.format(p="new")});
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, {_COLS}) VALUES ('delete', {_FTS_VALUES.format(p="old")});
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, {_COLS}) VALUES ('delete', {_FTS_VALUES.format(p="old")});
  INSERT INTO items_fts(rowid, {_COLS}) VALUES ({_FTS_VALUES.format(p="new")});
END;

CREATE TABLE IF NOT EXISTS sources(
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, template TEXT DEFAULT '',
  engine TEXT DEFAULT 'auto', enabled INTEGER DEFAULT 1, limit_per INTEGER DEFAULT 20,
  needs_login INTEGER DEFAULT 0, preset TEXT, options TEXT DEFAULT '{{}}',
  created INTEGER, last_run INTEGER, last_found INTEGER DEFAULT 0, last_error TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS topics(
  id TEXT PRIMARY KEY, name TEXT, seeds TEXT DEFAULT '[]', sources TEXT DEFAULT '[]',
  settings TEXT DEFAULT '{{}}', created INTEGER, last_run INTEGER, model TEXT DEFAULT '{{}}'
);
CREATE TABLE IF NOT EXISTS topic_items(
  topic_id TEXT, item_id TEXT, label INTEGER DEFAULT 0, prior REAL DEFAULT 0,
  score REAL DEFAULT 0, why TEXT DEFAULT '', added INTEGER, labeled_at INTEGER,
  PRIMARY KEY(topic_id, item_id)
);
CREATE INDEX IF NOT EXISTS topic_items_score ON topic_items(topic_id, label, score);
CREATE TABLE IF NOT EXISTS topic_hits(
  topic_id TEXT, item_id TEXT, query TEXT, source_id TEXT,
  PRIMARY KEY(topic_id, item_id, query, source_id)
);
CREATE TABLE IF NOT EXISTS topic_queries(
  topic_id TEXT, query TEXT, origin TEXT, enabled INTEGER DEFAULT 1, weight REAL DEFAULT 1,
  runs INTEGER DEFAULT 0, found INTEGER DEFAULT 0, last_run INTEGER, created INTEGER,
  PRIMARY KEY(topic_id, query)
);
CREATE TABLE IF NOT EXISTS relations(
  src TEXT, dst TEXT, kind TEXT, ts INTEGER, name TEXT DEFAULT '', url TEXT DEFAULT '', posts INTEGER DEFAULT 0,
  PRIMARY KEY(src, dst, kind)
);
CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, value TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS vectors(item_id TEXT PRIMARY KEY, model TEXT, dim INTEGER, vec BLOB);
"""

# columns added after v1 (ALTER TABLE for existing libraries)
MIGRATIONS = {
    "items": [("media", "TEXT DEFAULT 'video'"), ("author_url", "TEXT"), ("byline", "TEXT"), ("dateline", "TEXT")],
    "topic_queries": [("locked", "INTEGER DEFAULT 0")],
}


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
        self.conn = sqlite3.connect(str(path), check_same_thread=False, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        for table, cols in MIGRATIONS.items():
            have = {r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")}
            for name, decl in cols:
                if name not in have:
                    self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
        self.conn.commit()
        self._vocab = None
        self._vocab_version = -1
        self.version = 0   # bumped on every write; invalidates caches

    # ── generic ─────────────────────────────────────────────────
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

    def many(self, sql, rows):
        with self.lock:
            self.conn.executemany(sql, rows)
            self.conn.commit()
            self.version += 1

    # ── items ───────────────────────────────────────────────────
    def upsert(self, item: dict) -> str:
        """Insert or refresh an item. Returns 'new' or 'updated'."""
        item = {k: item.get(k) for k in ITEM_FIELDS if k in item}
        item.setdefault("collected_at", now())
        with self.lock:
            exists = self.conn.execute("SELECT 1 FROM items WHERE id=?", (item["id"],)).fetchone()
            if exists:
                sets = [f for f in META_FIELDS if item.get(f) not in (None, "", 0)]
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

    def get_many(self, ids):
        out = {}
        ids = list(ids)
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            for r in self.q(f"SELECT * FROM items WHERE id IN ({','.join('?' * len(chunk))})", chunk):
                out[r["id"]] = r
        return out

    def update(self, item_id, fields: dict):
        fields = {k: v for k, v in fields.items() if k in ITEM_FIELDS and k != "id"}
        if fields:
            self.exec(f"UPDATE items SET {', '.join(k + '=?' for k in fields)} WHERE id=?",
                      list(fields.values()) + [item_id])

    def vocab(self):
        """Indexed (stemmed) terms, used for typo matching."""
        with self.lock:
            if self._vocab_version != self.version:
                self._vocab = [r[0] for r in self.conn.execute(
                    "SELECT term FROM items_vocab WHERE length(term) > 2 "
                    "ORDER BY doc DESC LIMIT 60000")]
                self._vocab_version = self.version
            return self._vocab

    def vocab_df(self):
        """stemmed term → number of items containing it (cached)."""
        with self.lock:
            if getattr(self, "_df_version", -1) != self.version:
                self._df = {r[0]: r[1] for r in self.conn.execute("SELECT term, doc FROM items_vocab")}
                self._df_version = self.version
            return self._df

    def doc_count(self):
        return (self.one("SELECT count(*) n FROM items") or {"n": 0})["n"]

    # ── cache ───────────────────────────────────────────────────
    def cache_get(self, key, max_age):
        r = self.one("SELECT value, ts FROM cache WHERE key=?", (key,))
        if r and now() - r["ts"] < max_age:
            return json.loads(r["value"])
        return None

    def cache_set(self, key, value):
        self.exec("INSERT OR REPLACE INTO cache(key, value, ts) VALUES (?,?,?)",
                  (key, json.dumps(value), now()))


class Store:
    """JSON files in the data dir: settings (incl. access key) and synonyms."""

    DEFAULTS = {
        "cookies_file": "", "cookies_browser": "",
        "whisper_model": "base", "ocr_every": 0,
        "semantic": True, "embed_model": "BAAI/bge-small-en-v1.5",
        "web_expansion": True,
    }

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.settings_path = data_dir / "settings.json"
        self.syn_path = data_dir / "synonyms.json"
        self.settings = dict(self.DEFAULTS)
        self.access_key = ""
        if self.settings_path.exists():
            try:
                saved = json.loads(self.settings_path.read_text())
                self.access_key = saved.pop("access_key", "")
                self.settings.update(saved)
            except (OSError, ValueError):
                pass
        if not self.access_key:
            self.reset_key()
        self.load_synonyms()

    def _write(self):
        self.settings_path.write_text(json.dumps(
            dict(self.settings, access_key=self.access_key), indent=2))
        try:
            self.settings_path.chmod(0o600)
        except OSError:
            pass

    def reset_key(self):
        self.access_key = secrets.token_urlsafe(9)
        self._write()
        return self.access_key

    def save_settings(self, new: dict):
        for k in self.DEFAULTS:
            if k in new:
                self.settings[k] = new[k]
        self._write()

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
