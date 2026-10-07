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
import time
import urllib.parse
import xml.etree.ElementTree as ET

from .util import (APP_AGENT, domain_of, fill_template, hashtag_form, http_get, http_json,
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
    # the open web: articles are always kept (media setting does not apply)
    {"preset": "news", "name": "News (Google News)", "kind": "news", "template": "{param}", "searchable": True,
     "param": "extra terms (optional)", "domains": ["news.google.com"],
     "note": "Global, national and local papers, TV and wires. Add a place as extra terms for local news."},
    {"preset": "gdelt", "name": "News archive (GDELT)", "kind": "gdelt", "template": "{param}", "searchable": True,
     "param": "extra terms (optional)", "domains": ["gdeltproject.org"],
     "note": "World news index going back years. Phrases in quotes."},
    {"preset": "web", "name": "Websites & blogs (Bing)", "kind": "web", "template": "{param}", "searchable": True,
     "param": "extra terms (optional)", "domains": ["bing.com"],
     "note": "Anything indexed: blogs, forums, company and school sites."},
    {"preset": "obituaries", "name": "Obituaries", "kind": "web", "template": "obituary OR obituaries OR \"passed away\"",
     "searchable": True, "domains": [], "note": "Web search with obituary terms added to every query."},
    {"preset": "schools", "name": "Schools & universities", "kind": "web", "template": "site:.edu OR site:.k12.*.us OR school",
     "searchable": True, "domains": [], "note": "Web search limited to school and university sites."},
    {"preset": "blogs", "name": "Blogs", "kind": "web", "template": "blog OR site:substack.com OR site:medium.com OR site:wordpress.com OR site:blogspot.com",
     "searchable": True, "domains": [], "note": "Web search steered at blogs and newsletters."},
    {"preset": "hn", "name": "Hacker News", "kind": "hn", "template": "", "searchable": True, "domains": ["news.ycombinator.com"]},
    {"preset": "fourchan", "name": "4chan", "kind": "fourchan", "template": "{param}", "param": "boards",
     "param_default": "pol,news,b,g,x,tv,v,biz,int,k", "searchable": True, "domains": ["4chan.org", "4channel.org", "desuarchive.org"],
     "note": "desuarchive full-text search plus the live catalogs of these boards."},
    {"preset": "wikipedia", "name": "Wikipedia", "kind": "wikipedia", "template": "", "searchable": True, "domains": ["wikipedia.org"]},
    {"preset": "archive", "name": "Internet Archive", "kind": "archive", "template": "", "searchable": True, "domains": ["archive.org"],
     "note": "Books, newspapers, recordings, old sites."},
    {"preset": "custom", "name": "Custom search URL", "kind": "template", "engine": "auto",
     "template": "{param}", "param": "URL with {q}", "searchable": True, "domains": []},
]
PRESET_BY_KEY = {p["preset"]: p for p in PRESETS}
DEFAULT_SOURCES = ["youtube", "mastodon", "x", "reddit", "bluesky", "news", "gdelt", "web", "obituaries", "schools",
                   "blogs", "hn", "archive", "fourchan", "wikipedia"]


def is_searchable(src) -> bool:
    if src["kind"] in ("x", "ytsearch", "mastodon", "reddit", "news", "gdelt", "web", "hn", "archive", "fourchan", "wikipedia"):
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
            "author": t("author/name", "atom:author/atom:name", "dc:creator", "author", "source"),
            "author_name": t("atom:author/atom:name", "dc:creator", "source"),
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


def _since(ctx):
    """unix time the topic wants results after (0 = no limit)"""
    return to_int((ctx.opts or {}).get("since")) if getattr(ctx, "opts", None) else 0


def _days(ctx):
    s = _since(ctx)
    return max(1, int((time.time() - s) / 86400) + 1) if s else 0


