// ── APPLY CONFIG → CSS VARS + TITLE ──────────────────────────
(function(){
  // Theme vars now provided by design-tokens.js
  // Only set tool-specific vars that tokens doesn't know about
  const root=document.documentElement;
  root.style.setProperty('--sidebar-w',   CONFIG.sidebar.defaultWidth+'px');
  root.style.setProperty('--sidebar-min', CONFIG.sidebar.minWidth+'px');
  root.style.setProperty('--sidebar-max', CONFIG.sidebar.maxWidth+'px');
  document.title=`${CONFIG.title} v${CONFIG.version}`;
  const verTag=document.querySelector('.ver-tag');
  if(verTag) verTag.textContent=`v${CONFIG.version}`;
})();
// ── APPLY CONFIG DEFAULTS → DOM ────────────────────────────────
(function(){
  function sv(id, v){ const el=document.getElementById(id); if(el&&v!==undefined) el.value=v; }
  const d=CONFIG.defaults, p=CONFIG.perf, r=CONFIG.region;

  // Performance / settings panel
  sv('maxMpVal',  p.maxMp);   sv('maxMpSlider',  p.maxMp);
  sv('maxOutVal', p.maxOut);  sv('maxOutSlider',  p.maxOut);
  sv('chunkVal',  p.chunkRows); sv('chunkSlider', p.chunkRows);
  sv('wdogVal',   p.wdogSec); sv('wdogSlider',   p.wdogSec);

  // Block & scale
  sv('blockVal',  d.blockSize); sv('blockSlider', d.blockSize);
  sv('fontVal',   d.fontSize);  sv('fontSlider',  d.fontSize);
  sv('scaleVal',  d.scale);     sv('scaleSlider', d.scale);

  // Brightness threshold
  sv('invertVal', d.invertThr); sv('invertSlider', d.invertThr);

  // Preprocessing — all default to 0 but driven from config so changing
  // CONFIG.defaults.pp values will propagate here
  const pp=d.pp;
  sv('ppExposure', pp.exposure);       sv('ppExposureSlider', 0);
  sv('ppContrast', pp.contrast);       sv('ppContrastSlider', pp.contrast);
  sv('ppHighlights',pp.highlights);    sv('ppHighlightsSlider',pp.highlights);
  sv('ppShadows',  pp.shadows);        sv('ppShadowsSlider',  pp.shadows);
  sv('ppWhites',   pp.whites);         sv('ppWhitesSlider',   pp.whites);
  sv('ppBlacks',   pp.blacks);         sv('ppBlacksSlider',   pp.blacks);
  sv('ppSaturation',pp.saturation);    sv('ppSaturationSlider',pp.saturation);
  sv('ppVibrance', pp.vibrance);       sv('ppVibranceSlider', pp.vibrance);
  sv('ppTemp',     pp.temp);           sv('ppTempSlider',     pp.temp);
  sv('ppTint',     pp.tint);           sv('ppTintSlider',     pp.tint);
  sv('ppSharpness',pp.sharpness);      sv('ppSharpnessSlider',pp.sharpness);
  sv('ppClarity',  pp.clarity);        sv('ppClaritySlider',  pp.clarity);

  // Region sliders
  sv('edgeThresh',          r.edgeThresh);  sv('edgeThreshSlider',         r.edgeThresh);
  sv('regionHueTol',        r.hueTolerance); sv('regionHueTolSlider',      r.hueTolerance);
  sv('regionLeniency',      r.leniency);    sv('regionLeniencySlider',     r.leniency);
  sv('subjectPadding',      r.subjectPadding); sv('subjectPaddingSlider',  r.subjectPadding);
  sv('subjectConf',         r.subjectConf); sv('subjectConfSlider',        r.subjectConf);
  sv('brushSize',           r.brushSize);   sv('brushSizeSlider',          r.brushSize);

  // Render font selector
  sv('renderFont', d.renderFont);

  // BG color picker
  const bgSwatch=document.getElementById('bgColorSwatch');
  const bgPicker=document.getElementById('bgColorPicker');
  const bgHex=document.getElementById('bgColorHex');
  if(bgSwatch) bgSwatch.style.background=d.bgColor;
  if(bgPicker) bgPicker.value=d.bgColor;
  if(bgHex)    bgHex.value=d.bgColor;

  // Outline color
  const olSwatch=document.getElementById('outlineColorSwatch');
  const olPicker=document.getElementById('outlineColor');
  const olHex=document.getElementById('outlineColorHex');
  if(olSwatch) olSwatch.style.background=d.outline.color;
  if(olPicker) olPicker.value=d.outline.color;
  if(olHex)    olHex.value=d.outline.color;
})();

// ── CHARSETS stored as proper arrays of Unicode chars ─────────
const CHARSETS = {
  standard: Array.from(' .,-~:;=!*#$@'),
  blocks:   Array.from(' ░▒▓▌▐▀▄█'),
  minimal:  Array.from(' ·.oO0@'),
  dense:    Array.from(" .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"),
  binary:   Array.from(' 01'),
  braille:  Array.from('⠀⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠿'),
  halfblock:Array.from(' ▄▀█'),
  custom:   Array.from(' .#@')
};

// ── APP VERSION ────────────────────────────────────────────────
const APP_VERSION = CONFIG.version;

const S = {
  image:null, imgW:0, imgH:0, filename:CONFIG.filename,
  colorMode:CONFIG.defaults.colorMode,
  palMode:CONFIG.defaults.palMode,
  charset:CONFIG.defaults.charset,
  hexColors:[...CONFIG.defaults.hexColors],
  bothMode:CONFIG.defaults.bothMode,
  bgInverted:CONFIG.defaults.bgInverted,
  arLocked:CONFIG.defaults.arLocked, arRatio:null,
  bfLocked:CONFIG.defaults.bfLocked,
  cellMode:CONFIG.defaults.cellMode,
  region:CONFIG.region.default, regionFill:'transparent',
  targetColors:[...CONFIG.defaults.targetColors],
  brushMask:null,
  subjectBoxes:[],
  outline:{...CONFIG.defaults.outline},
  ro:{ enabled:false, charset:null, colorMode:null, bothMode:null, invertThr:null, palMode:null, bgInverted:null },
  gif:{ frames:[], delays:[], current:0, timer:null, playing:false, totalFrames:0, _loopMs:0, _startTime:0 },
  video:{ el:null, fps:CONFIG.perf.videoFps, totalFrames:0, duration:0, format:'webm' },
  pp:{...CONFIG.defaults.pp},
  rendering:false, renderAborted:false,
  renderFont:CONFIG.defaults.renderFont,
  bgStyle:CONFIG.defaults.bgStyle,
  bgColor:CONFIG.defaults.bgColor,
  cfg:{
    memLimit:CONFIG.perf.memLimit,
    maxMp:CONFIG.perf.maxMp,
    maxOut:CONFIG.perf.maxOut,
    chunked:CONFIG.perf.chunked,
    chunkRows:CONFIG.perf.chunkRows,
    watchdog:CONFIG.perf.watchdog,
    wdogSec:CONFIG.perf.wdogSec,
    autoRender:CONFIG.perf.autoRender
  }
};

// Undo/redo stacks — each entry is a serialised settings snapshot
const undoStack=[], redoStack=[], MAX_UNDO=CONFIG.perf.maxUndo;

let panning=false, panStart={x:0,y:0};
let autoTimer=null, watchdogTimer=null, renderGen=0;
const $=id=>document.getElementById(id);
const asciiCanvas=$('asciiCanvas'),origCanvas=$('origCanvas'),workCanvas=$('workCanvas');
const animCanvas=$('animCanvas');
const awrap=$('awrap'),owrap=$('owrap'),emptyMsg=$('emptyMsg'),chunkInfo=$('chunkInfo');

// Per-pane independent zoom/pan
const VS={
  ascii:{zoom:1,panX:0,panY:0},
  orig: {zoom:1,panX:0,panY:0},
  anim: {zoom:1,panX:0,panY:0}
};
function activeView(){
  if($('vp-ascii').classList.contains('on')) return 'ascii';
  if($('vp-anim').classList.contains('on')) return 'anim';
  return 'orig';
}
function getWrap(v){return v==='ascii'?awrap:v==='anim'?$('animWrap'):owrap;}
function getCanvas(v){return v==='ascii'?asciiCanvas:v==='anim'?$('animCanvas'):origCanvas;}

function switchTab(vt){
  document.querySelectorAll('[data-vt]').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.vpane').forEach(x=>x.classList.remove('on'));
  const tab=document.querySelector(`[data-vt="${vt}"]`);
  if(tab) tab.classList.add('on');
  $('vp-'+vt).classList.add('on');
  setTimeout(()=>fitToScreen(),0);
}

// ── SLIDER <-> INPUT SYNC ──────────────────────────────────────
function linkSI(slid,inid,cb){
  const sl=$(slid),inp=$(inid);
  sl.addEventListener('input',()=>{inp.value=sl.value;cb&&cb(+sl.value);});
  inp.addEventListener('change',()=>{const v=parseFloat(inp.value)||0;if(v>parseFloat(sl.max))sl.max=v;sl.value=v;cb&&cb(v);});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();});
}

// ── UNDO / REDO ────────────────────────────────────────────────
function pushUndo(){
  undoStack.push(JSON.stringify(getSnap()));
  if(undoStack.length>MAX_UNDO)undoStack.shift();
  redoStack.length=0;
  syncUndoBtns();
}
function syncUndoBtns(){
  $('btnUndo').disabled=undoStack.length===0;
  $('btnRedo').disabled=redoStack.length===0;
}
$('btnUndo').addEventListener('click',()=>{
  if(!undoStack.length)return;
  redoStack.push(JSON.stringify(getSnap()));
  applySnap(JSON.parse(undoStack.pop()),false);
  syncUndoBtns();
});
$('btnRedo').addEventListener('click',()=>{
  if(!redoStack.length)return;
  undoStack.push(JSON.stringify(getSnap()));
  applySnap(JSON.parse(redoStack.pop()),false);
  syncUndoBtns();
});
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){e.preventDefault();$('btnUndo').click();}
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey))){e.preventDefault();$('btnRedo').click();}
});

// ── TOAST ──────────────────────────────────────────────────────
let toastTimer=null;
function showToast(msg){
  const t=$('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}

// ── COPY TO CLIPBOARD ─────────────────────────────────────────
$('btnCopy').addEventListener('click',async()=>{
  if(!asciiCanvas.width)return;
  try{
    asciiCanvas.toBlob(async blob=>{
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      showToast('Copied to clipboard');
    },'image/png');
  }catch(e){
    // Fallback: open in new tab
    const w=window.open();
    w.document.write(`<img src="${asciiCanvas.toDataURL()}" style="max-width:100%">`);
    showToast('Opened in new tab (clipboard blocked)');
  }
});

// ── URL LOADER ────────────────────────────────────────────────
$('urlLoad').addEventListener('click',()=>loadFromUrl($('urlInput').value.trim()));
$('urlInput').addEventListener('keydown',e=>{if(e.key==='Enter')loadFromUrl($('urlInput').value.trim());});
function loadFromUrl(url){
  if(!url)return;
  const proxy=CONFIG.urls.corsProxy+encodeURIComponent(url);
  $('hdrInfo').textContent='Loading URL…';
  setBadge('LOADING','busy');
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{
    S.image=img;S.imgW=img.width;S.imgH=img.height;
    S.filename='url-image';
    origCanvas.width=img.width;origCanvas.height=img.height;
    origCanvas.getContext('2d').drawImage(img,0,0);
    owrap.style.display='block';
    setBadge('LOADED','done');
    $('hdrInfo').textContent=`URL image  ·  ${img.width}×${img.height}px`;
    $('btnRender').disabled=false;$('sfRender').disabled=false;
    $('outWSlider').value=Math.min(img.width,3840);$('outWVal').value=img.width;
    $('outHSlider').value=Math.min(img.height,2160);$('outHVal').value=img.height;
    $('urlInput').value='';
    scheduleRender();
  };
  img.onerror=()=>{
    setBadge('ERROR','warn');
    $('hdrInfo').textContent='Could not load URL (check CORS / URL validity)';
    showToast('URL load failed — try a direct image link');
  };
  img.src=proxy;
}

// ── MANUAL BOX DRAW ──────────────────────────────────────────
(function(){
  const drawCv=$('boxDrawCanvas');
  const origCv=$('origCanvas');
  const drawCtx=drawCv.getContext('2d');
  S.manualBoxes=[];
  let pickStep=0; // 0=idle, 1=waiting P1, 2=waiting P2

  function syncBoxesToSubject(){
    if(S.region==='manual') S.subjectBoxes=S.manualBoxes.map(b=>({...b,active:true}));
  }

  function getP1P2(){
    return{
      x1:Math.max(0,Math.min(100,parseFloat($('boxP1x').value)||0))/100,
      y1:Math.max(0,Math.min(100,parseFloat($('boxP1y').value)||0))/100,
      x2:Math.max(0,Math.min(100,parseFloat($('boxP2x').value)||100))/100,
      y2:Math.max(0,Math.min(100,parseFloat($('boxP2y').value)||100))/100
    };
  }

  function boxFromPoints(x1,y1,x2,y2){
    return{x:Math.min(x1,x2),y:Math.min(y1,y2),w:Math.abs(x2-x1),h:Math.abs(y2-y1),label:'manual',score:100,active:true};
  }

  function drawOverlay(){
    // Only resize if needed
    if(drawCv.width!==origCv.width||drawCv.height!==origCv.height){
      drawCv.width=origCv.width||S.imgW||400;
      drawCv.height=origCv.height||S.imgH||300;
    }
    drawCtx.clearRect(0,0,drawCv.width,drawCv.height);
    const W=drawCv.width,H=drawCv.height;

    // Draw committed boxes
    S.manualBoxes.forEach((b,i)=>{
      drawCtx.strokeStyle='#c8f542';drawCtx.lineWidth=2;drawCtx.setLineDash([]);
      drawCtx.strokeRect(b.x*W,b.y*H,b.w*W,b.h*H);
      drawCtx.fillStyle='rgba(200,245,66,0.08)';drawCtx.fillRect(b.x*W,b.y*H,b.w*W,b.h*H);
      drawCtx.fillStyle='#c8f542';drawCtx.font='bold 11px monospace';
      drawCtx.fillText(`Box ${i+1}`,b.x*W+4,b.y*H+14);
    });

    // Only draw P1/P2 preview once picking has started
    if(pickStep===0) return;
    const{x1,y1,x2,y2}=getP1P2();
    // Show P1 marker as soon as step>=1
    drawCtx.fillStyle='#f542a8';
    drawCtx.beginPath();drawCtx.arc(x1*W,y1*H,5,0,Math.PI*2);drawCtx.fill();
    drawCtx.fillStyle='#fff';drawCtx.font='bold 10px monospace';
    drawCtx.fillText('P1',x1*W+7,y1*H+4);
    // Show P2 marker and preview box only once P2 is being placed
    if(pickStep===2){
      drawCtx.fillStyle='#f542a8';
      drawCtx.beginPath();drawCtx.arc(x2*W,y2*H,5,0,Math.PI*2);drawCtx.fill();
      drawCtx.fillStyle='#fff';drawCtx.fillText('P2',x2*W+7,y2*H+4);
      const bx=Math.min(x1,x2)*W,by=Math.min(y1,y2)*H,bw=Math.abs(x2-x1)*W,bh=Math.abs(y2-y1)*H;
      drawCtx.strokeStyle='#fff';drawCtx.lineWidth=1.5;drawCtx.setLineDash([5,3]);
      drawCtx.strokeRect(bx,by,bw,bh);drawCtx.setLineDash([]);
    }
  }

  function renderBoxList(){
    const list=$('manualBoxList');
    const clearBtn=$('clearBoxesBtn');
    list.innerHTML='';
    clearBtn.style.display=S.manualBoxes.length?'block':'none';
    S.manualBoxes.forEach((b,i)=>{
      const item=document.createElement('div');item.className='box-item';
      item.title='Click to edit';item.style.cursor='pointer';
      const lbl=document.createElement('span');
      lbl.textContent=`Box ${i+1}  ${Math.round(b.x*100)},${Math.round(b.y*100)} → ${Math.round((b.x+b.w)*100)},${Math.round((b.y+b.h)*100)}`;
      const del=document.createElement('button');del.textContent='×';
      del.onclick=(e)=>{e.stopPropagation();S.manualBoxes.splice(i,1);syncBoxesToSubject();drawOverlay();renderBoxList();scheduleRender();};
      item.appendChild(lbl);item.appendChild(del);
      item.addEventListener('click',()=>{
        // Load box coords into P1/P2 for editing
        $('boxP1x').value=Math.round(b.x*100);$('boxP1y').value=Math.round(b.y*100);
        $('boxP2x').value=Math.round((b.x+b.w)*100);$('boxP2y').value=Math.round((b.y+b.h)*100);
        // Remove from list so re-apply replaces it
        S.manualBoxes.splice(i,1);
        syncBoxesToSubject();renderBoxList();scheduleRender();
        // Enter pick mode so user can reposition
        startPicking();
        showToast(`Editing Box ${i+1} — click P1 to reposition`);
      });
      list.appendChild(item);
    });
  }

  // Commit the current P1/P2 as a box, always adding (never clearing others)
  function commitBox(){
    const{x1,y1,x2,y2}=getP1P2();
    if(Math.abs(x2-x1)<0.01||Math.abs(y2-y1)<0.01){showToast('Box too small — pick points further apart');return;}
    S.manualBoxes.push(boxFromPoints(x1,y1,x2,y2));
    syncBoxesToSubject();
    pickStep=0;
    $('drawBoxBtn').textContent='✛ SET POINTS ON IMAGE';
    drawOverlay();renderBoxList();scheduleRender();
  }

  function startPicking(){
    if(!S.image){showToast('Load an image first');return;}
    if(S.video.el){
      origCanvas.width=S.imgW;origCanvas.height=S.imgH;
      origCanvas.getContext('2d').drawImage(S.video.el,0,0,S.imgW,S.imgH);
      owrap.style.display='block';$('videoPreview').style.display='none';
    }
    // Always ensure canvas is sized and visible
    drawCv.width=origCanvas.width||400;drawCv.height=origCanvas.height||300;
    drawCv.style.display='block';
    pickStep=1;
    $('drawBoxBtn').textContent='→ CLICK IMAGE FOR P1';
    switchTab('orig');
    // Delay overlay draw until after tab switch renders layout
    setTimeout(()=>drawOverlay(),20);
    showToast('Click image to set Point 1');
  }

  $('drawBoxBtn').addEventListener('click',startPicking);

  // Apply box: commit current points, keep all existing boxes, go to ASCII
  $('applyBoxBtn').addEventListener('click',()=>{
    commitBox();
    drawCv.style.display='none';
    switchTab('ascii');
  });

  // Add Another: commit current points, then immediately start picking next box
  $('addBoxBtn').addEventListener('click',()=>{
    commitBox();
    // commitBox resets pickStep=0, now re-enter picking for the next box
    startPicking();
    showToast('Box added — click P1 for next box');
  });

  ['boxP1x','boxP1y','boxP2x','boxP2y'].forEach(id=>{
    $(id).addEventListener('input',()=>{if(drawCv.style.display!=='none')drawOverlay();});
  });

  $('clearBoxesBtn').addEventListener('click',()=>{
    S.manualBoxes=[];syncBoxesToSubject();pickStep=0;
    $('drawBoxBtn').textContent='✛ SET POINTS ON IMAGE';
    drawOverlay();renderBoxList();scheduleRender();
  });

  function handlePickClick(e){
    if(!pickStep) return;
    e.stopPropagation();
    // Use drawCv rect, fall back to origCv if drawCv has no layout yet
    let rect=drawCv.getBoundingClientRect();
    if(!rect.width||!rect.height) rect=origCv.getBoundingClientRect();
    if(!rect.width||!rect.height) return;
    const px=Math.round(Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100)));
    const py=Math.round(Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100)));
    if(pickStep===1){
      $('boxP1x').value=px;$('boxP1y').value=py;
      $('boxP2x').value=px;$('boxP2y').value=py;
      pickStep=2;
      $('drawBoxBtn').textContent='→ CLICK IMAGE FOR P2';
      drawOverlay();
      showToast('P1 set — click for P2');
    }else if(pickStep===2){
      $('boxP2x').value=px;$('boxP2y').value=py;
      commitBox();
      drawCv.style.display='none';
      switchTab('ascii');
    }
  }

  drawCv.addEventListener('click',handlePickClick);

  // Hide overlay when switching away from orig tab
  document.querySelectorAll('[data-vt]').forEach(t=>{
    t.addEventListener('click',()=>{
      if(t.dataset.vt!=='orig'){
        drawCv.style.display='none';
        pickStep=0;
        $('drawBoxBtn').textContent='✛ SET POINTS ON IMAGE';
        if(S.video.el){owrap.style.display='none';$('videoPreview').style.display='block';}
        if(window._brushActive){
          window._brushActive=false;
          $('brushPaintBtn').classList.remove('on');$('brushEraseBtn').classList.remove('on');
        }
      }
    });
  });

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&pickStep){
      pickStep=0;$('drawBoxBtn').textContent='✛ SET POINTS ON IMAGE';
      drawOverlay();
    }
    if(e.key==='Escape'&&window._brushActive){
      window._brushActive=false;
      $('brushPaintBtn').classList.remove('on');$('brushEraseBtn').classList.remove('on');
    }
  });
})();

