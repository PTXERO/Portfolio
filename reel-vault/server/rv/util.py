"""Small shared helpers: parsing, tokenizing, HTTP."""

import hashlib
import html
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
APP_AGENT = "SearchNet/2.0 (personal video library)"


def now() -> int:
    return int(time.time())


def safe_name(s, maxlen: int = 80) -> str:
    s = re.sub(r"[^\w.-]+", "_", str(s or "unknown")).strip("._")
    return (s or "unknown")[:maxlen]


def short_hash(s: str, n=16) -> str:
    return hashlib.sha1(str(s).encode()).hexdigest()[:n]


def to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def to_float(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def parse_date(v):
    """gallery-dl: '2024-05-01 13:45:10'; yt-dlp: unix ts or 'YYYYMMDD';
    APIs/feeds: ISO 8601 or RFC 822. Returns unix timestamp or None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    if s.isdigit() and len(s) >= 9:
        return int(s)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%Y%m%d"):
        try:
            return int(datetime.strptime(s[:19], fmt)
                       .replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            pass
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return int(d.timestamp())
    except ValueError:
        pass
    try:
        from email.utils import parsedate_to_datetime
        return int(parsedate_to_datetime(s).timestamp())
    except (TypeError, ValueError, IndexError):
        return None


_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"<br\s*/?>|</p>\s*<p[^>]*>", "\n", s, flags=re.I)
    return html.unescape(_TAG_RE.sub("", s)).strip()


WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)


URL_RE = re.compile(r"(?:https?://|www\.)\S+|\b[\w-]+\.(?:com|net|org|ly|gg|tv|be|io|co)(?:/\S*)?", re.I)


def tokens(text: str):
    """Every word, lowercased. Nothing is dropped: common words simply end
    up with low weight through IDF and learning instead of a stopword list.
    Web addresses are skipped (they're links, not words)."""
    text = URL_RE.sub(" ", text or "")
    return [w.replace("’", "'") for w in WORD_RE.findall(text.lower())]


def light_stem(w: str) -> str:
    """Cheap normalizer for matching (crashes→crash, skating→skat)."""
    for suf in ("ingly", "edly", "ings", "ing", "ies", "ied", "es", "ed", "ly", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            return w[: -len(suf)] + ("y" if suf in ("ies", "ied") else "")
    return w


def hashtag_form(text: str) -> str:
    return re.sub(r"[^\w]+", "", (text or "").lower())


def http_get(url, timeout=15, headers=None, max_bytes=8_000_000, agent=USER_AGENT):
    req = urllib.request.Request(url, headers={"User-Agent": agent,
                                               "Accept-Language": "en;q=0.9,*;q=0.5",
                                               **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(max_bytes)
        ctype = r.headers.get("Content-Type", "")
        charset = r.headers.get_content_charset() or "utf-8"
        return data.decode(charset, errors="replace"), ctype, r.geturl()


def http_json(url, timeout=15, headers=None, agent=APP_AGENT):
    body, _, _ = http_get(url, timeout, {"Accept": "application/json", **(headers or {})},
                          agent=agent)
    return json.loads(body)


def fill_template(template: str, query: str) -> str:
    """{q}=url-encoded query, {q_raw}=as typed, {tag}=hashtag form,
    {q_plus}=spaces as '+', {q_dash}=spaces as '-'."""
    q = (query or "").strip()
    tag = hashtag_form(q.lstrip("#"))
    return (template.replace("{q}", urllib.parse.quote(q))
            .replace("{q_raw}", q)
            .replace("{q_plus}", urllib.parse.quote_plus(q))
            .replace("{q_dash}", urllib.parse.quote(re.sub(r"\s+", "-", q)))
            .replace("{tag}", urllib.parse.quote(tag)))


def domain_of(url: str) -> str:
    host = (urllib.parse.urlparse(url if "//" in url else "https://" + url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host
