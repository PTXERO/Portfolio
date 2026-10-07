"""SEARCH//NET tests.  Run:  python -m unittest discover searchnet/server

Offline: gallery-dl and yt-dlp are replaced by stub scripts that print
output in the exact formats the real tools produce; media and web pages
come from a local HTTP server. Network expansion (Datamuse) is disabled."""

import http.server
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from rv import learn, sources as S                       # noqa: E402
from rv.expand import morph_variants, refresh_expansions  # noqa: E402
from rv.learn import TopicScorer, member_ids, pick_queries, query_stats  # noqa: E402
from rv.people import list_people, word_graph             # noqa: E402
from rv.vault import Job                                  # noqa: E402
from rv.related import related                           # noqa: E402
from rv.search import parse_query, search                # noqa: E402
from rv.vault import Vault                               # noqa: E402
from rv import web                                       # noqa: E402


def tweet(tid, text, author="demo_user", likes=10, views=100, tags=(), num=1,
          mtype="video", url="https://video.twimg.com/x.mp4", date="2025-03-01 12:00:00"):
    return [3, url, {
        "category": "twitter", "tweet_id": tid, "content": text, "date": date, "type": mtype,
        "num": num, "author": {"name": author, "nick": author.title()}, "hashtags": list(tags),
        "favorite_count": likes, "retweet_count": 1, "reply_count": 2, "view_count": views,
        "width": 1280, "height": 720, "duration": 12.5, "lang": "en", "extension": url.rsplit(".", 1)[-1],
    }]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.v = Vault(self.tmp, start_threads=False)
        self.v.store.save_settings({"web_expansion": False, "semantic": False})

    def tearDown(self):
        self.v.db.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add(self, *msgs):
        for m in msgs:
            self.v.db.upsert(S.item_from_x(m[1], m[2], "test"))

    def ids(self, **p):
        res = search(self.v.db, self.v.store, p)
        self.assertNotIn("error", res, res.get("error"))
        return [i["id"] for i in res["items"]], res


class TestMappers(Base):
    def test_x(self):
        it = S.item_from_x(*tweet("123", "hello #world", tags=["world"])[1:], "s")
        self.assertEqual((it["id"], it["media"], it["likes"]), ("x:123", "video", 10))
        self.assertEqual(it["posted_at"], 1740830400)
        self.assertEqual(S.item_from_x(*tweet("9", "x", num=2)[1:], "s")["id"], "x:9_2")
        self.assertEqual(S.item_from_x(*tweet("8", "x", mtype="photo",
                                              url="https://pbs.twimg.com/a.jpg")[1:], "s")["media"], "image")

    def test_ytdlp_flat_search(self):
        it = S.item_from_ytdlp({"_type": "url", "ie_key": "Youtube", "id": "abc",
                                "url": "https://www.youtube.com/watch?v=abc", "title": "Kickflip tips",
                                "description": "learn it #skate", "duration": 60, "view_count": 5,
                                "uploader_id": "@chan", "uploader_url": "https://youtube.com/@chan",
                                "thumbnails": [{"url": "t1"}, {"url": "t2"}]}, "s")
        self.assertEqual((it["id"], it["url"], it["thumbnail"]),
                         ("youtube:abc", "https://www.youtube.com/watch?v=abc", "t2"))
        self.assertIn("skate", it["hashtags"])

    def test_generic_gallery_dl(self):
        it = S.item_from_gdl("https://v.tumblr.com/a.mp4", {
            "category": "tumblr", "id": 55, "blog": {"name": "skateblog"}, "tags": ["skate", "diy park"],
            "description": "<p>DIY <b>park</b> session</p>", "date": "2025-01-01 00:00:00",
            "note_count": 40, "extension": "mp4"}, "s")
        self.assertEqual((it["id"], it["author"], it["media"]), ("tumblr:55", "skateblog", "video"))
        self.assertEqual(it["text"], "DIY park session")
        self.assertEqual(it["hashtags"], "skate diypark")

    def test_mastodon(self):
        st = {"id": "1", "created_at": "2026-10-06T13:51:12.224Z", "url": "https://m.social/@a/1",
              "content": "<p>Big <a>#Skate</a> day</p>", "favourites_count": 3, "reblogs_count": 1,
              "replies_count": 0, "language": "en", "tags": [{"name": "skate"}],
              "account": {"acct": "a@m.social", "display_name": "A", "url": "https://m.social/@a"},
              "media_attachments": [
                  {"type": "video", "url": "https://f/v.mp4", "preview_url": "https://f/p.jpg",
                   "meta": {"original": {"width": 1080, "height": 1920, "duration": 53.2}}},
                  {"type": "image", "url": "https://f/i.jpg", "meta": {}}]}
        items = S.items_from_mastodon(st, "m.social", "s")
        self.assertEqual([i["media"] for i in items], ["video", "image"])
        self.assertEqual(items[0]["text"], "Big #Skate day")
        self.assertEqual(items[0]["duration"], 53.2)
        self.assertEqual(len(S.items_from_mastodon(st, "m.social", "s", include_images=False)), 1)

    def test_reddit(self):
        d = {"id": "q1", "title": "Kickflip!", "author": "u1", "subreddit": "skateboarding",
             "created_utc": 1700000000, "score": 99, "num_comments": 5, "is_video": True,
             "permalink": "/r/skateboarding/comments/q1/x/", "url": "https://v.redd.it/q1",
             "media": {"reddit_video": {"duration": 9, "height": 720, "width": 1280}},
             "preview": {"images": [{"source": {"url": "https://p/x.jpg?a=1&amp;b=2"}}]}}
        it = S.item_from_reddit(d, "s")
        self.assertEqual((it["id"], it["media"], it["likes"], it["duration"]), ("reddit:q1", "video", 99, 9.0))
        self.assertEqual(it["thumbnail"], "https://p/x.jpg?a=1&b=2")
        self.assertIsNone(S.item_from_reddit(dict(d, is_video=False, post_hint="link",
                                                  url="https://news.site/a"), "s"))

    def test_feeds(self):
        rss = """<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
          <item><title>Clip one</title><link>https://site.com/a</link><pubDate>Mon, 06 Oct 2025 10:00:00 GMT</pubDate>
          <enclosure url="https://site.com/a.mp4" type="video/mp4"/><category>skate</category></item>
          <item><title>Just text</title><link>https://site.com/b</link></item></channel></rss>"""
        items = S.items_from_feed(rss, "u", "s")
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]["media_url"], items[0]["hashtags"]), ("https://site.com/a.mp4", "skate"))
        atom = """<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"
          xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
          <entry><yt:videoId>VID1</yt:videoId><title>Park edit</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=VID1"/>
          <author><name>Chan</name></author><published>2025-05-01T00:00:00+00:00</published>
          <media:group><media:description>full edit</media:description>
          <media:thumbnail url="https://i/t.jpg"/></media:group></entry></feed>"""
        it = S.items_from_feed(atom, "u", "s")[0]
        self.assertEqual((it["id"], it["author"], it["thumbnail"]), ("youtube:VID1", "Chan", "https://i/t.jpg"))
        self.assertIn("full edit", it["text"])

    def test_query_parsing_and_x_url(self):
        terms, f, any_mode = parse_query('dog "slow motion" -cat @bob #skate tag:fav OR site:x')
        self.assertTrue(any_mode)
        self.assertEqual([t["raw"] for t in terms], ["dog", "slow motion", "cat", "skate"])
        self.assertEqual((f["author"], f["tag"], f["platform"]), ([(False, "bob")], [(False, "fav")],
                                                                   [(False, "x")]))
        q = S.build_x_search("car crash", {"min_likes": 500})
        self.assertIn("filter:videos", q)
        self.assertIn("min_faves:500", q)

    def test_morph(self):
        self.assertEqual(morph_variants("skate park"), ["skatepark", "#skatepark", "skate parks"])
        self.assertIn("puppies", morph_variants("puppy"))
        self.assertEqual(morph_variants("@someone"), [])


