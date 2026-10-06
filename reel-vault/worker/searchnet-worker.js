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

const VERSION = "1.0";
const UA = "SearchNetWorker/1.0 (+https://github.com/)";
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
        const items = await src(q, limit);
        return json({ items });
      }
      if (p === "/resolve") {                 // best-effort direct media URL for an item link
        return json({ url: await resolveMedia(q.url) });
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
async function getJSON(u, headers) {
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json", ...(headers || {}) } });
  if (!r.ok) throw new Error(`${new URL(u).hostname} → HTTP ${r.status}`);
  return r.json();
}
async function getText(u, headers) {
  const r = await fetch(u, { headers: { "User-Agent": UA, ...(headers || {}) } });
  if (!r.ok) throw new Error(`${new URL(u).hostname} → HTTP ${r.status}`);
  return r.text();
}
const stripHtml = (s) => (s || "").replace(/<br\s*\/?>(?=)|<\/p>\s*<p[^>]*>/gi, "\n")
  .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
const toTs = (v) => { if (!v) return null; if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  const t = Date.parse(v); return isNaN(t) ? null : Math.floor(t / 1000); };
const tag = (s) => (s || "").toLowerCase().replace(/[^a-z0-9_]+/g, "");
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
      const arr = await getJSON(`https://${inst}/api/v1/timelines/tag/${encodeURIComponent(t)}?limit=40&only_media=true`);
      for (const st of arr) {
        const s = st.reblog || st;
        const acc = s.account || {};
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
      if (media === "post") return null;
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
    const d = await getJSON(`${base}?q=${encodeURIComponent(q.q || "")}&limit=${limit}&sort=relevance&type=link${sub ? "&restrict_sr=1" : ""}`);
    return ((d.data || {}).children || []).map((c) => {
      const o = c.data || {};
      const rv = ((o.secure_media || o.media || {}) || {}).reddit_video || {};
      const isVid = o.is_video || /hosted:video|rich:video/.test(o.post_hint || "") || /(v\.redd|youtu|streamable|tiktok)/.test(o.domain || "");
      const isImg = o.post_hint === "image" || imgExt.test(o.url || "");
      if (!isVid && !(isImg && q.media === "all")) return null;
      const prev = (((o.preview || {}).images || [{}])[0].source || {}).url || "";
      return item({
        id: "reddit:" + o.id, platform: "reddit", media: isVid ? "video" : "image",
        url: "https://www.reddit.com" + o.permalink,
        media_url: isVid ? null : o.url,
        author: o.author, author_name: "r/" + o.subreddit,
        text: [o.title, o.selftext].filter(Boolean).join("\n"), hashtags: tag(o.subreddit),
        posted_at: toTs(o.created_utc), duration: rv.duration, width: rv.width, height: rv.height,
        likes: o.score, replies: o.num_comments, thumbnail: prev.replace(/&amp;/g, "&") || null,
      });
    }).filter(Boolean);
  },

  // Bluesky public search (video/image posts)
  async bluesky(q, limit) {
    const d = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q.q || "")}&limit=${Math.min(limit, 100)}`);
    const out = [];
    for (const p of (d.posts || [])) {
      const embed = p.embed || {};
      const media = embed.$type && /video/.test(embed.$type) ? "video"
        : embed.images ? "image" : embed.media && embed.media.images ? "image" : "post";
      if (media === "post") continue;
      if (media === "image" && q.media && q.media !== "all") continue;
      const handle = (p.author || {}).handle;
      out.push(item({
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
      }));
    }
    return out.slice(0, limit);
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
    throw new Error("no working Invidious instance (" + (lastErr && lastErr.message) + ")");
  },

  // Any RSS/Atom feed, incl. a YouTube channel:
  //   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
  async rss(q, limit) {
    const xml = await getText(q.url);
    return parseFeed(xml, limit, q.media === "all");
  },
};

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

function parseFeed(xml, limit, allMedia) {
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
    out.push(item({
      id: vid ? "youtube:" + vid : "rss:" + hash(link || mediaUrl),
      platform: vid ? "youtube" : "rss", media,
      url: link || mediaUrl, media_url: !vid && media === "video" ? mediaUrl : null,
      author: pick(/<(?:author|dc:creator)[^>]*>(?:<name>)?([^<]+)/i),
      text: [pick(/<title[^>]*>([^<]+)/i), pick(/<(?:description|summary|media:description)[^>]*>([\s\S]*?)<\//i)].filter(Boolean).join("\n"),
      posted_at: toTs(pick(/<(?:pubDate|published|updated|dc:date)[^>]*>([^<]+)/i)),
      thumbnail: thumb || null,
    }));
  }
  return out;
}
function hash(s) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

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
  module.exports = { SOURCES, parseFeed, item, stripHtml, toTs, resolveMedia };
}
