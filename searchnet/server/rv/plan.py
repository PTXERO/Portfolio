"""What a topic is about, and which sources fit it.

kind_of(seeds) reads the words you typed: a @handle, a person's name, an event, a place, something
technical, or a general subject. plan_for(kind) says which built-in sources to search and why. Nothing
here is final: you can tick sources by hand (then the plan stops touching them), and after a few runs a
source that never finds anything, or whose finds you keep rejecting, is dropped from the topic.
"""
import re

EVENT_WORDS = {"hurricane", "storm", "tornado", "earthquake", "flood", "wildfire", "fire", "shooting", "election",
               "protest", "riot", "crash", "war", "strike", "outbreak", "verdict", "trial", "explosion", "arrest",
               "ceasefire", "attack", "evacuation", "blackout", "recall", "scandal", "lawsuit", "indictment", "summit"}
TECH_WORDS = {"api", "software", "linux", "python", "javascript", "typescript", "rust", "golang", "kernel", "gpu", "cpu",
              "llm", "ai", "model", "crypto", "bitcoin", "ethereum", "startup", "app", "github", "framework", "database",
              "sql", "server", "cloud", "docker", "kubernetes", "firmware", "chip", "semiconductor", "open-source", "opensource"}
PLACE_WORDS = {"county", "city", "town", "village", "parish", "borough", "district", "beach", "island", "valley", "harbor",
               "harbour", "bay", "lake", "river", "mountain", "park", "street", "avenue", "neighborhood", "neighbourhood"}
ORG_WORDS = {"university", "college", "school", "hospital", "church", "company", "inc", "llc", "corp", "corporation",
             "department", "police", "bank", "airport", "stadium", "museum", "hotel", "restaurant", "club", "band", "fc"}
STATES = {"alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
          "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
          "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "ohio",
          "oklahoma", "oregon", "pennsylvania", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "wisconsin",
          "wyoming", "york", "jersey", "carolina", "dakota", "hampshire", "mexico", "london", "paris", "berlin", "tokyo",
          "toronto", "sydney", "chicago", "houston", "miami", "tampa", "orlando", "atlanta", "boston", "seattle", "denver",
          "dallas", "austin", "phoenix", "detroit", "philadelphia", "nashville", "orleans", "angeles", "francisco", "vegas"}

WINDOW_DAYS = {"event": 14, "place": 90, "person": 0, "handle": 0, "tech": 0, "general": 0}   # 0 = everything


def window_days(settings, plan):
    """the topic's time window in days (0 = no limit): what you set, else what the kind implies"""
    w = str((settings or {}).get("window") or "auto")
    if w == "auto":
        return int((plan or {}).get("window_days") or 0)
    return 0 if w == "all" else max(0, int(w or 0))


PLANS = {
    # kind: (presets to search, one line why)
    "person":  (["news", "web", "obituaries", "schools", "archive", "blogs", "mastodon", "bluesky", "reddit", "youtube", "lemmy", "x"],
                "a name: papers, obituaries, school and local sites, social posts under the quoted name"),
    "event":   (["news", "gdelt", "web", "reddit", "mastodon", "bluesky", "youtube", "wikipedia", "fourchan", "blogs", "lemmy", "x"],
                "an event: news first, then what people posted about it"),
    "place":   (["news", "web", "reddit", "youtube", "mastodon", "bluesky", "schools", "wikipedia", "blogs", "lemmy", "x"],
                "a place: local news, local sites and schools, posts from there"),
    "tech":    (["hn", "web", "reddit", "youtube", "blogs", "wikipedia", "mastodon", "lemmy", "fourchan", "news", "bluesky", "x"],
                "technical: Hacker News, docs and blogs, forums, then news"),
    "general": (["mastodon", "lemmy", "reddit", "bluesky", "youtube", "news", "gdelt", "web", "blogs", "hn", "archive", "fourchan", "wikipedia", "x"],
                "a general subject: everything except obituaries and schools"),
}
NAME_RE = re.compile(r"^(?:(?:dr|mr|mrs|ms|prof|rev|sgt|lt|capt)\.?\s+)?[A-Z](?:[a-z'’.-]|['’][A-Z])+(?:\s+[A-Z](?:[a-z'’.-]|['’][A-Z])+){1,2}(?:\s+(?:jr|sr|ii|iii|iv)\.?)?$", re.I * 0)