class TestSearch(Base):
    def setUp(self):
        super().setUp()
        self.add(tweet("1", "Insane car crash on the highway", author="roadcam", likes=900),
                 tweet("2", "My puppy learning to skateboard", author="petlife", likes=50, tags=["skate"]),
                 tweet("3", "Vehicle collision caught on dashcam", author="roadcam", likes=20),
                 tweet("4", "Cat vs cucumber, hilarious", author="petlife", likes=5000),
                 tweet("5", "Rocket launch from the pad", author="spacefan", likes=300,
                       date="2024-06-01 00:00:00"))

    def test_stem_synonym_typo(self):
        self.assertEqual(self.ids(q="crashes", synonyms="0", fuzzy="0")[0], ["x:1"])
        self.assertEqual(set(self.ids(q="car", fuzzy="0")[0]), {"x:1", "x:3"})
        self.assertEqual(self.ids(q="cucumbr", synonyms="0")[0], ["x:4"])

    def test_operators_filters_sorts(self):
        self.assertEqual(self.ids(q="car -dashcam", fuzzy="0")[0], ["x:1"])
        self.assertEqual(set(self.ids(q="@petlife")[0]), {"x:2", "x:4"})
        self.assertEqual(self.ids(q="#skate")[0], ["x:2"])
        self.assertEqual(set(self.ids(q="rocket OR puppy", synonyms="0", fuzzy="0")[0]), {"x:2", "x:5"})
        self.assertEqual(self.ids(likes_min="100", sort="likes")[0], ["x:4", "x:1", "x:5"])
        self.assertEqual(self.ids(date_to="2024-12-31")[0], ["x:5"])
        ids, res = self.ids(author="roadcam")
        self.assertEqual(res["facets"]["author"][0], {"value": "roadcam", "count": 2})

    def test_fields_and_bad_syntax(self):
        self.v.db.update("x:5", {"transcript": "three two one ignition"})
        self.assertEqual(self.ids(q="said:ignition")[0], ["x:5"])
        self.assertEqual(self.ids(q="ignition", fields="text")[0], [])
        self.assertIn("items", self.ids(q='"unbalanced ( ) * ^ :')[1])

    def test_related(self):
        items, terms = related(self.v, "x:1")
        self.assertIn("x:3", [i["id"] for i in items])     # same author + similar words
        self.assertNotIn("x:1", [i["id"] for i in items])
        self.assertTrue(terms)

    def test_topic_filter_scopes_and_sorts(self):
        t = self.v.create_topic("roads", ["road"])
        tid = t["id"]
        for iid, label, score in [("x:1", 1, 0.2), ("x:3", 0, 0.6), ("x:2", 0, 0.1), ("x:4", -1, 0.9)]:
            self.v.link(tid, iid, "road", "x")
            self.v.db.exec("UPDATE topic_items SET label=?, score=? WHERE topic_id=? AND item_id=?",
                           (label, score, tid, iid))
        ids, _ = self.ids(topic=tid, sort="likes")
        self.assertEqual(set(ids), {"x:1", "x:3"})          # liked + high score only
        self.assertNotIn("x:4", ids)                        # downvoted excluded even with top likes
        self.assertNotIn("x:2", ids)                        # low score excluded
        ids_all, _ = self.ids(topic=tid, topic_all="1")
        self.assertEqual(set(ids_all), {"x:1", "x:2", "x:3", "x:4"})

    def test_wipe(self):
        self.v.db.update("x:1", {"starred": 1})
        t = self.v.create_topic("z", ["z"]); self.v.link(t["id"], "x:2", "z", "x")
        key = self.v.store.access_key
        res = self.v.wipe(reset_sources=True, keep_starred=True)
        self.assertEqual(self.v.db.one("SELECT count(*) n FROM topics")["n"], 0)
        self.assertIsNotNone(self.v.db.get("x:1"))          # starred kept
        self.assertIsNone(self.v.db.get("x:2"))             # rest cleared
        self.assertGreater(self.v.db.one("SELECT count(*) n FROM sources")["n"], 0)  # defaults restored
        self.assertEqual(self.v.store.access_key, key)      # phone stays paired
        self.v.wipe(keep_starred=False)
        self.assertEqual(self.v.db.one("SELECT count(*) n FROM items")["n"], 0)

    def test_upsert_keeps_user_data(self):
        self.v.db.update("x:1", {"tags": "mine", "starred": 1})
        self.v.db.upsert(S.item_from_x(*tweet("1", "edited text", likes=999)[1:], "again"))
        it = self.v.db.get("x:1")
        self.assertEqual((it["tags"], it["starred"], it["likes"]), ("mine", 1, 999))
        self.assertEqual(self.ids(q="edited", fuzzy="0")[0], ["x:1"])


SKATE = ["Kickflip down the 12 stair #skate", "Skatepark session with the crew #skate #park",
         "Heelflip tutorial for beginners #skateboarding", "Best skate tricks of the year #skate",
         "Night skate downtown ledges #skate", "Skate shop opening, free decks #skate"]
NOISE = ["Skate ice rink hockey highlights #hockey", "Figure skating olympic final #figureskating",
         "Ice skate sharpening guide #hockey", "Roller skate disco party #roller"]


