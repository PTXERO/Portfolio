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
REFERENCE = {"archive", "wikipedia"}      # old documents and encyclopedia pages: context, never the first voice or a driver
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
# words that only mean trouble in context ("power", "fire", "school", "gas"): two of them in a post, or one of the plain ones
ISSUE_VAGUE = set("power main down internet water fire fires storm ice school schools board campus jobs price prices cost costs bills bill rates "
                  "fees gas mental sick er missing hate bias border raid raids grid collapse closure closed bridge road shelter rent rents housing "
                  "union unions students student teacher teachers insurance expensive afford spill smoke drought notice principal classroom "
                  "tuition premiums groceries assault theft stolen police arrest arrested detained hospital hospitals disease virus flu covid "
                  "cancer illness infection infected contaminated poisoning".split())
ISSUE_STRONG = {w for ws in ISSUE_WORDS.values() for w in ws} - ISSUE_VAGUE


def _day(ts):
    return int(ts // DAY)


def _ref(it):
    return {"id": it["id"], "url": it.get("url"), "text": str(it.get("text") or "")[:120], "author": it.get("author"), "platform": it.get("platform"), "posted_at": it.get("posted_at")}


def _norm(text):
    t = re.sub(r"https?://\S+|@\w+|#", " ", str(text or "").lower())
    return re.sub(r"[^a-z0-9 ]+", " ", t).split()


def trend(items, horizon=30):
    """Posts per day over the horizon, the burst (days far above the days before them) and a plain state."""
    dated = [it for it in items if it.get("posted_at") and it.get("platform") not in REFERENCE]
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
    for p in REFERENCE:
        first.pop(p, None)
    order = sorted(first, key=first.get)
    crossover = [{"from": order[i], "to": order[i + 1], "hours": round((first[order[i + 1]] - first[order[i]]) / 3600, 1)} for i in range(len(order) - 1)]
    firsts = {}
    for it in sorted((x for x in items if x.get("posted_at")), key=lambda x: x["posted_at"]):
        firsts.setdefault(str(it.get("author") or "").lower(), it["posted_at"])
    cut = now() - 7 * DAY
    new_accts = sum(1 for ts in firsts.values() if ts >= cut)
    outlets = {str(it.get("author_name") or it.get("author") or "") for it in items if it.get("platform") in OUTLETS and it.get("platform") not in REFERENCE}
    first_outlet = next((it for it in sorted((x for x in items if x.get("posted_at") and x.get("platform") in OUTLETS and x.get("platform") not in REFERENCE), key=lambda x: x["posted_at"])), None)
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
        if it.get("author") and it.get("platform") not in REFERENCE:
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


def _shouting(text):
    """!!! or a post mostly in capitals. A run of three capitalised words is a name or a title (A DAY TO REMEMBER), not a shout."""
    t = str(text or "")
    if t.count("!") >= 3:
        return True
    words = re.findall(r"[A-Za-z][A-Za-z'’-]{2,}", t)
    caps = [w.isupper() for w in words if w.upper() not in ("HTTP", "HTTPS", "NEWS", "USA", "NYC")]
    return sum(caps) >= 3 and sum(caps) / max(1, len(caps)) >= 0.6     # mostly capitals: a shout. A few: names and titles.


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
        if _shouting(it.get("text")):
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
            if h and not (h & ISSUE_STRONG) and len(h) < 2:
                continue
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


PLACE_HINT = re.compile(r"\b(?:in|at|near|outside|across|around)\s+([A-Z][\w'’.-]*(?:\s+(?:of\s+)?[A-Z][\w'’.-]*){0,3})")
PLACE_WORD = re.compile(r"\b(county|city|beach|island|park|street|avenue|river|lake|bay|valley|village|town|township|parish|district|downtown|harbor|harbour|heights|springs|falls|hills|coast|fla|calif|tex|ala|ga|n\.?c|s\.?c|va|pa|ny|nj|ohio|texas|florida|california|georgia|alabama|carolina|virginia|london|paris|tokyo)\b", re.I)


def places(items, seed_words=()):
    """Where it is, physically: datelines, and names written after in / at / near / from. Counted, with examples."""
    c, ex = Counter(), {}
    for it in items:
        if it.get("dateline"):
            c[it["dateline"]] += 2
            ex.setdefault(it["dateline"], _ref(it))
        text = str(it.get("text") or "")
        seen = set()
        for m in PLACE_HINT.finditer(text):
            name = m.group(1).strip(" .")
            low = name.lower()
            if len(name) < 3 or low in seen or all(w in seed_words or w in STOP for w in low.split()):
                continue
            if low.split()[0] in ("the", "a", "an", "my", "our", "this", "that", "least", "first", "last", "all", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                                  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"):
                continue
            seen.add(low)
            c[name] += 2 if PLACE_WORD.search(name) else 1
            ex.setdefault(name, _ref(it))
    # the same place in two spellings ("Naples" / "Naples, Fla.") counts once, under the fuller one
    out = []
    for name, n in c.most_common(40):
        if any(name != o["place"] and name.lower() in o["place"].lower() for o in out):
            continue
        if n >= 2:
            out.append({"place": name, "n": n, "example": ex.get(name)})
    return out[:10]


def top_posts(items, k=3):
    """The single posts that did the work: most reach, one per account."""
    reach = lambda it: (it.get("likes") or 0) + 2 * (it.get("reposts") or 0) + (it.get("replies") or 0) + (it.get("views") or 0) / 100   # noqa: E731
    out, seen = [], set()
    for it in sorted(items, key=lambda x: -reach(x)):
        a = str(it.get("author") or "").lower()
        if a in seen or reach(it) <= 0:
            continue
        seen.add(a)
        out.append(dict(_ref(it), reach=int(reach(it))))
        if len(out) >= k:
            break
    return out


def momentum(tr, sp, st):
    """The slope, not a prediction: this week against last, voices joining, storylines new or dying, outlets in or not."""
    parts, score = [], 0
    v = tr.get("velocity")
    if tr.get("state") in ("surging", "rising"):
        parts.append("growing: " + tr["why"])
        score += 2
    elif tr.get("state") in ("fading", "quiet"):
        parts.append(tr["state"] + ": " + tr["why"])
        score -= 2
    elif tr.get("state") == "new":
        parts.append("new this week")
        score += 1
    else:
        parts.append("steady")
    if sp.get("new_accounts_7d"):
        parts.append(f"{sp['new_accounts_7d']} new voices this week")
        score += 1
    fresh = [x for x in st if x.get("last7") and x["last7"] >= max(2, 0.5 * x["n"])]
    dying = [x for x in st if x.get("n", 0) >= 4 and not x.get("last7")]
    if fresh:
        parts.append("new storyline" + ("s" if len(fresh) > 1 else "") + ": " + ", ".join(x["name"] for x in fresh[:2]))
        score += 1
    if dying:
        parts.append("gone quiet: " + ", ".join(x["name"] for x in dying[:2]))
        score -= 1
    if sp.get("outlets"):
        parts.append(f"{sp['outlets']} outlet{'s' if sp['outlets'] != 1 else ''} on it")
    elif sp.get("accounts", 0) >= 10:
        parts.append("no outlet has picked it up yet")
    label = "picking up" if score >= 2 else "holding" if score >= -1 else "winding down"
    return {"label": label, "score": score, "why": "; ".join(parts)}


def arc(tr):
    """Born, peaked, now."""
    if not tr.get("first"):
        return None
    return {"born": tr["first"], "peak": tr.get("peak"), "last": tr.get("last"), "state": tr.get("state"),
            "age_days": max(0, (now() - tr["first"]) // DAY), "silent_days": max(0, (now() - tr["last"]) // DAY)}


def origin(items, sp, burst):
    """What started it, as far as the posts show: the first post, the first article, and what kicked off the burst."""
    o = {"first_post": sp.get("first_post"), "first_outlet": sp.get("first_outlet"), "news_led": None, "kickoff": None}
    fp, fo = sp.get("first_post"), sp.get("first_outlet")
    if fp and fo and fp.get("posted_at") and fo.get("posted_at"):
        o["news_led"] = fo["posted_at"] <= fp["posted_at"]
    if burst:
        t0 = burst.get("takeoff") or burst["start"]
        before = [it for it in items if it.get("posted_at") and t0 - 2 * DAY <= it["posted_at"] <= t0]
        if before:
            best = max(before, key=lambda it: (it.get("likes") or 0) + 2 * (it.get("reposts") or 0) + (1000 if it.get("platform") in OUTLETS else 0))
            o["kickoff"] = dict(_ref(best), hours_before=round((t0 - best["posted_at"]) / 3600, 1))
    return o


def build(vault, tid, max_items=3000):
    t = vault.topic(tid)
    if not t:
        return {"error": "no such topic"}
    ids = member_ids(vault.db, tid)
    items = list(vault.db.get_many(list(ids)[:max_items]).values())
    rated_ids = {r["item_id"] for r in vault.db.q("SELECT item_id FROM topic_items WHERE topic_id=? AND label != 0", (tid,))}
    seed_words = {w for s in (t.get("seeds") or []) + [t.get("name") or ""] for w in tokens(s)}
    out = summarize(items, seed_words)
    # topics in the library this one overlaps with (shared member posts)
    ov = Counter()
    if ids:
        marks = ",".join("?" * min(len(ids), 900))
        for r in vault.db.q(f"SELECT topic_id, count(*) n FROM topic_items WHERE item_id IN ({marks}) AND topic_id != ? AND label >= 0 GROUP BY topic_id",
                            list(ids)[:900] + [tid]):
            ov[r["topic_id"]] = r["n"]
    names = {r["id"]: r["name"] for r in vault.db.q("SELECT id, name FROM topics")}
    out["overlaps"] = [{"topic_id": k, "name": names.get(k, k), "n": n} for k, n in ov.most_common(6) if n >= 2 and k in names]
    out["kind"] = ((t.get("settings") or {}).get("plan") or {}).get("kind") or "general"
    from .plan import window_days
    st_ = t.get("settings") or {}
    srcs = [dict(x, auto_off=(x.get("options") or {}).get("auto_off")) for x in vault.list_sources() if x["id"] in set(t.get("sources") or [])]
    rated = sum(1 for it in items if it["id"] in rated_ids)
    out["trust"] = trust(items, out["trend"], out["spread"], srcs, window_days(st_, st_.get("plan")), out["trend"].get("older") or 0, rated)
    for y in out.get("stale") or []:
        out["trust"]["reasons"].append(f"{y['n']} posts are about {y['year']}, the same name on an earlier thing")
    return out


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
            "places": places(items, seed_words), "top_posts": top_posts(items), "momentum": momentum(tr, sp, st), "arc": arc(tr),
            "origin": origin(items, sp, burst), "claims": claims(items, seed_words), "numbers": numbers(items), "dated": dated(items),
            "stale": stale_years(items), "trust": trust(items, tr, sp),
            "badge": {"state": tr["state"], "heat": ht["level"], "score": ht["score"], "velocity": tr.get("velocity")}, "generated": now()}


# ── claims, numbers, dated events, trust ──
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])|\n+")
ASSERT = re.compile(r"\b(said|says|saying|confirmed|confirms|announced|announces|reports|reported|claims|claimed|denied|denies|admitted|admits|"
                    r"according to|told|stated|warned|warns|estimates|estimated|expects|expected|will|has|have|is|are|was|were)\b", re.I)
DISPUTE = re.compile(r"\b(false|not true|untrue|debunked|denies|denied|deny|misinformation|hoax|fake|no evidence|incorrect|wrong|rumor|rumour)\b", re.I)
NUM = re.compile(r"(?<![\w.])(\$|£|€)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(k|m|bn|b|million|billion|thousand|%|percent|mph|km/h|inches|feet|ft|miles|acres|degrees)\b)?"
                 r"(?:\s+(?:of\s+|a\s+|an\s+|per\s+)?([a-z][a-z-]{2,}))?", re.I)
NUM_SKIP = {"am", "pm", "the", "and", "for", "with", "that", "this", "from", "year", "years", "day", "days", "hour", "hours", "minute", "minutes",
            "week", "weeks", "month", "months", "time", "times", "ago", "today", "yesterday", "tomorrow", "more", "than", "about"}
SPEEDY = {"mph", "km/h", "inches", "feet", "ft", "miles"}
SPEED_CTX = {"wind", "winds", "gust", "gusts", "moving", "forward", "speed", "surge", "rain", "rainfall", "snow", "waves", "swells", "deep", "wide", "tall", "high", "long", "away", "offshore", "inland"}
UNIT_WORDS = {"%", "percent", "mph", "km/h", "inches", "feet", "ft", "miles", "acres", "degrees", "million", "billion", "thousand", "k", "m", "bn", "b"}
QTY_WORDS = set("people customers residents homes households families deaths dead killed injured missing cases patients students workers jobs "
                "employees evacuees acres buildings structures cars vehicles units tickets attendees followers members votes voters troops "
                "soldiers protesters officers arrests shelters outages complaints calls reports crews trucks flights schools businesses "
                "inches feet miles percent dollars hours days weeks months years minutes".split())
MONTHS = {m: i + 1 for i, m in enumerate("january february march april may june july august september october november december".split())}
MONTHS.update({m[:3]: i for m, i in list(MONTHS.items())})
MONTHS["sept"] = 9
WEEKDAYS = {d: i for i, d in enumerate("monday tuesday wednesday thursday friday saturday sunday".split())}
DATE_RX = re.compile(r"\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?"
                     r"|(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?"
                     r"|(next|last|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(tonight|tomorrow|yesterday)\b)", re.I)
PAST_HINT = re.compile(r"\b(was|were|happened|took place|yesterday|last|ago|had|did|\w{3,}ed)\b", re.I)


def _sentences(text):
    for s_ in SENT_SPLIT.split(str(text or "")):
        s_ = s_.strip()
        if 30 <= len(s_) <= 300 and not s_.lower().startswith(("http", "rt @")):
            yield s_


def _claim_key(s_):
    toks = [light_stem(w) for w in tokens(s_) if w not in STOP and len(w) > 2]
    return set(toks)


def claims(items, seed_words=(), top=10):
    """What is asserted, who said it first, how many repeat it, whether an outlet has printed it, whether anyone disputes it.
    "posts only" vs "an outlet confirms" is the tag that matters."""
    out = []
    for it in sorted((x for x in items if x.get("posted_at")), key=lambda x: x["posted_at"]):
        for s_ in _sentences(it.get("text")):
            if not ASSERT.search(s_) or not re.search(r"\d|\b[A-Z][a-z]+\b", s_):
                continue
            key = _claim_key(s_)
            if len(key) < 4:
                continue
            who = (it.get("author_name") or it.get("author")) if it.get("platform") in OUTLETS else it.get("author")
            hit = None
            for c in out:
                j = len(key & c["_key"]) / max(1, len(key | c["_key"]))
                if j >= 0.45 or (j >= 0.25 and DISPUTE.search(s_) and not DISPUTE.search(c["text"])):
                    hit = c
                    break
            if hit is None:
                out.append({"_key": key, "text": s_, "first": {"who": who, "platform": it.get("platform"), "posted_at": it["posted_at"], "url": it.get("url"), "id": it["id"]},
                            "accounts": {str(it.get("author") or "").lower()}, "n": 1, "outlets": set(), "disputed": [], "examples": [_ref(it)]})
                if it.get("platform") in OUTLETS:
                    out[-1]["outlets"].add(who or "")
            else:
                hit["n"] += 1
                hit["accounts"].add(str(it.get("author") or "").lower())
                if it.get("platform") in OUTLETS:
                    hit["outlets"].add(who or "")
                if DISPUTE.search(s_) and not DISPUTE.search(hit["text"]) and len(hit["disputed"]) < 3:
                    hit["disputed"].append(dict(_ref(it), who=who))
                if len(hit["examples"]) < 3:
                    hit["examples"].append(_ref(it))
    res = []
    for c in out:
        if len(c["accounts"]) < 2:
            continue
        status = "disputed" if c["disputed"] else "an outlet confirms" if c["outlets"] else "posts only"
        res.append({"text": c["text"], "first": c["first"], "n": c["n"], "accounts": len(c["accounts"]), "outlets": sorted(x for x in c["outlets"] if x),
                    "status": status, "disputed": c["disputed"], "examples": c["examples"]})
    res.sort(key=lambda c: (-(c["accounts"] + 2 * len(c["outlets"])), c["first"]["posted_at"]))
    return res[:top]


def _num(v, unit):
    v = float(str(v).replace(",", ""))
    u = (unit or "").lower()
    if u == "k" or u == "thousand":
        v *= 1e3
    elif u in ("m", "million"):
        v *= 1e6
    elif u in ("b", "bn", "billion"):
        v *= 1e9
    return v


def numbers(items, top=8):
    """Figures that move: the same quantity mentioned over time (people without power, a price, a death toll)."""
    series = defaultdict(list)
    for it in items:
        if not it.get("posted_at"):
            continue
        for m in NUM.finditer(str(it.get("text") or "")):
            cur, val, unit, what = m.group(1), m.group(2), m.group(3), (m.group(4) or "").lower()
            if what and what.split()[0] in NUM_SKIP:
                what = ""                                              # "8 mph with": the unit stands, the filler word goes
            if unit and unit.lower() in UNIT_WORDS and what not in QTY_WORDS:
                what = ""                                              # "110 mph recorded": the unit is the quantity, the verb is not
            if not unit and not cur and (not what or len(val) < 2):
                continue
            if re.match(r"^\d{4}$", val) and not unit and not cur:      # a year, not a quantity
                continue
            if unit and unit.lower() in ("k", "m", "b", "bn") and not what:
                continue
            if not cur and not (unit and unit.lower() in UNIT_WORDS) and what not in QTY_WORDS:
                continue                                               # "11 Boston", "02 unknown": a track number, not a figure
            key = (cur or "") + ((" " + unit.lower()) if unit and unit.lower() in ("%", "percent", "mph", "km/h", "inches", "feet", "ft", "miles", "acres", "degrees") else "") + (" " + what if what else "")
            # a speed or a length is of something: "winds of 110 mph" and "moving at 8 mph" are two figures, not one
            if unit and unit.lower() in SPEEDY:
                before = re.findall(r"[a-z]+", str(it.get("text") or "")[max(0, m.start() - 40):m.start()].lower())
                ctx_w = next((w for w in reversed(before[-5:]) if w in SPEED_CTX), "")
                key = ((ctx_w + " ") if ctx_w else "") + key
            key = re.sub(r"\s+", " ", key).strip()
            if not key or key in ("%", "percent"):
                continue
            series[key].append({"ts": it["posted_at"], "value": _num(val, unit), "raw": m.group(0).strip(), "post": _ref(it)})
    out = []
    for key, pts in series.items():
        pts.sort(key=lambda p_: p_["ts"])
        vals = {p_["value"] for p_ in pts}
        if len(pts) < 2 or (len(vals) < 2 and len(pts) < 3):
            continue
        out.append({"what": key, "n": len(pts), "first": pts[0]["value"], "last": pts[-1]["value"], "min": min(vals), "max": max(vals),
                    "moved": len(vals) > 1, "points": pts[-12:]})
    out.sort(key=lambda s_: (-(s_["moved"]), -s_["n"]))
    return out[:top]


def _resolve_date(m, ts):
    """A date written in a post → a timestamp, relative to when the post was made."""
    import datetime as dt
    base = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
    try:
        if m.group(1) or m.group(5):
            mon = MONTHS[(m.group(1) or m.group(5)).lower()[:3]]
            day = int(m.group(2) or m.group(4))
            year = int(m.group(3) or m.group(6) or base.year)
            d = dt.datetime(year, mon, day, tzinfo=dt.timezone.utc)
            if not (m.group(3) or m.group(6)):           # no year written: the nearest one
                if (d - base).days > 240:
                    d = d.replace(year=year - 1)
                elif (base - d).days > 240:
                    d = d.replace(year=year + 1)
            return int(d.timestamp()), "day"
        if m.group(8):
            wd = WEEKDAYS[m.group(8).lower()]
            delta = (wd - base.weekday()) % 7
            q = (m.group(7) or "").lower()
            if q == "last":
                delta = delta - 7 if delta else -7
            elif q == "next" and delta == 0:
                delta = 7
            d = base + dt.timedelta(days=delta)
            return int(d.replace(hour=0, minute=0, second=0).timestamp()), "weekday"
        w = (m.group(9) or "").lower()
        if w == "tonight":
            return int(base.replace(hour=0, minute=0, second=0).timestamp()), "day"
        if w == "tomorrow":
            return int((base + dt.timedelta(days=1)).replace(hour=0, minute=0, second=0).timestamp()), "day"
        if w == "yesterday":
            return int((base - dt.timedelta(days=1)).replace(hour=0, minute=0, second=0).timestamp()), "day"
    except (ValueError, KeyError):
        return None, None
    return None, None


def dated(items, top=12):
    """Dates written in the posts, not the posts' own dates: what happened when, and what is coming."""
    ev = []
    for it in items:
        if not it.get("posted_at"):
            continue
        for s_ in _sentences(it.get("text")):
            for m in DATE_RX.finditer(s_):
                when, kind = _resolve_date(m, it["posted_at"])
                if when is None:
                    continue
                if kind == "weekday" and not (m.group(7) or "").lower() and PAST_HINT.search(s_) and when > it["posted_at"]:
                    when -= 7 * DAY                        # "on Friday" in the past tense: the one just gone
                key = _claim_key(s_)
                hit = next((e for e in ev if abs(e["when"] - when) < DAY and len(key & e["_key"]) / max(1, len(key | e["_key"])) >= 0.4), None)
                if hit:
                    hit["n"] += 1
                    if len(hit["examples"]) < 3:
                        hit["examples"].append(_ref(it))
                else:
                    ev.append({"_key": key, "when": when, "text": s_, "date_text": m.group(0).strip(), "n": 1, "examples": [_ref(it)],
                               "who": (it.get("author_name") or it.get("author")) if it.get("platform") in OUTLETS else it.get("author"), "platform": it.get("platform")})
                break
    t = now()
    for e in ev:
        e.pop("_key")
        e["ahead"] = e["when"] > t
    ahead = sorted((e for e in ev if e["ahead"]), key=lambda e: (e["when"], -e["n"]))[:top]
    past = sorted((e for e in ev if not e["ahead"]), key=lambda e: (-e["n"], -e["when"]))[:top]
    past.sort(key=lambda e: e["when"])
    return {"ahead": ahead, "past": past}


YEAR_RX = re.compile(r"\b(20[0-3]\d)\b")


def stale_years(items):
    """Posts about an earlier thing with the same name: a year other than the current one, written in the text,
    carried by a tenth of the posts or more. Storm names repeat every six years; so do bands, bills and games."""
    import datetime as dt
    this_year = dt.datetime.now(dt.timezone.utc).year
    by_year = defaultdict(list)
    for it in items:
        ys = {int(y) for y in YEAR_RX.findall(str(it.get("text") or ""))}
        for y in ys:
            if y != this_year and y <= this_year:
                by_year[y].append(it)
    n = max(1, len(items))
    out = []
    for y, its in sorted(by_year.items(), key=lambda kv: -len(kv[1])):
        if len(its) >= 3 and len(its) / n >= 0.08:
            out.append({"year": y, "n": len(its), "share": round(len(its) / n, 2), "examples": [_ref(x) for x in its[:3]]})
    return out[:3]


def trust(items, tr, sp, sources=None, window_days=0, older=0, rated=None):
    """How much to lean on this read: posts, networks, sources that answered, days with nothing, what the window cut,
    and how much of it you actually rated (unrated membership is the model's guess)."""
    n = len(items)
    reasons, score = [], 0
    unrated = rated is not None and n >= 10 and rated < max(5, 0.05 * n)
    if unrated:
        reasons.append(f"only {rated} of {n} posts rated: what is in the topic is a guess")
    if n >= 60:
        score += 2
        reasons.append(f"{n} posts")
    elif n >= 20:
        score += 1
        reasons.append(f"{n} posts")
    else:
        score -= 1
        reasons.append(f"only {n} posts")
    plats = len(sp.get("platforms") or [])
    if plats >= 3:
        score += 1
        reasons.append(f"{plats} networks")
    elif plats <= 1:
        score -= 1
        reasons.append("one network only")
    srcs = sources or []
    failed = [s_ for s_ in srcs if not s_.get("enabled") and s_.get("auto_off")]
    if srcs and len(failed) >= max(1, len(srcs) // 2):
        score -= 1
        reasons.append(f"{len(failed)} of {len(srcs)} sources switched off after failing")
    elif failed:
        reasons.append(f"{len(failed)} source{'s' if len(failed) > 1 else ''} switched off: " + ", ".join(s_.get("name", "?") for s_ in failed[:2]))
    series = tr.get("series") or []
    if series:
        empty = sum(1 for d in series if not d["n"])
        if empty >= 0.8 * len(series) and tr.get("state") not in ("quiet",):
            score -= 1
            reasons.append(f"{empty} of the last {len(series)} days have no posts")
    if window_days and older:
        reasons.append(f"the {window_days}-day window left {older} older posts out")
    if sp.get("outlets"):
        score += 1
    label = "thin" if unrated else "solid" if score >= 3 else "fair" if score >= 1 else "thin"   # unverified membership caps the read at thin
    return {"label": label, "score": score, "reasons": reasons}