def _words(s):
    return [w for w in re.split(r"[^a-z0-9#@'’.-]+", str(s or "").lower()) if w]


def looks_like_name(seed):
    """Two or three capitalised words with nothing that says event, place or organisation."""
    s = str(seed or "").strip().strip('"')
    if not NAME_RE.match(s):
        return False
    ws = {w.strip(".'’") for w in _words(s)}
    return not (ws & (EVENT_WORDS | PLACE_WORDS | ORG_WORDS | STATES | TECH_WORDS))


def kind_of(seeds, settings=None):
    """→ (kind, why). Explicit person settings win; then the words decide."""
    settings = settings or {}
    seeds = [s for s in (seeds or []) if s]
    if settings.get("person"):
        return ("handle" if (settings["person"] or {}).get("mode") == "account" else "person"), "you chose PERSON"
    first = (seeds[0] if seeds else "").strip()
    if first.startswith("@") or first.lower().startswith("from:"):
        return "handle", "an @account"
    ws = {w.strip(".'’") for s in seeds for w in _words(s)}
    if looks_like_name(first):
        return "person", f"'{first}' reads like a person's name"
    if ws & EVENT_WORDS:
        return "event", "words like " + ", ".join(sorted(ws & EVENT_WORDS)[:2])
    if ws & TECH_WORDS:
        return "tech", "words like " + ", ".join(sorted(ws & TECH_WORDS)[:2])
    if ws & (STATES | PLACE_WORDS):
        return "place", "names a place (" + ", ".join(sorted(ws & (STATES | PLACE_WORDS))[:2]) + ")"
    return "general", "no strong signal in the words"


def place_in(seeds):
    ws = [w.strip(".'’") for s in (seeds or []) for w in _words(s)]
    hit = [w for w in ws if w in STATES]
    return hit[0].title() if hit else ""


def plan_for(seeds, settings, sources):
    """→ {kind, why, presets, source_ids, dropped:{}, auto:True}. source_ids = enabled sources whose preset
    is in the plan, plus every source without a preset (ones you added yourself)."""
    kind, why = kind_of(seeds, settings)
    presets = PLANS.get(kind, PLANS["general"])[0] if kind != "handle" else []
    ids = []
    for s in sources:
        if not s.get("enabled") or not s.get("searchable", True):
            continue
        if (s.get("preset") in presets) or (not s.get("preset")):
            ids.append(s["id"])
    return {"kind": kind, "why": why, "presets": presets, "source_ids": ids, "dropped": {}, "auto": True, "window_days": WINDOW_DAYS.get(kind, 0),
            "note": PLANS.get(kind, PLANS["general"])[1] if kind != "handle" else "one account, one network"}


def prune(plan, stats, sources_by_id):
    """After a run: drop sources that keep finding nothing (3 runs, 0 found) or whose finds you reject
    (≥ 6 votes, ≥ 85 % 👎). Returns the ids to keep; records why each one went."""
    if not plan or not plan.get("auto"):
        return None
    keep, dropped = [], dict(plan.get("dropped") or {})
    for sid in plan.get("source_ids") or []:
        st = stats.get(sid) or {}
        runs, found, pos, neg = st.get("runs", 0), st.get("found", 0), st.get("pos", 0), st.get("neg", 0)
        name = (sources_by_id.get(sid) or {}).get("name", sid)
        if runs >= 3 and found == 0:
            dropped[sid] = f"{name}: nothing in {runs} runs"
        elif pos + neg >= 6 and neg >= 0.85 * (pos + neg):
            dropped[sid] = f"{name}: {neg} of {pos + neg} rated 👎"
        else:
            keep.append(sid)
    plan["dropped"] = dropped
    return keep
