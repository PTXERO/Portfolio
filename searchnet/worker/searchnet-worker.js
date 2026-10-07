/* ─────────────────────────────────────────────────────────────────
 *  SearchNet Worker — runs in YOUR OWN Cloudflare account.
 *
 *  It is the little engine that finds videos/posts without needing a PC:
 *  the web app (on Neocities) calls this Worker, the Worker fetches from
 *  open APIs (Mastodon, Lemmy, RSS, Bluesky, Reddit, Invidious…), and
 *  returns them in one normal shape. It stores nothing and logs nothing —
 *  there is no database here, so no one is tracked. Your library lives in
 *  your own browser (and optionally your own Supabase).
 *
 *  Deploy (two ways):
 *   • Dashboard: Cloudflare → Workers & Pages → Create → paste this file.
 *   • CLI:  npm i -g wrangler && wrangler deploy
 *
 *  Protect your quota: set a secret so only you can use your Worker —
 *   Settings → Variables → add  SEARCHNET_SECRET = <any long random string>
 *  then put the same value in the app (SOURCES → your Worker).
 *
 *  What it CANNOT do: run yt-dlp/ffmpeg. So it returns metadata and direct
 *  media links where sites expose them; it does not download+merge videos
 *  the way the optional local PC server does.
 * ───────────────────────────────────────────────────────────────── */

