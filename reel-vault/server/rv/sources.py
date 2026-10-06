"""Pluggable content sources.

A source is a row in the `sources` table:
  kind      how it is fetched (see ADAPTERS below)
  template  kind-specific: a URL with {q}/{tag}, a yt-dlp search key,
            a Mastodon instance, a subreddit, a feed URL …
  engine    for 'template'/'url': auto | gallery-dl | yt-dlp
Searchable sources take a query; the others are feeds that are simply
pulled and then scored against your topics.

Adding a new kind = write one function `fetch_<kind>(ctx, src, query, limit)`
that yields item dicts, and register it in ADAPTERS.
"""

import json
import re
import urllib.parse
import xml.etree.ElementTree as ET

from .util import (domain_of, fill_template, hashtag_form, http_get, http_json,
                   parse_date, short_hash, strip_html, to_float, to_int)

VIDEO_EXT = ("mp4", "webm", "mov", "m4v", "mkv", "m3u8", "gifv", "avi")
IMAGE_EXT = ("jpg", "jpeg", "png", "gif", "webp", "avif", "heic")
VIDEO_HOSTS = ("youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "x.com", "twitter.com",
               "twitch.tv", "dailymotion.com", "streamable.com", "v.redd.it", "rumble.com",
               "bilibili.com", "nicovideo.jp", "instagram.com", "facebook.com", "kick.com")
X_HOSTS = ("x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com",
           "fxtwitter.com", "vxtwitter.com", "fixupx.com")

# ─────────────────────────────────────────────────────────────────
#  Preset catalog (what the ADD SOURCE screen offers)
#  param: what the user must fill in → replaces {param} in template
# ─────────────────────────────────────────────────────────────────

PRESETS = [
    {"preset": "x", "name": "X / Twitter search", "kind": "x", "template": "", "searchable": True,
     "needs_login": True, "domains": ["x.com", "twitter.com"],
     "note": "Needs your X cookies (SETUP)."},
    {"preset": "youtube", "name": "YouTube search", "kind": "ytsearch", "template": "ytsearch",
     "searchable": True, "domains": ["youtube.com", "youtu.be"]},
    {"preset": "mastodon", "name": "Mastodon / Fediverse hashtag", "kind": "mastodon",
     "template": "mastodon.social", "searchable": True, "param": "instance",
     "param_default": "mastodon.social", "domains": ["mastodon.social"],
     "note": "Any Mastodon server. Bridged Bluesky posts show up here too."},
    {"preset": "reddit", "name": "Reddit search", "kind": "reddit", "template": "",
     "searchable": True, "domains": ["reddit.com"]},
    {"preset": "subreddit", "name": "Subreddit search", "kind": "reddit", "template": "r/{param}",
     "searchable": True, "param": "subreddit", "domains": []},
    {"preset": "bluesky", "name": "Bluesky search", "kind": "template", "engine": "gallery-dl",
     "template": "https://bsky.app/search?q={q}", "searchable": True, "domains": ["bsky.app"],
     "note": "May need a Bluesky login in gallery-dl's config."},
    {"preset": "tumblr", "name": "Tumblr tag", "kind": "template", "engine": "gallery-dl",
     "template": "https://www.tumblr.com/tagged/{tag}", "searchable": True, "domains": ["tumblr.com"]},
    {"preset": "instagram", "name": "Instagram hashtag", "kind": "template", "engine": "gallery-dl",
     "template": "https://www.instagram.com/explore/tags/{tag}/", "searchable": True,
     "needs_login": True, "domains": ["instagram.com"], "note": "Needs Instagram cookies."},
    {"preset": "pinterest", "name": "Pinterest search", "kind": "template", "engine": "gallery-dl",
     "template": "https://www.pinterest.com/search/pins/?q={q}", "searchable": True,
     "domains": ["pinterest.com"]},
    {"preset": "imgur", "name": "Imgur tag", "kind": "template", "engine": "gallery-dl",
     "template": "https://imgur.com/t/{tag}", "searchable": True, "domains": ["imgur.com"]},
    {"preset": "deviantart", "name": "DeviantArt search", "kind": "template", "engine": "gallery-dl",
     "template": "https://www.deviantart.com/search?q={q}", "searchable": True,
     "domains": ["deviantart.com"]},
    {"preset": "bilibili", "name": "Bilibili search", "kind": "ytsearch", "template": "bilisearch",
     "searchable": True, "domains": ["bilibili.com"]},
    {"preset": "niconico", "name": "NicoNico search", "kind": "ytsearch", "template": "nicosearch",
     "searchable": True, "domains": ["nicovideo.jp"]},
    {"preset": "x_user", "name": "X account (follow)", "kind": "url", "engine": "gallery-dl",
     "template": "https://x.com/{param}/media", "param": "handle", "needs_login": True, "domains": []},
    {"preset": "tiktok_user", "name": "TikTok account (follow)", "kind": "url", "engine": "auto",
     "template": "https://www.tiktok.com/@{param}", "param": "handle", "domains": ["tiktok.com"]},
    {"preset": "youtube_channel", "name": "YouTube channel (follow)", "kind": "url", "engine": "yt-dlp",
     "template": "https://www.youtube.com/@{param}/videos", "param": "handle", "domains": []},
    {"preset": "rss", "name": "RSS / Atom feed", "kind": "rss", "template": "{param}",
     "param": "feed URL", "domains": []},
    {"preset": "custom", "name": "Custom search URL", "kind": "template", "engine": "auto",
     "template": "{param}", "param": "URL with {q}", "searchable": True, "domains": []},
]
PRESET_BY_KEY = {p["preset"]: p for p in PRESETS}
DEFAULT_SOURCES = ["youtube", "mastodon", "x", "reddit"]


