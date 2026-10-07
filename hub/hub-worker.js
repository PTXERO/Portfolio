/* ─────────────────────────────────────────────────────────────────
 *  PTXERO HUB — one Worker for the whole site, in YOUR OWN Cloudflare account.
 *
 *  It is the "home server" every PTXERO app can talk to:
 *   • SearchNet fetching  (/search /account /follows /resolve /fetch) — compute only, nothing stored
 *   • Social + ASCII share (/share /delete /profile /post /like /comment /follow /repost /presence
 *     /notifications /report, og cards /r/ /p/) — rows + files in YOUR Supabase project
 *   • Per-person store     (/store/<app>/<key>) — small JSON blobs per identity per app (backups, settings)
 *   • Identity             (/id) — an anonymous PTXERO ID proves itself with a keypair; nobody can post as you
 *   • Your data            (/me  GET usage · GET /me/export everything · DELETE /me erase everything)
 *   • Fair use             per-identity daily limits (the owner is exempt) and a cron that deletes
 *                          identities unused for RETENTION_DAYS, so keeping data here is always optional.
 *
 *  DEPLOY: Cloudflare → Workers & Pages → Create → Hello World → Edit code → paste this file → Deploy.
 *  SECRETS (Settings → Variables and Secrets):
 *    SERVICE_KEY     your Supabase service_role / sb_secret key  (required for anything that stores)
 *    SUPABASE_URL    https://<project>.supabase.co                (required when you store; defaults to PTXERO's)
 *    ADMIN_UID       your own 4-char PTXERO id (e.g. CB6C) — exempt from limits, moderation rights
 *  OPTIONAL: BUCKET (renders) · ALLOWED_ORIGINS (comma list) · RETENTION_DAYS (180) · LIMITS (json)
 *            SEARCHNET_SECRET (legacy shared key for a private fetch-only hub)
 *  CRON: Triggers → Cron Triggers → add "0 4 * * *" (daily retention + usage pruning).
 *  SQL: run hub-setup.sql once in Supabase → SQL Editor.
 *
 *  Contains no secret — safe to sit on the public site as reference.
 * ───────────────────────────────────────────────────────────────── */

const HUB_VERSION = "2.0";
const SN_VERSION = "1.5";
const UA = "SearchNetWorker/1.5 (+https://ptxero.neocities.org/searchnet/; open-source research tool)";
const INVIDIOUS = ["https://yewtu.be", "https://invidious.nerdvpn.de", "https://invidious.jing.rocks"];
const DEFAULT_SUPABASE = 'https://tfquiunqquuctgkpmiba.supabase.co';
const DEFAULT_ALLOWED = ['https://ptxero.neocities.org'];
const VIEW_BASE = 'https://ptxero.neocities.org/ascii-render/view.html';
const RF_PROXY  = 'https://rf-proxy.ptxero.workers.dev';
const DEFAULT_LIMITS = { fetch: 400, writes: 300, store_bytes: 25 * 1024 * 1024, blob_bytes: 512 * 1024, anon_fetch: 60 };
let SUPABASE = DEFAULT_SUPABASE, BUCKET = 'renders', ALLOWED = DEFAULT_ALLOWED, LIMITS = DEFAULT_LIMITS;

const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED.includes('*') || ALLOWED.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')
    || SN_PATHS.has(new URL(request.url).pathname.replace(/\/+$/, '') || '/');   // compute-only routes: any site may use them
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-PX-Uid, X-PX-Pub, X-PX-Ts, X-PX-Nonce, X-PX-Sig, X-SN-Key',
    'Access-Control-Max-Age': '86400',
  };
}
const ogJson = (data, status, request) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
});

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// stable suffix of a handle (prefix-SUFFIX) — the immutable ownership id
const sfxOf = (s) => String(s || '').split('-').pop();