const VERSION = "1.8";
const UA = "SearchNetWorker/1.5 (+https://ptxero.neocities.org/searchnet/; open-source research tool)";
const INVIDIOUS = ["https://yewtu.be", "https://invidious.nerdvpn.de", "https://invidious.jing.rocks"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    // optional shared secret so strangers can't spend your Worker quota
    const secret = env && env.SEARCHNET_SECRET;
    if (secret) {
      const given = request.headers.get("X-SN-Key") || url.searchParams.get("key") || "";
      if (given !== secret) return json({ error: "bad or missing key" }, 401);
    }

    const p = url.pathname.replace(/\/+$/, "");
    const q = Object.fromEntries(url.searchParams);
    try {
      if (p === "" || p === "/health")
        return json({ ok: true, worker: "searchnet", version: VERSION,
                      sources: Object.keys(SOURCES), secured: !!secret });
      if (p === "/search") {
        const src = SOURCES[q.source];
        if (!src) return json({ error: `unknown source '${q.source}'`, sources: Object.keys(SOURCES) }, 400);
        const limit = Math.min(parseInt(q.limit || "30", 10) || 30, 100);
        // the same search from many people in ten minutes is one upstream call (GDELT, PullPush and Bing rate-limit per address)
        const cacheable = ["news", "gdelt", "web", "hn", "archive", "wikipedia", "fourchan"].includes(q.source) && typeof caches !== "undefined";
        const ckey = cacheable ? new Request("https://searchnet.cache/" + encodeURIComponent(JSON.stringify([q.source, q.q, q.qx, q.since, q.region, q.boards, limit]))) : null;
        let items = null;
        if (ckey) { try { const hit = await caches.default.match(ckey); if (hit) items = (await hit.json()).items; } catch (e) { items = null; } }
        if (!items) { items = await src(q, limit); if (ckey) { try { await caches.default.put(ckey, new Response(JSON.stringify({ items }), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" } })); } catch (e) { /* ignore */ } } }
        const since = parseInt(q.since || "0", 10) || 0;
        if (since) items = items.filter((it) => !it.posted_at || it.posted_at >= since);   // the topic's time window
        return json({ items });
      }
      if (p === "/account") {                 // an account's own recent posts (for "load more" on a profile)
        const limit = Math.min(parseInt(q.limit || "50", 10) || 50, 100);
        return json({ items: await accountPosts(q, limit) });
      }
      if (p === "/follows") {                 // who an account publicly follows (real links for the WEB)
        const limit = Math.min(parseInt(q.limit || "200", 10) || 200, 400);
        return json(await accountFollows(q, limit));
      }
      if (p === "/resolve") {                 // best-effort direct media URL for an item link
        return json({ url: await resolveMedia(q.url) });
      }
      if (p === "/article") {                  // the full text of one article (for briefs, names and scoring)
        if (!/^https?:\/\//.test(q.url || "")) return json({ error: "bad url" }, 400);
        return json(await readArticle(q.url));
      }
      if (p === "/author") {                   // an outlet's page for one of its writers: listed handles + bio
        if (!/^https?:\/\//.test(q.url || "")) return json({ error: "bad url" }, 400);
        return json(await readAuthorPage(q.url));
      }
      if (p === "/discover") {                 // a site → its feeds and search page, so it can become a source
        if (!/^https?:\/\//.test(q.url || "")) return json({ error: "bad url" }, 400);
        return json(await discoverSite(q.url));
      }
      if (p === "/fetch") {                    // CORS proxy for a page/API the browser can't reach
        if (!/^https?:\/\//.test(q.url || "")) return json({ error: "bad url" }, 400);
        const r = await fetch(q.url, { headers: { "User-Agent": UA, Accept: "*/*" } });
        const body = await r.text();
        return cors(new Response(body, { status: r.status,
          headers: { "Content-Type": r.headers.get("Content-Type") || "text/plain" } }));
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502);
    }
  },
};

// ── helpers ──────────────────────────────────────────────────────
function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, X-SN-Key");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));
}
async function fetchRetry(u, init) {           // one retry on a 5xx or a dropped connection
  let r; try { r = await fetch(u, init); } catch (e) { r = null; }
  if (!r || r.status >= 500) { await new Promise((x) => setTimeout(x, 600)); r = await fetch(u, init); }
  return r;
}
async function getJSON(u, headers) {
  const r = await fetchRetry(u, { headers: { "User-Agent": UA, Accept: "application/json", ...(headers || {}) } });
  if (!r.ok) throw new Error(`${new URL(u).hostname} → HTTP ${r.status}`);
  return r.json();
}
async function getText(u, headers) {
  const r = await fetchRetry(u, { headers: { "User-Agent": UA, ...(headers || {}) } });
  if (!r.ok) throw new Error(`${new URL(u).hostname} → HTTP ${r.status}`);
  return r.text();
}
// the same article reached by two links (utm tags, trailing slash, m. host) is one item
function canon(u) {
  try { const x = new URL(u); x.hash = ""; x.hostname = x.hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|ref_|igshid|si$|feature$)/i.test(k)) x.searchParams.delete(k);
    x.pathname = x.pathname.replace(/\/+$/, "") || "/"; return x.href.replace(/^https?:\/\//, ""); } catch (e) { return u || ""; }
}
const stripHtml = (s) => (s || "").replace(/<br\s*\/?>(?=)|<\/p>\s*<p[^>]*>/gi, "\n")
  .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
const toTs = (v) => { if (!v) return null; if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  const t = Date.parse(v); return isNaN(t) ? null : Math.floor(t / 1000); };
const tag = (s) => (s || "").toLowerCase().replace(/[^a-z0-9_]+/g, "");
const wantText = (q) => (q.media || "") === "everything";
const sinceDays = (q) => { const s = parseInt(q.since || "0", 10); return s ? Math.max(1, Math.floor((Date.now() / 1000 - s) / 86400) + 1) : 0; };
const withExtra = (q) => [q.q || "", q.qx || ""].map((s) => s.trim()).filter(Boolean).join(" ");   // 'everything' = posts, replies, comments too — not only media
const vidExt = /\.(mp4|webm|mov|m4v|mkv|gifv)(\?|$)/i;
const imgExt = /\.(jpe?g|png|gif|webp|avif)(\?|$)/i;

// ── sources: each returns an array of normalized items ───────────
const SOURCES = {
  // Mastodon / Fediverse hashtag timelines (also catches bridged Bluesky)
  async mastodon(q, limit) {
    const inst = (q.instance || "mastodon.social").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const tags = [...new Set((q.q || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      .concat((q.q || "").toLowerCase().replace(/[^a-z0-9]+/g, "")))].filter(Boolean).slice(0, 3);
    const out = [];
    for (const t of tags) {
      if (out.length >= limit) break;
      const arr = await getJSON(`https://${inst}/api/v1/timelines/tag/${encodeURIComponent(t)}?limit=40&only_media=${wantText(q) ? "false" : "true"}`);
      out.push(...mastoItems(arr, q));
    }
    return out.slice(0, limit);
  },

  // Lemmy — federated Reddit-like, lots of video/image communities
  async lemmy(q, limit) {
    const inst = (q.instance || "lemmy.world").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const d = await getJSON(`https://${inst}/api/v3/search?q=${encodeURIComponent(q.q || "")}&type_=Posts&sort=TopAll&limit=${limit}`);
    return (d.posts || []).map((row) => {
      const po = row.post || {}, c = row.creator || {}, co = row.community || {};
      const u = po.url || "";
      const media = vidExt.test(u) || /\/videos\/|v\.redd|streamable|youtu/.test(u) ? "video"
        : imgExt.test(u) ? "image" : po.thumbnail_url ? "image" : "post";
      if (media === "post" && !wantText(q)) return null;
      return item({
        id: "lemmy:" + po.id, platform: "lemmy", media,
        url: po.ap_id || u, media_url: vidExt.test(u) || imgExt.test(u) ? u : null,
        author: c.name, author_name: c.display_name, author_url: c.actor_id,
        text: [po.name, po.body].filter(Boolean).join("\n"),
        hashtags: tag(co.name), posted_at: toTs(po.published),
        likes: (row.counts || {}).score, replies: (row.counts || {}).comments,
        thumbnail: po.thumbnail_url || null,
      });
    }).filter(Boolean);
  },

  // Reddit public JSON (often works from the Worker edge even when a VPS is blocked)
  async reddit(q, limit) {
    const sub = (q.subreddit || "").replace(/^r\//, "");
    const base = sub ? `https://www.reddit.com/r/${sub}/search.json` : "https://www.reddit.com/search.json";
    try {
      const d = await getJSON(`${base}?q=${encodeURIComponent(q.q || "")}&limit=${limit}&sort=relevance&type=link${sub ? "&restrict_sr=1" : ""}`);
      return ((d.data || {}).children || []).map((c) => redditItem(c.data || {}, q)).filter(Boolean);
    } catch (e) {
      // reddit.com refuses most data-centre addresses; PullPush keeps a searchable archive (lags hours to days)
      const d = await getJSON(`https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(q.q || "")}&size=${Math.min(limit, 100)}${sub ? "&subreddit=" + encodeURIComponent(sub) : ""}`);
      return (d.data || []).map((o) => redditItem(o, q)).filter(Boolean);
    }
  },

  // Bluesky public search (video/image posts)
  async bluesky(q, limit) {
    const d = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q.q || "")}&limit=${Math.min(limit, 100)}`);
    return (d.posts || []).map((p) => bskyItem(p, q)).filter(Boolean).slice(0, limit);
  },

  // YouTube search via a public Invidious instance (best-effort; instances come and go)
  async youtube(q, limit) {
    let lastErr;
    for (const inst of (q.instance ? [q.instance] : INVIDIOUS)) {
      try {
        const d = await getJSON(`${inst}/api/v1/search?q=${encodeURIComponent(q.q || "")}&type=video`);
        return (Array.isArray(d) ? d : []).slice(0, limit).map((v) => item({
          id: "youtube:" + v.videoId, platform: "youtube", media: "video",
          url: "https://www.youtube.com/watch?v=" + v.videoId, media_url: null,
          author: v.author, author_name: v.author, author_url: "https://www.youtube.com" + (v.authorUrl || ""),
          text: v.title + (v.description ? "\n" + v.description : ""),
          posted_at: v.published || null, duration: v.lengthSeconds, views: v.viewCount,
          thumbnail: (v.videoThumbnails || []).slice(-1)[0] && (v.videoThumbnails || []).slice(-1)[0].url,
        }));
      } catch (e) { lastErr = e; }
    }
    // every Invidious instance down: read YouTube's own results page (ytInitialData), which answers data-centre addresses
    try { return (await ytResultsPage(q.q || "")).slice(0, limit); } catch (e) { lastErr = e; }
    throw new Error("no working Invidious instance and the results page failed (" + (lastErr && lastErr.message) + ")");
  },

  // Any RSS/Atom feed, incl. a YouTube channel:
  //   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
  async rss(q, limit) {
    const xml = await getText(q.url);
    return parseFeed(xml, limit, q.media === "all" || wantText(q));
  },

  // Google News: global, national and local papers, TV, wires. q.region = US, GB, AU … (default US)
  async news(q, limit) {
    const gl = (q.region || "US").toUpperCase().slice(0, 2);
    const days = sinceDays(q); const qq = withExtra(q) + (days ? (days <= 30 ? ` when:${days}d` : " after:" + new Date((+q.since) * 1000).toISOString().slice(0, 10)) : "");
    let xml;
    try { xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(qq)}&hl=en-${gl}&gl=${gl}&ceid=${gl}:en`); }
    catch (e) { xml = await getText(`https://www.bing.com/news/search?q=${encodeURIComponent(qq)}&format=rss&count=${Math.min(limit, 100)}`); }   // Google refuses most data-centre addresses; Bing News carries the same wires and papers
    return parseFeed(xml, limit, true, "news").map((it) => Object.assign(it, { id: "news:" + hash(canon(it.url)), url: "https://" + canon(it.url) }));
  },
  // GDELT: a running index of world news articles, searchable back years. Phrases go in quotes.
  async gdelt(q, limit) {
    const d = await getJSON(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(withExtra(q))}&mode=ArtList&maxrecords=${Math.min(limit, 250)}&format=json&sort=DateDesc&startdatetime=${q.since ? new Date((+q.since) * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14) : "20170101000000"}`);
    return (d.articles || []).map((a) => item({
      id: "news:" + hash(canon(a.url)), platform: "news", media: "post", url: "https://" + canon(a.url),
      author: a.domain || hostOf(a.url), author_name: a.domain || "", text: a.title || "",
      posted_at: a.seendate ? toTs(a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")) : null,
      lang: a.language || null, thumbnail: a.socialimage || null,
    }));
  },
  // The open web through Bing's RSS output: blogs, forums, school and company sites, obituaries, anything indexed.
  async web(q, limit) {
    const out = []; const seen = new Set();
    for (let first = 1; out.length < limit && first <= 151; first += 50) {   // pages of 50, up to 4 pages
      const xml = await getText(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(withExtra(q))}&count=50&first=${first}`);
      const page = parseFeed(xml, 50, true, "web"); let fresh = 0;
      for (const it of page) { const k = canon(it.url); if (seen.has(k)) continue; seen.add(k); it.id = "web:" + hash(k); it.url = "https://" + k; out.push(it); fresh++; }
      if (!fresh || page.length < 10) break;
    }
    return out.slice(0, limit);
  },
  // 4chan: desuarchive's full-text search (a, g, co, tv, …) plus the live catalogs of the boards you name
  async fourchan(q, limit) {
    const out = []; const words = (q.q || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    try {
      const d = await getJSON(`https://desuarchive.org/_/api/chan/search/?text=${encodeURIComponent(withExtra(q))}&order=desc`, { "User-Agent": "Mozilla/5.0 " + UA });
      for (const p of ((d["0"] || {}).posts || [])) {
        const board = (p.board || {}).shortname || "";
        out.push(item({ id: "4chan:" + board + ":" + p.num, platform: "4chan", media: p.media && p.media.media_link ? (vidExt.test(p.media.media_link) ? "video" : "image") : "post",
          url: `https://desuarchive.org/${board}/post/${p.num}/`, media_url: p.media && vidExt.test(p.media.media_link || "") ? p.media.media_link : null, thumbnail: p.media ? p.media.thumb_link : null,
          author: p.name || "Anonymous", text: [p.title, stripHtml(p.comment_processed || p.comment || "")].filter(Boolean).join("\n"), hashtags: "/" + board + "/", posted_at: +p.timestamp || null }));
        if (out.length >= limit) break;
      }
    } catch (e) { /* archive down: live boards below */ }
    const boards = String(q.boards || "pol,news,b,g,x,tv,v,biz,int,k").split(/[,\s]+/).filter(Boolean).slice(0, 12);
    for (const b of boards) {
      if (out.length >= limit) break;
      let pages; try { pages = await getJSON(`https://a.4cdn.org/${b}/catalog.json`); } catch (e) { continue; }
      for (const pg of pages) for (const t of (pg.threads || [])) {
        const text = stripHtml([t.sub, t.com].filter(Boolean).join("\n")); const low = text.toLowerCase();
        if (!words.length || !words.every((w) => low.includes(w))) continue;
        out.push(item({ id: "4chan:" + b + ":" + t.no, platform: "4chan", media: t.ext ? (/webm|mp4/.test(t.ext) ? "video" : "image") : "post",
          url: `https://boards.4chan.org/${b}/thread/${t.no}`, media_url: t.ext && /webm|mp4/.test(t.ext) ? `https://i.4cdn.org/${b}/${t.tim}${t.ext}` : null,
          thumbnail: t.tim ? `https://i.4cdn.org/${b}/${t.tim}s.jpg` : null, author: t.name || "Anonymous", text, hashtags: "/" + b + "/", posted_at: t.time || null, replies: t.replies || 0 }));
        if (out.length >= limit) break;
      }
    }
    return out.slice(0, limit);
  },
  // Wikipedia: article search (any language edition via q.lang)
  async wikipedia(q, limit) {
    const lang = (q.lang || "en").replace(/[^a-z-]/gi, "") || "en";
    const d = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(withExtra(q))}&format=json&srlimit=${Math.min(limit, 50)}&srprop=snippet|timestamp|wordcount`, { "Api-User-Agent": UA });
    return (((d.query || {}).search) || []).map((s) => item({
      id: "wikipedia:" + lang + ":" + s.pageid, platform: "wikipedia", media: "post", url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
      author: lang + ".wikipedia.org", text: s.title + "\n" + stripHtml(s.snippet || ""), posted_at: toTs(s.timestamp), views: s.wordcount || 0,
    }));
  },
  // Hacker News (Algolia): tech and startup discussion, free full-text search
  async hn(q, limit) {
    const d = await getJSON(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(withExtra(q))}&tags=story&hitsPerPage=${Math.min(limit, 100)}${q.since ? "&numericFilters=created_at_i>" + (+q.since) : ""}`);
    return (d.hits || []).map((h) => item({
      id: "hn:" + h.objectID, platform: "hackernews", media: "post", url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author || "", text: h.title || "", posted_at: h.created_at_i || null, likes: h.points || 0, replies: h.num_comments || 0,
    }));
  },
  // Internet Archive: books, newspapers, recordings, old sites, full-text search over its catalogue
  async archive(q, limit) {
    const d = await getJSON(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(withExtra(q))}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=date&fl[]=mediatype&fl[]=creator&rows=${Math.min(limit, 100)}&output=json`);
    return ((d.response || {}).docs || []).map((x) => item({
      id: "archive:" + x.identifier, platform: "archive", media: "post", url: `https://archive.org/details/${x.identifier}`,
      author: Array.isArray(x.creator) ? x.creator[0] : (x.creator || "archive.org"), text: [x.title, Array.isArray(x.description) ? x.description[0] : x.description].filter(Boolean).join("\n").slice(0, 1500),
      posted_at: toTs(x.date), hashtags: "",
    }));
  },

  // Any site with a search-results page: read the page itself (JSON-LD entries, result links, plain media).
  // q.url = the site's search URL with {q} where the word goes. Best effort — it is a page, not an API.
  async html(q, limit) {
    const u = (q.url || "").replace(/\{q\}/g, encodeURIComponent(q.q || "")).replace(/\{q_raw\}/g, q.q || "");
    if (!/^https?:\/\//.test(u)) throw new Error("html source needs a url with {q}");
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    const body = await r.text();
    const dom = new URL(u).hostname.replace(/^www\./, "");
    const abs = (h) => { try { return new URL(h, u).href; } catch (e) { return null; } };
    const seen = new Set(), out = [];
    const push = (o) => { if (!o.url || seen.has(o.url) || out.length >= limit * 2) return; seen.add(o.url); out.push(item(o)); };
    const LD = { VideoObject: "video", ImageObject: "image", Article: "post", NewsArticle: "post", BlogPosting: "post", SocialMediaPosting: "post", DiscussionForumPosting: "post", Product: "post" };
    for (const m of body.matchAll(/<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      let data; try { data = JSON.parse(m[1]); } catch (e) { continue; }
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const n = stack.pop(); if (!n || typeof n !== "object") continue;
        for (const k of ["itemListElement", "@graph", "mainEntity", "hasPart", "item"]) { const v = n[k]; if (Array.isArray(v)) stack.push(...v); else if (v && typeof v === "object") stack.push(v); }
        const t = Array.isArray(n["@type"]) ? n["@type"][0] : n["@type"]; if (!LD[t]) continue;
        const link = abs(n.url || (n.mainEntityOfPage && n.mainEntityOfPage["@id"])); if (!link) continue;
        const au = Array.isArray(n.author) ? n.author[0] : n.author; let th = Array.isArray(n.thumbnailUrl) ? n.thumbnailUrl[0] : (n.thumbnailUrl || (Array.isArray(n.image) ? n.image[0] : n.image)); if (th && typeof th === "object") th = th.url;
        push({ id: "web:" + dom + ":" + hash(link), platform: dom, media: LD[t], url: link, media_url: LD[t] !== "post" ? n.contentUrl || null : null,
          author: (au && (au.name || au)) || dom, author_url: (au && au.url) || "", text: [n.name || n.headline, n.description].filter(Boolean).join("\n"),
          posted_at: toTs(n.datePublished || n.uploadDate), thumbnail: typeof th === "string" ? th : null });
      }
    }
    if (out.length < limit) for (const m of body.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = stripHtml(m[2]).trim(); if (text.length < 12 || /(login|signup|register|privacy|terms|cookie|about|contact|\/tag\/|\/page\/\d|javascript:|mailto:)/i.test(m[1])) continue;
      const link = abs(m[1]); if (!link || !link.startsWith("http") || link.replace(/\/$/, "") === u.replace(/\/$/, "")) continue;
      const img = m[2].match(/<img[^>]+src=["']([^"']+)/i);
      push({ id: "web:" + dom + ":" + hash(link), platform: dom, media: "post", url: link, media_url: null, author: dom, author_url: u, text: text.slice(0, 400), thumbnail: img ? abs(img[1]) : null });
    }
    if (out.length < limit) for (const m of body.matchAll(/<(?:video|source)[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)/gi)) {
      const link = abs(m[1]); push({ id: "web:" + dom + ":" + hash(link), platform: dom, media: "video", url: u, media_url: link, author: dom, author_url: u, text: "" });
    }
    return out.slice(0, limit);
  },
};

// ── shared mappers (used by search and by /account) ──────────────
function mastoItems(statuses, q) {
  const out = [];
  for (const st of statuses || []) {
    const s = st.reblog || st;
    const acc = s.account || {};
    if (!(s.media_attachments || []).length && wantText(q)) {       // a plain post / reply: still something the account did
      out.push(item({ id: "mastodon:" + s.id, platform: "mastodon", media: "post", url: s.url || s.uri, media_url: null,
        author: acc.acct, author_name: acc.display_name, author_url: acc.url, text: stripHtml(s.content),
        hashtags: (s.tags || []).map((x) => x.name).join(" "), posted_at: toTs(s.created_at),
        likes: s.favourites_count, reposts: s.reblogs_count, replies: s.replies_count, thumbnail: null }));
      continue;
    }
    for (const m of (s.media_attachments || [])) {
      const kind = { video: "video", gifv: "video", image: "image" }[m.type] || "post";
      if (kind === "image" && q.media && q.media !== "all") continue;
      const meta = (m.meta || {}).original || {};
      out.push(item({
        id: "mastodon:" + s.id, platform: "mastodon", media: kind,
        url: s.url || s.uri, media_url: m.url || m.remote_url,
        author: acc.acct, author_name: acc.display_name, author_url: acc.url,
        text: stripHtml(s.content) + (m.description ? "\n" + m.description : ""),
        hashtags: (s.tags || []).map((x) => x.name).join(" "),
        posted_at: toTs(s.created_at), duration: meta.duration,
        width: meta.width, height: meta.height,
        likes: s.favourites_count, reposts: s.reblogs_count, replies: s.replies_count,
        thumbnail: m.preview_url,
      }));
    }
  }
  return out;
}
function bskyItem(p, q) {
  const embed = p.embed || {};
  const media = embed.$type && /video/.test(embed.$type) ? "video"
    : embed.images ? "image" : embed.media && embed.media.images ? "image" : "post";
  if (media === "post" && !wantText(q)) return null;
  if (media === "image" && q.media && q.media !== "all" && !wantText(q)) return null;
  const handle = (p.author || {}).handle;
  return item({
    id: "bluesky:" + (p.cid || p.uri), platform: "bluesky", media,
    url: `https://bsky.app/profile/${handle}/post/${(p.uri || "").split("/").pop()}`,
    media_url: embed.playlist || null,
    author: handle, author_name: (p.author || {}).displayName,
    author_url: `https://bsky.app/profile/${handle}`,
    text: (p.record || {}).text || "",
    hashtags: (((p.record || {}).facets || []).flatMap((f) => (f.features || [])
      .filter((x) => x.$type && x.$type.includes("tag")).map((x) => x.tag))).join(" "),
    posted_at: toTs((p.record || {}).createdAt),
    likes: p.likeCount, reposts: p.repostCount, replies: p.replyCount,
    thumbnail: embed.thumbnail || (embed.images && embed.images[0] && embed.images[0].thumb) || null,
  });
}
function redditItem(o, q) {
  const rv = ((o.secure_media || o.media || {}) || {}).reddit_video || {};
  const isVid = o.is_video || /hosted:video|rich:video/.test(o.post_hint || "") || /(v\.redd|youtu|streamable|tiktok)/.test(o.domain || "");
  const isImg = o.post_hint === "image" || imgExt.test(o.url || "");
  if (o.body != null && !o.title) {                                   // a comment
    if (!wantText(q)) return null;
    return item({ id: "reddit:" + o.id, platform: "reddit", media: "post", url: "https://www.reddit.com" + (o.permalink || ""), media_url: null,
      author: o.author, author_name: "r/" + o.subreddit, text: "↩ " + (o.body || ""), hashtags: tag(o.subreddit), posted_at: toTs(o.created_utc), likes: o.score, thumbnail: null });
  }
  if (!isVid && !(isImg && (q.media === "all" || wantText(q))) && !wantText(q)) return null;
  const prev = (((o.preview || {}).images || [{}])[0].source || {}).url || "";
  return item({
    id: "reddit:" + o.id, platform: "reddit", media: isVid ? "video" : isImg ? "image" : "post",
    url: "https://www.reddit.com" + o.permalink,
    media_url: isVid || !isImg ? null : o.url,
    author: o.author, author_name: "r/" + o.subreddit,
    text: [o.title, o.selftext].filter(Boolean).join("\n"), hashtags: tag(o.subreddit),
    posted_at: toTs(o.created_utc), duration: rv.duration, width: rv.width, height: rv.height,
    likes: o.score, replies: o.num_comments, thumbnail: prev.replace(/&amp;/g, "&") || null,
  });
}

// Find a fediverse account where it can actually be read. A remote account ("user@loops.video") found through
// mastodon.social may live on software without a Mastodon API (Loops, Pixelfed…), so try: the instance the
// app searched from (full acct), then the account's own host, then mastodon.social — first one that answers wins.
async function mastoLookup(handle, url, instance) {
  const [user, home] = handle.includes("@") ? handle.split("@") : [handle, null];
  const ownHost = home || (url.match(/^https?:\/\/([^/]+)/) || [])[1] || null;
  const tries = [];
  if (instance) tries.push([instance, ownHost && ownHost !== instance ? `${user}@${ownHost}` : user]);
  if (ownHost) tries.push([ownHost, user]);
  if (!instance || instance !== "mastodon.social") tries.push(["mastodon.social", ownHost ? `${user}@${ownHost}` : user]);
  let last = null;
  for (const [host, acct] of tries) {
    try {
      const acc = await getJSON(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`);
      if (acc && acc.id) return { host, acc };
    } catch (e) { last = e; }
  }
  throw new Error(`couldn't find @${handle} on ${tries.map((t) => t[0]).join(", ")}${last ? " (" + last.message + ")" : ""}`);
}

// ── /account: an account's own recent posts. q = { platform, handle, url, instance, limit, media } ──
async function accountPosts(q, limit) {
  const handle = (q.handle || "").replace(/^@/, "").trim();
  const url = q.url || "";
  const plat = (q.platform || "").toLowerCase();
  if (!handle && !url) throw new Error("handle or url required");
  if (plat === "mastodon") {
    const { host, acc } = await mastoLookup(handle, url, q.instance);
    const arr = await getJSON(`https://${host}/api/v1/accounts/${acc.id}/statuses?limit=${Math.min(limit, 40)}&only_media=${wantText(q) ? "false" : "true"}&exclude_replies=${wantText(q) ? "false" : "true"}&exclude_reblogs=true`);
    return mastoItems(arr, q).slice(0, limit);
  }
  if (plat === "bluesky") {
    const d = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${Math.min(limit, 100)}&filter=${wantText(q) ? "posts_with_replies" : "posts_with_media"}`);
    return (d.feed || []).map((f) => bskyItem(f.post || {}, q)).filter(Boolean).slice(0, limit);
  }
  if (plat === "reddit") {
    const d = await getJSON(`https://www.reddit.com/user/${encodeURIComponent(handle)}/submitted.json?limit=${Math.min(limit, 100)}&sort=new`);
    let rows = ((d.data || {}).children || []).map((c) => redditItem(c.data || {}, q)).filter(Boolean);
    if (wantText(q)) {                                                     // their comments are things they did too
      const c = await getJSON(`https://www.reddit.com/user/${encodeURIComponent(handle)}/comments.json?limit=${Math.min(limit, 100)}&sort=new`);
      rows = rows.concat(((c.data || {}).children || []).map((x) => redditItem(x.data || {}, q)).filter(Boolean));
    }
    return rows.sort((a, b) => (b.posted_at || 0) - (a.posted_at || 0)).slice(0, limit);
  }
  if (plat === "lemmy") {
    const inst = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || q.instance || "lemmy.world";
    const d = await getJSON(`https://${inst}/api/v3/user?username=${encodeURIComponent(handle)}&sort=New&limit=${Math.min(limit, 50)}`);
    return (d.posts || []).map((row) => SOURCES_lemmyRow(row)).filter(Boolean).slice(0, limit);
  }
  if (plat === "youtube") {
    // channel RSS needs the channel id; resolve a /@handle or /c/ URL by reading the page once
    let cid = (url.match(/\/channel\/(UC[\w-]+)/) || [])[1];
    if (!cid) {
      const page = await getText(url || `https://www.youtube.com/@${encodeURIComponent(handle)}`, { "Accept-Language": "en" });
      cid = (page.match(/"channelId":"(UC[\w-]+)"/) || page.match(/channel_id=(UC[\w-]+)/) || [])[1];
    }
    if (!cid) throw new Error("could not find that YouTube channel's id");
    const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`);
    return parseFeed(xml, limit, q.media === "all");
  }
  // anything else: if we were given a feed-ish URL, try it as RSS
  if (/\.(xml|rss|atom)(\?|$)|\/feed/.test(url)) return parseFeed(await getText(url), limit, q.media === "all");
  throw new Error(`loading more posts isn't supported for '${plat || "this site"}' from the Worker (the PC server can)`);
}
// ── /follows: an account's PUBLIC following list (and who follows it, where the API offers it).
//    Only platforms with an open graph API: Mastodon (unless the user hides it) and Bluesky.
//    Returns handles in the same form the app stores authors in, so they line up with the library.
async function accountFollows(q, limit) {
  const handle = (q.handle || "").replace(/^@/, "").trim();
  const url = q.url || "";
  const plat = (q.platform || "").toLowerCase();
  if (!handle && !url) throw new Error("handle or url required");
  const out = { platform: plat, follows: [], followers: [], partial: false };
  if (plat === "mastodon") {
    const { host, acc } = await mastoLookup(handle, url, q.instance);
    // acct is "name" for local accounts and "name@their.host" for remote ones; the app's author for a
    // local account is also plain "name", so both sides match without any guessing
    const row = (a) => ({ handle: a.acct, name: a.display_name || "", url: a.url || "", posts: a.statuses_count || 0 });
    const page = async (kind) => {
      const rows = []; let next = `https://${host}/api/v1/accounts/${acc.id}/${kind}?limit=80`;
      for (let i = 0; i < 5 && next && rows.length < limit; i++) {
        const r = await fetch(next, { headers: { "User-Agent": UA, Accept: "application/json" } });
        if (!r.ok) { out.partial = true; break; }             // 403 = the user hides this list; respect it
        (await r.json()).forEach((a) => rows.push(row(a)));
        next = ((r.headers.get("Link") || "").match(/<([^>]+)>;\s*rel="next"/) || [])[1] || null;
      }
      return rows.slice(0, limit);
    };
    out.follows = await page("following");
    out.followers = await page("followers");
    return out;
  }
  if (plat === "bluesky") {
    const row = (a) => ({ handle: a.handle, name: a.displayName || "", url: `https://bsky.app/profile/${a.handle}`, posts: 0 });
    const page = async (xrpc, key) => {
      const rows = []; let cursor = "";
      for (let i = 0; i < 5 && rows.length < limit; i++) {
        const d = await getJSON(`https://public.api.bsky.app/xrpc/${xrpc}?actor=${encodeURIComponent(handle)}&limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
        (d[key] || []).forEach((a) => rows.push(row(a)));
        cursor = d.cursor; if (!cursor) break;
      }
      return rows.slice(0, limit);
    };
    out.follows = await page("app.bsky.graph.getFollows", "follows");
    out.followers = await page("app.bsky.graph.getFollowers", "followers");
    return out;
  }
  throw new Error(`'${plat || "this site"}' has no public follow list the Worker can read (Mastodon and Bluesky do)`);
}
function SOURCES_lemmyRow(row) {
  const po = row.post || {}, c = row.creator || {}, co = row.community || {};
  const u = po.url || "";
  const media = vidExt.test(u) || /\/videos\/|v\.redd|streamable|youtu/.test(u) ? "video" : imgExt.test(u) ? "image" : po.thumbnail_url ? "image" : "post";
  if (media === "post") return null;
  return item({ id: "lemmy:" + po.id, platform: "lemmy", media, url: po.ap_id || u, media_url: vidExt.test(u) || imgExt.test(u) ? u : null,
    author: c.name, author_name: c.display_name, author_url: c.actor_id, text: [po.name, po.body].filter(Boolean).join("\n"),
    hashtags: tag(co.name), posted_at: toTs(po.published), likes: (row.counts || {}).score, replies: (row.counts || {}).comments, thumbnail: po.thumbnail_url || null });
}

function item(o) {
  const m = o.media || "video";
  return {
    id: o.id, platform: o.platform, post_id: String(o.id).split(":")[1] || o.id, media: m,
    url: o.url || null, media_url: o.media_url || null,
    author: (o.author || "").replace(/^@/, ""), author_name: o.author_name || "", author_url: o.author_url || "",
    text: o.text || "", hashtags: o.hashtags || "", lang: o.lang || null,
    posted_at: o.posted_at || null, duration: num(o.duration), width: num(o.width), height: num(o.height),
    likes: num(o.likes), reposts: num(o.reposts), replies: num(o.replies), views: num(o.views),
    thumbnail: o.thumbnail || null, source: o.platform,
  };
}
const num = (v) => { const n = Number(v); return isFinite(n) ? Math.round(n) : 0; };

function parseFeed(xml, limit, allMedia, brand) {
  const out = [];
  const blocks = xml.split(/<(?:item|entry)[\s>]/i).slice(1);
  for (const raw of blocks) {
    if (out.length >= limit) break;
    const b = "<x " + raw;
    const pick = (re) => { const m = b.match(re); return m ? stripHtml(m[1]) : ""; };
    const attr = (re) => { const m = b.match(re); return m ? m[1] : ""; };
    const vid = pick(/<yt:videoId>([^<]+)</);
    let link = attr(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)
      || pick(/<link>([^<]+)<\/link>/) || attr(/<link[^>]*href=["']([^"']+)/i);
    const mediaUrl = attr(/<(?:media:content|enclosure)[^>]*url=["']([^"']+)["'][^>]*>/i);
    const mtype = attr(/<(?:media:content|enclosure)[^>]*type=["']([^"']+)/i);
    let media = vid ? "video" : vidExt.test(mediaUrl) || /video/.test(mtype) ? "video"
      : imgExt.test(mediaUrl) || /image/.test(mtype) ? "image" : "post";
    if (!vid && /youtu\.?be|vimeo|tiktok|streamable/.test(link)) media = "video";
    if (media === "post" && !allMedia) continue;
    const thumb = attr(/<media:thumbnail[^>]*url=["']([^"']+)/i);
    const srcName = pick(/<source[^>]*>([^<]+)<\/source>/i);
    let title = pick(/<title[^>]*>([^<]+)/i); if (srcName && title.toLowerCase().endsWith(" - " + srcName.toLowerCase())) title = title.slice(0, -(srcName.length + 3));   // "Headline - Outlet" → "Headline"
    out.push(item({
      id: vid ? "youtube:" + vid : (brand || "rss") + ":" + hash(link || mediaUrl),
      platform: vid ? "youtube" : (brand || "rss"), media,
      url: link || mediaUrl, media_url: !vid && media === "video" ? mediaUrl : null,
      author: pick(/<(?:author|dc:creator)[^>]*>(?:<name>)?([^<]+)/i) || srcName || (brand ? hostOf(link) : ""),
      author_name: srcName || "",
      text: [title, pick(/<(?:description|summary|media:description)[^>]*>([\s\S]*?)<\//i)].filter(Boolean).join("\n"),
      posted_at: toTs(pick(/<(?:pubDate|published|updated|dc:date)[^>]*>([^<]+)/i)),
      thumbnail: thumb || null,
    }));
  }
  return out;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
function hash(s) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

// readability, small: JSON-LD articleBody → the densest run of <p> inside <article>/<main> → meta description
// ── bylines: who wrote an article, where it was filed from, what the outlet's author page lists ──
const NOT_A_NAME = /(staff|report|editor|desk|news|press|associated|reuters|bureau|team|contributor|correspondent|service|wire|agency|media|network|http|www\.|@|\d|\b(herald|times|post|tribune|gazette|journal|daily|sun|star|chronicle|observer|courier|dispatch|register|sentinel|ledger|review|today|weekly|globe|examiner|mirror|telegraph|guardian|independent|standard|record|inquirer|bulletin|cbs|nbc|abc|fox|cnn|bbc|npr|tv|radio|fm|com|org)\b)/i;
function parseByline(raw) {
  if (Array.isArray(raw)) { const out = []; for (const x of raw) out.push(...parseByline(typeof x === "string" ? x : (x && x.name) || "")); return [...new Set(out)].slice(0, 4); }
  let s = stripHtml(String(raw || "")).trim().replace(/^\s*(by|from|written by|story by|reporting by)\b[:\s]*/i, "").replace(/\s*[|•·]\s*.*$/, "");
  const out = [];
  for (let part of s.split(/\s*(?:,|;|&| and | with )\s*/)) {
    part = part.replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, ""); const words = part.split(" ");
    if (words.length < 2 || words.length > 4 || NOT_A_NAME.test(part)) continue;
    if (!words.every((w) => /^[A-Za-zÀ-ÿ'’.-]+$/.test(w)) || !words.some((w) => /^[A-Z]/.test(w))) continue;
    if (part === part.toUpperCase()) part = part.toLowerCase().replace(/(^|[\s'-])\S/g, (c) => c.toUpperCase());
    if (!out.includes(part)) out.push(part);
  }
  return out.slice(0, 4);
}
const DATELINE = /^\s*([A-Z][A-Z .'’-]{2,28}?)(?:,\s*([A-Z][A-Za-z.]{1,14}))?\s*(?:\([A-Z]{2,8}\))?\s*(?:—|–|--|-)\s+(?=[A-Z"“])/;
function parseDateline(text) {
  for (const line of String(text || "").split("\n").slice(0, 3)) {
    const m = line.trim().match(DATELINE); if (!m) continue;
    const city = m[1].trim(); const n = city.split(/\s+/).length; if (!((n >= 2 && n <= 3) || city.length >= 4)) continue;
    return (city.toLowerCase().replace(/(^|[\s'-])\S/g, (c) => c.toUpperCase()) + (m[2] ? ", " + m[2] : "")).slice(0, 40);
  }
  return "";
}
const SOCIAL_END = "/?(?=[\"'?#\\s<]|$)";
const SOCIAL = [["x", "https?://(?:www\\.)?(?:twitter|x)\\.com/([A-Za-z0-9_]{2,15})" + SOCIAL_END], ["bluesky", "https?://bsky\\.app/profile/([A-Za-z0-9.-]+?)" + SOCIAL_END], ["mastodon", "https?://([a-z0-9.-]+)/@([A-Za-z0-9_]+)" + SOCIAL_END],
  ["instagram", "https?://(?:www\\.)?instagram\\.com/([A-Za-z0-9_.]{2,30})" + SOCIAL_END], ["threads", "https?://(?:www\\.)?threads\\.net/@([A-Za-z0-9_.]{2,30})" + SOCIAL_END], ["youtube", "https?://(?:www\\.)?youtube\\.com/@([A-Za-z0-9_.-]{2,40})" + SOCIAL_END]];
const SOCIAL_SKIP = new Set(["share", "intent", "home", "login", "search", "hashtag", "i", "explore", "privacy", "settings"]);
// an outlet's own page for one of its writers: the handles it lists and the bio it prints. Nothing is looked up anywhere else.
async function readAuthorPage(u) {
  const out = { url: u, name: "", bio: "", handles: [] };
  let html; try { html = (await getText(u, { "Accept-Language": "en" })).slice(0, 800000); } catch (e) { out.error = e.message; return out; }
  const scope = html.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, " ");
  out.name = stripHtml((scope.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ""])[1]).slice(0, 80);
  const m = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/i); out.bio = m ? stripHtml(m[1]).slice(0, 400) : "";
  if (!out.bio) for (const pm of scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) { const t = stripHtml(pm[1]).trim(); if (t.length > 60 && t.length < 600 && !/cookie|subscribe|newsletter|sign up/i.test(t)) { out.bio = t.slice(0, 400); break; } }
  const seen = new Set();
  for (const [plat, rx] of SOCIAL) for (const mm of html.matchAll(new RegExp(rx, "g"))) {
    const handle = plat === "mastodon" ? mm[2] + "@" + mm[1] : mm[1];
    if (plat === "mastodon" && !/rel=["'][^"']*\bme\b/i.test(html.slice(Math.max(0, mm.index - 200), mm.index))) continue;   // only a declared rel=me mastodon link counts
    if (SOCIAL_SKIP.has(handle.toLowerCase()) || seen.has(plat + handle.toLowerCase()) || out.handles.length >= 8) continue;
    seen.add(plat + handle.toLowerCase()); out.handles.push({ platform: plat, handle, url: mm[0].replace(/\/$/, "") });
  }
  return out;
}

async function readArticle(u) {
  const out = { url: u, canonical: null, title: "", text: "", published: null, author: "", byline: [], author_url: "", dateline: "" };
  let html; try { html = (await getText(u, { "Accept-Language": "en" })).slice(0, 1500000); } catch (e) { out.error = e.message; return out; }
  const meta = (p) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, "i")); return m ? stripHtml(m[1]) : ""; };
  const can = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i) || [])[1] || meta("og:url"); if (can) { try { out.canonical = new URL(can, u).href; } catch (e) { /* ignore */ } }
  out.title = meta("og:title") || stripHtml((html.match(/<title[^>]*>([^<]*)/i) || [, ""])[1]);
  out.published = toTs(meta("article:published_time") || meta("datePublished") || meta("date") || (html.match(/<time[^>]+datetime=["']([^"']+)/i) || [])[1]);
  out.author = meta("author") || meta("article:author") || "";
  for (const m of html.matchAll(/<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let d; try { d = JSON.parse(m[1]); } catch (e) { continue; }
    const stack = Array.isArray(d) ? [...d] : [d];
    while (stack.length) { const n = stack.pop(); if (!n || typeof n !== "object") continue; if (Array.isArray(n["@graph"])) stack.push(...n["@graph"]); if (typeof n.articleBody === "string" && n.articleBody.length > 200) { out.text = stripHtml(n.articleBody); if (!out.published) out.published = toTs(n.datePublished); const aus = Array.isArray(n.author) ? n.author : n.author ? [n.author] : []; out.byline = parseByline(aus.map((x) => (x && typeof x === "object") ? x.name : x)); for (const x of aus) if (x && typeof x === "object" && typeof x.url === "string" && !out.author_url) { try { out.author_url = new URL(x.url, u).href; } catch (e) { /* ignore */ } } if (!out.author && aus[0]) out.author = (typeof aus[0] === "object" ? aus[0].name : aus[0]) || ""; break; } }
    if (out.text) break;
  }
  if (!out.text) {
    const scope = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0].replace(/<(script|style|nav|aside|footer|header|form)[\s\S]*?<\/\1>/gi, " ");
    const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripHtml(m[1]).trim()).filter((t) => t.length > 40 && !/cookie|subscribe|sign up|newsletter|all rights reserved/i.test(t));
    out.text = paras.join("\n");
  }
  if (!out.text) out.text = meta("og:description") || meta("description");
  out.text = out.text.replace(/\s+\n/g, "\n").slice(0, 6000);
  // the byline: JSON-LD first (above), then meta author, then the page's own byline / rel=author link
  if (!out.byline.length) out.byline = parseByline(out.author);
  if (!out.byline.length) { const bm = html.match(/<[^>]+class=["'][^"']*\b(?:byline|author-name|author__name|c-byline|story-byline)[^"']*["'][^>]*>([\s\S]{0,400}?)<\//i); if (bm) out.byline = parseByline(bm[1]); }
  const am = html.match(/<a[^>]+rel=["']author["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/i) || html.match(/<a[^>]+href=["']([^"']+)["'][^>]+rel=["']author["'][^>]*>([\s\S]{0,120}?)<\/a>/i);
  if (am) { if (!out.author_url) { try { out.author_url = new URL(am[1], u).href; } catch (e) { /* ignore */ } } if (!out.byline.length) out.byline = parseByline(am[2]); }
  if (!out.author && out.byline.length) out.author = out.byline[0];
  out.dateline = parseDateline(out.text);
  return out;
}

// YouTube search without an API: the results page embeds ytInitialData with every videoRenderer
async function ytResultsPage(query) {
  const html = await getText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`, { Cookie: "CONSENT=YES+1; SOCS=CAI", "Accept-Language": "en" });
  const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/); if (!m) throw new Error("youtube: no ytInitialData");
  const data = JSON.parse(m[1]); const out = [], seen = new Set(); const stack = [data];
  const txt = (o) => !o ? "" : o.simpleText || (o.runs || []).map((r) => r.text).join("") || "";
  const dur = (s) => { const p = String(s || "").split(":").map(Number); return p.length ? p.reduce((a, b) => a * 60 + b, 0) : null; };
  const views = (s) => { const n = String(s || "").replace(/[^0-9.KMB]/gi, ""); const k = /K/i.test(n) ? 1e3 : /M/i.test(n) ? 1e6 : /B/i.test(n) ? 1e9 : 1; return Math.round(parseFloat(n) * k) || 0; };
  while (stack.length && out.length < 60) {
    const n = stack.pop(); if (!n || typeof n !== "object") continue;
    if (n.videoRenderer && n.videoRenderer.videoId) { const v = n.videoRenderer; if (seen.has(v.videoId)) continue; seen.add(v.videoId);
      out.push(item({ id: "youtube:" + v.videoId, platform: "youtube", media: "video", url: "https://www.youtube.com/watch?v=" + v.videoId, author: txt(v.ownerText) || txt(v.shortBylineText), author_name: txt(v.ownerText),
        author_url: "https://www.youtube.com" + ((((v.ownerText || {}).runs || [])[0] || {}).navigationEndpoint || {}).browseEndpoint?.canonicalBaseUrl || "", text: txt(v.title) + ((v.detailedMetadataSnippets || [])[0] ? "\n" + txt(v.detailedMetadataSnippets[0].snippetText) : ""),
        posted_at: null, duration: dur(txt(v.lengthText)), views: views(txt(v.viewCountText)), thumbnail: (((v.thumbnail || {}).thumbnails || []).slice(-1)[0] || {}).url || null }));
      continue; }
    for (const k in n) { const v = n[k]; if (v && typeof v === "object") stack.push(v); }
  }
  return out;
}

async function discoverSite(u) {
  const origin = new URL(u).origin; const out = { url: u, host: hostOf(u), feeds: [], search: null, candidates: [], platform: "" };
  let html = ""; try { html = (await getText(origin + "/", { "Accept-Language": "en" })).slice(0, 600000); } catch (e) { out.error = e.message; }
  const abs = (h) => { try { return new URL(h, origin).href; } catch (e) { return null; } };
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const t = m[0]; if (!/application\/(?:rss|atom)\+xml/i.test(t)) continue;
    const href = (t.match(/href=["']([^"']+)/i) || [])[1]; const title = (t.match(/title=["']([^"']+)/i) || [])[1] || "";
    if (href && out.feeds.length < 6) out.feeds.push({ url: abs(href), title: stripHtml(title) });
  }
  if (!out.feeds.length) {
    for (const path of ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/?feed=rss2", "/feeds/posts/default", "/index.xml"]) {
      try { const r = await fetch(origin + path, { headers: { "User-Agent": UA }, redirect: "follow" }); const ct = r.headers.get("Content-Type") || "";
        if (r.ok && /xml|rss|atom/i.test(ct)) { out.feeds.push({ url: r.url, title: "" }); break; } } catch (e) { /* next */ }
    }
  }
  const cands = [];
  // 1. OpenSearch description (the standard way a site declares its search)
  const os = html.match(/<link[^>]+type=["']application\/opensearchdescription\+xml["'][^>]+>/i);
  if (os) { const href = (os[0].match(/href=["']([^"']+)/i) || [])[1]; if (href) { try { const xml = await getText(abs(href)); const tpl = (xml.match(/<Url[^>]+type=["']text\/html["'][^>]+template=["']([^"']+)/i) || xml.match(/<Url[^>]+template=["']([^"']+)["'][^>]+type=["']text\/html["']/i) || [])[1]; if (tpl) cands.push({ tpl: abs(tpl.replace(/\{searchTerms\}/g, "{q}").replace(/&amp;/g, "&")), why: "OpenSearch" }); } catch (e) { /* ignore */ } } }
  // 2. the platform behind the site
  const fp = [[/wp-content|wp-includes|wp-json/i, "wordpress", "/?s={q}"], [/discourse|data-discourse/i, "discourse", "/search?q={q}"], [/mediawiki|wgCanonicalNamespace|\/wiki\/Special:/i, "mediawiki", "/index.php?search={q}"],
    [/Shopify\.theme|cdn\.shopify/i, "shopify", "/search?q={q}"], [/xenforo|XF\.config/i, "xenforo", "/search/search?keywords={q}"], [/vbulletin/i, "vbulletin", "/search.php?do=process&query={q}"], [/ghost-url|content\/images\/|ghost\.io/i, "ghost", ""],
    [/squarespace/i, "squarespace", "/search?q={q}"], [/wix\.com|wixstatic/i, "wix", ""], [/invision|ipsSettings/i, "invision", "/search/?q={q}"], [/phpbb/i, "phpbb", "/search.php?keywords={q}"], [/substack/i, "substack", "/search/{q}"]];
  for (const [re, name, tpl] of fp) if (re.test(html)) { out.platform = name; if (tpl) cands.push({ tpl: origin + tpl, why: name }); break; }
  // 3. a search form, any field name
  for (const f of html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/gi)) {
    const open = f[0].match(/<form[^>]*>/i)[0]; const inner = f[1];
    const inp = inner.match(/<input[^>]+(?:type=["']search["']|name=["'](?:q|s|search|query|keyword|keywords|term|text|k|wd|search_query|searchterm|search_term|p)["'])[^>]*>/i) || (/search/i.test(open + inner) ? inner.match(/<input[^>]+name=["']([^"']+)["'][^>]*>/i) : null);
    if (!inp) continue;
    const name = (inp[0].match(/name=["']([^"']+)/i) || [])[1]; if (!name) continue;
    if (/get|^\s*$/i.test((open.match(/method=["']([^"']+)/i) || [, "get"])[1]) === false) continue;
    const action = (open.match(/action=["']([^"']*)/i) || [])[1] || "/";
    const a = abs(action) || origin + "/"; cands.push({ tpl: a + (a.includes("?") ? "&" : "?") + name + "={q}", why: "search form" });
  }
  // 4. the usual suspects
  for (const tpl of ["/search?q={q}", "/?s={q}", "/search/{q}", "/search?query={q}", "/?q={q}", "/search?s={q}", "/results?search_query={q}"]) cands.push({ tpl: origin + tpl, why: "common pattern" });
  // verify: the page must come back 200 and mention the word we searched for (not just a 404 in disguise)
  const seen = new Set(); const probe = "news";
  for (const c of cands) {
    if (!c.tpl || seen.has(c.tpl) || out.candidates.length >= 6) continue; seen.add(c.tpl);
    let okc = false;
    try { const r = await fetch(c.tpl.replace(/\{q\}/g, probe), { headers: { "User-Agent": UA, "Accept-Language": "en" }, redirect: "follow" });
      if (r.ok) { const body = (await r.text()).slice(0, 300000); const links = (body.match(/<a\s/gi) || []).length; okc = links >= 5 && new RegExp(probe, "i").test(stripHtml(body)) && !/404|not found/i.test((body.match(/<title[^>]*>([^<]*)/i) || [, ""])[1]); } } catch (e) { okc = false; }
    out.candidates.push({ template: c.tpl, why: c.why, verified: okc });
    if (okc && !out.search) out.search = c.tpl;
  }
  if (!out.search) out.search_guess = (out.candidates[0] || {}).template || origin + "/?s={q}";
  return out;
}

async function resolveMedia(u) {
  if (!u) return null;
  if (vidExt.test(u) || imgExt.test(u)) return u;
  // oEmbed / og:video sniff for a direct file
  try {
    const html = await getText(u);
    const og = html.match(/<meta[^>]+property=["'](?:og:video:url|og:video:secure_url|og:video)["'][^>]+content=["']([^"']+)/i);
    if (og) return og[1].replace(/&amp;/g, "&");
  } catch (e) { /* ignore */ }
  return null;
}

// Node test shim (so this file can be unit-tested outside Cloudflare)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SOURCES, parseFeed, item, stripHtml, toTs, resolveMedia, discoverSite };
}