def is_searchable(src) -> bool:
    if src["kind"] in ("x", "ytsearch", "mastodon", "reddit"):
        return True
    if src["kind"] in ("template", "rss"):
        return any(t in (src.get("template") or "") for t in ("{q", "{tag}"))
    return False


# ─────────────────────────────────────────────────────────────────
#  Item mappers
# ─────────────────────────────────────────────────────────────────

def media_kind(url="", ext="", mtype=""):
    ext = (ext or urllib.parse.urlparse(url or "").path.rsplit(".", 1)[-1]).lower()
    mtype = (mtype or "").lower()
    if "photo" in mtype or "image" in mtype:
        return "image"
    if "video" in mtype or "gif" in mtype or ext in VIDEO_EXT or (url or "").startswith("ytdl:"):
        return "video"
    if "image" in mtype or "photo" in mtype or ext in IMAGE_EXT:
        return "image"
    return "post"


def item_from_x(url: str, kw: dict, source: str):
    """gallery-dl twitter kwdict (one media file) → item."""
    tid = str(kw.get("tweet_id") or "")
    if not tid:
        return None
    author = kw.get("author") or kw.get("user") or {}
    num = to_int(kw.get("num"), 1)
    handle = author.get("name") or "i"
    text_only = (url or "").startswith("text:") or not to_int(kw.get("count"), 1)
    mk = "post" if text_only else media_kind(url, kw.get("extension"), kw.get("type"))
    if text_only:
        url = ""
    return {
        "id": f"x:{tid}" + (f"_{num}" if num > 1 else ""),
        "platform": "x", "post_id": tid, "media": mk,
        "url": f"https://x.com/{handle}/status/{tid}",
        "media_url": None if (not url or url.startswith("ytdl:")) else url,
        "author": handle, "author_name": author.get("nick") or "",
        "author_url": f"https://x.com/{handle}",
        "text": kw.get("content") or "", "hashtags": " ".join(kw.get("hashtags") or []),
        "lang": kw.get("lang"), "posted_at": parse_date(kw.get("date")),
        "duration": to_float(kw.get("duration")),
        "width": to_int(kw.get("width")), "height": to_int(kw.get("height")),
        "likes": to_int(kw.get("favorite_count")), "reposts": to_int(kw.get("retweet_count")),
        "replies": to_int(kw.get("reply_count")), "views": to_int(kw.get("view_count")),
        "thumbnail": url if mk == "image" else None, "source": source,
    }


def _first(kw, *keys):
    for k in keys:
        v = kw.get(k)
        if v not in (None, "", [], {}):
            return v
    return None


