"""Patterns in a topic's posts, en masse: is it growing, where it spread, who drove it, how heated it is,
what kind of problem it is, which storylines run inside it, and whether some of it looks coordinated.
Every number carries the posts behind it. No model, no lookups: counting, time, words."""
import math
import re
import statistics
from collections import Counter, defaultdict

from .learn import member_ids
from .people import OUTLETS, STOP, _entities, _mentions
from .util import light_stem, now, tokens

DAY = 86400
# words people use when they are angry at something, not merely talking about it
HEAT = set(("outrage outraged outrageous disgusting disgusted disgrace disgraceful shame shameful shameless boycott resign resigns "
            "resignation fired unacceptable scandal backlash protest protests protesters protesting lawsuit sue sued suing furious "
            "angry anger fury slam slams slammed blast blasts blasted condemn condemns condemned demand demands demanding accountability "
            "accountable corrupt corruption lies lied liar lying coverup cover-up racist racism sexist abuse abusive harassment threat "
            "threats threatened victim victims apology apologize apologizes apologized controversy controversial uproar ban banned petition "
            "wtf smh shocking horrifying horrific appalling appalled infuriating pathetic criminal illegal fraud hypocrite hypocrisy "
            "betrayed betrayal negligence negligent reckless outcry exposed caught fail failed failure cancel cancelled").split())
# what kind of problem people are describing (one post can be several)
ISSUES = {
    "safety / crime": "shooting shot stabbing stabbed robbery robbed arrested arrest police murder homicide assault assaulted missing kidnapped shooter gunfire burglary theft stolen carjacking",
    "health": "hospital hospitals outbreak overdose overdoses virus illness cancer disease infection infected contaminated poisoning sick measles flu covid mental suicide ambulance er",
    "housing": "rent rents eviction evicted homeless homelessness housing landlord landlords tenants affordable mortgage foreclosure shelter",
    "environment / weather": "flood flooding flooded pollution polluted toxic contaminated spill wildfire fire fires hurricane storm tornado heatwave drought sewage algae smoke evacuate evacuation",
    "jobs / labor": "strike striking layoffs layoff laid wages wage union unions unemployment unemployed jobs hiring overtime walkout picket",
    "discrimination": "racist racism discrimination discriminated hate bias bigotry slur harassment harassed sexism antisemitic islamophobic homophobic transphobic",
    "corruption / governance": "corruption corrupt fraud bribe bribery indicted indictment scandal resign resigns ethics lawsuit sued audit misconduct embezzlement kickback",
    "infrastructure / outages": "outage outages power blackout water main sewer bridge road closed closure internet down boil notice pothole potholes derailment collapse grid",
    "education": "school schools teacher teachers students student board curriculum tuition classroom superintendent principal campus",
    "cost of living": "prices price inflation gas groceries gouging bills bill afford cost costs expensive insurance premiums rates fees",
    "immigration": "ice deportation deported deportations border migrants migrant asylum immigration immigrants raid raids detained detention",
}
ISSUE_WORDS = {k: set(v.split()) for k, v in ISSUES.items()}