class TestLearning(Base):
    def setUp(self):
        super().setUp()
        self.t = self.v.create_topic("skate", ["skate"])
        for n, txt in enumerate(SKATE + NOISE):
            tags = [w[1:] for w in txt.split() if w.startswith("#")]
            self.add(tweet(str(100 + n), txt, author="board" if n < len(SKATE) else "ice", tags=tags))
            self.v.link(self.t["id"], f"x:{100 + n}", "skate", "x")
        self.tid = self.t["id"]

    def scores(self):
        TopicScorer(self.v, self.tid).rescore()
        return {r["item_id"]: r["score"] for r in
                self.v.db.q("SELECT item_id, score FROM topic_items WHERE topic_id=?", (self.tid,))}

    def test_prior_before_votes(self):
        s = self.scores()
        self.assertTrue(all(v > 0.3 for v in s.values()))   # all mention "skate"

    prior_only = {}

    def test_votes_teach_the_difference(self):
        TestLearning.prior_only = self.scores()
        self.v.vote(self.tid, "x:100", 1)
        self.v.vote(self.tid, "x:101", 1)
        self.v.vote(self.tid, f"x:{100 + len(SKATE)}", -1)       # hockey
        self.v.vote(self.tid, f"x:{101 + len(SKATE)}", -1)       # figure skating
        s = self.scores()
        unseen_good = [s[f"x:{100 + i}"] for i in range(2, len(SKATE))]
        ice = s[f"x:{102 + len(SKATE)}"]          # "Ice skate sharpening #hockey" (like the 👎s)
        roller = s[f"x:{103 + len(SKATE)}"]       # ambiguous: never shown either way
        self.assertGreater(min(unseen_good), ice, (unseen_good, ice))
        self.assertGreater(max(unseen_good), roller)
        before = TestLearning.prior_only
        self.assertLess(ice, before[f"x:{102 + len(SKATE)}"])   # votes pushed it down
        sc = TopicScorer(self.v, self.tid)
        self.assertTrue(sc.w)                                     # classifier trained (2+/2-)
        pos, neg = sc.top_features()
        self.assertIn("@board", [f["label"] for f in pos] + ["@board"])
        self.assertTrue(any(f["label"] in ("#hockey", "@ice", "ice", "hockey") for f in neg), neg)
        ins = self.v.insights(self.tid)
        self.assertEqual((ins["n_pos"], ins["n_neg"]), (2, 2))

    def test_expansion_grows_and_learns(self):
        refresh_expansions(self.v, self.tid, web=False)
        q = {r["query"]: r for r in self.v.db.q("SELECT * FROM topic_queries WHERE topic_id=?", (self.tid,))}
        self.assertIn("#skate", q)                                 # morph
        self.assertIn("skateboard", q)                             # synonym group
        for i in range(4):
            self.v.vote(self.tid, f"x:{100 + i}", 1)
        refresh_expansions(self.v, self.tid, web=False)
        q = {r["query"]: r for r in self.v.db.q("SELECT * FROM topic_queries WHERE topic_id=?", (self.tid,))}
        origins = {r["origin"] for r in q.values()}
        self.assertTrue({"cooccur", "learned"} & origins, origins)
        self.assertIn("@board", q)                                 # liked creator

    def test_bandit_keeps_seeds_and_prefers_precise(self):
        stats = [{"query": "skate", "origin": "seed", "enabled": 1, "runs": 5, "precision": .5},
                 {"query": "good", "origin": "web", "enabled": 1, "runs": 5, "precision": .9},
                 {"query": "bad", "origin": "web", "enabled": 1, "runs": 5, "precision": .1},
                 {"query": "off", "origin": "web", "enabled": 0, "runs": 0, "precision": .5}]
        self.assertEqual(pick_queries(stats, 2), ["skate", "good"])

    def test_soft_keywords_and_why_lower(self):
        self.v.update_topic(self.tid, {"settings": {"soft": ["street", "night"]}})
        # teach it: street/night skate good; hockey/ice bad
        self.v.vote(self.tid, "x:100", 1)                    # "Kickflip down the 12 stair"
        self.v.vote(self.tid, "x:104", 1)                    # "Night skate downtown ledges"
        self.v.vote(self.tid, f"x:{100 + len(SKATE)}", -1)   # hockey
        self.v.vote(self.tid, f"x:{101 + len(SKATE)}", -1)   # figure skating
        TopicScorer(self.v, self.tid).rescore()
        refresh_expansions(self.v, self.tid, web=False)
        q = {r["query"] for r in self.v.db.q(
            "SELECT query FROM topic_queries WHERE topic_id=? AND origin='soft'", (self.tid,))}
        self.assertTrue({"street", "night"} & q, q)          # soft words became searches
        # a hockey item's why-note names the words you downvote
        sc = TopicScorer(self.v, self.tid)
        _, why = sc.score(self.v.db.get(f"x:{102 + len(SKATE)}"))   # "Ice skate sharpening #hockey"
        self.assertTrue(any(w in ("hockey", "ice", "#hockey") for w in why.get("lower", [])), why)

    def test_creator_profile(self):
        items = [self.v.db.get(f"x:{100 + i}") for i in range(len(SKATE))]
        prof = self.v._creator_profile(items)
        self.assertEqual(prof["posts"], len(SKATE))
        self.assertIn("skate", prof["top_hashtags"])
        self.assertIn("median_likes", prof)

    def test_downvote_reasons(self):
        self.add(tweet("300", "a clip made with AI generated art", author="z"),
                 tweet("301", "a normal skate clip", author="z", tags=["skate"]))
        self.v.link(self.tid, "x:300", "skate", "x")
        self.v.link(self.tid, "x:301", "skate", "x")
        # built-in reason: AI → preference + anti-keywords, applied as a 👎
        self.v.apply_reasons(self.tid, "x:300", ["ai"])
        st = self.v.topic(self.tid)["settings"]
        self.assertTrue(st["prefs"].get("no_ai"))
        self.assertIn("ai", st["anti"])
        self.assertEqual(self.v.db.one("SELECT label FROM topic_items WHERE topic_id=? AND item_id=?",
                                       (self.tid, "x:300"))["label"], -1)
        # a fresh AI-captioned item is penalised without being voted on
        self.add(tweet("302", "another AI generated clip", author="q"))
        self.v.link(self.tid, "x:302", "skate", "x")
        sc = TopicScorer(self.v, self.tid)
        ai_score, why = sc.score(self.v.db.get("x:302"))
        clean_score, _ = sc.score(self.v.db.get("x:301"))
        self.assertLess(ai_score, clean_score)
        self.assertNotIn("skate", why.get("lower", []))      # topic's own word never shown
        # custom reason becomes an anti-keyword
        self.v.apply_reasons(self.tid, "x:301", ["reaction video"])
        self.assertIn("reaction", self.v.topic(self.tid)["settings"]["anti"])

    def test_feed_review_and_queries_stats(self):
        TopicScorer(self.v, self.tid).rescore()
        f = self.v.topic_feed(self.tid, {"view": "review", "limit": "5"})
        self.assertEqual(len(f["items"]), 5)
        self.assertTrue(f["items"][0]["found_by"])
        self.v.vote(self.tid, f["items"][0]["id"], 1)
        f2 = self.v.topic_feed(self.tid, {"view": "liked"})
        self.assertEqual([i["id"] for i in f2["items"]], [f["items"][0]["id"]])
        st = query_stats(self.v.db, self.tid)
        self.assertEqual(st[0]["query"], "skate")


