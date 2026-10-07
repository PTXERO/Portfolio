"""Account profiles and the connection web (WEB view) — server-side port of
searchnet-graph.js, so the PC server offers the same thing browser mode does.

PURPOSE: find related content. For every account whose public posts have been
collected, summarise WHAT they post (topics, hashtags, media, cadence) and how
accounts connect through SHARED CONTENT (hashtags, vocabulary, mentions).

ETHICS, enforced here by design:
  * only accounts the user collected, only from their own public posts
  * nothing sensitive is ever inferred (sexuality, politics, religion, health,
    real identity); labels are user-typed, stored locally, shown as the user's
    own notes
  * no cross-platform de-anonymisation: each account stands on its own, and a
    "same person" link is only ever one the user adds by hand
  * everything stays on the user's machine
"""

import json
import math
import re
import statistics
import time
import urllib.parse
import uuid
from .learn import member_ids
from collections import Counter, defaultdict
from pathlib import Path

STOP = set(("a an and are as at be but by for from has have he her his i in into is it its just me "
            "my no not of on or our so that the their them then there these they this to too up us "
            "was we were what when which who will with you your rt via amp http https www com de la "
            "el en que un").split())
_TOK = re.compile(r"[^\W_]+", re.UNICODE)
_URL = re.compile(r"https?://\S+")
_MENTION = re.compile(r"(?:^|[^\w@])@([a-z0-9_.]{2,})", re.IGNORECASE)


def _tokens(t):
    return _TOK.findall(_URL.sub(" ", str(t or "").lower()))


def _mentions(t):
    return {m.rstrip(".").lower() for m in _MENTION.findall(_URL.sub(" ", str(t or "")))}   # never from inside a URL


_TAG_IN_TEXT = re.compile(r"(?:^|\s)#(\w{2,})", re.UNICODE)


def _hashes(it):
    h = {x for x in str(it.get("hashtags") or "").lower().split() if x}
    if not h:                                   # YouTube etc. write their #tags in the description
        h = {m.lower() for m in _TAG_IN_TEXT.findall(str(it.get("text") or ""))}
    return h


OUTLETS = {"news", "web", "archive", "wikipedia"}          # publishers, not people
_CONNECT = {"of", "the", "and", "de", "du", "von", "van", "&", "da", "del", "la", "le"}
_ENT_LEAD = {"the", "a", "an", "this", "that", "our", "my", "his", "her", "their", "its", "i", "we", "you", "it", "in", "on",
             "at", "for", "to", "from", "by", "with", "as", "but", "and", "or", "if", "so", "when", "after", "before", "breaking",
             "update", "watch", "live", "new", "video", "photo", "photos", "read", "more", "here", "now", "just", "why", "how", "what"}


def _entities(text, skip=()):
    """Named things written in a post: runs of 2–4 capitalised words ("Ocean Isle Beach", "Duke Energy",
    "Gov. Ron DeSantis"). The one real cross-source link articles offer. skip = the topic's own words."""
    out, seen = [], set()
    skip = {w.lower() for w in skip}
    for sentence in re.split(r"[.!?\n:;,()\[\]\"“”|]+| [—–-] ", str(text or "")):
        words = re.findall(r"[A-Za-z][\w'’.-]*|&", sentence)
        run = []
        def flush():
            while run and run[0].lower() in _ENT_LEAD | _CONNECT:
                run.pop(0)
            while run and run[-1].lower() in _CONNECT:
                run.pop()
            if 2 <= len(run) <= 4:
                low = " ".join(w.lower().strip(".'’") for w in run)
                if low not in seen and not all(w in skip or w in STOP for w in low.split()) and len(out) < 8:
                    seen.add(low)
                    out.append(low)
            run.clear()
        for w in words:
            if w[0].isupper() or (run and w.lower() in _CONNECT):
                run.append(w)
            else:
                flush()
        flush()
    return out


def _pid(it):
    return f"{str(it.get('author') or '?').lower()}|{it.get('platform') or '?'}"   # one handle = one account, any case


def _post_key(it):
    """A tweet with four images is four items; 'posts' counts the tweet once."""
    return f"{it.get('platform') or ''}:{it['post_id']}" if it.get("post_id") else re.sub(r"_\d+$", "", str(it.get("id") or ""))


def _n_posts(items):
    return len({_post_key(it) for it in items})


def _median(xs):
    xs = [x for x in xs if x is not None]
    return int(statistics.median(xs)) if xs else 0


def _now():
    return int(time.time())


# ── user-added meta (notes / own labels / hand links) — a JSON file, local ──
def _meta_path(v) -> Path:
    return Path(v.data_dir) / "people.json"


def _all_meta(v):
    p = _meta_path(v)
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except (OSError, ValueError):
        return {}


def get_meta(v, pid):
    return _all_meta(v).get(pid) or {"notes": "", "attrs": [], "links": []}


def set_meta(v, pid, patch):
    allm = _all_meta(v)
    m = dict({"notes": "", "attrs": [], "links": []}, **(allm.get(pid) or {}))
    if "notes" in patch:
        m["notes"] = str(patch.get("notes") or "")[:4000]
    if "attrs" in patch:
        seen, out = set(), []
        for a in patch.get("attrs") or []:
            a = str(a).strip()
            if a and a not in seen:
                seen.add(a)
                out.append(a)
        m["attrs"] = out[:40]
    if "links" in patch:
        m["links"] = list(dict.fromkeys(str(x) for x in (patch.get("links") or []) if x))[:40]
    allm[pid] = m
    _meta_path(v).write_text(json.dumps(allm, indent=1))
    return m


# ── identities: one person, several accounts (possibly on several networks). Every link is one the
#    user made, each with its reason ('you', 'post link', 'bio link', 'name match'). Never inferred. ──
def _ident_path(v) -> Path:
    return Path(v.data_dir) / "identities.json"


def identities(v):
    p = _ident_path(v)
    try:
        return json.loads(p.read_text()) if p.exists() else []
    except (OSError, ValueError):
        return []


def _acc_key(aid):
    return str(aid or "").lstrip("@").lower()


def identity_dto(i):
    return {"id": i["id"], "name": i.get("name") or "", "note": i.get("note") or "", "topic_id": i.get("topic_id"),
            "created": i.get("created"),
            "accounts": [{"id": a["id"], "handle": str(a["id"]).split("|")[0], "platform": (str(a["id"]).split("|") + [""])[1],
                          "how": a.get("how") or "you", "added": a.get("added")} for a in i.get("accounts") or []]}


