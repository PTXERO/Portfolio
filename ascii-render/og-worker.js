// ─────────────────────────────────────────────────────────────────
//  ASCII//RENDER — dedicated Worker  (separate from rf-proxy)
//  Jobs:
//   • POST /share  — upload proxy: browser sends a simple multipart form
//     (no CORS preflight), Worker writes to Supabase with the SERVICE key.
//     Also stores a HASHED delete-token so only the creator can remove it.
//   • POST /delete — remove a render. Hybrid auth: a valid delete-token
//     (hashed, proves creation) OR a matching @handle (trusted-circle fallback).
//   • GET  /r/<slug> — og-card page so shared links unfurl with the render
//     image, then redirect humans to view.html.
//   • GET  /status — service health for the homepage badges. Probes Supabase
//     + the RF proxy SERVER-SIDE (their URLs never reach the client) and
//     edge-caches the verdict ~30 min. No KV / cron / extra secret needed.
//
//  DEPLOY (as a NEW worker, e.g. "ascii-share"):
//   1. Cloudflare → Workers & Pages → Create Worker → paste this → Deploy.
//   2. Worker → Settings → Variables and Secrets → add an ENCRYPTED secret
//      named  SERVICE_KEY  = your Supabase service_role / sb_secret_… key
//      (Supabase → Project Settings → API). NEVER put it in this file.
//   3. Copy the *.workers.dev URL (or custom domain) into share.config.js →
//      workerUrl, and publish.
//   SQL (one-time, for delete):  alter table renders add column if not exists del_token text;
//  Contains no secret — safe to sit on the public site as reference.
// ─────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = 'https://ptxero.neocities.org';
const SUPABASE  = 'https://tfquiunqquuctgkpmiba.supabase.co'; // ptxero-rf project
const BUCKET    = 'renders';
const VIEW_BASE = 'https://ptxero.neocities.org/ascii-render/view.html';
const RF_PROXY  = 'https://rf-proxy.chapethan09.workers.dev'; // probed by /status (server-side; URL never reaches the client)