def _day(ts):
    return int(ts // DAY)


def _ref(it):
    return {"id": it["id"], "url": it.get("url"), "text": str(it.get("text") or "")[:120], "author": it.get("author"), "platform": it.get("platform"), "posted_at": it.get("posted_at")}


def _norm(text):
    t = re.sub(r"https?://\S+|@\w+|#", " ", str(text or "").lower())
    return re.sub(r"[^a-z0-9 ]+", " ", t).split()


def trend(items, horizon=30):
    """Posts per day over the horizon, the burst (days far above the days before them) and a plain state."""
    dated = [it for it in items if it.get("posted_at")]
    if not dated:
        return {"series": [], "state": "undated", "why": "the posts carry no dates"}
    end = _day(now())
    start = end - horizon + 1
    per = Counter(_day(it["posted_at"]) for it in dated)
    series = [{"day": d * DAY, "n": per.get(d, 0)} for d in range(start, end + 1)]
    older = sum(n for d, n in per.items() if d < start)
    # burst: a day more than 2 standard deviations above the mean of the 7 days before it (and at least 3 posts)
    bursts = []
    for d in range(start, end + 1):
        prev = [per.get(x, 0) for x in range(d - 7, d)]
        mu, sd = statistics.mean(prev), statistics.pstdev(prev)
        z = (per.get(d, 0) - mu) / max(sd, math.sqrt(max(mu, 1)))
        if per.get(d, 0) >= 3 and z >= 2:
            if bursts and bursts[-1]["end_day"] == d - 1:
                bursts[-1].update(end_day=d, end=d * DAY, n=bursts[-1]["n"] + per.get(d, 0), z=max(bursts[-1]["z"], round(z, 1)))
            else:
                bursts.append({"start": d * DAY, "end": d * DAY, "start_day": d, "end_day": d, "n": per.get(d, 0), "z": round(z, 1)})
    last7 = sum(per.get(x, 0) for x in range(end - 6, end + 1))
    prev7 = sum(per.get(x, 0) for x in range(end - 13, end - 6))
    last1 = per.get(end, 0) + per.get(end - 1, 0)
    velocity = round(last7 / prev7, 2) if prev7 else (float("inf") if last7 else 0)
    peak_day = max(per, key=per.get)
    if last7 == 0 and prev7 == 0:
        state, why = "quiet", f"nothing new in two weeks; peak was {per[peak_day]} posts in a day"
    elif bursts and bursts[-1]["end_day"] >= end - 1:
        state, why = "surging", f"{bursts[-1]['n']} posts in the last burst, {bursts[-1]['z']}× the usual spread above the week before"
    elif prev7 and velocity >= 1.5:
        state, why = "rising", f"{last7} posts this week vs {prev7} last week"
    elif prev7 and velocity <= 0.5:
        state, why = "fading", f"{last7} posts this week vs {prev7} last week"
    elif not prev7 and last7:
        state, why = "new", f"{last7} posts this week, none the week before"
    else:
        state, why = "steady", f"{last7} this week, {prev7} last week"
    for b in bursts:
        # take-off: the moment a fifth of the burst's posts were out. "Before the burst" means before this.
        ts = sorted(it["posted_at"] for it in dated if b["start_day"] <= _day(it["posted_at"]) <= b["end_day"])
        b["takeoff"] = ts[max(0, int(len(ts) * 0.2) - 1)] if ts else b["start"]
        b.pop("start_day", None)
        b.pop("end_day", None)
    return {"series": series, "older": older, "last7": last7, "prev7": prev7, "last48h": last1, "velocity": None if velocity == float("inf") else velocity,
            "peak": {"day": peak_day * DAY, "n": per[peak_day]}, "bursts": bursts[-3:], "state": state, "why": why,
            "first": min(it["posted_at"] for it in dated), "last": max(it["posted_at"] for it in dated)}


def spread(items):
    """Which networks it lives on, in what order it reached them, how many voices, how many are new this week."""
    first, per, accts = {}, Counter(), defaultdict(set)
    for it in items:
        p = it.get("platform") or "?"
        per[p] += 1
        accts[p].add(str(it.get("author") or "").lower())
        if it.get("posted_at"):
            first[p] = min(first.get(p, it["posted_at"]), it["posted_at"])
    order = sorted(first, key=first.get)
    crossover = [{"from": order[i], "to": order[i + 1], "hours": round((first[order[i + 1]] - first[order[i]]) / 3600, 1)} for i in range(len(order) - 1)]
    firsts = {}
    for it in sorted((x for x in items if x.get("posted_at")), key=lambda x: x["posted_at"]):
        firsts.setdefault(str(it.get("author") or "").lower(), it["posted_at"])
    cut = now() - 7 * DAY
    new_accts = sum(1 for ts in firsts.values() if ts >= cut)
    outlets = {str(it.get("author_name") or it.get("author") or "") for it in items if it.get("platform") in OUTLETS}
    first_outlet = next((it for it in sorted((x for x in items if x.get("posted_at") and x.get("platform") in OUTLETS), key=lambda x: x["posted_at"])), None)
    first_post = next((it for it in sorted((x for x in items if x.get("posted_at") and x.get("platform") not in OUTLETS), key=lambda x: x["posted_at"])), None)
    why = []
    if order:
        why.append("started on " + order[0] + (" and reached " + ", ".join(order[1:3]) if len(order) > 1 else ""))
    if first_post and first_outlet:
        gap = (first_outlet["posted_at"] - first_post["posted_at"]) / 3600
        why.append(("news followed the posts by %.0f hours" % gap) if gap > 0 else ("the posts followed the news by %.0f hours" % -gap))
    return {"platforms": [{"platform": p, "n": n, "accounts": len(accts[p]), "first": first.get(p)} for p, n in per.most_common()],
            "accounts": len(set().union(*accts.values())) if accts else 0, "new_accounts_7d": new_accts, "crossover": crossover,
            "outlets": len(outlets), "first_outlet": _ref(first_outlet) if first_outlet else None, "first_post": _ref(first_post) if first_post else None,
            "why": "; ".join(why)}


def drivers(items, burst_start=None, top=10):
    """Who moved it: reach (likes, reposts, replies, views), being named by others, posting early, posting a lot."""
    by = defaultdict(list)
    for it in items:
        if it.get("author"):
            by[(str(it["author"]).lower(), it.get("platform") or "")].append(it)
    named = Counter()
    for it in items:
        for m in _mentions(it.get("text")):
            if m != str(it.get("author") or "").lower():
                named[m] += 1
    first_all = min((it["posted_at"] for it in items if it.get("posted_at")), default=0)
    last_all = max((it["posted_at"] for it in items if it.get("posted_at")), default=0)
    early_cut = burst_start or (first_all + 0.1 * (last_all - first_all))
    out = []
    for (a, p), its in by.items():
        reach = sum((it.get("likes") or 0) + 2 * (it.get("reposts") or 0) + (it.get("replies") or 0) + (it.get("views") or 0) / 100 for it in its)
        ts = [it["posted_at"] for it in its if it.get("posted_at")]
        early = bool(ts) and min(ts) <= early_cut and len(ts) > 0
        nm = named.get(a, 0)
        score = math.log1p(reach) + 2 * math.log1p(nm) + math.log1p(len(its)) + (2 if early else 0)
        why = []
        if reach >= 50:
            why.append(f"reach {int(reach):,} (likes, reposts, replies, views)")
        if nm:
            why.append(f"named by others {nm}×")
        if early:
            why.append("posted before the burst" if burst_start else "among the first to post")
        if len(its) >= 3:
            why.append(f"{len(its)} posts")
        best = max(its, key=lambda it: (it.get("likes") or 0) + 2 * (it.get("reposts") or 0))
        out.append({"id": f"{a}|{p}", "author": a, "platform": p, "role": "outlet" if p in OUTLETS else "person", "n": len(its), "reach": int(reach),
                    "named_by": nm, "early": early, "first": min(ts) if ts else None, "score": round(score, 2), "why": why, "example": _ref(best)})
    out.sort(key=lambda d: -d["score"])
    return out[:top]


def heat(items, seed_words=()):
    """How heated the talk is: anger words, replies swamping likes, shouting, and a 0..100 score with the parts shown."""
    n = max(1, len(items))
    hits, words, examples = 0, Counter(), []
    shout = 0
    contested = []
    for it in items:
        toks = tokens(it.get("text"))
        hw = [w for w in toks if w in HEAT or light_stem(w) in HEAT]
        if hw:
            hits += 1
            words.update(set(hw))
            if len(examples) < 6:
                examples.append(dict(_ref(it), words=sorted(set(hw))[:4]))
        caps = [w for w in re.findall(r"\b[A-Z]{4,}\b", str(it.get("text") or "")) if w not in ("HTTP", "HTTPS", "NEWS")]
        if len(caps) >= 2 or str(it.get("text") or "").count("!") >= 3:
            shout += 1
        if (it.get("likes") or 0) >= 10 and it.get("replies") is not None:
            contested.append((it.get("replies") or 0) / max(1, it.get("likes") or 0))
    share = hits / n
    ratio = statistics.median(contested) if contested else None
    parts = [{"kind": "anger words", "value": round(share, 2), "points": round(min(50, 50 * share / 0.35)), "note": f"{hits} of {n} posts use words like " + ", ".join(w for w, _ in words.most_common(3))} if hits else
             {"kind": "anger words", "value": 0, "points": 0, "note": "no anger words to speak of"},
             {"kind": "shouting", "value": round(shout / n, 2), "points": round(min(15, 15 * (shout / n) / 0.25)), "note": f"{shout} posts in caps or with !!!"}]
    if ratio is not None:
        parts.append({"kind": "replies vs likes", "value": round(ratio, 2), "points": round(min(25, 25 * ratio / 1.0)), "note": f"typical post gets {ratio:.1f} replies per like" + (" (argued with more than agreed with)" if ratio >= 0.5 else "")})
    score = min(100, sum(p["points"] for p in parts))
    level = "uproar" if score >= 60 else "hot" if score >= 35 else "warm" if score >= 15 else "calm"
    return {"score": score, "level": level, "parts": parts, "words": [{"word": w, "n": c} for w, c in words.most_common(12)], "examples": examples}


def issues(items):
    """What kind of problem the posts describe, by the words they use. Shares, not verdicts."""
    n = max(1, len(items))
    out = []
    for cat, ws in ISSUE_WORDS.items():
        hit, words, ex = 0, Counter(), []
        for it in items:
            toks = set(tokens(it.get("text")))
            h = toks & ws
            if h:
                hit += 1
                words.update(h)
                if len(ex) < 3:
                    ex.append(_ref(it))
        if hit >= max(2, 0.03 * n):
            out.append({"category": cat, "n": hit, "share": round(hit / n, 2), "words": [w for w, _ in words.most_common(5)], "examples": ex})
    out.sort(key=lambda x: -x["n"])
    return out


def storylines(items, seed_words=(), max_lines=5):
    """Threads inside the topic: posts grouped by their most telling shared word, named by the words that go with it."""
    skip = set(seed_words) | STOP
    docs = []
    for it in items:
        ws = {w for w in tokens(it.get("text")) if len(w) > 3 and w not in skip and not w.isdigit()}
        docs.append((it, ws))
    n = len(docs)
    if n < 6:
        return []
    df = Counter(w for _, ws in docs for w in ws)
    cand = [w for w, c in df.items() if 0.04 * n <= c <= 0.5 * n and c >= 3]
    left = list(range(n))
    out = []
    while cand and left and len(out) < max_lines:
        sub = Counter(w for i in left for w in docs[i][1] if w in cand)
        if not sub:
            break
        w0, c0 = sub.most_common(1)[0]
        if c0 < max(3, 0.04 * n):
            break
        members = [i for i in left if w0 in docs[i][1]]
        co = Counter(w for i in members for w in docs[i][1] if w in cand)
        # the words that belong to this thread: used by most of its posts and rarely outside it
        ranked = sorted(((c * c / df[w]) * (1.2 if len(w) > 5 else 1), w) for w, c in co.items() if c >= 0.4 * len(members))
        terms = [w for _, w in reversed(ranked)][:5]
        if w0 not in terms:
            terms.append(w0)
        its = [docs[i][0] for i in members]
        dated = [it["posted_at"] for it in its if it.get("posted_at")]
        accts = {str(it.get("author") or "").lower() for it in its}
        ents = Counter(e for it in its for e in _entities(it.get("text"), seed_words))
        out.append({"name": " · ".join(terms[:3]), "terms": terms, "n": len(its), "share": round(len(its) / n, 2), "accounts": len(accts),
                    "first": min(dated) if dated else None, "last": max(dated) if dated else None,
                    "last7": sum(1 for ts in dated if ts >= now() - 7 * DAY), "names": [e for e, _ in ents.most_common(4)],
                    "examples": [_ref(it) for it in sorted(its, key=lambda x: -((x.get("likes") or 0) + (x.get("reposts") or 0)))[:3]]})
        left = [i for i in left if i not in set(members)]
        cand = [w for w in cand if w not in terms]
    return out


def coordination(items):
    """The same words from many accounts, close together; the same link pushed by many. Signs, not proof."""
    groups, links = defaultdict(list), defaultdict(list)
    for it in items:
        ws = _norm(it.get("text"))
        if len(ws) >= 6:
            groups[" ".join(ws[:14])].append(it)
        for u in re.findall(r"https?://\S+", str(it.get("text") or "")):
            u = u.rstrip(".,)")
            if u != it.get("url"):
                links[u].append(it)
    copies = []
    for key, its in groups.items():
        accts = {str(it.get("author") or "").lower() for it in its}
        if len(accts) >= 3:
            ts = sorted(it["posted_at"] for it in its if it.get("posted_at"))
            copies.append({"text": str(its[0].get("text") or "")[:160], "n": len(its), "accounts": len(accts), "platforms": sorted({it.get("platform") or "" for it in its}),
                           "within_hours": round((ts[-1] - ts[0]) / 3600, 1) if len(ts) > 1 else None, "examples": [_ref(it) for it in its[:3]]})
    copies.sort(key=lambda c: (-c["accounts"], c["within_hours"] or 1e9))
    same = []
    for u, its in links.items():
        accts = {str(it.get("author") or "").lower() for it in its}
        if len(accts) >= 3:
            same.append({"url": u, "n": len(its), "accounts": len(accts), "examples": [_ref(it) for it in its[:3]]})
    same.sort(key=lambda c: -c["accounts"])
    note = ""
    if copies:
        c = copies[0]
        note = f"{c['accounts']} accounts posted the same words" + (f" within {c['within_hours']} hours" if c["within_hours"] is not None else "") + ". Could be a campaign, a share button, or a quote. Read them."
    return {"copies": copies[:6], "same_link": same[:6], "note": note}


def lead_lag(items, burst):
    """What showed up just before the burst: the first outlet, account or name that preceded it by under two days."""
    if not burst:
        return []
    t0 = burst.get("takeoff") or burst["start"]
    firsts = {}
    for it in sorted((x for x in items if x.get("posted_at")), key=lambda x: x["posted_at"]):
        a = ("outlet " if it.get("platform") in OUTLETS else "@") + str(it.get("author_name") if it.get("platform") in OUTLETS else it.get("author") or "")
        firsts.setdefault(a, (it["posted_at"], it))
        for e in _entities(it.get("text")):
            firsts.setdefault("name " + e, (it["posted_at"], it))
    after = Counter()
    for it in items:
        if (it.get("posted_at") or 0) >= t0:
            a = ("outlet " if it.get("platform") in OUTLETS else "@") + str(it.get("author_name") if it.get("platform") in OUTLETS else it.get("author") or "")
            after[a] += 1
            for e in _entities(it.get("text")):
                after["name " + e] += 1
    out = [{"what": k, "first": ts, "hours_before": round((t0 - ts) / 3600, 1), "after": after.get(k, 0), "example": _ref(it)}
           for k, (ts, it) in firsts.items() if 0 <= t0 - ts <= 2 * DAY and (after.get(k, 0) >= 3 or t0 - ts >= 2 * 3600)]   # not the burst's own first voices
    out.sort(key=lambda x: -x["after"])
    return out[:8]


def build(vault, tid, max_items=3000):
    t = vault.topic(tid)
    if not t:
        return {"error": "no such topic"}
    ids = member_ids(vault.db, tid)
    items = list(vault.db.get_many(list(ids)[:max_items]).values())
    seed_words = {w for s in (t.get("seeds") or []) + [t.get("name") or ""] for w in tokens(s)}
    return summarize(items, seed_words)


def summarize(items, seed_words=()):
    tr = trend(items)
    burst = (tr.get("bursts") or [None])[-1]
    sp = spread(items)
    ht = heat(items, seed_words)
    st = storylines(items, seed_words)
    co = coordination(items)
    dr = drivers(items, (burst.get("takeoff") or burst["start"]) if burst else None)
    iss = issues(items)
    headline = []
    if tr["state"] in ("surging", "rising"):
        headline.append(tr["state"] + " (" + tr["why"] + ")")
    elif tr["state"] in ("fading", "quiet"):
        headline.append(tr["state"])
    if ht["level"] in ("hot", "uproar"):
        headline.append(ht["level"] + ": " + ", ".join(w["word"] for w in ht["words"][:3]))
    if iss:
        headline.append("reads as " + iss[0]["category"] + (" and " + iss[1]["category"] if len(iss) > 1 else ""))
    if co["copies"] and co["copies"][0]["accounts"] >= 5:
        headline.append(f"{co['copies'][0]['accounts']} accounts posting the same words")
    return {"n": len(items), "trend": tr, "spread": sp, "drivers": dr, "heat": ht, "issues": iss, "storylines": st,
            "coordination": co, "lead_lag": lead_lag(items, burst), "headline": "; ".join(headline) or "nothing out of the ordinary",
            "badge": {"state": tr["state"], "heat": ht["level"], "score": ht["score"], "velocity": tr.get("velocity")}, "generated": now()}