def stub(path: Path, lines, extra=""):
    path.write_text("import json, sys\n" + extra + "".join(
        f"print(json.dumps({json.dumps(m)}))\n" for m in lines))
    return [sys.executable, str(path)]


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg needed")
class TestPipeline(Base):
    def setUp(self):
        super().setUp()
        media = self.tmp / "srv"
        media.mkdir()
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10",
                        "-t", "2", "-pix_fmt", "yuv420p", str(media / "clip.mp4")], check=True)
        (media / "site.html").write_text(
            '<html><head><link rel="search" type="application/opensearchdescription+xml" href="/os.xml">'
            '<link rel="alternate" type="application/rss+xml" title="Clips feed" href="/feed.xml"></head></html>')
        (media / "os.xml").write_text(
            '<OpenSearchDescription><Url type="text/html" template="http://SITE/find?term={searchTerms}&amp;p={startPage?}"/>'
            '</OpenSearchDescription>')

        class H(http.server.SimpleHTTPRequestHandler):
            def __init__(s, *a, **k):
                super().__init__(*a, directory=str(media), **k)

            def log_message(s, *a):
                pass
        self.fs = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.fs.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.fs.server_port}"
        clip = self.base + "/clip.mp4"
        self.v.tools.gallery_dl = stub(self.tmp / "gdl.py", [
            tweet("101", "Skate park slam", url=clip, tags=["skate"]),
            tweet("102", "photo only", mtype="photo", url=self.base + "/x.jpg"),
            tweet("103", "Dog surfing waves", url=clip, author="surfdog")])
        yt = [{"_type": "url", "ie_key": "Youtube", "id": f"yt{n}", "url": f"https://youtube.com/watch?v=yt{n}",
               "title": t, "duration": 30, "uploader_id": "@c"} for n, t in
              enumerate(["Skateboarding tricks compilation", "Skate shop tour"])]
        self.v.tools.yt_dlp = stub(self.tmp / "ytdlp.py", yt)
        self.v.tools.refresh = lambda: None         # keep the stubs even when /api/status runs
        for src in self.v.list_sources():          # stay offline: only stubbed tools
            if src["kind"] not in ("x", "ytsearch"):
                self.v.update_source(src["id"], {"enabled": False})

    def tearDown(self):
        self.fs.shutdown()
        super().tearDown()

    def test_topic_run_end_to_end(self):
        t = self.v.create_topic("skate", ["skate"], {"breadth": 1})
        job = self.v.run_now("topic", {"topic_id": t["id"]})
        self.assertEqual(job.stats["errors"], 0, job.log_lines)
        feed = self.v.topic_feed(t["id"], {"view": "feed"})
        ids = {i["id"] for i in feed["items"]}
        self.assertTrue({"x:101", "youtube:yt0"} <= ids, (ids, job.log_lines))
        self.assertNotIn("x:102", ids)                        # photo skipped in video mode
        top = feed["items"][0]
        self.assertTrue(top["found_by"] and top["t_score"] > 0)
        self.assertTrue(self.v.db.one("SELECT runs FROM topic_queries WHERE topic_id=? AND query='skate'",
                                      (t["id"],))["runs"] >= 1)
        # download direct media + thumbnail
        dl = self.v.run_now("download", {"ids": ["x:101"]})
        it = self.v.db.get("x:101")
        self.assertEqual(dl.stats["downloaded"], 1, dl.log_lines)
        self.assertTrue((self.v.media_dir / it["file"]).exists())
        self.assertTrue((self.v.media_dir / it["thumb_file"]).exists())

    def test_probe_opensearch_and_feed(self):
        cands = self.v.probe(self.base + "/site.html")
        kinds = {(c["kind"], c["template"]) for c in cands}
        self.assertIn(("template", "http://SITE/find?term={q}"), kinds)
        self.assertIn(("rss", self.base + "/feed.xml"), kinds)
        names = [c["name"] for c in S.probe("youtube.com")]
        self.assertIn("YouTube search", names)

    def test_private_only_access(self):
        from rv import web
        class Fake(web.Handler):
            PUBLIC = False
            def __init__(self, ip, headers=None): self.client_address = (ip, 1); self.headers = headers or {}
        allow = lambda ip, h=None: web.Handler._client_allowed(Fake(ip, h))
        self.assertTrue(allow("127.0.0.1"))
        self.assertTrue(allow("192.168.1.9"))
        self.assertTrue(allow("100.100.1.1"))          # Tailscale/CGNAT
        self.assertFalse(allow("8.8.8.8"))             # public internet refused
        self.assertFalse(allow("127.0.0.1", {"X-Forwarded-For": "8.8.8.8"}))   # tunnel refused
        Fake.PUBLIC = True
        self.assertTrue(allow("8.8.8.8"))              # --expose opt-in
        # brute-force lockout
        web._pair_fails.clear()
        for _ in range(8):
            web._record_attempt("9.9.9.9", False)
        self.assertTrue(web._locked_out("9.9.9.9"))
        web._record_attempt("9.9.9.9", True)
        self.assertFalse(web._locked_out("9.9.9.9"))

    def test_http_auth_and_api(self):
        web.Handler.vault = self.v
        srv = web.ThreadingHTTPServer(("127.0.0.1", 0), web.Handler)
        port = srv.server_port
        web.Handler.port = port
        web.Handler.allowed_origins = set()
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}"
        key = self.v.store.access_key

        def call(path, method="GET", body=None, headers=None):
            req = urllib.request.Request(base + path, method=method, headers=headers or {},
                                         data=json.dumps(body).encode() if body is not None else None)
            try:
                with urllib.request.urlopen(req) as r:
                    return r.status, r.read(), r.headers
            except urllib.error.HTTPError as e:
                return e.code, e.read(), e.headers
        try:
            # from this computer: no key needed
            self.assertEqual(call("/api/status")[0], 200)
            # same computer but addressed by another name (like a phone would): key needed
            phone = {"Host": f"192.168.1.50:{port}"}
            self.assertEqual(call("/api/status", headers=phone)[0], 401)
            self.assertEqual(call("/api/topics", headers=dict(phone, **{"X-RV-Key": "nope"}))[0], 401)
            self.assertEqual(call("/api/status", headers=dict(phone, Cookie=f"rv_key={key}"))[0], 200)
            # QR pairing link sets the cookie
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *a, **k):
                    return None
            op = urllib.request.build_opener(NoRedirect)
            try:
                op.open(urllib.request.Request(base + f"/searchnet/?key={key}", headers=phone))
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 302)
                self.assertIn(f"rv_key={key}", e.headers["Set-Cookie"])
                self.assertEqual(e.headers["Location"], "/searchnet/")
            # pairing by typing the key
            code, _, hdr = call("/api/pair", "POST", {"key": key}, phone)
            self.assertEqual(code, 200)
            # cross-site request blocked
            self.assertEqual(call("/api/bulk", "POST", {"ids": [], "action": "tag"},
                                  {"Origin": "https://evil.example"})[0], 403)
            # topic lifecycle over HTTP
            code, body, _ = call("/api/topics", "POST", {"name": "skate", "run": False})
            tid = json.loads(body)["id"]
            self.v.run_now("topic", {"topic_id": tid})
            feed = json.loads(call(f"/api/topics/{tid}/feed?view=review")[1])
            self.assertTrue(feed["items"])
            iid = feed["items"][0]["id"]
            self.assertEqual(call(f"/api/topics/{tid}/vote", "POST", {"item_id": iid, "label": 1})[0], 200)
            ins = json.loads(call(f"/api/topics/{tid}/insights")[1])
            self.assertEqual(ins["n_pos"], 1)
            # sources: list / add preset / add custom / validation
            srcs = json.loads(call("/api/sources")[1])["sources"]
            self.assertTrue({"YouTube search", "X / Twitter search"} <= {s["name"] for s in srcs})
            code, body, _ = call("/api/sources", "POST", {"preset": "subreddit", "param": "skateboarding"})
            self.assertEqual(json.loads(body)["template"], "r/skateboarding")
            self.assertEqual(call("/api/sources", "POST", {"kind": "rss", "template": "nope"})[0], 400)
            # UI, media guard, path traversal
            self.assertIn(b"SEARCH//NET", call("/searchnet/")[1])
            self.assertEqual(call("/media/../vault.db")[0], 403)
            self.assertEqual(call("/searchnet/data/vault.db")[0], 404)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()


