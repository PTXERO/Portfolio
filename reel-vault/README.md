# SEARCH//NET

A self-learning video finder for the social web, built to be used from an iPhone.
Type a topic and it searches every source you've added (X, YouTube, Mastodon/Fediverse,
Reddit, Bluesky, Tumblr, Instagram, any site or feed). Then you 👍 / 👎 what it finds.
Every vote teaches it what you mean, and it rewrites its own searches to find more of it.

```
iPhone (Firefox) ──Wi-Fi──▶ your computer: python reel-vault/server/reelvault.py
                               ├─ sources ── gallery-dl · yt-dlp · Mastodon API · Reddit · RSS · any URL
                               ├─ library ── SQLite full-text index + optional semantic vectors
                               ├─ learning ─ per-topic classifier + taste profile + query bandit
                               └─ files ──── downloads, thumbnails, speech + on-screen text
```

## Run it

On a computer that stays on, run **one command**. It does everything:

1. installs Python, or updates it if you have it
2. installs Git and ffmpeg if they're missing
3. downloads SEARCH//NET to `~/Portfolio`, or updates your copy
4. installs / updates the Python packages (yt-dlp, gallery-dl, fastembed)
5. starts the auto-updating launcher

**Windows** — paste into PowerShell (no admin window needed):

```powershell
irm https://raw.githubusercontent.com/PTXERO/Portfolio/claude/new-session-7sf9nm/reel-vault/start.ps1 | iex
```

After the first time, just **double-click `reel-vault\start.cmd`**.

**Mac / Linux** — paste into Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/PTXERO/Portfolio/claude/new-session-7sf9nm/reel-vault/start.sh | bash
```

After the first time: `bash ~/Portfolio/reel-vault/start.sh`. (Mac needs [Homebrew](https://brew.sh);
on Mac/Linux the packages go in a private `reel-vault/.venv`, so nothing touches your system Python.)

Run the same command again whenever you like: it updates Python, the project and the packages
(yt-dlp in particular needs frequent updates as sites change), then starts.

Options:

| | |
|---|---|
| `REELVAULT_DIR` | where the project lives (default `~/Portfolio`) |
| `REELVAULT_BRANCH` | branch to follow (default: this build's branch; `main` once merged) |
| `REELVAULT_NO_SYSTEM_UPDATE=1` | skip the Python / Git / ffmpeg update check |
| anything after the script | passed to the server, e.g. `start.sh --port 9000` |

Optional extras, if you want them: `pip install faster-whisper` (search what is said) and
tesseract from your package manager (on-screen text).

**While it runs** it keeps the server up, checks GitHub for new commits on a loop, and pulls +
restarts when there are updates — your phone reconnects on its own. Prefer doing it by hand?
`python reel-vault/server/run.py` is the launcher on its own (`--interval 30` changes how often it
checks, `--no-update` stops it pulling, other options such as `--port`, `--phone-host`, `--data`
go to the server).

It prints two links. The computer opens SETUP, which shows a **QR code**. Scan it with
the iPhone (same Wi-Fi) and open it in Firefox. The link carries an access key that pairs
the phone; other devices on your Wi-Fi can't use it without the key. In Firefox, use
⋯ → Share → **Add to Home Screen** to get an app icon.

**On a VPN (e.g. Mullvad):** turn on the VPN app's *Local network sharing* so your phone can
reach the PC. If the printed phone link shows a VPN address (10.64.x.x and up) instead of your Wi-Fi
address (usually 192.168.x.x), start with `--phone-host 192.168.x.x`. Run `ipconfig` to find
your Wi-Fi adapter's IPv4 address.

### Remote access from another network — safely

The server is **private by design**: it only accepts connections from your own LAN and your own
VPN, and refuses the public internet (and tunnels) unless you pass `--expose`. So don't port-forward
or expose it with a public Cloudflare/ngrok tunnel. To reach it from anywhere, put your phone and PC
on the same **private mesh VPN** — [Tailscale](https://tailscale.com) is the easy choice:

1. Install Tailscale on the PC and the iPhone, sign in to both with the same account.
2. The PC gets a private address like `100.x.y.z` that only your own devices can reach.
3. For a real HTTPS address (no browser "not secure"), run `tailscale serve --bg 8765` on the PC —
   it gives `https://<pc-name>.<tailnet>.ts.net`, reachable only inside your tailnet.
