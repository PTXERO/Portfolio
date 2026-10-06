# REEL//VAULT

Find, sort, filter and save videos from X/Twitter and ~1000 other sites, with a
search engine that looks at captions, hashtags, **similar words**, **typos**, **what
is said** in the video and **text shown on screen**.

```
browser UI (reel-vault/index.html)  ⇄  local server (server/reelvault.py)
                                          ├─ gallery-dl  → finds videos on X (search, accounts, likes, bookmarks, lists)
                                          ├─ yt-dlp      → links from YouTube, TikTok, Reddit, Instagram, …
                                          ├─ SQLite FTS5 → full-text index, stemming, ranking
                                          ├─ ffmpeg      → thumbnails, frames
                                          ├─ faster-whisper (optional) → speech → text
                                          └─ tesseract  (optional) → on-screen text
```

The page also works without the server (e.g. on GitHub Pages): it switches to
**DEMO** mode with a fictional sample library so the search and filters can be tried.

## Run it

```bash
pip install -U yt-dlp gallery-dl          # required
pip install faster-whisper                # optional: search speech
# optional: install ffmpeg + tesseract with your package manager

python reel-vault/server/reelvault.py     # opens http://127.0.0.1:8765/reel-vault/
```

Options: `--port 8765`, `--data PATH` (where the database and videos go; default
`reel-vault/data/`, git-ignored), `--allow-origin https://you.github.io` (allow another
site to use the API), `--no-browser`.

### Logging in to X

X needs a logged-in session for search, timelines, likes and bookmarks. In **SETUP**
either give a path to a `cookies.txt` exported from your browser, or pick a browser to
read cookies from. If a collect job finds nothing, its log shows the reason
(e.g. `AuthRequired`).

Use a secondary account if you can. Heavy scraping can get an account rate-limited, and
it is against X's terms of service. Keep collections for personal use.

## Using it

**COLLECT**
- *Mass search*: one X search per line. You can use X syntax (`"phrase"`, `OR`, `-word`,
  `from:user`, `#tag`). Each line can be widened with your similar-word groups
  automatically (`car crash` → `(car OR auto OR vehicle…) (crash OR wreck OR collision…)`).
- Filters: min likes, min reposts, since/until, language, latest/top, skip replies.
- Accounts (their media or their likes), your bookmarks, and any links.
- Can download right away and then analyze speech and on-screen text.

**LIBRARY**

| Query | Meaning |
|---|---|
| `car crash` | both words (stemmed: crash = crashes = crashing) |
| `car OR bike` | either word (or toggle ALL/ANY WORDS) |
| `"slow motion"` | exact phrase |
| `-dashcam` | exclude |
| `@roadcam`, `-@roadcam` | author / not author |
| `#storm` | hashtag (or your own tag) |
| `tag:keep` | your tags |
| `site:youtube` | platform |
| `said:liftoff` | only in the speech transcript |
| `screen:warning` | only in on-screen text |

- **≈ SIMILAR WORDS** expands each word with your word groups (edit them in SETUP).
- **~ TYPOS** matches close spellings that exist in your library (`cucumbr` → cucumber).
- **\* PARTIAL** matches word beginnings (`skate` → skateboarding).
- **IN** buttons limit where to look: caption, hashtags, author, speech, on-screen text, tags.
- The sidebar filters by date, length, likes, views, downloaded or not, analyzed, shape
  (wide, tall, square), platform, hashtags, your tags and authors. Each list shows counts
  for the current results.
- Sort by best match, newest, likes, views, reposts, engagement, length, etc.
- Click a video to play it, edit tags and notes, and jump to the moment a word is spoken.
  It also shows **more like this**.
- Shift- or ctrl-click to select several videos, then tag, star, download, analyze,
  export or delete them in bulk.
- Export the current results (or the selection) as JSON, CSV or a list of URLs.
- Save searches (stored in your browser). The URL keeps the full search, so you can
  bookmark it.

Keys: `/` search · `esc` close · `← →` previous/next · `s` star · `d` download.

## Files

- `index.html`: the whole UI
- `reelvault.config.js`: API address, page size, default collect options
- `demo-data.js`: fictional sample library for DEMO mode
- `server/reelvault.py`: the server (Python standard library only)
- `server/synonyms.json`: the default similar-word groups (your edits are saved to the data dir)
- `server/test_reelvault.py`: tests. Run `python -m unittest discover reel-vault/server`.