def item_from_gdl(url: str, kw: dict, source: str):
    """Any gallery-dl site → item (field names differ per site)."""
    cat = (kw.get("category") or "web").lower()
    if cat == "twitter":
        return item_from_x(url, kw, source)
    pid = _first(kw, "id", "post_id", "tweet_id", "media_id", "pin_id", "index", "filename")
    if pid is None:
        return None
    num = to_int(kw.get("num"), 1)
    author = _first(kw, "author", "user", "owner", "account", "blog", "uploader", "username")
    if isinstance(author, dict):
        aname = _first(author, "name", "username", "handle", "acct", "nick") or ""
        anick = _first(author, "nick", "display_name", "displayName", "fullname", "full_name") or ""
        aurl = _first(author, "url", "profile_url") or ""
    else:
        aname, anick, aurl = str(author or ""), "", ""
    aname = str(aname).lstrip("@")
    text = _first(kw, "content", "description", "caption", "text", "title", "selftext", "body",
                  "summary") or ""
    if isinstance(text, (list, dict)):
        text = json.dumps(text)
    title = kw.get("title")
    if title and isinstance(title, str) and title not in text:
        text = f"{title}\n{text}"
    tags = _first(kw, "hashtags", "tags") or []
    if isinstance(tags, str):
        tags = tags.split()
    tags = [t.get("name") if isinstance(t, dict) else str(t) for t in tags]
    mk = media_kind(url, kw.get("extension"), kw.get("type") or kw.get("mime_type"))
    return {
        "id": f"{cat}:{pid}" + (f"_{num}" if num > 1 else ""),
        "platform": cat, "post_id": str(pid), "media": mk,
        "url": _first(kw, "post_url", "permalink", "webpage_url", "link") or url,
        "media_url": None if url.startswith("ytdl:") else url,
        "author": aname, "author_name": anick, "author_url": aurl,
        "text": strip_html(str(text)), "hashtags": " ".join(hashtag_form(t) for t in tags if t),
        "lang": kw.get("lang"), "posted_at": parse_date(_first(kw, "date", "created_at", "timestamp")),
        "duration": to_float(kw.get("duration")),
        "width": to_int(kw.get("width")), "height": to_int(kw.get("height")),
        "likes": to_int(_first(kw, "favorite_count", "like_count", "likes", "score",
                               "favourites_count", "note_count", "favorites")),
        "reposts": to_int(_first(kw, "retweet_count", "repost_count", "reblogs_count", "reblogs")),
        "replies": to_int(_first(kw, "reply_count", "comment_count", "num_comments", "replies_count")),
        "views": to_int(_first(kw, "view_count", "views", "play_count")),
        "thumbnail": url if mk == "image" else None, "source": source,
    }


def item_from_ytdlp(info: dict, source: str):
    if not info.get("id") or info.get("_type") in ("playlist", "multi_video"):
        return None
    plat = (info.get("ie_key") or info.get("extractor_key") or info.get("extractor") or "web").lower()
    plat = {"twitter": "x", "twitterbroadcast": "x"}.get(plat, plat.split(":")[0])
    title, desc = info.get("title") or "", info.get("description") or ""
    text = desc if title and desc.startswith(title[:40]) else "\n".join(x for x in (title, desc) if x)
    tags = list(info.get("tags") or []) + re.findall(r"#(\w+)", text)
    thumb = info.get("thumbnail")
    if not thumb and info.get("thumbnails"):
        thumb = info["thumbnails"][-1].get("url")
    url = info.get("webpage_url") or info.get("original_url")
    if not url and str(info.get("url", "")).startswith("http"):
        url = info["url"]
    return {
        "id": f"{plat}:{info['id']}", "platform": plat, "post_id": str(info["id"]), "media": "video",
        "url": url, "media_url": None,
        "author": (info.get("uploader_id") or info.get("channel_id") or info.get("uploader") or "").lstrip("@"),
        "author_name": info.get("uploader") or info.get("channel") or "",
        "author_url": info.get("uploader_url") or info.get("channel_url"),
        "text": text, "hashtags": " ".join(dict.fromkeys(hashtag_form(t) for t in tags if t)),
        "lang": info.get("language"),
        "posted_at": parse_date(info.get("timestamp") or info.get("release_timestamp")
                                or info.get("upload_date")),
        "duration": to_float(info.get("duration")),
        "width": to_int(info.get("width")), "height": to_int(info.get("height")),
        "likes": to_int(info.get("like_count")), "reposts": to_int(info.get("repost_count")),
        "replies": to_int(info.get("comment_count")), "views": to_int(info.get("view_count")),
        "thumbnail": thumb, "source": source,
    }


