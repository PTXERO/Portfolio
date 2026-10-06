"""Optional semantic understanding (pip install fastembed).

Turns each item's caption + hashtags + speech + on-screen text into a
vector, so "dog on a skateboard" can find "puppy skating" with no shared
words. Used for MEANING search, topic taste, and related videos.
Everything still works without it, just with word-based matching only.
"""

import importlib.util
import threading
from array import array

MAX_CHARS = 1500


def item_text(it):
    return " ".join(x for x in (
        (it.get("text") or "")[:700], it.get("hashtags") or "", it.get("author_name") or "",
        (it.get("transcript") or "")[:600], (it.get("ocr") or "")[:200]) if x)[:MAX_CHARS]


class Embedder:
    def __init__(self, vault):
        self.v = vault
        self.lock = threading.RLock()
        self.model = None
        self.model_name = None
        self.error = ""
        self._np = None
        self._mat = None          # (ids, matrix, version)
        self.installed = importlib.util.find_spec("fastembed") is not None \
            and importlib.util.find_spec("numpy") is not None

    def enabled(self):
        return self.installed and bool(self.v.store.settings.get("semantic", True))

    def ready(self):
        """True when vectors can be used right now (model loaded or vectors stored)."""
        if not self.enabled():
            return False
        return self.model is not None or bool(self.v.db.one("SELECT 1 FROM vectors LIMIT 1"))

    def _load(self):
        with self.lock:
            name = self.v.store.settings.get("embed_model") or "BAAI/bge-small-en-v1.5"
            if self.model is not None and self.model_name == name:
                return self.model
            try:
                import numpy as np
                from fastembed import TextEmbedding
                self._np = np
                self.model = TextEmbedding(name, cache_dir=str(self.v.data_dir / "models"))
                self.model_name = name
                self.error = ""
            except Exception as e:      # noqa: BLE001 — download/offline problems
                self.model, self.error = None, str(e)
            return self.model

    def embed(self, texts):
        m = self._load()
        if m is None:
            return []
        with self.lock:
            out = []
            for v in m.embed(list(texts), batch_size=32):
                n = float(self._np.linalg.norm(v)) or 1.0
                out.append((v / n).astype("float32"))
            return out

    def text_vec(self, text):
        if not self.enabled():
            return None
        vs = self.embed([text])
        return vs[0] if vs else None

    def ensure(self, item_ids=None, log=None, check=None):
        """Compute missing vectors. Returns how many were added."""
        if not self.enabled() or self._load() is None:
            return 0
        db = self.v.db
        name = self.model_name
        if item_ids is None:
            rows = db.q("SELECT i.id FROM items i LEFT JOIN vectors v ON v.item_id=i.id "
                        "WHERE v.item_id IS NULL OR v.model != ?", (name,))
            item_ids = [r["id"] for r in rows]
        else:
            have = {r["item_id"] for r in db.q("SELECT item_id FROM vectors WHERE model=?", (name,))}
            item_ids = [i for i in item_ids if i not in have]
        done = 0
        for i in range(0, len(item_ids), 64):
            if check:
                check()
            chunk = db.get_many(item_ids[i:i + 64])
            ids = list(chunk)
            vecs = self.embed(item_text(chunk[k]) for k in ids)
            db.many("INSERT OR REPLACE INTO vectors(item_id, model, dim, vec) VALUES (?,?,?,?)",
                    [(k, name, len(v), array("f", v.tolist()).tobytes()) for k, v in zip(ids, vecs)])
            done += len(ids)
            if log and len(item_ids) > 64:
                log(f"  🧠 understood {done}/{len(item_ids)}")
        return done

    def _matrix(self):
        db = self.v.db
        np = self._np or __import__("numpy")
        self._np = np
        if self._mat and self._mat[2] == db.version:
            return self._mat
        rows = db.q("SELECT item_id, vec FROM vectors WHERE model=?",
                    (self.model_name or self.v.store.settings.get("embed_model"),))
        if not rows:
            self._mat = ([], None, db.version, {})
            return self._mat
        mat = np.vstack([np.frombuffer(r["vec"], dtype="float32") for r in rows])
        ids = [r["item_id"] for r in rows]
        self._mat = (ids, mat, db.version, {i: n for n, i in enumerate(ids)})
        return self._mat

    def item_vec(self, item_id):
        if not self.enabled():
            return None
        ids, mat, _, index = self._matrix()
        n = index.get(item_id)
        return None if n is None else mat[n]

    def mean(self, item_ids):
        vs = [v for v in (self.item_vec(i) for i in item_ids) if v is not None]
        if not vs:
            return None
        m = sum(vs) / len(vs)
        return m / (float(self._np.linalg.norm(m)) or 1.0)

    def dot(self, a, b):
        return float(a @ b)

    def nearest(self, vec, top=300, min_sim=0.3, exclude=()):
        ids, mat, _, _ = self._matrix()
        if mat is None or vec is None:
            return {}
        sims = mat @ vec
        order = sims.argsort()[::-1][:top + len(exclude)]
        return {ids[i]: float(sims[i]) for i in order
                if sims[i] >= min_sim and ids[i] not in exclude}

    def search(self, text, top=300):
        v = self.text_vec(text)
        return self.nearest(v, top=top, min_sim=0.35) if v is not None else {}