def identity_write(v, method, iid, body):
    body = body or {}
    lst = identities(v)
    if method == "POST":
        i = {"id": uuid.uuid4().hex[:8], "name": str(body.get("name") or "").strip()[:120] or "unnamed",
             "note": str(body.get("note") or "")[:2000], "accounts": [], "topic_id": body.get("topic_id"), "created": _now()}
        for a in body.get("accounts") or []:
            aid = (a if isinstance(a, str) else a.get("id") or "").lstrip("@")
            if not aid:
                continue
            for o in lst:                                   # an account belongs to one person
                o["accounts"] = [x for x in o.get("accounts") or [] if _acc_key(x["id"]) != _acc_key(aid)]
            if not any(_acc_key(x["id"]) == _acc_key(aid) for x in i["accounts"]):
                i["accounts"].append({"id": aid, "how": (a.get("how") if isinstance(a, dict) else None) or "you", "added": _now()})
        lst.append(i)
        _ident_path(v).write_text(json.dumps(lst, indent=1))
        return identity_dto(i)
    i = next((x for x in lst if x["id"] == iid), None)
    if not i:
        return {"error": "no such person"}
    if method == "DELETE":
        _ident_path(v).write_text(json.dumps([x for x in lst if x["id"] != iid], indent=1))
        return {"ok": True}
    if "name" in body:
        i["name"] = str(body.get("name") or "").strip()[:120] or i["name"]
    if "note" in body:
        i["note"] = str(body.get("note") or "")[:2000]
    if "topic_id" in body:
        i["topic_id"] = body.get("topic_id")
    for a in body.get("add") or []:
        aid = (a if isinstance(a, str) else a.get("id") or "").lstrip("@")
        if not aid:
            continue
        for o in lst:                                   # an account belongs to one person
            if o["id"] != i["id"]:
                o["accounts"] = [x for x in o.get("accounts") or [] if _acc_key(x["id"]) != _acc_key(aid)]
        if not any(_acc_key(x["id"]) == _acc_key(aid) for x in i["accounts"]):
            i["accounts"].append({"id": aid, "how": (a.get("how") if isinstance(a, dict) else None) or "you", "added": _now()})
    for aid in body.get("remove") or []:
        i["accounts"] = [x for x in i["accounts"] if _acc_key(x["id"]) != _acc_key(aid)]
    _ident_path(v).write_text(json.dumps(lst, indent=1))
    return identity_dto(i)


# ── aggregates over collected items ──
class _Acct:
    __slots__ = ("id", "author", "platform", "author_url", "author_name", "items", "H", "W", "M",
                 "F", "FB", "FN", "FBN", "FAT", "I")

    def __init__(self, id_, it):
        self.id, self.author, self.platform = id_, it.get("author") or "?", it.get("platform") or "?"
        self.author_url, self.author_name = it.get("author_url") or "", it.get("author_name") or ""
        self.items, self.H, self.W, self.M = [], set(), set(), set()
        self.F, self.FB, self.FN, self.FBN, self.FAT = set(), set(), 0, 0, 0   # follows / followed-by (ids in library)
        self.I = None                                                          # the identity (person) this account belongs to


def _build(v):
    rows = v.db.q("SELECT id, platform, author, author_name, url, media_url, text, hashtags, lang, post_id, "
                  "posted_at, duration, likes, views, media, thumbnail, transcript, tags FROM items "
                  "WHERE coalesce(author,'') != ''")
    by = {}
    for it in rows:
        a = by.get(_pid(it))
        if a is None:
            by[_pid(it)] = a = _Acct(_pid(it), it)
        a.items.append(it)
        a.author_url = a.author_url or (it.get("url") or "")
        a.author_name = a.author_name or (it.get("author_name") or "")
    h_df, w_df = Counter(), Counter()
    for a in by.values():
        for it in a.items:
            a.H |= _hashes(it)
            a.W |= {w for w in _tokens(it.get("text")) if len(w) > 3 and w not in STOP}
            a.M |= _mentions(it.get("text"))
        h_df.update(a.H)
        w_df.update(a.W)
    # real relationships pulled from the platforms' public graphs (LOAD FOLLOWS / INTEGRATE)
    lower = {a.id.lower(): a for a in by.values()}
    for r in _relations(v):
        src, dst = lower.get(str(r["src"]).lower()), lower.get(str(r["dst"]).lower())
        if src:
            src.FAT = max(src.FAT, r["ts"] or 0)
            if r["kind"] == "follows":
                src.FN += 1
            else:
                src.FBN += 1
        if src and dst:
            if r["kind"] == "follows":
                src.F.add(dst.id)
                dst.FB.add(src.id)
            else:
                src.FB.add(dst.id)
                dst.F.add(src.id)
    idx = {}
    for i in identities(v):
        for a in i.get("accounts") or []:
            idx[_acc_key(a["id"])] = i
    for a in by.values():
        a.I = idx.get(_acc_key(a.id))
    n = max(1, len(by))
    idf = lambda df: math.log((n + 1) / ((df or 0) + 1)) + 1  # noqa: E731
    return by, idf, h_df, w_df


def _relations(v, src=None):
    try:
        if src:
            return v.db.q("SELECT src, dst, kind, ts, name, url, posts FROM relations WHERE lower(src)=lower(?)", (src,))
        return v.db.q("SELECT src, dst, kind, ts FROM relations")
    except Exception:  # noqa: BLE001 — an older library file without the table
        return []


def _vote_index(v):
    by_item = defaultdict(list)
    for r in v.db.q("SELECT topic_id, item_id, label, score FROM topic_items"):
        by_item[r["item_id"]].append(r)
    names = {t["id"]: t["name"] for t in v.db.q("SELECT id, name FROM topics")}
    return by_item, names


def _cadence(items):
    hours, wdays = [0] * 24, [0] * 7
    lo, hi, n = None, 0, 0
    for it in items:
        ts = it.get("posted_at")
        if not ts:
            continue
        n += 1
        t = time.gmtime(ts)
        hours[t.tm_hour] += 1
        wdays[(t.tm_wday + 1) % 7] += 1          # Sunday-first, like the JS
        lo = ts if lo is None else min(lo, ts)
        hi = max(hi, ts)
    span = max(1.0, (hi - lo) / 86400) if lo is not None else 0
    return {"hours": hours, "weekdays": wdays, "first": lo, "last": hi or None,
            "span_days": round(span), "per_week": round(n / (span / 7), 1) if span else 0}


