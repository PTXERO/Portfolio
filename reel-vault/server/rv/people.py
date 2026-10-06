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
    return {m.rstrip(".").lower() for m in _MENTION.findall(str(t or ""))}


def _hashes(it):
    return {h for h in str(it.get("hashtags") or "").lower().split() if h}


def _pid(it):
    return f"{it.get('author') or '?'}|{it.get('platform') or '?'}"


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


# ── aggregates over collected items ──
class _Acct:
    __slots__ = ("id", "author", "platform", "author_url", "author_name", "items", "H", "W", "M")

    def __init__(self, id_, it):
        self.id, self.author, self.platform = id_, it.get("author") or "?", it.get("platform") or "?"
        self.author_url, self.author_name = it.get("author_url") or "", it.get("author_name") or ""
        self.items, self.H, self.W, self.M = [], set(), set(), set()


def _build(v):
    rows = v.db.q("SELECT id, platform, author, author_name, url, media_url, text, hashtags, lang, "
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
    n = max(1, len(by))
    idf = lambda df: math.log((n + 1) / ((df or 0) + 1)) + 1  # noqa: E731
    return by, idf, h_df, w_df


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
    w, hn, wn = 0.0, 0, 0
    for h in a.H & b.H:
        w += idf(h_df[h])
        hn += 1
    for x in a.W & b.W:
        w += 0.5 * idf(w_df[x])
        wn += 1
    ment = a.author.lower() in b.M or b.author.lower() in a.M
    if ment:
        w += 3
    return w, hn, wn, ment


def profile(v, pid):
    by, idf, h_df, w_df = _build(v)
    a = by.get(pid)
    if not a:
        return {"error": "no account"}
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
        w, hn, wn, ment = _edge(a, b, idf, h_df, w_df)
        if w > 0:
            why = ([{"kind": "hashtags", "n": hn}] if hn else []) + ([{"kind": "mentions"}] if ment else [])
            edges.append({"id": b.id, "author": b.author, "platform": b.platform, "author_url": b.author_url,
                          "w": round(w, 2), "why": why, "shared_hashtags": hn, "shared_words": wn})
    edges.sort(key=lambda e: -e["w"])
    recent = sorted((it for it in items if it.get("media_url") or it.get("thumbnail") or it.get("url")),
                    key=lambda it: -(it.get("posted_at") or 0))[:8]
    ment = Counter()
    for it in items:
        for m in _mentions(it.get("text")):
            if m != a.author.lower():
                ment[m] += 1
    return {
        "id": pid, "author": a.author, "author_name": a.author_name, "platform": a.platform,
        "author_url": a.author_url, "n": len(items), **_cadence(items), "media": dict(media),
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


def graph(v, topic=None, max_nodes=60, min_w=1.5):
    by, idf, h_df, w_df = _build(v)
    by_item, _ = _vote_index(v)
    accts = list(by.values())
    if topic:
        accts = [a for a in accts if any(r["topic_id"] == topic for it in a.items for r in by_item.get(it["id"], []))]
    accts.sort(key=lambda a: -len(a.items))
    top = accts[:min(max_nodes or 60, 120)]
    top_ids = {a.id for a in top}
    meta = _all_meta(v)
    strength, edges = Counter(), []
    for i, a in enumerate(top):
        for b in top[i + 1:]:
            w, hn, wn, ment = _edge(a, b, idf, h_df, w_df)
            if w >= min_w or ment:
                edges.append({"a": a.id, "b": b.id, "w": round(w, 2), "h": hn, "m": 1 if ment else 0})
                strength[a.id] += w
                strength[b.id] += w
    for a in top:
        for lid in (meta.get(a.id) or {}).get("links", []):
            if lid in top_ids and not any({e["a"], e["b"]} == {a.id, lid} for e in edges):
                edges.append({"a": a.id, "b": lid, "w": 2, "h": 0, "m": 0, "you": 1})
    nodes = [{"id": a.id, "author": a.author, "platform": a.platform, "n": len(a.items),
              "strength": round(strength[a.id], 1), "attrs": (meta.get(a.id) or {}).get("attrs", [])[:4],
              "topics": len({r["topic_id"] for it in a.items for r in by_item.get(it["id"], [])})} for a in top]
    return {"nodes": nodes, "edges": edges, "total_accounts": len(by), "shown": len(nodes), "generated": _now()}


def list_people(v, topic=None, q="", sort=""):
    by, idf, h_df, w_df = _build(v)
    by_item, names = _vote_index(v)
    meta = _all_meta(v)
    rows = list(by.values())
    if topic:
        rows = [a for a in rows if any(r["topic_id"] == topic for it in a.items for r in by_item.get(it["id"], []))]
    if q:
        ql = q.lower()
        rows = [a for a in rows if ql in f"{a.author} {a.author_name}".lower()]
    out = []
    for a in rows:
        cad = _cadence(a.items)
        tset = {names.get(r["topic_id"]) for it in a.items for r in by_item.get(it["id"], [])}
        out.append({"id": a.id, "author": a.author, "author_name": a.author_name, "platform": a.platform,
                    "author_url": a.author_url, "n": len(a.items), "per_week": cad["per_week"], "last": cad["last"],
                    "topics": [t for t in tset if t][:4],
                    "media": dict(Counter((it.get("media") or "video") for it in a.items)),
                    "hashtags": [x["value"] for x in _top(a.items, lambda it: list(_hashes(it)), 4)],
                    "attrs": (meta.get(a.id) or {}).get("attrs", [])[:4],
                    "has_notes": bool((meta.get(a.id) or {}).get("notes"))})
    key = {"active": lambda x: -(x["last"] or 0), "cadence": lambda x: -x["per_week"],
           "name": lambda x: x["author"].lower()}.get(sort, lambda x: -x["n"])
    out.sort(key=key)
    return {"people": out, "total": len(out)}


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


def word_graph(v, focus="", kinds="account,hashtag,word", max_nodes=80):
    by, idf, h_df, w_df = _build(v)
    kinds = {k for k in str(kinds).split(",") if k}
    cap = min(int(max_nodes or 80), 160)
    fz = _parse_focus(focus)
    node_w, edge_w, kind_of, node_n = Counter(), Counter(), {}, Counter()   # node_n = posts behind each node

    def link(a, b, w):
        if a != b:
            edge_w[(a, b) if a < b else (b, a)] += w

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
                         (w in BOILER or (n_posts >= 20 and n_acc >= 5 and post_df[w] / n_posts > 0.6
                                          and acct_df[w] / n_acc > 0.8)))
    for a in by.values():
        aid = f"@{a.author.lower()}|{a.platform}"
        for it in a.items:
            tags = ["#" + h for h in _hashes(it)]
            words = ["w:" + w for w in {w for w in _tokens(it.get("text"))
                                        if len(w) > _WORD_MIN and w not in STOP and not generic(w)}]
            words_set = set(words)
            if fz and fz["kind"] == "word" and fz.get("phrase") and fz["key"] in str(it.get("text") or "").lower():
                words.append("w:" + fz["key"])
            for t in tags:
                kind_of[t] = "hashtag"
                node_w[t] += idf(h_df[t[1:]])
                node_n[t] += 1
                link(aid, t, 1)
            for w in words:
                kind_of[w] = "word"
                node_w[w] += 0.6 * idf(w_df.get(w[2:], 1))
                node_n[w] += 1
                link(aid, w, 0.6)
            node_w[aid] += 1
            node_n[aid] += 1
            for i in range(len(tags)):
                for j in range(i + 1, len(tags)):
                    link(tags[i], tags[j], 1.2)
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
                    link(t, k, 0.5)
            for i in range(len(seq)):
                for j in range(i + 1, len(seq)):
                    link(seq[i][0], seq[j][0], 1 if seq[j][1] - seq[i][1] <= 4 else 0.25)
        for b in by.values():
            if b.id == a.id:
                continue
            w, hn, wn, ment = _edge(a, b, idf, h_df, w_df)
            if w > 0:
                link(aid, f"@{b.author.lower()}|{b.platform}", w * 0.5)

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
    for (a, b) in list(edge_w):
        if a not in kind_of or b not in kind_of:
            del edge_w[(a, b)]
    # ── edge weights (association strength): co-occurrence vs. what chance predicts from each term ──
    for (a, b), co in list(edge_w.items()):
        if kind_of.get(a) == "account" or kind_of.get(b) == "account":
            continue
        assoc = n_posts * co / (max(1, node_n[a]) * max(1, node_n[b]))
        edge_w[(a, b)] = math.sqrt(co) * math.log(1 + assoc)

    def nb(nid):
        out = [(y if x == nid else x, w) for (x, y), w in edge_w.items() if nid in (x, y)]
        return sorted(out, key=lambda p: -p[1])

    focus_id = None
    if fz:
        if fz["kind"] == "account":
            focus_id = next((k for k in kind_of if k.startswith("@" + fz["key"] + "|")), None)
        elif fz["kind"] == "hashtag":
            focus_id = "#" + fz["key"]
        else:
            focus_id = "w:" + fz["key"]
    if focus_id and (focus_id in kind_of or focus_id in node_w):
        first = [p for p in nb(focus_id) if kind_of.get(p[0]) in kinds][:int(cap * 0.6)]
        seen = [focus_id] + [p[0] for p in first]
        sset = set(seen)
        for k, _ in first:
            for k2, _ in nb(k)[:4]:
                if len(sset) >= cap:
                    break
                if kind_of.get(k2) in kinds and k2 not in sset:
                    sset.add(k2)
                    seen.append(k2)
        ids = seen
    else:
        per = {"account": round(cap * 0.4), "hashtag": round(cap * 0.3), "word": round(cap * 0.3)}
        ids = []
        for kind in ("account", "hashtag", "word"):
            if kind in kinds:
                ids += sorted((k for k in node_w if kind_of.get(k) == kind), key=lambda k: -node_w[k])[:per[kind]]
    idset = set(ids)
    all_edges = sorted(({"a": a, "b": b, "w": round(w, 2)} for (a, b), w in edge_w.items() if a in idset and b in idset),
                       key=lambda e: -e["w"])
    # keep the strongest links overall PLUS every node's own strongest few, so nothing is left dangling
    keep = {id(e): e for e in all_edges[:cap * 4]}
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
        label = nid[1:].split("|")[0] if kind == "account" else nid if kind == "hashtag" else nid[2:]
        pid = acct_key.get(nid) if kind == "account" else None
        nodes.append({"id": nid, "kind": kind, "label": label, "n": node_n[nid], "w": round(node_w[nid], 2),
                      "strength": round(deg[nid], 1),
                      "person_id": pid, "attrs": ((meta.get(pid) or {}).get("attrs", [])[:3] if pid else [])})
    return {"nodes": nodes, "edges": edges, "focus": focus_id if focus_id in idset else None,
            "focus_asked": focus or "", "kinds": sorted(kinds), "generated": _now()}


def handle(v, method, parts, params, body):
    """Route /api/people… and /api/graph like the browser module does."""
    if parts[0] == "graph":
        if "focus" in params or "kinds" in params:
            return word_graph(v, params.get("focus") or "", params.get("kinds") or "account,hashtag,word",
                              int(params.get("max") or 80))
        return graph(v, params.get("topic") or None, int(params.get("max") or 60), float(params.get("min") or 1.5))
    pid = parts[1] if len(parts) > 1 else None
    if not pid:
        return list_people(v, params.get("topic") or None, params.get("q") or "", params.get("sort") or "")
    if len(parts) > 2 and parts[2] == "more" and method == "POST":
        # load more of this account's own posts (no rating needed): a collect job on its profile URL,
        # which gallery-dl / yt-dlp know how to walk for X, YouTube, Mastodon, Bluesky, Reddit, …
        by, *_ = _build(v)
        a = by.get(pid)
        if not a:
            return {"error": "no account"}
        url = a.author_url or next((it.get("url") for it in a.items if it.get("url")), None)
        if not url:
            return {"error": "no profile link known for this account"}
        limit = max(1, min(int((body or {}).get("limit") or 50), 500))
        return v.submit("collect", {"urls": [url], "limit": limit, "media": (body or {}).get("media") or "all",
                                    "title": f"more from @{a.author}"}).to_dict()
    if method == "GET":
        return profile(v, pid)
    if method == "PATCH":
        return set_meta(v, pid, body or {})
    return {"error": "people route not available: " + "/".join(parts)}