def items_from_mastodon(status: dict, instance: str, source: str, include_images=True, include_text=False):
    s = status.get("reblog") or status
    acc = s.get("account") or {}
    out = []
    medias = s.get("media_attachments") or []
    if not medias and include_text:                   # a plain post / reply: still something the account did
        return [{
            "id": f"mastodon:{s['id']}", "platform": "mastodon", "post_id": str(s["id"]), "media": "post",
            "url": s.get("url") or s.get("uri"), "media_url": None,
            "author": acc.get("acct") or "", "author_name": acc.get("display_name") or "",
            "author_url": acc.get("url"), "text": strip_html(s.get("content") or ""),
            "hashtags": " ".join(t.get("name", "") for t in s.get("tags") or []),
            "lang": s.get("language"), "posted_at": parse_date(s.get("created_at")),
            "duration": None, "width": None, "height": None,
            "likes": to_int(s.get("favourites_count")), "reposts": to_int(s.get("reblogs_count")),
            "replies": to_int(s.get("replies_count")), "views": 0, "thumbnail": None, "source": source,
        }]
    for n, m in enumerate(medias, 1):
        mk = {"video": "video", "gifv": "video", "image": "image"}.get(m.get("type"), "post")
        if mk == "image" and not include_images:
            continue
        meta = (m.get("meta") or {}).get("original") or {}
        out.append({
            "id": f"mastodon:{s['id']}" + (f"_{n}" if len(medias) > 1 else ""),
            "platform": "mastodon", "post_id": str(s["id"]), "media": mk,
            "url": s.get("url") or s.get("uri"),
            "media_url": m.get("url") or m.get("remote_url"),
            "author": acc.get("acct") or "", "author_name": acc.get("display_name") or "",
            "author_url": acc.get("url"),
            "text": strip_html(s.get("content") or "") + (
                f"\n{m['description']}" if m.get("description") else ""),
            "hashtags": " ".join(t.get("name", "") for t in s.get("tags") or []),
            "lang": s.get("language"), "posted_at": parse_date(s.get("created_at")),
            "duration": to_float(meta.get("duration")),
            "width": to_int(meta.get("width")), "height": to_int(meta.get("height")),
            "likes": to_int(s.get("favourites_count")), "reposts": to_int(s.get("reblogs_count")),
            "replies": to_int(s.get("replies_count")), "views": 0,
            "thumbnail": m.get("preview_url"), "source": source,
        })
    return out


def item_from_reddit(d: dict, source: str, include_images=True, include_text=False):
    if d.get("body") is not None and not d.get("title"):     # a comment
        if not include_text:
            return None
        link = "https://www.reddit.com" + (d.get("permalink") or "")
        return {"id": f"reddit:{d.get('id')}", "platform": "reddit", "post_id": d.get("id"), "media": "post",
                "url": link, "media_url": None, "author": d.get("author") or "",
                "author_name": "r/" + (d.get("subreddit") or ""), "author_url": f"https://www.reddit.com/user/{d.get('author')}",
                "text": "↩ " + (d.get("body") or ""), "hashtags": hashtag_form(d.get("subreddit") or ""), "lang": None,
                "posted_at": parse_date(d.get("created_utc")), "duration": None, "width": None, "height": None,
                "likes": to_int(d.get("score")), "reposts": 0, "replies": 0, "views": 0, "thumbnail": None, "source": source}
    hint = d.get("post_hint") or ""
    is_video = d.get("is_video") or hint in ("hosted:video", "rich:video") or \
        any(h in (d.get("domain") or "") for h in VIDEO_HOSTS)
    is_image = hint == "image" or media_kind(d.get("url", "")) == "image"
    if not is_video and not (is_image and include_images) and not include_text:
        return None
    rv = ((d.get("secure_media") or d.get("media") or {}) or {}).get("reddit_video") or {}
    prev = (((d.get("preview") or {}).get("images") or [{}])[0].get("source") or {}).get("url")
    link = "https://www.reddit.com" + d.get("permalink", "")
    return {
        "id": f"reddit:{d.get('id')}", "platform": "reddit", "post_id": d.get("id"),
        "media": "video" if is_video else "image" if is_image else "post",
        "url": link if (d.get("is_video") or not is_video) else d.get("url") or link,
        "media_url": None if (is_video or not is_image) else d.get("url"),
        "author": d.get("author") or "", "author_name": "r/" + (d.get("subreddit") or ""),
        "author_url": f"https://www.reddit.com/user/{d.get('author')}",
        "text": "\n".join(x for x in (d.get("title"), d.get("selftext")) if x),
        "hashtags": hashtag_form(d.get("subreddit") or ""), "lang": None,
        "posted_at": parse_date(d.get("created_utc")),
        "duration": to_float(rv.get("duration")),
        "width": to_int(rv.get("width")), "height": to_int(rv.get("height")),
        "likes": to_int(d.get("score")), "reposts": to_int(d.get("num_crossposts")),
        "replies": to_int(d.get("num_comments")), "views": 0,
        "thumbnail": (prev or "").replace("&amp;", "&") or None, "source": source,
    }


NS = {"atom": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/",
      "yt": "http://www.youtube.com/xml/schemas/2015", "dc": "http://purl.org/dc/elements/1.1/"}


