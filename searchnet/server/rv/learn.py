"""Self-learning relevance for topics.

Every item gets a sparse feature vector (stemmed words, word pairs,
hashtags, author, site, the queries that found it, media type, length).
For each topic, 👍/👎 votes train:
  • a logistic-regression classifier (once both classes have examples)
  • a Rocchio profile (liked centroid − disliked centroid), works from 1 vote
  • optionally a semantic profile in embedding space (rv.embed)
Before any votes, a prior from how well the item matches the topic's
queries is used; the more votes, the more the learned part takes over.
No stopword list: common words get low weight through learning/IDF.
"""

import json
import math
import random
from collections import Counter, defaultdict

from .util import light_stem, now, tokens

ORIGIN_WEIGHT = {"seed": 1.0, "user": 1.0, "morph": 0.9, "synonym": 0.8, "learned": 0.65,
                 "cooccur": 0.6, "web": 0.55, "author": 0.7, "related": 0.6, "soft": 0.45}


def sigmoid(z):
    if z < -30:
        return 0.0
    if z > 30:
        return 1.0
    return 1 / (1 + math.exp(-z))


def idf_scaler(db):
    """word → weight in (0.15..1]: rare words count fully, very common words
    fade (no word is ever dropped)."""
    df, n = db.vocab_df(), max(db.doc_count(), 1)
    top = math.log(n + 1) + 1

    def scale(stem):
        d = df.get(stem) or next((df[stem[:len(stem) - k]] for k in (1, 2, 3)
                                  if len(stem) - k > 2 and stem[:len(stem) - k] in df), 0)
        return max(0.15, (math.log((n + 1) / (d + 1)) + 1) / top) if n >= 20 else 1.0
    return scale


def item_features(it, queries=(), scale=None):
    f = Counter()
    toks = tokens(it.get("text"))
    stems = [light_stem(t) for t in toks]
    for s in stems:
        f["w:" + s] += 1
    for a, b in zip(stems, stems[1:]):
        f[f"b:{a}_{b}"] += 0.7
    for h in (it.get("hashtags") or "").lower().split():
        f["#:" + h] += 1.5
        f["w:" + light_stem(h)] += 0.5
    for t in (it.get("tags") or "").split():
        f["#:" + t] += 0.5
    if it.get("author"):
        f["@:" + str(it["author"]).lower()] += 1.2
    if it.get("platform"):
        f["s:" + it["platform"]] += 0.5
    for t in set(tokens((it.get("transcript") or "")[:4000])):
        f["w:" + light_stem(t)] += 0.4
    for t in set(tokens((it.get("ocr") or "")[:1500])):
        f["w:" + light_stem(t)] += 0.3
    for q in queries:
        f["q:" + q.lower()] += 0.8
    f["m:" + (it.get("media") or "video")] += 0.3
    d = it.get("duration") or 0
    if d:
        f["d:" + ("short" if d < 30 else "mid" if d < 180 else "long")] += 0.3
    # sublinear counts, rarity weighting for words, L2 normalize
    vec = {k: 1 + math.log(v) if v >= 1 else v for k, v in f.items()}
    if scale:
        for k in vec:
            if k[0] == "w" and k[1] == ":":
                vec[k] *= scale(k[2:])
            elif k[0] == "b" and k[1] == ":":
                a, _, b = k[2:].partition("_")
                vec[k] *= math.sqrt(scale(a) * scale(b))
    norm = math.sqrt(sum(v * v for v in vec.values())) or 1
    return {k: v / norm for k, v in vec.items()}


def surface_forms(items):
    """stem → most common original word, so learned terms read naturally."""
    seen = defaultdict(Counter)
    for it in items:
        for t in tokens(it.get("text")) + (it.get("hashtags") or "").lower().split():
            seen[light_stem(t)][t] += 1
    return {s: c.most_common(1)[0][0] for s, c in seen.items()}


def train_lr(samples, epochs=40, lr=0.6, l2=2e-3, seed=7):
    """samples: [(features, y∈{0,1})]. Class-balanced SGD logistic regression."""
    n = len(samples)
    pos = sum(1 for _, y in samples if y) or 1
    neg = (n - pos) or 1
    cw = {1: n / (2 * pos), 0: n / (2 * neg)}
    w, b = defaultdict(float), 0.0
    rnd = random.Random(seed)
    order = list(range(n))
    for ep in range(epochs):
        rnd.shuffle(order)
        step = lr / (1 + ep * 0.1)
        for i in order:
            x, y = samples[i]
            p = sigmoid(b + sum(w[k] * v for k, v in x.items()))
            g = (p - y) * cw[y]
            b -= step * g * 0.5
            for k, v in x.items():
                w[k] -= step * (g * v + l2 * w[k])
    return {k: round(v, 5) for k, v in w.items() if abs(v) > 1e-4}, b


