/* ─────────────────────────────────────────────────────────────────
 *  PTXERO ID — one anonymous identity for every PTXERO app, and the choice of where your data lives.
 *
 *  • Identity: the same @PREFIX-SUFFIX handle Social already gives you, now backed by a keypair made in
 *    this browser (ECDSA P-256, WebCrypto). Requests to a hub are signed, so nobody can act as you. No
 *    e-mail, no password, no name. Export the key once (a small JSON file) and import it on another device.
 *  • Host: by default apps talk to the shared PTXERO hub (fair-use limits, data auto-deleted when unused).
 *    You can point every app at YOUR OWN hub (a free Cloudflare Worker + Supabase project — see /hub/),
 *    or keep an app device-only where it supports that. Switching is one setting, stored on this device.
 *  • window.PX API:  id() · handle() · pub() · sign(method, url) → headers · fetch(path, opts) (signed, queued
 *    on 429) · host() / setHost() · me() · exportKey() / importKey(json) · deleteMyData() · panel(el, opts)
 *
 *  Loads after design-tokens.js and (optionally) share.config.js. No dependencies.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  const LS = { id: 'ptxero_rf_player_id', prefix: 'ptxero_handle_prefix', key: 'ptxero_key_v1', host: 'ptxero_host', ack: 'ptxero_social_onboarded' };
  const DEFAULT_HUB = 'https://share.ptxero.net';
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const del = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  // ── identity (same derivation Social and ASCII//RENDER use today) ──
  function playerId() {
    let id = get(LS.id);
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'rf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); set(LS.id, id); }
    return id;
  }
  function prefix() { return String(get(LS.prefix) || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 2) || 'RF'; }
  function suffix() { const id = playerId(); let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h.toString(16).toUpperCase().slice(0, 4).padStart(4, '0'); }
  function handle() { return prefix() + '-' + suffix(); }
  async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join(''); }
  async function legacySecret() { return sha256hex(playerId() + '|ptxero-profile-secret-v1'); }

  // ── keys ──
  const b64u = {
    enc(buf) { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec(s) { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; },
  };
  let keyCache = null;
  async function keys() {
    if (keyCache) return keyCache;
    if (!(window.crypto && crypto.subtle)) return null;
    const alg = { name: 'ECDSA', namedCurve: 'P-256' };
    let jwk = null; try { jwk = JSON.parse(get(LS.key) || 'null'); } catch (e) { jwk = null; }
    if (jwk && jwk.priv && jwk.pub) {
      try {
        const priv = await crypto.subtle.importKey('jwk', jwk.priv, alg, true, ['sign']);
        const pub = await crypto.subtle.importKey('jwk', jwk.pub, alg, true, ['verify']);
        return (keyCache = { priv, pub, spki: jwk.spki });
      } catch (e) { /* fall through: make a new one */ }
    }
    const kp = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
    const spki = b64u.enc(await crypto.subtle.exportKey('spki', kp.publicKey));
    set(LS.key, JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: await crypto.subtle.exportKey('jwk', kp.publicKey), spki, made: Date.now() }));
    return (keyCache = { priv: kp.privateKey, pub: kp.publicKey, spki });
  }
  async function pub() { const k = await keys(); return k ? k.spki : null; }
  // Does this hub understand PTXERO IDs (hub ≥ 2.0)? Older Workers only allow Content-Type in CORS, so signed
  // headers would make the browser block the request outright — on those we send the legacy form instead.
  // Probed once per origin per tab (sessionStorage), so a redeployed hub is picked up by the next tab.
  const capCache = {};
  function capable(origin) {
    if (capCache[origin]) return capCache[origin];                       // a promise: concurrent callers share one probe
    return (capCache[origin] = (async () => {
      let v = null; try { v = JSON.parse(sessionStorage.getItem('ptxero_hubcap:' + origin) || 'null'); } catch (e) { v = null; }
      if (v === null) {
        try { const r = await fetch(origin + '/health', { cache: 'no-store' }); const j = await r.json().catch(() => ({})); v = !!(r.ok && j.hub); } catch (e) { v = false; }
        try { sessionStorage.setItem('ptxero_hubcap:' + origin, JSON.stringify(v)); } catch (e) { /* ignore */ }
      }
      return v;
    })());
  }
  // headers that prove this request is from this identity (the hub verifies; nothing secret leaves the device)
  async function sign(method, url) {
    const k = await keys(); if (!k) return {};
    const u = new URL(url, location.href); if (!(await capable(u.origin))) return {};
    const ts = Math.floor(Date.now() / 1000); const nonce = Math.random().toString(36).slice(2, 12);
    const msg = [suffix(), ts, nonce, String(method || 'GET').toUpperCase(), u.pathname].join('\n');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.priv, new TextEncoder().encode(msg));
    return { 'X-PX-Uid': suffix(), 'X-PX-Pub': k.spki, 'X-PX-Ts': String(ts), 'X-PX-Nonce': nonce, 'X-PX-Sig': b64u.enc(sig) };
  }

  // ── where data lives ──
  //  { mode: 'shared' | 'own' | 'local', hub, supabaseUrl, supabaseAnonKey, bucket }
  function defaults() {
    const S = window.SHARE || {};
    return { mode: 'shared', hub: (S.workerUrl && /^https?:/.test(S.workerUrl)) ? S.workerUrl.replace(/\/+$/, '') : DEFAULT_HUB, supabaseUrl: (S.supabaseUrl || '').replace(/\/+$/, ''), supabaseAnonKey: S.supabaseAnonKey || '', bucket: S.bucket || 'renders' };
  }
  function host() {
    const d = defaults(); let o = null; try { o = JSON.parse(get(LS.host) || 'null'); } catch (e) { o = null; }
    if (!o || o.mode === 'shared') return d;
    if (o.mode === 'local') return Object.assign({}, d, { mode: 'local' });
    return { mode: 'own', hub: String(o.hub || '').replace(/\/+$/, '') || d.hub, supabaseUrl: String(o.supabaseUrl || '').replace(/\/+$/, '') || d.supabaseUrl, supabaseAnonKey: o.supabaseAnonKey || d.supabaseAnonKey, bucket: o.bucket || d.bucket };
  }
  function setHost(o) { if (!o || o.mode === 'shared') del(LS.host); else set(LS.host, JSON.stringify(o)); window.dispatchEvent(new CustomEvent('px:host', { detail: host() })); return host(); }
  const isShared = () => host().mode === 'shared';

  // ── signed, queued fetch to the current hub ──
  //  Hits a 429 (daily limit) → waits for Retry-After (capped) and retries once; everything else is returned as-is.
  let gate = Promise.resolve();
  async function hubFetch(path, opts) {
    opts = opts || {};
    const H = host(); const base = H.hub; const url = /^https?:/.test(path) ? path : base + path;
    const method = (opts.method || 'GET').toUpperCase();
    const headers = Object.assign({}, opts.headers || {}, await sign(method, url));
    let body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(typeof body === 'string')) { body = JSON.stringify(body); headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
    const run = async () => {
      const r = await fetch(url, { method, headers, body });
      if (r.status === 429 && !opts.noRetry) {
        const wait = Math.min(120, Math.max(5, +(r.headers.get('Retry-After') || 30)));
        let info = null; try { info = await r.clone().json(); } catch (e) { info = null; }
        window.dispatchEvent(new CustomEvent('px:quota', { detail: Object.assign({ wait }, info || {}) }));
        if (wait > 60) return r;                                   // a daily cap: don't sit on it, tell the app
        await new Promise((x) => setTimeout(x, wait * 1000));
        const h2 = Object.assign({}, opts.headers || {}, await sign(method, url));
        return fetch(url, { method, headers: h2, body });
      }
      return r;
    };
    const p = gate.then(run, run); gate = p.catch(() => {}); return p;
  }
  async function hubJson(path, opts) { const r = await hubFetch(path, opts); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error === 'quota' ? ('Daily limit hit on the shared hub (' + j.used + '/' + j.limit + ' today). ' + (j.hint || '')) : (j.error || ('HTTP ' + r.status))); e.status = r.status; e.info = j; throw e; } return j; }

  // ── your data on the hub ──
  const me = () => hubJson('/me');
  const register = async () => { try { if (!(await capable(new URL(host().hub).origin))) return { error: 'this hub is not running hub 2.0 yet', status: 404 }; return await hubJson('/id', { method: 'POST', body: { secret: await legacySecret() } }); } catch (e) { return { error: e.message, status: e.status }; } };
  const exportData = () => hubJson('/me/export');
  const deleteMyData = () => hubJson('/me', { method: 'DELETE' });
  const store = {
    list: (app) => hubJson('/store/' + app),
    get: (app, key) => hubJson('/store/' + app + '/' + encodeURIComponent(key)),
    put: (app, key, data) => hubJson('/store/' + app + '/' + encodeURIComponent(key), { method: 'PUT', body: data }),
    del: (app, key) => hubJson('/store/' + app + '/' + encodeURIComponent(key), { method: 'DELETE' }),
  };

  // ── the key file (this is your identity: keep it like a password) ──
  async function exportKey(extra) {
    await keys(); let k = null; try { k = JSON.parse(get(LS.key) || 'null'); } catch (e) { k = null; }
    const data = Object.assign({ _type: 'ptxero-identity', version: 2, playerId: playerId(), prefix: prefix(), handle: handle(), key: k, host: host().mode === 'own' ? host() : null }, extra || {});
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ptxero-key-' + handle() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    set(LS.ack, '1'); return data;
  }
  function importKey(d) {
    if (!d || d._type !== 'ptxero-identity' || !d.playerId) throw new Error('not a PTXERO key file');
    set(LS.id, d.playerId); if (d.prefix) set(LS.prefix, String(d.prefix).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 2));
    if (d.key && d.key.priv && d.key.pub) set(LS.key, JSON.stringify(d.key)); else del(LS.key);
    if (d.renders && typeof d.renders === 'object') { try { const cur = JSON.parse(get('ptxero_my_renders') || '{}'); set('ptxero_my_renders', JSON.stringify(Object.assign({}, cur, d.renders))); } catch (e) { /* ignore */ } }
    if (d.host && d.host.mode === 'own') setHost(d.host);
    keyCache = null; set(LS.ack, '1'); return { handle: handle() };
  }
  function forgetDevice() { del(LS.id); del(LS.key); del(LS.prefix); del(LS.host); keyCache = null; }

  // ── the YOUR DATA panel (apps drop it into their settings) ──
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtB = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B';
  const CSS = `.px-panel{font-family:var(--fbody,'DM Mono',ui-monospace,monospace);font-size:13px;color:var(--txt,#e2e2ea);border:1px solid var(--border,#1f1f29);border-radius:10px;padding:14px 16px;background:var(--surface,#0d0d12)}
.px-panel h4{margin:0 0 6px;font-family:var(--fdisp,'Bebas Neue',sans-serif);font-weight:400;font-size:20px;letter-spacing:.08em}
.px-panel .px-note{color:var(--dim,#7a7a92);font-size:12px;margin:4px 0 8px;line-height:1.45}
.px-panel .px-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.px-panel .px-btn{font-family:var(--fmono,'Share Tech Mono',monospace);font-size:11px;letter-spacing:.08em;padding:7px 11px;border:1px solid var(--b2,#2c2c36);border-radius:2px;background:transparent;color:var(--txt,#e2e2ea);cursor:pointer}
.px-panel .px-btn:hover{border-color:var(--dim,#7a7a92)}.px-panel .px-btn.danger{color:var(--bad,#ff4d6d);border-color:rgba(255,77,109,.4)}
.px-panel .px-opt{display:flex;gap:10px;align-items:flex-start;user-select:none;padding:8px 10px;border:1px solid var(--border,#1f1f29);border-radius:6px;cursor:pointer;flex:1 1 220px}
.px-panel .px-opt>span{flex:1 1 auto;min-width:0}.px-panel .px-opt::after{content:'';flex:0 0 auto;width:10px;height:10px;border-radius:50%;border:1px solid var(--b2,#2c2c36);margin-top:4px}.px-panel .px-opt.on::after{background:var(--acc,#f54242);border-color:var(--acc,#f54242);box-shadow:0 0 10px rgba(var(--acc-rgb,245,66,66),.6)}
.px-panel .px-opt.on{border-color:var(--acc,#f54242)}.px-panel .px-opt b{display:block;font-weight:500}.px-panel .px-opt small{color:var(--dim,#7a7a92);display:block;margin-top:2px}
.px-panel input[type=text]{font-family:var(--fmono,'Share Tech Mono',monospace);font-size:14px;color:var(--txt,#e2e2ea);background:var(--panel,#121218);border:1px solid var(--b2,#2c2c36);border-radius:8px;padding:8px 10px;width:100%;box-sizing:border-box;margin:4px 0}
.px-panel .px-bar{height:6px;background:var(--panel2,#17171f);border-radius:3px;overflow:hidden;margin:4px 0}.px-panel .px-bar i{display:block;height:100%;background:var(--acc,#f54242)}
.px-panel code{font-family:var(--fmono,'Share Tech Mono',monospace);font-size:12px;color:var(--acc2,#42d4f5)}.px-panel a{color:var(--acc,#f54242)}`;
  function ensureCss() { if (document.getElementById('px-css')) return; const s = document.createElement('style'); s.id = 'px-css'; s.textContent = CSS; document.head.appendChild(s); }

  // opts: { app: 'searchnet'|'social'|'ascii'|'gallery', local: true|false (does this app have a device-only mode?), guide: url, onChange: fn }
  async function panel(el, opts) {
    opts = opts || {}; ensureCss();
    const H = host(); const canLocal = !!opts.local; const guide = opts.guide || '/hub/';
    const root = (location.pathname.indexOf('/searchnet/') >= 0 || location.pathname.indexOf('/ascii-render/') >= 0 || location.pathname.indexOf('/gallery/') >= 0 || location.pathname.indexOf('/rf/') >= 0) ? '../' : './';
    el.innerHTML = `<div class="px-panel">
      <h4>YOUR DATA</h4>
      <div class="px-note">You are <b>@${esc(handle())}</b>. An anonymous id made on this device, backed by a key only this browser holds. No email, no name. Keep the key file if you want the same id on another device.</div>
      <div class="px-row">
        <div class="px-opt${H.mode === 'shared' ? ' on' : ''}" data-mode="shared"><span><b>Shared PTXERO hub</b><small>Works out of the box. Daily limits. Anything you leave here gets deleted after <span class="px-ret">a few months</span> without use, so keeping data here is optional.</small></span></div>
        <div class="px-opt${H.mode === 'own' ? ' on' : ''}" data-mode="own"><span><b>My own hub</b><small>A free Cloudflare Worker + Supabase project you control. No limits. <a href="${esc(root)}hub/" target="_blank" rel="noreferrer">Setup guide →</a></small></span></div>
        ${canLocal ? `<div class="px-opt${H.mode === 'local' ? ' on' : ''}" data-mode="local"><span><b>This device only</b><small>No hub at all. Nothing leaves this browser, nothing is shared or backed up.</small></span></div>` : ''}
      </div>
      <div class="px-own" ${H.mode === 'own' ? '' : 'hidden'}>
        <input type="text" class="px-hub" placeholder="https://hub.yourname.workers.dev" value="${esc(H.mode === 'own' ? H.hub : '')}" autocapitalize="off" spellcheck="false">
        <input type="text" class="px-sb" placeholder="https://yourproject.supabase.co  (optional, only Social / ASCII need it)" value="${esc(H.mode === 'own' ? H.supabaseUrl : '')}" autocapitalize="off" spellcheck="false">
        <input type="text" class="px-sbk" placeholder="Supabase publishable (anon) key (optional)" value="${esc(H.mode === 'own' ? H.supabaseAnonKey : '')}" autocapitalize="off" spellcheck="false">
        <div class="px-row"><button class="px-btn px-save">SAVE &amp; TEST</button><span class="px-note px-ownmsg"></span></div>
      </div>
      <div class="px-usage"><div class="px-note px-umsg">…</div></div>
      <div class="px-row">
        <button class="px-btn px-export">⬇ KEY FILE</button>
        <label class="px-btn" style="cursor:pointer">⬆ IMPORT KEY <input type="file" accept="application/json" class="px-import" hidden></label>
        <button class="px-btn px-dl">⬇ EXPORT MY DATA</button>
        <button class="px-btn danger px-erase">✕ DELETE MY DATA ON THIS HUB</button>
      </div>
      <div class="px-note">Delete removes everything this id left on the hub (posts, renders, likes, follows, backups) and the id itself. Your key stays on this device so you can start over any time.</div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const paint = () => { const h = host(); el.querySelectorAll('.px-opt').forEach((o) => o.classList.toggle('on', o.dataset.mode === h.mode)); $('.px-own').hidden = h.mode !== 'own'; };
    el.querySelectorAll('.px-opt').forEach((o) => o.onclick = () => {
      const mode = o.dataset.mode;
      if (mode === 'own') { setHost({ mode: 'own', hub: $('.px-hub').value.trim(), supabaseUrl: $('.px-sb').value.trim(), supabaseAnonKey: $('.px-sbk').value.trim() }); }
      else setHost({ mode });
      paint(); refresh(); if (opts.onChange) opts.onChange(host());
    });
    $('.px-save').onclick = async () => {
      const hub = $('.px-hub').value.trim().replace(/\/+$/, ''); const msg = $('.px-ownmsg');
      if (!/^https?:\/\//.test(hub)) { msg.textContent = 'Paste your hub address (https://…)'; return; }
      setHost({ mode: 'own', hub, supabaseUrl: $('.px-sb').value.trim(), supabaseAnonKey: $('.px-sbk').value.trim() });
      msg.textContent = 'testing…';
      try { const r = await fetch(hub + '/health'); const j = await r.json(); msg.textContent = j.worker === 'searchnet' ? ('✓ hub ' + (j.hub || j.version) + ' answers') : '✕ that address is not a PTXERO hub'; }
      catch (e) { msg.textContent = '✕ no answer from that address'; }
      refresh(); if (opts.onChange) opts.onChange(host());
    };
    $('.px-export').onclick = () => exportKey(opts.exportExtra ? opts.exportExtra() : null);
    $('.px-import').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); const r = importKey(d); alert('Key imported. You are now @' + r.handle + '. Reloading.'); location.reload(); } catch (err) { alert(err.message); } };
    $('.px-dl').onclick = async () => { try { const d = await exportData(); const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'ptxero-data-' + handle() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500); } catch (err) { alert(err.message); } };
    $('.px-erase').onclick = async () => { if (!confirm('Delete everything @' + handle() + ' has on ' + host().hub + '? Posts, renders, likes, follows and backups go. This cannot be undone.')) return; try { const r = await deleteMyData(); alert('Erased. (' + (r.erased ? r.erased.posts + ' posts, ' + r.erased.renders + ' renders' : 'done') + ')'); refresh(); } catch (err) { alert(err.message); } };
    async function refresh() {
      const h = host(); const m = $('.px-umsg'); if (!m) return;
      if (h.mode === 'local') { m.textContent = 'Device only: this app keeps nothing on any hub.'; return; }
      m.textContent = 'checking ' + h.hub + ' …';
      try {
        let u; try { u = await me(); } catch (e1) { if (e1.status !== 401) throw e1; await register(); u = await me(); }   // first visit: bind the key
        const ret = el.querySelector('.px-ret'); if (ret) ret.textContent = u.retention_days + ' days';
        const lim = u.limits; const pct = lim ? Math.min(100, Math.round(100 * (u.store.bytes || 0) / lim.store_bytes)) : 0;
        m.innerHTML = `${h.mode === 'own' ? 'Your hub' : 'Shared hub'} · ${u.owner ? '<b>owner · no limits</b>' : `today: ${u.today.fetch}/${lim.fetch} fetches · ${u.today.writes}/${lim.writes} writes`} · stored ${fmtB(u.store.bytes)}${lim ? ' of ' + fmtB(lim.store_bytes) : ''}${u.last_seen ? ' · last seen ' + new Date(u.last_seen).toLocaleDateString() : ''}${lim ? `<div class="px-bar"><i style="width:${pct}%"></i></div>` : ''}`;
      } catch (err) { m.textContent = err.status === 400 ? 'This hub stores nothing (fetch-only).' : err.status === 401 ? 'Could not sign in to this hub yet.' : err.status === 404 ? 'This hub is an older version (no identity or storage yet). Its owner needs to redeploy it with hub-worker.js.' : ('Hub unreachable: ' + err.message); }
    }
    refresh();
  }

  window.PX = { id: playerId, handle, prefix, suffix, pub, sign, keys, capable, legacySecret, host, setHost, isShared, fetch: hubFetch, json: hubJson, me, register, exportData, deleteMyData, store, exportKey, importKey, forgetDevice, panel, DEFAULT_HUB };
})();