def items_from_feed(xml_text: str, feed_url: str, source: str, all_entries=False):
    root = ET.fromstring(xml_text.encode("utf-8", "replace"))
    entries = root.findall(".//item") or root.findall(".//atom:entry", NS)
    out = []
    for e in entries:
        def t(*paths):
            for p in paths:
                el = e.find(p, NS)
                if el is not None and (el.text or "").strip():
                    return el.text.strip()
            return ""
        link = t("link")
        if not link:
            el = e.find("atom:link[@rel='alternate']", NS)
            if el is None:
                el = e.find("atom:link", NS)
            link = el.get("href") if el is not None else ""
        mcontent = e.find(".//media:content", NS)
        enc = e.find("enclosure")
        murl, mtype = "", ""
        for el in (mcontent, enc):
            if el is not None and el.get("url"):
                murl, mtype = el.get("url"), el.get("type") or el.get("medium") or ""
                break
        vid = t("yt:videoId")
        mk = "video" if vid else media_kind(murl, mtype=mtype) if murl else "post"
        if mk == "post" and any(h in domain_of(link) for h in VIDEO_HOSTS):
            mk = "video"
        if mk == "post" and not all_entries:
            continue
        thumb = e.find(".//media:thumbnail", NS)
        plat = "youtube" if vid else (domain_of(link).split(".")[-2] if "." in domain_of(link) else "rss")
        out.append({
            "id": f"youtube:{vid}" if vid else f"{plat}:{short_hash(link or murl)}",
            "platform": plat, "post_id": vid or short_hash(link or murl), "media": mk,
            "url": link or murl, "media_url": murl if mk == "video" and murl and not vid else None,
            "author": t("author/name", "atom:author/atom:name", "dc:creator", "author"),
            "author_name": t("atom:author/atom:name", "dc:creator"),
            "author_url": t("atom:author/atom:uri"),
            "text": "\n".join(x for x in (t("title", "atom:title"), strip_html(
                t("description", "atom:summary", "atom:content", "media:group/media:description")))
                if x),
            "hashtags": " ".join(hashtag_form(c.text or "") for c in e.findall("category") if c.text),
            "posted_at": parse_date(t("pubDate", "atom:published", "atom:updated", "dc:date")),
            "thumbnail": thumb.get("url") if thumb is not None else None, "source": source,
        })
    return out


# ─────────────────────────────────────────────────────────────────
#  Adapters. ctx gives: gdl(url, limit) / ytdlp(target, limit, flat)
#  generators of (url, kw) / info dicts, log(msg), opts.
# ─────────────────────────────────────────────────────────────────

def build_x_search(q: str, opt: dict) -> str:
    parts = [q.strip()]
    mode = opt.get("media", "video")
    if mode == "video":
        parts.append("filter:videos")
    elif mode != "everything":
        parts.append("filter:media")
    if to_int(opt.get("min_likes")):
        parts.append(f"min_faves:{to_int(opt['min_likes'])}")
    if opt.get("since"):
        parts.append(f"since:{opt['since']}")
    if opt.get("lang"):
        parts.append(f"lang:{opt['lang']}")
    if opt.get("exclude_replies", mode != "everything"):
        parts.append("-filter:replies")
    return " ".join(p for p in parts if p)


def fetch_x(ctx, src, query, limit):
    if query:
        tab = "top" if ctx.opts.get("search_tab") == "top" else "live"
        url = f"https://x.com/search?q={urllib.parse.quote(build_x_search(query, ctx.opts))}&f={tab}"
    else:
        url = src["template"]
    for murl, kw in ctx.gdl(url, limit):
        yield item_from_x(murl, kw, ctx.label)


def fetch_ytsearch(ctx, src, query, limit):
    key = (src.get("template") or "ytsearch").strip()
    for info in ctx.ytdlp(f"{key}{limit}:{query}", limit, flat=True):
        yield item_from_ytdlp(info, ctx.label)


def _engine_fetch(ctx, url, limit, engine):
    if engine == "auto":
        if ctx.gdl_supports(url):
            engine = "gallery-dl"
        elif ctx.ytdlp_supports(url):
            engine = "yt-dlp"
        else:
            engine = "html"                              # no downloader knows this site: read the page itself
    if engine == "html":
        yield from fetch_html_page(ctx, url, limit)
        return
    if engine == "gallery-dl":
        for murl, kw in ctx.gdl(url, limit):
            yield item_from_gdl(murl, kw, ctx.label)
    else:
        for info in ctx.ytdlp(url, limit, flat=False):
            yield item_from_ytdlp(info, ctx.label)


_HTML_SKIP = re.compile(r"(login|signup|register|privacy|terms|cookie|about|contact|/tag/|/page/\d|javascript:|mailto:)", re.I)
_LD_KINDS = {"VideoObject": "video", "ImageObject": "image", "Article": "post", "NewsArticle": "post",
             "BlogPosting": "post", "SocialMediaPosting": "post", "DiscussionForumPosting": "post", "Product": "post"}