def _top(items, pick, n=12):
    c = Counter()
    for it in items:
        c.update(x for x in pick(it) if x)
    return [{"value": k, "count": cnt} for k, cnt in c.most_common(n)]


def _edge(a, b, idf, h_df, w_df):
    w, hn, wn, hs, ws = 0.0, 0, 0, 0.0, 0.0
    for h in a.H & b.H:
        hs += idf(h_df[h])
        hn += 1
    for x in a.W & b.W:
        ws += 0.5 * idf(w_df[x])
        wn += 1
    ment = a.platform == b.platform and (a.author.lower() in b.M or b.author.lower() in a.M)   # same network only
    fol = b.id in a.F or a.id in b.F        # the platform itself says these two are linked
    w = hs + ws + (3 if ment else 0) + (4 if fol else 0) + (5 if _same_person(a, b) else 0)
    return w, hn, wn, ment, fol


def _same_person(a, b):
    return bool(a.I and b.I and a.I["id"] == b.I["id"])


def _parts(a, b, idf, h_df, w_df, ment, fol):
    """How much of a connection came from each kind: m mention · f follow · h shared hashtags · s shared words · i same person."""
    return {"m": 3 if ment else 0, "f": 4 if fol else 0,
            "h": round(sum(idf(h_df[h]) for h in a.H & b.H), 2),
            "s": round(sum(0.5 * idf(w_df[x]) for x in a.W & b.W), 2),
            "i": 5 if _same_person(a, b) else 0}


def _tier(ment, fol, hn, same=False):
    return 1 if (ment or fol or same) else 2 if hn else 3


def profile(v, pid):
    by, idf, h_df, w_df = _build(v)
    a = by.get(pid) or by.get(str(pid).lower())
    if not a:
        return {"error": "no account"}
    pid = a.id
    by_item, names = _vote_index(v)
    items = a.items
    media = Counter((it.get("media") or "video") for it in items)
    words = _top(items, lambda it: [w for w in _tokens(it.get("text")) if len(w) > 3 and w not in STOP], 40)
    for x in words:
        x["w"] = round(x["count"] * idf(w_df[x["value"]]), 1)
    words = sorted(words, key=lambda x: -x["w"])[:12]
    tstat = {}
    for it in items:
        for r in by_item.get(it["id"], []):
            s = tstat.setdefault(r["topic_id"], {"topic_id": r["topic_id"], "name": names.get(r["topic_id"], "?"),
                                                 "matched": 0, "liked": 0, "disliked": 0, "score": 0.0})
            s["matched"] += 1
            s["liked"] += 1 if (r["label"] or 0) > 0 else 0
            s["disliked"] += 1 if (r["label"] or 0) < 0 else 0
            s["score"] += r["score"] or 0
    topics = sorted(({**s, "score": round(s["score"] / s["matched"], 3)} for s in tstat.values()),
                    key=lambda s: -s["matched"])
    edges = []
    for b in by.values():
        if b.id == a.id:
            continue
        w, hn, wn, ment, fol = _edge(a, b, idf, h_df, w_df)
        if w > 0:
            same = _same_person(a, b)
            why = (([{"kind": "hashtags", "n": hn}] if hn else []) + ([{"kind": "mentions"}] if ment else [])
                   + ([{"kind": "follows", "mutual": b.id in a.F and a.id in b.F}] if fol else [])
                   + ([{"kind": "identity", "name": a.I["name"]}] if same else []))
            edges.append({"id": b.id, "author": b.author, "platform": b.platform, "author_url": b.author_url,
                          "w": round(w, 2), "why": why, "shared_hashtags": hn, "shared_words": wn,
                          "t": _tier(ment, fol, hn, same), "p": _parts(a, b, idf, h_df, w_df, ment, fol)})
    edges.sort(key=lambda e: -e["w"])
    recent = sorted((it for it in items if it.get("media_url") or it.get("thumbnail") or it.get("url")),
                    key=lambda it: -(it.get("posted_at") or 0))[:8]
    ment = Counter()
    for it in items:
        for m in _mentions(it.get("text")):
            if m != a.author.lower():
                ment[m] += 1
    lower = {x.id.lower(): x for x in by.values()}

    def rel_out(kind):
        rows = [r for r in _relations(v, pid) if r["kind"] == kind]
        known, unknown = [], []
        for r in rows:
            b = lower.get(str(r["dst"]).lower())
            if b:
                known.append({"id": b.id, "author": b.author, "n": len(b.items)})
            else:
                unknown.append({"id": r["dst"], "handle": str(r["dst"]).split("|")[0], "name": r["name"] or "",
                                "url": r["url"] or "", "posts": r["posts"] or 0})
        known.sort(key=lambda x: -x["n"])
        unknown.sort(key=lambda x: -x["posts"])
        return {"n": len(rows), "known": known, "unknown": unknown[:40]}

    return {
        "identity": identity_dto(a.I) if a.I else None,
        "follows": rel_out("follows"), "followed_by": rel_out("followed_by"), "follows_loaded": a.FAT,
        "follows_supported": a.platform in ("mastodon", "bluesky"),
        "id": pid, "author": a.author, "author_name": a.author_name, "platform": a.platform,
        "author_url": a.author_url, "n": _n_posts(items), "items_n": len(items), **_cadence(items), "media": dict(media),
        "dur_median": _median([it.get("duration") for it in items if (it.get("duration") or 0) > 0]),
        "likes_median": _median([it.get("likes") or 0 for it in items]),
        "views_median": _median([it.get("views") or 0 for it in items]),
        "langs": _top(items, lambda it: [it.get("lang")] if it.get("lang") else [], 6),
        "hashtags": _top(items, lambda it: list(_hashes(it))), "words": words,
        "topics": topics, "connected": edges[:12],
        "mentions_out": [{"handle": h, "count": c, "known": f"{h}|{a.platform}" in by}
                         for h, c in ment.most_common(10)],
        "recent": [{"id": it["id"], "text": (it.get("text") or "")[:160], "media": it.get("media"),
                    "thumbnail": it.get("thumbnail"), "url": it.get("url"), "posted_at": it.get("posted_at"),
                    "likes": it.get("likes")} for it in recent],
        "meta": get_meta(v, pid),
    }