def _extra(src, query):
    """presets like Obituaries carry extra terms in their template; a user's param lands there too"""
    extra = (src.get("template") or "").strip()
    if extra.startswith("http") or "{" in extra:
        extra = ""
    return " ".join(x for x in (query or "", extra) if x).strip()


def _article(ctx, link, text, author="", posted_at=None, prefix="web", **kw):
    dom = domain_of(link)
    it = _web_item(ctx, dom, link, "post", text, posted_at=posted_at, author=author or dom)
    it["id"] = f"{prefix}:{short_hash(canon_url(link))}"
    it["url"] = "https://" + canon_url(link)
    it["platform"] = kw.pop("platform", prefix)
    it.update(kw)
    return it


def fetch_news(ctx, src, query, limit):
    """Google News RSS: global, national and local outlets."""
    region = (ctx.opts.get("region") or "US").upper()[:2]
    q_ = _extra(src, query)
    if _days(ctx):
        q_ += f" when:{_days(ctx)}d" if _days(ctx) <= 30 else " after:" + time.strftime("%Y-%m-%d", time.gmtime(_since(ctx)))
    url = (f"https://news.google.com/rss/search?q={urllib.parse.quote(q_)}"
           f"&hl=en-{region}&gl={region}&ceid={region}:en")
    try:
        body, _, _ = http_get(url, timeout=20)
    except Exception:       # noqa: BLE001 — Google refuses some addresses; Bing News carries the same wires and papers
        url = f"https://www.bing.com/news/search?q={urllib.parse.quote(q_)}&format=rss&count={min(limit, 100)}"
        body, _, _ = http_get(url, timeout=20)
    for e in items_from_feed(body, url, ctx.label, True)[:limit]:
        text, who = e["text"], e.get("author") or domain_of(e["url"])
        if who and text.lower().startswith(text.split("\n")[0].lower()) and text.split("\n")[0].lower().endswith(" - " + who.lower()):
            text = text[:len(text.split("\n")[0]) - len(who) - 3] + text[len(text.split("\n")[0]):]     # "Headline - Outlet" → "Headline"
        yield _article(ctx, e["url"], text, author=who, posted_at=e.get("posted_at"), prefix="news", platform="news")


def fetch_gdelt(ctx, src, query, limit):
    """GDELT DOC 2.0: world news articles, searchable back years."""
    q = _extra(src, query)
    d = http_json(f"https://api.gdeltproject.org/api/v2/doc/doc?query={urllib.parse.quote(q)}"
                  f"&mode=ArtList&maxrecords={min(limit, 250)}&format=json&sort=DateDesc&startdatetime="
                  + (time.strftime("%Y%m%d%H%M%S", time.gmtime(_since(ctx))) if _since(ctx) else "20170101000000"), timeout=25)
    for a in (d.get("articles") or [])[:limit]:
        ts = None
        m = re.match(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z", a.get("seendate") or "")
        if m:
            ts = parse_date("%s-%s-%sT%s:%s:%sZ" % m.groups())
        yield _article(ctx, a["url"], a.get("title") or "", author=a.get("domain") or "", posted_at=ts,
                       prefix="news", platform="news", lang=a.get("language"), thumbnail=a.get("socialimage"))


def fetch_web(ctx, src, query, limit):
    """The open web through Bing's RSS output: blogs, forums, school and company sites, obituaries."""
    seen, got, first = set(), 0, 1
    while got < limit and first <= 151:          # pages of 50, up to 4 pages
        url = f"https://www.bing.com/search?format=rss&q={urllib.parse.quote(_extra(src, query))}&count=50&first={first}"
        body, _, _ = http_get(url, timeout=20)
        page, fresh = items_from_feed(body, url, ctx.label, True), 0
        for e in page:
            k = canon_url(e["url"])
            if k in seen:
                continue
            seen.add(k)
            fresh += 1
            yield _article(ctx, e["url"], e["text"], posted_at=e.get("posted_at"), prefix="web", platform="web")
            got += 1
            if got >= limit:
                break
        if not fresh or len(page) < 10:
            break
        first += 50


def fetch_hn(ctx, src, query, limit):
    d = http_json(f"https://hn.algolia.com/api/v1/search?query={urllib.parse.quote(_extra(src, query))}"
                  f"&tags=story&hitsPerPage={min(limit, 100)}" + (f"&numericFilters=created_at_i>{_since(ctx)}" if _since(ctx) else ""), timeout=20)
    for h in (d.get("hits") or [])[:limit]:
        link = h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}"
        it = _article(ctx, link, h.get("title") or "", author=h.get("author") or "", posted_at=h.get("created_at_i"),
                      prefix="hn", platform="hackernews", likes=h.get("points") or 0, replies=h.get("num_comments") or 0)
        it["id"] = f"hn:{h.get('objectID')}"
        yield it