// ── COLOR DROPPER (reusable) ──────────────────────────────────
(function(){
  const overlay=$('dropperOverlay');
  const mag=$('dropperMag');
  const magCtx=$('dropperMagCanvas').getContext('2d');
  const origCv=$('origCanvas');
  let active=false;
  let activeBtn=null;
  let pickCallback=null;

  function hexFromRgb(r,g,b){
    return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  }

  function getPixelAt(e){
    const rect=origCv.getBoundingClientRect();
    const scaleX=origCv.width/rect.width;
    const scaleY=origCv.height/rect.height;
    const cx=Math.floor((e.clientX-rect.left)*scaleX);
    const cy=Math.floor((e.clientY-rect.top)*scaleY);
    const px=Math.max(0,Math.min(origCv.width-1,cx));
    const py=Math.max(0,Math.min(origCv.height-1,cy));
    const d=origCv.getContext('2d').getImageData(px,py,1,1).data;
    return {r:d[0],g:d[1],b:d[2]};
  }

  function updateMag(e){
    const rect=origCv.getBoundingClientRect();
    const scaleX=origCv.width/rect.width;
    const scaleY=origCv.height/rect.height;
    const cx=Math.floor((e.clientX-rect.left)*scaleX);
    const cy=Math.floor((e.clientY-rect.top)*scaleY);
    const radius=12;
    magCtx.imageSmoothingEnabled=false;
    magCtx.drawImage(origCv,cx-radius,cy-radius,radius*2,radius*2,0,0,80,80);
    const vp=$('vp-orig').getBoundingClientRect();
    mag.style.left=(e.clientX-vp.left)+'px';
    mag.style.top=(e.clientY-vp.top)+'px';
  }

  function enterDropper(btn, cb){
    if(active) exitDropper();
    activeBtn=btn;
    pickCallback=cb;
    active=true;
    if(btn){btn.classList.add('active');btn.title='Click image to pick — Escape to cancel';}
    if(S.video.el){
      origCanvas.width=S.imgW;origCanvas.height=S.imgH;
      origCanvas.getContext('2d').drawImage(S.video.el,0,0,S.imgW,S.imgH);
      owrap.style.display='block';$('videoPreview').style.display='none';
    }
    switchTab('orig');
    overlay.classList.add('on');
    showToast('Click the image to pick a color');
  }

  function exitDropper(){
    active=false;
    if(activeBtn){activeBtn.classList.remove('active');activeBtn.title='Pick color from image';}
    activeBtn=null;pickCallback=null;
    overlay.classList.remove('on');
    mag.classList.remove('on');
    if(S.video.el){owrap.style.display='none';$('videoPreview').style.display='block';}
  }

  // Expose globally so any dropper button can call it
  window.openDropper=function(btn, cb){
    if(!S.image){showToast('Load an image first');return;}
    if(active&&activeBtn===btn){exitDropper();return;}
    enterDropper(btn,cb);
  };

  overlay.addEventListener('mousemove',e=>{if(!active)return;mag.classList.add('on');updateMag(e);});
  overlay.addEventListener('mouseleave',()=>{mag.classList.remove('on');});
  overlay.addEventListener('click',e=>{
    if(!active)return;
    const{r,g,b}=getPixelAt(e);
    const hex=hexFromRgb(r,g,b);
    if(pickCallback) pickCallback(hex,e.shiftKey);
    exitDropper();
    showToast(`Color picked: ${hex.toUpperCase()}`);
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active)exitDropper();});

  // Wire the region color dropper button
  const regionBtn=$('dropperBtn');
  if(regionBtn){
    regionBtn.addEventListener('click',()=>{
      window.openDropper(regionBtn,(hex,shift)=>{
        if(shift){
          if(!S.targetColors.includes(hex))S.targetColors.push(hex);
          renderColorList();
        }else{
          S.targetColors=[hex];
          $('regionColor').value=hex;$('regionColorHex').value=hex;$('regionColorSwatch').style.background=hex;
          renderColorList();
        }
        scheduleRender();switchTab('ascii');
      });
    });
  }
})();

// ── MULTI-COLOR LIST ─────────────────────────────────────────
function renderColorList(){
  const list=$('colorList');if(!list)return;
  list.innerHTML='';
  S.targetColors.forEach((hex,i)=>{
    const swatch=document.createElement('div');
    swatch.style.cssText=`width:20px;height:20px;border-radius:2px;background:${hex};cursor:pointer;border:1px solid var(--b2);flex-shrink:0;position:relative`;
    swatch.title=`${hex} — click to remove`;
    swatch.addEventListener('click',()=>{
      S.targetColors.splice(i,1);
      if(!S.targetColors.length) S.targetColors=['#ff0000'];
      const primary=S.targetColors[0];
      $('regionColor').value=primary;$('regionColorHex').value=primary;$('regionColorSwatch').style.background=primary;
      renderColorList();scheduleRender();
    });
    list.appendChild(swatch);
  });
}
// Wire addColorBtn
$('addColorBtn')&&$('addColorBtn').addEventListener('click',()=>{
  const hex=$('regionColor').value;
  if(!S.targetColors.includes(hex)) S.targetColors.push(hex);
  renderColorList();scheduleRender();
});
// Init color list
renderColorList();

// ── BRUSH TOOL ───────────────────────────────────────────────
(function(){
  let brushMode=null; // 'paint' or 'erase'
  let painting=false;

  function initBrushMask(){
    if(!S.imgW||!S.imgH)return;
    if(!S.brushMask||S.brushMask.length!==S.imgW*S.imgH){
      S.brushMask=new Float32Array(S.imgW*S.imgH);
    }
  }

  function getBrushSize(){return parseInt($('brushSize').value)||20;}

  function paintAt(ex,ey,erase){
    initBrushMask();
    const rect=origCanvas.getBoundingClientRect();
    const scaleX=S.imgW/rect.width;
    const scaleY=S.imgH/rect.height;
    const cx=Math.floor((ex-rect.left)*scaleX);
    const cy=Math.floor((ey-rect.top)*scaleY);
    const r=Math.max(1,getBrushSize()*scaleX*0.5);
    const x0=Math.max(0,Math.floor(cx-r)), x1=Math.min(S.imgW-1,Math.ceil(cx+r));
    const y0=Math.max(0,Math.floor(cy-r)), y1=Math.min(S.imgH-1,Math.ceil(cy+r));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const dist=Math.sqrt((x-cx)**2+(y-cy)**2);
      if(dist<=r) S.brushMask[y*S.imgW+x]=erase?0:1;
    }
  }

  function drawBrushOverlay(){
    const cv=$('boxDrawCanvas');
    const ctx=cv.getContext('2d');
    // Only resize if dimensions changed — avoids context reset flicker
    if(cv.width!==origCanvas.width||cv.height!==origCanvas.height){
      cv.width=origCanvas.width;cv.height=origCanvas.height;
    }
    ctx.clearRect(0,0,cv.width,cv.height);
    if(!S.brushMask)return;
    const imgd=ctx.createImageData(cv.width,cv.height);
    for(let i=0;i<S.brushMask.length;i++){
      if(S.brushMask[i]>0){
        imgd.data[i*4]=100;imgd.data[i*4+1]=255;imgd.data[i*4+2]=66;imgd.data[i*4+3]=80;
      }
    }
    ctx.putImageData(imgd,0,0);
  }

  function enterBrush(mode){
    if(!S.image){showToast('Load an image first');return;}
    brushMode=mode;
    window._brushActive=true;
    // Clear any manual-box overlay that may be showing
    const cv=$('boxDrawCanvas');
    if(cv.width!==origCanvas.width||cv.height!==origCanvas.height){
      cv.width=origCanvas.width;cv.height=origCanvas.height;
    }
    if(S.video.el){
      origCanvas.width=S.imgW;origCanvas.height=S.imgH;
      origCanvas.getContext('2d').drawImage(S.video.el,0,0,S.imgW,S.imgH);
      owrap.style.display='block';$('videoPreview').style.display='none';
    }
    initBrushMask();
    drawBrushOverlay();
    $('boxDrawCanvas').style.display='block';
    $('boxDrawCanvas').style.cursor='crosshair';
    switchTab('orig');
    $('brushPaintBtn').classList.toggle('on',mode==='paint');
    $('brushEraseBtn').classList.toggle('on',mode==='erase');
    showToast(mode==='paint'?'Click/drag to paint region':'Click/drag to erase region');
  }

  $('brushPaintBtn').addEventListener('click',()=>{
    if(brushMode==='paint'){brushMode=null;window._brushActive=false;$('brushPaintBtn').classList.remove('on');}
    else{enterBrush('paint');}
  });
  $('brushEraseBtn').addEventListener('click',()=>{
    if(brushMode==='erase'){brushMode=null;window._brushActive=false;$('brushEraseBtn').classList.remove('on');}
    else{enterBrush('erase');}
  });
  $('brushClearBtn').addEventListener('click',()=>{
    S.brushMask=new Float32Array(S.imgW*S.imgH);
    drawBrushOverlay();scheduleRender();
  });
  linkSI('brushSizeSlider','brushSize',()=>{});

  $('boxDrawCanvas').addEventListener('mousedown',e=>{
    if(!brushMode)return;
    painting=true;
    paintAt(e.clientX,e.clientY,brushMode==='erase');
    drawBrushOverlay();
  });
  $('boxDrawCanvas').addEventListener('mousemove',e=>{
    if(!painting||!brushMode)return;
    paintAt(e.clientX,e.clientY,brushMode==='erase');
    drawBrushOverlay();
  });
  $('boxDrawCanvas').addEventListener('mouseup',()=>{
    if(!painting)return;
    painting=false;
    scheduleRender();
  });
  $('boxDrawCanvas').addEventListener('mouseleave',()=>{
    if(painting){painting=false;scheduleRender();}
  });
})();
const gFonts=CONFIG.fonts.extraMono;
gFonts.forEach(f=>{
  const l=document.createElement('link');l.rel='stylesheet';
  l.href=CONFIG.urls.googleFonts+f+'&display=swap';
  document.head.appendChild(l);
});
$('renderFont').addEventListener('change',()=>{
  S.renderFont=$('renderFont').value;
  const prev=$('fontPreview');
  prev.style.fontFamily=`"${S.renderFont}",monospace`;
  scheduleRender();
});

// ── BACKGROUND COLOR ──────────────────────────────────────────
document.querySelectorAll('[data-bg]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-bg]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');
    S.bgStyle=p.dataset.bg;
    $('bgColorRow').style.display=S.bgStyle==='custom'?'block':'none';
    scheduleRender();
  });
});
$('bgColorPicker').addEventListener('input',()=>{
  const v=$('bgColorPicker').value;
  S.bgColor=v;$('bgColorHex').value=v;$('bgColorSwatch').style.background=v;
  scheduleRender();
});
$('bgColorHex').addEventListener('change',()=>{
  const v=$('bgColorHex').value;
  if(/^#[0-9a-fA-F]{6}$/.test(v)){
    S.bgColor=v;$('bgColorPicker').value=v;$('bgColorSwatch').style.background=v;
    scheduleRender();
  }
});

// ── NAMED PRESETS ─────────────────────────────────────────────
const PRESET_KEY='asciirender_presets';
function loadPresets(){
  try{return JSON.parse(localStorage.getItem(PRESET_KEY)||'[]');}
  catch(e){return[];}
}
function savePresets(arr){localStorage.setItem(PRESET_KEY,JSON.stringify(arr));}
function renderPresetList(){
  const body=$('pmBody');body.innerHTML='';
  const presets=loadPresets();
  if(!presets.length){
    const em=document.createElement('div');em.className='pm-empty';
    em.textContent='No presets saved yet. Tweak your settings and save one!';
    body.appendChild(em);return;
  }
  presets.forEach((p,i)=>{
    const row=document.createElement('div');row.className='pm-row';
    const name=document.createElement('div');name.className='pm-name';name.textContent=p.name;
    const date=document.createElement('div');date.className='pm-date';date.textContent=p.date||'';
    const del=document.createElement('button');del.className='pm-del';del.textContent='×';
    del.title='Delete';
    del.addEventListener('click',e=>{
      e.stopPropagation();
      const arr=loadPresets();arr.splice(i,1);savePresets(arr);renderPresetList();
    });
    row.appendChild(name);row.appendChild(date);row.appendChild(del);
    row.addEventListener('click',()=>{
      pushUndo();applySnap(p.snap,false);
      $('presetModal').classList.remove('on');
      showToast(`Loaded: ${p.name}`);
    });
    body.appendChild(row);
  });
}
$('btnPresets').addEventListener('click',()=>{renderPresetList();$('presetModal').classList.add('on');});
$('pmClose').addEventListener('click',()=>$('presetModal').classList.remove('on'));
$('presetModal').addEventListener('click',e=>{if(e.target===$('presetModal'))$('presetModal').classList.remove('on');});
$('pmSaveBtn').addEventListener('click',()=>{
  const name=$('pmNameInput').value.trim();
  if(!name){showToast('Enter a preset name first');return;}
  const arr=loadPresets();
  const now=new Date().toLocaleDateString();
  arr.unshift({name,date:now,snap:getSnap()});
  if(arr.length>40)arr.length=40;
  savePresets(arr);
  $('pmNameInput').value='';
  renderPresetList();
  showToast(`Saved: ${name}`);
});
$('pmNameInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('pmSaveBtn').click();});
// Also wire up paste from clipboard for images
document.addEventListener('paste',e=>{
  const items=e.clipboardData&&e.clipboardData.items;
  if(!items)return;
  for(const item of items){
    if(item.type.startsWith('image/')){
      const f=item.getAsFile();
      if(f)loadFile(f);
      break;
    }
  }
});

// ── HEX ICON TOGGLE HELPER ────────────────────────────────────
function setHexLock(btn, barId, locked){
  btn.classList.toggle('on', locked);
  $(barId).setAttribute('opacity', locked ? '1' : '0');
}

// ── ASPECT RATIO LOCK ──────────────────────────────────────────
function enforceAR(changed){
  if(!S.arLocked||!S.arRatio)return;
  if(changed==='w'){
    const w=parseFloat($('outWVal').value)||1;
    const h=Math.max(1,Math.round(w/S.arRatio));
    $('outHSlider').value=Math.min(h,2160);$('outHVal').value=h;
  }else{
    const h=parseFloat($('outHVal').value)||1;
    const w=Math.max(1,Math.round(h*S.arRatio));
    $('outWSlider').value=Math.min(w,3840);$('outWVal').value=w;
  }
}
$('arLockBtn').addEventListener('click',()=>{
  S.arLocked=!S.arLocked;
  if(S.arLocked){
    const w=parseFloat($('outWVal').value)||1,h=parseFloat($('outHVal').value)||1;
    S.arRatio=w/h;
  }else{
    S.arRatio=null;
  }
  setHexLock($('arLockBtn'),'arHexBar',S.arLocked);
});
// Init AR lock visual state (starts locked)
setHexLock($('arLockBtn'),'arHexBar',true);

// ── BLOCK / FONT LOCK ─────────────────────────────────────────
$('bfLockBtn').addEventListener('click',()=>{
  S.bfLocked=!S.bfLocked;
  setHexLock($('bfLockBtn'),'bfHexBar',S.bfLocked);
  $('bfLockLabel').textContent=S.bfLocked?'Block locked to font':'Block & font independent';
  if(S.bfLocked){
    const bv=$('blockVal').value;
    $('fontVal').value=bv;$('fontSlider').value=bv;
    scheduleRender();
  }
});
// Init BF lock visual state (starts locked)
setHexLock($('bfLockBtn'),'bfHexBar',true);

// ── CELL MODE ─────────────────────────────────────────────────
const cellHints={
  fit:    'Each cell fills the canvas exactly — output canvas matches the W×H resolution set above.',
  square: 'Each cell is square (font size × font size). Output size determined by char count × font size.'
};
document.querySelectorAll('[data-cell]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-cell]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');S.cellMode=p.dataset.cell;
    $('cellModeHint').textContent=cellHints[S.cellMode];
    scheduleRender();
  });
});

