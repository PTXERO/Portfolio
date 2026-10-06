"""Grow a topic's search queries from many signals.

origins (shown in the UI):
  seed     what you typed
  morph    word forms: plural/singular, joined words, #hashtag form
  synonym  your similar-word groups (SETUP)
  web      related words from the Datamuse API (meaning-alike + associated)
  cooccur  hashtags/words that show up a lot in liked items vs. the library
  learned  strongest positive features of the topic's model
  author   creators you keep liking (search their posts)
  user     added by you
"""

import json
import math
import re
import urllib.parse
from collections import Counter

from .learn import TopicScorer
from .util import hashtag_form, http_json, light_stem, now, tokens

BREADTH = {  # how many of each origin to keep enabled, by topic breadth 1..5
    1: {"synonym": 0, "web": 0, "cooccur": 2, "learned": 2, "author": 0},
    2: {"synonym": 3, "web": 3, "cooccur": 3, "learned": 3, "author": 2},
    3: {"synonym": 6, "web": 6, "cooccur": 5, "learned": 5, "author": 3},
    4: {"synonym": 10, "web": 10, "cooccur": 8, "learned": 8, "author": 5},
    5: {"synonym": 20, "web": 18, "cooccur": 12, "learned": 12, "author": 8},
}


def morph_variants(seed):
    s = re.sub(r"\s+", " ", seed.strip().lower())
    if not s or s.startswith("@") or re.search(r'["():]|\bOR\b', seed):
        return []
    words = s.lstrip("#").split()
    out = []
    if len(words) > 1:
        out.append("".join(words))
    out.append("#" + hashtag_form(s))
    last = words[-1]
    if len(last) > 3 and not last.endswith(("ing", "ism", "ness")):
        if last.endswith("ies"):
            alt = last[:-3] + "y"
        elif last.endswith("es") and last[-3] in "sxz":
            alt = last[:-2]
        elif last.endswith("s") and not last.endswith("ss"):
            alt = last[:-1]
        elif last.endswith("y") and last[-2] not in "aeiou":
            alt = last[:-1] + "ies"
        else:
            alt = last + "s"
        out.append(" ".join(words[:-1] + [alt]))
    return [o for o in dict.fromkeys(out) if o and o != s]


def synonym_variants(store, seed):
    s = seed.strip().lower().lstrip("#")
    out = list(store.synonyms(s))
    words = s.split()
    if len(words) > 1:            # swap one word at a time
        for i, w in enumerate(words):
            for syn in store.synonyms(w)[:4]:
                out.append(" ".join(words[:i] + [syn] + words[i + 1:]))
    return list(dict.fromkeys(o for o in out if o != s))


def web_related(db, seed, max_each=12):
    """Datamuse: ml = means-like, rel_trg = commonly associated. Cached."""
    s = seed.strip().lower().lstrip("#")
    if not s or s.startswith("@"):
        return []
    key = "datamuse:" + s
    cached = db.cache_get(key, 14 * 86400)
    if cached is not None:
        return cached
    out = []
    for rel in ("ml", "rel_trg"):
        try:
            res = http_json(f"https://api.datamuse.com/words?{rel}={urllib.parse.quote(s)}&max={max_each}",
                            timeout=8)
        except Exception:        # noqa: BLE001 — offline is fine, just no web expansion
            return out
        top = max((r.get("score", 0) for r in res), default=1) or 1
        for r in res:
            w = r.get("word", "")
            if w and w != s and w not in [o["word"] for o in out]:
                out.append({"word": w, "rel": rel, "score": round(r.get("score", 0) / top, 3)})
    db.cache_set(key, out)
    return out