def fetch_archive(ctx, src, query, limit):
    d = http_json("https://archive.org/advancedsearch.php?q=" + urllib.parse.quote(_extra(src, query))
                  + "&fl[]=identifier&fl[]=title&fl[]=description&fl[]=date&fl[]=mediatype&fl[]=creator"
                  + f"&rows={min(limit, 100)}&output=json", timeout=25)
    for x in ((d.get("response") or {}).get("docs") or [])[:limit]:
        desc = x.get("description")
        desc = desc[0] if isinstance(desc, list) else (desc or "")
        creator = x.get("creator")
        creator = creator[0] if isinstance(creator, list) else (creator or "archive.org")
        it = _article(ctx, f"https://archive.org/details/{x['identifier']}",
                      "\n".join(s for s in (x.get("title"), desc) if s)[:1500], author=creator,
                      posted_at=parse_date(x.get("date")), prefix="archive", platform="archive",
                      hashtags="")
        it["id"] = f"archive:{x['identifier']}"
        yield it


def canon_url(u):
    """the same page reached by two links (utm tags, trailing slash, m. host) is one item"""
    try:
        p = urllib.parse.urlsplit(u)
        host = p.netloc.lower()
        host = re.sub(r"^(www|m|amp)\.", "", host)
        qs = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
              if not re.match(r"^(utm_|fbclid|gclid|mc_|ref$|ref_|igshid|si$|feature$)", k, re.I)]
        return host + (p.path.rstrip("/") or "/") + ("?" + urllib.parse.urlencode(qs) if qs else "")
    except Exception:       # noqa: BLE001
        return u or ""