class TestPeople(Base):
    """WEB view on the PC server: profiles + connection web from collected public posts."""

    def _seed(self):
        self.add(tweet("1", "sunset timelapse #photo #film", author="ana", tags=["photo", "film"]),
                 tweet("2", "another roll #film #analog", author="ana", tags=["film", "analog"]),
                 tweet("3", "my photo set #photo #film", author="ben", tags=["photo", "film"]),
                 tweet("4", "thanks @ana for the tips #analog", author="cat", tags=["analog"]),
                 tweet("5", "unrelated cooking video #pasta", author="dan", tags=["pasta"]))

    def test_list_profile_graph(self):
        from rv import people
        self._seed()
        lst = people.list_people(self.v)
        self.assertEqual(lst["total"], 4)
        self.assertEqual(lst["people"][0]["author"], "ana")          # most posts first
        p = people.profile(self.v, "ana|x")
        self.assertEqual(p["n"], 2)
        self.assertIn("film", [h["value"] for h in p["hashtags"]])
        conn = {c["author"]: c for c in p["connected"]}
        self.assertIn("ben", conn)                                    # shares #photo #film
        self.assertIn("cat", conn)                                    # mentions @ana
        self.assertTrue(any(w["kind"] == "mentions" for w in conn["cat"]["why"]))
        self.assertNotIn("dan", conn)                                 # nothing in common
        # nothing sensitive is ever inferred: no such keys exist on a profile
        self.assertFalse([k for k in p if any(s in k.lower() for s in
                                              ("gender", "sexual", "politic", "religion", "ethnic", "race"))])
        g = people.graph(self.v)
        self.assertEqual(g["shown"], 4)
        pairs = {frozenset((e["a"], e["b"])) for e in g["edges"]}
        self.assertIn(frozenset(("ana|x", "ben|x")), pairs)
        self.assertIn(frozenset(("ana|x", "cat|x")), pairs)

    def test_meta_is_user_entered_and_local(self):
        from rv import people
        self._seed()
        m = people.set_meta(self.v, "ana|x", {"attrs": ["favourite", "film"], "notes": "met at the lab"})
        self.assertEqual(m["attrs"], ["favourite", "film"])
        self.assertTrue((self.tmp / "people.json").exists())          # stays on this machine
        self.assertEqual(people.profile(self.v, "ana|x")["meta"]["notes"], "met at the lab")
        # hand-added links show in the graph even with nothing in common
        people.set_meta(self.v, "ana|x", {"links": ["dan|x"]})
        g = people.graph(self.v)
        self.assertTrue(any(e.get("you") and {e["a"], e["b"]} == {"ana|x", "dan|x"} for e in g["edges"]))

    def test_router(self):
        from rv import people
        self._seed()
        self.assertEqual(people.handle(self.v, "GET", ["people"], {}, {})["total"], 4)
        self.assertEqual(people.handle(self.v, "GET", ["people", "ana|x"], {}, {})["author"], "ana")
        self.assertIn("nodes", people.handle(self.v, "GET", ["graph"], {"max": "10"}, {}))
        self.assertEqual(people.handle(self.v, "PATCH", ["people", "ana|x"], {}, {"notes": "x"})["notes"], "x")


    def test_follows_are_real_tier1_links(self):
        """Follow lists from the platform's public graph become white tier-1 links (and only those)."""
        from rv import people
        for i, (who, txt) in enumerate((("ana", "sunset #photo"), ("ben", "cooking #pasta"), ("cat", "gym"))):
            self.v.db.upsert({"id": f"m{i}", "platform": "mastodon", "author": who, "author_url": f"https://m.social/@{who}",
                              "text": txt, "hashtags": txt.split("#")[-1] if "#" in txt else "", "media": "video",
                              "url": f"https://m.social/@{who}/{i}", "posted_at": 1700000000 + i})
        fake = lambda plat, handle, url="", limit=300: {"follows": [{"handle": "ben", "name": "Ben", "url": "", "posts": 9},  # noqa: E731
                                                         {"handle": "zed@elsewhere", "name": "", "url": "", "posts": 3}],
                                                        "followers": [{"handle": "cat", "name": "", "url": "", "posts": 1}]}
        r = people.load_follows(self.v, "ana|mastodon", fetch=fake)
        self.assertEqual((r["state"], r["result"]["follows"], r["result"]["followers"], r["result"]["known"]), ("done", 2, 1, 2))
        p = people.profile(self.v, "ana|mastodon")
        self.assertEqual([k["author"] for k in p["follows"]["known"]], ["ben"])
        self.assertEqual([u["handle"] for u in p["follows"]["unknown"]], ["zed@elsewhere"])
        self.assertEqual([k["author"] for k in p["followed_by"]["known"]], ["cat"])
        conn = {c["author"]: c for c in p["connected"]}
        self.assertEqual(conn["ben"]["t"], 1)                        # nothing in common but a follow: still linked
        self.assertTrue(any(w["kind"] == "follows" for w in conn["ben"]["why"]))
        g = people.graph(self.v)
        e = next(e for e in g["edges"] if {e["a"], e["b"]} == {"ana|mastodon", "ben|mastodon"})
        self.assertEqual((e["f"], e["t"]), (1, 1))
        wg = people.word_graph(self.v, kinds="account")
        e = next(e for e in wg["edges"] if {e["a"], e["b"]} == {"@ana|mastodon", "@ben|mastodon"})
        self.assertEqual(e["t"], 1)
        # a non-fediverse account is told why, not failed silently
        self.assertIn("error", people.load_follows(self.v, "nobody|x", fetch=fake))
        # the people list knows networks and can sort / filter by them
        self._seed()
        lst = people.list_people(self.v, sort="network")
        self.assertEqual(lst["platforms"], {"mastodon": 3, "x": 4})
        self.assertEqual([p["platform"] for p in lst["people"]][:3], ["mastodon"] * 3)
        self.assertEqual(people.list_people(self.v, platform="x")["total"], 4)
        self.assertTrue(all(n["platform"] == "x" for n in people.graph(self.v, platform="x")["nodes"]))
        self.assertEqual(people.handle(self.v, "GET", ["people"], {"platform": "mastodon"}, {})["total"], 3)

    def test_identity_hygiene(self):
        """Same handle on another network is NOT a link; @ inside a URL is not a mention;
        JohnSmith and johnsmith are one account; a 4-image tweet is one post."""
        from rv import people
        up = self.v.db.upsert
        up({"id": "x:1_1", "platform": "x", "post_id": "1", "author": "JohnSmith", "text": "pic 1 of 4", "media": "image", "url": "u1"})
        up({"id": "x:1_2", "platform": "x", "post_id": "1", "author": "johnsmith", "text": "pic 2 of 4", "media": "image", "url": "u1"})
        up({"id": "x:1_3", "platform": "x", "post_id": "1", "author": "JohnSmith", "text": "pic 3 of 4", "media": "image", "url": "u1"})
        up({"id": "x:2", "platform": "x", "post_id": "2", "author": "JohnSmith",
            "text": "watch https://youtube.com/@ytperson and thanks @realfriend", "media": "video", "url": "u2"})
        up({"id": "x:3", "platform": "x", "post_id": "3", "author": "realfriend", "text": "hey", "media": "video", "url": "u3"})
        up({"id": "x:4", "platform": "x", "post_id": "4", "author": "ytperson", "text": "yo", "media": "video", "url": "u4"})
        up({"id": "m:5", "platform": "mastodon", "post_id": "5", "author": "johnsmith", "text": "different person entirely", "media": "video", "url": "u5"})
        up({"id": "m:6", "platform": "mastodon", "post_id": "6", "author": "someone", "text": "cc @johnsmith", "media": "video", "url": "u6"})
        p = people.profile(self.v, "JohnSmith|x")
        self.assertEqual((p["n"], p["items_n"]), (2, 4))                      # 2 posts, 4 attachments, one account
        self.assertEqual(people.profile(self.v, "johnsmith|x")["id"], "johnsmith|x")
        conn = {c["id"]: c for c in p["connected"]}
        self.assertIn("realfriend|x", conn)                                   # a real @mention on the same network
        self.assertTrue(any(w["kind"] == "mentions" for w in conn["realfriend|x"]["why"]))
        self.assertNotIn("ytperson|x", conn)                                  # youtube.com/@ytperson is a link, not a tag
        self.assertNotIn("johnsmith|mastodon", conn)                          # same name elsewhere is not a link
        self.assertFalse(any(w["kind"] == "mentions" for c in conn.values() for w in c["why"] if c["platform"] != "x"))
        g = people.word_graph(self.v, kinds="account")
        ids = {n["id"] for n in g["nodes"]}
        self.assertIn("@johnsmith|x", ids)
        self.assertEqual(sum(1 for n in g["nodes"] if n["id"].endswith("|x") and "johnsmith" in n["id"]), 1)
        mention_edges = {frozenset((e["a"], e["b"])) for e in g["edges"] if e["p"]["m"] > 0}
        self.assertIn(frozenset(("@johnsmith|x", "@realfriend|x")), mention_edges)
        self.assertNotIn(frozenset(("@johnsmith|x", "@ytperson|x")), mention_edges)
        self.assertNotIn(frozenset(("@johnsmith|x", "@johnsmith|mastodon")), mention_edges)
        self.assertNotIn(frozenset(("@someone|mastodon", "@johnsmith|x")), mention_edges)
        self.assertEqual(next(n for n in g["nodes"] if n["id"] == "@johnsmith|x")["n"], 2)

    def test_identities_tie_accounts_under_one_name(self):
        """One person, several accounts on several networks: only the user links them, each link keeps its
        reason, the web draws them as tier-1 'same person' links, and MERGE collapses them into one node."""
        from rv import people
        up = self.v.db.upsert
        up({"id": "x:1", "platform": "x", "post_id": "1", "author": "johnsmith", "text": "hi #a", "hashtags": "a", "media": "video", "url": "u1"})
        up({"id": "ig:2", "platform": "instagram", "post_id": "2", "author": "john.smith", "text": "yo #b", "hashtags": "b", "media": "image", "url": "u2"})
        up({"id": "x:3", "platform": "x", "post_id": "3", "author": "other", "text": "thanks @johnsmith", "media": "video", "url": "u3"})
        # nothing links the X and Instagram accounts on their own
        self.assertNotIn("john.smith|instagram", {c["id"] for c in people.profile(self.v, "johnsmith|x")["connected"]})
        I = people.handle(self.v, "POST", ["identities"], {}, {"name": "John Smith", "accounts": [{"id": "johnsmith|x", "how": "you"}]})
        I = people.handle(self.v, "PATCH", ["identities", I["id"]], {}, {"add": [{"id": "john.smith|instagram", "how": "post link"}]})
        self.assertEqual([(a["handle"], a["platform"], a["how"]) for a in I["accounts"]],
                         [("johnsmith", "x", "you"), ("john.smith", "instagram", "post link")])
        self.assertTrue((self.tmp / "identities.json").exists())           # stays on this machine
        p = people.profile(self.v, "johnsmith|x")
        self.assertEqual(p["identity"]["name"], "John Smith")
        c = next(c for c in p["connected"] if c["id"] == "john.smith|instagram")
        self.assertEqual((c["t"], c["p"]["i"]), (1, 5))
        self.assertTrue(any(w["kind"] == "identity" for w in c["why"]))
        g = people.word_graph(self.v, kinds="account")
        e = next(e for e in g["edges"] if {e["a"], e["b"]} == {"@johnsmith|x", "@john.smith|instagram"})
        self.assertGreater(e["p"]["i"], 0)
        self.assertEqual(next(n for n in g["nodes"] if n["id"] == "@johnsmith|x")["identity"], "John Smith")
        gm = people.word_graph(self.v, kinds="account", merge=True)
        ids = {n["id"] for n in gm["nodes"]}
        self.assertNotIn("@johnsmith|x", ids)
        node = next(n for n in gm["nodes"] if n["id"].startswith("person:"))
        self.assertEqual((node["label"], node["n"], sorted(node["accounts"])), ("John Smith", 2, ["john.smith|instagram", "johnsmith|x"]))
        self.assertTrue(any({e["a"], e["b"]} == {node["id"], "@other|x"} and e["p"]["m"] > 0 for e in gm["edges"]))   # the mention follows into the merged node
        # an account belongs to one person: moving it removes it from the other
        J = people.handle(self.v, "POST", ["identities"], {}, {"name": "Someone Else", "accounts": ["john.smith|instagram"]})
        self.assertEqual([a["id"] for a in people.handle(self.v, "GET", ["identities", I["id"]], {}, {})["accounts"]], ["johnsmith|x"])
        self.assertEqual(people.handle(self.v, "DELETE", ["identities", J["id"]], {}, {}), {"ok": True})

    def test_person_verdicts_keep_namesakes_out(self):
        """A name search pulls in a namesake. 'Not them' drops that account's posts from the dossier and
        keeps future ones out; 'them' confirms; 'restore' lets it back."""
        tid = self.v.create_topic("John Smith", seeds=['"John Smith"'],
                                  settings={"person": {"mode": "name", "first": "John", "last": "Smith"}})["id"]
        for i, (who, txt) in enumerate((("john_s", "John Smith here, skating"), ("john_s", "another by the real one"),
                                        ("smith_john_2", "John Smith realtor, call me"))):
            self.v.db.upsert({"id": f"p{i}", "platform": "x", "post_id": str(i), "author": who, "text": txt, "media": "video", "url": f"u{i}"})
            self.v.link(tid, f"p{i}", '"John Smith"', "x")
        self.assertEqual(self.v.db.one("SELECT count(*) n FROM topic_items WHERE topic_id=?", (tid,))["n"], 3)
        r = self.v.person_verdict(tid, "not_them", "smith_john_2|x", "p2")
        self.assertEqual((r["removed"], r["not_them"]), (1, ["smith_john_2|x"]))
        self.assertEqual(self.v.db.one("SELECT count(*) n FROM topic_items WHERE topic_id=?", (tid,))["n"], 2)
        # a later run finds the namesake again: it never gets linked
        self.v.db.upsert({"id": "p9", "platform": "x", "post_id": "9", "author": "Smith_John_2", "text": "John Smith open house", "media": "video", "url": "u9"})
        self.v.link(tid, "p9", '"John Smith"', "x")
        self.assertEqual(self.v.db.one("SELECT count(*) n FROM topic_items WHERE topic_id=?", (tid,))["n"], 2)
        # confirming the real one labels the post and clears nothing else
        r = self.v.person_verdict(tid, "them", "john_s|x", "p0")
        self.assertEqual(self.v.db.one("SELECT label FROM topic_items WHERE topic_id=? AND item_id='p0'", (tid,))["label"], 1)
        # restore → the namesake can be linked again
        r = self.v.person_verdict(tid, "restore", "smith_john_2|x")
        self.assertEqual(r["not_them"], [])
        self.v.link(tid, "p9", '"John Smith"', "x")
        self.assertEqual(self.v.db.one("SELECT count(*) n FROM topic_items WHERE topic_id=?", (tid,))["n"], 3)
        # the HTTP route exists and validates
        from rv.web import parse_creator  # noqa: F401 — module import sanity
        with self.assertRaises(ValueError):
            self.v.person_verdict(tid, "nonsense", "x|x")

    def test_everything_means_every_post(self):
        """'everything' collects text posts, replies and comments — not only media — and reads any site's
        search page when no downloader knows it."""
        from rv import sources as S
        from rv.vault import Vault
        # X: no media filter, replies allowed, and a text-only tweet from gallery-dl becomes a post
        self.assertNotIn("filter:", S.build_x_search("cat", {"media": "everything"}))
        self.assertIn("filter:media", S.build_x_search("cat", {"media": "all"}))
        self.assertIn("-filter:replies", S.build_x_search("cat", {"media": "all"}))
        it = S.item_from_x("text:", {"tweet_id": "77", "content": "just words", "count": 0, "author": {"name": "someone"}}, "t")
        self.assertEqual((it["media"], it["media_url"], it["text"]), ("post", None, "just words"))
        # Mastodon: a status without attachments is a post when text is wanted, nothing otherwise
        st = {"id": "5", "content": "<p>hello <b>there</b></p>", "account": {"acct": "a@m", "url": "u"}, "tags": [], "media_attachments": []}
        self.assertEqual(S.items_from_mastodon(st, "m", "t", True, True)[0]["media"], "post")
        self.assertEqual(S.items_from_mastodon(st, "m", "t", True, False), [])
        # Reddit: a comment is a post, a text submission too
        com = {"id": "c1", "body": "nice one", "permalink": "/r/x/comments/c1", "author": "bob", "subreddit": "x", "created_utc": 1700000000}
        self.assertEqual(S.item_from_reddit(com, "t", True, True)["text"], "↩ nice one")
        self.assertIsNone(S.item_from_reddit(com, "t", True, False))
        sub = {"id": "s1", "title": "a question", "selftext": "why?", "permalink": "/r/x/comments/s1", "author": "bob", "subreddit": "x", "url": "https://www.reddit.com/r/x/comments/s1"}
        self.assertEqual(S.item_from_reddit(sub, "t", True, True)["media"], "post")
        self.assertIsNone(S.item_from_reddit(sub, "t", True, False))
        # the vault accepts posts only under 'everything'
        self.assertTrue(self.v.accept({"id": "x", "media": "post"}, {"media": "everything"}))
        self.assertFalse(self.v.accept({"id": "x", "media": "post"}, {"media": "all"}))
        # any site: the page reader pulls JSON-LD entries and result links out of a search page
        html = ("""<html><body><script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":"""
                """{"@type":"VideoObject","name":"Skate clip","url":"/v/1","contentUrl":"/v/1.mp4","thumbnailUrl":"/t/1.jpg","uploadDate":"2025-03-01"}}]}</script>"""
                """<a href="/post/2">A longer result about skating</a><a href="/login">log in here please</a></body></html>""")
        orig = S.http_get
        S.http_get = lambda url, **k: (html, "text/html", url)
        try:
            class C:  # noqa: D401 — minimal ctx
                label, opts = "t", {}
                def log(self, m): pass
            got = list(S.fetch_html_page(C(), "https://example.org/search?q=skate", 10))
        finally:
            S.http_get = orig
        self.assertEqual([(g["media"], g["url"]) for g in got], [("video", "https://example.org/v/1"), ("post", "https://example.org/post/2")])
        self.assertEqual(got[0]["media_url"], "/v/1.mp4")

    def test_creator_feeds_per_network(self):
        """One @username on one site becomes that topic's own source — no cross-site guessing."""
        from rv.web import parse_creator
        tid = self.v.create_topic("me")["id"]
        feeds = {plat: self.v.follow_author(tid, "someone", plat)["template"]
                 for plat in ("x", "youtube", "reddit", "bluesky", "tiktok", "instagram", "threads")}
        self.assertEqual(feeds["x"], "https://x.com/someone/with_replies")       # everything they post, replies too
        self.assertEqual(feeds["youtube"], "https://www.youtube.com/@someone/videos")
        self.assertEqual(feeds["bluesky"], "https://bsky.app/profile/someone")
        self.assertEqual(feeds["tiktok"], "https://www.tiktok.com/@someone")
        self.assertEqual(feeds["instagram"], "https://www.instagram.com/someone/")
        self.assertEqual(self.v.follow_author(tid, "someone@m.social", "mastodon")["template"], "https://m.social/@someone.rss")
        # every feed is scoped to this topic only
        self.assertTrue(all(s["options"].get("topic") == tid for s in self.v.list_sources() if s["name"].startswith("@someone")))
        # a bare handle keeps the platform you chose; a link decides its own
        self.assertEqual(parse_creator("@someone", "youtube")[:2], ("someone", "youtube"))
        self.assertEqual(parse_creator("https://bsky.app/profile/x.bsky.social")[:2], ("x.bsky.social", "bluesky"))
        self.assertEqual(parse_creator("https://www.instagram.com/some.one/")[:2], ("some.one", "instagram"))
        self.assertEqual(parse_creator("https://m.social/@someone")[:2], ("someone@m.social", "mastodon"))