def _web_item(ctx, dom, link, media, text, **kw):
    it = {"id": f"web:{dom}:{abs(hash(link))}", "platform": dom, "post_id": link, "media": media, "url": link,
          "media_url": None, "author": dom, "author_name": "", "author_url": "", "text": text or "", "hashtags": "",
          "lang": None, "posted_at": None, "duration": None, "width": None, "height": None, "likes": 0, "reposts": 0,
          "replies": 0, "views": 0, "thumbnail": None, "source": ctx.label}
    it.update(kw)
    return it


def fetch_html_page(ctx, url, limit):
    """Any site whose search-results page we can read: JSON-LD entries first (best), then result links
    with their text, then plain media on the page. Best effort — it is a page, not an API."""
    body, _, final = http_get(url, timeout=20, max_bytes=3_000_000)
    base = final or url
    dom = domain_of(base)
    seen, out = set(), []

    def push(it):
        if it["url"] and it["url"] not in seen and len(out) < limit * 2:
            seen.add(it["url"])
            out.append(it)

    for m in re.finditer(r"<script[^>]+ld\+json[^>]*>(.*?)</script>", body, re.S | re.I):
        try:
            data = json.loads(m.group(1))
        except ValueError:
            continue
        stack = list(data) if isinstance(data, list) else [data]
        while stack:
            n = stack.pop()
            if not isinstance(n, dict):
                continue
            for k in ("itemListElement", "@graph", "mainEntity", "hasPart", "item"):
                v = n.get(k)
                if isinstance(v, list):
                    stack.extend(v)
                elif isinstance(v, dict):
                    stack.append(v)
            t = n.get("@type")
            t = t[0] if isinstance(t, list) and t else t
            if t not in _LD_KINDS:
                continue
            mep = n.get("mainEntityOfPage")
            link = n.get("url") or (mep.get("@id") if isinstance(mep, dict) else mep)
            if not isinstance(link, str) or not link:
                continue
            link = urllib.parse.urljoin(base, link)
            au = n.get("author")
            au = au[0] if isinstance(au, list) and au else au
            thumb = n.get("thumbnailUrl") or n.get("image")
            thumb = thumb[0] if isinstance(thumb, list) and thumb else thumb
            thumb = thumb.get("url") if isinstance(thumb, dict) else thumb
            push(_web_item(ctx, dom, link, _LD_KINDS[t],
                           "\n".join(x for x in (n.get("name") or n.get("headline"), n.get("description")) if isinstance(x, str)),
                           media_url=n.get("contentUrl") if _LD_KINDS[t] != "post" else None,
                           author=(au.get("name") if isinstance(au, dict) else au if isinstance(au, str) else "") or dom,
                           author_url=(au.get("url") if isinstance(au, dict) else "") or "",
                           posted_at=parse_date(n.get("datePublished") or n.get("uploadDate")),
                           thumbnail=thumb if isinstance(thumb, str) else None))
    if len(out) < limit:
        for m in re.finditer(r"<a\s[^>]*href=[\"']([^\"'#]+)[\"'][^>]*>(.*?)</a>", body, re.S | re.I):
            href, inner = m.group(1), m.group(2)
            text = strip_html(inner).strip()
            if len(text) < 12 or _HTML_SKIP.search(href):
                continue
            link = urllib.parse.urljoin(base, href)
            if not link.startswith("http") or link.rstrip("/") == base.rstrip("/"):
                continue
            img = re.search(r"<img[^>]+src=[\"']([^\"']+)", inner, re.I)
            push(_web_item(ctx, dom, link, "post", text[:400], author_url=base,
                           thumbnail=urllib.parse.urljoin(base, img.group(1)) if img else None))
    if len(out) < limit:
        for m in re.finditer(r"<(?:video|source)[^>]+src=[\"']([^\"']+\.(?:mp4|webm|m3u8)[^\"']*)", body, re.I):
            link = urllib.parse.urljoin(base, m.group(1))
            push(_web_item(ctx, dom, base + "#" + str(abs(hash(link))), "video", "", media_url=link, author_url=base))
    ctx.log(f"  page read: {len(out)} entries from {dom}")
    for it in out[:limit]:
        yield it


def fetch_template(ctx, src, query, limit):
    yield from _engine_fetch(ctx, fill_template(src["template"], query or ""), limit,
                             src.get("engine") or "auto")


def fetch_url(ctx, src, query, limit):
    yield from _engine_fetch(ctx, src["template"], limit, src.get("engine") or "auto")