def centroid(vecs):
    c = defaultdict(float)
    for v in vecs:
        for k, x in v.items():
            c[k] += x
    n = len(vecs) or 1
    c = {k: x / n for k, x in c.items()}
    norm = math.sqrt(sum(x * x for x in c.values())) or 1
    return {k: x / norm for k, x in c.items()}


def cos(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(k, 0) for k, v in a.items())


def clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


# ─────────────────────────────────────────────────────────────────
#  Query prior: how well does an item match the topic's searches?
# ─────────────────────────────────────────────────────────────────

def query_terms(queries):
    """[(query, origin, weight)] → [(set_of_stems, weight, query)]"""
    out = []
    for q, origin, w in queries:
        if q.startswith("@"):
            out.append(({"@" + q[1:].lower()}, ORIGIN_WEIGHT.get(origin, .6) * w, q))
            continue
        stems = {light_stem(t) for t in tokens(q.replace("#", " ")) if t != "or"}
        if stems:
            out.append((stems, ORIGIN_WEIGHT.get(origin, .6) * w, q))
    return out


def item_stems(it):
    s = {light_stem(t) for t in tokens(" ".join(str(it.get(k) or "") for k in
                                                ("text", "hashtags", "tags", "transcript", "ocr")))}
    for h in (it.get("hashtags") or "").lower().split():
        s.add(light_stem(h))
    if it.get("author"):
        s.add("@" + str(it["author"]).lower())
    return s


def prior_score(it, qterms, hit_queries=()):
    have = item_stems(it)
    hits = {q.lower() for q in hit_queries}
    miss = 1.0
    best = []
    long_have = [h for h in have if len(h) > 4]
    for stems, w, q in qterms:
        # exact stem match = 1, word that starts with it (skate → skateboarding) = 0.8
        cov = sum(1.0 if s in have else 0.8 if len(s) >= 4 and any(h.startswith(s) for h in long_have)
                  else 0.0 for s in stems) / len(stems)
        if q.lower() in hits:            # a search engine returned it for this query
            cov = max(cov, 0.5)
        if cov > 0:
            miss *= 1 - w * min(1.0, cov ** 1.5)
            best.append((w * cov, q))
    best.sort(reverse=True)
    return 1 - miss, [q for _, q in best[:3]]


# ─────────────────────────────────────────────────────────────────
#  Topic model: train + score
# ─────────────────────────────────────────────────────────────────