def cooccurring(db, topic_id, n=12):
    """Terms over-represented in liked (or, before votes, top-scored) items."""
    liked = db.q("SELECT i.text, i.hashtags FROM topic_items t JOIN items i ON i.id=t.item_id "
                 "WHERE t.topic_id=? AND t.label=1", (topic_id,))
    if len(liked) < 3:
        liked = db.q("SELECT i.text, i.hashtags FROM topic_items t JOIN items i ON i.id=t.item_id "
                     "WHERE t.topic_id=? AND t.label>=0 ORDER BY t.score DESC LIMIT 30", (topic_id,))
    if len(liked) < 3:
        return []
    N = max(db.doc_count(), 1)
    tags, words = Counter(), Counter()
    surface = {}
    for r in liked:
        for h in set((r["hashtags"] or "").lower().split()):
            tags[h] += 1
        for t in set(tokens(r["text"])):
            if len(t) > 2 and not t.isdigit():
                st = light_stem(t)
                words[st] += 1
                surface.setdefault(st, t)
    df = {r["term"]: r["doc"] for r in db.q(
        "SELECT term, doc FROM items_vocab WHERE term IN (%s)" % ",".join("?" * len(words)),
        list(words))} if words else {}
    n = len(liked)

    def lift(cnt, d):
        return ((cnt + .5) / (n + 1)) / ((d + 1) / (N + 1)) * math.log(1 + cnt)

    tag_scores = sorted(((lift(c, c), "#" + h) for h, c in tags.items() if c >= 2), reverse=True)
    word_scores = sorted(((lift(c, df.get(st, c)), surface[st]) for st, c in words.items()
                          if c >= 2 and c / n >= 0.2), reverse=True)
    return [q for _, q in tag_scores[:n // 2 + 3]] + [q for _, q in word_scores[:n]]


def refresh_expansions(vault, topic_id, web=True):
    """(Re)generate auto queries for a topic. Never touches seed/user rows
    and never re-enables something you switched off."""
    db = vault.db
    t = db.one("SELECT * FROM topics WHERE id=?", (topic_id,))
    if not t:
        return []
    seeds = json.loads(t["seeds"] or "[]")
    st = json.loads(t["settings"] or "{}")
    breadth = BREADTH.get(int(st.get("breadth", 3)), BREADTH[3])
    existing = {r["query"].lower(): r for r in db.q(
        "SELECT * FROM topic_queries WHERE topic_id=?", (topic_id,))}
    seed_l = {s.lower() for s in seeds}
    corpus = set()
    for r in db.q("SELECT i.text, i.hashtags FROM topic_items t JOIN items i ON i.id=t.item_id "
                  "WHERE t.topic_id=? AND t.label>=0 ORDER BY t.score DESC LIMIT 300", (topic_id,)):
        corpus.update(light_stem(w) for w in tokens(f"{r['text']} {r['hashtags']}"))

    def corpus_has(phrase):
        ws = [light_stem(w) for w in tokens(phrase)]
        return bool(ws) and sum(w in corpus for w in ws) / len(ws) >= 0.5
    ts = now()
    rows = []

    def add(q, origin, enabled, weight=1.0):
        ql = q.strip().lower()
        if not ql or ql in seed_l or len(ql) > 120:
            return
        ex = existing.get(ql)
        if ex:
            if ex["origin"] in ("seed", "user"):
                return
            # refresh weight; switch on newly-backed ideas unless you toggled it yourself
            db.exec("UPDATE topic_queries SET weight=?, enabled=CASE WHEN locked=0 AND ?=1 THEN 1 "
                    "ELSE enabled END WHERE topic_id=? AND query=?",
                    (weight, 1 if enabled else 0, topic_id, ex["query"]))
            return
        existing[ql] = {"origin": origin, "query": q.strip()}
        rows.append((topic_id, q.strip(), origin, 1 if enabled else 0, weight, ts))

    for s in seeds:
        if s.lower() not in existing:
            rows.append((topic_id, s, "seed", 1, 1.0, ts))
            existing[s.lower()] = {"origin": "seed", "query": s}
        for m in morph_variants(s):
            add(m, "morph", True)
        for i, syn in enumerate(synonym_variants(vault.store, s)):
            add(syn, "synonym", i < breadth["synonym"])
        if web and st.get("web", True) and vault.store.settings.get("web_expansion", True):
            # associated words first; switch on the few best, plus any that the
            # content found so far actually uses (web + your results agree)
            words = sorted(web_related(db, s), key=lambda r: (r["rel"] != "rel_trg", -r["score"]))
            for i, r in enumerate(words):
                seen = corpus_has(r["word"])
                add(r["word"], "web", i < max(1, breadth["web"] // 3) or (seen and i < breadth["web"] * 2),
                    weight=(0.5 + 0.5 * r["score"]) * (1.2 if seen else 1.0))

    for i, q in enumerate(cooccurring(db, topic_id)):
        add(q, "cooccur", i < breadth["cooccur"])

    sc = TopicScorer(vault, topic_id)
    if sc.n_pos >= 2:
        pos, _ = sc.top_features(30)
        learned = [f["label"] for f in pos if f["feature"][0] in "wb#"
                   and len(f["label"].lstrip("#")) > 2][:breadth["learned"] * 2]
        for i, q in enumerate(learned):
            add(q, "learned", i < breadth["learned"], weight=min(1.0, 0.5 + abs(pos[0]["weight"])))
        for i, a in enumerate(liked_authors(db, topic_id)[:breadth["author"] * 2]):
            add("@" + a["author"], "author", i < breadth["author"])

    if rows:
        db.many("INSERT OR IGNORE INTO topic_queries(topic_id, query, origin, enabled, weight, created)"
                " VALUES (?,?,?,?,?,?)", rows)
    # switch off auto queries that keep bringing junk
    from .learn import query_stats
    for r in query_stats(db, topic_id):
        if r["origin"] not in ("seed", "user") and r["enabled"] and not r.get("locked") and \
                r["pos"] + r["neg"] >= 6 and r["precision"] < 0.2:
            db.exec("UPDATE topic_queries SET enabled=0 WHERE topic_id=? AND query=?",
                    (topic_id, r["query"]))
    return rows


def liked_authors(db, topic_id):
    return db.q("""
      SELECT i.author, i.platform, max(i.author_url) AS author_url, max(i.author_name) AS author_name,
             sum(t.label=1) AS pos, sum(t.label=-1) AS neg
      FROM topic_items t JOIN items i ON i.id=t.item_id
      WHERE t.topic_id=? AND t.label != 0 AND coalesce(i.author,'') != ''
      GROUP BY i.author, i.platform HAVING pos >= 2 AND pos > 2*neg
      ORDER BY pos DESC, neg ASC LIMIT 30""", (topic_id,))