def graph(v, topic=None, max_nodes=60, min_w=1.5, platform="", role=""):
    by, idf, h_df, w_df = _build(v)
    if role == "person":
        by = {k: a for k, a in by.items() if a.platform not in OUTLETS}
    elif role == "outlet":
        by = {k: a for k, a in by.items() if a.platform in OUTLETS}
    by_item, _ = _vote_index(v)
    accts = list(by.values())
    if topic:
        ids = member_ids(v.db, topic)
        accts = [a for a in accts if any(it["id"] in ids for it in a.items)]
    if platform:
        accts = [a for a in accts if a.platform == platform]
    accts.sort(key=lambda a: -_n_posts(a.items))
    top = accts[:min(max_nodes or 60, 120)]
    top_ids = {a.id for a in top}
    meta = _all_meta(v)
    strength, edges = Counter(), []
    for i, a in enumerate(top):
        for b in top[i + 1:]:
            w, hn, wn, ment, fol = _edge(a, b, idf, h_df, w_df)
            same = _same_person(a, b)
            if w >= min_w or ment or fol or same:
                edges.append({"a": a.id, "b": b.id, "w": round(w, 2), "h": hn, "m": 1 if (ment or fol or same) else 0,
                              "f": 1 if fol else 0, "t": _tier(ment, fol, hn, same),
                              "p": _parts(a, b, idf, h_df, w_df, ment, fol)})
                strength[a.id] += w
                strength[b.id] += w
    for a in top:
        for lid in (meta.get(a.id) or {}).get("links", []):
            if lid in top_ids and not any({e["a"], e["b"]} == {a.id, lid} for e in edges):
                edges.append({"a": a.id, "b": lid, "w": 2, "h": 0, "m": 0, "you": 1, "t": 1,
                              "p": {"m": 0, "f": 2, "h": 0, "s": 0}})
    nodes = [{"id": a.id, "author": a.author, "platform": a.platform, "n": _n_posts(a.items),
              "identity": a.I["name"] if a.I else None, "identity_id": a.I["id"] if a.I else None,
              "strength": round(strength[a.id], 1), "attrs": (meta.get(a.id) or {}).get("attrs", [])[:4],
              "topics": len({r["topic_id"] for it in a.items for r in by_item.get(it["id"], [])})} for a in top]
    return {"nodes": nodes, "edges": edges, "total_accounts": len(by), "shown": len(nodes), "generated": _now()}


def list_people(v, topic=None, q="", sort="", platform="", role=""):
    by, idf, h_df, w_df = _build(v)
    if role == "person":
        by = {k: a for k, a in by.items() if a.platform not in OUTLETS}
    elif role == "outlet":
        by = {k: a for k, a in by.items() if a.platform in OUTLETS}
    by_item, names = _vote_index(v)
    meta = _all_meta(v)
    rows = list(by.values())
    platforms = dict(Counter(a.platform for a in rows))
    if topic:
        ids = member_ids(v.db, topic)
        rows = [a for a in rows if any(it["id"] in ids for it in a.items)]
    if platform:
        rows = [a for a in rows if a.platform == platform]
    if q:
        ql = q.lower()
        rows = [a for a in rows if ql in f"{a.author} {a.author_name}".lower()]
    out = []
    for a in rows:
        cad = _cadence(a.items)
        tset = {names.get(r["topic_id"]) for it in a.items for r in by_item.get(it["id"], [])}
        out.append({"id": a.id, "author": a.author, "author_name": a.author_name, "platform": a.platform,
                    "author_url": a.author_url, "n": _n_posts(a.items), "per_week": cad["per_week"], "last": cad["last"],
                    "identity": a.I["name"] if a.I else None, "identity_id": a.I["id"] if a.I else None,
                    "follows": a.FN, "followed_by": a.FBN,
                    "topics": [t for t in tset if t][:4],
                    "media": dict(Counter((it.get("media") or "video") for it in a.items)),
                    "hashtags": [x["value"] for x in _top(a.items, lambda it: list(_hashes(it)), 4)],
                    "attrs": (meta.get(a.id) or {}).get("attrs", [])[:4],
                    "has_notes": bool((meta.get(a.id) or {}).get("notes"))})
    key = {"active": lambda x: -(x["last"] or 0), "cadence": lambda x: -x["per_week"],
           "name": lambda x: x["author"].lower(),
           "network": lambda x: (x["platform"], -x["n"]),
           "follows": lambda x: (-(x["follows"] + x["followed_by"]), -x["n"])}.get(sort, lambda x: -x["n"])
    out.sort(key=key)
    return {"people": out, "total": len(out), "platforms": platforms}


# ── the WORD web: @accounts + #hashtags + words/"phrases" as one graph ──
_WORD_MIN = 3
# words that are about the platform, not the subject
BOILER = set(("video videos watch watching subscribe subscribed follow following like likes liked share shares "
              "comment comments channel link links bio click clicks free download full official episode part parts "
              "live stream streaming streamed check today tonight tomorrow yesterday week weekend month year years "
              "day days hours minutes time new news music song songs sound sounds audio youtube tiktok instagram "
              "twitter facebook reddit mastodon bluesky shorts short reel reels post posts posted thread update "
              "updates premiere viral trending credit credits source sources original repost reposted http https "
              "www com").split())


def _parse_focus(f):
    f = str(f or "").strip()
    if not f:
        return None
    if f[0] == "@":
        return {"kind": "account", "key": f[1:].lower()}
    if f[0] == "#":
        return {"kind": "hashtag", "key": re.sub(r"[^\w]+", "", f[1:].lower())}
    m = re.match(r'^"(.+)"$', f)
    txt = (m.group(1) if m else f).lower().strip()
    return {"kind": "word", "key": txt, "phrase": " " in txt}