class TopicScorer:
    def __init__(self, vault, topic_id):
        self.v, self.tid = vault, topic_id
        db = vault.db
        self.topic = db.one("SELECT * FROM topics WHERE id=?", (topic_id,))
        qrows = db.q("SELECT query, origin, weight FROM topic_queries WHERE topic_id=? AND enabled=1",
                     (topic_id,))
        seeds = json.loads(self.topic["seeds"] or "[]") if self.topic else []
        settings = json.loads(self.topic["settings"] or "{}") if self.topic else {}
        soft = [s for s in (settings.get("soft") or []) + (settings.get("_attr_soft") or [])
                if s and s.strip()]
        qs = {(r["query"], r["origin"], r["weight"] or 1) for r in qrows}
        qs |= {(s, "seed", 1.0) for s in seeds}
        qs |= {(s, "soft", 1.0) for s in soft}     # boost when present, never required
        self.qterms = query_terms(sorted(qs))
        self.anti = {light_stem(w) for w in (settings.get("anti") or []) if w}
        self.prefs = settings.get("prefs") or {}
        self.seed_stems = {light_stem(w) for s in list(seeds) + soft
                           for w in tokens(s)}
        self.hits = defaultdict(list)
        for r in db.q("SELECT item_id, query FROM topic_hits WHERE topic_id=?", (topic_id,)):
            self.hits[r["item_id"]].append(r["query"])
        labels = db.q("SELECT item_id, label FROM topic_items WHERE topic_id=? AND label != 0",
                      (topic_id,))
        self.labels = {r["item_id"]: r["label"] for r in labels}
        items = db.get_many(self.labels)
        self.scale = idf_scaler(db)
        self.feats = {i: item_features(items[i], self.hits.get(i, ()), self.scale) for i in items}
        pos = [self.feats[i] for i, l in self.labels.items() if l > 0 and i in self.feats]
        neg = [self.feats[i] for i, l in self.labels.items() if l < 0 and i in self.feats]
        self.n_pos, self.n_neg = len(pos), len(neg)
        self.pc, self.nc = centroid(pos) if pos else {}, centroid(neg) if neg else {}
        self.w, self.b = {}, 0.0
        if self.n_pos >= 2 and self.n_neg >= 2:
            samples = [(self.feats[i], 1 if l > 0 else 0) for i, l in self.labels.items()
                       if i in self.feats]
            self.w, self.b = train_lr(samples)
        # semantic profile
        self.sem = vault.embed if vault.embed and vault.embed.ready() else None
        self.seed_vec = self.pos_vec = self.neg_vec = None
        if self.sem:
            name = (self.topic or {}).get("name", "")
            self.seed_vec = self.sem.text_vec(" ".join([name] + seeds))
            self.pos_vec = self.sem.mean([i for i, l in self.labels.items() if l > 0])
            self.neg_vec = self.sem.mean([i for i, l in self.labels.items() if l < 0])
        self.surface = surface_forms(items.values())
        self.items = items

    def score(self, it):
        hq = self.hits.get(it["id"], ())
        prior, matched = prior_score(it, self.qterms, hq)
        x = self.feats.get(it["id"]) or item_features(it, hq, self.scale)
        why = {"matched": matched, "prior": round(prior, 3)}
        sem_seed = None
        if self.sem and self.seed_vec is not None:
            sv = self.sem.item_vec(it["id"])
            if sv is not None:
                sem_seed = clip((self.sem.dot(sv, self.seed_vec) - 0.25) / 0.45)
                why["meaning"] = round(sem_seed, 3)
        base = prior if sem_seed is None else 0.6 * prior + 0.4 * sem_seed
        n = self.n_pos + self.n_neg
        if n == 0:
            return base, why
        parts = []
        if self.pc or self.nc:
            r = cos(x, self.pc) - 0.7 * cos(x, self.nc)
            parts.append((sigmoid(5 * r - 0.5), 1.0))
        if self.w:
            z = self.b + sum(self.w.get(k, 0) * v for k, v in x.items())
            p = sigmoid(z)
            parts.append((p, 1.5))
            why["model"] = round(p, 3)
        if self.sem and self.pos_vec is not None:
            sv = self.sem.item_vec(it["id"])
            if sv is not None:
                sp = self.sem.dot(sv, self.pos_vec)
                sn = self.sem.dot(sv, self.neg_vec) if self.neg_vec is not None else 0.45
                s = clip(0.5 + 2.2 * (sp - sn))
                parts.append((s, 1.2))
                why["taste"] = round(s, 3)
        learned = sum(p * w for p, w in parts) / sum(w for _, w in parts)
        alpha = min(0.85, n / (n + 4))
        final = (1 - alpha) * base + alpha * learned
        final = self._apply_reasons(it, final, why)
        why["lower"] = self._why_lower(x) + why.get("lower", [])
        # dedupe, drop the topic's own words, cap
        out, seen = [], set()
        for w in why["lower"]:
            base_w = str(w).lstrip("#@").lower()
            if base_w and base_w not in seen and light_stem(base_w) not in self.seed_stems:
                seen.add(base_w)
                out.append(w)
        if out:
            why["lower"] = out[:4]
        else:
            why.pop("lower", None)
        return final, why

    def _apply_reasons(self, it, score, why):
        """Reasons you gave on 👎 become hard preferences: anti-keywords and
        short/long/ai/ad avoidance pull a matching item's score right down."""
        flags = []
        if self.anti:
            have = item_stems(it)
            hit = self.anti & have
            if hit:
                score *= max(0.1, 1 - 0.6 * min(3, len(hit)))
                flags += sorted(hit)[:3]
        d = it.get("duration") or 0
        if self.prefs.get("avoid_short") and 0 < d < 30:
            score *= 0.4
            flags.append("short")
        if self.prefs.get("avoid_long") and d > 180:
            score *= 0.5
            flags.append("long")
        if flags:
            why["lower"] = flags + why.get("lower", [])
        return score

    def _why_lower(self, x, n=3):
        """This item's own words/tags that you tend to 👎 — the 'why not' hint.
        Uses the trained classifier weights, else the disliked profile."""
        src = self.w if self.w else {k: -v for k, v in self.nc.items()}
        if not src:
            return []
        scored = [(x[k] * src[k], k) for k in x if src.get(k, 0) < 0]
        scored.sort()        # most negative contribution first
        out, seen = [], set()
        for contrib, k in scored:
            if contrib >= -0.02:
                break
            label = self.readable(k)
            base = label.lstrip("#@").lower()
            if base in seen or k[0] in "sdmq":   # skip site/duration/media/query internals
                continue
            seen.add(base)
            out.append(label)
            if len(out) >= n:
                break
        return out

    def rescore(self, item_ids=None):
        db = self.v.db
        if item_ids is None:
            item_ids = [r["item_id"] for r in
                        db.q("SELECT item_id FROM topic_items WHERE topic_id=?", (self.tid,))]
        items = db.get_many(item_ids)
        rows = []
        for iid, it in items.items():
            s, why = self.score(it)
            rows.append((round(s, 5), json.dumps(why), self.tid, iid))
        db.many("UPDATE topic_items SET score=?, why=? WHERE topic_id=? AND item_id=?", rows)
        db.exec("UPDATE topics SET model=? WHERE id=?", (json.dumps(
            {"n_pos": self.n_pos, "n_neg": self.n_neg, "features": len(self.w),
             "trained": now()}), self.tid))
        return len(rows)

    # ── what did it learn? ──────────────────────────────────────
    def readable(self, feat):
        kind, _, val = feat.partition(":")
        if kind == "w":
            return self.surface.get(val, val)
        if kind == "b":
            a, _, b = val.partition("_")
            return f"{self.surface.get(a, a)} {self.surface.get(b, b)}"
        if kind == "#":
            return "#" + val
        if kind == "@":
            return "@" + val
        if kind == "s":
            return "site:" + val
        if kind == "q":
            return "search: " + val
        if kind == "d":
            return {"short": "short clips", "mid": "medium length", "long": "long videos"}[val]
        if kind == "m":
            return val + "s"
        return feat

    def top_features(self, n=16):
        if self.w:
            ranked = sorted(self.w.items(), key=lambda kv: -kv[1])
            pos = [(k, v) for k, v in ranked if v > 0][:n]
            neg = [(k, v) for k, v in reversed(ranked) if v < 0][:n]
        else:
            diff = defaultdict(float)
            for k, v in self.pc.items():
                diff[k] += v
            for k, v in self.nc.items():
                diff[k] -= 0.7 * v
            ranked = sorted(diff.items(), key=lambda kv: -kv[1])
            pos = [(k, v) for k, v in ranked if v > 0][:n]
            neg = [(k, v) for k, v in reversed(ranked) if v < 0][:n]
        fmt = lambda lst: [{"feature": k, "label": self.readable(k), "weight": round(v, 3)}  # noqa: E731
                           for k, v in lst]
        return fmt(pos), fmt(neg)