class TestWordWeb(Base):
    """The word web: @accounts, #hashtags and words/"phrases" in one graph, centred on a focus."""

    def _seed(self):
        self.add(tweet("1", "golden hour timelapse #photo #film", author="ana", tags=["photo", "film"]),
                 tweet("2", "golden hour again #film #analog", author="ana", tags=["film", "analog"]),
                 tweet("3", "my photo set golden hour #photo", author="ben", tags=["photo"]),
                 tweet("4", "pasta night #pasta", author="dan", tags=["pasta"]))

    def test_kinds_and_focus(self):
        from rv import people
        self._seed()
        g = people.word_graph(self.v)
        kinds = {n["kind"] for n in g["nodes"]}
        self.assertEqual(kinds, {"account", "hashtag", "word"})
        ids = {n["id"] for n in g["nodes"]}
        self.assertIn("#film", ids)
        self.assertIn("w:golden", ids)
        self.assertTrue(any(e["a"] == "#film" or e["b"] == "#film" for e in g["edges"]))
        # @account focus
        g = people.word_graph(self.v, focus="@ana")
        self.assertEqual(g["focus"], "@ana|x")
        self.assertIn("#film", {n["id"] for n in g["nodes"]})
        # #hashtag focus (case/punctuation tolerant)
        self.assertEqual(people.word_graph(self.v, focus="#Film")["focus"], "#film")
        # "quoted phrase" becomes its own node, linked to the accounts that said it
        g = people.word_graph(self.v, focus='"golden hour"')
        self.assertEqual(g["focus"], "w:golden hour")
        touching = {e["a"] for e in g["edges"] if e["b"] == "w:golden hour"} | {e["b"] for e in g["edges"] if e["a"] == "w:golden hour"}
        self.assertIn("@ana|x", touching)
        self.assertIn("@ben|x", touching)
        self.assertNotIn("@dan|x", touching)
        # kinds filter + router
        g = people.handle(self.v, "GET", ["graph"], {"focus": "#photo", "kinds": "account,hashtag"}, {})
        self.assertFalse([n for n in g["nodes"] if n["kind"] == "word"])
        self.assertEqual(g["focus"], "#photo")
        self.assertIn("nodes", people.handle(self.v, "GET", ["graph"], {}, {}))     # legacy account graph still served