const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = origin === ALLOWED_ORIGIN || origin.includes('localhost') || origin.includes('127.0.0.1');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
const json = (data, status, request) => new Response(JSON.stringify(data), {
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url);
    const KEY = (env && env.SERVICE_KEY) || '';
    const ADMIN = (env && env.ADMIN_UID) || '';   // the owner's suffix (e.g. CB6C) — grants moderation

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
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
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
        if (!/^[A-Za-z0-9_-]+$/.test(slug)) return json({ error: 'bad slug' }, 400, request);
        if (!output) return json({ error: 'no output image' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const put = (path, blob, type) => fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'POST', headers: { ...svc, 'Content-Type': type }, body: blob
        });

        const r = await put(`${slug}/output.png`, output, 'image/png');
        if (!r.ok) return json({ error: 'output upload ' + r.status + ' ' + await r.text() }, 502, request);

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
        if (!ins.ok) return json({ error: 'row insert ' + ins.status + ' ' + await ins.text() }, 502, request);

        return json({ slug, view: `${VIEW_BASE}?r=${encodeURIComponent(slug)}` }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Delete a render (hybrid auth: valid token OR matching handle) ──
    if (url.pathname === '/delete' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const slug   = (form.get('slug')   || '').toString();
        const token  = (form.get('token')  || '').toString();
        const handle = (form.get('handle') || '').toString();
        const secret = (form.get('secret') || '').toString();   // caller's identity secret (used for admin override)
        if (!/^[A-Za-z0-9_-]+$/.test(slug)) return json({ error: 'bad slug' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const rowRes = await fetch(`${SUPABASE}/rest/v1/renders?slug=eq.${encodeURIComponent(slug)}&select=slug,handle,del_token,has_source`, { headers: svc });
        if (!rowRes.ok) return json({ error: 'lookup ' + rowRes.status }, 502, request);
        const row = (await rowRes.json())[0];
        if (!row) return json({ error: 'not found' }, 404, request);

        // authorize: hashed-token match (proves creation), else identity-suffix match (circle fallback).
        // Match on the stable suffix only, so a display-name (prefix) change never breaks ownership.
        const sfx = (s) => String(s || '').split('-').pop();
        let ok = false;
        if (token && row.del_token) ok = (await sha256hex(token)) === row.del_token;
        if (!ok && handle && row.handle) ok = (sfx(handle) === sfx(row.handle));
        // admin override: the ADMIN identity, verified via its stored profile secret, may delete anything
        if (!ok && ADMIN && secret && sfx(handle) === ADMIN) {
          const ar = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(ADMIN)}&select=secret_hash`, { headers: svc });
          if (ar.ok) { const a = (await ar.json())[0]; if (a && a.secret_hash && a.secret_hash === await sha256hex(secret)) ok = true; }
        }
        if (!ok) return json({ error: 'not authorized to delete this render' }, 403, request);

        // delete storage objects (best-effort), then the row
        const del = (path) => fetch(`${SUPABASE}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: svc });
        await del(`${slug}/output.png`);
        if (row.has_source) await del(`${slug}/source.jpg`);
        const rowDel = await fetch(`${SUPABASE}/rest/v1/renders?slug=eq.${encodeURIComponent(slug)}`, {
          method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' },
        });
        if (!rowDel.ok) return json({ error: 'row delete ' + rowDel.status + ' ' + await rowDel.text() }, 502, request);

        return json({ ok: true, slug }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Profile upsert (bio / prefix / featured); auth via a per-user secret ──
    //  The secret is sha256(playerId + salt), derived client-side — so any device
    //  with the user's key can edit, nobody else can. Only its hash is stored.
    if (url.pathname === '/profile' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        if (!uid || !secret) return json({ error: 'uid and secret required' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const cur = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=uid,secret_hash`, { headers: svc });
        const existing = cur.ok ? (await cur.json())[0] : null;
        const secretHash = await sha256hex(secret);
        if (existing && existing.secret_hash && existing.secret_hash !== secretHash) {
          return json({ error: 'not authorized for this profile' }, 403, request);
        }

        const body = { uid, secret_hash: secretHash, updated_at: new Date().toISOString() };
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
        if (!up.ok) return json({ error: 'profile upsert ' + up.status + ' ' + await up.text() }, 502, request);
        return json({ ok: true, uid }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Like / unlike a post (auth via identity secret; TOFU-registers new users) ──
    if (url.pathname === '/like' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const slug   = (form.get('slug')   || '').toString();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'like').toString();
        if (!/^[A-Za-z0-9_-]+$/.test(slug) || !uid || !secret) return json({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh = await sha256hex(secret);
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (prof && prof.secret_hash) {
          if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);
        } else {
          // first engagement — register the identity secret
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, secret_hash: sh, updated_at: new Date().toISOString() }) });
        }

        if (action === 'unlike') {
          await fetch(`${SUPABASE}/rest/v1/likes?slug=eq.${encodeURIComponent(slug)}&uid=eq.${encodeURIComponent(uid)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          const owner = await ownerOf(svc, slug); await deleteNotif(svc, owner, uid, 'like', slug);
        } else {
          await fetch(`${SUPABASE}/rest/v1/likes`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ slug, uid }) });
          const owner = await ownerOf(svc, slug); await insertNotif(svc, owner, uid, 'like', slug);
        }
        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Comment: add / delete (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/comment' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const slug   = (form.get('slug')   || '').toString();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'add').toString();
        if (!/^[A-Za-z0-9_-]+$/.test(slug) || !uid || !secret) return json({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = await sha256hex(secret);
        // verify identity (TOFU-register on first engagement, same as /like)
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (prof && prof.secret_hash) {
          if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);
        } else {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, secret_hash: sh, updated_at: new Date().toISOString() }) });
        }

        if (action === 'delete') {
          const id = (form.get('id') || '').toString().replace(/[^0-9]/g, '');
          if (!id) return json({ error: 'bad id' }, 400, request);
          const cr = await fetch(`${SUPABASE}/rest/v1/comments?id=eq.${id}&select=id,uid`, { headers: svc });
          const c = cr.ok ? (await cr.json())[0] : null;
          if (!c) return json({ error: 'not found' }, 404, request);
          // author may delete own; the verified ADMIN identity may delete any
          let ok = (c.uid === uid) || (ADMIN && uid === ADMIN);
          if (!ok) return json({ error: 'not authorized' }, 403, request);
          await fetch(`${SUPABASE}/rest/v1/comments?id=eq.${id}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          return json({ ok: true }, 200, request);
        }

        // add
        const bodyText = (form.get('body') || '').toString().trim().slice(0, 500);
        if (!bodyText) return json({ error: 'empty comment' }, 400, request);
        const ins = await fetch(`${SUPABASE}/rest/v1/comments`, {
          method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ slug, uid, body: bodyText }),
        });
        if (!ins.ok) return json({ error: 'comment insert ' + ins.status + ' ' + await ins.text() }, 502, request);
        const created = (await ins.json())[0] || null;
        const owner = await ownerOf(svc, slug); await insertNotif(svc, owner, uid, 'comment', slug);
        return json({ ok: true, comment: created }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Text post: create / delete (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/post' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'add').toString();
        const handle = (form.get('handle') || 'anon').toString().slice(0, 32);
        if (!uid || !secret) return json({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = await sha256hex(secret);
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (prof && prof.secret_hash) {
          if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);
        } else {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, secret_hash: sh, updated_at: new Date().toISOString() }) });
        }

        if (action === 'delete') {
          const id = (form.get('id') || '').toString();
          if (!/^[A-Za-z0-9_-]+$/.test(id)) return json({ error: 'bad id' }, 400, request);
          const cr = await fetch(`${SUPABASE}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=id,handle`, { headers: svc });
          const c = cr.ok ? (await cr.json())[0] : null;
          if (!c) return json({ error: 'not found' }, 404, request);
          const ok = (sfxOf(c.handle) === uid) || (ADMIN && uid === ADMIN);
          if (!ok) return json({ error: 'not authorized' }, 403, request);
          // remove the post + its engagement + notifications (best-effort)
          await fetch(`${SUPABASE}/rest/v1/posts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await fetch(`${SUPABASE}/rest/v1/likes?slug=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await fetch(`${SUPABASE}/rest/v1/comments?slug=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await fetch(`${SUPABASE}/rest/v1/notifications?slug=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          return json({ ok: true }, 200, request);
        }

        // add — supports typed entries: kind 'text' (default) or 'rf_station' / 'rf_setup' / 'rf_live' with a jsonb data payload
        const body = (form.get('body') || '').toString().trim().slice(0, 1000);
        if (!body) return json({ error: 'empty post' }, 400, request);
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
        if (!ins.ok) return json({ error: 'post insert ' + ins.status + ' ' + await ins.text() }, 502, request);
        const created = (await ins.json())[0] || null;
        return json({ ok: true, post: created }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Report / moderation queue (add is public; list/resolve are ADMIN-only) ──
    if (url.pathname === '/report' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'add').toString();
        if (!uid || !secret) return json({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = await sha256hex(secret);
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (prof && prof.secret_hash) {
          if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);
        } else if (action === 'add') {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, secret_hash: sh, updated_at: new Date().toISOString() }) });
        } else {
          return json({ error: 'not authorized' }, 403, request);
        }
        const isAdmin = !!ADMIN && uid === ADMIN;   // secret already verified above for existing profiles

        if (action === 'list') {
          if (!isAdmin) return json({ error: 'admin only' }, 403, request);
          const r = await fetch(`${SUPABASE}/rest/v1/reports?resolved=eq.false&order=created_at.desc&limit=100&select=id,target,kind,reporter,reason,created_at`, { headers: svc });
          return json({ ok: true, reports: r.ok ? await r.json() : [] }, 200, request);
        }
        if (action === 'resolve') {
          if (!isAdmin) return json({ error: 'admin only' }, 403, request);
          const id = (form.get('id') || '').toString().replace(/[^0-9]/g, '');
          if (!id) return json({ error: 'bad id' }, 400, request);
          await fetch(`${SUPABASE}/rest/v1/reports?id=eq.${id}`, { method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ resolved: true }) });
          return json({ ok: true }, 200, request);
        }

        // add a report
        const target = (form.get('target') || '').toString();
        const kind   = ((form.get('kind') || 'render').toString() === 'text') ? 'text' : 'render';
        const reason = (form.get('reason') || '').toString().slice(0, 300);
        if (!/^[A-Za-z0-9_-]+$/.test(target)) return json({ error: 'bad target' }, 400, request);
        const rin = await fetch(`${SUPABASE}/rest/v1/reports`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ target, kind, reporter: uid, reason: reason || null }) });
        if (!rin.ok) return json({ error: 'report insert ' + rin.status + ' ' + await rin.text() }, 502, request);
        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Follow / unfollow (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/follow' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form     = await request.formData();
        const follower = (form.get('follower') || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const followee = (form.get('followee') || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret   = (form.get('secret')   || '').toString();
        const action   = (form.get('action')   || 'follow').toString();
        if (!follower || !followee || !secret) return json({ error: 'bad request' }, 400, request);
        if (follower === followee) return json({ error: 'cannot follow yourself' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = await sha256hex(secret);
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(follower)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (prof && prof.secret_hash) {
          if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);
        } else {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid: follower, secret_hash: sh, updated_at: new Date().toISOString() }) });
        }

        if (action === 'unfollow') {
          await fetch(`${SUPABASE}/rest/v1/follows?follower=eq.${encodeURIComponent(follower)}&followee=eq.${encodeURIComponent(followee)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          await deleteNotif(svc, followee, follower, 'follow', null);
        } else {
          await fetch(`${SUPABASE}/rest/v1/follows`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ follower, followee }) });
          await insertNotif(svc, followee, follower, 'follow', null);
        }
        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Presence / status — who's ON AIR / LISTENING (RF-as-entry P3) ──
    //  POST  uid,secret,handle,state,label,freq,privacy → heartbeat upsert.
    //        privacy 'off' or state 'off' removes the row (go invisible).
    //  GET   ?viewer=<sfx> → live roster (fresh < 75s) the viewer may see:
    //        'public' to everyone, 'followers' only to accounts the viewer follows.
    if (url.pathname === '/presence' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
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
        if (!uid || !secret) return json({ error: 'bad request' }, 400, request);
        if (!['on_air', 'listening', 'off'].includes(state))   state   = 'off';
        if (!['off', 'followers', 'public'].includes(privacy)) privacy = 'public';

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = await sha256hex(secret);
        const pr  = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (prof && prof.secret_hash) {
          if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);
        } else {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, secret_hash: sh, updated_at: new Date().toISOString() }) });
        }

        // Going invisible or idle → drop the row entirely.
        if (privacy === 'off' || state === 'off') {
          await fetch(`${SUPABASE}/rest/v1/presence?uid=eq.${encodeURIComponent(uid)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          return json({ ok: true, cleared: true }, 200, request);
        }
        const row = { uid, handle, state, label, freq, lat, lon, privacy, updated_at: new Date().toISOString() };
        const up = await fetch(`${SUPABASE}/rest/v1/presence`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
        if (!up.ok) return json({ error: 'presence upsert ' + up.status + ' ' + await up.text() }, 502, request);
        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }
    if (url.pathname === '/presence' && request.method === 'GET') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
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
        return json({ roster, count: roster.length }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Repost / unrepost (auth via identity secret; TOFU-registers) ──
    if (url.pathname === '/repost' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'repost').toString();
        const target = (form.get('target') || '').toString();
        const kind   = ((form.get('kind') || 'render').toString() === 'text') ? 'text' : 'render';
        if (!uid || !secret || !/^[A-Za-z0-9_-]+$/.test(target)) return json({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = await sha256hex(secret);
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (prof && prof.secret_hash) {
          if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);
        } else {
          await fetch(`${SUPABASE}/rest/v1/profiles`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, secret_hash: sh, updated_at: new Date().toISOString() }) });
        }

        if (action === 'unrepost') {
          await fetch(`${SUPABASE}/rest/v1/reposts?uid=eq.${encodeURIComponent(uid)}&target=eq.${encodeURIComponent(target)}`, { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
          const owner = await ownerOf(svc, target); await deleteNotif(svc, owner, uid, 'repost', target);
        } else {
          const ins = await fetch(`${SUPABASE}/rest/v1/reposts`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ uid, target, kind }) });
          if (!ins.ok) return json({ error: 'repost insert ' + ins.status + ' ' + await ins.text() }, 502, request);
          const owner = await ownerOf(svc, target); await insertNotif(svc, owner, uid, 'repost', target);
        }
        return json({ ok: true }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
      }
    }

    // ── Notifications: list / mark-read (PRIVATE — auth via identity secret) ──
    //  Notifications are not publicly readable (no anon RLS policy); only the
    //  Worker (service key) can read them, and only after verifying the caller
    //  owns the recipient identity.
    if (url.pathname === '/notifications' && request.method === 'POST') {
      if (!KEY) return json({ error: 'Worker missing SERVICE_KEY secret' }, 500, request);
      try {
        const form   = await request.formData();
        const uid    = (form.get('uid')    || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const secret = (form.get('secret') || '').toString();
        const action = (form.get('action') || 'list').toString();
        if (!uid || !secret) return json({ error: 'bad request' }, 400, request);

        const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY };
        const sh  = await sha256hex(secret);
        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(uid)}&select=secret_hash`, { headers: svc });
        const prof = pr.ok ? (await pr.json())[0] : null;
        if (!prof || !prof.secret_hash) return json({ ok: true, unread: 0, items: [] }, 200, request);  // no identity yet
        if (prof.secret_hash !== sh) return json({ error: 'not authorized' }, 403, request);

        if (action === 'read') {
          await fetch(`${SUPABASE}/rest/v1/notifications?recipient=eq.${encodeURIComponent(uid)}&read=eq.false`, {
            method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ read: true }),
          });
          return json({ ok: true }, 200, request);
        }

        const r = await fetch(`${SUPABASE}/rest/v1/notifications?recipient=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=50&select=id,actor,type,slug,created_at,read`, { headers: svc });
        const items = r.ok ? await r.json() : [];
        const unread = items.filter(x => !x.read).length;
        return json({ ok: true, unread, items }, 200, request);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, request);
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

    return json({ error: 'Not found' }, 404, request);
  }
};