// ── notification helpers (best-effort; never block the primary action) ──
async function ownerOf(svc, slug) {
  // a slug may be a render slug or a text-post id — check both content tables
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/renders?slug=eq.${encodeURIComponent(slug)}&select=handle`, { headers: svc });
    if (r.ok) { const row = (await r.json())[0]; if (row) return sfxOf(row.handle); }
  } catch (e) {}
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/posts?id=eq.${encodeURIComponent(slug)}&select=handle`, { headers: svc });
    if (r.ok) { const row = (await r.json())[0]; if (row) return sfxOf(row.handle); }
  } catch (e) {}
  return null;
}
async function insertNotif(svc, recipient, actor, type, slug) {
  if (!recipient || !actor || recipient === actor) return;   // no self-notifications
  try {
    await fetch(`${SUPABASE}/rest/v1/notifications`, {
      method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ recipient, actor, type, slug: slug || null }),
    });
  } catch (e) {}
}
async function deleteNotif(svc, recipient, actor, type, slug) {
  if (!recipient || !actor) return;
  try {
    let q = `${SUPABASE}/rest/v1/notifications?recipient=eq.${encodeURIComponent(recipient)}&actor=eq.${encodeURIComponent(actor)}&type=eq.${encodeURIComponent(type)}`;
    if (slug) q += `&slug=eq.${encodeURIComponent(slug)}`;
    await fetch(q, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
  } catch (e) {}
}

// Lightweight reachability probe — a service that answers at all (even 401/404)
// is "up"; only a connection failure / 5xx / timeout counts as down.
async function probe(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { headers: headers || {}, signal: ctrl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch (e) {
    clearTimeout(t);
    return false;
  }
}


// ── PTXERO ID: an anonymous identity that can prove itself ───────────────────────────────────
//  Headers on a signed request:  X-PX-Uid (4-char id) · X-PX-Pub (base64url SPKI, ECDSA P-256)
//  X-PX-Ts (unix seconds) · X-PX-Nonce · X-PX-Sig (base64url, over "uid\nts\nnonce\nMETHOD\npath").
//  The first signed request binds the key to the profile (TOFU; an existing legacy profile must also
//  present its legacy secret once). From then on only that key may act as that id. Replays are bounded
//  by a 5-minute window and a per-isolate nonce cache.
const b64u = {
  dec(s) { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; },
};
const seenNonces = new Map();
async function who(request) {
  const h = (k) => request.headers.get(k) || '';
  const uid = h('X-PX-Uid').replace(/[^A-Za-z0-9]/g, '').slice(0, 16), pub = h('X-PX-Pub'), ts = +h('X-PX-Ts'), nonce = h('X-PX-Nonce'), sig = h('X-PX-Sig');
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const out = { uid: null, pub: null, verified: false, ip, key: 'ip:' + ip };
  if (!uid || !pub || !ts || !sig) return out;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return out;
  const nk = uid + ':' + nonce; if (nonce && seenNonces.has(nk)) return out;
  try {
    const key = await crypto.subtle.importKey('spki', b64u.dec(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const u = new URL(request.url);
    const msg = new TextEncoder().encode([uid, ts, nonce, request.method.toUpperCase(), u.pathname].join('\n'));
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u.dec(sig), msg);
    if (!ok) return out;
  } catch (e) { return out; }
  if (nonce) { seenNonces.set(nk, Date.now()); if (seenNonces.size > 5000) { const cut = Date.now() - 600000; for (const [k, t] of seenNonces) if (t < cut) seenNonces.delete(k); } }
  return { uid, pub, verified: true, ip, key: 'uid:' + uid };
}
// Does this request own `uid`?  prof = the profiles row (may be null), sh = sha256 of the legacy secret (or '').
async function okIdentity(svc, uid, prof, sh, px) {
  if (px && px.verified) {
    if (px.uid !== uid) return false;
    if (prof && prof.pubkey) return prof.pubkey === px.pub;                   // bound: only the key counts
    if (prof && prof.secret_hash && prof.secret_hash !== sh) return false;    // legacy profile: prove the old secret once
    await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, pubkey: px.pub, updated_at: new Date().toISOString() }) });
    await fetch(`${SUPABASE}/rest/v1/hub_users`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, pubkey: px.pub, last_seen: new Date().toISOString() }) }).catch(() => {});
    boundCache.set(uid, { pub: px.pub, t: Date.now() });
    return true;
  }
  if (prof && prof.pubkey) return false;                                      // a key is bound: no legacy writes
  if (!prof || !prof.secret_hash) return !!sh;                                // brand-new legacy identity (TOFU)
  return prof.secret_hash === sh;
}
// Is this signed request really the id it names?  A valid signature only proves "I hold *a* key" — this
// checks it is *the* key bound to that profile (binding it on first use). Cached per isolate for 5 minutes.
const boundCache = new Map();
async function ownsId(svc, px) {
  if (!px || !px.verified) return false;
  if (!svc.apikey) return true;                                               // fetch-only hub: nothing to bind to
  const c = boundCache.get(px.uid); if (c && Date.now() - c.t < 300000) return c.pub === px.pub;
  let prof = null;
  try { const r = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(px.uid)}&select=uid,secret_hash,pubkey`, { headers: svc }); if (r.ok) prof = (await r.json())[0] || null; } catch (e) { return false; }
  if (prof && !prof.pubkey && prof.secret_hash) return false;                 // legacy id: must migrate with its secret first (POST /id)
  const ok = await okIdentity(svc, px.uid, prof, '', px);
  if (ok) boundCache.set(px.uid, { pub: px.pub, t: Date.now() });
  return ok;
}

// ── fair use: per identity (or per IP when anonymous) per UTC day; the owner is exempt ───────────
function limits(env) { try { return Object.assign({}, DEFAULT_LIMITS, env && env.LIMITS ? JSON.parse(env.LIMITS) : {}); } catch (e) { return DEFAULT_LIMITS; } }
async function touch(svc, key, calls, writes, bytes) {
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/rpc/hub_touch`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_k: key, p_calls: calls, p_writes: writes, p_bytes: bytes }) });
    if (!r.ok) return null; const rows = await r.json(); return rows[0] || null;
  } catch (e) { return null; }
}
function resetsAt() { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); }
// scope: 'fetch' (SearchNet compute) | 'write' (anything that stores) | 'read' (free)
async function quota(env, svc, px, scope, bytes) {
  const L = limits(env); const admin = (env && env.ADMIN_UID) || '';
  if (scope === 'read') return null;
  if (px.verified && admin && px.uid === admin) return null;
  if (!svc.apikey) return null;                                               // fetch-only hub: no DB, no limits
  if (!px.verified && scope === 'write') return { status: 401, body: { error: 'sign in with your PTXERO ID to store anything here' } };
  if (px.verified && !(await ownsId(svc, px))) {
    if (scope === 'write') return { status: 401, body: { error: 'this id belongs to another key', hint: 'POST /id with the original device, or pick a new identity' } };
    px = { uid: null, pub: null, verified: false, ip: px.ip, key: 'ip:' + px.ip };
  }
  const u = await touch(svc, px.key, 1, scope === 'write' ? 1 : 0, bytes || 0);
  if (!u) return null;
  const cap = scope === 'fetch' ? (px.verified ? L.fetch : L.anon_fetch) : L.writes;
  const used = scope === 'fetch' ? u.calls : u.writes;
  if (used > cap) return { status: 429, body: { error: 'quota', scope, used, limit: cap, resets_at: resetsAt(), hint: px.verified ? 'Daily fair-use limit on the shared hub. Run your own hub (free) to lift it — see the /hub/ guide.' : 'Anonymous limit. A PTXERO ID (free, no account) gets more; your own hub has no limits.' }, retry: Math.max(60, Math.round((new Date(resetsAt()) - Date.now()) / 1000)) };
  if (px.verified) fetch(`${SUPABASE}/rest/v1/hub_users`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid: px.uid, pubkey: px.pub, last_seen: new Date().toISOString() }) }).catch(() => {});
  return null;
}