def word_graph(v, focus="", kinds="account,hashtag,word,entity", max_nodes=80, platform="", topic="", hops=2, via="", merge=False, role=""):
    by, idf, h_df, w_df = _build(v)
    if platform:
        by = {k: a for k, a in by.items() if a.platform == platform}
    if topic:                                   # only what is in this topic: 👍, or unrated above the bar; never 👎
        ids = member_ids(v.db, topic)
        kept = {}
        for k, a in by.items():
            a.items = [it for it in a.items if it["id"] in ids]
            if a.items:
                kept[k] = a
        by = kept
    if role == "person":
        by = {k: a for k, a in by.items() if a.platform not in OUTLETS}
    elif role == "outlet":
        by = {k: a for k, a in by.items() if a.platform in OUTLETS}
    seed_words = set()
    if topic:
        trow = v.db.one("SELECT seeds, name FROM topics WHERE id=?", (topic,))
        if trow:
            seed_words = {w for s in json.loads(trow["seeds"] or "[]") + [trow["name"]] for w in _tokens(s)}
    kinds = {k for k in str(kinds).split(",") if k}
    cap = min(int(max_nodes or 80), 160)
    fz = _parse_focus(focus)
    node_w, edge_w, kind_of, node_n = Counter(), Counter(), {}, Counter()   # node_n = posts behind each node

    edge_t = {}   # best (lowest) tier seen for the pair: 1 real relationship · 2 shared hashtag · 3 shared words
    edge_p = {}   # how much of the weight came from each kind: m mention · f follow · h shared hashtag · s shared words

    def link(a, b, w, t=3, kind="s"):
        if a != b:
            k = (a, b) if a < b else (b, a)
            edge_w[k] += w
            edge_t[k] = min(edge_t.get(k, 9), t)
            edge_p.setdefault(k, {"m": 0.0, "f": 0.0, "h": 0.0, "s": 0.0, "i": 0.0, "e": 0.0})[kind] += w

    acct_key = {}
    # words in more than a third of all posts are boilerplate here ("video", "new"…) and would
    # bridge every community into one blob, so they're left out of the web
    post_df, n_posts = Counter(), 0
    for a in by.values():
        aid = f"@{a.author.lower()}|{a.platform}"
        acct_key[aid] = a.id
        kind_of[aid] = "account"
        for it in a.items:
            n_posts += 1
            post_df.update({w for w in _tokens(it.get("text")) if len(w) > _WORD_MIN and w not in STOP})
    # …but never the word the user centred on, nor a word also used as a hashtag (a subject, not filler)
    tag_words = {h for a in by.values() for it in a.items for h in _hashes(it)}
    focus_words = set(fz["key"].split()) if fz and fz["kind"] == "word" else set()
    # platform boilerplate is named outright; the statistical net only catches words used by nearly EVERY
    # account AND in most posts (a single-topic library's own key words legitimately run high)
    acct_df = Counter()
    for a in by.values():
        acct_df.update({w for it in a.items for w in _tokens(it.get("text"))})
    n_acc = max(1, len(by))
    generic = lambda w: (w not in focus_words and w not in tag_words and  # noqa: E731
                         (w in BOILER or (n_posts >= 50 and n_acc >= 20 and post_df[w] / n_posts > 0.7
                                          and acct_df[w] / n_acc > 0.9)))
    seen_posts = set()
    for a in by.values():
        aid = f"@{a.author.lower()}|{a.platform}"
        for it in a.items:
            tags = [] if it.get("platform") == "archive" else ["#" + h for h in _hashes(it)]   # archive's "tags" are media types
            ents = ["e:" + e for e in _entities(it.get("text"), seed_words | {str(it.get("author") or "").lower()})]
            for e in ents:
                kind_of[e] = "entity"
                node_w[e] += 1.0
                node_n[e] += 1
                link(aid, e, 1.5, 2, "e")
            for i in range(len(ents)):
                for j in range(i + 1, len(ents)):
                    link(ents[i], ents[j], 1.0, 2, "e")
            words = ["w:" + w for w in {w for w in _tokens(it.get("text"))
                                        if len(w) > _WORD_MIN and w not in STOP and not generic(w)}]
            words_set = set(words)
            if fz and fz["kind"] == "word" and fz.get("phrase") and fz["key"] in str(it.get("text") or "").lower():
                words.append("w:" + fz["key"])
            for t in tags:
                kind_of[t] = "hashtag"
                node_w[t] += idf(h_df[t[1:]])
                node_n[t] += 1
                link(aid, t, 1, 2, "h")
            # real relationships written in the post: @mentions of accounts we know
            for m in _mentions(it.get("text")):
                bid = f"@{m}|{a.platform}"                 # same network only
                if kind_of.get(bid) == "account" and bid != aid:
                    link(aid, bid, 2, 1, "m")
            for w in words:
                kind_of[w] = "word"
                node_w[w] += 0.6 * idf(w_df.get(w[2:], 1))
                node_n[w] += 1
                link(aid, w, 0.6)
            if _post_key(it) not in seen_posts:
                seen_posts.add(_post_key(it))
                node_w[aid] += 1
                node_n[aid] += 1
            for i in range(len(tags)):
                for j in range(i + 1, len(tags)):
                    link(tags[i], tags[j], 1.2, 2, "h")
            # co-occurrence among the post's 12 most distinctive words (long descriptions included), and tags×words
            # co-occurrence the way text-network tools do it: terms inside a sliding 4-word window link
            # strongly, terms merely in the same post link weakly (first 40 distinctive terms, text order)
            seen_w, seq = set(), []
            for pos, w in enumerate(_tokens(it.get("text"))):
                k = "w:" + w
                if k in words_set and k not in seen_w:
                    seen_w.add(k)
                    seq.append((k, pos))
                    if len(seq) >= 40:
                        break
            for t in tags:
                for k, _ in seq:
                    link(t, k, 0.5, 3)
            for i in range(len(seq)):
                for j in range(i + 1, len(seq)):
                    link(seq[i][0], seq[j][0], 1 if seq[j][1] - seq[i][1] <= 4 else 0.25)
        for b in by.values():
            if b.id == a.id:
                continue
            w, hn, wn, ment, fol = _edge(a, b, idf, h_df, w_df)
            if w > 0:
                for kind, pw in _parts(a, b, idf, h_df, w_df, ment, fol).items():
                    if pw:
                        link(aid, f"@{b.author.lower()}|{b.platform}", pw * 0.5,
                             1 if kind in ("m", "f") else 2 if kind == "h" else 3, kind)
        # real relationships from the platform's own graph: every follow between two accounts here is tier 1
        for bid in a.F:
            b = by.get(bid)
            if b:
                link(aid, f"@{b.author.lower()}|{b.platform}", 3, 1, "f")
    # the same person on several accounts (the user's own links): tier 1, and mergeable into one node
    person_of = {}
    for i in identities(v):
        members = [m for m in ("@" + _acc_key(x["id"]) for x in i.get("accounts") or []) if kind_of.get(m) == "account"]
        for m in members:
            person_of[m] = i
        for x in range(len(members)):
            for y in range(x + 1, len(members)):
                link(members[x], members[y], 5, 1, "i")

    # ── term selection (VOSviewer): minimum occurrences, then keep the most *relevant* 60% ──
    min_occ = max(2, round(n_posts * 0.01))
    is_focus_word = lambda k: bool(fz and fz["kind"] == "word" and k == "w:" + fz["key"])  # noqa: E731
    word_ids = [k for k, kind in kind_of.items() if kind == "word"]
    scored = sorted(((k, node_n[k] * math.log((n_acc + 1) / (acct_df[k[2:]] + 1)))
                     for k in word_ids if node_n[k] >= min_occ or is_focus_word(k)), key=lambda p: -p[1])
    keep_w = {k for k, _ in scored[:max(10, math.ceil(len(scored) * 0.6))]} | {k for k, _ in scored if is_focus_word(k)}
    for k in word_ids:
        if k not in keep_w:
            kind_of.pop(k, None)
            node_w.pop(k, None)
    for k in [k for k, kind in kind_of.items() if kind == "entity"]:
        accts = {a for (a, b) in edge_w if (a == k or b == k) for a in ((a if b == k else b),) if kind_of.get(a) == "account"}
        if node_n[k] < 2 and len(accts) < 2:
            kind_of.pop(k, None)
            node_w.pop(k, None)
    for (a, b) in list(edge_w):
        if a not in kind_of or b not in kind_of:
            del edge_w[(a, b)]
    # ── edge weights (association strength): co-occurrence vs. what chance predicts from each term ──
    for (a, b), co in list(edge_w.items()):
        if kind_of.get(a) == "account" or kind_of.get(b) == "account":
            continue
        assoc = n_posts * co / (max(1, node_n[a]) * max(1, node_n[b]))
        nw = math.sqrt(co) * math.log(1 + assoc)
        if co and (a, b) in edge_p:
            edge_p[(a, b)] = {kk: pv * nw / co for kk, pv in edge_p[(a, b)].items()}
        edge_w[(a, b)] = nw

    def nb(nid):
        out = [(y if x == nid else x, w, edge_t.get((x, y), 3)) for (x, y), w in edge_w.items() if nid in (x, y)]
        return sorted(out, key=lambda p: (p[2], -p[1]))

    focus_id = None
    if fz:
        if fz["kind"] == "account":
            focus_id = next((k for k in kind_of if k.startswith("@" + fz["key"] + "|")), None)
        elif fz["kind"] == "hashtag":
            focus_id = "#" + fz["key"]
        else:
            focus_id = "w:" + fz["key"]
    # ego network: everything within `hops` of the focus, walking only links of the kinds in `via`
    # (default: mentions, follows, shared tags — a shared word is not a hop). Nearer hops fill first,
    # strongest links first inside a hop, so the cap trims the far edge, never the inner circle.
    hop_of = {}
    if focus_id and (focus_id in kind_of or focus_id in node_w):
        hops = max(1, min(6, int(hops or 2)))
        # a word's own relationships ARE shared words, so a word focus walks them too unless told otherwise
        via_set = {x for x in str(via or ("m,f,h,e,s" if kind_of.get(focus_id) == "word" else "m,f,h,e")).split(",") if x}

        def steps(k):
            p = edge_p.get(k)
            return any(p[x] > 0 for x in via_set if x in p) if p else edge_t.get(k, 3) <= 2

        def nb_via(nid):
            out = [(y if x == nid else x, w, edge_t.get((x, y), 3)) for (x, y), w in edge_w.items()
                   if nid in (x, y) and steps((x, y))]
            return sorted(out, key=lambda p: (-p[1], p[2]))

        hop_of[focus_id] = 0
        ids, frontier = [focus_id], [focus_id]
        for h in range(1, hops + 1):
            if len(ids) >= cap:
                break
            nxt = []
            for nid in frontier:
                for k, *_ in nb_via(nid):
                    if len(ids) >= cap:
                        break
                    if k in hop_of or kind_of.get(k) not in kinds:
                        continue
                    hop_of[k] = h
                    ids.append(k)
                    nxt.append(k)
            frontier = nxt
            if not frontier:
                break
    else:
        per = {"account": round(cap * 0.35), "hashtag": round(cap * 0.2), "word": round(cap * 0.2), "entity": round(cap * 0.25)}
        ids = []
        for kind in ("account", "hashtag", "word", "entity"):
            if kind in kinds:
                ids += sorted((k for k in node_w if kind_of.get(k) == kind), key=lambda k: -node_w[k])[:per[kind]]
    # MERGE: collapse each person's accounts into one node named after them (links re-routed, counts summed)
    person_name, person_members = {}, {}
    if merge:
        alias = {k: "person:" + i["id"] for k, i in person_of.items()}
        al = lambda k: alias.get(k, k)  # noqa: E731
        nids, seen_n = [], set()
        for k in ids:
            m = al(k)
            if m != k:
                kind_of[m] = "account"
                node_n[m] += node_n[k]
                node_w[m] += node_w[k]
                if k in hop_of:
                    hop_of[m] = min(hop_of.get(m, 99), hop_of[k])
                person_name[m] = person_of[k]["name"]
                person_members.setdefault(m, []).append(k[1:])
            if m not in seen_n:
                seen_n.add(m)
                nids.append(m)
        ids = nids
        if focus_id:
            focus_id = al(focus_id)
        for (a, b) in list(edge_w.keys()):
            a2, b2 = al(a), al(b)
            if a2 == a and b2 == b:
                continue
            w, t, p = edge_w.pop((a, b)), edge_t.pop((a, b), 3), edge_p.pop((a, b), None)
            if a2 == b2:
                continue
            k2 = (a2, b2) if a2 < b2 else (b2, a2)
            edge_w[k2] += w
            edge_t[k2] = min(edge_t.get(k2, 9), t)
            q = edge_p.setdefault(k2, {"m": 0.0, "f": 0.0, "h": 0.0, "s": 0.0, "i": 0.0, "e": 0.0})
            if p:
                for kk, pv in p.items():
                    q[kk] = q.get(kk, 0) + pv
    idset = set(ids)
    all_edges = sorted(({"a": a, "b": b, "w": round(w, 2), "t": edge_t.get((a, b), 3),
                         "p": {kk: round(pv, 2) for kk, pv in edge_p.get((a, b), {"m": 0, "f": 0, "h": 0, "s": w, "i": 0, "e": 0}).items()}}
                        for (a, b), w in edge_w.items() if a in idset and b in idset),
                       key=lambda e: (e["t"], -e["w"]))
    # keep every real relationship, the strongest links overall, PLUS every node's own strongest few
    keep = {id(e): e for e in all_edges if e["t"] == 1}
    keep.update({id(e): e for e in all_edges[:cap * 4]})
    per = defaultdict(list)
    for e in all_edges:
        per[e["a"]].append(e)
        per[e["b"]].append(e)
    for lst in per.values():
        for e in lst[:4]:
            keep[id(e)] = e
    edges = list(keep.values())
    deg = Counter()
    for e in edges:
        deg[e["a"]] += e["w"]
        deg[e["b"]] += e["w"]
    meta = _all_meta(v)
    nodes = []
    for nid in ids:
        kind = kind_of.get(nid, "word")
        if nid.startswith("person:"):
            members = person_members.get(nid, [])
            first = acct_key.get("@" + members[0]) if members else None
            nodes.append({"id": nid, "kind": "account", "label": person_name.get(nid, ""), "n": node_n[nid],
                          "w": round(node_w[nid], 2), "strength": round(deg[nid], 1), "hop": hop_of.get(nid),
                          "person_id": first, "identity_id": nid[7:], "identity": person_name.get(nid, ""),
                          "accounts": members, "attrs": []})
            continue
        label = nid[1:].split("|")[0] if kind == "account" else nid if kind == "hashtag" else nid[2:].title() if kind == "entity" else nid[2:]
        pid = acct_key.get(nid) if kind == "account" else None
        i = person_of.get(nid)
        plat = nid.split("|")[-1] if kind == "account" else ""
        nodes.append({"id": nid, "kind": kind, "label": label, "n": node_n[nid], "w": round(node_w[nid], 2),
                      "role": ("outlet" if plat in OUTLETS else "person") if kind == "account" else None,
                      "strength": round(deg[nid], 1), "hop": hop_of.get(nid),
                      "identity": i["name"] if i else None, "identity_id": i["id"] if i else None,
                      "person_id": pid, "attrs": ((meta.get(pid) or {}).get("attrs", [])[:3] if pid else [])})
    return {"nodes": nodes, "edges": edges, "focus": focus_id if focus_id in idset else None,
            "focus_asked": focus or "", "kinds": sorted(kinds), "hops": max(hop_of.values()) if hop_of else None,
            "generated": _now()}