linkSI('outWSlider','outWVal',()=>{enforceAR('w');scheduleRender();});
linkSI('outHSlider','outHVal',()=>{enforceAR('h');scheduleRender();});
linkSI('blockSlider','blockVal',v=>{
  if(S.bfLocked){$('fontVal').value=v;$('fontSlider').value=Math.min(v,48);}
  scheduleRender();
});
linkSI('fontSlider','fontVal',v=>{
  if(S.bfLocked){$('blockVal').value=v;$('blockSlider').value=Math.min(v,80);}
  scheduleRender();
});
linkSI('scaleSlider','scaleVal',scheduleRender);
linkSI('invertSlider','invertVal',scheduleRender);
linkSI('lockSlider','lockVal',scheduleRender);
linkSI('maxMpSlider','maxMpVal',v=>S.cfg.maxMp=v);
linkSI('maxOutSlider','maxOutVal',v=>S.cfg.maxOut=v);
linkSI('chunkSlider','chunkVal',v=>S.cfg.chunkRows=v);
linkSI('wdogSlider','wdogVal',v=>S.cfg.wdogSec=v);

// ── PRESETS ────────────────────────────────────────────────────
$('resPreset').addEventListener('change',()=>{
  const v=$('resPreset').value; if(v==='custom')return;
  let w,h;
  if(v==='source'){
    if(!S.image)return;
    w=S.imgW;h=S.imgH;
  }else{[w,h]=v.split('x').map(Number);}
  $('outWSlider').value=Math.min(w,3840);$('outWVal').value=w;
  $('outHSlider').value=Math.min(h,2160);$('outHVal').value=h;
  // If locked, re-capture ratio from new dims
  if(S.arLocked){S.arRatio=w/h;}
  scheduleRender();
});

// ── FILE LOAD ──────────────────────────────────────────────────
const dropZone=$('dropZone'),fileInput=$('fileInput');
dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('over');});
dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('over'));
dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.classList.remove('over');const f=e.dataTransfer.files[0];if(f)loadFile(f);});
function onFileSelected(){
  const f=fileInput.files[0];
  if(!f)return;
  fileInput.value='';
  loadFile(f);
}
fileInput.addEventListener('change',onFileSelected);
fileInput.addEventListener('input',onFileSelected);

function loadFile(file){
  const rawExts=/\.(arw|cr2|cr3|nef|nrw|orf|raf|rw2|dng|pef|srw|x3f|raw)$/i;
  if(rawExts.test(file.name)){loadRaw(file);return;}
  if(file.type==='image/gif'||/\.gif$/i.test(file.name)){loadGif(file);return;}
  if(file.type.startsWith('video/')||/\.(mp4|webm|mov|avi)$/i.test(file.name)){loadVideo(file);return;}
  // Switching to static image — tear down GIF/video state
  gifStop();gifRendered.length=0;S.gif.frames=[];S.gif.delays=[];S.gif.totalFrames=0;S.gif.current=0;
  $('gifControls').style.display='none';
  $('animTab').style.display='none';$('animWrap').style.display='none';$('animEmptyMsg').style.display='block';
  $('videoPreview').src='';$('videoPreview').style.display='none';
  owrap.style.display='block';
  S.video.el=null;S.video.totalFrames=0;
  const banner=$('gifReRenderBanner');if(banner)banner.remove();
  if($('exportFmt').value==='gif'||$('exportFmt').value==='webm')$('exportFmt').value='jpg-90';
  S.filename=file.name.replace(/\.[^.]+$/,'');
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      S.image=img;S.imgW=img.width;S.imgH=img.height;
      origCanvas.width=img.width;origCanvas.height=img.height;
      origCanvas.getContext('2d').drawImage(img,0,0);
      owrap.style.display='block';
      setBadge('LOADED','done');
      $('hdrInfo').textContent=`${file.name}  ·  ${img.width}×${img.height}px`;
      $('btnRender').disabled=false;$('sfRender').disabled=false;
      // Always set sliders to source dims; user can override with preset
      $('outWSlider').value=Math.min(img.width,3840);$('outWVal').value=img.width;
      $('outHSlider').value=Math.min(img.height,2160);$('outHVal').value=img.height;
      if(S.arLocked)S.arRatio=img.width/img.height;
      scheduleRender();
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function loadRaw(file){
  $('hdrInfo').textContent=`Loading RAW: ${file.name}…`;
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{
    S.image=img;S.imgW=img.width;S.imgH=img.height;
    S.filename=file.name.replace(/\.[^.]+$/,'');
    origCanvas.width=img.width;origCanvas.height=img.height;
    origCanvas.getContext('2d').drawImage(img,0,0);
    owrap.style.display='block';
    setBadge('LOADED','done');
    $('hdrInfo').textContent=`${file.name} [RAW]  ·  ${img.width}×${img.height}px`;
    $('btnRender').disabled=false;$('sfRender').disabled=false;
    $('outWSlider').value=Math.min(img.width,3840);$('outWVal').value=img.width;
    $('outHSlider').value=Math.min(img.height,2160);$('outHVal').value=img.height;
    URL.revokeObjectURL(url);
    scheduleRender();
  };
  img.onerror=()=>{
    URL.revokeObjectURL(url);
    $('hdrInfo').textContent=`RAW decode failed — convert to DNG/JPG/TIFF first`;
    setBadge('ERROR','warn');
    emptyMsg.innerHTML='<span class="empty-g">⚠</span>RAW not decoded by your browser.<br>Convert in Lightroom, darktable, or Preview first.';
    emptyMsg.style.display='block';
  };
  img.src=url;
}

// ── GIF LOADER & ASCII ANIMATOR ────────────────────────────────
const gifRendered=[];

function loadGif(file){
  gifStop();
  gifRendered.length=0;
  S.gif.frames=[];S.gif.delays=[];S.gif.totalFrames=0;S.gif.current=0;
  $('gifControls').style.display='none';
  $('animTab').style.display='none';$('animWrap').style.display='none';$('animEmptyMsg').style.display='block';
  $('videoPreview').src='';$('videoPreview').style.display='none';
  S.video.el=null;S.video.totalFrames=0;
  S.filename=file.name.replace(/\.[^.]+$/,'');
  $('hdrInfo').textContent=`Loading GIF: ${file.name}…`;
  setBadge('LOADING','busy');
  const reader=new FileReader();
  reader.onload=e=>{
    const buf=e.target.result;
    let gr;
    try{gr=new GifReader(new Uint8Array(buf));}
    catch(err){setBadge('ERROR','warn');$('hdrInfo').textContent='GIF parse failed: '+err.message;return;}
    const nFrames=gr.numFrames(),W=gr.width,H=gr.height;
    S.imgW=W;S.imgH=H;
    $('hdrInfo').textContent=`Decoding ${nFrames} frames…`;
    // Decode each frame composited on top of previous (handle disposal)
    const composite=new Uint8ClampedArray(W*H*4);
    for(let f=0;f<nFrames;f++){
      const info=gr.frameInfo(f);
      const pixels=new Uint8ClampedArray(W*H*4);
      pixels.set(composite);
      gr.decodeAndBlitFrameRGBA(f,pixels);
      composite.set(pixels);
      S.gif.frames.push(new ImageData(new Uint8ClampedArray(pixels),W,H));
      S.gif.delays.push(Math.max(20,(info.delay||10)*10));
    }
    S.gif.totalFrames=nFrames;
    // Show first frame in origCanvas (for box drawing / dropper)
    origCanvas.width=W;origCanvas.height=H;
    origCanvas.getContext('2d').putImageData(S.gif.frames[0],0,0);
    owrap.style.display='block';
    $('videoPreview').style.display='none';
    $('origTab').style.display='block';
    // Set S.image to first frame canvas for settings/preview
    const fc=document.createElement('canvas');fc.width=W;fc.height=H;
    fc.getContext('2d').putImageData(S.gif.frames[0],0,0);
    S.image=fc;
    $('btnRender').disabled=false;$('sfRender').disabled=false;
    $('outWSlider').value=Math.min(W,3840);$('outWVal').value=W;
    $('outHSlider').value=Math.min(H,2160);$('outHVal').value=H;
    $('exportFmt').value='gif';
    setBadge('READY','done');
    $('hdrInfo').textContent=`${file.name}  ·  ${W}×${H}  ·  ${nFrames} frames  ·  Click RENDER to begin`;
    // Render frame 0 as a static preview in ASCII Output
    startRender(()=>{
      emptyMsg.style.display='none';awrap.style.display='block';
      switchTab('ascii');
    });
  };
  reader.readAsArrayBuffer(file);
}

function renderGifFrames(idx,total,onDone){
  if(idx>=total){onDone();return;}
  chunkInfo.style.display='block';
  chunkInfo.textContent=`Encoding frame ${idx+1}/${total}…`;
  setProgress(Math.round((idx/total)*95));
  const fc=document.createElement('canvas');
  fc.width=S.imgW;fc.height=S.imgH;
  fc.getContext('2d').putImageData(S.gif.frames[idx],0,0);
  S.image=fc;

  function doRender(){
    startRender((finishedCanvas)=>{
      const snap=document.createElement('canvas');
      snap.width=finishedCanvas.width;snap.height=finishedCanvas.height;
      snap.getContext('2d').drawImage(finishedCanvas,0,0);
      gifRendered[idx]=snap;
      setTimeout(()=>renderGifFrames(idx+1,total,onDone),0);
    });
  }

  // Per-frame subject re-detection for GIFs
  if(S.region==='subject'&&cocoModel){
    const minConf=(parseFloat(($('subjectConf')&&$('subjectConf').value)||50))/100;
    const dmode=(document.querySelector('#detectModePills .pill.on')||{}).dataset?.dmode||'object';
    const detect=dmode==='face'&&('FaceDetector' in window)
      ? new FaceDetector({fastMode:true,maxDetectedFaces:20}).detect(fc).then(faces=>
          faces.map(f=>({bbox:[f.boundingBox.x,f.boundingBox.y,f.boundingBox.width,f.boundingBox.height],score:1}))
        )
      : cocoModel.detect(fc).then(preds=>preds.filter(p=>p.score>=minConf));
    detect.then(results=>{
      // Only update boxes if detection found something — otherwise hold last known position
      if(results.length>0){
        S.subjectBoxes=results.map(p=>({
          x:p.bbox[0]/S.imgW,y:p.bbox[1]/S.imgH,
          w:p.bbox[2]/S.imgW,h:p.bbox[3]/S.imgH,
          label:p.class||'face',score:Math.round((p.score||1)*100),active:true
        }));
      }
      doRender();
    }).catch(()=>doRender());
  }else{
    doRender();
  }
}

function showGifControls(){
  $('gifControls').style.display='flex';
  $('animTab').style.display='block';
  chunkInfo.style.display='none';
  $('btnExport').disabled=false;$('sfExport').disabled=false;
}

function gifPlay(){
  if(S.gif.playing)return;
  S.gif.playing=true;
  $('gifPlayBtn').textContent='⏸ PAUSE';
  // Size animCanvas once at play start — never resize mid-playback
  if(gifRendered.length){
    const first=gifRendered[0];
    if(animCanvas.width!==first.width||animCanvas.height!==first.height){
      animCanvas.width=first.width;animCanvas.height=first.height;
    }
    $('animEmptyMsg').style.display='none';$('animWrap').style.display='block';
    fitToScreen('anim');
  }
  // Cache the 2d context once
  S.gif._ctx=animCanvas.getContext('2d');
  S.gif._loopMs=S.gif.delays.reduce((a,d)=>a+(d||100),0)||1000;
  S.gif._startTime=performance.now()-gifFrameTimeOffset(S.gif.current);
  gifTick();
}
function gifStop(){
  clearTimeout(S.gif.timer);
  S.gif.playing=false;
  S.gif._ctx=null;
  if($('gifPlayBtn'))$('gifPlayBtn').textContent='▶ PLAY';
}
function gifFrameTimeOffset(frameIdx){
  let t=0;
  for(let i=0;i<frameIdx;i++) t+=S.gif.delays[i]||100;
  return t;
}
function gifTick(){
  if(!S.gif.playing||!gifRendered.length)return;
  const f=S.gif.current;
  const frame=gifRendered[f];
  if(frame&&S.gif._ctx){
    // Clear and draw — never reassign width/height (causes reflow)
    S.gif._ctx.clearRect(0,0,animCanvas.width,animCanvas.height);
    S.gif._ctx.drawImage(frame,0,0);
  }
  $('gifFrameLabel').textContent=`${f+1}/${S.gif.totalFrames}`;
  const thisFrameDelay=S.gif.delays[f]||100;
  S.gif.current=(f+1)%S.gif.totalFrames;
  // Wall-clock correction: compute how many ms until the next frame is due
  const now=performance.now();
  const loopElapsed=(now-S.gif._startTime)%S.gif._loopMs;
  const nextFrameOffset=gifFrameTimeOffset(S.gif.current);
  let delay=nextFrameOffset-loopElapsed;
  if(delay<0) delay+=S.gif._loopMs;
  S.gif.timer=setTimeout(gifTick, Math.max(4, delay));
}

async function exportGif(fname){
  if(!gifRendered.length){alert('No GIF frames rendered. Load a GIF and wait for encoding.');return;}
  setBadge('EXPORTING','busy');
  chunkInfo.style.display='block';
  chunkInfo.textContent='Fetching GIF encoder…';
  // Fetch worker as a blob URL to bypass CORS restrictions on web worker scripts
  let workerBlob;
  try{
    const resp=await fetch(CONFIG.urls.gifWorker);
    const blob=await resp.blob();
    workerBlob=URL.createObjectURL(blob);
  }catch(e){
    chunkInfo.style.display='none';
    setBadge('ERROR','warn');
    alert('Could not fetch GIF encoder worker. Check your internet connection.');
    return;
  }
  chunkInfo.textContent='Building GIF…';
  const gif=new GIF({workers:2,quality:10,workerScript:workerBlob});
  gifRendered.forEach((canvas,i)=>gif.addFrame(canvas,{delay:S.gif.delays[i]||100,copy:true}));
  gif.on('progress',p=>{
    chunkInfo.textContent=`Encoding GIF… ${Math.round(p*100)}%`;
    setProgress(Math.round(p*100));
  });
  gif.on('finished',blob=>{
    URL.revokeObjectURL(workerBlob);
    chunkInfo.style.display='none';
    setProgress(100);setBadge('DONE','done');
    const a=document.createElement('a');
    a.download=fname+'-ascii.gif';
    a.href=URL.createObjectURL(blob);
    a.click();
  });
  gif.render();
}

$('gifPlayBtn').addEventListener('click',()=>{if(S.gif.playing)gifStop();else gifPlay();});
$('gifPrevBtn').addEventListener('click',()=>{
  gifStop();
  S.gif.current=(S.gif.current-1+S.gif.totalFrames)%S.gif.totalFrames;
  const f=gifRendered[S.gif.current];
  if(f){
    if(animCanvas.width!==f.width||animCanvas.height!==f.height){animCanvas.width=f.width;animCanvas.height=f.height;}
    animCanvas.getContext('2d').clearRect(0,0,animCanvas.width,animCanvas.height);
    animCanvas.getContext('2d').drawImage(f,0,0);
  }
  $('gifFrameLabel').textContent=`${S.gif.current+1}/${S.gif.totalFrames}`;
});
$('gifNextBtn').addEventListener('click',()=>{
  gifStop();
  S.gif.current=(S.gif.current+1)%S.gif.totalFrames;
  const f=gifRendered[S.gif.current];
  if(f){
    if(animCanvas.width!==f.width||animCanvas.height!==f.height){animCanvas.width=f.width;animCanvas.height=f.height;}
    animCanvas.getContext('2d').clearRect(0,0,animCanvas.width,animCanvas.height);
    animCanvas.getContext('2d').drawImage(f,0,0);
  }
  $('gifFrameLabel').textContent=`${S.gif.current+1}/${S.gif.totalFrames}`;
});

// ── VIDEO ENGINE ───────────────────────────────────────────────
let videoRenderAbort=false, videoRenderFrames=[];

function loadVideo(file){
  gifStop();gifRendered.length=0;S.gif.frames=[];S.gif.delays=[];S.gif.totalFrames=0;
  $('gifControls').style.display='none';
  $('animTab').style.display='none';$('animWrap').style.display='none';$('animEmptyMsg').style.display='block';
  S.filename=file.name.replace(/\.[^.]+$/,'');
  $('hdrInfo').textContent=`Loading video: ${file.name}…`;
  setBadge('LOADING','busy');
  const url=URL.createObjectURL(file);
  const vid=document.createElement('video');
  vid.preload='auto';
  vid.src=url;
  vid.muted=true;
  vid.onloadedmetadata=()=>{
    S.video.el=vid;
    S.video.duration=vid.duration;
    S.video.fps=24;
    S.video.totalFrames=Math.ceil(vid.duration*S.video.fps);
    S.imgW=vid.videoWidth;S.imgH=vid.videoHeight;
    // Show video in the unified Original pane
    const vp=$('videoPreview');
    vp.src=url;vp.style.display='block';
    owrap.style.display='none';
    $('origTab').style.display='block';
    switchTab('orig');
    // Set sliders
    $('outWSlider').value=Math.min(vid.videoWidth,3840);$('outWVal').value=vid.videoWidth;
    $('outHSlider').value=Math.min(vid.videoHeight,2160);$('outHVal').value=vid.videoHeight;
    $('btnRender').disabled=false;$('sfRender').disabled=false;
    if(S.arLocked)S.arRatio=S.imgW/S.imgH;
    setBadge('READY','done');
    $('hdrInfo').textContent=`${file.name}  ·  ${vid.videoWidth}×${vid.videoHeight}  ·  ${vid.duration.toFixed(1)}s  ·  Click RENDER to begin`;
    // Wait until the browser has buffered enough to draw a real frame
    const extractFrame0=()=>{
      const fc=document.createElement('canvas');
      fc.width=S.imgW;fc.height=S.imgH;
      const doExtract=()=>{
        fc.getContext('2d').drawImage(vid,0,0,S.imgW,S.imgH);
        S.image=fc;
        startRender(()=>{
          emptyMsg.style.display='none';awrap.style.display='block';
          $('btnExport').disabled=false;$('sfExport').disabled=false;
          switchTab('ascii');
        });
      };
      let extracted=false;
      vid.onseeked=()=>{
        if(extracted)return;
        extracted=true;
        vid.onseeked=null;
        doExtract();
      };
      vid.currentTime=0;
      // Fallback in case onseeked never fires (some MP4s on some browsers)
      setTimeout(()=>{
        if(extracted)return;
        extracted=true;
        vid.onseeked=null;
        doExtract();
      },1000);
    };
    // Wait for canplay so the video has actual decoded frame data
    if(vid.readyState>=3){
      extractFrame0();
    }else{
      vid.oncanplay=()=>{vid.oncanplay=null;extractFrame0();};
    }
  };
  vid.onerror=()=>{
    URL.revokeObjectURL(url);
    setBadge('ERROR','warn');
    $('hdrInfo').textContent='Video could not be decoded by this browser.';
  };
  vid.load();
}

let pendingVideoFormat='webm';
function selectVFormat(fmt){
  pendingVideoFormat=fmt;
  document.querySelectorAll('.vcard').forEach(c=>c.classList.remove('selected'));
  $(fmt==='gif'?'vcardGif':'vcardWebm').classList.add('selected');
}

function showVideoModal(fname, vid){
  const fps=S.video.fps;
  const frames=S.video.totalFrames;
  const dur=vid.duration;
  const w=parseInt($('outWVal').value)||vid.videoWidth;
  const h=parseInt($('outHVal').value)||vid.videoHeight;
  const bs=parseFloat($('blockVal').value)||8;
  const cols=Math.floor(w/bs), rows=Math.floor(h/bs);
  // Estimate: ~15ms per frame on a mid-range machine (conservative)
  const msPerFrame=15+(cols*rows*0.002);
  const totalSec=frames*msPerFrame/1000;
  const gifSec=frames*msPerFrame*1.4/1000; // GIF dithering overhead
  function fmt(s){const m=Math.floor(s/60);const ss=Math.round(s%60);return`${m}:${ss.toString().padStart(2,'0')}`;}
  $('vmodalInfo').textContent=`${fname}  ·  ${vid.videoWidth}×${vid.videoHeight}  ·  ${dur.toFixed(1)}s  ·  ~${frames} frames at ${fps}fps`;
  $('vmodalEst').innerHTML=
    `<b style="color:var(--acc)">Estimated render time:</b><br>`+
    `WebM: <span style="color:var(--acc)">${fmt(totalSec)}</span> — full color, small file, audio preserved<br>`+
    `GIF: <span style="color:var(--acc)">${fmt(gifSec)}</span> — 256 colors, larger file, no audio<br><br>`+
    `<b>Tip:</b> Increase block size or lower resolution to speed up render.`;
  $('vmodalEst').classList.add('on');
  $('vmodalConfirm').disabled=false;
  $('videoModal').classList.add('on');
}

$('vmodalCancel').addEventListener('click',()=>$('videoModal').classList.remove('on'));
$('vmodalConfirm').addEventListener('click',()=>{
  $('videoModal').classList.remove('on');
  S.video.format=pendingVideoFormat;
  $('exportFmt').value=pendingVideoFormat==='gif'?'gif':'webm';
  startVideoRender();
});

// ETA tracking
let etaStartTime=0, etaFramesDone=0;
function startEta(total){
  etaStartTime=Date.now();etaFramesDone=0;
  $('etaTotal').textContent=total;
  $('etaBar').classList.add('on');
  updateEta(0,total);
}
function updateEta(done,total){
  etaFramesDone=done;
  $('etaFrame').textContent=done;
  const elapsed=(Date.now()-etaStartTime)/1000;
  const elM=Math.floor(elapsed/60),elS=Math.round(elapsed%60);
  $('etaElapsed').textContent=`${elM}:${elS.toString().padStart(2,'0')}`;
  if(done>2){
    const perFrame=elapsed/done;
    const remaining=perFrame*(total-done);
    const rM=Math.floor(remaining/60),rS=Math.round(remaining%60);
    $('etaRemaining').textContent=`${rM}:${rS.toString().padStart(2,'0')}`;
  }
}
function stopEta(){$('etaBar').classList.remove('on');}

async function startVideoRender(){
  const vid=S.video.el;
  if(!vid){alert('No video loaded.');return;}
  videoRenderAbort=false;
  videoRenderFrames=[];
  const fps=S.video.fps;
  const totalFrames=S.video.totalFrames;
  setBadge('RENDERING','busy');
  $('btnRender').disabled=true;
  startEta(totalFrames);
  chunkInfo.style.display='block';
  await renderVideoFrames(vid,fps,totalFrames);
  if(videoRenderAbort){stopEta();setBadge('ABORTED','warn');$('btnRender').disabled=false;return;}
  chunkInfo.style.display='none';
  stopEta();
  // Show first rendered frame in Animated Output tab
  if(videoRenderFrames[0]){
    animCanvas.width=videoRenderFrames[0].width;animCanvas.height=videoRenderFrames[0].height;
    animCanvas.getContext('2d').drawImage(videoRenderFrames[0],0,0);
    $('animEmptyMsg').style.display='none';$('animWrap').style.display='block';
    $('animTab').style.display='block';
    $('btnExport').disabled=false;$('sfExport').disabled=false;
    switchTab('anim');
  }
  setBadge('ENCODING','busy');
  $('hdrInfo').textContent=`Encoding ${totalFrames} frames as ${S.video.format.toUpperCase()}…`;
  if(S.video.format==='gif'){
    await encodeVideoAsGif();
  }else{
    encodeVideoAsWebm(vid);
  }
  $('btnRender').disabled=false;
}

async function renderVideoFrames(vid,fps,total){
  // Single reusable frame canvas — no per-frame allocation
  const frameCanvas=document.createElement('canvas');
  frameCanvas.width=S.imgW;frameCanvas.height=S.imgH;
  const fctx=frameCanvas.getContext('2d');
  for(let f=0;f<total;f++){
    if(videoRenderAbort)return;
    const t=f/fps;
    await seekVideo(vid,t);
    fctx.clearRect(0,0,S.imgW,S.imgH);
    fctx.drawImage(vid,0,0,S.imgW,S.imgH);
    // S.image points to the shared frameCanvas — startRender reads it synchronously
    S.image=frameCanvas;
    // Per-frame subject detection if active
    if(S.region==='subject'&&cocoModel){
      const minConf=(parseFloat(($('subjectConf')&&$('subjectConf').value)||50))/100;
      try{
        const preds=await cocoModel.detect(frameCanvas);
        if(preds.length){
          S.subjectBoxes=preds.filter(p=>p.score>=minConf).map(p=>({
            x:p.bbox[0]/S.imgW,y:p.bbox[1]/S.imgH,w:p.bbox[2]/S.imgW,h:p.bbox[3]/S.imgH,
            label:p.class,score:Math.round(p.score*100),active:true
          }));
        }
      }catch(e){}
    }
    // Render frame and snapshot the result
    await new Promise(res=>{
      startRender((canvas)=>{
        const snap=document.createElement('canvas');
        snap.width=canvas.width;snap.height=canvas.height;
        snap.getContext('2d').drawImage(canvas,0,0);
        videoRenderFrames[f]=snap;
        res();
      });
    });
    updateEta(f+1,total);
    chunkInfo.textContent=`Rendering frame ${f+1}/${total}…`;
  }
}

function seekVideo(vid,t){
  return new Promise(res=>{
    // Clear any leftover handler first
    vid.onseeked=null;
    // If already at the right time (within one frame), resolve immediately
    if(Math.abs(vid.currentTime-t)<0.04){res();return;}
    let done=false;
    vid.onseeked=()=>{
      if(done)return;
      done=true;
      vid.onseeked=null;
      res();
    };
    vid.currentTime=t;
    // Fallback: browsers sometimes never fire onseeked for certain codecs/times
    setTimeout(()=>{
      if(done)return;
      done=true;
      vid.onseeked=null;
      res();
    },800);
  });
}

async function encodeVideoAsGif(){
  const workerURL=CONFIG.urls.gifWorker;
  let workerBlob;
  try{
    const resp=await fetch(workerURL);
    const blob=await resp.blob();
    workerBlob=URL.createObjectURL(blob);
  }catch(e){alert('Could not fetch GIF encoder worker.');setBadge('ERROR','warn');return;}
  const gif=new GIF({workers:2,quality:10,workerScript:workerBlob});
  const delay=Math.round(1000/S.video.fps);
  videoRenderFrames.forEach(c=>gif.addFrame(c,{delay,copy:true}));
  gif.on('progress',p=>{chunkInfo.textContent=`GIF encoding… ${Math.round(p*100)}%`;setProgress(Math.round(p*100));});
  gif.on('finished',blob=>{
    URL.revokeObjectURL(workerBlob);
    chunkInfo.style.display='none';setProgress(100);setBadge('DONE','done');
    const a=document.createElement('a');
    a.download=S.filename+'-ascii.gif';a.href=URL.createObjectURL(blob);a.click();
    $('hdrInfo').textContent=`Exported ${videoRenderFrames.length} frames as GIF`;
  });
  gif.render();
}

function encodeVideoAsWebm(vid){
  if(!videoRenderFrames.length){setBadge('ERROR','warn');return;}
  const firstFrame=videoRenderFrames[0];
  const outCanvas=document.createElement('canvas');
  outCanvas.width=firstFrame.width;outCanvas.height=firstFrame.height;
  const octx=outCanvas.getContext('2d');
  const fps=S.video.fps||24;
  const interval=1000/fps;
  const stream=outCanvas.captureStream(fps);
  const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
    .find(m=>MediaRecorder.isTypeSupported(m))||'video/webm';
  const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:6000000});
  const chunks=[];
  recorder.ondataavailable=e=>{if(e.data&&e.data.size>0)chunks.push(e.data);};
  recorder.onstop=()=>{
    const blob=new Blob(chunks,{type:'video/webm'});
    chunkInfo.style.display='none';setProgress(100);setBadge('DONE','done');
    const a=document.createElement('a');
    a.download=S.filename+'-ascii.webm';a.href=URL.createObjectURL(blob);a.click();
    $('hdrInfo').textContent=`Exported as WebM · convert to MP4 with HandBrake or ffmpeg`;
    $('btnExport').disabled=false;$('sfExport').disabled=false;
  };
  chunkInfo.style.display='block';
  octx.drawImage(videoRenderFrames[0],0,0);
  setTimeout(()=>{
    recorder.start(100);
    let f=0;
    const startTime=performance.now();
    function paintFrame(){
      if(f>=videoRenderFrames.length){
        recorder.requestData();
        setTimeout(()=>recorder.stop(),300);
        return;
      }
      octx.drawImage(videoRenderFrames[f],0,0);
      chunkInfo.textContent=`WebM encoding frame ${f+1}/${videoRenderFrames.length}…`;
      setProgress(Math.round((f/videoRenderFrames.length)*100));
      f++;
      // Schedule next frame at the exact time it should appear (drift-corrected)
      const nextTime=startTime+f*interval;
      const delay=Math.max(0,nextTime-performance.now());
      setTimeout(paintFrame,delay);
    }
    paintFrame();
  },100);
}