def fetch_fourchan(ctx, src, query, limit):
    """desuarchive search (a, g, co, tv, …) + the live catalogs of the boards in the template."""
    out, words = 0, [w for w in (query or "").lower().split() if len(w) > 2]
    try:
        d = http_json(f"https://desuarchive.org/_/api/chan/search/?text={urllib.parse.quote(query or '')}&order=desc",
                      timeout=20, headers={"User-Agent": "Mozilla/5.0 " + APP_AGENT})
        for p in (d.get("0") or {}).get("posts") or []:
            board = (p.get("board") or {}).get("shortname") or ""
            media = p.get("media") or {}
            link = f"https://desuarchive.org/{board}/post/{p.get('num')}/"
            it = _web_item(ctx, "4chan", link, "video" if media_kind(media.get("media_link") or "") == "video" else "image" if media.get("media_link") else "post",
                           "\n".join(x for x in (p.get("title"), strip_html(p.get("comment_processed") or p.get("comment") or "")) if x),
                           author=p.get("name") or "Anonymous", posted_at=to_int(p.get("timestamp")) or None, hashtags=f"/{board}/",
                           media_url=media.get("media_link") if media_kind(media.get("media_link") or "") == "video" else None,
                           thumbnail=media.get("thumb_link"))
            it["id"], it["platform"] = f"4chan:{board}:{p.get('num')}", "4chan"
            yield it
            out += 1
            if out >= limit:
                return
    except Exception:       # noqa: BLE001 — archive down: live boards below
        pass
    boards = [b for b in re.split(r"[,\s]+", (src.get("template") or "") if "{" not in (src.get("template") or "") else "") if b][:12] \
        or ["pol", "news", "b", "g", "x", "tv", "v", "biz", "int", "k"]
    for b in boards:
        if out >= limit:
            return
        try:
            pages = http_json(f"https://a.4cdn.org/{b}/catalog.json", timeout=15)
        except Exception:   # noqa: BLE001
            continue
        for pg in pages:
            for t in pg.get("threads") or []:
                text = strip_html("\n".join(x for x in (t.get("sub"), t.get("com")) if x))
                low = text.lower()
                if words and not all(w in low for w in words):
                    continue
                ext = t.get("ext") or ""
                it = _web_item(ctx, "4chan", f"https://boards.4chan.org/{b}/thread/{t.get('no')}",
                               "video" if ext in (".webm", ".mp4") else "image" if ext else "post", text,
                               author=t.get("name") or "Anonymous", posted_at=t.get("time"), hashtags=f"/{b}/", replies=t.get("replies") or 0,
                               media_url=f"https://i.4cdn.org/{b}/{t.get('tim')}{ext}" if ext in (".webm", ".mp4") else None,
                               thumbnail=f"https://i.4cdn.org/{b}/{t.get('tim')}s.jpg" if t.get("tim") else None)
                it["id"], it["platform"] = f"4chan:{b}:{t.get('no')}", "4chan"
                yield it
                out += 1
                if out >= limit:
                    return


def fetch_wikipedia(ctx, src, query, limit):
    lang = re.sub(r"[^a-z-]", "", (ctx.opts.get("lang") or "en").lower()) or "en"
    d = http_json(f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(_extra(src, query))}"
                  f"&format=json&srlimit={min(limit, 50)}&srprop=snippet|timestamp|wordcount", timeout=20,
                  headers={"Api-User-Agent": APP_AGENT})
    for s in ((d.get("query") or {}).get("search") or [])[:limit]:
        link = f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(s['title'].replace(' ', '_'))}"
        it = _web_item(ctx, f"{lang}.wikipedia.org", link, "post", s["title"] + "\n" + strip_html(s.get("snippet") or ""),
                       author=f"{lang}.wikipedia.org", posted_at=parse_date(s.get("timestamp")), views=s.get("wordcount") or 0)
        it["id"], it["platform"] = f"wikipedia:{lang}:{s['pageid']}", "wikipedia"
        yield it


ARTICLE_KINDS = {"news", "gdelt", "web", "hn", "archive", "fourchan", "wikipedia"}

ADAPTERS = {
    "x": fetch_x, "ytsearch": fetch_ytsearch, "template": fetch_template, "url": fetch_url,
    "mastodon": fetch_mastodon, "reddit": fetch_reddit, "rss": fetch_rss,
    "news": fetch_news, "gdelt": fetch_gdelt, "web": fetch_web, "hn": fetch_hn, "archive": fetch_archive,
    "fourchan": fetch_fourchan, "wikipedia": fetch_wikipedia,
}

_NOT_A_NAME = re.compile(r"(staff|report|editor|desk|news|press|associated|reuters|bureau|team|contributor|correspondent|"
                         r"service|wire|agency|media|network|http|www\.|@|\d|"
                         r"\b(herald|times|post|tribune|gazette|journal|daily|sun|star|chronicle|observer|courier|dispatch|"
                         r"register|sentinel|ledger|review|today|weekly|globe|examiner|mirror|telegraph|guardian|independent|"
                         r"standard|record|inquirer|bulletin|cbs|nbc|abc|fox|cnn|bbc|npr|tv|radio|fm|com|org)\b)", re.I)


