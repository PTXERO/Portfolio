"""'More like this': blend of meaning, shared words, hashtags, creator,
and items you liked together in the same topics."""

import math
from collections import Counter

from .db import FTS_WEIGHTS
from .search import fts_quote
from .util import tokens


def key_terms(db, it, n=16):
    """Most distinctive words of an item by TF-IDF (no stopword list —
    IDF from the library pushes common words down by itself)."""
    blob = " ".join(str(it.get(k) or "") for k in ("text", "hashtags", "transcript", "ocr", "tags"))
    tf = Counter(t for t in tokens(blob) if len(t) > 1 and not t.isdigit())
    for h in (it.get("hashtags") or "").lower().split():
        tf[h] += 2
    if not tf:
        return []
    N = max(db.doc_count(), 1)
    # vocab terms are porter-stemmed; approximate df via prefix lookup of the token
    vdf = db.vocab_df()
    df = {t: next((vdf[t[:len(t) - k]] for k in range(4) if t[:len(t) - k] in vdf), 1) for t in tf}
    score = {t: (1 + math.log(c)) * math.log((N + 1) / (df[t] + 0.5)) for t, c in tf.items()}
    return [t for t, _ in sorted(score.items(), key=lambda kv: -kv[1])[:n]]


def related(vault, item_id, limit=16):
    db = vault.db
    it = db.get(item_id)
    if not it:
        return [], []
    cand = Counter()
    lex, sem, tagsim, coliked = {}, {}, {}, Counter()

    terms = key_terms(db, it)
    if terms:
        rows = db.q(f"SELECT i.id, bm25(items_fts, {', '.join(map(str, FTS_WEIGHTS))}) AS bm "
                    "FROM items_fts JOIN items i ON i.rowid=items_fts.rowid "
                    "WHERE items_fts MATCH ? AND i.id != ? ORDER BY bm LIMIT 200",
                    (" OR ".join(fts_quote(t) for t in terms), item_id))
        lo = min((r["bm"] for r in rows), default=-1) or -1
        for r in rows:
            lex[r["id"]] = r["bm"] / lo
            cand[r["id"]] += 1

    e = vault.embed
    if e and e.ready():
        v = e.item_vec(item_id)
        if v is not None:
            for i, s in e.nearest(v, top=150, min_sim=0.35, exclude={item_id}).items():
                sem[i] = s
                cand[i] += 1

    mine = set((it.get("hashtags") or "").lower().split())
    if mine:
        conds = " OR ".join(["(' '||lower(hashtags)||' ') LIKE ?"] * len(mine))
        for r in db.q(f"SELECT id, hashtags FROM items WHERE id != ? AND ({conds}) LIMIT 300",
                      [item_id] + [f"% {h} %" for h in mine]):
            theirs = set((r["hashtags"] or "").lower().split())
            tagsim[r["id"]] = len(mine & theirs) / len(mine | theirs)
            cand[r["id"]] += 1

    same_author = {r["id"] for r in db.q(
        "SELECT id FROM items WHERE author=? AND platform=? AND id != ? LIMIT 50",
        (it.get("author"), it.get("platform"), item_id))} if it.get("author") else set()
    for i in same_author:
        cand[i] += 1

    for r in db.q("""SELECT b.item_id, count(*) n FROM topic_items a JOIN topic_items b
                     ON a.topic_id=b.topic_id AND b.label=1 AND b.item_id != a.item_id
                     WHERE a.item_id=? AND a.label=1 GROUP BY b.item_id""", (item_id,)):
        coliked[r["item_id"]] = r["n"]
        cand[r["item_id"]] += 1

    scored = []
    for i in cand:
        if sem:   # meaning leads; words only help when the meaning is at least close
            s = 0.6 * sem.get(i, 0) + 0.2 * lex.get(i, 0) * min(1, max(0, (sem.get(i, 0.3) - 0.3) / 0.3))
        else:
            s = 0.6 * lex.get(i, 0)
        s += (0.15 * tagsim.get(i, 0) + 0.07 * (i in same_author)
              + 0.08 * min(1, coliked.get(i, 0) / 2))
        scored.append((s, i))
    scored.sort(reverse=True)
    ids = [i for _, i in scored[:limit]]
    items = db.get_many(ids)
    out = []
    for s, i in scored[:limit]:
        r = items.get(i)
        if r:
            r.pop("segments", None)
            r["score"] = round(s, 3)
            r["why"] = [w for w, ok in (("meaning", i in sem and sem[i] > .55), ("words", i in lex),
                                        ("hashtags", i in tagsim), ("creator", i in same_author),
                                        ("liked together", i in coliked)) if ok]
            out.append(r)
    return out, terms