def _stub(pid):
    """An account we only know from a follow list ("name@host|mastodon", "x.bsky.social|bluesky")."""
    author, _, platform = str(pid or "").lstrip("@").partition("|")
    urls = {"bluesky": "https://bsky.app/profile/{h}", "x": "https://x.com/{h}/media", "youtube": "https://www.youtube.com/@{h}/videos",
            "reddit": "https://www.reddit.com/user/{h}/submitted/", "tiktok": "https://www.tiktok.com/@{h}",
            "instagram": "https://www.instagram.com/{h}/", "threads": "https://www.threads.net/@{h}"}
    if not author or (platform not in urls and platform != "mastodon"):   # networks a profile page can be walked for
        return None
    url = urls.get(platform, "").format(h=author)
    if platform == "mastodon" and "@" in author:
        user, host = author.split("@", 1)
        url = f"https://{host}/@{user}"
    a = _Acct(f"{author}|{platform}", {"author": author, "platform": platform, "author_url": url})
    return a


def _account(v, pid):
    by, *_ = _build(v)
    lower = {a.id.lower(): a for a in by.values()}
    return by.get(pid) or lower.get(str(pid).lower()) or _stub(pid)


def fetch_follows(platform, handle, url="", limit=300):
    """Public follow lists straight from the platform (Mastodon, Bluesky). Returns
    {follows: [...], followers: [...], partial} with handles in the app's author form."""
    from .util import http_json
    handle = (handle or "").lstrip("@").strip()
    out = {"platform": platform, "follows": [], "followers": [], "partial": False}
    if platform == "mastodon":
        user, _, host = handle.partition("@")
        host = host or (re.match(r"https?://([^/]+)", url or "") or [None, ""])[1] or "mastodon.social"
        acc = http_json(f"https://{host}/api/v1/accounts/lookup?acct={urllib.parse.quote(user)}")
        row = lambda a: {"handle": a.get("acct") or "", "name": a.get("display_name") or "",  # noqa: E731
                         "url": a.get("url") or "", "posts": a.get("statuses_count") or 0}
        for kind in ("following", "followers"):
            try:
                rows = [row(a) for a in http_json(f"https://{host}/api/v1/accounts/{acc['id']}/{kind}?limit=80")]
            except Exception:  # noqa: BLE001 — 403 when the account hides its list: respect it
                rows, out["partial"] = [], True
            out["follows" if kind == "following" else "followers"] = rows[:limit]
        return out
    if platform == "bluesky":
        row = lambda a: {"handle": a.get("handle") or "", "name": a.get("displayName") or "",  # noqa: E731
                         "url": f"https://bsky.app/profile/{a.get('handle')}", "posts": 0}
        for xrpc, key in (("app.bsky.graph.getFollows", "follows"), ("app.bsky.graph.getFollowers", "followers")):
            rows, cursor = [], ""
            for _ in range(4):
                d = http_json(f"https://public.api.bsky.app/xrpc/{xrpc}?actor={urllib.parse.quote(handle)}&limit=100"
                              + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else ""))
                rows += [row(a) for a in d.get(key) or []]
                cursor = d.get("cursor")
                if not cursor or len(rows) >= limit:
                    break
            out[key] = rows[:limit]
        return out
    raise ValueError(f"{platform or 'this site'} doesn't publish a follow list we can read (Mastodon and Bluesky do)")