def parse_byline(raw) -> list:
    """'By Ana Ceballos and Mary Ellen Klas, Miami Herald' → ['Ana Ceballos', 'Mary Ellen Klas'].
    A list of names (JSON-LD) is taken as is. Desks, wires and outlets are not writers."""
    if isinstance(raw, list):
        out = []
        for x in raw:
            out += parse_byline(x if isinstance(x, str) else (x or {}).get("name") if isinstance(x, dict) else "")
        return list(dict.fromkeys(out))[:4]
    s = strip_html(str(raw or "")).strip()
    s = re.sub(r"^\s*(by|from|written by|story by|reporting by)\b[:\s]*", "", s, flags=re.I)
    s = re.sub(r"\s*[|•·]\s*.*$", "", s)                       # 'Name | Outlet'
    out = []
    for part in re.split(r"\s*(?:,|;|&| and | with )\s*", s):
        part = re.sub(r"\s+", " ", part).strip(" .")
        words = part.split(" ")
        if not (2 <= len(words) <= 4) or _NOT_A_NAME.search(part):
            continue
        if not all(re.match(r"^[A-Za-zÀ-ÿ'’.-]+$", w) for w in words) or not any(w[:1].isupper() for w in words):
            continue
        if part.isupper():
            part = part.title()
        out.append(part)
    return list(dict.fromkeys(out))[:4]


_DATELINE = re.compile(r"^\s*([A-Z][A-Z .'’-]{2,28}?)(?:,\s*([A-Z][A-Za-z.]{1,14}))?\s*(?:\([A-Z]{2,8}\))?\s*(?:—|–|--|-)\s+(?=[A-Z\"“])")


def parse_dateline(text) -> str:
    """'NAPLES, Fla. — Residents…' → 'Naples, Fla.' (where the story was filed from). Only the classic
    all-caps dateline counts; a sentence that happens to start with a capitalised word does not."""
    for line in str(text or "").split("\n")[:3]:
        m = _DATELINE.match(line.strip())
        if m:
            city = m.group(1).strip()
            if not (2 <= len(city.split()) <= 3 or len(city) >= 4):
                continue
            return (city.title() + (", " + m.group(2) if m.group(2) else ""))[:40]
    return ""


_END = r"/?(?=[\"'?#\s<]|$)"
_SOCIAL = [("x", r"https?://(?:www\.)?(?:twitter|x)\.com/([A-Za-z0-9_]{2,15})" + _END),
           ("bluesky", r"https?://bsky\.app/profile/([A-Za-z0-9.-]+?)" + _END),
           ("mastodon", r"https?://([a-z0-9.-]+)/@([A-Za-z0-9_]+)" + _END),
           ("instagram", r"https?://(?:www\.)?instagram\.com/([A-Za-z0-9_.]{2,30})" + _END),
           ("threads", r"https?://(?:www\.)?threads\.net/@([A-Za-z0-9_.]{2,30})" + _END),
           ("youtube", r"https?://(?:www\.)?youtube\.com/@([A-Za-z0-9_.-]{2,40})" + _END)]
_SOCIAL_SKIP = {"share", "intent", "home", "login", "search", "hashtag", "i", "explore", "privacy", "settings"}