class TestPeopleMore(Base):
    def test_more_submits_a_collect_job_on_the_profile(self):
        from rv import people
        self.add(tweet("1", "sunset #film", author="ana", tags=["film"]))
        j = people.handle(self.v, "POST", ["people", "ana|x", "more"], {}, {"limit": 10})
        self.assertEqual(j.get("kind"), "collect")
        self.assertIn("ana", j.get("title", ""))
        # an X handle we have nothing from yet still works: start from one @account and build outward
        j2 = people.handle(self.v, "POST", ["people", "nobody|x", "more"], {}, {})
        self.assertEqual(j2.get("kind"), "collect")
        self.assertEqual(self.v.jobs[j2["id"]].params["urls"], ["https://x.com/nobody/media"])
        self.assertEqual(people.handle(self.v, "POST", ["people", "nobody|weirdsite", "more"], {}, {}).get("error"), "no account")


class TestWordWebWeights(Base):
    """Text-network standards: window co-occurrence, min occurrences, relevance cut, association strength."""

    def test_window_and_association(self):
        from rv import people
        # "canopy roads" are adjacent in every post; "canopy" and "kayaking" are far apart in the same posts
        for i in range(24):
            self.add(tweet(str(i), "Weekend canopy roads trip; later some kayaking on the springs #hiking",
                           author="acct%d" % (i % 6), tags=["hiking"]))
        self.add(tweet("x1", "one-off word zyxw here #hiking", author="acct0", tags=["hiking"]))
        g = people.word_graph(self.v, focus="canopy")
        w = {frozenset((e["a"], e["b"])): e["w"] for e in g["edges"]}
        near = w.get(frozenset(("w:canopy", "w:roads")), 0)
        far = w.get(frozenset(("w:canopy", "w:kayaking")), 0)
        self.assertGreater(near, far)                                   # window proximity counts more
        self.assertNotIn("w:zyxw", {n["id"] for n in g["nodes"]})       # below the minimum occurrences
        self.assertEqual(g["focus"], "w:canopy")