// Wire up manualRender for video/gif too
const _origManualRender=manualRender;
function manualRenderWithVideo(){
  if(S.gif.totalFrames>0&&!S.video.el){
    $('hdrInfo').textContent=`Pre-rendering ${S.gif.totalFrames} ASCII frames…`;
    setBadge('RENDERING','busy');
    renderGifFrames(0,S.gif.totalFrames,()=>{
      setBadge('DONE','done');
      $('hdrInfo').textContent=`${S.filename}  ·  ${S.imgW}×${S.imgH}  ·  ${S.gif.totalFrames} frames`;
      // Update ASCII Output with frame 0 of the new render
      if(gifRendered[0]){
        asciiCanvas.width=gifRendered[0].width;asciiCanvas.height=gifRendered[0].height;
        asciiCanvas.getContext('2d').drawImage(gifRendered[0],0,0);
        emptyMsg.style.display='none';awrap.style.display='block';
        fitToScreen('ascii');
      }
      showGifControls();
      gifPlay();
      switchTab('anim');
    });
    return;
  }
  if(S.video.el&&S.video.totalFrames>0){
    showVideoModal(S.filename,S.video.el);
    return;
  }
  _origManualRender();
}

// ── STATUS ─────────────────────────────────────────────────────
function setBadge(t,cls=''){const b=$('hdrBadge');b.textContent=t;b.className='hdr-badge '+cls;}
function setProgress(pct){const p=$('prog');p.classList.remove('err');p.style.width=pct+'%';if(pct>=100)setTimeout(()=>{p.style.width='0%';},350);}

// ── DITHERING (fixed: no-palette mode preserves colour, only spreads error) ─
function applyDither(imgData,mode,palette){
  if(mode==='none')return imgData;
  const d=new Float32Array(imgData.data),W=imgData.width,H=imgData.height;
  // Without a palette there is nothing to quantize toward — pass through unchanged
  if(!palette||!palette.length)return imgData;

  function quantize(idx){
    const r=d[idx],g=d[idx+1],b=d[idx+2];
    let best=0,bestD=Infinity;
    for(let i=0;i<palette.length;i++){
      const dr=r-palette[i][0],dg=g-palette[i][1],db=b-palette[i][2];
      const dist=dr*dr+dg*dg+db*db;
      if(dist<bestD){bestD=dist;best=i;}
    }
    return palette[best];
  }
  function spread(x,y,er,eg,eb,f){
    if(x<0||x>=W||y<0||y>=H)return;
    const i=(y*W+x)*4;
    d[i]  =Math.max(0,Math.min(255,d[i]  +er*f));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+eg*f));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+eb*f));
  }
  // Error diffusion matrices: [dy, dx, fraction]
  const mats={
    floyd:    [[0,1,7/16],[1,-1,3/16],[1,0,5/16],[1,1,1/16]],
    stucki:   [[0,1,8/42],[0,2,4/42],[1,-2,2/42],[1,-1,4/42],[1,0,8/42],[1,1,4/42],[1,2,2/42],[2,-2,1/42],[2,-1,2/42],[2,0,4/42],[2,1,2/42],[2,2,1/42]],
    jarvis:   [[0,1,7/48],[0,2,5/48],[1,-2,3/48],[1,-1,5/48],[1,0,7/48],[1,1,5/48],[1,2,3/48],[2,-2,1/48],[2,-1,3/48],[2,0,5/48],[2,1,3/48],[2,2,1/48]],
    burkes:   [[0,1,8/32],[0,2,4/32],[1,-2,2/32],[1,-1,4/32],[1,0,8/32],[1,1,4/32],[1,2,2/32]],
    sierra:   [[0,1,5/32],[0,2,3/32],[1,-2,2/32],[1,-1,4/32],[1,0,5/32],[1,1,4/32],[1,2,2/32],[2,-1,2/32],[2,0,3/32],[2,1,2/32]],
    sierra2:  [[0,1,4/16],[0,2,3/16],[1,-2,1/16],[1,-1,2/16],[1,0,3/16],[1,1,2/16],[1,2,1/16]],
    sierralite:[[0,1,2/4],[1,-1,1/4],[1,0,1/4]],
    stevenson:[[0,2,32/200],[1,-3,12/200],[1,-1,26/200],[1,1,30/200],[1,3,16/200],[2,-2,12/200],[2,0,26/200],[2,2,12/200],[3,-3,5/200],[3,-1,12/200],[3,1,12/200],[3,3,5/200]],
    atkinson: [[0,1,1/8],[0,2,1/8],[1,-1,1/8],[1,0,1/8],[1,1,1/8],[2,0,1/8]]
  };
  if(mode==='nearest'){
    // Nearest: just snap every pixel, no error propagation
    for(let i=0;i<d.length;i+=4){const[nr,ng,nb]=quantize(i);d[i]=nr;d[i+1]=ng;d[i+2]=nb;}
  }else{
    const mat=mats[mode];if(!mat)return imgData;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const idx=(y*W+x)*4;
      const[nr,ng,nb]=quantize(idx);
      const er=d[idx]-nr,eg=d[idx+1]-ng,eb=d[idx+2]-nb;
      d[idx]=nr;d[idx+1]=ng;d[idx+2]=nb;
      for(const[dy,dx,f]of mat)spread(x+dx,y+dy,er,eg,eb,f);
    }
  }
  const out=new Uint8ClampedArray(d.length);
  for(let i=0;i<d.length;i++)out[i]=Math.round(d[i]);
  for(let i=3;i<imgData.data.length;i+=4)out[i]=imgData.data[i];
  return new ImageData(out,W,H);
}