def read_author_page(url: str):
    """An outlet's own page for one of its writers: the social handles it lists and the short bio it prints.
    Only what the outlet publishes about the byline; nothing is looked up anywhere else."""
    out = {"url": url, "name": "", "bio": "", "handles": []}
    try:
        html, _, _ = http_get(url, timeout=20, max_bytes=800_000)
    except Exception as e:      # noqa: BLE001
        out["error"] = str(e)[:200]
        return out
    scope = re.sub(r"<(script|style|nav|footer)[\s\S]*?</\1>", " ", html, flags=re.I)
    out["name"] = strip_html((re.search(r"<h1[^>]*>([\s\S]*?)</h1>", scope, re.I) or [None, ""])[1])[:80]
    m = re.search(r"<meta[^>]+(?:name|property)=[\"'](?:description|og:description)[\"'][^>]+content=[\"']([^\"']*)", html, re.I)
    out["bio"] = strip_html(m.group(1))[:400] if m else ""
    if not out["bio"]:
        for p in re.findall(r"<p[^>]*>([\s\S]*?)</p>", scope, re.I):
            t = strip_html(p).strip()
            if 60 < len(t) < 600 and not re.search(r"cookie|subscribe|newsletter|sign up", t, re.I):
                out["bio"] = t[:400]
                break
    seen = set()
    for plat, rx in _SOCIAL:
        for m in re.finditer(rx, html):
            handle = (m.group(2) + "@" + m.group(1)) if plat == "mastodon" else m.group(1)
            if plat == "mastodon" and ("<" in m.group(0) or not re.search(r"rel=[\"'][^\"']*\bme\b", html[max(0, m.start() - 200):m.start()], re.I)):
                continue                                             # only a declared rel=me mastodon link counts
            if handle.lower() in _SOCIAL_SKIP or (plat, handle.lower()) in seen or len(out["handles"]) >= 8:
                continue
            seen.add((plat, handle.lower()))
            out["handles"].append({"platform": plat, "handle": handle, "url": m.group(0).rstrip("/")})
    return out


def read_article(url: str):
    """The full text of one article: JSON-LD articleBody, else the <p> run inside <article>/<main>, else the description."""
    out = {"url": url, "canonical": None, "title": "", "text": "", "published": None, "author": "",
           "byline": [], "author_url": "", "dateline": ""}
    try:
        html, _, _ = http_get(url, timeout=20, max_bytes=1_500_000)
    except Exception as e:      # noqa: BLE001
        out["error"] = str(e)[:200]
        return out

    def meta(p):
        m = re.search(r"<meta[^>]+(?:property|name)=[\"']%s[\"'][^>]+content=[\"']([^\"']*)" % re.escape(p), html, re.I) or \
            re.search(r"<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:property|name)=[\"']%s[\"']" % re.escape(p), html, re.I)
        return strip_html(m.group(1)) if m else ""
    can = (re.search(r"<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)", html, re.I) or [None, None])[1] or meta("og:url")
    if can:
        out["canonical"] = urllib.parse.urljoin(url, can)
    out["title"] = meta("og:title") or strip_html((re.search(r"<title[^>]*>([^<]*)", html, re.I) or [None, ""])[1])
    tm = re.search(r"<time[^>]+datetime=[\"']([^\"']+)", html, re.I)
    out["published"] = parse_date(meta("article:published_time") or meta("datePublished") or meta("date") or (tm.group(1) if tm else ""))
    out["author"] = meta("author") or meta("article:author") or ""
    for m in re.finditer(r"<script[^>]+ld\+json[^>]*>([\s\S]*?)</script>", html, re.I):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        stack = list(d) if isinstance(d, list) else [d]
        while stack:
            n = stack.pop()
            if not isinstance(n, dict):
                continue
            if isinstance(n.get("@graph"), list):
                stack.extend(n["@graph"])
            body = n.get("articleBody")
            if isinstance(body, str) and len(body) > 200:
                out["text"] = strip_html(body)
                out["published"] = out["published"] or parse_date(n.get("datePublished"))
                au = n.get("author")
                aus = au if isinstance(au, list) else [au] if au else []
                out["byline"] = parse_byline([x.get("name") if isinstance(x, dict) else x for x in aus])
                for x in aus:
                    if isinstance(x, dict) and isinstance(x.get("url"), str) and not out["author_url"]:
                        out["author_url"] = urllib.parse.urljoin(url, x["url"])
                au = aus[0] if aus else None
                if not out["author"] and isinstance(au, dict):
                    out["author"] = au.get("name") or ""
                break
        if out["text"]:
            break
    if not out["text"]:
        scope = (re.search(r"<article[\s\S]*?</article>", html, re.I) or re.search(r"<main[\s\S]*?</main>", html, re.I))
        scope = scope.group(0) if scope else html
        scope = re.sub(r"<(script|style|nav|aside|footer|header|form)[\s\S]*?</\1>", " ", scope, flags=re.I)
        paras = [strip_html(p).strip() for p in re.findall(r"<p[^>]*>([\s\S]*?)</p>", scope, re.I)]
        out["text"] = "\n".join(p for p in paras if len(p) > 40 and not re.search(r"cookie|subscribe|sign up|newsletter|all rights reserved", p, re.I))
    if not out["text"]:
        out["text"] = meta("og:description") or meta("description")
    out["text"] = out["text"][:6000]
    # the byline: JSON-LD first (above), then meta author, then the page's own byline / rel=author link
    if not out["byline"]:
        out["byline"] = parse_byline(out["author"])
    if not out["byline"]:
        m = re.search(r"<[^>]+class=[\"'][^\"']*\b(?:byline|author-name|author__name|c-byline|story-byline)[^\"']*[\"'][^>]*>([\s\S]{0,400}?)</", html, re.I)
        if m:
            out["byline"] = parse_byline(m.group(1))
    am = re.search(r"<a[^>]+rel=[\"']author[\"'][^>]+href=[\"']([^\"']+)[\"'][^>]*>([\s\S]{0,120}?)</a>", html, re.I) or \
        re.search(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]+rel=[\"']author[\"'][^>]*>([\s\S]{0,120}?)</a>", html, re.I)
    if am:
        out["author_url"] = out["author_url"] or urllib.parse.urljoin(url, am.group(1))
        out["byline"] = out["byline"] or parse_byline(am.group(2))
    if not out["author"] and out["byline"]:
        out["author"] = out["byline"][0]
    out["dateline"] = parse_dateline(out["text"])
    return out