def masto_lookup(handle, url="", instance=""):
    """Where a fediverse account can actually be read: the instance we search from (full acct),
    then its own host, then mastodon.social — a remote account on Loops/Pixelfed may only answer via a relay."""
    from .util import http_json
    user, _, home = handle.lstrip("@").partition("@")
    own = home or (re.match(r"https?://([^/]+)", url or "") or [None, None])[1]
    tries = []
    if instance:
        tries.append((instance, f"{user}@{own}" if own and own != instance else user))
    if own:
        tries.append((own, user))
    if instance != "mastodon.social":
        tries.append(("mastodon.social", f"{user}@{own}" if own else user))
    last = None
    for host, acct in tries:
        try:
            acc = http_json(f"https://{host}/api/v1/accounts/lookup?acct={urllib.parse.quote(acct)}")
            if acc and acc.get("id"):
                return host, acc
        except Exception as e:  # noqa: BLE001
            last = e
    raise ValueError(f"couldn't find @{handle} on {', '.join(h for h, _ in tries)}" + (f" ({last})" if last else ""))


def more_mastodon(v, a, limit=50, media="all"):
    """LOAD MORE for a fediverse account straight from the API (no yt-dlp/gallery-dl needed)."""
    from .sources import items_from_mastodon
    from .util import http_json
    instance = next((s.get("template") for s in v.list_sources() if s.get("kind") == "mastodon" and s.get("enabled")), "")
    everything = media == "everything"
    try:
        host, acc = masto_lookup(a.author, a.author_url, instance or "")
        statuses = http_json(f"https://{host}/api/v1/accounts/{acc['id']}/statuses?limit={min(limit, 40)}"
                             f"&only_media={'false' if everything else 'true'}&exclude_replies={'false' if everything else 'true'}&exclude_reblogs=true")
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    found = new = 0
    for st in statuses:
        for it in items_from_mastodon(st, host, "more", include_images=media in ("all", "everything"), include_text=everything):
            found += 1
            if v.db.upsert(it) == "new":
                new += 1
    return {"id": f"more-{_now()}", "kind": "collect", "title": f"more from @{a.author}", "state": "done",
            "stats": {"found": found, "new": new}, "result": {"found": found, "new": new, "author": a.author}}