// ── PREPROCESSING ────────────────────────────────────────────────
// Applies Lightroom-style tonal adjustments to pixel data in-place.
function applyPreprocessing(imgData, pp){
  const any=Object.values(pp).some(v=>v!==0);
  if(!any)return imgData;
  const d=imgData.data, n=d.length;
  const exp=pp.exposure, con=pp.contrast/100,
        hl=pp.highlights/100, sh=pp.shadows/100,
        wh=pp.whites/100, bl=pp.blacks/100,
        sat=pp.saturation/100, vib=pp.vibrance/100,
        tmp=pp.temp/100, tnt=pp.tint/100;

  // Exposure multiplier (EV)
  const expMul=Math.pow(2, exp);

  for(let i=0;i<n;i+=4){
    let r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;

    // Exposure
    if(exp!==0){ r*=expMul; g*=expMul; b*=expMul; }

    // Contrast — proper S-curve via smoothstep-based curve
    if(con!==0){
      const cFac=con>0?1+con*2:1+con; // asymmetric: boost more aggressively up
      r=Math.max(0,Math.min(1,(r-0.5)*cFac+0.5));
      g=Math.max(0,Math.min(1,(g-0.5)*cFac+0.5));
      b=Math.max(0,Math.min(1,(b-0.5)*cFac+0.5));
    }

    // Highlights (affects pixels above 0.5, smooth rolloff)
    if(hl!==0){
      const lum=0.299*r+0.587*g+0.114*b;
      const mask=Math.max(0,(lum-0.5)*2); // 0 at mid, 1 at white
      const delta=hl*mask;
      r+=delta; g+=delta; b+=delta;
    }

    // Shadows (affects pixels below 0.5)
    if(sh!==0){
      const lum=0.299*r+0.587*g+0.114*b;
      const mask=Math.max(0,(0.5-lum)*2); // 0 at mid, 1 at black
      const delta=sh*mask;
      r+=delta; g+=delta; b+=delta;
    }

    // Whites (top 25% of tones)
    if(wh!==0){
      const lum=0.299*r+0.587*g+0.114*b;
      const mask=Math.max(0,(lum-0.75)*4);
      const delta=wh*mask;
      r+=delta; g+=delta; b+=delta;
    }

    // Blacks (bottom 25%)
    if(bl!==0){
      const lum=0.299*r+0.587*g+0.114*b;
      const mask=Math.max(0,(0.25-lum)*4);
      const delta=bl*mask;
      r+=delta; g+=delta; b+=delta;
    }

    // Clamp before colour ops
    r=Math.max(0,Math.min(1,r)); g=Math.max(0,Math.min(1,g)); b=Math.max(0,Math.min(1,b));

    // Temperature (blue ↔ orange axis)
    if(tmp!==0){ r+=tmp*0.15; b-=tmp*0.15; }
    // Tint (green ↔ magenta axis)
    if(tnt!==0){ g-=tnt*0.1; r+=tnt*0.05; b+=tnt*0.05; }

    // Saturation
    if(sat!==0){
      const lum=0.299*r+0.587*g+0.114*b;
      r=lum+(r-lum)*(1+sat); g=lum+(g-lum)*(1+sat); b=lum+(b-lum)*(1+sat);
    }

    // Vibrance (saturation boost that protects already-saturated colours)
    if(vib!==0){
      const lum=0.299*r+0.587*g+0.114*b;
      const maxC=Math.max(r,g,b), minC=Math.min(r,g,b);
      const curSat=maxC-minC; // 0=grey, 1=fully saturated
      const vibBoost=vib*(1-curSat); // more boost for desaturated colours
      r=lum+(r-lum)*(1+vibBoost); g=lum+(g-lum)*(1+vibBoost); b=lum+(b-lum)*(1+vibBoost);
    }

    // Clamp
    d[i]  =Math.round(Math.max(0,Math.min(1,r))*255);
    d[i+1]=Math.round(Math.max(0,Math.min(1,g))*255);
    d[i+2]=Math.round(Math.max(0,Math.min(1,b))*255);
  }

  // Sharpness — simple unsharp mask via a 3×3 Laplacian kernel
  if(pp.sharpness>0){
    const W2=imgData.width, H2=imgData.height;
    const src=new Uint8ClampedArray(d);
    const amt=pp.sharpness/100*1.5;
    for(let y=1;y<H2-1;y++)for(let x=1;x<W2-1;x++){
      const c=(y*W2+x)*4;
      for(let ch=0;ch<3;ch++){
        const lap=src[c+ch]*5
          -src[((y-1)*W2+x)*4+ch]
          -src[((y+1)*W2+x)*4+ch]
          -src[(y*W2+x-1)*4+ch]
          -src[(y*W2+x+1)*4+ch];
        d[c+ch]=Math.max(0,Math.min(255,src[c+ch]+lap*amt));
      }
    }
  }

  // Clarity — local contrast via larger kernel (5×5 Laplacian-like)
  if(pp.clarity!==0){
    const W2=imgData.width, H2=imgData.height;
    const src=new Uint8ClampedArray(d);
    const amt=pp.clarity/100*0.6;
    for(let y=2;y<H2-2;y++)for(let x=2;x<W2-2;x++){
      const c=(y*W2+x)*4;
      for(let ch=0;ch<3;ch++){
        const lap=src[c+ch]*4
          -src[((y-2)*W2+x)*4+ch]
          -src[((y+2)*W2+x)*4+ch]
          -src[(y*W2+x-2)*4+ch]
          -src[(y*W2+x+2)*4+ch];
        d[c+ch]=Math.max(0,Math.min(255,src[c+ch]+lap*amt));
      }
    }
  }

  return imgData;
}

// ── REGION MASK ──────────────────────────────────────────────────
// Returns a Float32Array of per-pixel weights [0..1] (1=render, 0=skip).
function buildRegionMask(data, W, H, region, leniency, edgeThresh){
  if(region==='all') return null;
  const mask=new Float32Array(W*H);
  const len=Math.max(1, leniency/100*128);

  if(region==='edges'){
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
      const lum=(px,py)=>{const i=(py*W+px)*4;return 0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];};
      const gx=(-lum(x-1,y-1)-2*lum(x-1,y)-lum(x-1,y+1))+(lum(x+1,y-1)+2*lum(x+1,y)+lum(x+1,y+1));
      const gy=(-lum(x,y-1)-2*lum(x-1,y-1)-lum(x+1,y-1))+(lum(x,y+1)+2*lum(x-1,y+1)+lum(x+1,y+1));
      const mag=Math.sqrt(gx*gx+gy*gy);
      mask[y*W+x]=Math.min(1,Math.max(0,(mag-edgeThresh)/Math.max(1,len)));
    }
  } else if(region==='color'){
    const colors=(S.targetColors&&S.targetColors.length?S.targetColors:['#ff0000']).map(hex=>{
      const tr=parseInt(hex.slice(1,3),16),tg=parseInt(hex.slice(3,5),16),tb=parseInt(hex.slice(5,7),16);
      const[th]=rgbToHsl(tr,tg,tb);return th;
    });
    const hueTol=(parseFloat(($('regionHueTol')&&$('regionHueTol').value)||30))/360;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*4;
      const[h,s]=rgbToHsl(data[i],data[i+1],data[i+2]);
      if(s<0.08){mask[y*W+x]=0;continue;}
      let best=0;
      for(const th of colors){
        let hdist=Math.abs(h-th);if(hdist>0.5)hdist=1-hdist;
        const w=Math.min(1,Math.max(0,1-hdist/Math.max(0.001,hueTol)));
        if(w>best)best=w;
      }
      mask[y*W+x]=best;
    }
  } else if(region==='subject'){
    const padding=(parseFloat(($('subjectPadding')&&$('subjectPadding').value)||10))/100;
    const active=S.subjectBoxes.filter(b=>b.active);
    if(!active.length) return mask;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const nx=x/W, ny=y/H;
      let w=0;
      for(const fb of active){
        const bx=fb.x-fb.w*padding, by=fb.y-fb.h*padding;
        const bw2=fb.w*(1+padding*2), bh2=fb.h*(1+padding*2);
        const cx=bx+bw2/2, cy=by+bh2/2;
        const dx=Math.abs(nx-cx)/(bw2/2), dy=Math.abs(ny-cy)/(bh2/2);
        const dist=Math.max(dx,dy);
        w=Math.max(w,Math.min(1,Math.max(0,1-(dist-0.7)/0.3)));
      }
      mask[y*W+x]=w;
    }
  } else if(region==='manual'){
    const active=S.subjectBoxes.filter(b=>b.active);
    if(!active.length) return mask;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const nx=x/W, ny=y/H;
      let w=0;
      for(const fb of active){
        if(nx>=fb.x&&nx<=fb.x+fb.w&&ny>=fb.y&&ny<=fb.y+fb.h) w=1;
      }
      mask[y*W+x]=w;
    }
  } else if(region==='brush'){
    if(!S.brushMask||S.brushMask.length!==S.imgW*S.imgH) return mask;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const sx=Math.min(S.imgW-1,Math.floor(x/W*S.imgW));
      const sy=Math.min(S.imgH-1,Math.floor(y/H*S.imgH));
      mask[y*W+x]=S.brushMask[sy*S.imgW+sx]||0;
    }
  } else {
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*4;
      const lum=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
      let w=0;
      if(region==='shadows')      { w=lum<85?1:Math.max(0,1-(lum-85)/len); }
      else if(region==='midtones'){ const dL=lum-85,dH=170-lum; w=Math.min(1,Math.max(0,Math.min(dL,dH)/len)); }
      else if(region==='highlights'){ w=lum>170?1:Math.max(0,1-(170-lum)/len); }
      else if(region==='whites')  { w=lum>217?1:Math.max(0,1-(217-lum)/len); }
      else if(region==='blacks')  { w=lum<38?1:Math.max(0,1-(lum-38)/len); }
      mask[y*W+x]=w;
    }
  }
  return mask;
}
function quantizeToN(r,g,b,n){
  const step=Math.max(1,Math.round(256/Math.cbrt(n)));
  return[Math.min(255,Math.round(r/step)*step),Math.min(255,Math.round(g/step)*step),Math.min(255,Math.round(b/step)*step)];
}