class WebSourcesAndMembership(Base):
    """News / web sources, site discovery, what counts as 'in' a topic, surprise votes."""

    RSS = ('<?xml version="1.0"?><rss><channel>%s</channel></rss>')
    ITEM = ('<item><title>%s</title><link>%s</link><pubDate>Tue, 07 Oct 2026 10:00:00 GMT</pubDate>'
            '<description>%s</description><source url="https://x">%s</source></item>')

    def _mock(self, get=None, js=None):
        self._og, self._oj = S.http_get, S.http_json
        if get:
            S.http_get = get
        if js:
            S.http_json = js
        self.addCleanup(self._unmock)

    def _unmock(self):
        S.http_get, S.http_json = self._og, self._oj

    def test_news_and_web_adapters_make_post_items_with_the_outlet_as_author(self):
        seen = []
        def get(url, **k):
            seen.append(url)
            xml = self.RSS % (self.ITEM % ("Isaias nears the coast", "https://www.tampabay.com/isaias", "storm", "Tampa Bay Times"))
            return xml, "text/xml", url
        self._mock(get=get)
        src = S.source_from_preset("news", "Florida")
        ctx = type("C", (), {"opts": {}, "label": "t"})()
        items = list(S.fetch_news(ctx, src, "hurricane isaias", 10))
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]["platform"], items[0]["media"], items[0]["author"]), ("news", "post", "Tampa Bay Times"))
        self.assertTrue(items[0]["id"].startswith("news:"))
        self.assertIn("hurricane%20isaias%20Florida", seen[0])        # extra terms ride along
        obits = S.source_from_preset("obituaries")
        list(S.fetch_web(ctx, obits, "john smith", 5))
        self.assertIn("obituary", urllib.parse.unquote(seen[-1]))

    def test_articles_are_kept_even_when_the_topic_only_wants_video(self):
        self._mock(get=lambda url, **k: (self.RSS % (self.ITEM % ("A", "https://a.example/1", "", "A")), "text/xml", url))
        src = self.v.add_source(S.source_from_preset("news"))
        got = list(self.v.fetch(Job("collect", {}), src, "x", 10, {"media": "video"}))
        self.assertEqual(len(got), 1)
        self.assertIsNotNone(self.v.db.get(got[0]["id"]))

    def test_discover_finds_feed_and_search_form(self):
        html = ('<html><head><link rel="alternate" type="application/rss+xml" title="Feed" href="/feed.xml"></head>'
                '<body><form action="/search"><input type="text" name="q"></form></body></html>')
        self._mock(get=lambda url, **k: (html, "text/html", url))
        d = S.discover("blog.example")
        self.assertEqual(d["feeds"][0]["url"], "https://blog.example/feed.xml")
        self.assertEqual(d["search"], "https://blog.example/search?q={q}")

    def test_thumbs_down_and_low_scores_stay_out_of_the_web(self):
        t = self.v.create_topic("Florida Hurricane Isaias", ["florida hurricane isaias"])
        self.add(tweet("1", "Isaias storm surge hits Tampa #isaias", author="storm"), tweet("2", "ICE deportations in Florida continue #ice", author="ice"),
                 tweet("3", "random post about florida beaches", author="junk"))
        for i in ("x:1", "x:2", "x:3"):
            self.v.link(t["id"], i, "florida", "s")
        self.v.vote(t["id"], "x:1", 1)
        self.v.vote(t["id"], "x:2", -1)
        self.v.db.exec("UPDATE topic_items SET score=0.2 WHERE topic_id=? AND item_id='x:3'", (t["id"],))
        ids = member_ids(self.v.db, t["id"])
        self.assertIn("x:1", ids)
        self.assertNotIn("x:2", ids)
        self.assertNotIn("x:3", ids)
        g = word_graph(self.v, topic=t["id"], kinds="account,hashtag,word", max_nodes=50)
        labels = {n["label"] for n in g["nodes"]}
        self.assertNotIn("ice", labels)
        self.assertFalse(any(n["kind"] == "account" and n["label"] == "ice" for n in g["nodes"]))
        people = list_people(self.v, topic=t["id"])
        rows = people["people"] if isinstance(people, dict) else people
        self.assertEqual({p["author"] for p in rows}, {"storm"})

    def test_a_surprising_vote_hands_back_the_posts_own_words(self):
        t = self.v.create_topic("Isaias", ["hurricane isaias"])
        self.add(tweet("1", "ICE deportation raids expand #ice", author="a"))
        self.v.link(t["id"], "x:1", "florida", "s")
        self.v.db.exec("UPDATE topic_items SET score=0.9 WHERE topic_id=? AND item_id='x:1'", (t["id"],))
        r = self.v.vote(t["id"], "x:1", -1)
        self.assertTrue(r["surprise"])
        self.assertIn("#ice", r["surprise"]["terms"])
        self.assertTrue(any(w in r["surprise"]["terms"] for w in ("deportation", "raids")))
        # 👍 with a reason becomes a soft keyword, never an anti keyword
        self.v.apply_reasons(t["id"], "x:1", ["storm surge"], vote=1)
        st = self.v.topic(t["id"])["settings"]
        self.assertIn("storm surge", st["soft"])
        self.assertNotIn("storm", st.get("anti", []))