4. On the phone open that address (or the `100.x.y.z:8765` one) with `?key=YOUR_KEY` once to pair.

Nothing is published to the internet; the traffic is end-to-end encrypted by the VPN. The access key
is still required, and pairing attempts are rate-limited.

Options: `--port 8765`, `--data PATH` (database and videos; default `reel-vault/data/`, git-ignored),
`--host 127.0.0.1` (this computer only), `--allow-origin https://you.neocities.org` (lets a
copy of the page hosted elsewhere talk to the server running on the same computer), `--no-browser`.

**Logins:** X, Instagram and some other sites only work when logged in. In SETUP, pick the
browser on the computer where you're logged in, or point to an exported `cookies.txt`.
A source can also have its own cookies. Use a spare account: heavy scraping can get
accounts limited and is against those sites' terms. Keep it personal.

## Browser mode (no computer, nothing tracked)

Don't want to leave a computer running? Open the page and choose
**CONNECT → 📱 Use this browser only**. Everything then runs on the device you're
holding:

- Your whole library lives in the browser (IndexedDB) — no server, no account, nothing
  sent anywhere.
- Collecting runs through **your own** [Cloudflare Worker](worker/README.md) (free tier is
  plenty). Deploy it once, paste its URL in SOURCES, and it fetches from Mastodon, Lemmy,
  Reddit, Bluesky, YouTube and any RSS/channel feed at the edge.
- The same self-learning topics, 👍/👎 training, soft/anti keywords, 👎-reasons and review
  deck work here — the relevance engine is ported to run in the page.
- To go back to the PC server later, SETUP → **Use a computer instead**. Your browser
  library stays saved.

What browser mode can't do (these need the PC server): downloading videos to disk, speech
transcription, on-screen-text OCR, semantic meaning-matching, and sites that require a
login (X, Instagram). It plays videos straight from their source URL instead of proxying
them.

## The web — accounts and how they connect

**WEB** turns the accounts you've collected into a map for finding related
creators. For each account it summarises, from their **public posts only**:
what they post about (topics, hashtags, distinctive words), their media mix,
how often and when they post, and typical engagement. The spiderweb links
accounts that share content — shared hashtags, shared vocabulary, or
mentions — and the more they share, the stronger (and thicker) the link, so
you can hop from one creator to related ones. Tap a node for the profile;
tap a connected account to jump to theirs; **▦ THEIR POSTS** opens everything
of theirs in your library.

This is built for **content discovery, not surveillance of people**, and it's
deliberately limited:

- Only accounts **you** collected, only from their own public posts, all on
  your device.
- It **never guesses** who someone is or any sensitive trait (sexuality,
  politics, religion, health, identity). Any label on a profile is one **you**
  typed, kept locally, and shown as your own note — it just helps shape your
  searches.
- **No cross-platform de-anonymising.** Each account is profiled on its own;
  "same person" is only ever a link you add by hand.

(Available in browser mode today; coming to the PC server.)

## Start fresh (wipe)

Erase the whole library — every collected video, topic, vote and download — and start over:

- In the app: **SETUP → Danger zone → Wipe everything** (optionally keep your ★ starred videos).
- On the computer: `python reel-vault/server/reelvault.py --wipe` (asks you to type WIPE; add `--yes` to skip).

Your pairing, settings and word groups are kept, so the phone stays connected.

## How it gets smart

**Topics.** Each topic has starting words, a breadth (focused … everything), the media to
collect, the sources to use, and optional auto-refresh (hourly … daily).

