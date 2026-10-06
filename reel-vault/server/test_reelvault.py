"""Tests for the REEL//VAULT backend.  Run:  python -m unittest discover reel-vault/server

The collect test swaps gallery-dl for a stub that prints JSON lines in the
exact format `gallery-dl -J -o output.jsonl=true` produces, pointing at an
mp4 served from a local HTTP server, so the whole pipeline runs offline."""

import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import reelvault as vv  # noqa: E402


def tweet(tid, text, author="demo_user", likes=10, views=100, tags=(), num=1,
          mtype="video", url="https://video.twimg.com/x.mp4", date="2025-03-01 12:00:00"):
    return [3, url, {
        "tweet_id": tid, "content": text, "date": date, "type": mtype, "num": num,
        "author": {"name": author, "nick": author.title()}, "hashtags": list(tags),
        "favorite_count": likes, "retweet_count": 1, "reply_count": 2,
        "view_count": views, "width": 1280, "height": 720, "duration": 12.5, "lang": "en",
    }]


class VaultCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.v = vv.Vault(self.tmp)

    def tearDown(self):
        self.v.db.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add(self, *msgs):
        for m in msgs:
            self.v.db.upsert(vv.item_from_gdl(m[1], m[2], "test"))

    def ids(self, **p):
        res = vv.search(self.v.db, self.v.store, p)
        self.assertNotIn("error", res, res.get("error"))
        return [i["id"] for i in res["items"]], res


class TestParsing(VaultCase):
    def test_item_from_gdl(self):
        it = vv.item_from_gdl(*tweet("123", "hello #world", tags=["world"])[1:], "s")
        self.assertEqual(it["id"], "x:123")
        self.assertEqual(it["url"], "https://x.com/demo_user/status/123")
        self.assertEqual(it["likes"], 10)
        self.assertEqual(it["hashtags"], "world")
        self.assertEqual(it["posted_at"], 1740830400)
        self.assertIsNone(vv.item_from_gdl(*tweet("1", "x", mtype="photo")[1:], "s"))
        self.assertEqual(vv.item_from_gdl(*tweet("9", "x", num=2)[1:], "s")["id"], "x:9_2")

    def test_item_from_ytdlp(self):
        it = vv.item_from_ytdlp({"id": "abc", "extractor_key": "Youtube", "title": "Big crash",
                                 "description": "wow #cars", "upload_date": "20240102",
                                 "uploader_id": "@chan", "like_count": 5,
                                 "webpage_url": "https://youtube.com/watch?v=abc"}, "s")
        self.assertEqual(it["id"], "youtube:abc")
        self.assertIn("Big crash", it["text"])
        self.assertIn("cars", it["hashtags"])
        self.assertEqual(it["posted_at"], 1704153600)

    def test_parse_query(self):
        terms, f, any_mode = vv.parse_query('dog "slow motion" -cat @bob #skate tag:fav OR site:x')
        self.assertTrue(any_mode)
        self.assertEqual([t["raw"] for t in terms], ["dog", "slow motion", "cat", "skate"])
        self.assertTrue(terms[2]["neg"])
        self.assertEqual(terms[3]["col"], "hashtags")
        self.assertEqual(f["author"], [(False, "bob")])
        self.assertEqual(f["tag"], [(False, "fav")])
        self.assertEqual(f["platform"], [(False, "x")])

    def test_x_search_url(self):
        url = vv.source_url({"type": "search", "value": "car crash"},
                            {"min_likes": 500, "since": "2025-01-01"})
        self.assertTrue(url.startswith("https://x.com/search?q="))
        q = urllib.parse.unquote(url)
        for part in ("car crash", "filter:videos", "min_faves:500", "since:2025-01-01"):
            self.assertIn(part, q)
        self.assertEqual(vv.source_url({"type": "user", "value": "@NASA"}, {}),
                         "https://x.com/NASA/media")