// ── erase everything an identity left here (DELETE /me, and the retention cron) ─────────────
async function purgeUser(svc, uid) {
  const del = (path) => fetch(`${SUPABASE}/rest/v1/${path}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
  const sdel = (path) => fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: svc });
  const e = encodeURIComponent(uid);
  let renders = [];
  try { const r = await fetch(`${SUPABASE}/rest/v1/renders?select=slug,handle,has_source&limit=1000`, { headers: svc }); if (r.ok) renders = (await r.json()).filter((x) => sfxOf(x.handle) === uid); } catch (err) {}
  for (const r of renders) { await sdel(`${r.slug}/output.png`); if (r.has_source) await sdel(`${r.slug}/source.jpg`); await sdel(`${r.slug}/output.webm`); await del(`renders?slug=eq.${encodeURIComponent(r.slug)}`); await del(`likes?slug=eq.${encodeURIComponent(r.slug)}`); await del(`comments?slug=eq.${encodeURIComponent(r.slug)}`); }
  let posts = [];
  try { const r = await fetch(`${SUPABASE}/rest/v1/posts?uid=eq.${e}&select=id`, { headers: svc }); if (r.ok) posts = await r.json(); } catch (err) {}
  for (const p of posts) { await sdel(`stations/${p.id}.png`); await sdel(`audio/${p.id}.wav`); await del(`likes?slug=eq.${encodeURIComponent(p.id)}`); await del(`comments?slug=eq.${encodeURIComponent(p.id)}`); await del(`notifications?slug=eq.${encodeURIComponent(p.id)}`); }
  await del(`posts?uid=eq.${e}`); await del(`likes?uid=eq.${e}`); await del(`comments?uid=eq.${e}`); await del(`reposts?uid=eq.${e}`);
  await del(`follows?follower=eq.${e}`); await del(`follows?followee=eq.${e}`); await del(`notifications?recipient=eq.${e}`); await del(`notifications?actor=eq.${e}`);
  await del(`presence?uid=eq.${e}`); await del(`reports?reporter=eq.${e}`); await del(`hub_blobs?uid=eq.${e}`);
  await sdel(`avatars/${e}.jpg`); await sdel(`banners/${e}.jpg`);
  await del(`profiles?uid=eq.${e}`); await del(`hub_users?uid=eq.${e}`);
  return { renders: renders.length, posts: posts.length };
}

// ── SearchNet fetchers (verbatim from the standalone SearchNet Worker) ───────────────────────
// ── helpers ──────────────────────────────────────────────────────
function snCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, X-SN-Key");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function snJson(obj, status = 200) {
  return snCors(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));
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
    throw new Error("no working Invidious instance (" + (lastErr && lastErr.message) + ")");
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
    return parseFeed(xml, limit, true, "news").map((it) => Object.assign(it, { id: "news:" + hash(canon(it.url)) }));
  },
  // GDELT: a running index of world news articles, searchable back years. Phrases go in quotes.
  async gdelt(q, limit) {
    const d = await getJSON(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(withExtra(q))}&mode=ArtList&maxrecords=${Math.min(limit, 250)}&format=json&sort=DateDesc&startdatetime=${q.since ? new Date((+q.since) * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14) : "20170101000000"}`);
    return (d.articles || []).map((a) => item({
      id: "news:" + hash(canon(a.url)), platform: "news", media: "post", url: a.url,
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
      for (const it of page) { const k = canon(it.url); if (seen.has(k)) continue; seen.add(k); it.id = "web:" + hash(k); out.push(it); fresh++; }
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
      posted_at: toTs(x.date), hashtags: x.mediatype ? String(x.mediatype) : "",
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
    out.push(item({
      id: vid ? "youtube:" + vid : (brand || "rss") + ":" + hash(link || mediaUrl),
      platform: vid ? "youtube" : (brand || "rss"), media,
      url: link || mediaUrl, media_url: !vid && media === "video" ? mediaUrl : null,
      author: pick(/<(?:author|dc:creator)[^>]*>(?:<name>)?([^<]+)/i) || srcName || (brand ? hostOf(link) : ""),
      author_name: srcName || "",
      text: [pick(/<title[^>]*>([^<]+)/i), pick(/<(?:description|summary|media:description)[^>]*>([\s\S]*?)<\//i)].filter(Boolean).join("\n"),
      posted_at: toTs(pick(/<(?:pubDate|published|updated|dc:date)[^>]*>([^<]+)/i)),
      thumbnail: thumb || null,
    }));
  }
  return out;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
function hash(s) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

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


async function searchnetRoutes(request, env, url, q) {
  if (env && env.SEARCHNET_SECRET) {   // legacy: a private fetch-only hub keyed by a shared secret
    const given = request.headers.get("X-SN-Key") || url.searchParams.get("key") || "";
    if (given !== env.SEARCHNET_SECRET) return snJson({ error: "bad or missing key" }, 401);
  }
  try {
    const p = url.pathname.replace(/\/+$/, "");
    const q = Object.fromEntries(url.searchParams);
      if (p === "" || p === "/health")
        return snJson({ ok: true, worker: "searchnet", version: SN_VERSION, hub: HUB_VERSION,
                      sources: Object.keys(SOURCES), secured: !!(env && env.SEARCHNET_SECRET) });
      if (p === "/search") {
        const src = SOURCES[q.source];
        if (!src) return snJson({ error: `unknown source '${q.source}'`, sources: Object.keys(SOURCES) }, 400);
        const limit = Math.min(parseInt(q.limit || "30", 10) || 30, 100);
        let items = await src(q, limit);
        const since = parseInt(q.since || "0", 10) || 0;
        if (since) items = items.filter((it) => !it.posted_at || it.posted_at >= since);   // the topic's time window
        return snJson({ items });
      }
      if (p === "/account") {                 // an account's own recent posts (for "load more" on a profile)
        const limit = Math.min(parseInt(q.limit || "50", 10) || 50, 100);
        return snJson({ items: await accountPosts(q, limit) });
      }
      if (p === "/follows") {                 // who an account publicly follows (real links for the WEB)
        const limit = Math.min(parseInt(q.limit || "200", 10) || 200, 400);
        return snJson(await accountFollows(q, limit));
      }
      if (p === "/resolve") {                 // best-effort direct media URL for an item link
        return snJson({ url: await resolveMedia(q.url) });
      }
      if (p === "/discover") {                 // a site → its feeds and search page, so it can become a source
        if (!/^https?:\/\//.test(q.url || "")) return snJson({ error: "bad url" }, 400);
        return snJson(await discoverSite(q.url));
      }
      if (p === "/fetch") {                    // CORS proxy for a page/API the browser can't reach
        if (!/^https?:\/\//.test(q.url || "")) return snJson({ error: "bad url" }, 400);
        const r = await fetch(q.url, { headers: { "User-Agent": UA, Accept: "*/*" } });
        const body = await r.text();
        return snCors(new Response(body, { status: r.status,
          headers: { "Content-Type": r.headers.get("Content-Type") || "text/plain" } }));
      }

    return null;
  } catch (e) {
    return snJson({ error: String(e && e.message || e) }, 502);
  }
}
const SN_PATHS = new Set(['/search', '/account', '/follows', '/resolve', '/fetch', '/discover', '/health']);

export default {
  async scheduled(event, env) {
    const KEY = (env && env.SERVICE_KEY) || ''; if (!KEY) return;
    SUPABASE = (env && env.SUPABASE_URL) || DEFAULT_SUPABASE; BUCKET = (env && env.BUCKET) || 'renders';
    const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    const days = Math.max(7, parseInt((env && env.RETENTION_DAYS) || '180', 10) || 180);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const admin = (env && env.ADMIN_UID) || '';
    try {
      const r = await fetch(`${SUPABASE}/rest/v1/hub_users?last_seen=lt.${encodeURIComponent(cutoff)}&pinned=eq.false&select=uid&limit=200`, { headers: svc });
      if (r.ok) for (const u of await r.json()) { if (u.uid && u.uid !== admin) await purgeUser(svc, u.uid); }
      await fetch(`${SUPABASE}/rest/v1/rpc/hub_prune_usage`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' }, body: '{}' });
    } catch (e) {}
  },

  async fetch(request, env) {
    SUPABASE = (env && env.SUPABASE_URL) || DEFAULT_SUPABASE; BUCKET = (env && env.BUCKET) || 'renders';
    ALLOWED = (env && env.ALLOWED_ORIGINS) ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ALLOWED;
    LIMITS = limits(env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const KEY = (env && env.SERVICE_KEY) || '';
    const ADMIN = (env && env.ADMIN_UID) || '';   // the owner's suffix (e.g. CB6C) — grants moderation
    const svc = KEY ? { apikey: KEY, Authorization: 'Bearer ' + KEY } : {};
    const px = await who(request);
    const q = Object.fromEntries(url.searchParams);
    const deny = (d) => { const r = ogJson(d.body, d.status, request); if (d.retry) r.headers.set('Retry-After', String(d.retry)); return r; };

    // ── SearchNet: compute only (quota scope 'fetch'; / and /health are free) ──
    if (path === '/' || SN_PATHS.has(path)) {
      if (path !== '/' && path !== '/health') { const d = await quota(env, svc, px, 'fetch', 0); if (d) return deny(d); }
      const r = await searchnetRoutes(request, env, url, q);
      if (r) return r;
    }

    // ── identity: register / bind the key behind an id ──
    if (path === '/id' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'this hub stores nothing (no SERVICE_KEY)' }, 400, request);
      if (!px.verified) return ogJson({ error: 'signed request required' }, 401, request);
      let legacy = ''; try { const b = await request.json(); legacy = b && b.secret ? await sha256hex(String(b.secret)) : ''; } catch (e) {}
      const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(px.uid)}&select=uid,secret_hash,pubkey`, { headers: svc });
      const prof = pr.ok ? (await pr.json())[0] : null;
      if (prof && prof.pubkey && prof.pubkey !== px.pub) return ogJson({ error: 'taken', hint: 'this id belongs to another key — pick a new identity' }, 409, request);
      if (prof && !prof.pubkey && prof.secret_hash && prof.secret_hash !== legacy) return ogJson({ error: 'legacy', hint: 'this id was made before keys existed; its original device must bind the key' }, 409, request);
      if (!(await okIdentity(svc, px.uid, prof, legacy, px))) return ogJson({ error: 'not authorized' }, 403, request);
      await fetch(`${SUPABASE}/rest/v1/hub_users`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid: px.uid, pubkey: px.pub, last_seen: new Date().toISOString() }) });
      boundCache.set(px.uid, { pub: px.pub, t: Date.now() });
      return ogJson({ ok: true, uid: px.uid, status: prof && prof.pubkey ? 'ok' : 'bound' }, 200, request);
    }

    // ── your data: usage · export · erase ──
    if (path === '/me' || path === '/me/export') {
      if (!KEY) return ogJson({ error: 'this hub stores nothing (no SERVICE_KEY)' }, 400, request);
      if (!px.verified) return ogJson({ error: 'signed request required' }, 401, request);
      if (!(await ownsId(svc, px))) return ogJson({ error: 'this id belongs to another key' }, 401, request);
      const e = encodeURIComponent(px.uid);
      const get = async (p) => { try { const r = await fetch(`${SUPABASE}/rest/v1/${p}`, { headers: svc }); return r.ok ? await r.json() : []; } catch (err) { return []; } };
      if (request.method === 'DELETE') { const n = await purgeUser(svc, px.uid); boundCache.delete(px.uid); return ogJson({ ok: true, erased: n }, 200, request); }
      if (path === '/me/export') {
        const [profile, posts, likes, comments, follows, reposts, blobs, renders] = await Promise.all([
          get(`profiles?uid=eq.${e}&select=uid,prefix,bio,theme,featured,updated_at`), get(`posts?uid=eq.${e}&select=*`), get(`likes?uid=eq.${e}&select=*`),
          get(`comments?uid=eq.${e}&select=*`), get(`follows?or=(follower.eq.${e},followee.eq.${e})&select=*`), get(`reposts?uid=eq.${e}&select=*`),
          get(`hub_blobs?uid=eq.${e}&select=app,key,data,bytes,updated_at`), get(`renders?select=*&limit=1000`)]);
        return ogJson({ exported_at: new Date().toISOString(), uid: px.uid, profile: profile[0] || null, posts, likes, comments, follows, reposts, blobs, renders: renders.filter((r) => sfxOf(r.handle) === px.uid) }, 200, request);
      }
      const today = (await touch(svc, px.key, 0, 0, 0)) || { calls: 0, writes: 0, bytes: 0 };
      const [users, blobs] = await Promise.all([get(`hub_users?uid=eq.${e}&select=created_at,last_seen,bytes,pinned`), get(`hub_blobs?uid=eq.${e}&select=app,key,bytes,updated_at`)]);
      const bytes = blobs.reduce((s, b) => s + (b.bytes || 0), 0);
      const L = limits(env); const owner = !!ADMIN && px.uid === ADMIN;
      return ogJson({ uid: px.uid, owner, since: users[0] ? users[0].created_at : null, last_seen: users[0] ? users[0].last_seen : null, pinned: !!(users[0] && users[0].pinned),
        today: { fetch: today.calls, writes: today.writes }, limits: owner ? null : { fetch: L.fetch, writes: L.writes, store_bytes: L.store_bytes },
        store: { bytes, blobs: blobs.length, by_app: blobs.reduce((m, b) => (m[b.app] = (m[b.app] || 0) + (b.bytes || 0), m), {}) },
        retention_days: Math.max(7, parseInt((env && env.RETENTION_DAYS) || '180', 10) || 180), resets_at: resetsAt() }, 200, request);
    }

    // ── per-person store: /store/<app>/<key> (GET · PUT json · DELETE) and /store/<app> (list) ──
    const sm = path.match(/^\/store\/([a-z0-9_-]{1,24})(?:\/([A-Za-z0-9_.:-]{1,120}))?$/);
    if (sm) {
      if (!KEY) return ogJson({ error: 'this hub stores nothing (no SERVICE_KEY)' }, 400, request);
      if (!px.verified) return ogJson({ error: 'signed request required' }, 401, request);
      if (!(await ownsId(svc, px))) return ogJson({ error: 'this id belongs to another key' }, 401, request);
      const [app, key] = [sm[1], sm[2]]; const e = encodeURIComponent(px.uid);
      if (request.method === 'GET' && !key) {
        const r = await fetch(`${SUPABASE}/rest/v1/hub_blobs?uid=eq.${e}&app=eq.${encodeURIComponent(app)}&select=key,bytes,updated_at&order=updated_at.desc`, { headers: svc });
        return ogJson({ app, items: r.ok ? await r.json() : [] }, 200, request);
      }
      if (!key) return ogJson({ error: 'key required' }, 400, request);
      if (request.method === 'GET') {
        const r = await fetch(`${SUPABASE}/rest/v1/hub_blobs?uid=eq.${e}&app=eq.${encodeURIComponent(app)}&key=eq.${encodeURIComponent(key)}&select=data,bytes,updated_at`, { headers: svc });
        const row = r.ok ? (await r.json())[0] : null;
        return row ? ogJson({ app, key, data: row.data, bytes: row.bytes, updated_at: row.updated_at }, 200, request) : ogJson({ error: 'not found' }, 404, request);
      }
      if (request.method === 'DELETE') {
        await fetch(`${SUPABASE}/rest/v1/hub_blobs?uid=eq.${e}&app=eq.${encodeURIComponent(app)}&key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
        return ogJson({ ok: true }, 200, request);
      }
      if (request.method === 'PUT' || request.method === 'POST') {
        const text = await request.text(); const bytes = new TextEncoder().encode(text).length;
        if (bytes > LIMITS.blob_bytes) return ogJson({ error: 'too large', limit: LIMITS.blob_bytes }, 413, request);
        let data; try { data = JSON.parse(text); } catch (err) { return ogJson({ error: 'body must be JSON' }, 400, request); }
        const d = await quota(env, svc, px, 'write', bytes); if (d) return deny(d);
        const owner = !!ADMIN && px.uid === ADMIN;
        if (!owner) {
          const r = await fetch(`${SUPABASE}/rest/v1/hub_blobs?uid=eq.${e}&select=key,app,bytes`, { headers: svc });
          const rows = r.ok ? await r.json() : []; const other = rows.filter((x) => !(x.app === app && x.key === key)).reduce((s, x) => s + (x.bytes || 0), 0);
          if (other + bytes > LIMITS.store_bytes) return ogJson({ error: 'storage full', used: other, limit: LIMITS.store_bytes, hint: 'Delete something, or run your own hub.' }, 507, request);
        }
        const up = await fetch(`${SUPABASE}/rest/v1/hub_blobs`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid: px.uid, app, key, data, bytes, updated_at: new Date().toISOString() }) });
        if (!up.ok) return ogJson({ error: 'store ' + up.status + ' ' + await up.text() }, 502, request);
        return ogJson({ ok: true, app, key, bytes }, 200, request);
      }
    }

    // ── everything that stores on behalf of someone counts against their daily writes ──
    if (request.method === 'POST' && !['/status', '/presence'].includes(path)) { const d = await quota(env, svc, px, 'write', 0); if (d && d.status === 429) return deny(d); }

    // ── Service status (edge-cached ~30 min; the homepage reads this) ──
    if (url.pathname === '/status' && request.method === 'GET') {
      const cache = caches.default;
      const cacheKey = new Request('https://status.ptxero.internal/ascii-rf', { method: 'GET' });
      const hit = await cache.match(cacheKey);
      if (hit) return hit; // already carries Content-Type + CORS + Cache-Control

      const svc = KEY ? { apikey: KEY, Authorization: 'Bearer ' + KEY } : {};
      const [supaOk, rfOk] = await Promise.all([
        probe(`${SUPABASE}/rest/v1/renders?select=slug&limit=1`, svc), // detects a paused project
        probe(`${RF_PROXY}/`, {}),
      ]);

      const projects = {
        'ascii-render': supaOk
          ? { status: 'live', note: '' }
          : { status: 'partial', note: 'Sharing & remix temporarily offline — the editor works fully.' },
        'rf': (rfOk && supaOk)
          ? { status: 'live', note: '' }
          : { status: 'partial', note:
                (!rfOk && !supaOk) ? 'Radio & multiplayer temporarily offline.'
              : (!rfOk)            ? 'Radio streaming temporarily offline.'
              :                       'Multiplayer & presets temporarily offline.' },
      };

      const resp = new Response(JSON.stringify({
        checkedISO: new Date().toISOString(),
        services: { supabase: supaOk, rfProxy: rfOk },
        projects,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=1800', // 30-min edge cache = periodic checks, not per-load
          'Access-Control-Allow-Origin': '*',       // public, non-credentialed status data
        },
      });
      await cache.put(cacheKey, resp.clone());
      return resp;
    }

    // ── Upload proxy ────────────────────────────────────────────
    if (url.pathname === '/share' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form     = await request.formData();
        const output   = form.get('output');   // Blob (required)
        const source   = form.get('source');    // Blob (optional)
        const video    = form.get('video');     // Blob (optional — animated WebM)
        const media    = (form.get('media') || 'image').toString().slice(0, 12);
        const settings = form.get('settings') || '{}';
        const title    = (form.get('title')  || 'render').toString().slice(0, 120);
        const description = (form.get('description') || '').toString().slice(0, 300);
        const handle   = (form.get('handle') || 'anon').toString().slice(0, 32);
        const delToken = (form.get('del_token') || '').toString();
        const allowRemix = (form.get('allow_remix') || '').toString() === 'true';
        const slug     = (form.get('slug')   || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7))).toString();
        if (!/^[A-Za-z0-9_-]+$/.test(slug)) return ogJson({ error: 'bad slug' }, 400, request);
        if (!output) return ogJson({ error: 'no output image' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const put = (path, blob, type) => fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'POST', headers: { ...svc, 'Content-Type': type }, body: blob
        });

        const r = await put(`${slug}/output.png`, output, 'image/png');
        if (!r.ok) return ogJson({ error: 'output upload ' + r.status + ' ' + await r.text() }, 502, request);

        let hasSource = false;
        if (source && source.size) {
          const rs = await put(`${slug}/source.jpg`, source, 'image/jpeg');
          hasSource = rs.ok;
        }
        if (video && video.size) { await put(`${slug}/output.webm`, video, 'video/webm'); }

        const delHash = delToken ? await sha256hex(delToken) : null;
        const ins = await fetch(`${SUPABASE}/rest/v1/renders`, {
          method: 'POST',
          headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ slug, handle, title, description: description || null, settings: JSON.parse(settings), has_source: hasSource, del_token: delHash, allow_remix: allowRemix, media }),
        });
        if (!ins.ok) return ogJson({ error: 'row insert ' + ins.status + ' ' + await ins.text() }, 502, request);

        return ogJson({ slug, view: `${VIEW_BASE}?r=${encodeURIComponent(slug)}` }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Delete a render (hybrid auth: valid token OR matching handle) ──
    if (url.pathname === '/delete' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const slug   = (form.get('slug')   || '').toString();
        const token  = (form.get('token')  || '').toString();
        const handle = (form.get('handle') || '').toString();
        const secret = (form.get('secret') || '').toString();   // caller's identity secret (used for admin override)
        if (!/^[A-Za-z0-9_-]+$/.test(slug)) return ogJson({ error: 'bad slug' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const rowRes = await fetch(`${SUPABASE}/rest/v1/renders?slug=eq.${encodeURIComponent(slug)}&select=slug,handle,del_token,has_source`, { headers: svc });
        if (!rowRes.ok) return ogJson({ error: 'lookup ' + rowRes.status }, 502, request);
        const row = (await rowRes.json())[0];
        if (!row) return ogJson({ error: 'not found' }, 404, request);

        // authorize: hashed-token match (proves creation), else identity-suffix match (circle fallback).
        // Match on the stable suffix only, so a display-name (prefix) change never breaks ownership.
        const sfx = (s) => String(s || '').split('-').pop();
        let ok = false;
        if (token && row.del_token) ok = (await sha256hex(token)) === row.del_token;
        if (!ok && handle && row.handle) ok = (sfx(handle) === sfx(row.handle));
        // admin override: the ADMIN identity, verified via its stored profile secret, may delete anything
        if (!ok && ADMIN && px.verified && px.uid === ADMIN) ok = true;
        if (!ok && ADMIN && secret && sfx(handle) === ADMIN) {
          const ar = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(ADMIN)}&select=secret_hash,pubkey`, { headers: svc });
          if (ar.ok) { const a = (await ar.json())[0]; if (a && a.secret_hash && a.secret_hash === await sha256hex(secret)) ok = true; }
        }
        if (!ok) return ogJson({ error: 'not authorized to delete this render' }, 403, request);

        // delete storage objects (best-effort), then the row
        const del = (path) => fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: svc });
        await del(`${slug}/output.png`);
        if (row.has_source) await del(`${slug}/source.jpg`);
        const rowDel = await fetch(`${SUPABASE}/rest/v1/renders?slug=eq.${encodeURIComponent(slug)}`, {
          method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' },
        });
        if (!rowDel.ok) return ogJson({ error: 'row delete ' + rowDel.status + ' ' + await rowDel.text() }, 502, request);

        return ogJson({ ok: true, slug }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Profile upsert (bio / prefix / featured); auth via a per-user secret ──
    //  The secret is sha256(playerId + salt), derived client-side — so any device
    //  with the user's key can edit, nobody else can. Only its hash is stored.
    if (url.pathname === '/profile' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        if (!uid || (!secret && !px.verified)) return ogJson({ error: 'uid and secret required' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const cur = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=uid,secret_hash,pubkey`, { headers: svc });
        const existing = cur.ok ? (await cur.json())[0] : null;
        const secretHash = secret ? await sha256hex(secret) : '';
        if (!(await okIdentity(svc, uid, existing, secretHash, px))) return ogJson({ error: 'not authorized for this profile' }, 403, request);

        const body = Object.assign({ uid, updated_at: new Date().toISOString() }, secretHash ? { secret_hash: secretHash } : {});
        if (form.has('prefix'))   body.prefix = (form.get('prefix') || '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 2);
        if (form.has('bio'))      body.bio = (form.get('bio') || '').toString().slice(0, 500);
        if (form.has('featured')) { try { body.featured = JSON.parse(form.get('featured').toString()); } catch (e) { body.featured = []; } }
        if (form.has('theme'))    { try { body.theme = JSON.parse(form.get('theme').toString()); } catch (e) { body.theme = {}; } }

        // avatar image upload → public renders bucket at avatars/<uid>.jpg; version stored in theme.avatar for cache-busting
        const avatar = form.get('avatar');
        if (avatar && avatar.size) {
          const av = await fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/avatars/${encodeURIComponent(uid)}.jpg`, {
            method: 'POST', headers: { ...svc, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: avatar,
          });
          if (av.ok) { if (!body.theme) body.theme = {}; body.theme.avatar = Date.now(); }
        }
        // banner image upload → banners/<uid>.jpg; version stored in theme.banner
        const banner = form.get('banner');
        if (banner && banner.size) {
          const bn = await fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/banners/${encodeURIComponent(uid)}.jpg`, {
            method: 'POST', headers: { ...svc, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: banner,
          });
          if (bn.ok) { if (!body.theme) body.theme = {}; body.theme.banner = Date.now(); }
        }

        const up = await fetch(`${SUPABASE}/rest/v1/profiles`, {
          method: 'POST',
          headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(body),
        });
        if (!up.ok) return ogJson({ error: 'profile upsert ' + up.status + ' ' + await up.text() }, 502, request);
        return ogJson({ ok: true, uid }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Like / unlike a post (auth via identity secret; TOFU-registers new users) ──
    if (url.pathname === '/like' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const slug   = (form.get('slug')   || '').toString();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'like').toString();
        if (!/^[A-Za-z0-9_-]+$/.test(slug) || !uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh = secret ? await sha256hex(secret) : '';
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);
        if (!(prof && (prof.secret_hash || prof.pubkey))) {
          // first engagement — register the identity secret
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ uid, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });
        }

        if (action === 'unlike') {
          await fetch(`${SUPABASE}/rest/v1/likes?slug=eq.${encodeURIComponent(slug)}&uid=eq.${encodeURIComponent(uid)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          const owner = await ownerOf(svc, slug); await deleteNotif(svc, owner, uid, 'like', slug);
        } else {
          await fetch(`${SUPABASE}/rest/v1/likes`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ slug, uid }) });
          const owner = await ownerOf(svc, slug); await insertNotif(svc, owner, uid, 'like', slug);
        }
        return ogJson({ ok: true }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Comment: add / delete (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/comment' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const slug   = (form.get('slug')   || '').toString();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'add').toString();
        if (!/^[A-Za-z0-9_-]+$/.test(slug) || !uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = secret ? await sha256hex(secret) : '';
        // verify identity (TOFU-register on first engagement, same as /like)
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);
        if (!(prof && (prof.secret_hash || prof.pubkey))) {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ uid, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });
        }

        if (action === 'delete') {
          const id = (form.get('id') || '').toString().replace(/[^0-9]/g, '');
          if (!id) return ogJson({ error: 'bad id' }, 400, request);
          const cr = await fetch(`${SUPABASE}/rest/v1/comments?id=eq.${id}&select=id,uid`, { headers: svc });
          const c = cr.ok ? (await cr.json())[0] : null;
          if (!c) return ogJson({ error: 'not found' }, 404, request);
          // author may delete own; the verified ADMIN identity may delete any
          let ok = (c.uid === uid) || (ADMIN && uid === ADMIN);
          if (!ok) return ogJson({ error: 'not authorized' }, 403, request);
          await fetch(`${SUPABASE}/rest/v1/comments?id=eq.${id}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          return ogJson({ ok: true }, 200, request);
        }

        // add
        const bodyText = (form.get('body') || '').toString().trim().slice(0, 500);
        if (!bodyText) return ogJson({ error: 'empty comment' }, 400, request);
        const ins = await fetch(`${SUPABASE}/rest/v1/comments`, {
          method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ slug, uid, body: bodyText }),
        });
        if (!ins.ok) return ogJson({ error: 'comment insert ' + ins.status + ' ' + await ins.text() }, 502, request);
        const created = (await ins.json())[0] || null;
        const owner = await ownerOf(svc, slug); await insertNotif(svc, owner, uid, 'comment', slug);
        return ogJson({ ok: true, comment: created }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Text post: create / delete (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/post' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'add').toString();
        const handle = (form.get('handle') || 'anon').toString().slice(0, 32);
        if (!uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = secret ? await sha256hex(secret) : '';
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);
        if (!(prof && (prof.secret_hash || prof.pubkey))) {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ uid, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });
        }

        if (action === 'delete') {
          const id = (form.get('id') || '').toString();
          if (!/^[A-Za-z0-9_-]+$/.test(id)) return ogJson({ error: 'bad id' }, 400, request);
          const cr = await fetch(`${SUPABASE}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=id,handle`, { headers: svc });
          const c = cr.ok ? (await cr.json())[0] : null;
          if (!c) return ogJson({ error: 'not found' }, 404, request);
          const ok = (sfxOf(c.handle) === uid) || (ADMIN && uid === ADMIN);
          if (!ok) return ogJson({ error: 'not authorized' }, 403, request);
          // remove the post + its engagement + notifications (best-effort)
          await fetch(`${SUPABASE}/rest/v1/posts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await fetch(`${SUPABASE}/rest/v1/likes?slug=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await fetch(`${SUPABASE}/rest/v1/comments?slug=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await fetch(`${SUPABASE}/rest/v1/notifications?slug=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          return ogJson({ ok: true }, 200, request);
        }

        // add — supports typed entries: kind 'text' (default) or 'rf_station' / 'rf_setup' / 'rf_live' with a jsonb data payload
        const body = (form.get('body') || '').toString().trim().slice(0, 1000);
        if (!body) return ogJson({ error: 'empty post' }, 400, request);
        const kind = (form.get('kind') || 'text').toString().replace(/[^a-z_]/g, '').slice(0, 20) || 'text';
        let data = null;
        if (form.has('data')) { try { data = JSON.parse(form.get('data').toString()); } catch (e) { data = null; } }
        const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        // Optional preview image (e.g. an RF station map snapshot) → public bucket,
        // stored on data.img so the /p/<id> og-card unfurls with a real picture.
        const snap = form.get('snap');
        if (snap && snap.size) {
          const up = await fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/stations/${id}.png`, {
            method: 'POST', headers: { ...svc, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: snap,
          });
          if (up.ok) { if (!data || typeof data !== 'object') data = {}; data.img = `${SUPABASE}/storage/v1/object/public/${BUCKET}/stations/${id}.png`; }
        }
        // Optional audio clip (e.g. a Signal Chain recording) → public bucket, stored on data.audio.
        const audio = form.get('audio');
        if (audio && audio.size) {
          const au = await fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/audio/${id}.wav`, {
            method: 'POST', headers: { ...svc, 'Content-Type': 'audio/wav', 'x-upsert': 'true' }, body: audio,
          });
          if (au.ok) { if (!data || typeof data !== 'object') data = {}; data.audio = `${SUPABASE}/storage/v1/object/public/${BUCKET}/audio/${id}.wav`; }
        }
        const ins = await fetch(`${SUPABASE}/rest/v1/posts`, {
          method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ id, uid, handle, body, kind, data }),
        });
        if (!ins.ok) return ogJson({ error: 'post insert ' + ins.status + ' ' + await ins.text() }, 502, request);
        const created = (await ins.json())[0] || null;
        return ogJson({ ok: true, post: created }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Report / moderation queue (add is public; list/resolve are ADMIN-only) ──
    if (url.pathname === '/report' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'add').toString();
        if (!uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = secret ? await sha256hex(secret) : '';
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);
        if (!(prof && (prof.secret_hash || prof.pubkey)) && action === 'add') {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ uid, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });
        } else {
          return ogJson({ error: 'not authorized' }, 403, request);
        }
        const isAdmin = !!ADMIN && uid === ADMIN;   // secret already verified above for existing profiles

        if (action === 'list') {
          if (!isAdmin) return ogJson({ error: 'admin only' }, 403, request);
          const r = await fetch(`${SUPABASE}/rest/v1/reports?resolved=eq.false&order=created_at.desc&limit=100&select=id,target,kind,reporter,reason,created_at`, { headers: svc });
          return ogJson({ ok: true, reports: r.ok ? await r.json() : [] }, 200, request);
        }
        if (action === 'resolve') {
          if (!isAdmin) return ogJson({ error: 'admin only' }, 403, request);
          const id = (form.get('id') || '').toString().replace(/[^0-9]/g, '');
          if (!id) return ogJson({ error: 'bad id' }, 400, request);
          await fetch(`${SUPABASE}/rest/v1/reports?id=eq.${id}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ resolved: true }) });
          return ogJson({ ok: true }, 200, request);
        }

        // add a report
        const target = (form.get('target') || '').toString();
        const kind   = ((form.get('kind') || 'render').toString() === 'text') ? 'text' : 'render';
        const reason = (form.get('reason') || '').toString().slice(0, 300);
        if (!/^[A-Za-z0-9_-]+$/.test(target)) return ogJson({ error: 'bad target' }, 400, request);
        const rin = await fetch(`${SUPABASE}/rest/v1/reports`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ target, kind, reporter: uid, reason: reason || null }) });
        if (!rin.ok) return ogJson({ error: 'report insert ' + rin.status + ' ' + await rin.text() }, 502, request);
        return ogJson({ ok: true }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Follow / unfollow (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/follow' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form     = await request.formData();
        const follower = (form.get('follower') || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const followee = (form.get('followee') || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret   = (form.get('secret')   || '').toString();
        const action   = (form.get('action')   || 'follow').toString();
        if (!follower || !followee || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);
        if (follower === followee) return ogJson({ error: 'cannot follow yourself' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = secret ? await sha256hex(secret) : '';
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(follower)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!(await okIdentity(svc, follower, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);
        if (!(prof && (prof.secret_hash || prof.pubkey))) {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ uid: follower, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });
        }

        if (action === 'unfollow') {
          await fetch(`${SUPABASE}/rest/v1/follows?follower=eq.${encodeURIComponent(follower)}&followee=eq.${encodeURIComponent(followee)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await deleteNotif(svc, followee, follower, 'follow', null);
        } else {
          await fetch(`${SUPABASE}/rest/v1/follows`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ follower, followee }) });
          await insertNotif(svc, followee, follower, 'follow', null);
        }
        return ogJson({ ok: true }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Presence / status — who's ON AIR / LISTENING (RF-as-entry P3) ──
    //  POST  uid,secret,handle,state,label,freq,privacy → heartbeat upsert.
    //        privacy 'off' or state 'off' removes the row (go invisible).
    //  GET   ?viewer=<sfx> → live roster (fresh < 75s) the viewer may see:
    //        'public' to everyone, 'followers' only to accounts the viewer follows.
    if (url.pathname === '/presence' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form    = await request.formData();
        const uid     = (form.get('uid')     || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret  = (form.get('secret')  || '').toString();
        const handle  = (form.get('handle')  || '').toString().slice(0, 40);
        let   state   = (form.get('state')   || 'off').toString();
        let   privacy = (form.get('privacy') || 'public').toString();
        const label   = (form.get('label')   || '').toString().slice(0, 60);
        const fRaw    = (form.get('freq')     || '').toString();
        const freq    = fRaw ? Math.max(0, Math.min(30000, parseFloat(fRaw) || 0)) : null;
        const laRaw   = (form.get('lat')      || '').toString();
        const loRaw   = (form.get('lon')      || '').toString();
        const lat     = (laRaw !== '' && !isNaN(parseFloat(laRaw))) ? Math.max(-90,  Math.min(90,  parseFloat(laRaw))) : null;
        const lon     = (loRaw !== '' && !isNaN(parseFloat(loRaw))) ? Math.max(-180, Math.min(180, parseFloat(loRaw))) : null;
        if (!uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);
        if (!['on_air', 'listening', 'off'].includes(state))   state   = 'off';
        if (!['off', 'followers', 'public'].includes(privacy)) privacy = 'public';

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = secret ? await sha256hex(secret) : '';
        const pr  = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);
        if (!(prof && (prof.secret_hash || prof.pubkey))) {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ uid, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });
        }

        // Going invisible or idle → drop the row entirely.
        if (privacy === 'off' || state === 'off') {
          await fetch(`${SUPABASE}/rest/v1/presence?uid=eq.${encodeURIComponent(uid)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          return ogJson({ ok: true, cleared: true }, 200, request);
        }
        const row = { uid, handle, state, label, freq, lat, lon, privacy, updated_at: new Date().toISOString() };
        const up = await fetch(`${SUPABASE}/rest/v1/presence`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
        if (!up.ok) return ogJson({ error: 'presence upsert ' + up.status + ' ' + await up.text() }, 502, request);
        return ogJson({ ok: true }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }
    if (url.pathname === '/presence' && request.method === 'GET') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const svc    = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const viewer = (url.searchParams.get('viewer') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const cutoff = new Date(Date.now() - 75000).toISOString();
        const rq = await fetch(`${SUPABASE}/rest/v1/presence?updated_at=gte.${encodeURIComponent(cutoff)}&privacy=neq.off&select=uid,handle,state,label,freq,lat,lon,privacy,updated_at&order=updated_at.desc&limit=150`, { headers: svc });
        const rows = rq.ok ? await rq.json() : [];
        // The viewer's following set powers the 'followers'-only tier.
        let followees = new Set();
        if (viewer) {
          const fq = await fetch(`${SUPABASE}/rest/v1/follows?follower=eq.${encodeURIComponent(viewer)}&select=followee`, { headers: svc });
          if (fq.ok) for (const r of await fq.json()) followees.add(r.followee);
        }
        const now  = Date.now();
        const rank = { on_air: 0, listening: 1 };
        const roster = rows
          .filter(r => r.privacy === 'public' || (r.privacy === 'followers' && viewer && followees.has(r.uid)))
          .map(r => ({ uid: r.uid, handle: r.handle, state: r.state, label: r.label, freq: r.freq, lat: r.lat, lon: r.lon, age: Math.round((now - new Date(r.updated_at).getTime()) / 1000) }))
          .sort((a, b) => ((rank[a.state] ?? 9) - (rank[b.state] ?? 9)) || (a.age - b.age));
        return ogJson({ roster, count: roster.length }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Repost / unrepost (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/repost' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'repost').toString();
        const target = (form.get('target') || '').toString();
        const kind   = ((form.get('kind') || 'render').toString() === 'text') ? 'text' : 'render';
        if (!uid || (!secret && !px.verified) || !/^[A-Za-z0-9_-]+$/.test(target)) return ogJson({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = secret ? await sha256hex(secret) : '';
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);
        if (!(prof && (prof.secret_hash || prof.pubkey))) {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ uid, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });
        }

        if (action === 'unrepost') {
          await fetch(`${SUPABASE}/rest/v1/reposts?uid=eq.${encodeURIComponent(uid)}&target=eq.${encodeURIComponent(target)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          const owner = await ownerOf(svc, target); await deleteNotif(svc, owner, uid, 'repost', target);
        } else {
          const ins = await fetch(`${SUPABASE}/rest/v1/reposts`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, target, kind }) });
          if (!ins.ok) return ogJson({ error: 'repost insert ' + ins.status + ' ' + await ins.text() }, 502, request);
          const owner = await ownerOf(svc, target); await insertNotif(svc, owner, uid, 'repost', target);
        }
        return ogJson({ ok: true }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Notifications: list / mark-read (PRIVATE — auth via identity secret) ──
    //  Notifications are not publicly readable (no anon RLS policy); only the
    //  Worker (service key) can read them, and only after verifying the caller
    //  owns the recipient identity.
    if (url.pathname === '/notifications' && request.method === 'POST') {
      if (!KEY) return ogJson({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'list').toString();
        if (!uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = secret ? await sha256hex(secret) : '';
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash,pubkey`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!prof || !(prof.secret_hash || prof.pubkey)) return ogJson({ ok: true, unread: 0, items: [] }, 200, request);  // no identity yet
        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);

        if (action === 'read') {
          await fetch(`${SUPABASE}/rest/v1/notifications?recipient=eq.${encodeURIComponent(uid)}&read=eq.false`, {
            method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ read: true }),
          });
          return ogJson({ ok: true }, 200, request);
        }

        const r = await fetch(`${SUPABASE}/rest/v1/notifications?recipient=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=50&select=id,actor,type,slug,created_at,read`, { headers: svc });
        const items = r.ok ? await r.json() : [];
        const unread = items.filter(x => !x.read).length;
        return ogJson({ ok: true, unread, items }, 200, request);
      } catch (e) {
        return ogJson({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── og-card page for shared links ───────────────────────────
    const ogm = url.pathname.match(/^\/r\/([A-Za-z0-9_-]+)\/?$/);
    if (ogm && request.method === 'GET') {
      const slug = ogm[1];
      const img = `${SUPABASE}/storage/v1/object/public/${BUCKET}/${slug}/output.png`;
      const viewUrl = `${VIEW_BASE}?r=${encodeURIComponent(slug)}`;
      let title = 'ASCII render', handle = '';
      try {
        if (KEY) {
          const r = await fetch(`${SUPABASE}/rest/v1/renders?slug=eq.${encodeURIComponent(slug)}&select=title,handle`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          if (r.ok) { const rows = await r.json(); if (rows[0]) { title = rows[0].title || title; handle = rows[0].handle || ''; } }
        }
      } catch (e) {}
      const desc = (handle ? '@' + handle + ' · ' : '') + 'Made with PTXERO ASCII//RENDER — open to remix';
      const html =
`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — ASCII//RENDER</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)} — ASCII//RENDER">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(viewUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)} — ASCII//RENDER">
<meta name="twitter:image" content="${esc(img)}">
<link rel="canonical" href="${esc(viewUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(viewUrl)}">
</head><body style="background:#07070a;color:#c8f542;font-family:monospace;padding:24px">
Opening your render… <a style="color:#c8f542" href="${esc(viewUrl)}">view it here</a>.
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    }

    // ── og-card for text / RF / typed posts (so ?p= links unfurl) ──
    const ogp = url.pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
    if (ogp && request.method === 'GET') {
      const id = ogp[1];
      const viewUrl = `${VIEW_BASE}?p=${encodeURIComponent(id)}`;
      let title = 'PTXERO//SOCIAL', desc = 'A post on PTXERO//SOCIAL', img = '', bigImg = false;
      try {
        if (KEY) {
          const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
          const r = await fetch(`${SUPABASE}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=handle,body,kind,data`, { headers: svc });
          const row = r.ok ? (await r.json())[0] : null;
          if (row) {
            const handle = row.handle || 'anon';
            const d = row.data || {};
            const kind = row.kind || 'text';
            if (kind === 'rf_setup') {
              const n = (d.count != null) ? d.count : (Array.isArray(d.modules) ? d.modules.length : 0);
              title = (row.body || 'signal chain') + ' — PTXERO//RF signal chain';
              desc  = (d.caption ? d.caption + ' · ' : '') + n + ' modules · load it into your RF and remix';
            } else if (kind === 'rf_audio') {
              const dur = (d.dur != null) ? d.dur + 's' : '';
              title = (row.body || 'RF clip') + (dur ? ' · ' + dur : '') + ' — PTXERO//RF audio';
              desc  = (d.caption ? d.caption + ' · ' : '') + 'A Signal Chain recording on PTXERO//RF';
            } else if (kind.indexOf('rf') === 0) {
              const freq = (d.freq != null) ? (+d.freq).toFixed(1) + ' MHz' : '';
              title = (row.body || 'RF station') + (freq ? ' · ' + freq : '') + ' — PTXERO//RF';
              desc  = (d.caption ? d.caption + ' · ' : '') + (d.loc ? '◎ ' + d.loc : 'Tune this station in on PTXERO//RF');
            } else {
              const b = String(row.body || '').replace(/\s+/g, ' ').trim();
              title = '@' + handle + ' — PTXERO//SOCIAL';
              desc  = b.slice(0, 200) || 'A post on PTXERO//SOCIAL';
            }
            // image priority: explicit post image → author avatar → none
            if (d.img && /^https?:\/\//.test(String(d.img))) { img = String(d.img); bigImg = true; }
            else {
              const suf = sfxOf(handle);
              const pf = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(suf)}&select=theme`, { headers: svc });
              const t = pf.ok ? (((await pf.json())[0] || {}).theme || null) : null;
              if (t && t.avatar) img = `${SUPABASE}/storage/v1/object/public/${BUCKET}/avatars/${encodeURIComponent(suf)}.jpg?v=${t.avatar}`;
            }
          }
        }
      } catch (e) {}
      const imgTags = img ? `<meta property="og:image" content="${esc(img)}">\n<meta name="twitter:image" content="${esc(img)}">\n` : '';
      const html =
`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${imgTags}<meta property="og:url" content="${esc(viewUrl)}">
<meta name="twitter:card" content="${bigImg ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="canonical" href="${esc(viewUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(viewUrl)}">
</head><body style="background:#07070a;color:#c8f542;font-family:monospace;padding:24px">
Opening this post… <a style="color:#c8f542" href="${esc(viewUrl)}">view it here</a>.
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    }


    return ogJson({ error: 'Not found' }, 404, request);
  }
};

// Node test shim (so this file can be unit-tested outside Cloudflare)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SOURCES, parseFeed, item, stripHtml, toTs, resolveMedia, who, okIdentity, ownsId };
}
