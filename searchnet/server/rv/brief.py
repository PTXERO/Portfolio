"""A brief of a topic from what is in it: the sentences that carry the topic's words, who and where,
a timeline, with [n] citations back to the posts. No model needed. The same packet feeds an LLM when
the user plugs one in (their key, their machine; the hub never sees it)."""
import json
import re
from collections import Counter

from .learn import TopicScorer, member_ids
from .util import light_stem, tokens

SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])|\n+")


def _sentences(text):
    for s in SPLIT.split(text or ""):
        s = s.strip()
        if 40 <= len(s) <= 320 and not s.lower().startswith(("http", "rt @")):
            yield s


def build(vault, tid, max_items=400, max_sentences=10):
    t = vault.topic(tid)
    if not t:
        return {"error": "no such topic"}
    sc = TopicScorer(vault, tid)
    ids = member_ids(vault.db, tid)
    rows = vault.db.q("SELECT item_id, label, score FROM topic_items WHERE topic_id=? ORDER BY label DESC, score DESC LIMIT ?",
                      (tid, max_items))
    rows = [r for r in rows if r["item_id"] in ids]
    items = vault.db.get_many(r["item_id"] for r in rows)
    weights = Counter()
    for st in sc.seed_stems:
        weights[st] += 3.0
    pos, _ = sc.top_features(30)
    for f in pos:
        k = f["feature"]
        if k.startswith("w:"):
            weights[k[2:]] += 1.5 * max(0.1, f["weight"])
    # sentences, scored by the topic's words; one per post; no near duplicates
    cands = []
    for n, r in enumerate(rows, 1):
        it = items.get(r["item_id"])
        if not it:
            continue
        best = None
        for s in _sentences(it.get("text") or ""):
            toks = {light_stem(w) for w in tokens(s)}
            sc_ = sum(weights.get(w, 0) for w in toks) / (1 + 0.02 * len(toks))
            if r["label"] > 0:
                sc_ *= 1.5
            if best is None or sc_ > best[0]:
                best = (sc_, s)
        if best and best[0] > 0:
            cands.append((best[0], n, best[1], it))
    cands.sort(key=lambda x: -x[0])
    out, seen = [], []
    for score, n, s, it in cands:
        key = set(tokens(s))
        if any(len(key & k) / max(1, len(key | k)) > 0.6 for k in seen):
            continue
        seen.append(key)
        out.append({"n": n, "text": s, "item_id": it["id"], "url": it.get("url"), "author": it.get("author"),
                    "platform": it.get("platform"), "when": it.get("posted_at")})
        if len(out) >= max_sentences:
            break
    # facts
    plats = Counter(it.get("platform") or "?" for it in items.values())
    authors = Counter((it.get("author") or "?") + "|" + (it.get("platform") or "") for it in items.values())
    tags = Counter(h for it in items.values() for h in (it.get("hashtags") or "").lower().split())
    dates = sorted(it["posted_at"] for it in items.values() if it.get("posted_at"))
    weeks = Counter()
    heads = {}
    for it in items.values():
        if not it.get("posted_at"):
            continue
        wk = int(it["posted_at"] // (7 * 86400))
        weeks[wk] += 1
        if wk not in heads or len(it.get("text") or "") > len(heads[wk].get("text") or ""):
            heads[wk] = it
    timeline = [{"week_start": wk * 7 * 86400, "n": c, "headline": (heads[wk].get("text") or "")[:140].split("\n")[0],
                 "url": heads[wk].get("url")} for wk, c in sorted(weeks.items())][-16:]
    cites = {n: {"url": items[r["item_id"]].get("url"), "author": items[r["item_id"]].get("author"), "platform": items[r["item_id"]].get("platform"),
                 "when": items[r["item_id"]].get("posted_at"), "text": (items[r["item_id"]].get("text") or "")[:400]}
             for n, r in enumerate(rows, 1) if r["item_id"] in items}
    return {"topic": t["name"], "n_items": len(items), "n_liked": sum(1 for r in rows if r["label"] > 0),
            "first": dates[0] if dates else None, "last": dates[-1] if dates else None,
            "sentences": out, "platforms": plats.most_common(8),
            "accounts": [{"author": a.split("|")[0], "platform": a.split("|")[1], "n": c} for a, c in authors.most_common(8)],
            "tags": tags.most_common(12), "timeline": timeline, "citations": cites,
            "prompt": prompt_for(t, out, cites)}


def prompt_for(t, sentences, cites, max_chars=24000):
    """What an LLM is asked. Posts are quoted with their number; the model must cite them."""
    head = (f"You are summarising a research topic named \"{t['name']}\" (searches: {', '.join(t.get('seeds') or [])}).\n"
            "Below are numbered posts and articles collected for it. Write a brief for someone who has not read them:\n"
            "1) a 3-sentence summary, 2) key facts as bullets, 3) who is involved and where, 4) a short timeline, "
            "5) open questions or contradictions. Cite posts as [n] after every claim. Use only what is in the posts; "
            "say when something is unclear. Plain language, no hype.\n\nPOSTS:\n")
    body = []
    size = len(head)
    for n in sorted(cites):
        c = cites[n]
        line = f"[{n}] ({c.get('platform')} · @{c.get('author')}) {c.get('text', '').strip()}\n"
        if size + len(line) > max_chars:
            break
        body.append(line)
        size += len(line)
    return head + "".join(body)