// ── RENDER ─────────────────────────────────────────────────────
function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
  if(max===min)return[0,0,l];
  const d=max-min,s=l>0.5?d/(2-max-min):d/(max+min);
  let h;
  if(max===r)h=(g-b)/d+(g<b?6:0);
  else if(max===g)h=(b-r)/d+2;
  else h=(r-g)/d+4;
  return[h/6,s,l];
}
function hslToRgb(h,s,l){
  if(s===0){const v=Math.round(l*255);return[v,v,v];}
  const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  function hue(t){t=(t+1)%1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
  return[Math.round(hue(h+1/3)*255),Math.round(hue(h)*255),Math.round(hue(h-1/3)*255)];
}
function scheduleRender(){
  if(!S.image||!S.cfg.autoRender)return;
  // For GIFs (not videos): re-render frame 0 as live preview AND show banner for full re-encode
  if(S.gif.totalFrames>0&&!S.video.el){
    showGifReRenderBanner();
    // Re-render frame 0 so ASCII Output reflects the new settings immediately
    clearTimeout(autoTimer);autoTimer=setTimeout(()=>{
      const fc=document.createElement('canvas');
      fc.width=S.imgW;fc.height=S.imgH;
      fc.getContext('2d').putImageData(S.gif.frames[0],0,0);
      S.image=fc;
      startRender();
    },120);
    return;
  }
  // For videos: re-render frame 0 as a live preview of the current settings
  if(S.video.el){
    clearTimeout(autoTimer);
    autoTimer=setTimeout(()=>{
      // Snap current frame 0 from video
      const vid=S.video.el;
      const fc=document.createElement('canvas');
      fc.width=S.imgW;fc.height=S.imgH;
      vid.currentTime=0;
      const draw=()=>{
        fc.getContext('2d').drawImage(vid,0,0,S.imgW,S.imgH);
        S.image=fc;
        startRender(()=>{
          emptyMsg.style.display='none';awrap.style.display='block';
          $('btnExport').disabled=false;$('sfExport').disabled=false;
          // Stay on ASCII tab if already there, otherwise switch
          if(!$('vp-ascii').classList.contains('on')) switchTab('ascii');
          fitToScreen('ascii');
        });
      };
      // If video is seeked to 0 already just draw, else seek first
      if(Math.abs(vid.currentTime)<0.1) draw();
      else{vid.onseeked=()=>{vid.onseeked=null;draw();};setTimeout(draw,300);}
    },300);
    return;
  }
  clearTimeout(autoTimer);autoTimer=setTimeout(startRender,120);
}
function showGifReRenderBanner(){
  let b=$('gifReRenderBanner');
  if(!b){
    b=document.createElement('div');
    b.id='gifReRenderBanner';
    b.style.cssText='position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(200,245,66,.12);border:1px solid var(--acc);border-radius:3px;padding:5px 14px;font-family:var(--fmono);font-size:10px;color:var(--acc);z-index:20;cursor:pointer;white-space:nowrap';
    b.textContent='Settings changed — click ▶ RENDER to re-encode GIF';
    b.addEventListener('click',()=>{b.remove();manualRenderWithVideo();});
    document.querySelector('.viewer').appendChild(b);
  }
}
// ── OUTLINE DRAWING (shared by static renders, GIF frames, video frames) ──────
function drawOutlineOnCanvas(ctx, outline, region, subjectBoxes, outW, outH, scaleMul, cols, rows, charW, charH, padding){
  if(!outline.enabled||region==='all')return;
  const ow=Math.max(1, outline.width*scaleMul);
  ctx.save();
  ctx.strokeStyle=outline.color;
  ctx.lineWidth=ow;
  ctx.setLineDash(
    outline.style==='dashed'?[ow*4,ow*2]:
    outline.style==='dotted'?[ow,ow*2]:
    []
  );
  ctx.lineCap='round';

  if((region==='subject'||region==='manual')&&subjectBoxes&&subjectBoxes.length){
    // Draw a box per detected/pinned subject
    subjectBoxes.filter(b=>b.active).forEach(fb=>{
      const bx=(fb.x-fb.w*padding)*outW*scaleMul;
      const by=(fb.y-fb.h*padding)*outH*scaleMul;
      const bw2=fb.w*(1+padding*2)*outW*scaleMul;
      const bh2=fb.h*(1+padding*2)*outH*scaleMul;
      ctx.strokeRect(bx+ow/2,by+ow/2,Math.max(0,bw2-ow),Math.max(0,bh2-ow));
    });
  }else{
    // For tonal/edge/color regions: draw a full-canvas border inset by outline width
    const cw=cols*charW*scaleMul, ch=rows*charH*scaleMul;
    ctx.strokeRect(ow/2,ow/2,cw-ow,ch-ow);
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function startRender(onComplete){
  if(!S.image)return;
  if(S.rendering){S.renderAborted=true;return;}
  S.rendering=true;S.renderAborted=false;
  renderGen++;const gen=renderGen;
  const renderStartTime=performance.now();
  setBadge('RENDERING','busy');setProgress(5);
  clearTimeout(watchdogTimer);
  if(S.cfg.watchdog){
    watchdogTimer=setTimeout(()=>{
      if(S.rendering&&renderGen===gen){S.renderAborted=true;S.rendering=false;showCrash('Render exceeded '+S.cfg.wdogSec+'s timeout.');}
    },S.cfg.wdogSec*1000);
  }
  const blockSize=Math.max(1,parseFloat($('blockVal').value)||8);
  const fontSize=Math.max(2,parseFloat($('fontVal').value)||8);
  const invertThr=parseInt($('invertVal').value)||150;
  const bgInverted=S.bgInverted;
  const scaleMul=Math.max(0.1,parseFloat($('scaleVal').value)||1);
  const colorMode=S.colorMode;
  const palMode=$('palMode').value;
  const ditherMode=$('ditherMode').value;
  const palLock=parseInt($('lockVal').value)||16;
  const chars=CHARSETS[S.charset];
  const bothMode=S.bothMode;
  // Region overrides — resolved at render time
  const ro=S.ro;
  const roChars=ro.charset?CHARSETS[ro.charset]:null;
  const roColorMode=ro.colorMode||null;
  const roInvertThr=ro.invertThr!==null&&ro.invertThr!==undefined?ro.invertThr:null;
  const roPalMode=ro.palMode||null;
  const roBgInverted=ro.bgInverted!==null&&ro.bgInverted!==undefined?ro.bgInverted:null;
  let outW=parseInt($('outWVal').value)||800;
  let outH=parseInt($('outHVal').value)||600;
  // Memory cap
  if(S.cfg.memLimit){
    const mx=S.cfg.maxOut;
    if(outW>mx){outH=Math.round(outH*mx/outW);outW=mx;}
    if(outH>mx){outW=Math.round(outW*mx/outH);outH=mx;}
  }
  // Downsample huge source
  let src=S.image;
  if(S.cfg.memLimit){
    const maxPx=S.cfg.maxMp*1e6,srcPx=S.imgW*S.imgH;
    if(srcPx>maxPx){
      const ratio=Math.sqrt(maxPx/srcPx);
      const sw=Math.round(S.imgW*ratio),sh=Math.round(S.imgH*ratio);
      const tc=document.createElement('canvas');tc.width=sw;tc.height=sh;
      tc.getContext('2d').drawImage(S.image,0,0,sw,sh);src=tc;
    }
  }
  workCanvas.width=outW;workCanvas.height=outH;
  const wCtx=workCanvas.getContext('2d');
  wCtx.drawImage(src,0,0,outW,outH);
  let imgData=wCtx.getImageData(0,0,outW,outH);

  // Keep a clean copy of raw pixels BEFORE any processing — used for outside-region blocks
  const rawData=new Uint8ClampedArray(imgData.data);

  // Build region mask on RAW data (before preprocessing changes pixels)
  const regionMode=S.region;
  const regionLeniency=parseInt($('regionLeniency').value)||30;
  const edgeThresh=parseFloat($('edgeThresh').value)||20;
  const regionMask=buildRegionMask(rawData,outW,outH,regionMode,regionLeniency,edgeThresh);
  const regionFill=$('regionFillPills') ? (document.querySelector('#regionFillPills .pill.on')||{}).dataset?.fill||'transparent' : 'transparent';

  // Preprocessing only applied to full imgData (affects inside-region blocks)
  imgData=applyPreprocessing(imgData, S.pp);

  let hexPalette=null;
  if(palMode==='hex'){
    hexPalette=S.hexColors.map(hx=>[parseInt(hx.slice(1,3),16),parseInt(hx.slice(3,5),16),parseInt(hx.slice(5,7),16)]);
  }
  imgData=applyDither(imgData,ditherMode,hexPalette);
  const cellMode=S.cellMode;
  const cols=Math.max(1,Math.floor(outW/blockSize));
  const rows=Math.max(1,Math.floor(outH/blockSize));
  let charW,charH,canvW,canvH;
  if(cellMode==='square'){
    // Square cells sized by font. Canvas = cols×rows×fontSize.
    charW=fontSize; charH=fontSize;
    canvW=Math.round(cols*charW*scaleMul);
    canvH=Math.round(rows*charH*scaleMul);
  }else{
    // Fit mode: cells fill outW×outH exactly.
    charW=outW/cols; charH=outH/rows;
    canvW=Math.round(outW*scaleMul);
    canvH=Math.round(outH*scaleMul);
  }
  asciiCanvas.width=canvW;asciiCanvas.height=canvH;
  const ctx=asciiCanvas.getContext('2d');
  // Fill canvas background (skip fill for transparent mode — leave alpha=0)
  if(colorMode!=='transparent'){
    let bgFill='#000000';
    if(S.bgStyle==='white')bgFill='#ffffff';
    else if(S.bgStyle==='custom')bgFill=S.bgColor;
    ctx.fillStyle=bgFill;
    ctx.fillRect(0,0,canvW,canvH);
  }
  // If region masking is active and not in transparent mode, pre-fill canvas with raw source image.
  // In transparent mode the outside-region area should be clear, not the raw image.
  if(regionMask&&colorMode!=='transparent'){
    const rawCanvas=document.createElement('canvas');
    rawCanvas.width=outW;rawCanvas.height=outH;
    rawCanvas.getContext('2d').putImageData(new ImageData(rawData,outW,outH),0,0);
    ctx.drawImage(rawCanvas,0,0,canvW,canvH);
  }
  ctx.scale(scaleMul,scaleMul);
  ctx.font=`${fontSize}px "${S.renderFont}",monospace`;
  ctx.textBaseline='top';
  const data=imgData.data;
  const chunked=S.cfg.chunked;
  const chunkRows=Math.max(1,S.cfg.chunkRows);
  let row=0;
  chunkInfo.style.display='block';

  function renderChunk(){
    if(S.renderAborted||renderGen!==gen){finish(false);return;}
    const endRow=Math.min(row+chunkRows,rows);
    for(let r=row;r<endRow;r++){
      for(let c=0;c<cols;c++){
        const px=Math.floor(c*blockSize),py=Math.floor(r*blockSize);
        const bw=Math.min(blockSize,outW-px),bh=Math.min(blockSize,outH-py);
        let rr=0,gg=0,bb=0,cnt=0;
        for(let dy=0;dy<bh;dy++)for(let dx=0;dx<bw;dx++){
          const i=((py+dy)*outW+(px+dx))*4;rr+=data[i];gg+=data[i+1];bb+=data[i+2];cnt++;
        }
        rr=Math.round(rr/cnt);gg=Math.round(gg/cnt);bb=Math.round(bb/cnt);
        // palette transform
        let fr=rr,fg=gg,fb=bb;
        if(palMode==='bw'){const lm=Math.round(0.299*rr+0.587*gg+0.114*bb);fr=fg=fb=lm;}
        else if(palMode==='hex'&&hexPalette){
          let best=0,bestD=Infinity;
          hexPalette.forEach(([pr,pg,pb],i)=>{const dist=(rr-pr)**2+(gg-pg)**2+(bb-pb)**2;if(dist<bestD){bestD=dist;best=i;}});
          [fr,fg,fb]=hexPalette[best];
        }else if(palMode==='lock'){[fr,fg,fb]=quantizeToN(rr,gg,bb,palLock);}
        // character selection — derived after region overrides below
        const lum=0.299*fr+0.587*fg+0.114*fb;
        const x=c*charW,y=r*charH;

        // Region mask — check average mask weight for this block
        let regionW=1;
        if(regionMask){
          let wSum=0,wCnt=0;
          for(let dy=0;dy<bh;dy++)for(let dx=0;dx<bw;dx++){wSum+=regionMask[(py+dy)*outW+(px+dx)];wCnt++;}
          regionW=wSum/wCnt;
          if(regionW<0.01){
            // Canvas already has raw source image here — just skip ASCII drawing
            continue;
          }
        }
        // Apply region overrides if inside region and override is enabled
        const inRegion=regionMask&&regionW>=0.01;
        const activeColorMode=inRegion&&roColorMode?roColorMode:colorMode;
        const activeInvertThr=inRegion&&roInvertThr!==null?roInvertThr:invertThr;
        const activeBgInverted=inRegion&&roBgInverted!==null?roBgInverted:bgInverted;
        const activeChars=inRegion&&roChars?roChars:chars;
        const activePalMode=inRegion&&roPalMode?roPalMode:palMode;

        // Re-derive char index with overridden charset
        // All modes: bright pixels → dense chars (high lum = more ink)
        const activeLumNorm=lum/255;
        const activeCharLum=1-activeLumNorm;
        const isCustom=(S.charset==='custom'&&!inRegion)||(inRegion&&S.ro.charset==='custom');
        const activeCi=isCustom
          ? (r*cols+c) % activeChars.length
          : Math.max(0,Math.min(activeChars.length-1,Math.floor(activeCharLum*(activeChars.length-1))));
        const activeCh=activeChars[activeCi];

        // Apply background inversion
        const bgR=activeBgInverted?255-fr:fr, bgG=activeBgInverted?255-fg:fg, bgB=activeBgInverted?255-fb:fb;
        const bgLum=0.299*bgR+0.587*bgG+0.114*bgB;
        const charIsLight=bgLum<activeInvertThr;
        const charBW=bgLum<30?'#ffffff':bgLum>225?'#000000':charIsLight?'#ffffff':'#000000';

        if(activeColorMode==='bg'){
          // BG only — solid color block, no text
          ctx.fillStyle=`rgb(${bgR},${bgG},${bgB})`;ctx.fillRect(x,y,charW,charH);
        }else if(activeColorMode==='char'){
          // Char only — no cell fill, canvas bg already set; just draw colored text
          ctx.fillStyle=`rgb(${bgR},${bgG},${bgB})`;ctx.fillText(activeCh,x,y);
        }else if(activeColorMode==='transparent'){
          // Transparent — clear the cell (alpha=0), draw char in image color
          ctx.clearRect(x,y,charW,charH);
          ctx.fillStyle=`rgb(${bgR},${bgG},${bgB})`;ctx.fillText(activeCh,x,y);
        }else if(activeColorMode==='both'){
          // BG + Char — colored bg, contrasting char on top
          ctx.fillStyle=`rgb(${bgR},${bgG},${bgB})`;ctx.fillRect(x,y,charW,charH);
          if(bothMode==='bw'){
            ctx.fillStyle=charBW;ctx.fillText(activeCh,x,y);
          }else{
            let cr,cg,cb;
            if(bothMode==='complement'){const[h,s,l]=rgbToHsl(bgR,bgG,bgB);[cr,cg,cb]=hslToRgb((h+0.5)%1,s,l);}
            else{cr=255-bgR;cg=255-bgG;cb=255-bgB;}
            ctx.fillStyle=`rgb(${cr},${cg},${cb})`;ctx.fillText(activeCh,x,y);
          }
        }else{
          // B&W — grayscale cell, B&W char
          const gv=Math.round(bgLum);
          ctx.fillStyle=`rgb(${gv},${gv},${gv})`;ctx.fillRect(x,y,charW,charH);
          ctx.fillStyle=charBW;ctx.fillText(activeCh,x,y);
        }
      }
    }
    row=endRow;
    setProgress(5+Math.round((row/rows)*90));
    chunkInfo.textContent=`Rendering… ${row}/${rows} rows`;
    if(row<rows){if(chunked)setTimeout(renderChunk,0);else renderChunk();}
    else finish(true);
  }

  function finish(ok){
    clearTimeout(watchdogTimer);
    ctx.setTransform(1,0,0,1,0,0);
    chunkInfo.style.display='none';
    S.rendering=false;
    if(!ok){setProgress(0);setBadge('ABORTED','warn');return;}
    // Draw outline — called for BOTH normal renders and GIF/video frames (onComplete path)
    drawOutlineOnCanvas(ctx, S.outline, S.region, S.subjectBoxes,
      outW, outH, scaleMul, cols, rows, charW, charH,
      parseFloat(($('subjectPadding')&&$('subjectPadding').value)||10)/100);
    if(onComplete){onComplete(asciiCanvas);return;}
    setProgress(100);
    emptyMsg.style.display='none';awrap.style.display='block';
    $('btnExport').disabled=false;$('sfExport').disabled=false;
    $('btnCopy').disabled=false;
    setBadge('DONE','done');
    const totalChars=cols*rows;
    const ms=Math.round(performance.now()-renderStartTime);
    const timeStr=ms<1000?ms+'ms':(ms/1000).toFixed(1)+'s';
    $('vinfo').textContent=`${cols}×${rows} chars · ${canvW}×${canvH}px · ${timeStr}`;
    $('statChars').textContent=totalChars.toLocaleString();
    $('statDims').textContent=`${cols}×${rows}`;
    $('statTime').textContent=timeStr;
    $('statsBar').classList.add('on');
    fitToScreen();
    if(S.renderAborted){S.renderAborted=false;scheduleRender();}
  }
  renderChunk();
}

// ── CRASH ──────────────────────────────────────────────────────
function showCrash(msg){
  $('prog').classList.add('err');setProgress(100);
  $('crashMsg').textContent=msg;$('crashOv').classList.add('on');
  setBadge('CRASHED','busy');
}
$('crashBtn').addEventListener('click',()=>{
  $('crashOv').classList.remove('on');$('prog').classList.remove('err');setProgress(0);
  S.rendering=false;S.renderAborted=false;setBadge('IDLE','');
  // Undo the change that likely caused the crash
  if(undoStack.length){
    redoStack.push(JSON.stringify(getSnap()));
    applySnap(JSON.parse(undoStack.pop()),false);
    syncUndoBtns();
  }
});

// ── PAN & ZOOM (per-pane) ──────────────────────────────────────
function applyT(v){
  const vs=VS[v],wrap=getWrap(v);
  wrap.style.transform=`translate(${vs.panX}px,${vs.panY}px) scale(${vs.zoom})`;
  $('zdsp').textContent=Math.round(vs.zoom*100)+'%';
}
$('zIn').addEventListener('click',()=>{const v=activeView();VS[v].zoom=Math.min(8,VS[v].zoom*1.25);applyT(v);});
$('zOut').addEventListener('click',()=>{const v=activeView();VS[v].zoom=Math.max(0.05,VS[v].zoom/1.25);applyT(v);});
$('zFit').addEventListener('click',()=>fitToScreen());
function fitToScreen(v){
  v=v||activeView();
  const cv=getCanvas(v);if(!cv||!cv.width)return;
  const pane=$('vp-'+v);if(!pane)return;
  const pw=pane.clientWidth-40,ph=pane.clientHeight-40;
  VS[v].zoom=Math.min(1,pw/cv.width,ph/cv.height);
  VS[v].panX=0;VS[v].panY=0;applyT(v);
}
['ascii','orig','anim'].forEach(vkey=>{
  const pane=$('vp-'+vkey);
  if(!pane) return;
  pane.addEventListener('mousedown',e=>{
    // Don't start pan if brush tool is painting on orig
    if(vkey==='orig'&&window._brushActive)return;
    panning=true;panStart={x:e.clientX-VS[vkey].panX,y:e.clientY-VS[vkey].panY};
    pane.style.cursor='grabbing';
  });
  pane.addEventListener('wheel',e=>{
    // Don't zoom if brush tool is active on orig
    if(vkey==='orig'&&window._brushActive)return;
    e.preventDefault();
    const f=e.deltaY>0?.9:1.1;
    VS[vkey].zoom=Math.max(0.05,Math.min(8,VS[vkey].zoom*f));
    applyT(vkey);
  },{passive:false});
});
window.addEventListener('mousemove',e=>{
  if(!panning)return;
  const v=activeView();
  VS[v].panX=e.clientX-panStart.x;VS[v].panY=e.clientY-panStart.y;
  applyT(v);
});
window.addEventListener('mouseup',()=>{
  panning=false;
  ['ascii','orig','anim'].forEach(v=>{const p=$('vp-'+v);if(p)p.style.cursor='default';});
});

// ── TABS ───────────────────────────────────────────────────────
document.querySelectorAll('[data-sp]').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('[data-sp]').forEach(x=>x.classList.remove('on'));t.classList.add('on');
    document.querySelectorAll('.spanel').forEach(x=>x.classList.remove('on'));$('sp-'+t.dataset.sp).classList.add('on');
  });
});
document.querySelectorAll('[data-vt]').forEach(t=>{
  t.addEventListener('click',()=>{
    switchTab(t.dataset.vt);
  });
});
document.querySelectorAll('.sec-hd').forEach(hd=>hd.addEventListener('click',()=>hd.closest('.sec').classList.toggle('shut')));

// ── COLOR MODE ─────────────────────────────────────────────────
const bothHints = {
  'invert':     'Char color is the exact RGB inverse of the background.',
  'complement': 'Char uses the hue-rotated complement — colorful contrast without full inversion.',
  'bw':         'Char is black or white based on the invert threshold — same logic as BG Only mode.'
};
document.querySelectorAll('[data-cm]').forEach(p=>{
  p.addEventListener('click',()=>{
    const already=p.classList.contains('on');
    document.querySelectorAll('[data-cm]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');
    if(already&&p.dataset.cm==='both'){
      const modes=['invert','complement'];
      S.bothMode=modes[(modes.indexOf(S.bothMode)+1)%modes.length];
      document.querySelectorAll('[data-bm]').forEach(x=>x.classList.toggle('on',x.dataset.bm===S.bothMode));
      $('bothHint').textContent=bothHints[S.bothMode];
    }
    S.colorMode=p.dataset.cm;
    $('bothOpts').style.display=p.dataset.cm==='both'?'block':'none';
    scheduleRender();
  });
});
// ── BG INVERT ──────────────────────────────────────────────────
$('btnBgInvert').addEventListener('click',()=>{
  pushUndo();
  S.bgInverted=!S.bgInverted;
  $('btnBgInvert').classList.toggle('active',S.bgInverted);
  scheduleRender();
});
document.querySelectorAll('[data-bm]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-bm]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');S.bothMode=p.dataset.bm;
    $('bothHint').textContent=bothHints[S.bothMode]||'';
    scheduleRender();
  });
});

// ── PREPROCESSING SLIDERS ─────────────────────────────────────
const ppFields=[
  ['ppExposureSlider','ppExposure','exposure',v=>v/100],
  ['ppContrastSlider','ppContrast','contrast',v=>v],
  ['ppHighlightsSlider','ppHighlights','highlights',v=>v],
  ['ppShadowsSlider','ppShadows','shadows',v=>v],
  ['ppWhitesSlider','ppWhites','whites',v=>v],
  ['ppBlacksSlider','ppBlacks','blacks',v=>v],
  ['ppSaturationSlider','ppSaturation','saturation',v=>v],
  ['ppVibranceSlider','ppVibrance','vibrance',v=>v],
  ['ppTempSlider','ppTemp','temp',v=>v],
  ['ppTintSlider','ppTint','tint',v=>v],
  ['ppSharpnessSlider','ppSharpness','sharpness',v=>v],
  ['ppClaritySlider','ppClarity','clarity',v=>v],
];
ppFields.forEach(([slid,inid,key,transform])=>{
  const sl=$(slid),inp=$(inid);
  if(!sl||!inp)return;
  function update(raw){
    const v=transform?transform(raw):raw;
    S.pp[key]=v;
    scheduleRender();
  }
  sl.addEventListener('input',()=>{inp.value=(+sl.value/100).toFixed(2)===inp.value?sl.value:sl.value;inp.value=sl.value;update(+sl.value);});
  sl.addEventListener('change',()=>pushUndo());
  inp.addEventListener('change',()=>{sl.value=inp.value;update(+inp.value);pushUndo();});
});
// Sync exposure display as decimal
(function(){
  const sl=$('ppExposureSlider'),inp=$('ppExposure');
  if(!sl)return;
  sl.addEventListener('input',()=>{inp.value=(sl.value/100).toFixed(2);S.pp.exposure=sl.value/100;scheduleRender();});
  inp.addEventListener('change',()=>{sl.value=Math.round(inp.value*100);S.pp.exposure=+inp.value;scheduleRender();pushUndo();});
})();

$('ppResetBtn')&&$('ppResetBtn').addEventListener('click',()=>{
  pushUndo();
  Object.keys(S.pp).forEach(k=>S.pp[k]=0);
  ppFields.forEach(([slid,inid])=>{if($(slid))$(slid).value=0;if($(inid))$(inid).value=0;});
  $('ppExposure').value='0.00';
  scheduleRender();
});