class TestSearch(VaultCase):
    def setUp(self):
        super().setUp()
        self.add(
            tweet("1", "Insane car crash on the highway", author="roadcam", likes=900),
            tweet("2", "My puppy learning to skateboard", author="petlife", likes=50,
                  tags=["skate"]),
            tweet("3", "Vehicle collision caught on dashcam", author="roadcam", likes=20),
            tweet("4", "Cat vs cucumber, hilarious", author="petlife", likes=5000),
            tweet("5", "Rocket launch from the pad", author="spacefan", likes=300,
                  date="2024-06-01 00:00:00"),
        )

    def test_plain_and_stemming(self):
        ids, _ = self.ids(q="crashes", synonyms="0", fuzzy="0")
        self.assertEqual(ids, ["x:1"])

    def test_synonyms(self):
        ids, res = self.ids(q="car", fuzzy="0")
        self.assertEqual(set(ids), {"x:1", "x:3"})     # vehicle ↔ car
        self.assertIn("vehicle", res["expansions"][0]["synonyms"])
        ids, _ = self.ids(q="car", synonyms="0", fuzzy="0")
        self.assertEqual(ids, ["x:1"])

    def test_fuzzy_typo(self):
        ids, res = self.ids(q="cucumbr", synonyms="0")
        self.assertEqual(ids, ["x:4"])
        self.assertTrue(res["expansions"][0]["fuzzy"])

    def test_exclude_author_hashtag(self):
        ids, _ = self.ids(q="car -dashcam", fuzzy="0")
        self.assertEqual(ids, ["x:1"])
        ids, _ = self.ids(q="@petlife")
        self.assertEqual(set(ids), {"x:2", "x:4"})
        ids, _ = self.ids(q="#skate")
        self.assertEqual(ids, ["x:2"])
        ids, _ = self.ids(q="-@roadcam")
        self.assertEqual(set(ids), {"x:2", "x:4", "x:5"})

    def test_any_mode(self):
        ids, _ = self.ids(q="rocket puppy", synonyms="0", fuzzy="0")
        self.assertEqual(ids, [])
        ids, _ = self.ids(q="rocket OR puppy", synonyms="0", fuzzy="0")
        self.assertEqual(set(ids), {"x:2", "x:5"})

    def test_filters_and_sorts(self):
        ids, _ = self.ids(likes_min="100", sort="likes")
        self.assertEqual(ids, ["x:4", "x:1", "x:5"])
        ids, _ = self.ids(date_to="2024-12-31")
        self.assertEqual(ids, ["x:5"])
        ids, res = self.ids(author="roadcam")
        self.assertEqual(res["total"], 2)
        self.assertEqual(res["facets"]["author"][0], {"value": "roadcam", "count": 2})

    def test_tags_and_fields(self):
        self.v.db.update("x:4", {"tags": "favs keep"})
        ids, _ = self.ids(q="tag:favs")
        self.assertEqual(ids, ["x:4"])
        ids, _ = self.ids(tag="keep")
        self.assertEqual(ids, ["x:4"])
        self.v.db.update("x:5", {"transcript": "three two one ignition"})
        ids, _ = self.ids(q="ignition")
        self.assertEqual(ids, ["x:5"])
        ids, _ = self.ids(q="ignition", fields="text")
        self.assertEqual(ids, [])
        ids, _ = self.ids(q="said:ignition")
        self.assertEqual(ids, ["x:5"])

    def test_bad_syntax_does_not_crash(self):
        _, res = self.ids(q='"unbalanced  ( ) * ^ :')
        self.assertIn("items", res)

    def test_similar(self):
        rows = vv.similar(self.v.db, self.v.store, "x:1")
        self.assertIn("x:3", [r["id"] for r in rows][:2] + ["x:3"])
        self.assertNotIn("x:1", [r["id"] for r in rows])

    def test_upsert_keeps_user_data(self):
        self.v.db.update("x:1", {"tags": "mine", "starred": 1})
        self.v.db.upsert(vv.item_from_gdl(*tweet("1", "edited text", likes=999)[1:], "again"))
        it = self.v.db.get("x:1")
        self.assertEqual((it["tags"], it["starred"], it["likes"]), ("mine", 1, 999))
        ids, _ = self.ids(q="edited", fuzzy="0")
        self.assertEqual(ids, ["x:1"])
        ids, _ = self.ids(q="highway", fuzzy="0")
        self.assertEqual(ids, [])


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg needed")
class TestPipeline(VaultCase):
    """Fake gallery-dl → real HTTP download → ffprobe/thumbnail → search → HTTP API."""

    def setUp(self):
        super().setUp()
        media = self.tmp / "srv"
        media.mkdir()
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i",
                        "testsrc=size=320x240:rate=10", "-t", "2", "-pix_fmt", "yuv420p",
                        str(media / "clip.mp4")], check=True)
        handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(  # noqa: E731
            *a, directory=str(media), **k)
        handler.log_message = lambda *a: None
        http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
        self.fileserver = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.fileserver.serve_forever, daemon=True).start()
        clip = f"http://127.0.0.1:{self.fileserver.server_port}/clip.mp4"
        lines = [tweet("101", "Skate park slam", url=clip, tags=["skate"]),
                 tweet("102", "photo only", mtype="photo", url=clip),
                 tweet("103", "Dog surfing waves", url=clip, author="surfdog")]
        stub = self.tmp / "fake_gdl.py"
        stub.write_text("import json\n" + "".join(
            f"print(json.dumps({json.dumps(m)}))\n" for m in lines)
            + "print('[twitter][info] noise line')\n")
        self.v.tools.gallery_dl = [sys.executable, str(stub)]

    def tearDown(self):
        self.fileserver.shutdown()
        super().tearDown()

    def wait(self, job):
        for _ in range(200):
            if job.state not in ("queued", "running"):
                return job
            time.sleep(0.05)
        self.fail("job did not finish: " + "\n".join(job.log_lines))

    def test_collect_download_search(self):
        job = self.wait(self.v.submit("collect", {
            "sources": [{"type": "search", "value": "skate"}], "limit": 10, "download": True}))
        self.assertEqual(job.state, "done", "\n".join(job.log_lines))
        self.assertEqual(job.stats["new"], 2)            # photo skipped
        self.assertEqual(job.stats["downloaded"], 2)
        it = self.v.db.get("x:101")
        self.assertTrue((self.v.media_dir / it["file"]).exists())
        self.assertTrue((self.v.media_dir / it["thumb_file"]).exists())
        ids = [i["id"] for i in vv.search(self.v.db, self.v.store, {"q": "skateboarding"})["items"]]
        self.assertEqual(ids, ["x:101"])                 # skate ↔ skateboarding

        # limit stops early
        job = self.wait(self.v.submit("collect", {
            "sources": [{"type": "user", "value": "x"}], "limit": 1}))
        self.assertEqual(job.stats["found"], 1)

        # HTTP API + range requests + origin guard
        vv.Handler.vault = self.v
        srv = vv.ThreadingHTTPServer(("127.0.0.1", 0), vv.Handler)
        port = srv.server_port
        vv.Handler.allowed_hosts = {f"127.0.0.1:{port}"}
        vv.Handler.allowed_origins = {f"http://127.0.0.1:{port}"}
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}"
        try:
            res = json.load(urllib.request.urlopen(base + "/api/search?q=surfing"))
            self.assertEqual([i["id"] for i in res["items"]], ["x:103"])
            req = urllib.request.Request(base + "/media/" + it["file"],
                                         headers={"Range": "bytes=0-99"})
            r = urllib.request.urlopen(req)
            self.assertEqual((r.status, len(r.read())), (206, 100))
            req = urllib.request.Request(base + "/api/bulk", method="POST",
                                         data=json.dumps({"ids": ["x:101"], "action": "tag",
                                                          "value": "best, Keep"}).encode(),
                                         headers={"Origin": "https://evil.example",
                                                  "Content-Type": "text/plain"})
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(req)
            self.assertEqual(cm.exception.code, 403)
            req.remove_header("Origin")
            urllib.request.urlopen(req)
            self.assertEqual(self.v.db.get("x:101")["tags"], "best keep")
            ui = urllib.request.urlopen(base + "/reel-vault/").read()
            self.assertIn(b"REEL//VAULT", ui)
            with self.assertRaises(urllib.error.HTTPError):
                urllib.request.urlopen(base + "/media/../vault.db")
            csv_ = urllib.request.urlopen(base + "/api/export?format=csv").read().decode()
            self.assertIn("x:103", csv_)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