def fetch_mastodon(ctx, src, query, limit):
    instance = domain_of(src.get("template") or "mastodon.social") or "mastodon.social"
    mode = ctx.opts.get("media") or "video"
    images, text = mode in ("all", "everything"), mode == "everything"
    words = [w for w in re.split(r"\s+", (query or "").replace("#", " ")) if w]
    tags = list(dict.fromkeys([hashtag_form("".join(words))] + [hashtag_form(w) for w in words]))
    got = 0
    for tag in [t for t in tags if t][:4]:
        max_id = None
        while got < limit:
            url = (f"https://{instance}/api/v1/timelines/tag/{urllib.parse.quote(tag)}"
                   f"?limit=40&only_media={'false' if text else 'true'}" + (f"&max_id={max_id}" if max_id else ""))
            try:
                page = http_json(url, timeout=20)
            except Exception as e:      # noqa: BLE001 — network errors are reported, not fatal
                ctx.log(f"  mastodon #{tag}: {e}")
                break
            if not page:
                break
            for st in page:
                for it in items_from_mastodon(st, instance, ctx.label, images, text):
                    got += 1
                    yield it
            max_id = page[-1]["id"]
            if len(page) < 40:
                break


def fetch_reddit(ctx, src, query, limit):
    sub = (src.get("template") or "").strip().strip("/")
    sub = sub[2:] if sub.startswith("r/") else sub
    base = f"https://www.reddit.com/r/{sub}/search.json" if sub else "https://www.reddit.com/search.json"
    images = ctx.opts.get("media") in ("all", "everything")
    text = ctx.opts.get("media") == "everything"
    after, got = None, 0
    while got < limit:
        url = (f"{base}?q={urllib.parse.quote(query or '')}&limit=100&sort=relevance&type=link"
               + ("&restrict_sr=1" if sub else "") + (f"&after={after}" if after else ""))
        try:
            data = http_json(url, timeout=20)
        except Exception as e:          # noqa: BLE001
            ctx.log(f"  reddit: {e} (reddit often blocks servers/VPNs; works from home internet)")
            return
        children = (data.get("data") or {}).get("children") or []
        for c in children:
            it = item_from_reddit(c.get("data") or {}, ctx.label, images, text)
            if it:
                got += 1
                yield it
        after = (data.get("data") or {}).get("after")
        if not after or not children:
            return


def fetch_rss(ctx, src, query, limit):
    url = fill_template(src["template"], query or "")
    body, _, _ = http_get(url, timeout=20)
    for it in items_from_feed(body, url, ctx.label, ctx.opts.get("media") in ("all", "everything"))[:limit]:
        yield it


ADAPTERS = {
    "x": fetch_x, "ytsearch": fetch_ytsearch, "template": fetch_template, "url": fetch_url,
    "mastodon": fetch_mastodon, "reddit": fetch_reddit, "rss": fetch_rss,
}


def source_from_preset(key, param=""):
    p = PRESET_BY_KEY[key]
    tpl = p["template"].replace("{param}", (param or p.get("param_default") or "").strip().lstrip("@"))
    name = p["name"] + (f" · {param.strip()}" if param and p.get("param") else "")
    return {"name": name, "kind": p["kind"], "template": tpl, "engine": p.get("engine", "auto"),
            "needs_login": 1 if p.get("needs_login") else 0, "preset": key}


# ─────────────────────────────────────────────────────────────────
#  Detect how to search an arbitrary domain / URL the user types
# ─────────────────────────────────────────────────────────────────

SEARCH_PATTERNS = ["/search?q={q}", "/search/{q}", "/search?query={q}", "/search?search_query={q}",
                   "/tag/{tag}", "/tags/{tag}", "/tagged/{tag}", "/hashtag/{tag}",
                   "/explore/tags/{tag}/", "/?s={q}"]


_Q_PARAMS = ("q", "s", "search", "query", "term", "keyword", "keywords", "k", "text", "search_query", "wd", "p")


def search_url_to_template(url: str):
    """'https://site/search?q=cats' → 'https://site/search?q={q}'. Accepts the usual query parameter
    names (even empty: '?q='), or a last path segment after /search/ … /tag/."""
    try:
        u = urllib.parse.urlparse(url)
    except ValueError:
        return None
    qs = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
    for i, (k, v) in enumerate(qs):
        if k.lower() in _Q_PARAMS:
            qs[i] = (k, "{q}")
            return urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(qs, safe="{}")))
    m = re.match(r"^(.*/(?:search|s|tag|tags|find|results|hashtag)/)([^/]+)/?$", u.path)
    if m:
        return urllib.parse.urlunparse(u._replace(path=m.group(1) + "{q}"))
    return None


