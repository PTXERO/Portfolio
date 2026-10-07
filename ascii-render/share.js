// ─────────────────────────────────────────────────────────────────
//  ASCII//RENDER — Share & Remix  (loaded AFTER ascii_render.js)
//  Reuses the editor's globals: S, asciiCanvas, origCanvas, getSnap,
//  applySnap, showToast, resetMediaState, scheduleRender, $.
//  Backend: plain REST against Supabase (no SDK) — same style as RF.
//
//  Identity + naming are UNIFIED with the RF app:
//   • handle()  → a customizable 2-char PREFIX (default "RF") + a stable
//     SUFFIX derived from the shared player id. Prefix is display-only.
//   • the 3-word name generator mirrors rf.config.js → RF.naming.
//   • each share mints a hashed delete-token so only the creator can delete.
//   • "Allow remix" is OFF by default — the source image is only saved (and
//     the Remix button only shown) when the creator opts in.
// ─────────────────────────────────────────────────────────────────
(function(){
  const CFG = window.SHARE || {};
  if (window.PX) {   // YOUR DATA → "my own hub": every PTXERO app follows the same choice
    const H = window.PX.host();
    if (H.mode === 'own') { CFG.workerUrl = H.hub; if (H.supabaseUrl) CFG.supabaseUrl = H.supabaseUrl; if (H.supabaseAnonKey) CFG.supabaseAnonKey = H.supabaseAnonKey; }
    else if (!CFG.workerUrl) CFG.workerUrl = H.hub;
  }
  const READY = CFG.supabaseUrl && !/YOURPROJECT/.test(CFG.supabaseUrl)
             && CFG.supabaseAnonKey && !/YOUR_ANON/.test(CFG.supabaseAnonKey);
  if(CFG.supabaseUrl) CFG.supabaseUrl = CFG.supabaseUrl.replace(/\/+$/,'').replace(/\/rest\/v1$/,'');

  // ── Naming scheme — mirrors rf.config.js → RF.naming ──
  const NAMING = {
    adj1:  ['TACTICAL','ORBITAL','QUANTUM','VOID','NEON','CRIMSON','STEALTH','ECHO','GHOST','PLASMA','SOLAR','LUNAR','ASTRAL','CHRONO','CYBER','FLUX','FROST','GRAV','HYPER','ION'],
    adj2:  ['HEAVY','BLIND','FRACTURED','LIQUID','STATIC','DEEP','COLD','PHASE','IRON','DARK','BRIGHT','HOLLOW','BROKEN','TWISTED','SILENT','BLAZING','FROZEN','RADIANT','RESONANT','SHIFTING'],
    nouns: ['PULSAR','REPEATER','MATRIX','OVERDRIVE','CHAMBER','BEACON','CASCADE','SHADOW','STORM','ENGINE','RELAY','NEXUS','VORTEX','CORE','WAVE','SIGNAL','PULSE','SPIKE','DRIFT','ECHO']
  };
  const ORDER = ['adj1','adj2','nouns'];
  const pick = arr => arr[Math.floor(Math.random()*arr.length)];
  const rollSection = s => pick(NAMING[s]);

  // ── identity: customizable 2-char PREFIX (default "RF") + stable SUFFIX ──
  const ID_KEY = 'ptxero_rf_player_id';
  function playerId(){
    let id = null;
    try { id = localStorage.getItem(ID_KEY); } catch(e){}
    if(!id){
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
         : 'rf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
      try { localStorage.setItem(ID_KEY, id); } catch(e){}
    }
    return id;
  }
  function handlePrefix(){
    let p = ''; try{ p = localStorage.getItem('ptxero_handle_prefix') || ''; }catch(e){}
    p = p.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,2);
    return p || 'RF';
  }
  function handleSuffix(){
    const id = playerId();
    let h = 0; for(let i=0;i<id.length;i++){ h=(h*31 + id.charCodeAt(i))>>>0; }
    return h.toString(16).toUpperCase().slice(0,4).padStart(4,'0');
  }
  function handle(){ return handlePrefix() + '-' + handleSuffix(); }

  const newSlug = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const authHeaders = () => ({ apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey });
  const publicUrl = (path) => `${CFG.supabaseUrl}/storage/v1/object/public/${CFG.bucket}/${path}`;

  // ── delete-ownership token (saved on THIS device; stored hashed server-side) ──
  const mkToken = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  function rememberRender(slug, token){
    try{ const m = JSON.parse(localStorage.getItem('ptxero_my_renders')||'{}'); m[slug] = token; localStorage.setItem('ptxero_my_renders', JSON.stringify(m)); }catch(e){}
  }
  async function sha256hex(str){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── REST helpers ──
  async function uploadFile(path, blob, contentType){
    const r = await fetch(`${CFG.supabaseUrl}/storage/v1/object/${CFG.bucket}/${path}`, {
      method:'POST', headers:{ ...authHeaders(), 'Content-Type':contentType }, body: blob
    });
    if(!r.ok) throw new Error('upload ' + r.status + ' ' + await r.text());
    return publicUrl(path);
  }
  async function insertRender(row){
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/renders`, {
      method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json', Prefer:'return=minimal' }, body: JSON.stringify(row)
    });
    if(!r.ok) throw new Error('insert ' + r.status + ' ' + await r.text());
  }
  async function getRender(slug){
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/renders?slug=eq.${encodeURIComponent(slug)}&select=*`, { headers: authHeaders() });
    if(!r.ok) throw new Error('fetch ' + r.status);
    return (await r.json())[0] || null;
  }

  const toBlob = (canvas, type, q) => new Promise(res => canvas.toBlob(res, type, q));

  // ── animated output: reuse the editor's rendered GIF/video frame arrays (shared script scope) ──
  function animatedFrames(){
    try{
      if(typeof gifRendered !== 'undefined' && gifRendered && gifRendered.length){
        return { frames: gifRendered.slice(), delays: (S.gif && S.gif.delays) ? S.gif.delays.slice() : gifRendered.map(()=>100) };
      }
      if(typeof videoRenderFrames !== 'undefined' && videoRenderFrames && videoRenderFrames.length){
        const fps = (S.video && S.video.fps) || 12; const d = Math.max(20, Math.round(1000/fps));
        return { frames: videoRenderFrames.slice(), delays: videoRenderFrames.map(()=>d) };
      }
    }catch(e){}
    return null;
  }
  // record the frames (one pass, capped at 17s) into a WebM the feed can loop
  function captureWebM(frames, delays){
    return new Promise((resolve, reject) => {
      if(typeof MediaRecorder === 'undefined' || !frames.length){ reject(new Error('no MediaRecorder')); return; }
      const w = frames[0].width, h = frames[0].height;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); ctx.drawImage(frames[0], 0, 0);
      const mime = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const rec = new MediaRecorder(cv.captureStream(), { mimeType: mime, videoBitsPerSecond: 4500000 });
      const chunks = [];
      rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = reject;
      rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      rec.start();
      const MAX = 17000;   // 17s cap
      let i = 0, elapsed = 0;
      (function step(){
        ctx.clearRect(0,0,w,h); ctx.drawImage(frames[i], 0, 0);
        const d = Math.max(20, delays[i] || 100);
        i++; elapsed += d;
        if(i >= frames.length || elapsed >= MAX){ setTimeout(() => { try{ rec.stop(); }catch(e){ reject(e); } }, 120); return; }
        setTimeout(step, d);
      })();
    });
  }

  function downscaledSource(){
    if(!S.image) return null;
    const max = CFG.maxSourcePx || 1600;
    let w = S.imgW, h = S.imgH;
    if(Math.max(w,h) > max){ const r = max / Math.max(w,h); w = Math.round(w*r); h = Math.round(h*r); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(S.image, 0, 0, w, h);
    return c;
  }

  // ── Naming modal (Dark-Souls style: compose a name, reroll each word) ──
  function openNameModal(onConfirm){
    const old = document.getElementById('shareNameModal'); if(old) old.remove();
    ensureNameStyles();

    const words = { adj1: rollSection('adj1'), adj2: rollSection('adj2'), nouns: rollSection('nouns') };
    const getName = () => ORDER.map(s => words[s]).join(' ');

    const ov = document.createElement('div');
    ov.id = 'shareNameModal'; ov.className = 'nm-ov';
    const panel = document.createElement('div'); panel.className = 'nm-panel';

    try{
      const img = document.createElement('img'); img.className = 'nm-thumb';
      img.alt = 'your entry'; img.src = asciiCanvas.toDataURL('image/png');
      panel.appendChild(img);
    }catch(_){ /* tainted canvas — skip preview */ }

    const h1 = document.createElement('div'); h1.className = 'nm-title'; h1.textContent = 'HERE’S YOUR IMAGE';
    const sub = document.createElement('div'); sub.className = 'nm-sub';
    sub.textContent = 'Tap a word to reroll it.';
    panel.append(h1, sub);

    const slots = document.createElement('div'); slots.className = 'nm-slots';
    const chips = {};
    ORDER.forEach(section => {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'nm-chip';
      chip.title = 'reroll this word';
      const w = document.createElement('span'); w.className = 'nm-word'; w.textContent = words[section];
      const re = document.createElement('span'); re.className = 'nm-re'; re.textContent = '⟳';
      chip.append(w, re);
      chip.addEventListener('click', () => rollChip(section));
      chips[section] = chip; slots.appendChild(chip);
    });
    panel.appendChild(slots);

    function setWord(section, word){ words[section] = word; chips[section].querySelector('.nm-word').textContent = word; }
    function rollChip(section){
      const chip = chips[section];
      if(chip.classList.contains('nm-spin')) return;
      chip.classList.add('nm-spin');
      let ticks = 0;
      const iv = setInterval(() => {
        if(++ticks >= 7){ clearInterval(iv); setWord(section, rollSection(section)); chip.classList.remove('nm-spin'); return; }
        chips[section].querySelector('.nm-word').textContent = rollSection(section);
      }, 45);
    }

    const rollAll = document.createElement('button'); rollAll.type = 'button'; rollAll.className = 'nm-btn nm-roll';
    rollAll.textContent = '↻ REROLL ALL';
    rollAll.addEventListener('click', () => ORDER.forEach(rollChip));

    // optional caption / description
    const capInput = document.createElement('textarea'); capInput.className = 'nm-capinput'; capInput.maxLength = 300; capInput.placeholder = 'Add a caption (optional)…';

    // allow-remix toggle — OFF by default (no source saved, no Remix button)
    const remixWrap = document.createElement('label'); remixWrap.className = 'nm-remix';
    const remixChk = document.createElement('input'); remixChk.type = 'checkbox'; remixChk.id = 'nmRemix';
    const remixTxt = document.createElement('span');
    remixTxt.innerHTML = '<b>Allow remix</b> — also saves your source image so others can reopen it.';
    remixWrap.append(remixChk, remixTxt);

    const foot = document.createElement('div'); foot.className = 'nm-foot';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'nm-btn'; cancel.textContent = '✕ CANCEL';
    const share = document.createElement('button'); share.type = 'button'; share.className = 'nm-btn nm-primary'; share.textContent = '⤴ SHARE THIS';
    foot.append(cancel, share);

    const who = document.createElement('div'); who.className = 'nm-who'; who.textContent = 'sharing as @' + handle();

    panel.append(rollAll, capInput, remixWrap, foot, who);
    ov.appendChild(panel);
    document.body.appendChild(ov);
    share.focus();

    function close(){ document.removeEventListener('keydown', onKey); ov.remove(); }
    function onKey(e){ if(e.key === 'Escape') close(); else if(e.key === 'Enter'){ e.preventDefault(); commit(); } }
    function commit(){ const n = getName(); const allowRemix = remixChk.checked; const desc = capInput.value.trim(); close(); onConfirm(n, allowRemix, desc); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', e => { if(e.target === ov) close(); });
    cancel.addEventListener('click', close);
    share.addEventListener('click', commit);
  }

  let stylesInjected = false;
  function ensureNameStyles(){
    if(stylesInjected) return; stylesInjected = true;
    const s = document.createElement('style');
    s.textContent = `
      .nm-ov{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;
        background:rgba(3,3,6,.72);backdrop-filter:blur(3px);font-family:var(--fmono,monospace);}
      .nm-panel{background:var(--panel,#101015);border:1px solid var(--acc,#c8f542);border-radius:3px;
        box-shadow:var(--shadow,6px 6px 0 #1a1a22);max-width:min(92vw,440px);width:100%;padding:20px 20px 16px;color:var(--txt,#d8d8e0);
        max-height:90vh;overflow:auto;}
      .nm-thumb{display:block;max-width:100%;max-height:150px;margin:0 auto 14px;border:1px solid var(--b2,#28282f);
        background:#000;image-rendering:pixelated;}
      .nm-title{font-family:var(--fdisp,'Bebas Neue',sans-serif);font-size:24px;letter-spacing:.04em;color:var(--acc,#c8f542);line-height:1;}
      .nm-sub{font-size:10px;letter-spacing:.06em;color:var(--dim,#5a5a70);margin:6px 0 16px;line-height:1.5;}
      .nm-slots{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:14px;}
      .nm-chip{cursor:pointer;background:var(--bg,#07070a);border:1px solid var(--b2,#28282f);border-radius:2px;
        color:var(--txt,#d8d8e0);font-family:var(--fdisp,'Bebas Neue',sans-serif);font-size:20px;letter-spacing:.04em;
        padding:8px 12px;display:inline-flex;align-items:center;gap:8px;transition:border-color .12s,color .12s,transform .06s;}
      .nm-chip:hover{border-color:var(--acc,#c8f542);color:var(--acc,#c8f542);}
      .nm-chip:active{transform:translateY(1px);}
      .nm-chip .nm-re{font-family:var(--fmono,monospace);font-size:11px;color:var(--dim,#5a5a70);}
      .nm-chip.nm-spin{border-color:var(--acc,#c8f542);opacity:.85;}
      .nm-chip.nm-spin .nm-word{opacity:.6;}
      .nm-btn{cursor:pointer;font-family:var(--fmono,monospace);font-size:11px;letter-spacing:.1em;
        padding:9px 14px;border-radius:2px;border:1px solid var(--b2,#28282f);background:transparent;color:var(--txt,#d8d8e0);transition:all .15s;}
      .nm-btn:hover{border-color:var(--acc2,#42d4f5);color:var(--acc2,#42d4f5);}
      .nm-roll{width:100%;margin-bottom:6px;}
      .nm-capinput{width:100%;box-sizing:border-box;background:var(--bg,#07070a);border:1px solid var(--b2,#28282f);border-radius:2px;
        color:var(--txt,#d8d8e0);font-family:var(--fbody,'DM Mono',monospace);font-size:12px;padding:8px 10px;resize:vertical;min-height:40px;line-height:1.5;margin-bottom:2px;}
      .nm-capinput:focus{outline:none;border-color:var(--acc,#c8f542);}
      .nm-capinput::placeholder{color:var(--dim,#5a5a70);}
      .nm-remix{display:flex;align-items:flex-start;gap:8px;margin-top:14px;font-size:10px;line-height:1.5;color:var(--dim,#5a5a70);cursor:pointer;letter-spacing:.03em;}
      .nm-remix b{color:var(--txt,#d8d8e0);font-weight:400;}
      .nm-remix input{margin-top:1px;accent-color:var(--acc,#c8f542);cursor:pointer;flex-shrink:0;width:14px;height:14px;}
      .nm-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;}
      .nm-primary{border-color:var(--acc,#c8f542);color:var(--acc,#c8f542);}
      .nm-primary:hover{border-color:var(--acc,#c8f542);color:#000;background:var(--acc,#c8f542);}
      .nm-who{text-align:right;font-size:10px;letter-spacing:.06em;color:var(--dim,#5a5a70);margin-top:10px;}
    `;
    document.head.appendChild(s);
  }

  // ── Share ──
  function doShare(){
    if(!READY){ showToast('Add your Supabase URL + key to share.config.js first'); return; }
    if(!asciiCanvas.width){ showToast('Render something first'); return; }
    openNameModal((name, allowRemix, description) => { performShare(name, allowRemix, description); });
  }

  async function performShare(title, allowRemix, description){
    const slug = newSlug();
    const delToken = mkToken();
    const useWorker = CFG.workerUrl && /^https?:/.test(CFG.workerUrl);
    try{
      showToast('Sharing “' + title + '”…');
      const outBlob = await toBlob(asciiCanvas, 'image/png');
      const srcCanvas = allowRemix ? downscaledSource() : null;   // source is ONLY saved when remix is allowed
      const srcBlob = srcCanvas ? await toBlob(srcCanvas, 'image/jpeg', 0.85) : null;
      // animated renders → WebM so the feed can play them (PNG stays as the poster/still)
      let mediaType = 'image', animBlob = null;
      const anim = animatedFrames();
      if(anim){
        showToast('Encoding animation…');
        try{ animBlob = await captureWebM(anim.frames, anim.delays); mediaType = 'webm'; showToast('Sharing “' + title + '”…'); }
        catch(e){ console.error('animation encode failed', e); }
      }
      if(useWorker){
        const fd = new FormData();
        fd.append('slug', slug);
        fd.append('handle', handle());
        fd.append('title', title);
        fd.append('settings', JSON.stringify(getSnap()));
        fd.append('del_token', delToken);
        fd.append('allow_remix', allowRemix ? 'true' : 'false');
        if(description) fd.append('description', description);
        fd.append('output', outBlob, 'output.png');
        fd.append('media', mediaType);
        if(animBlob) fd.append('video', animBlob, 'output.webm');
        if(srcBlob) fd.append('source', srcBlob, 'source.jpg');
        const shareUrl = CFG.workerUrl.replace(/\/+$/,'') + '/share';
        const r = await fetch(shareUrl, { method:'POST', body: fd, headers: window.PX ? await window.PX.sign('POST', shareUrl) : {} });
        if(!r.ok) throw new Error('worker ' + r.status + ' ' + await r.text());
      } else {
        await uploadFile(`${slug}/output.png`, outBlob, 'image/png');
        if(animBlob) await uploadFile(`${slug}/output.webm`, animBlob, 'video/webm');
        if(srcBlob) await uploadFile(`${slug}/source.jpg`, srcBlob, 'image/jpeg');
        await insertRender({ slug, handle: handle(), title, description: description || null, settings: getSnap(), has_source: !!srcBlob, allow_remix: !!allowRemix, media: mediaType, del_token: await sha256hex(delToken) });
      }
      rememberRender(slug, delToken);
      const link = useWorker
        ? CFG.workerUrl.replace(/\/+$/,'') + '/r/' + encodeURIComponent(slug)
        : new URL('view.html?r=' + encodeURIComponent(slug), location.href).href;
      try{ await navigator.clipboard.writeText(link); showToast('“' + title + '” shared — link copied ✓'); }
      catch(_){ showToast('“' + title + '” shared ✓'); }
      showLinkPanel(link);
    }catch(e){ console.error(e); showToast('Share failed: ' + e.message); }
  }

  // Small link readout so the user can copy manually if the clipboard was blocked
  function showLinkPanel(link){
    let p = document.getElementById('shareLinkPanel');
    if(!p){
      p = document.createElement('div'); p.id = 'shareLinkPanel';
      p.style.cssText = 'position:fixed;z-index:9999;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;'
        + 'display:flex;gap:8px;align-items:center;background:var(--panel,#101015);border:1px solid var(--acc,#c8f542);'
        + 'border-radius:3px;padding:8px 10px;font-family:var(--fmono,monospace);font-size:11px;color:var(--txt,#d8d8e0);box-shadow:var(--shadow,6px 6px 0 #1a1a22);';
      document.body.appendChild(p);
    }
    p.innerHTML = '';
    const a = document.createElement('a'); a.href = link; a.textContent = link; a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:var(--acc,#c8f542);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw;';
    const copy = document.createElement('button'); copy.textContent = 'COPY';
    copy.style.cssText = 'cursor:pointer;background:none;border:1px solid var(--b2,#28282f);color:var(--txt,#d8d8e0);border-radius:2px;padding:4px 8px;font:inherit;';
    copy.onclick = () => { navigator.clipboard.writeText(link).then(()=>showToast('Copied ✓')).catch(()=>{}); };
    const x = document.createElement('button'); x.textContent = '✕';
    x.style.cssText = copy.style.cssText;
    x.onclick = () => p.remove();
    p.append(a, copy, x);
  }

  // ── Remix: index.html?remix=<slug> loads the source + settings ──
  async function maybeRemix(){
    const slug = new URLSearchParams(location.search).get('remix');
    if(!slug) return;
    if(!READY){ showToast('Remix needs share.config.js configured'); return; }
    try{
      const row = await getRender(slug);
      if(!row){ showToast('Entry not found'); return; }
      if(!row.allow_remix){ showToast('The creator disabled remixing for this entry'); return; }
      const applySettings = () => { try{ applySnap(row.settings); }catch(e){ console.error(e); } };
      if(row.has_source){
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => {
          if(typeof resetMediaState === 'function') resetMediaState();
          S.image = img; S.imgW = img.width; S.imgH = img.height;
          origCanvas.width = img.width; origCanvas.height = img.height;
          origCanvas.getContext('2d').drawImage(img, 0, 0);
          $('btnRender').disabled = false; $('sfRender').disabled = false;
          if(S.filename === undefined) S.filename = row.title || 'remix';
          applySettings();
          showToast('Remixed “' + (row.title || 'entry') + '” — tweak away');
        };
        img.onerror = () => { applySettings(); showToast('Loaded settings (source image unavailable) — add your own'); };
        img.src = publicUrl(slug + '/source.jpg');
      } else {
        applySettings(); showToast('Loaded settings — add your own image');
      }
    }catch(e){ console.error(e); showToast('Remix failed: ' + e.message); }
  }

  // ── Inject a SHARE button next to EXPORT ──
  function injectShareButton(){
    const exp = document.getElementById('btnExport');
    if(!exp || document.getElementById('btnShare')) return;
    const b = document.createElement('button');
    b.id = 'btnShare'; b.className = exp.className; b.textContent = '⤴ SHARE';
    b.title = 'Name this entry and copy a shareable link';
    b.addEventListener('click', doShare);
    exp.parentNode.insertBefore(b, exp.nextSibling);
  }

  // ── Inject the user's unified @handle as a bubble right of the title ──
  function injectUserBubble(){
    const logo = document.querySelector('header .logo') || document.querySelector('.logo');
    if(!logo || document.getElementById('userBubble')) return;
    const a = document.createElement('a');
    a.id = 'userBubble';
    a.href = '../social.html?me=1';
    a.textContent = '@' + handle();
    a.title = 'Your PTXERO ID — the same across every PTXERO app. Click to see your entries; YOUR DATA & HUB lives under ⚿ MY KEY there.';
    a.style.cssText = 'margin-left:8px;align-self:center;text-decoration:none;font-family:var(--fmono,monospace);'
      + 'font-size:9px;letter-spacing:.12em;padding:3px 8px;border-radius:2px;border:1px solid rgba(200,245,66,.35);'
      + 'color:var(--acc,#c8f542);background:rgba(200,245,66,.08);white-space:nowrap;';
    logo.insertAdjacentElement('afterend', a);
  }

  // ── Inject a SOCIAL nav link (→ the PTXERO//SOCIAL hub) next to HOME ──
  function injectSocialLink(){
    const home = document.querySelector('header .hdr-home');
    if(!home || document.getElementById('navSocial')) return;
    const a = document.createElement('a');
    a.id = 'navSocial'; a.href = '../social.html'; a.className = home.className || '';
    a.textContent = '◱ SOCIAL';
    a.title = 'PTXERO//SOCIAL — recent entries & your profile';
    home.insertAdjacentElement('afterend', a);
  }

  window.addEventListener('load', () => { injectShareButton(); injectUserBubble(); injectSocialLink(); maybeRemix(); });
})();
// republish nudge — force full re-upload
