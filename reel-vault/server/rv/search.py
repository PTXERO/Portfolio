"""Library search: query language, word expansion, filters, ranking, facets."""

import difflib
import re
import sqlite3

from .db import FTS_COLS, FTS_WEIGHTS
from .util import parse_date, to_float, to_int

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
    """words, "exact phrases", -exclude, #hashtag, @author, author:x tag:x
    site:x said:x screen:x; OR between words switches to match-any."""
    terms, filters, any_mode = [], {"author": [], "tag": [], "platform": []}, False
    for m in TOKEN_RE.finditer(q or ""):
        neg, field, phrase, word = m.group(1) == "-", m.group(2), m.group(3), m.group(4)
        if word == "OR" and not neg and not field:
            any_mode = True
            continue
        text = phrase if phrase is not None else word
        f = None
        if field:
            f = FIELD_ALIASES.get(field.lower())
            if f is None:
                text = f"{field}:{text}"
            elif f in ("author", "tag", "platform"):
                filters[f].append((neg, text.lstrip("@#").lower()))
                continue
        else:
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


def expand_term(term, store, db, opts):
    raw = " ".join(term["words"])
    variants = [(raw, False)]
    syns, fuzzy = [], []
    if not term["neg"] and opts.get("synonyms", True):
        syns = store.synonyms(raw)
        variants += [(s, False) for s in syns]
    if not term["phrase"]:
        if opts.get("partial", True):
            variants.append((raw, True))
        if opts.get("fuzzy", True) and not term["neg"] and len(raw) >= 4:
            cands = difflib.get_close_matches(raw, db.vocab(), n=6, cutoff=0.78)
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


SORT_KEYS = {
    "newest": (lambda r: r["posted_at"] or 0, True),
    "oldest": (lambda r: r["posted_at"] or 0, False),
    "likes": (lambda r: r["likes"] or 0, True),
    "views": (lambda r: r["views"] or 0, True),
    "reposts": (lambda r: r["reposts"] or 0, True),
    "engagement": (lambda r: (r["likes"] or 0) + 2 * (r["reposts"] or 0) + (r["replies"] or 0), True),
    "longest": (lambda r: r["duration"] or 0, True),
    "shortest": (lambda r: r["duration"] or 0, False),
    "collected": (lambda r: r["collected_at"] or 0, True),
    "author": (lambda r: (r["author"] or "").lower(), False),
    "topic": (lambda r: r.get("t_score") or 0, True),
}


def _flag(v):
    return str(v).lower() in ("1", "true", "yes", "on")