**Search expansion.** Each run grows the topic's searches from several signals. Every search
shows where it came from in 🧠 BRAIN:

| origin | from |
|---|---|
| seed / user | what you typed |
| morph | word forms: plural/singular, joined words, `#hashtag` form |
| synonym | your similar-word groups (SETUP) |
| web | related and associated words (Datamuse). Only the strongest, or those your results actually use, start switched on |
| cooccur | hashtags and words over-represented in what you liked compared with the whole library |
| learned | the model's strongest positive features |
| author | creators you keep liking (and FOLLOW turns them into a source) |

Every search keeps its own 👍 / 👎 record. A UCB bandit picks which searches to run next:
precise ones get priority, untried ones get explored. Auto searches that keep bringing 👎
switch themselves off, but searches you switch on or off yourself stay as you set them.

**Relevance.** Every item gets a feature vector: stemmed words, word pairs, hashtags,
creator, site, the searches that found it, media type and length. Words are weighted by
rarity (IDF) instead of a stopword list, so nothing is filtered out and common words simply
count less. Per topic it combines:
- a match score against the topic's searches, before any votes
- a liked-minus-disliked profile (Rocchio), which works from one vote
- a logistic-regression classifier, once there are 2 👍 and 2 👎
- with fastembed, meaning: closeness to your liked items in embedding space

The more you vote, the more the learned part outweighs plain matching. Retraining runs
in the background shortly after each vote. Every 5 votes it also rethinks its searches.

**Review order (active learning).** The REVIEW deck mixes its best guesses with the
items it's least sure about, because those teach it the most.

**More like this** ranks by meaning first, then shared distinctive words, hashtags,
creator, and items you liked together. ✦ MORE LIKE THIS turns an item into new searches
for a topic.

## Sources

SOURCES → type a domain, profile link or feed and it detects how to use it:
1. Built-in support (X, YouTube, Mastodon, Reddit, Bluesky, Tumblr, Instagram, Pinterest,
   Imgur, DeviantArt, Bilibili, NicoNico).
2. The site's own search URL from its OpenSearch description.
3. RSS/Atom feeds linked on the page.
4. Whether gallery-dl or yt-dlp understands its search, tag or profile URLs.
5. Mastodon servers (via `/api/v1/instance`).

You can also add a custom URL template with `{q}` (search words) or `{tag}` (hashtag form).
TEST runs a source once and shows the log. "Searches" sources take topic queries; "follows"
sources (profiles, channels, feeds) are pulled each run and scored against your topics.

Adding a new kind of source in code is one function in `server/rv/sources.py` that yields
item dicts, registered in `ADAPTERS`.

## Library

Search everything collected with stemming, similar words, typo tolerance, partial words,
🧠 meaning, and field filters (caption, hashtags, 🗣 speech, 👁 on-screen text, author).
Query syntax: `"phrase"`, `-exclude`, `OR`, `@user`, `#tag`, `tag:x`, `site:x`, `said:x`, `screen:x`.
Filters cover topic, type, saved, shape, dates, length, likes, views, sites, hashtags, tags
and authors. Select items to tag, star, save, analyze, export, delete, or 👍-teach a topic.

## Files

- `index.html`: the whole UI (mobile-first, safe-area aware, works offline in DEMO mode)
- `reelvault.config.js`, `manifest.webmanifest`, `icon-*.png`, `demo-data.js`
- `server/reelvault.py`: entry point
- `server/rv/`:
  - `web.py`: HTTP, auth, API
  - `vault.py`: jobs, topics, downloads
  - `sources.py`: adapters, presets, detection
  - `learn.py`: features and models
  - `expand.py`: query growth
  - `embed.py`: semantic matching
  - `related.py`: more like this
  - `search.py`: library search
  - `db.py`: storage
- `server/test_reelvault.py`: tests. Run `python -m unittest discover reel-vault/server`.

YouTube sometimes asks servers to "confirm you're not a bot". From a home connection it
normally works; if not, set browser cookies in SETUP.
