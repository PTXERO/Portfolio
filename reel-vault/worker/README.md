# SearchNet Worker

A tiny scraper that runs in **your own** Cloudflare account, so the web app can
find videos/posts **without a PC and without anyone tracking you**. It holds no
database and keeps no logs — your library lives in your browser (and optionally
your own Supabase).

## Deploy (pick one)

**Dashboard (no install):** the illustrated step-by-step lives at
<https://ptxero.neocities.org/reel-vault/worker/> (this folder's `index.html`). In short:
dash.cloudflare.com → Compute (Workers) → Workers & Pages → Create → *Start with Hello
World!* → name it `searchnet` → Deploy → *Edit code* → select all, paste
`searchnet-worker.js` → Deploy. Your address is `https://searchnet.<yourname>.workers.dev`.

**CLI:** `npm i -g wrangler && wrangler login && wrangler deploy`

## Protect your quota (recommended)

So strangers can't spend your Worker's free requests, set a secret:

- Dashboard → your Worker → Settings → Variables and Secrets → add
  `SEARCHNET_SECRET` = a long random string, **or**
- `wrangler secret put SEARCHNET_SECRET`

Put the same value in the app under **SOURCES → your Worker** (sent as the
`X-SN-Key` header). Without a secret the Worker is open to anyone who knows its URL.

## What it can and can't do

It fetches from open APIs and returns everything in one shape:

| source | needs | notes |
|---|---|---|
| `mastodon` | `instance` (e.g. mastodon.social) | hashtag timelines; also bridged Bluesky |
| `lemmy` | `instance` (e.g. lemmy.world) | federated Reddit-like |
| `reddit` | – | works from the Worker edge; `subreddit` optional |
| `bluesky` | – | public post search |
| `youtube` | – | via public Invidious instances (best-effort) |
| `rss` | `url` | any RSS/Atom, incl. `youtube.com/feeds/videos.xml?channel_id=UC…` |

It **cannot** run yt-dlp or ffmpeg, so it returns metadata and direct media
links where sites expose them — not downloaded/merged video files. For the full
"download anything" experience, run the optional local PC server instead
(`reel-vault/server/reelvault.py`). You can use both.

## API

`GET /health` · `GET /search?source=<s>&q=<query>&limit=30[&instance=…][&media=all]`
· `GET /resolve?url=…` (best-effort direct media URL) · `GET /fetch?url=…` (CORS proxy).
All responses include permissive CORS headers so the hosted app can call it.

## Updating your Worker

The app and the Worker evolve together. When the app gains a feature that needs the
Worker (the `/account` endpoint behind **LOAD MORE POSTS** on a profile arrived in
Worker 1.1; `/follows` behind **LOAD FOLLOWS** and the white "real link" lines in the
WEB, plus remote-account lookup for LOAD MORE, arrived in Worker 1.2), redeploy: paste the new `searchnet-worker.js` over the old one in the
Cloudflare dashboard, or run `wrangler deploy` again. `GET /health` shows the version
your Worker is running.