// ── SIDEBAR RESIZE ────────────────────────────────────────────
(function(){
  const resizer=$('sidebarResizer');
  const sidebar=document.querySelector('.sidebar');
  let dragging=false,startX=0,startW=0;

  function onStart(e){
    dragging=true;
    startX=e.touches?e.touches[0].clientX:e.clientX;
    startW=sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
    e.preventDefault();
  }
  function onMove(e){
    if(!dragging)return;
    const cx=e.touches?e.touches[0].clientX:e.clientX;
    const newW=Math.max(CONFIG.sidebar.minWidth,Math.min(CONFIG.sidebar.maxWidth,startW+(cx-startX)));
    sidebar.style.width=newW+'px';
  }
  function onEnd(){
    if(!dragging)return;
    dragging=false;
    resizer.classList.remove('dragging');
    document.body.style.cursor='';
    document.body.style.userSelect='';
    // Re-fit the current view after resize
    setTimeout(()=>fitToScreen(),50);
  }

  resizer.addEventListener('mousedown',onStart);
  resizer.addEventListener('touchstart',onStart,{passive:false});
  window.addEventListener('mousemove',onMove);
  window.addEventListener('touchmove',e=>{if(dragging){onMove(e);e.preventDefault();}},{passive:false});
  window.addEventListener('mouseup',onEnd);
  window.addEventListener('touchend',onEnd);
})();
document.querySelectorAll('.sec-reset').forEach(btn=>{
  btn.addEventListener('click',e=>{
    e.stopPropagation(); // don't collapse the section
    pushUndo();
    const key=btn.dataset.reset;
    switch(key){
      case 'resolution':
        if(S.image){
          const w=S.imgW,h=S.imgH;
          $('outWVal').value=w;$('outWSlider').value=Math.min(w,3840);
          $('outHVal').value=h;$('outHSlider').value=Math.min(h,2160);
          if(S.arLocked)S.arRatio=w/h;
        }
        break;
      case 'block':
        $('blockVal').value=CONFIG.defaults.blockSize;$('blockSlider').value=CONFIG.defaults.blockSize;
        $('fontVal').value=CONFIG.defaults.fontSize;$('fontSlider').value=CONFIG.defaults.fontSize;
        $('scaleVal').value=CONFIG.defaults.scale;$('scaleSlider').value=CONFIG.defaults.scale;
        S.cellMode=CONFIG.defaults.cellMode;
        document.querySelectorAll('[data-cell]').forEach(p=>p.classList.toggle('on',p.dataset.cell===CONFIG.defaults.cellMode));
        break;
      case 'exposure':
        ['ppExposure','ppContrast','ppHighlights','ppShadows','ppWhites','ppBlacks'].forEach(id=>{
          $(id)&&($(id).value=id==='ppExposure'?'0.00':'0');
          const sl=$(id+'Slider');if(sl)sl.value=0;
          const key2=id.replace('pp','').toLowerCase();
          if(S.pp[key2]!==undefined)S.pp[key2]=0;
        });
        S.pp.exposure=0;
        break;
      case 'ppcolor':
        ['ppSaturation','ppVibrance','ppTemp','ppTint'].forEach(id=>{
          $(id)&&($(id).value=0);
          const sl=$(id+'Slider');if(sl)sl.value=0;
          const key2=id.replace('pp','').toLowerCase();
          if(S.pp[key2]!==undefined)S.pp[key2]=0;
        });
        break;
      case 'detail':
        ['ppSharpness','ppClarity'].forEach(id=>{
          $(id)&&($(id).value=0);
          const sl=$(id+'Slider');if(sl)sl.value=0;
          const key2=id.replace('pp','').toLowerCase();
          if(S.pp[key2]!==undefined)S.pp[key2]=0;
        });
        break;
      case 'charset':
        S.charset=CONFIG.defaults.charset;
        document.querySelectorAll('#csopts .csopt').forEach(o=>o.classList.toggle('on',o.dataset.cs===CONFIG.defaults.charset));
        $('customCharsInput').style.display='none';
        break;
      case 'font':
        S.renderFont=CONFIG.defaults.renderFont;
        $('renderFont').value=CONFIG.defaults.renderFont;
        $('fontPreview').style.fontFamily=`"${CONFIG.defaults.renderFont}",monospace`;
        break;
      case 'colormode':
        S.colorMode=CONFIG.defaults.colorMode;
        document.querySelectorAll('[data-cm]').forEach(p=>p.classList.toggle('on',p.dataset.cm===CONFIG.defaults.colorMode));
        $('bothOpts').style.display='none';
        S.bgInverted=CONFIG.defaults.bgInverted;
        $('btnBgInvert')&&$('btnBgInvert').classList.remove('active');
        break;
      case 'dither':
        $('ditherMode').value=CONFIG.defaults.ditherMode||'none';
        break;
      case 'region':
        S.region=CONFIG.region.default;
        document.querySelectorAll('[data-region]').forEach(p=>p.classList.toggle('on',p.dataset.region===CONFIG.region.default));
        ['edgeOpts','colorRangeOpts','subjectOpts','manualBoxOpts','brushOpts','regionLeniencyOpts'].forEach(id=>{
          const el=$(id);if(el)el.style.display='none';
        });
        if($('regionOverrideSec'))$('regionOverrideSec').style.display='none';
        if($('outsideRegionSec'))$('outsideRegionSec').style.display='none';
        if($('regionHint'))$('regionHint').textContent='ASCII applied to the full image.';
        break;
      case 'bg':
        S.bgStyle=CONFIG.defaults.bgStyle;S.bgColor=CONFIG.defaults.bgColor;
        document.querySelectorAll('[data-bg]').forEach(p=>p.classList.toggle('on',p.dataset.bg===CONFIG.defaults.bgStyle));
        $('bgColorRow').style.display='none';
        break;
      case 'brightness':
        $('invertVal').value=CONFIG.defaults.invertThr;$('invertSlider').value=CONFIG.defaults.invertThr;
        break;
      case 'palette':
        $('palMode').value=CONFIG.defaults.palMode;
        $('lockBody').style.display='none';
        $('hexBody').style.display='none';
        break;
    }
    scheduleRender();
  });
});

// ── REGION ────────────────────────────────────────────────────
const regionHints={
  all:        'ASCII applied to the full image.',
  shadows:    'ASCII applied to shadow areas (dark tones).',
  midtones:   'ASCII applied to midtone brightness range.',
  highlights: 'ASCII applied to highlight areas (bright tones).',
  whites:     'ASCII applied to the very brightest areas only.',
  blacks:     'ASCII applied to the very darkest areas only.',
  edges:      'ASCII applied on detected edges (Sobel gradient).',
  color:      'ASCII applied where blocks match the target hue.',
  subject:    'ASCII applied inside detected subject/object bounding boxes.',
  manual:     'ASCII applied inside your hand-drawn box(es).',
  brush:      'Paint the ASCII region directly on the image.'
};
const tonalRegions=new Set(['shadows','midtones','highlights','whites','blacks']);

document.querySelectorAll('[data-region]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-region]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');S.region=p.dataset.region;
    $('regionHint').textContent=regionHints[S.region]||'';
    const r=S.region;
    const isAll=r==='all';
    const edgeEl=$('edgeOpts'), colorEl=$('colorRangeOpts'), subEl=$('subjectOpts'), lenEl=$('regionLeniencyOpts'), manEl=$('manualBoxOpts'), brushEl=$('brushOpts');
    if(edgeEl)edgeEl.style.display=r==='edges'?'block':'none';
    if(colorEl)colorEl.style.display=r==='color'?'block':'none';
    if(subEl)subEl.style.display=r==='subject'?'block':'none';
    if(lenEl)lenEl.style.display=(tonalRegions.has(r)||r==='color')?'block':'none';
    if(manEl)manEl.style.display=r==='manual'?'block':'none';
    if(brushEl)brushEl.style.display=r==='brush'?'block':'none';
    // Show/hide region-dependent sections
    if($('regionOverrideSec'))$('regionOverrideSec').style.display=isAll?'none':'block';
    if($('outsideRegionSec'))$('outsideRegionSec').style.display=isAll?'none':'block';
    scheduleRender();
  });
});
document.querySelectorAll('[data-fill]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-fill]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');scheduleRender();
  });
});
linkSI('regionLeniencySlider','regionLeniency',()=>scheduleRender());
linkSI('edgeThreshSlider','edgeThresh',()=>scheduleRender());
if($('regionHueTolSlider'))linkSI('regionHueTolSlider','regionHueTol',()=>scheduleRender());
if($('subjectPaddingSlider'))linkSI('subjectPaddingSlider','subjectPadding',()=>scheduleRender());
if($('subjectConfSlider'))linkSI('subjectConfSlider','subjectConf');

// ── REGION OUTLINE ────────────────────────────────────────────
const tglOutline=$('tgl-outline');
if(tglOutline){
  tglOutline.addEventListener('click',()=>{
    tglOutline.classList.toggle('on');
    S.outline.enabled=tglOutline.classList.contains('on');
    $('outlineOpts').style.display=S.outline.enabled?'block':'none';
    scheduleRender();
  });
}
document.querySelectorAll('[data-ols]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-ols]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');S.outline.style=p.dataset.ols;scheduleRender();
  });
});
linkSI('outlineWidthSlider','outlineWidth',v=>{S.outline.width=v;scheduleRender();});
if($('outlineColor')){
  $('outlineColor').addEventListener('input',()=>{
    const v=$('outlineColor').value;
    S.outline.color=v;$('outlineColorHex').value=v;$('outlineColorSwatch').style.background=v;
    scheduleRender();
  });
  $('outlineColorHex').addEventListener('change',()=>{
    const v=$('outlineColorHex').value;
    if(/^#[0-9a-fA-F]{6}$/.test(v)){
      S.outline.color=v;$('outlineColor').value=v;$('outlineColorSwatch').style.background=v;
      scheduleRender();
    }
  });
}

// ── REGION OVERRIDES ──────────────────────────────────────────
function mkRoTgl(tglId,bodyId,key){
  const tgl=$(tglId);if(!tgl)return;
  tgl.addEventListener('click',()=>{
    tgl.classList.toggle('on');
    const on=tgl.classList.contains('on');
    S.ro[key]=on?(S.ro[key]||null):null;
    if(on&&S.ro[key]===null){
      // Set default from current global
      if(key==='charset')S.ro.charset=S.charset;
      else if(key==='colorMode')S.ro.colorMode=S.colorMode;
      else if(key==='invertThr')S.ro.invertThr=parseInt($('invertVal').value)||150;
      else if(key==='palMode')S.ro.palMode=$('palMode').value;
      else if(key==='bgInverted')S.ro.bgInverted=S.bgInverted;
    }
    if(bodyId&&$(bodyId))$(bodyId).style.display=on?'block':'none';
    scheduleRender();
  });
}
mkRoTgl('tgl-ro-charset','ro-charset-body','charset');
mkRoTgl('tgl-ro-colormode','ro-colormode-body','colorMode');
mkRoTgl('tgl-ro-invert','ro-invert-body','invertThr');
mkRoTgl('tgl-ro-palette','ro-palette-body','palMode');
mkRoTgl('tgl-ro-bginvert',null,'bgInverted');

document.querySelectorAll('[data-ro-cs]').forEach(o=>{
  o.addEventListener('click',()=>{
    document.querySelectorAll('[data-ro-cs]').forEach(x=>x.classList.remove('on'));
    o.classList.add('on');S.ro.charset=o.dataset.roCs;scheduleRender();
  });
});
document.querySelectorAll('[data-ro-cm]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-ro-cm]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');S.ro.colorMode=p.dataset.roCm;scheduleRender();
  });
});
linkSI('ro-invertSlider','ro-invertVal',v=>{S.ro.invertThr=v;scheduleRender();});
if($('ro-palMode'))$('ro-palMode').addEventListener('change',()=>{S.ro.palMode=$('ro-palMode').value;scheduleRender();});

document.querySelectorAll('[data-dmode]').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('[data-dmode]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');
  });
});

// Color picker sync
if($('regionColor')){
  $('regionColor').addEventListener('input',()=>{
    const v=$('regionColor').value;
    $('regionColorHex').value=v;
    $('regionColorSwatch').style.background=v;
    scheduleRender();
  });
  $('regionColorHex').addEventListener('change',()=>{
    const v=$('regionColorHex').value;
    if(/^#[0-9a-fA-F]{6}$/.test(v)){
      $('regionColor').value=v;
      $('regionColorSwatch').style.background=v;
      scheduleRender();
    }
  });
}

// Subject / object detection (COCO-SSD)
let cocoModel=null;
if($('detectSubjectBtn')){
  $('detectSubjectBtn').addEventListener('click',async()=>{
    if(!S.image){alert('Load an image first.');return;}
    const btn=$('detectSubjectBtn');
    const hint=$('subjectStatusHint');
    const minConf=(parseFloat($('subjectConf').value)||50)/100;
    btn.disabled=true;
    try{
      const dmode=(document.querySelector('#detectModePills .pill.on')||{}).dataset?.dmode||'object';
      const tc=document.createElement('canvas');
      tc.width=S.imgW;tc.height=S.imgH;
      tc.getContext('2d').drawImage(S.image,0,0);
      let filtered=[];
      if(dmode==='face'){
        if(!('FaceDetector' in window)){
          hint.textContent='FaceDetector not available in this browser (try Chrome or Edge).';
          btn.disabled=false;return;
        }
        hint.textContent='Detecting faces…';
        const fd=new FaceDetector({fastMode:false,maxDetectedFaces:20});
        const faces=await fd.detect(tc);
        filtered=faces.map(f=>({
          bbox:[f.boundingBox.x,f.boundingBox.y,f.boundingBox.width,f.boundingBox.height],
          class:'face',score:1
        }));
      }else{
        if(!cocoModel){
          hint.textContent='Loading model (~5MB, first time only)…';
          cocoModel=await cocoSsd.load();
        }
        hint.textContent='Detecting objects…';
        const predictions=await cocoModel.detect(tc);
        filtered=predictions.filter(p=>p.score>=minConf);
      }
      if(!filtered.length){
        hint.textContent='No subjects detected. Try lowering confidence threshold.';
        S.subjectBoxes=[];
        if($('subjectResults'))$('subjectResults').style.display='none';
      }else{
        S.subjectBoxes=filtered.map(p=>({
          x:p.bbox[0]/S.imgW,y:p.bbox[1]/S.imgH,
          w:p.bbox[2]/S.imgW,h:p.bbox[3]/S.imgH,
          label:p.class,score:Math.round(p.score*100),active:true
        }));
        hint.textContent=`${filtered.length} subject${filtered.length>1?'s':''} found.`;
        if($('subjectResults'))$('subjectResults').style.display='block';
        if($('subjectPaddingRow'))$('subjectPaddingRow').style.display='block';
        // Auto-activate the Subject region pill
        document.querySelectorAll('[data-region]').forEach(x=>x.classList.remove('on'));
        const sp=document.querySelector('[data-region="subject"]');
        if(sp)sp.classList.add('on');
        S.region='subject';
        if($('regionHint'))$('regionHint').textContent=regionHints['subject']||'';
        renderSubjectList();
        scheduleRender();
      }
    }catch(e){
      hint.textContent='Detection failed: '+e.message;
      console.error(e);
    }finally{
      btn.disabled=false;
    }
  });
}
function renderSubjectList(){
  const list=$('subjectList');if(!list)return;
  list.innerHTML='';
  S.subjectBoxes.forEach((b)=>{
    const el=document.createElement('div');
    el.className='csopt'+(b.active?' on':'');
    el.style.cssText='cursor:pointer;justify-content:space-between';
    el.innerHTML=`<span style="display:flex;align-items:center;gap:6px"><span class="csdot"></span>${b.label}</span><span style="font-size:9px;opacity:.6">${b.score}%</span>`;
    el.addEventListener('click',()=>{b.active=!b.active;el.classList.toggle('on',b.active);scheduleRender();});
    list.appendChild(el);
  });
}



// ── CHARSET ────────────────────────────────────────────────────
document.querySelectorAll('#csopts .csopt').forEach(o=>{
  o.addEventListener('click',()=>{
    document.querySelectorAll('#csopts .csopt').forEach(x=>x.classList.remove('on'));o.classList.add('on');S.charset=o.dataset.cs;
    $('customCharsInput').style.display=S.charset==='custom'?'block':'none';
    scheduleRender();
  });
});
$('customCharsInput').addEventListener('input',()=>{
  const v=$('customCharsInput').value;
  if(v.length>0){
  const base=Array.from(v);
  const target=Math.max(base.length, 64);
  const repeated=[];
  while(repeated.length<target) repeated.push(...base);
  CHARSETS.custom=repeated.slice(0,target);
}else{
  CHARSETS.custom=Array.from(' .#@');
}
  scheduleRender();
});

// ── DITHERING ──────────────────────────────────────────────────
$('ditherMode').addEventListener('change',scheduleRender);

// ── PALETTE MODE ───────────────────────────────────────────────
$('palMode').addEventListener('change',()=>{
  const m=$('palMode').value;
  $('lockBody').style.display=m==='lock'?'block':'none';
  $('hexBody').style.display=m==='hex'?'block':'none';
  scheduleRender();
});
function renderSwatches(){
  const c=$('hexSwatches');c.innerHTML='';
  S.hexColors.forEach((hex,i)=>{
    const row=document.createElement('div');row.className='sw-row';row.style.alignItems='center';row.style.gap='6px';
    const box=document.createElement('div');box.className='sw-box';box.style.background=hex;
    const picker=document.createElement('input');picker.type='color';picker.value=hex;picker.dataset.i=i;
    box.appendChild(picker);
    const hexInp=document.createElement('input');hexInp.className='sw-hex';hexInp.type='text';hexInp.value=hex;hexInp.dataset.i=i;hexInp.maxLength=7;
    const rm=document.createElement('div');rm.className='sw-rm';rm.dataset.i=i;rm.textContent='×';
    const dbtn=document.createElement('button');dbtn.className='dropper-btn';dbtn.title='Pick from image';dbtn.textContent='🔬';
    dbtn.addEventListener('click',()=>{
      window.openDropper(dbtn,(pickedHex)=>{
        S.hexColors[i]=pickedHex;renderSwatches();scheduleRender();
      });
    });
    row.appendChild(box);row.appendChild(hexInp);row.appendChild(rm);row.appendChild(dbtn);
    c.appendChild(row);
  });
  c.querySelectorAll('input[type=color]').forEach(el=>el.addEventListener('input',()=>{S.hexColors[el.dataset.i]=el.value;renderSwatches();scheduleRender();}));
  c.querySelectorAll('.sw-hex').forEach(el=>el.addEventListener('change',()=>{if(/^#[0-9a-fA-F]{6}$/.test(el.value)){S.hexColors[el.dataset.i]=el.value;renderSwatches();scheduleRender();}}));
  c.querySelectorAll('.sw-rm').forEach(el=>el.addEventListener('click',()=>{if(S.hexColors.length>1){S.hexColors.splice(+el.dataset.i,1);renderSwatches();scheduleRender();}}));
}
renderSwatches();
$('addSwatch').addEventListener('click',()=>{S.hexColors.push('#888888');renderSwatches();});

// Wire outline color dropper
$('outlineDropperBtn')&&$('outlineDropperBtn').addEventListener('click',()=>{
  window.openDropper($('outlineDropperBtn'),(hex)=>{
    S.outline.color=hex;
    $('outlineColor').value=hex;$('outlineColorHex').value=hex;$('outlineColorSwatch').style.background=hex;
    scheduleRender();
  });
});

// Wire canvas bg color dropper
$('bgDropperBtn')&&$('bgDropperBtn').addEventListener('click',()=>{
  window.openDropper($('bgDropperBtn'),(hex)=>{
    S.bgStyle='custom';S.bgColor=hex;
    document.querySelectorAll('[data-bg]').forEach(p=>p.classList.toggle('on',p.dataset.bg==='custom'));
    $('bgColorRow').style.display='block';
    $('bgColorPicker').value=hex;$('bgColorHex').value=hex;$('bgColorSwatch').style.background=hex;
    scheduleRender();
  });
});

// ── RENDER / EXPORT BUTTONS ────────────────────────────────────
function manualRender(){
  clearTimeout(autoTimer);
  const banner=$('gifReRenderBanner');if(banner)banner.remove();
  if(S.rendering){
    // Abort current and re-queue after it finishes
    S.renderAborted=true;
    setTimeout(startRender,50);
    return;
  }
  startRender();
}
$('btnRender').addEventListener('click',manualRenderWithVideo);
$('sfRender').addEventListener('click',manualRenderWithVideo);

function doExport(){
  const fmt=$('exportFmt').value,fname=S.filename;
  if(fmt==='txt'){exportTxt(fname);return;}
  if(fmt==='svg'){exportSvg(fname);return;}
  if(fmt==='gif'){exportGif(fname);return;}
  if(fmt==='webm'){
    if(videoRenderFrames.length){encodeVideoAsWebm(S.video.el);}
    else{alert('No video frames rendered yet. Load a video and click Render first.');}
    return;
  }
  const a=document.createElement('a');
  if(fmt==='png'){a.download=fname+'.png';a.href=asciiCanvas.toDataURL('image/png');}
  else if(fmt==='webp'){a.download=fname+'.webp';a.href=asciiCanvas.toDataURL('image/webp');}
  else if(fmt.startsWith('jpg')){const q=parseInt(fmt.split('-')[1])/100;a.download=fname+'.jpg';a.href=asciiCanvas.toDataURL('image/jpeg',q);}
  a.click();
}
// ── EXPORT MODAL ──────────────────────────────────────────────
function openExportModal(){$('exportModal').style.display='flex';}
function closeExportModal(){$('exportModal').style.display='none';}
$('exportModalClose').addEventListener('click',closeExportModal);
$('exportModalCancel').addEventListener('click',closeExportModal);
$('exportModal').addEventListener('click',e=>{if(e.target===$('exportModal'))closeExportModal();});
$('exportModalGo').addEventListener('click',()=>{closeExportModal();doExport();});
$('btnExport').addEventListener('click',openExportModal);
$('sfExport').addEventListener('click',openExportModal);

function exportTxt(fname){
  const bs=Math.max(1,parseFloat($('blockVal').value)||8),chars=CHARSETS[S.charset];
  const outW=parseInt($('outWVal').value)||800,outH=parseInt($('outHVal').value)||600;
  workCanvas.width=outW;workCanvas.height=outH;
  const wc=workCanvas.getContext('2d');wc.drawImage(S.image,0,0,outW,outH);
  const data=wc.getImageData(0,0,outW,outH).data;
  const cols=Math.floor(outW/bs),rows=Math.floor(outH/bs);let txt='';
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const px=Math.floor(c*bs),py=Math.floor(r*bs),bw=Math.min(bs,outW-px),bh=Math.min(bs,outH-py);
      let rr=0,gg=0,bb=0,cnt=0;
      for(let dy=0;dy<bh;dy++)for(let dx=0;dx<bw;dx++){const i=((py+dy)*outW+(px+dx))*4;rr+=data[i];gg+=data[i+1];bb+=data[i+2];cnt++;}
      const lum=0.299*(rr/cnt)+0.587*(gg/cnt)+0.114*(bb/cnt);
      txt+=chars[Math.max(0,Math.min(chars.length-1,Math.floor((lum/255)*(chars.length-1))))];
    }
    txt+='\n';
  }
  const a=document.createElement('a');a.download=fname+'.txt';a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));a.click();
}