def discover(url: str, verify=True):
    """A site → its feeds and a verified search-page template, so it can be followed or searched."""
    url = url if re.match(r"^https?://", url) else "https://" + url
    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(url))
    out = {"url": url, "host": domain_of(url), "feeds": [], "search": None, "candidates": [], "platform": ""}
    html = ""
    try:
        html, _, _ = http_get(origin + "/", timeout=15, max_bytes=600_000)
    except Exception as e:      # noqa: BLE001
        out["error"] = str(e)[:200]
    absu = lambda h: urllib.parse.urljoin(origin, h)   # noqa: E731
    for m in re.finditer(r"<link[^>]+>", html, re.I):
        t = m.group(0)
        if not re.search(r"application/(?:rss|atom)\+xml", t, re.I):
            continue
        href = re.search(r"href=[\"']([^\"']+)", t, re.I)
        title = re.search(r"title=[\"']([^\"']+)", t, re.I)
        if href and len(out["feeds"]) < 6:
            out["feeds"].append({"url": absu(href.group(1)), "title": strip_html(title.group(1)) if title else ""})
    if not out["feeds"]:
        for path in ("/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/?feed=rss2", "/feeds/posts/default", "/index.xml"):
            try:
                body, ctype, final = http_get(origin + path, timeout=8, max_bytes=200_000)
                if re.search(r"xml|rss|atom", ctype or "", re.I) or body.lstrip().startswith("<?xml") or "<rss" in body[:500]:
                    out["feeds"].append({"url": final or origin + path, "title": ""})
                    break
            except Exception:   # noqa: BLE001
                continue
    cands = []
    # 1. OpenSearch description
    os_ = re.search(r"<link[^>]+type=[\"']application/opensearchdescription\+xml[\"'][^>]+>", html, re.I)
    if os_:
        href = re.search(r"href=[\"']([^\"']+)", os_.group(0), re.I)
        if href:
            try:
                xml, _, _ = http_get(absu(href.group(1)), timeout=10, max_bytes=100_000)
                tpl = re.search(r"<Url[^>]+type=[\"']text/html[\"'][^>]+template=[\"']([^\"']+)", xml, re.I) or \
                    re.search(r"<Url[^>]+template=[\"']([^\"']+)[\"'][^>]+type=[\"']text/html[\"']", xml, re.I)
                if tpl:
                    cands.append((absu(tpl.group(1).replace("{searchTerms}", "{q}").replace("&amp;", "&")), "OpenSearch"))
            except Exception:   # noqa: BLE001
                pass
    # 2. the platform behind the site
    for rx, name, tpl in ((r"wp-content|wp-includes|wp-json", "wordpress", "/?s={q}"), (r"discourse|data-discourse", "discourse", "/search?q={q}"),
                          (r"mediawiki|wgCanonicalNamespace|/wiki/Special:", "mediawiki", "/index.php?search={q}"), (r"Shopify\.theme|cdn\.shopify", "shopify", "/search?q={q}"),
                          (r"xenforo|XF\.config", "xenforo", "/search/search?keywords={q}"), (r"vbulletin", "vbulletin", "/search.php?do=process&query={q}"),
                          (r"squarespace", "squarespace", "/search?q={q}"), (r"invision|ipsSettings", "invision", "/search/?q={q}"), (r"phpbb", "phpbb", "/search.php?keywords={q}"),
                          (r"substack", "substack", "/search/{q}"), (r"ghost-url|ghost\.io", "ghost", ""), (r"wix\.com|wixstatic", "wix", "")):
        if re.search(rx, html, re.I):
            out["platform"] = name
            if tpl:
                cands.append((origin + tpl, name))
            break
    # 3. a search form, whatever the field is called
    for f in re.finditer(r"<form[^>]*>([\s\S]*?)</form>", html, re.I):
        open_tag, inner = f.group(0)[:f.group(0).find(">") + 1], f.group(1)
        if re.search(r"method=[\"']post", open_tag, re.I):
            continue
        inp = re.search(r"<input[^>]+(?:type=[\"']search[\"']|name=[\"'](?:q|s|search|query|keyword|keywords|term|text|k|wd|search_query|searchterm|search_term|p)[\"'])[^>]*>", inner, re.I)
        if not inp and re.search(r"search", open_tag + inner, re.I):
            inp = re.search(r"<input[^>]+name=[\"']([^\"']+)[\"'][^>]*>", inner, re.I)
        if not inp:
            continue
        name = re.search(r"name=[\"']([^\"']+)", inp.group(0), re.I)
        if not name:
            continue
        action = re.search(r"action=[\"']([^\"']*)", open_tag, re.I)
        a = absu(action.group(1) if action else "/")
        cands.append((a + ("&" if "?" in a else "?") + name.group(1) + "={q}", "search form"))
    # 4. the usual suspects
    for tpl in ("/search?q={q}", "/?s={q}", "/search/{q}", "/search?query={q}", "/?q={q}", "/search?s={q}"):
        cands.append((origin + tpl, "common pattern"))
    seen = set()
    for tpl, why in cands:
        if tpl in seen or len(out["candidates"]) >= 6:
            continue
        seen.add(tpl)
        okc = False
        if verify:
            try:
                body, _, _ = http_get(tpl.replace("{q}", "news"), timeout=10, max_bytes=300_000)
                title = re.search(r"<title[^>]*>([^<]*)", body, re.I)
                okc = len(re.findall(r"<a\s", body, re.I)) >= 5 and re.search(r"news", strip_html(body), re.I) is not None \
                    and not re.search(r"404|not found", title.group(1) if title else "", re.I)
            except Exception:   # noqa: BLE001
                okc = False
        out["candidates"].append({"template": tpl, "why": why, "verified": okc})
        if okc and not out["search"]:
            out["search"] = tpl
    if not out["search"]:
        out["search_guess"] = out["candidates"][0]["template"] if out["candidates"] else origin + "/?s={q}"
    return out


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
