// Drive the hub Worker in Node with a fake Supabase (in-memory tables) and a real ECDSA key, like the browser lib does.
const DB = { profiles: {}, hub_users: {}, hub_usage: {}, hub_blobs: {}, posts: [], likes: [], hub_topics: {}, hub_votes: {} };
const today = () => new Date().toISOString().slice(0, 10);
const parseQ = (qs) => Object.fromEntries([...new URLSearchParams(qs)].map(([k, v]) => [k, v]));
globalThis.fetch = async (u, opts = {}) => {
  const url = new URL(u); const m = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : null;
  const ok = (j, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.pathname === '/rest/v1/rpc/hub_touch') { const k = body.p_k + '|' + today(); const r = DB.hub_usage[k] = DB.hub_usage[k] || { calls: 0, writes: 0, bytes: 0 }; r.calls += body.p_calls; r.writes += body.p_writes; r.bytes += body.p_bytes; return ok([r]); }
  if (url.pathname === '/rest/v1/rpc/hub_prune_usage') return ok({});
  if (url.pathname === '/rest/v1/hub_usage') { const n = Object.keys(DB.hub_usage).filter((k) => k.startsWith('uid:') && k.endsWith('|' + today())).length; return new Response('[]', { status: 206, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-0/${n}` } }); }
  const t = url.pathname.replace('/rest/v1/', ''); const q = parseQ(url.search);
  if (t === 'profiles') {
    if (m === 'POST') { const row = DB.profiles[body.uid] = Object.assign(DB.profiles[body.uid] || { uid: body.uid }, body); return ok([row]); }
    const uid = (q.uid || '').replace('eq.', ''); if (m === 'DELETE') { delete DB.profiles[uid]; return ok([]); } return ok(DB.profiles[uid] ? [DB.profiles[uid]] : []);
  }
  if (t === 'hub_users') { if (m === 'POST') { DB.hub_users[body.uid] = Object.assign(DB.hub_users[body.uid] || { created_at: new Date().toISOString() }, body); return ok([]); } if (m === 'DELETE') { delete DB.hub_users[(q.uid || '').replace('eq.', '')]; return ok([]); } const uid = (q.uid || '').replace('eq.', ''); return ok(DB.hub_users[uid] ? [DB.hub_users[uid]] : Object.values(DB.hub_users)); }
  if (t === 'hub_blobs') {
    const uid = (q.uid || '').replace('eq.', ''); const app = (q.app || '').replace('eq.', ''); const key = (q.key || '').replace('eq.', '');
    const rows = Object.values(DB.hub_blobs).filter((b) => b.uid === uid && (!app || b.app === app) && (!key || b.key === key));
    if (m === 'POST') { DB.hub_blobs[body.uid + '/' + body.app + '/' + body.key] = body; return ok([]); }
    if (m === 'DELETE') { rows.forEach((b) => delete DB.hub_blobs[b.uid + '/' + b.app + '/' + b.key]); return ok([]); }
    return ok(rows);
  }
  if (t === 'hub_topics') {
    const id = (q.id || '').replace('eq.', ''), uid = (q.uid || '').replace('eq.', '');
    if (m === 'POST') { const rows = Array.isArray(body) ? body : [body]; rows.forEach((r) => DB.hub_topics[r.id] = Object.assign(DB.hub_topics[r.id] || {}, r)); return ok([]); }
    if (m === 'PATCH') { Object.values(DB.hub_topics).forEach((r) => { if ((id && r.id === id) || (uid && r.uid === uid)) Object.assign(r, body); }); return ok([]); }
    return ok(Object.values(DB.hub_topics).filter((r) => (!id || r.id === id) && (!uid || r.uid === uid) && (q.deleted !== 'eq.false' || !r.deleted)));
  }
  if (t === 'hub_votes') {
    const tid = (q.topic_id || '').replace('eq.', ''), uid = (q.uid || '').replace('eq.', '');
    if (m === 'POST') { (Array.isArray(body) ? body : [body]).forEach((v) => DB.hub_votes[v.topic_id + '|' + v.uid + '|' + v.item_id] = v); return ok([]); }
    if (m === 'DELETE') { Object.keys(DB.hub_votes).forEach((k) => { if (DB.hub_votes[k].uid === uid) delete DB.hub_votes[k]; }); return ok([]); }
    return ok(Object.values(DB.hub_votes).filter((v) => (!tid || v.topic_id === tid) && (!uid || v.uid === uid)));
  }
  if (t === 'posts') { if (m === 'POST') { const row = Object.assign({ created_at: new Date().toISOString() }, body); DB.posts.push(row); return ok([row]); } if (m === 'DELETE') { const uid = (q.uid || '').replace('eq.', ''); DB.posts = DB.posts.filter((p) => p.uid !== uid); return ok([]); } const uid = (q.uid || '').replace('eq.', ''); return ok(DB.posts.filter((p) => !uid || p.uid === uid)); }
  if (['likes', 'comments', 'follows', 'reposts', 'notifications', 'presence', 'reports', 'renders'].includes(t)) return ok([]);
  if (url.pathname.startsWith('/storage/')) return ok({});
  return ok({ error: 'unmocked ' + url.pathname }, 404);
};
const W = (await import(new URL('../hub-worker.js', import.meta.url).href)).default;
const env = { SERVICE_KEY: 'svc', ADMIN_UID: 'AD01', LIMITS: JSON.stringify({ fetch: 3, max_fetch: 3, pool: 3, writes: 2, max_writes: 2, write_pool: 2, anon_fetch: 1, store_bytes: 200, blob_bytes: 100 }) };
const ok = (c, m) => console.log((c ? '✓' : '✗') + ' ' + m);
// a browser-side identity
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function ident(uid) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = b64u(await crypto.subtle.exportKey('spki', kp.publicKey));
  return { uid, kp, spki, async headers(method, path, extra) { const ts = Math.floor(Date.now() / 1000), nonce = Math.random().toString(36).slice(2); const msg = new TextEncoder().encode([uid, ts, nonce, method, path].join('\n')); const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, msg)); return Object.assign({ 'X-PX-Uid': uid, 'X-PX-Pub': spki, 'X-PX-Ts': String(ts), 'X-PX-Nonce': nonce, 'X-PX-Sig': sig }, extra || {}); } };
}
// requests are signed over the pathname, like ptxero-id.js does
const call = async (method, path, id, body, extraHeaders) => { const headers = id ? await id.headers(method, path.split('?')[0], extraHeaders) : (extraHeaders || {}); const init = { method, headers }; if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); headers['Content-Type'] = headers['Content-Type'] || 'application/json'; } const r = await W.fetch(new Request('https://hub.test' + path, init), env); let j = null; try { j = await r.clone().json(); } catch (e) {} return { status: r.status, j, r }; };

const me = await ident('AB12'), other = await ident('AB12'), admin = await ident('AD01');
// 1. health is free and says it's a hub
let r = await call('GET', '/health'); ok(r.status === 200 && r.j.hub === '2.0' && r.j.worker === 'searchnet', '/health: hub ' + r.j.hub + ' (SearchNet ' + r.j.version + ')');
// 2. register binds the key; a different key on the same id is refused
r = await call('POST', '/id', me, {}); ok(r.status === 200 && r.j.status === 'bound' && DB.profiles.AB12.pubkey === me.spki, '/id binds the key to @AB12');
r = await call('POST', '/id', other, {}); ok(r.status === 409 && r.j.error === 'taken', 'a second key cannot claim @AB12 (409 taken)');
// 3. a forged signature / stale timestamp is anonymous
const bad = await me.headers('GET', '/me'); bad['X-PX-Sig'] = bad['X-PX-Sig'].slice(0, -4) + 'AAAA';
r = await call('GET', '/me', null, undefined, bad); ok(r.status === 401, 'tampered signature → 401');
const stale = await me.headers('GET', '/me'); stale['X-PX-Ts'] = String(Math.floor(Date.now() / 1000) - 3600);
r = await call('GET', '/me', null, undefined, stale); ok(r.status === 401, 'stale timestamp → 401');
// 4. store: put / get / list / delete, blob + total limits, writes quota
r = await call('PUT', '/store/searchnet/topics', me, { a: 1 }); ok(r.status === 200 && r.j.bytes === 7, 'PUT /store/searchnet/topics ok (' + r.j.bytes + ' bytes)');
r = await call('GET', '/store/searchnet/topics', me); ok(r.status === 200 && r.j.data.a === 1, 'GET returns the blob');
r = await call('PUT', '/store/searchnet/big', me, { s: 'x'.repeat(200) }); ok(r.status === 413, 'a blob over blob_bytes → 413');
r = await call('PUT', '/store/searchnet/two', me, { b: 2 }); ok(r.status === 200, '2nd write ok');
r = await call('PUT', '/store/searchnet/three', me, { c: 3 }); ok(r.status === 429 && r.j.error === 'quota' && r.r.headers.get('Retry-After'), '3rd write of the day → 429 quota with Retry-After (limit 2)');
r = await call('GET', '/store/searchnet', me); ok(r.status === 200 && r.j.items.length === 2, 'list shows 2 blobs');
r = await call('GET', '/store/searchnet/topics', other); ok(r.status === 401 || r.status === 404, 'another key cannot read my blobs (' + r.status + ')');
// 5. me: usage + limits; owner has none
r = await call('GET', '/me', me); ok(r.status === 200 && r.j.limits.writes === 2 && r.j.today.writes >= 2 && r.j.store.blobs === 2, '/me reports usage ' + JSON.stringify(r.j.today) + ' and store ' + r.j.store.bytes + ' B');
await call('POST', '/id', admin, {}); r = await call('GET', '/me', admin); ok(r.status === 200 && r.j.owner && r.j.limits === null, 'the owner sees no limits');
for (let i = 0; i < 5; i++) r = await call('PUT', '/store/x/k' + i, admin, { i }); ok(r.status === 200, 'owner writes are never throttled');
r = await call('PUT', '/store/x/big', admin, { pad: 'x'.repeat(300) }); ok(r.status === 200, 'owner blobs are not capped (blob_bytes 100, sent ' + (300 + 12) + ')');
{ const env2 = Object.assign({}, env, { ADMIN_UID: 'ZZ99, ad01' }); const r2 = await W.fetch(new Request('https://hub.test/me', { headers: await admin.headers('GET', '/me') }), env2); const j2 = await r2.json(); ok(r2.status === 200 && j2.owner === true, 'several owners: a comma-separated ADMIN_UID, any case, still makes @AD01 an owner'); }
// 6. fetch quota: anonymous 1/day, identity 3/day
globalThis.__sn = 0; const origFetch = globalThis.fetch; // SearchNet routes call out: make bluesky search answer
globalThis.fetch = async (u, o) => (String(u).includes('bsky.app') ? { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ posts: [] }), text: async () => '{}' } : origFetch(u, o));
r = await call('GET', '/search?source=bluesky&q=cat', null, undefined, { 'CF-Connecting-IP': '9.9.9.9' }); ok(r.status === 200, 'anonymous search #1 ok');
r = await call('GET', '/search?source=bluesky&q=cat', null, undefined, { 'CF-Connecting-IP': '9.9.9.9' }); ok(r.status === 429 && /Anonymous/.test(r.j.hint), 'anonymous search #2 → 429 (anon_fetch 1)');
let last; for (let i = 0; i < 4; i++) last = await call('GET', '/search?source=bluesky&q=cat', me); ok(last.status === 429 && /pool/.test(last.j.hint), 'identity: 4th search → 429 (fetch 3)');
DB.hub_usage = {}; // a new day
// 6b. shared result cache: a search someone already made recently is free for the next asker
{ const store = new Map(); globalThis.caches = { default: { match: async (req) => { const v = store.get(req.url); return v ? new Response(v) : undefined; }, put: async (req, res) => { store.set(req.url, await res.text()); } } };
  r = await call('GET', '/search?source=bluesky&q=dog', me); const m1 = await call('GET', '/me', me);
  ok(r.status === 200 && r.j.cached === false && m1.j.today.fetch === 1, 'first search of "dog" goes upstream and costs one fetch (' + m1.j.today.fetch + ')');
  r = await call('GET', '/search?source=bluesky&q=dog', me); const m2 = await call('GET', '/me', me);
  ok(r.status === 200 && r.j.cached === true && m2.j.today.fetch === 1, 'the same search again is a cache hit and costs nothing (' + m2.j.today.fetch + ')');
  r = await call('GET', '/search?source=bluesky&q=dog', null, undefined, { 'CF-Connecting-IP': '8.8.8.8' }); const r2 = await call('GET', '/search?source=bluesky&q=dog', null, undefined, { 'CF-Connecting-IP': '8.8.8.8' });
  ok(r.status === 200 && r.j.cached === true && r2.status === 200, 'an anonymous asker gets the shared hit without spending their one fetch');
  r = await call('GET', '/search?source=bluesky&q=dog&limit=5', me); ok(r.status === 200 && r.j.cached === false, 'a different limit is a different key');
  // 6c. replay: the same signed request twice is refused when the edge cache remembers the nonce
  const hdr = await me.headers('GET', '/me'); const a1 = await W.fetch(new Request('https://hub.test/me', { headers: hdr }), env); const a2 = await W.fetch(new Request('https://hub.test/me', { headers: hdr }), env);
  ok(a1.status === 200 && a2.status === 401, 'a replayed signed request is refused (' + a1.status + ' then ' + a2.status + ')');
  delete globalThis.caches; DB.hub_usage = {}; }
// 6d. open topics: published by one id, seen by all, joined by any, ratings pooled; never a named person; archived by the starter or the owner
{ DB.hub_usage = {}; const env3 = Object.assign({}, env, { LIMITS: JSON.stringify({ fetch: 50, max_fetch: 50, pool: 500, writes: 50, max_writes: 50, write_pool: 500, anon_fetch: 10, store_bytes: 9e6, blob_bytes: 9e6 }) });
  const callE = async (method, path, id, body, extra) => { const headers = id ? await id.headers(method, path.split('?')[0], extra) : (extra || {}); const init = { method, headers }; if (body !== undefined) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; } const rr = await W.fetch(new Request('https://hub.test' + path, init), env3); return { status: rr.status, j: await rr.json().catch(() => ({})) }; };
  const other2 = await ident('EF56'); await callE('POST', '/id', other2, {});
  let r = await callE('PUT', '/topics/isaias01', me, { name: 'Tropical Storm Isaias', seeds: ['isaias'], kind: 'event', settings: { soft: ['storm'], plan: { kind: 'event', presets: ['news'] }, sites: { 'x.com': 1 } } });
  ok(r.status === 200 && r.j.started_by === 'AB12' && DB.hub_topics.isaias01 && !('sites' in DB.hub_topics.isaias01.settings), 'PUT /topics publishes an open topic under its starter with only the safe settings');
  r = await callE('PUT', '/topics/jane01', me, { name: 'Jane Doe', seeds: ['Jane Doe'], kind: 'person' }); ok(r.status === 403, 'a topic about a named person is refused (403)');
  r = await callE('GET', '/topics', null); ok(r.status === 200 && r.j.topics.length === 1 && r.j.topics[0].started_by === 'AB12' && r.j.topics[0].people === 1, 'GET /topics lists it for anyone, started by @AB12, 1 person');
  r = await callE('POST', '/topics/isaias01/votes', other2, { votes: [{ item_id: 'x:1', label: 1, ts: 5 }, { item_id: 'x:2', label: -1, ts: 5 }] }); ok(r.status === 200 && r.j.saved === 2, 'another id joins by rating');
  r = await callE('POST', '/topics/isaias01/votes', me, { votes: [{ item_id: 'x:1', label: 1, ts: 6 }] });
  r = await callE('GET', '/topics/isaias01', other2); ok(r.status === 200 && r.j.pool['x:1'].pos === 2 && r.j.pool['x:2'].neg === 1 && r.j.people === 2, 'GET /topics/<id> pools the ratings per item (x:1 👍×2, x:2 👎×1), 2 people');
  r = await callE('PUT', '/topics/isaias01', other2, { name: 'hijack', seeds: ['x'] }); ok(r.status === 403, 'someone else cannot rewrite it (403)');
  r = await callE('DELETE', '/topics/isaias01', other2); ok(r.status === 403, 'someone else cannot delete it (403)');
  r = await callE('DELETE', '/topics/isaias01', admin); ok(r.status === 200 && DB.hub_topics.isaias01.deleted === true && Object.keys(DB.hub_votes).length === 3, 'the hub owner can archive it; the ratings stay');
  r = await callE('GET', '/topics', null); ok(r.j.topics.length === 0, 'an archived topic is off the list');
  r = await callE('PUT', '/topics/isaias02', me, { name: 'Again', seeds: ['again'] }); r = await callE('DELETE', '/topics/isaias02', me); ok(r.status === 200, 'the starter can archive their own');
  DB.hub_usage = {}; }
// 7. legacy Social form posts still work, and a bound key blocks legacy writes
const fd = new FormData(); fd.append('uid', 'CD34'); fd.append('secret', 's3cret'); fd.append('handle', 'RF-CD34'); fd.append('body', 'hello legacy');
let rr = await W.fetch(new Request('https://hub.test/post', { method: 'POST', body: fd }), env); ok(rr.status === 200 && DB.profiles.CD34 && DB.profiles.CD34.secret_hash, 'legacy /post (uid+secret) still works and TOFU-registers');
const fd2 = new FormData(); fd2.append('uid', 'AB12'); fd2.append('secret', 'guess'); fd2.append('handle', 'RF-AB12'); fd2.append('body', 'spoof');
rr = await W.fetch(new Request('https://hub.test/post', { method: 'POST', body: fd2 }), env); ok(rr.status === 403, 'a legacy secret cannot post as a key-bound id (403)');
// 8. signed Social post without any secret
const fd3 = new FormData(); fd3.append('uid', 'AB12'); fd3.append('handle', 'RF-AB12'); fd3.append('body', 'signed hello');
rr = await W.fetch(new Request('https://hub.test/post', { method: 'POST', body: fd3, headers: await me.headers('POST', '/post') }), env); const jj = await rr.json(); ok(rr.status === 200 && jj.post && jj.post.body === 'signed hello', 'signed /post with no secret works: ' + (jj.error || 'ok'));
// 9. legacy profile migrates: a key may bind only with the old secret
const fd4 = new FormData(); fd4.append('uid', 'CD34'); fd4.append('handle', 'RF-CD34'); fd4.append('body', 'takeover');
const cd = await ident('CD34'); rr = await W.fetch(new Request('https://hub.test/post', { method: 'POST', body: fd4, headers: await cd.headers('POST', '/post') }), env); ok(rr.status === 403, 'a new key cannot take over a legacy id without its secret');
const fd5 = new FormData(); fd5.append('uid', 'CD34'); fd5.append('secret', 's3cret'); fd5.append('handle', 'RF-CD34'); fd5.append('body', 'migrated');
rr = await W.fetch(new Request('https://hub.test/post', { method: 'POST', body: fd5, headers: await cd.headers('POST', '/post') }), env); ok(rr.status === 200 && DB.profiles.CD34.pubkey === cd.spki, 'with the old secret once, the key binds (legacy → key)');
// 10. delete everything
r = await call('DELETE', '/me', me); ok(r.status === 200 && !DB.profiles.AB12 && !Object.values(DB.hub_blobs).some((b) => b.uid === 'AB12') && !DB.posts.some((p) => p.uid === 'AB12'), 'DELETE /me erases profile, blobs and posts');
// 11. retention cron purges stale identities, never the owner
DB.hub_users.CD34.last_seen = new Date(Date.now() - 400 * 86400000).toISOString(); DB.hub_users.AD01.last_seen = DB.hub_users.CD34.last_seen;
await W.scheduled({}, env); ok(!DB.profiles.CD34 && DB.profiles.AD01, 'cron: stale @CD34 purged, owner kept');
// 12. the pool: one active id gets the ceiling, many share it, never below the floor
{ const env2 = Object.assign({}, env, { LIMITS: JSON.stringify({ fetch: 400, max_fetch: 6000, pool: 20000 }) }); DB.hub_usage = {};
  const solo = await ident('SOLO'); await call('POST', '/id', solo, {});
  const fetch2 = (p, id) => W.fetch(new Request('https://hub.test' + p, { headers: {} }), env2);
  let rr2 = await W.fetch(new Request('https://hub.test/me', { headers: await solo.headers('GET', '/me') }), env2); let jm = await rr2.json();
  ok(jm.limits.fetch === 6000 && jm.limits.active === 1, 'pool: alone today → ceiling (' + jm.limits.fetch + ' fetches)');
  for (let i = 0; i < 40; i++) DB.hub_usage['uid:U' + i + '|' + today()] = { calls: 1, writes: 0, bytes: 0 };
  W.__resetActive && W.__resetActive();
  await new Promise((r) => setTimeout(r, 10));
  rr2 = await W.fetch(new Request('https://hub.test/me', { headers: await solo.headers('GET', '/me') }), Object.assign({}, env2, { LIMITS: JSON.stringify({ fetch: 400, max_fetch: 6000, pool: 20000, _bust: Date.now() }) })); jm = await rr2.json();
  ok(jm.limits.fetch >= 400 && jm.limits.fetch <= 6000, 'pool: shared among active ids stays inside floor..ceiling (' + jm.limits.fetch + ' for ' + jm.limits.active + ')'); }