function exportSvg(fname){
  const bs=Math.max(1,parseFloat($('blockVal').value)||8),fs=Math.max(2,parseFloat($('fontVal').value)||8);
  const outW=parseInt($('outWVal').value)||800,outH=parseInt($('outHVal').value)||600;
  const chars=CHARSETS[S.charset],invThr=parseInt($('invertVal').value)||128;
  workCanvas.width=outW;workCanvas.height=outH;
  const wc=workCanvas.getContext('2d');wc.drawImage(S.image,0,0,outW,outH);
  const data=wc.getImageData(0,0,outW,outH).data;
  const cols=Math.floor(outW/bs),rows=Math.floor(outH/bs),cw=fs*0.6,ch=fs*1.15;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${(cols*cw).toFixed(0)}" height="${(rows*ch).toFixed(0)}" style="background:#000">`;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const px=Math.floor(c*bs),py=Math.floor(r*bs),bw=Math.min(bs,outW-px),bh=Math.min(bs,outH-py);
    let rr=0,gg=0,bb=0,cnt=0;
    for(let dy=0;dy<bh;dy++)for(let dx=0;dx<bw;dx++){const i=((py+dy)*outW+(px+dx))*4;rr+=data[i];gg+=data[i+1];bb+=data[i+2];cnt++;}
    rr=Math.round(rr/cnt);gg=Math.round(gg/cnt);bb=Math.round(bb/cnt);
    const lum=0.299*rr+0.587*gg+0.114*bb;
    const ch2=chars[Math.max(0,Math.min(chars.length-1,Math.floor((lum/255)*(chars.length-1))))].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const tc=lum<invThr?'#fff':'#000';
    const x=(c*cw).toFixed(1),y=(r*ch).toFixed(1);
    svg+=`<rect x="${x}" y="${y}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="rgb(${rr},${gg},${bb})"/>`;
    svg+=`<text x="${x}" y="${(parseFloat(y)+fs).toFixed(1)}" font-family="monospace" font-size="${fs}" fill="${tc}">${ch2}</text>`;
  }
  svg+='</svg>';
  const a=document.createElement('a');a.download=fname+'.svg';a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));a.click();
}

// ── SETTINGS DRAWER ────────────────────────────────────────────
$('btnSettings').addEventListener('click',()=>$('settingsOv').classList.toggle('on'));
$('spClose').addEventListener('click',()=>$('settingsOv').classList.remove('on'));
$('settingsOv').addEventListener('click',e=>{if(e.target===$('settingsOv'))$('settingsOv').classList.remove('on');});
function mkTgl(id,key){const el=$(id);el.addEventListener('click',()=>{el.classList.toggle('on');S.cfg[key]=el.classList.contains('on');});}
mkTgl('tgl-memlimit','memLimit');mkTgl('tgl-chunk','chunked');mkTgl('tgl-watchdog','watchdog');mkTgl('tgl-auto','autoRender');

// ── SETTINGS IMPORT / EXPORT ───────────────────────────────────
function getSnap(){
  return{
    v:APP_VERSION,
    // Resolution & layout
    outW:$('outWVal').value, outH:$('outHVal').value,
    arLocked:S.arLocked, arRatio:S.arRatio,
    // Block & scale
    blockSize:$('blockVal').value, fontSize:$('fontVal').value, scale:$('scaleVal').value,
    bfLocked:S.bfLocked, cellMode:S.cellMode,
    // Characters
    invertThr:$('invertVal').value, charset:S.charset, customChars:$('customCharsInput').value,
    ditherMode:$('ditherMode').value,
    // Color
    colorMode:S.colorMode, bothMode:S.bothMode, bgInverted:S.bgInverted,
    palMode:$('palMode').value, hexColors:[...S.hexColors], lockN:$('lockVal').value,
    // Region
    region:S.region,
    regionLeniency:($('regionLeniency')&&$('regionLeniency').value)||30,
    edgeThresh:($('edgeThresh')&&$('edgeThresh').value)||20,
    regionFill:(document.querySelector('#regionFillPills .pill.on')||{}).dataset?.fill||'transparent',
    regionHueTol:($('regionHueTol')&&$('regionHueTol').value)||30,
    regionColor:($('regionColor')&&$('regionColor').value)||'#ff0000',
    targetColors:[...S.targetColors],
    subjectPadding:($('subjectPadding')&&$('subjectPadding').value)||10,
    subjectConf:($('subjectConf')&&$('subjectConf').value)||50,
    detectMode:(document.querySelector('#detectModePills .pill.on')||{}).dataset?.dmode||'object',
    // Preprocessing
    pp:{...S.pp},
    // Export
    exportFmt:$('exportFmt').value,
    // Settings / memory
    outline:{...S.outline},
    ro:{...S.ro},
    cfg:{...S.cfg},
    // v7 additions
    renderFont:S.renderFont,
    bgStyle:S.bgStyle,
    bgColor:S.bgColor
  };
}
function applySnap(snap,pushHistory=true){
  if(!snap||!snap.v){alert('Not a valid ASCII Render settings file.');return;}
  if(snap.v<3||snap.v>APP_VERSION){alert(`Settings version ${snap.v} not supported (this build reads v3–v${APP_VERSION}).`);return;}
  if(pushHistory)pushUndo();
  // Region overrides (v6+)
  if(snap.ro){
    Object.assign(S.ro,snap.ro);
    ['charset','colorMode','invertThr','palMode','bgInverted'].forEach(k=>{
      const tglId=`tgl-ro-${k==='invertThr'?'invert':k==='colorMode'?'colormode':k==='palMode'?'palette':k==='bgInverted'?'bginvert':k}`;
      const bodyId=`ro-${k==='invertThr'?'invert':k==='colorMode'?'colormode':k==='palMode'?'palette':k}-body`;
      const on=S.ro[k]!==null&&S.ro[k]!==undefined;
      const tgl=$(tglId);if(tgl){tgl.classList.toggle('on',on);if($(bodyId))$(bodyId).style.display=on?'block':'none';}
    });
    if(S.ro.charset)document.querySelectorAll('[data-ro-cs]').forEach(o=>o.classList.toggle('on',o.dataset.roCs===S.ro.charset));
    if(S.ro.colorMode)document.querySelectorAll('[data-ro-cm]').forEach(p=>p.classList.toggle('on',p.dataset.roCm===S.ro.colorMode));
    if(S.ro.invertThr!==null){if($('ro-invertVal'))$('ro-invertVal').value=S.ro.invertThr;if($('ro-invertSlider'))$('ro-invertSlider').value=S.ro.invertThr;}
    if(S.ro.palMode&&$('ro-palMode'))$('ro-palMode').value=S.ro.palMode;
  }
  if(snap.outline){
    Object.assign(S.outline,snap.outline);
    const tol=$('tgl-outline');
    if(tol){tol.classList.toggle('on',S.outline.enabled);if($('outlineOpts'))$('outlineOpts').style.display=S.outline.enabled?'block':'none';}
    document.querySelectorAll('[data-ols]').forEach(p=>p.classList.toggle('on',p.dataset.ols===S.outline.style));
    if($('outlineWidth')){$('outlineWidth').value=S.outline.width;$('outlineWidthSlider').value=S.outline.width;}
    if($('outlineColor')){$('outlineColor').value=S.outline.color;$('outlineColorHex').value=S.outline.color;$('outlineColorSwatch').style.background=S.outline.color;}
  }
  // v7: renderFont
  if(snap.renderFont){
    S.renderFont=snap.renderFont;
    if($('renderFont'))$('renderFont').value=snap.renderFont;
    const prev=$('fontPreview');if(prev)prev.style.fontFamily=`"${snap.renderFont}",monospace`;
  }
  // v7: bgStyle/bgColor
  if(snap.bgStyle){
    S.bgStyle=snap.bgStyle;S.bgColor=snap.bgColor||'#07070a';
    document.querySelectorAll('[data-bg]').forEach(p=>p.classList.toggle('on',p.dataset.bg===S.bgStyle));
    $('bgColorRow').style.display=S.bgStyle==='custom'?'block':'none';
    if($('bgColorPicker'))$('bgColorPicker').value=S.bgColor;
    if($('bgColorHex'))$('bgColorHex').value=S.bgColor;
    if($('bgColorSwatch'))$('bgColorSwatch').style.background=S.bgColor;
  }
  function sv(id,v){const el=$(id);if(!el||v===undefined||v===null)return;el.value=v;}
  // Resolution
  sv('outWVal',snap.outW);sv('outWSlider',snap.outW);
  sv('outHVal',snap.outH);sv('outHSlider',snap.outH);
  // AR lock
  S.arLocked=!!snap.arLocked;S.arRatio=snap.arRatio||null;
  setHexLock($('arLockBtn'),'arHexBar',S.arLocked);
  // Block & font
  sv('blockVal',snap.blockSize);sv('blockSlider',snap.blockSize);
  sv('fontVal',snap.fontSize);sv('fontSlider',snap.fontSize);
  sv('scaleVal',snap.scale);sv('scaleSlider',snap.scale);
  if(snap.bfLocked!==undefined){
    S.bfLocked=!!snap.bfLocked;
    setHexLock($('bfLockBtn'),'bfHexBar',S.bfLocked);
    $('bfLockLabel').textContent=S.bfLocked?'Block locked to font':'Block & font independent';
  }
  if(snap.cellMode){
    S.cellMode=snap.cellMode;
    document.querySelectorAll('[data-cell]').forEach(p=>p.classList.toggle('on',p.dataset.cell===snap.cellMode));
    if($('cellModeHint'))$('cellModeHint').textContent=cellHints[snap.cellMode]||'';
  }
  // Characters
  sv('invertVal',snap.invertThr);sv('invertSlider',snap.invertThr);
  if(snap.charset){
    S.charset=snap.charset;
    document.querySelectorAll('#csopts .csopt').forEach(o=>o.classList.toggle('on',o.dataset.cs===snap.charset));
    $('customCharsInput').value=snap.customChars||'';
    $('customCharsInput').style.display=snap.charset==='custom'?'block':'none';
    if(snap.customChars){
  const base=Array.from(snap.customChars);
  const target=Math.max(base.length,64);
  const repeated=[];
  while(repeated.length<target) repeated.push(...base);
  CHARSETS.custom=repeated.slice(0,target);
}
  }
  sv('ditherMode',snap.ditherMode);
  // Color
  S.colorMode=snap.colorMode||'char';
  document.querySelectorAll('[data-cm]').forEach(p=>p.classList.toggle('on',p.dataset.cm===S.colorMode));
  S.bgInverted=!!snap.bgInverted;
  $('btnBgInvert').classList.toggle('active',S.bgInverted);
  if(snap.bothMode){
    S.bothMode=snap.bothMode;
    document.querySelectorAll('[data-bm]').forEach(p=>p.classList.toggle('on',p.dataset.bm===snap.bothMode));
    if($('bothHint'))$('bothHint').textContent=bothHints[snap.bothMode]||'';
  }
  if($('bothOpts'))$('bothOpts').style.display=S.colorMode==='both'?'block':'none';
  sv('palMode',snap.palMode);
  if($('lockBody'))$('lockBody').style.display=snap.palMode==='lock'?'block':'none';
  if($('hexBody'))$('hexBody').style.display=snap.palMode==='hex'?'block':'none';
  if(snap.hexColors){S.hexColors=[...snap.hexColors];renderSwatches();}
  sv('lockVal',snap.lockN);sv('lockSlider',snap.lockN);
  // Preprocessing
  if(snap.pp){
    Object.assign(S.pp,snap.pp);
    ppFields.forEach(([slid,inid,key])=>{
      const v=S.pp[key]!==undefined?S.pp[key]:0;
      if($(slid))$(slid).value=key==='exposure'?Math.round(v*100):v;
      if($(inid))$(inid).value=key==='exposure'?parseFloat(v).toFixed(2):v;
    });
  }
  // Region
  if(snap.region){
    S.region=snap.region;
    document.querySelectorAll('[data-region]').forEach(p=>p.classList.toggle('on',p.dataset.region===snap.region));
    if($('regionHint'))$('regionHint').textContent=regionHints[snap.region]||'';
    const r=snap.region;
    if($('edgeOpts'))$('edgeOpts').style.display=r==='edges'?'block':'none';
    if($('colorRangeOpts'))$('colorRangeOpts').style.display=r==='color'?'block':'none';
    if($('subjectOpts'))$('subjectOpts').style.display=r==='subject'?'block':'none';
    if($('regionLeniencyOpts'))$('regionLeniencyOpts').style.display=(tonalRegions.has(r)||r==='color')?'block':'none';
    if($('manualBoxOpts'))$('manualBoxOpts').style.display=r==='manual'?'block':'none';
    if($('brushOpts'))$('brushOpts').style.display=r==='brush'?'block':'none';
    const isAll=r==='all';
    if($('regionOverrideSec'))$('regionOverrideSec').style.display=isAll?'none':'block';
    if($('outsideRegionSec'))$('outsideRegionSec').style.display=isAll?'none':'block';
    sv('regionLeniency',snap.regionLeniency);sv('regionLeniencySlider',snap.regionLeniency);
    sv('edgeThresh',snap.edgeThresh);sv('edgeThreshSlider',snap.edgeThresh);
    if(snap.regionFill)document.querySelectorAll('[data-fill]').forEach(p=>p.classList.toggle('on',p.dataset.fill===snap.regionFill));
    // Color range
    if(snap.regionColor&&$('regionColor')){
      $('regionColor').value=snap.regionColor;
      $('regionColorHex').value=snap.regionColor;
      $('regionColorSwatch').style.background=snap.regionColor;
    }
    if(snap.targetColors&&snap.targetColors.length){
      S.targetColors=[...snap.targetColors];
      renderColorList();
    }
    sv('regionHueTol',snap.regionHueTol);sv('regionHueTolSlider',snap.regionHueTol);
    sv('subjectPadding',snap.subjectPadding);sv('subjectPaddingSlider',snap.subjectPadding);
    sv('subjectConf',snap.subjectConf);sv('subjectConfSlider',snap.subjectConf);
    // Detect mode pills
    if(snap.detectMode){
      document.querySelectorAll('[data-dmode]').forEach(p=>p.classList.toggle('on',p.dataset.dmode===snap.detectMode));
    }
  }
  // Export format
  sv('exportFmt',snap.exportFmt);
  // Settings toggles
  if(snap.cfg)Object.assign(S.cfg,snap.cfg);
  [['tgl-memlimit','memLimit'],['tgl-chunk','chunked'],['tgl-watchdog','watchdog'],['tgl-auto','autoRender']].forEach(([id,k])=>{
    const el=$(id);if(el){if(S.cfg[k])el.classList.add('on');else el.classList.remove('on');}
  });
  scheduleRender();
}
$('exportSettingsBtn').addEventListener('click',()=>{
  const a=document.createElement('a');
  a.download='ascii-render-settings.json';
  a.href=URL.createObjectURL(new Blob([JSON.stringify(getSnap(),null,2)],{type:'application/json'}));
  a.click();
});
$('importSettingsBtn').addEventListener('click',()=>$('settingsFile').click());
$('settingsFile').addEventListener('change',()=>{
  const f=$('settingsFile').files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=e=>{try{applySnap(JSON.parse(e.target.result));}catch(err){alert('Could not parse settings: '+err.message);}};
  rd.readAsText(f);$('settingsFile').value='';
});