def search(db, store, p: dict, semantic=None):
    """p: flat dict of query params. semantic: optional callable
    (text) -> {item_id: similarity 0..1} used when p['meaning']=='1'."""
    terms, qfilters, any_mode = parse_query(p.get("q", ""))
    if p.get("mode") == "any":
        any_mode = True
    opts = {k: _flag(p.get(k, "1")) for k in ("synonyms", "fuzzy", "partial")}
    cols = [c for c in (p.get("fields") or "").split(",") if c]
    pos, neg, info, highlight = build_match(terms, store, db, opts, any_mode, cols)

    sem = {}
    if p.get("meaning") == "1" and semantic and p.get("q", "").strip():
        sem = semantic(p["q"]) or {}

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
    if p.get("media"):
        ms = p["media"].split(",")
        where.append(f"coalesce(i.media,'video') IN ({','.join('?' * len(ms))})")
        params += ms
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
    rng = [("date_from", "i.posted_at >= ?", parse_date),
           ("date_to", "i.posted_at <= ?", lambda v: (parse_date(v) or 0) + 86399),
           ("dur_min", "i.duration >= ?", to_float), ("dur_max", "i.duration <= ?", to_float),
           ("likes_min", "i.likes >= ?", to_int), ("views_min", "i.views >= ?", to_int)]
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

    join, tcols = "", ", NULL AS t_score, NULL AS t_label"
    if p.get("topic"):
        join = " JOIN topic_items ti ON ti.item_id = i.id AND ti.topic_id = ?"
        tcols = ", ti.score AS t_score, ti.label AS t_label"
        if p.get("topic_label") not in (None, ""):
            where.append("ti.label = ?")
            params.append(to_int(p["topic_label"]))

    w = (" AND " + " AND ".join(where)) if where else ""
    light = ("i.id, i.platform, i.author, i.hashtags, i.tags, i.media, i.posted_at, i.likes, "
             "i.views, i.reposts, i.replies, i.duration, i.collected_at")
    jparams = [p["topic"]] if p.get("topic") else []
    try:
        if pos:
            base = (f"SELECT {light}{tcols}, bm25(items_fts, {', '.join(map(str, FTS_WEIGHTS))}) AS bm "
                    f"FROM items_fts JOIN items i ON i.rowid = items_fts.rowid{join} "
                    f"WHERE items_fts MATCH ?{w}")
            rows = db.q(base, jparams + [pos] + params)
            if sem:
                have = {r["id"] for r in rows}
                best = max(sem.values())
                cut = max(0.6, best - 0.12)       # meaning-only matches must be close calls
                extra = [i for i, s in sem.items() if i not in have and s >= cut]
                if extra:
                    ph = ",".join("?" * len(extra))
                    rows += db.q(f"SELECT {light}{tcols}, 0 AS bm FROM items i{join} "
                                 f"WHERE i.id IN ({ph}){w}", jparams + extra + params)
        elif sem:
            best = max(sem.values())
            keep = [i for i, s in sem.items() if s >= max(0.6, best - 0.12)]
            rows = db.q(f"SELECT {light}{tcols}, 0 AS bm FROM items i{join} "
                        f"WHERE i.id IN ({','.join('?' * len(keep))}){w}", jparams + keep + params) if keep else []
        else:
            rows = db.q(f"SELECT {light}{tcols}, 0 AS bm FROM items i{join} WHERE 1=1{w}",
                        jparams + params)
    except sqlite3.OperationalError as e:
        return {"error": f"Bad query: {e}", "items": [], "total": 0,
                "expansions": info, "highlight": highlight, "facets": {}}

    # ranking: bm25 is negative (lower = better) → normalize to 0..1
    if rows and (pos or sem):
        lo = min(r["bm"] for r in rows)
        for r in rows:
            lex = (r["bm"] / lo) if lo else 0
            r["rank"] = lex * (0.55 if sem else 1.0) + sem.get(r["id"], 0) * (0.45 if sem else 0)
    else:
        for r in rows:
            r["rank"] = 0
    sort = p.get("sort") or "relevance"
    if sort in SORT_KEYS:
        key, rev = SORT_KEYS[sort]
        rows.sort(key=key, reverse=rev)
    elif pos:
        rows.sort(key=lambda r: (-r["rank"], -(r["posted_at"] or 0)))
    elif p.get("topic"):
        rows.sort(key=lambda r: -(r["t_score"] or 0))
    else:
        rows.sort(key=lambda r: -(r["posted_at"] or 0))

    limit = max(1, min(to_int(p.get("limit"), 60), 500))
    offset = max(0, to_int(p.get("offset"), 0))
    page = rows[offset:offset + limit]
    full = db.get_many(r["id"] for r in page)
    items = []
    for r in page:
        it = full.get(r["id"])
        if it:
            it.pop("segments", None)
            it["score"] = round(r["rank"], 4)
            it["t_score"], it["t_label"] = r["t_score"], r["t_label"]
            items.append(it)

    def top(counter, n):
        return [{"value": k, "count": v} for k, v in
                sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]

    plat, auth, hashes, tags, media = {}, {}, {}, {}, {}
    for r in rows:
        pl = r["platform"] or "?"
        plat[pl] = plat.get(pl, 0) + 1
        md = r["media"] or "video"
        media[md] = media.get(md, 0) + 1
        if r["author"]:
            auth[r["author"]] = auth.get(r["author"], 0) + 1
        for h in (r["hashtags"] or "").split():
            hashes[h.lower()] = hashes.get(h.lower(), 0) + 1
        for t in (r["tags"] or "").split():
            tags[t] = tags.get(t, 0) + 1
    return {
        "total": len(rows), "items": items, "offset": offset, "limit": limit,
        "expansions": info, "highlight": highlight, "meaning": bool(sem),
        "facets": {"platform": top(plat, 30), "author": top(auth, 25),
                   "hashtag": top(hashes, 30), "tag": top(tags, 30), "media": top(media, 5)},
    }
