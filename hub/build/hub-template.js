/* ─────────────────────────────────────────────────────────────────
 *  PTXERO HUB — one Worker for the whole site, in YOUR OWN Cloudflare account.
 *
 *  It is the "home server" every PTXERO app can talk to:
 *   • SearchNet fetching  (/search /account /follows /resolve /fetch) — compute only, nothing stored
 *   • Social + ASCII share (/share /delete /profile /post /like /comment /follow /repost /presence
 *     /notifications /report, og cards /r/ /p/) — rows + files in YOUR Supabase project
 *   • Per-person store     (/store/<app>/<key>) — small JSON blobs per identity per app (backups, settings)
 *   • Open topics          (/topics…) — SearchNet topics anyone on this hub can see and join; ratings pool; never a named person
 *   • Identity             (/id) — an anonymous PTXERO ID proves itself with a keypair; nobody can post as you
 *   • Your data            (/me  GET usage · GET /me/export everything · DELETE /me erase everything)
 *   • Fair use             per-identity daily limits (the owner is exempt) and a cron that deletes
 *                          identities unused for RETENTION_DAYS, so keeping data here is always optional.
 *
 *  DEPLOY: Cloudflare → Workers & Pages → Create → Hello World → Edit code → paste this file → Deploy.
 *  SECRETS (Settings → Variables and Secrets):
 *    SERVICE_KEY     your Supabase service_role / sb_secret key  (required for anything that stores)
 *    SUPABASE_URL    https://<project>.supabase.co                (required when you store; defaults to PTXERO's)
 *    ADMIN_UID       your own 4-char PTXERO id (e.g. CB6C), or several separated by commas — no limits of any kind, never auto-deleted, moderation rights
 *  OPTIONAL: BUCKET (renders) · ALLOWED_ORIGINS (comma list) · RETENTION_DAYS (180) · LIMITS (json)
 *            SEARCHNET_SECRET (legacy shared key for a private fetch-only hub)
 *  CRON: Triggers → Cron Triggers → add "0 4 * * *" (daily retention + usage pruning).
 *  SQL: run hub-setup.sql once in Supabase → SQL Editor.
 *
 *  Contains no secret — safe to sit on the public site as reference.
 * ───────────────────────────────────────────────────────────────── */

const HUB_VERSION = "2.0";
const SN_VERSION = "@@SN_VERSION@@";
@@SN_CONSTS@@
const DEFAULT_SUPABASE = 'https://tfquiunqquuctgkpmiba.supabase.co';
const DEFAULT_ALLOWED = ['https://ptxero.neocities.org'];
const VIEW_BASE = 'https://ptxero.neocities.org/ascii-render/view.html';
const RF_PROXY  = 'https://rf-proxy.ptxero.workers.dev';
// Fair use scales with the day: a pool of fetches is split among the identities active today, never below
// `fetch` each and never above `max_fetch`. One person alone gets the ceiling; a busy day shares the pool.
// (Cloudflare's free tier is ~100k Worker requests a day; the pool leaves headroom for Social and the rest.)
// the owners: no fetch or write caps, no storage cap, no blob cap, never purged. One suffix or several, comma-separated.
const admins = (env) => String((env && env.ADMIN_UID) || '').toUpperCase().split(/[,\s]+/).filter(Boolean);
const isAdmin = (env, uid) => !!uid && admins(env).includes(String(uid).toUpperCase());
const DEFAULT_LIMITS = { fetch: 400, max_fetch: 6000, pool: 20000, writes: 300, max_writes: 3000, write_pool: 10000, store_bytes: 25 * 1024 * 1024, blob_bytes: 512 * 1024, anon_fetch: 60 };
let activeCache = { n: 1, t: 0 };
async function activeToday(svc) {                 // identities that touched the hub today (cached a minute per isolate)
  if (Date.now() - activeCache.t < 60000) return activeCache.n;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const r = await fetch(`${SUPABASE}/rest/v1/hub_usage?day=eq.${day}&k=like.uid:*&select=k`, { headers: { ...svc, Prefer: 'count=exact', Range: '0-0' } });
    const cr = r.headers.get('Content-Range') || ''; const n = parseInt(cr.split('/')[1] || '1', 10);
    activeCache = { n: Math.max(1, n || 1), t: Date.now() };
  } catch (e) { activeCache = { n: 1, t: Date.now() }; }
  return activeCache.n;
}
function dailyCaps(L, active) {
  const share = (pool, floor, ceil) => Math.max(floor, Math.min(ceil, Math.floor(pool / Math.max(1, active))));
  return { fetch: share(L.pool, L.fetch, L.max_fetch), writes: share(L.write_pool, L.writes, L.max_writes), active };
}
let SUPABASE = DEFAULT_SUPABASE, BUCKET = 'renders', ALLOWED = DEFAULT_ALLOWED, LIMITS = DEFAULT_LIMITS;