def probe(text: str, gdl_supports=None, ytdlp_supports=None):
    """Return a list of candidate sources for a domain, URL, or feed."""
    text = (text or "").strip()
    if not text:
        return []
    url = text if re.match(r"^https?://", text) else "https://" + text
    dom = domain_of(url)
    path = urllib.parse.urlparse(url).path.strip("/")
    cands, seen = [], set()

    def add(c, why):
        key = (c["kind"], c["template"])
        if key not in seen:
            seen.add(key)
            c.setdefault("engine", "auto")
            c["why"] = why
            c["searchable"] = is_searchable(c)
            cands.append(c)

    for p in PRESETS:
        if any(dom == d or dom.endswith("." + d) for d in p.get("domains", [])):
            s = source_from_preset(p["preset"], dom if p.get("param") == "instance" else "")
            add(s, "built-in support")

    if "{q" in text or "{tag}" in text:
        add({"name": dom, "kind": "template", "template": url}, "your search URL")
    else:
        tpl = search_url_to_template(url)
        if tpl:
            add({"name": dom, "kind": "template", "template": tpl, "engine": "auto"},
                "your search URL — the word you typed becomes {q}")

    body, ctype = "", ""
    try:
        body, ctype, _ = http_get(url, timeout=10, max_bytes=1_500_000)
    except Exception:            # noqa: BLE001 — unreachable sites still get pattern guesses
        pass

    if body and ("xml" in ctype or body.lstrip().startswith("<?xml")) and \
            ("<rss" in body[:2000] or "<feed" in body[:2000]):
        add({"name": f"{dom} feed", "kind": "rss", "template": url}, "this is a feed")

    if body:
        # Mastodon / fediverse server?
        if re.search(r"mastodon|fediverse|activitypub", body[:20000], re.I):
            try:
                inst = http_json(f"https://{dom}/api/v1/instance", timeout=8)
                if inst.get("uri") or inst.get("domain"):
                    add(source_from_preset("mastodon", dom), "Mastodon server")
            except Exception:    # noqa: BLE001
                pass
        # OpenSearch description → the site's own search URL
        for m in re.finditer(r"<link[^>]+>", body, re.I):
            tag = m.group(0)
            if "opensearchdescription" in tag.lower():
                href = re.search(r'href=["\']([^"\']+)', tag)
                if href:
                    try:
                        osd, _, _ = http_get(urllib.parse.urljoin(url, href.group(1)), timeout=8)
                        for um in re.finditer(r'<Url[^>]+template=["\']([^"\']+)["\'][^>]*>', osd):
                            if "html" in um.group(0).lower() or "type" not in um.group(0).lower():
                                tpl = re.sub(r"\{searchTerms\}", "{q}", um.group(1).replace("&amp;", "&"))
                                tpl = re.sub(r"[&?][\w.]+=\{[\w:]+\?\}", "", tpl)
                                add({"name": f"{dom} search", "kind": "template", "template": tpl},
                                    "site's OpenSearch")
                    except Exception:    # noqa: BLE001
                        pass
            if re.search(r'type=["\']application/(rss|atom)\+xml', tag, re.I):
                href = re.search(r'href=["\']([^"\']+)', tag)
                title = re.search(r'title=["\']([^"\']+)', tag)
                if href:
                    add({"name": (title.group(1) if title else f"{dom} feed")[:60], "kind": "rss",
                         "template": urllib.parse.urljoin(url, href.group(1))}, "feed found on page")

    # Which search URL shapes do the downloaders understand for this site?
    base = f"https://{'www.' if text.startswith('www.') else ''}{dom}"
    if gdl_supports:
        for pat in SEARCH_PATTERNS:
            test = fill_template(base + pat, "test")
            if gdl_supports(test):
                add({"name": f"{dom} {'tag' if '{tag}' in pat else 'search'}", "kind": "template",
                     "engine": "gallery-dl", "template": base + pat}, "gallery-dl understands it")
    if path and (gdl_supports and gdl_supports(url) or ytdlp_supports and ytdlp_supports(url)):
        add({"name": f"{dom}/{path}"[:60], "kind": "url", "template": url}, "follow this page")
    if not cands:
        add({"name": f"{dom} search", "kind": "template", "template": base + "/search?q={q}"},
            "guess — test it before relying on it")
        if ytdlp_supports and ytdlp_supports(url):
            add({"name": dom, "kind": "url", "engine": "yt-dlp", "template": url}, "yt-dlp page")
    return cands