def query_stats(db, topic_id):
    rows = db.q("""
      SELECT q.query, q.origin, q.enabled, q.locked, q.runs, q.found, q.last_run, q.weight,
        (SELECT count(*) FROM topic_hits h JOIN topic_items t
           ON t.topic_id=h.topic_id AND t.item_id=h.item_id
         WHERE h.topic_id=q.topic_id AND h.query=q.query AND t.label=1) AS pos,
        (SELECT count(*) FROM topic_hits h JOIN topic_items t
           ON t.topic_id=h.topic_id AND t.item_id=h.item_id
         WHERE h.topic_id=q.topic_id AND h.query=q.query AND t.label=-1) AS neg,
        (SELECT count(DISTINCT h.item_id) FROM topic_hits h
         WHERE h.topic_id=q.topic_id AND h.query=q.query) AS items
      FROM topic_queries q WHERE q.topic_id=? ORDER BY q.created, q.query""", (topic_id,))
    for r in rows:
        r["precision"] = round((r["pos"] + 1) / (r["pos"] + r["neg"] + 2), 3)
    return rows


def pick_queries(stats, k, explore=0.6):
    """UCB bandit over enabled queries: good precision + under-explored first.
    Seeds and your own queries always run."""
    total = sum(r["runs"] for r in stats) + 2
    must = [r for r in stats if r["enabled"] and r["origin"] in ("seed", "user")]
    rest = [r for r in stats if r["enabled"] and r["origin"] not in ("seed", "user")]
    for r in rest:
        r["ucb"] = r["precision"] * ORIGIN_WEIGHT.get(r["origin"], .6) ** 0.5 + \
            explore * math.sqrt(math.log(total) / (r["runs"] + 1))
    rest.sort(key=lambda r: -r["ucb"])
    return [r["query"] for r in must] + [r["query"] for r in rest[:max(0, k - len(must))]]