@@OG_HELPERS@@
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
  // the same nonce seen by another isolate inside the window: the edge cache remembers it for five minutes
  const nreq = (nonce && typeof caches !== 'undefined') ? new Request('https://px.nonce/' + encodeURIComponent(nk)) : null;
  if (nreq) { try { if (await caches.default.match(nreq)) return out; } catch (e) { /* no cache here */ } }
  try {
    const key = await crypto.subtle.importKey('spki', b64u.dec(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const u = new URL(request.url);
    const msg = new TextEncoder().encode([uid, ts, nonce, request.method.toUpperCase(), u.pathname].join('\n'));
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u.dec(sig), msg);
    if (!ok) return out;
  } catch (e) { return out; }
  if (nreq) { try { await caches.default.put(nreq, new Response('1', { headers: { 'Cache-Control': 'max-age=300' } })); } catch (e) { /* ignore */ } }
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
  const L = limits(env);
  if (scope === 'read') { if (px.verified && svc.apikey) fetch(`${SUPABASE}/rest/v1/hub_users`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid: px.uid, pubkey: px.pub, last_seen: new Date().toISOString() }) }).catch(() => {}); return null; }   // a signed read is a visit
  if (px.verified && isAdmin(env, px.uid)) return null;
  if (!svc.apikey) return null;                                               // fetch-only hub: no DB, no limits
  if (!px.verified && scope === 'write') return { status: 401, body: { error: 'sign in with your PTXERO ID to store anything here' } };
  if (px.verified && !(await ownsId(svc, px))) {
    if (scope === 'write') return { status: 401, body: { error: 'this id belongs to another key', hint: 'POST /id with the original device, or pick a new identity' } };
    px = { uid: null, pub: null, verified: false, ip: px.ip, key: 'ip:' + px.ip };
  }
  const u = await touch(svc, px.key, 1, scope === 'write' ? 1 : 0, bytes || 0);
  if (!u) return null;
  const caps = px.verified ? dailyCaps(L, await activeToday(svc)) : null;
  const cap = scope === 'fetch' ? (px.verified ? caps.fetch : L.anon_fetch) : caps.writes;
  const used = scope === 'fetch' ? u.calls : u.writes;
  if (used > cap) return { status: 429, body: { error: 'quota', scope, used, limit: cap, resets_at: resetsAt(), hint: px.verified ? 'Daily limit on the shared hub (today\'s pool split among ' + (caps ? caps.active : 1) + ' active id' + (caps && caps.active === 1 ? '' : 's') + '). Your own hub has no limits, see the /hub/ guide.' : 'Anonymous limit. A PTXERO ID (free, no account) gets more; your own hub has no limits.' }, retry: Math.max(60, Math.round((new Date(resetsAt()) - Date.now()) / 1000)) };
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
  await del(`hub_votes?uid=eq.${e}`);
  await fetch(`${SUPABASE}/rest/v1/hub_topics?uid=eq.${e}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ deleted: true }) });
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
@@SN_BODY@@
async function searchnetRoutes(request, env, url, q) {
  if (env && env.SEARCHNET_SECRET) {   // legacy: a private fetch-only hub keyed by a shared secret
    const given = request.headers.get("X-SN-Key") || url.searchParams.get("key") || "";
    if (given !== env.SEARCHNET_SECRET) return snJson({ error: "bad or missing key" }, 401);
  }
  try {
@@SN_ROUTES@@
    return null;
  } catch (e) {
    return snJson({ error: String(e && e.message || e) }, 502);
  }
}
const SN_PATHS = new Set(['/search', '/account', '/follows', '/resolve', '/fetch', '/discover', '/article', '/author', '/health']);

export default {
  async scheduled(event, env) {
    const KEY = (env && env.SERVICE_KEY) || ''; if (!KEY) return;
    SUPABASE = (env && env.SUPABASE_URL) || DEFAULT_SUPABASE; BUCKET = (env && env.BUCKET) || 'renders';
    const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    const days = Math.max(7, parseInt((env && env.RETENTION_DAYS) || '180', 10) || 180);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    try {
      const r = await fetch(`${SUPABASE}/rest/v1/hub_users?last_seen=lt.${encodeURIComponent(cutoff)}&pinned=eq.false&select=uid&limit=200`, { headers: svc });
      if (r.ok) for (const u of await r.json()) { if (u.uid && !isAdmin(env, u.uid)) await purgeUser(svc, u.uid); }
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
    const ADMIN = admins(env)[0] || '';   // the first owner's suffix, for the legacy secret path; signed requests use isAdmin()
    const svc = KEY ? { apikey: KEY, Authorization: 'Bearer ' + KEY } : {};
    const px = await who(request);
    const q = Object.fromEntries(url.searchParams);
    const deny = (d) => { const r = ogJson(d.body, d.status, request); if (d.retry) r.headers.set('Retry-After', String(d.retry)); return r; };

    // ── SearchNet: compute only (quota scope 'fetch'; / and /health are free) ──
    if (path === '/' || SN_PATHS.has(path)) {
      // a search someone else already made recently is served from the shared cache and costs nothing (a visit is still a visit)
      if (path === '/search' && SOURCES[q.source]) {
        const ck = searchCacheKey(q, Math.min(parseInt(q.limit || '30', 10) || 30, 100)); const hit = ck ? await searchCacheGet(ck) : null;
        if (hit) { await quota(env, svc, px, 'read', 0); const since = parseInt(q.since || '0', 10) || 0; return ogJson({ items: since ? hit.filter((it) => !it.posted_at || it.posted_at >= since) : hit, cached: true }, 200, request); }
      }
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
      const L = limits(env); const owner = isAdmin(env, px.uid);
      return ogJson({ uid: px.uid, owner, since: users[0] ? users[0].created_at : null, last_seen: users[0] ? users[0].last_seen : null, pinned: !!(users[0] && users[0].pinned),
        today: { fetch: today.calls, writes: today.writes }, limits: owner ? null : Object.assign({ store_bytes: L.store_bytes }, dailyCaps(L, await activeToday(svc))),
        store: { bytes, blobs: blobs.length, by_app: blobs.reduce((m, b) => (m[b.app] = (m[b.app] || 0) + (b.bytes || 0), m), {}) },
        retention_days: Math.max(7, parseInt((env && env.RETENTION_DAYS) || '180', 10) || 180), resets_at: resetsAt() }, 200, request);
    }

    // ── open topics: /topics (list) · /topics/<id> (GET pooled votes · PUT publish · DELETE) · /topics/<id>/votes (POST) ──
    //    A topic marked open lives here for everyone on this hub: started by one id, joined by any, ratings pooled.
    //    A topic about a named person is refused. Deleting archives it (other people's ratings stay).
    const tm = path.match(/^\/topics(?:\/([A-Za-z0-9_-]{4,40})(?:\/(votes))?)?$/);
    if (tm) {
      if (!KEY) return ogJson({ error: 'this hub stores nothing (no SERVICE_KEY)' }, 400, request);
      const tid = tm[1], sub = tm[2]; const H = { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
      if (request.method === 'GET' && !tid) {
        if (px.verified) await quota(env, svc, px, 'read', 0);
        const r = await fetch(`${SUPABASE}/rest/v1/hub_topics?deleted=eq.false&select=id,uid,name,seeds,kind,created_at,updated_at&order=updated_at.desc&limit=200`, { headers: svc });
        const rows = r.ok ? await r.json() : [];
        const vr = await fetch(`${SUPABASE}/rest/v1/hub_votes?select=topic_id,uid&limit=20000`, { headers: svc }); const votes = vr.ok ? await vr.json() : [];
        const stat = {}; votes.forEach((v) => { const t = stat[v.topic_id] = stat[v.topic_id] || { ratings: 0, people: new Set() }; t.ratings++; t.people.add(v.uid); });
        return ogJson({ topics: rows.map((t) => ({ id: t.id, name: t.name, seeds: t.seeds, kind: t.kind, started_by: t.uid, created_at: t.created_at, updated_at: t.updated_at, ratings: (stat[t.id] || {}).ratings || 0, people: new Set([t.uid, ...((stat[t.id] || {}).people || [])]).size })) }, 200, request);
      }
      if (request.method === 'GET' && tid && !sub) {
        if (px.verified) await quota(env, svc, px, 'read', 0);
        const r = await fetch(`${SUPABASE}/rest/v1/hub_topics?id=eq.${encodeURIComponent(tid)}&select=*`, { headers: svc }); const t = r.ok ? (await r.json())[0] : null;
        if (!t || t.deleted) return ogJson({ error: 'not found' }, 404, request);
        const vr = await fetch(`${SUPABASE}/rest/v1/hub_votes?topic_id=eq.${encodeURIComponent(tid)}&select=uid,item_id,label,ts&limit=50000`, { headers: svc }); const votes = vr.ok ? await vr.json() : [];
        const pool = {}; const people = new Set([t.uid]);
        votes.forEach((v) => { people.add(v.uid); const q = pool[v.item_id] = pool[v.item_id] || { pos: 0, neg: 0 }; if (v.label > 0) q.pos++; else if (v.label < 0) q.neg++; });
        return ogJson({ id: t.id, name: t.name, seeds: t.seeds, settings: t.settings || {}, kind: t.kind, started_by: t.uid, created_at: t.created_at, updated_at: t.updated_at, people: people.size, ratings: votes.length, pool }, 200, request);
      }
      if (!px.verified) return ogJson({ error: 'signed request required' }, 401, request);
      if (!(await ownsId(svc, px))) return ogJson({ error: 'this id belongs to another key' }, 401, request);
      if (!tid) return ogJson({ error: 'topic id required' }, 400, request);
      const cur = await fetch(`${SUPABASE}/rest/v1/hub_topics?id=eq.${encodeURIComponent(tid)}&select=uid,deleted`, { headers: svc }); const have = cur.ok ? (await cur.json())[0] : null;
      const mine = !have || have.uid === px.uid || isAdmin(env, px.uid);
      if (request.method === 'PUT' && !sub) {
        if (!mine) return ogJson({ error: 'started by someone else' }, 403, request);
        let b; try { b = await request.json(); } catch (e) { return ogJson({ error: 'body must be JSON' }, 400, request); }
        const kind = String(b.kind || (b.settings && b.settings.plan && b.settings.plan.kind) || 'general');
        if (kind === 'person' || (b.settings && b.settings.person && b.settings.person.mode !== 'account')) return ogJson({ error: 'a topic about a named person is never open' }, 403, request);
        const d = await quota(env, svc, px, 'write', 0); if (d) return deny(d);
        const st = b.settings || {}; const safe = { soft: st.soft || [], anti: st.anti || [], breadth: st.breadth, media: st.media, window: st.window, plan: st.plan ? { kind: st.plan.kind, presets: st.plan.presets } : null };
        const row = { id: tid, uid: have ? have.uid : px.uid, name: String(b.name || '').slice(0, 80), seeds: (b.seeds || []).map(String).slice(0, 20), settings: safe, kind, deleted: false, updated_at: new Date().toISOString() };
        if (!have) row.created_at = row.updated_at;
        const up = await fetch(`${SUPABASE}/rest/v1/hub_topics`, { method: 'POST', headers: H, body: JSON.stringify(row) });
        if (!up.ok) return ogJson({ error: 'topics ' + up.status + ' ' + await up.text() }, 502, request);
        return ogJson({ ok: true, id: tid, started_by: row.uid }, 200, request);
      }
      if (request.method === 'DELETE' && !sub) {
        if (!have) return ogJson({ error: 'not found' }, 404, request);
        if (!mine) return ogJson({ error: 'only the one who started it, or the owner of this hub' }, 403, request);
        await fetch(`${SUPABASE}/rest/v1/hub_topics?id=eq.${encodeURIComponent(tid)}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ deleted: true, updated_at: new Date().toISOString() }) });
        return ogJson({ ok: true, archived: tid }, 200, request);
      }
      if (request.method === 'POST' && sub === 'votes') {
        if (!have || have.deleted) return ogJson({ error: 'not found' }, 404, request);
        let b; try { b = await request.json(); } catch (e) { return ogJson({ error: 'body must be JSON' }, 400, request); }
        const votes = (b.votes || []).filter((v) => v && v.item_id && [1, -1, 0].includes(+v.label)).slice(0, 500);
        if (!votes.length) return ogJson({ ok: true, saved: 0 }, 200, request);
        const d = await quota(env, svc, px, 'write', 0); if (d) return deny(d);
        const up = await fetch(`${SUPABASE}/rest/v1/hub_votes`, { method: 'POST', headers: H, body: JSON.stringify(votes.map((v) => ({ topic_id: tid, uid: px.uid, item_id: String(v.item_id).slice(0, 200), label: +v.label, ts: +v.ts || Math.floor(Date.now() / 1000) }))) });
        if (!up.ok) return ogJson({ error: 'votes ' + up.status + ' ' + await up.text() }, 502, request);
        return ogJson({ ok: true, saved: votes.length }, 200, request);
      }
      return ogJson({ error: 'not found' }, 404, request);
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
        const owner = isAdmin(env, px.uid);
        if (!owner && bytes > LIMITS.blob_bytes) return ogJson({ error: 'too large', limit: LIMITS.blob_bytes }, 413, request);
        let data; try { data = JSON.parse(text); } catch (err) { return ogJson({ error: 'body must be JSON' }, 400, request); }
        const d = await quota(env, svc, px, 'write', bytes); if (d) return deny(d);
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

@@OG_ROUTES@@
    return ogJson({ error: 'Not found' }, 404, request);
  }
};

// Node test shim (so this file can be unit-tested outside Cloudflare)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SOURCES, parseFeed, item, stripHtml, toTs, resolveMedia, who, okIdentity, ownsId };
}