def more_reddit(v, a, limit=50):
    """LOAD MORE for a Reddit account with 'everything': their submissions and their comments."""
    from .sources import item_from_reddit
    from .util import http_json
    found = new = 0
    try:
        for path in ("submitted", "comments"):
            d = http_json(f"https://www.reddit.com/user/{urllib.parse.quote(a.author)}/{path}.json?limit={min(limit, 100)}&sort=new")
            for c in (d.get("data") or {}).get("children") or []:
                it = item_from_reddit(c.get("data") or {}, "more", include_images=True, include_text=True)
                if it:
                    found += 1
                    if v.db.upsert(it) == "new":
                        new += 1
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    return {"id": f"more-{_now()}", "kind": "collect", "title": f"more from @{a.author}", "state": "done",
            "stats": {"found": found, "new": new}, "result": {"found": found, "new": new, "author": a.author}}


def load_follows(v, pid, fetch=fetch_follows):
    """Pull who this account publicly follows / is followed by into the relations table.
    Synchronous (two or three small API calls); returns a finished job-shaped dict."""
    a = _account(v, pid)
    if not a:
        return {"error": "no account"}
    if a.platform not in ("mastodon", "bluesky"):
        return {"error": f"{a.platform} doesn't publish a follow list we can read (Mastodon and Bluesky do)"}
    try:
        r = fetch(a.platform, a.author, a.author_url)
    except Exception as e:  # noqa: BLE001
        return {"error": f"couldn't read @{a.author}'s follow list: {e}"}
    ts = _now()
    v.db.exec("DELETE FROM relations WHERE lower(src)=lower(?)", (a.id,))
    rows = [(a.id, f"{p['handle']}|{a.platform}", kind, ts, p.get("name") or "", p.get("url") or "", int(p.get("posts") or 0))
            for kind, lst in (("follows", r.get("follows") or []), ("followed_by", r.get("followers") or []))
            for p in lst if p.get("handle")]
    if rows:
        v.db.many("INSERT OR REPLACE INTO relations(src, dst, kind, ts, name, url, posts) VALUES(?,?,?,?,?,?,?)", rows)
    by, *_ = _build(v)
    lower = {x.id.lower() for x in by.values()}
    known = sum(1 for row in rows if row[1].lower() in lower)
    return {"id": f"follows-{ts}", "kind": "follows", "title": f"follows of @{a.author}", "state": "done",
            "stats": {"found": len(rows), "new": known},
            "result": {"follows": len(r.get("follows") or []), "followers": len(r.get("followers") or []),
                       "known": known, "partial": bool(r.get("partial")), "author": a.author}}


def handle(v, method, parts, params, body):
    """Route /api/people…, /api/graph and /api/identities like the browser module does."""
    if parts[0] == "identities":
        if len(parts) < 2 or not parts[1]:
            if method == "GET":
                return {"identities": [identity_dto(i) for i in identities(v)]}
            if method == "POST":
                return identity_write(v, "POST", None, body)
        else:
            if method == "GET":
                i = next((x for x in identities(v) if x["id"] == parts[1]), None)
                return identity_dto(i) if i else {"error": "no such person"}
            return identity_write(v, method, parts[1], body)
        return {"error": "identities route not available"}
    if parts[0] == "graph":
        if "focus" in params or "kinds" in params:
            return word_graph(v, params.get("focus") or "", params.get("kinds") or "account,hashtag,word,entity",
                              int(params.get("max") or 80), params.get("platform") or "", params.get("topic") or "",
                              params.get("hops") or 2, params.get("via") or "", params.get("merge") == "1", params.get("role") or "")
        return graph(v, params.get("topic") or None, int(params.get("max") or 60), float(params.get("min") or 1.5),
                     params.get("platform") or "", params.get("role") or "")
    pid = parts[1] if len(parts) > 1 else None
    if not pid:
        return list_people(v, params.get("topic") or None, params.get("q") or "", params.get("sort") or "",
                           params.get("platform") or "", params.get("role") or "")
    if len(parts) > 2 and parts[2] == "follows" and method == "POST":
        return load_follows(v, pid)
    if len(parts) > 2 and parts[2] == "more" and method == "POST":
        # load more of this account's own posts (no rating needed): a collect job on its profile URL,
        # which gallery-dl / yt-dlp know how to walk for X, YouTube, Mastodon, Bluesky, Reddit, …
        a = _account(v, pid)
        if not a:
            return {"error": "no account"}
        limit = max(1, min(int((body or {}).get("limit") or 50), 500))
        if a.platform == "mastodon":            # the fediverse has an open API: read the account directly
            return more_mastodon(v, a, limit, (body or {}).get("media") or "all")
        if a.platform == "reddit" and ((body or {}).get("media") or "all") == "everything":   # posts AND comments
            return more_reddit(v, a, limit)
        url = a.author_url or next((it.get("url") for it in a.items if it.get("url")), None)
        if not url:
            return {"error": "no profile link known for this account"}
        return v.submit("collect", {"urls": [url], "limit": limit, "media": (body or {}).get("media") or "all",
                                    "title": f"more from @{a.author}"}).to_dict()
    if method == "GET":
        return profile(v, pid)
    if method == "PATCH":
        return set_meta(v, pid, body or {})
    return {"error": "people route not available: " + "/".join(parts)}
