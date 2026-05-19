const EXPOSED = {
  title:   'EXPOSED',
  tagline: 'YOU ARE NOT ANONYMOUS',
  scanDuration: 3000,
  typeDelay: 60,
  fields: [
    // Device
    { id: 'browser',      label: 'BROWSER IDENTIFIED',       enabled: true },
    { id: 'os',           label: 'OPERATING SYSTEM',         enabled: true },
    { id: 'screen',       label: 'DISPLAY CAPTURED',         enabled: true },
    { id: 'pixelratio',   label: 'PIXEL DENSITY',            enabled: true },
    { id: 'viewport',     label: 'WINDOW SIZE',              enabled: true },
    { id: 'cores',        label: 'CPU CORES DETECTED',       enabled: true },
    { id: 'memory',       label: 'DEVICE MEMORY',            enabled: true },
    { id: 'touchscreen',  label: 'INPUT METHOD',             enabled: true },
    { id: 'battery',      label: 'BATTERY',                  enabled: true },
    { id: 'gamepad',      label: 'GAMEPAD CONNECTED',        enabled: true },
    // Network
    { id: 'connection',   label: 'CONNECTION FINGERPRINTED', enabled: true },
    { id: 'referrer',     label: 'ORIGIN TRACED',            enabled: true },
    { id: 'webrtc',       label: 'LOCAL IP LEAKED',          enabled: true },
    // Environment
    { id: 'timezone',     label: 'TIMEZONE LOGGED',          enabled: true },
    { id: 'locale',       label: 'LANGUAGE PROFILED',        enabled: true },
    { id: 'dnt',          label: 'DO NOT TRACK',             enabled: true },
    { id: 'cookies',      label: 'COOKIES ENABLED',          enabled: true },
    { id: 'localstorage', label: 'LOCAL STORAGE',            enabled: true },
    { id: 'indexeddb',    label: 'INDEXED DB',               enabled: true },
    { id: 'serviceworker',label: 'SERVICE WORKER',           enabled: true },
    { id: 'wasm',         label: 'WEBASSEMBLY',              enabled: true },
    { id: 'pdf',          label: 'PDF VIEWER',               enabled: true },
    { id: 'plugins',      label: 'BROWSER PLUGINS',          enabled: true },
    { id: 'loadtime',     label: 'PAGE LOAD TIME',           enabled: true },
    // Fingerprint
    { id: 'canvas',       label: 'CANVAS FINGERPRINT',       enabled: true },
    { id: 'webgl',        label: 'GPU IDENTIFIED',           enabled: true },
    { id: 'webglvendor',  label: 'GPU VENDOR',               enabled: true },
    { id: 'webglmax',     label: 'MAX TEXTURE SIZE',         enabled: true },
    { id: 'webglext',     label: 'GPU EXTENSIONS',           enabled: true },
    { id: 'audio',        label: 'AUDIO FINGERPRINT',        enabled: true },
    { id: 'fonts',        label: 'INSTALLED FONTS DETECTED', enabled: true },
  ],
  permissionFields: [
    { id: 'location',   label: 'PRECISE LOCATION', prompt: 'REQUEST ACCESS' },
    { id: 'camera',     label: 'CAMERA',           prompt: 'REQUEST ACCESS' },
    { id: 'microphone', label: 'MICROPHONE',       prompt: 'REQUEST ACCESS' },
  ],
  note: 'No prompts. No warnings. This is standard.',
  // ── Known tracker signatures ─────────────────────────────────
  trackers: [
    // Google
    { key: '_ga',          owner: 'Google Analytics',   risk: 'LOW',    desc: 'Unique visitor ID. Tracks your sessions across every site running Google Analytics. Persists 2 years.' },
    { key: '_gid',         owner: 'Google Analytics',   risk: 'LOW',    desc: 'Session identifier. Expires after 24 hours but refreshes on every visit.' },
    { key: '_gat',         owner: 'Google Analytics',   risk: 'LOW',    desc: 'Rate limiting cookie. Throttles request frequency to Google servers.' },
    { key: '_gcl_au',      owner: 'Google Ads',         risk: 'MEDIUM', desc: 'Conversion tracking. Ties your browsing to ad clicks. Shared between advertiser sites and Google.' },
    { key: '_gcl_aw',      owner: 'Google Ads',         risk: 'MEDIUM', desc: 'AdWords click ID. Records which ad you clicked before arriving at a site.' },
    { key: 'IDE',          owner: 'Google DoubleClick',  risk: 'HIGH',   desc: 'Cross-site advertising ID. Used to build a profile of your interests across millions of sites in the Google Display Network.' },
    { key: '__utma',       owner: 'Google Analytics (legacy)', risk: 'LOW', desc: 'Legacy visitor tracking. Counts visits and timestamps your first and most recent session.' },
    { key: '__utmz',       owner: 'Google Analytics (legacy)', risk: 'LOW', desc: 'Legacy referral tracking. Records how you arrived at the site — search engine, direct, or referral.' },
    // Facebook / Meta
    { key: '_fbp',         owner: 'Meta (Facebook)',     risk: 'HIGH',   desc: 'Browser fingerprint ID. Tracks you across every site with a Facebook Pixel installed, even if you never click anything.' },
    { key: '_fbc',         owner: 'Meta (Facebook)',     risk: 'HIGH',   desc: 'Facebook click ID. Set when you click a Facebook ad. Ties your off-platform browsing back to your Facebook profile.' },
    { key: 'fr',           owner: 'Meta (Facebook)',     risk: 'HIGH',   desc: 'Advertising cookie. Primary ID used by Facebook to serve and measure targeted ads. Persists 90 days.' },
    { key: 'sb',           owner: 'Meta (Facebook)',     risk: 'HIGH',   desc: 'Browser ID stored by facebook.com. Used to identify your browser across sessions even when logged out.' },
    { key: 'xs',           owner: 'Meta (Facebook)',     risk: 'HIGH',   desc: 'Session credential. Part of your Facebook login state. Contains encoded session data.' },
    { key: 'datr',         owner: 'Meta (Facebook)',     risk: 'HIGH',   desc: 'Device ID set on first Facebook visit. Used for fraud detection and cross-device tracking. Persists 2 years.' },
    // TikTok
    { key: 'tt_webid',     owner: 'TikTok',              risk: 'HIGH',   desc: 'TikTok web tracking ID. Assigned on first visit to any TikTok Pixel site. Follows you across the web.' },
    { key: 'tt_sessionid', owner: 'TikTok',              risk: 'MEDIUM', desc: 'Session tracker. Records activity within a browsing session on TikTok Pixel sites.' },
    { key: '_ttp',         owner: 'TikTok',              risk: 'HIGH',   desc: 'Cross-site tracking cookie. Measures ad conversions and builds behavioral profiles.' },
    // Twitter / X
    { key: 'guest_id',     owner: 'Twitter / X',         risk: 'MEDIUM', desc: 'Anonymous visitor ID. Set even if you never log in. Used to track engagement with embedded tweets.' },
    { key: 'personalization_id', owner: 'Twitter / X',  risk: 'HIGH',   desc: 'Personalization tracker. Used to tailor ads and content based on your browsing history outside Twitter.' },
    { key: 'ct0',          owner: 'Twitter / X',         risk: 'MEDIUM', desc: 'CSRF token tied to your session. Encodes authentication state.' },
    // LinkedIn
    { key: 'li_sugr',      owner: 'LinkedIn',            risk: 'MEDIUM', desc: 'Browser identifier for probabilistic matching. Used when cookies are blocked to still identify your device.' },
    { key: 'bcookie',      owner: 'LinkedIn',            risk: 'MEDIUM', desc: 'Browser ID cookie. Persists 2 years. Tracks your visits across LinkedIn and partner sites.' },
    { key: 'bscookie',     owner: 'LinkedIn',            risk: 'MEDIUM', desc: 'Secure browser ID. Same as bcookie but transmitted over HTTPS only.' },
    { key: 'lidc',         owner: 'LinkedIn',            risk: 'LOW',    desc: 'Data center routing cookie. Ensures your requests go to the same server. Expires daily.' },
    { key: 'AnalyticsSyncHistory', owner: 'LinkedIn',   risk: 'MEDIUM', desc: 'Sync record for LinkedIn Insight Tag. Timestamps when your browser last synced with LinkedIn ad servers.' },
    // Amazon
    { key: 'session-id',   owner: 'Amazon',              risk: 'MEDIUM', desc: 'Shopping session ID. Tracks your cart, browsing history, and product views.' },
    { key: 'ubid-main',    owner: 'Amazon',              risk: 'HIGH',   desc: 'Unique browser ID. Persists across sessions and devices to personalize recommendations and ads.' },
    { key: 'ad-id',        owner: 'Amazon Advertising',  risk: 'HIGH',   desc: 'Advertising identifier. Used by Amazon DSP to serve targeted ads across the web.' },
    // Microsoft
    { key: 'MUID',         owner: 'Microsoft',           risk: 'HIGH',   desc: 'Machine unique ID. Set by Bing and used across Microsoft advertising and tracking products. Persists 1 year.' },
    { key: 'MC1',          owner: 'Microsoft',           risk: 'MEDIUM', desc: 'Microsoft tracking cookie. Used for ad targeting across MSN, Outlook, and partner sites.' },
    { key: 'MR',           owner: 'Microsoft',           risk: 'LOW',    desc: 'Cookie consent marker. Records whether MUID renewal was acknowledged.' },
    // Hotjar
    { key: '_hjid',        owner: 'Hotjar',              risk: 'HIGH',   desc: 'Session recording ID. If this site uses Hotjar, your mouse movements, clicks, and scrolling are being recorded.' },
    { key: '_hjFirstSeen', owner: 'Hotjar',              risk: 'MEDIUM', desc: 'First visit flag. Marks this as your first recorded session.' },
    { key: '_hjAbsoluteSessionInProgress', owner: 'Hotjar', risk: 'HIGH', desc: 'Active recording flag. Your current session is being recorded right now.' },
    // Mixpanel
    { key: 'mp_',          owner: 'Mixpanel',            risk: 'MEDIUM', desc: 'Mixpanel analytics ID. Tracks user behavior and funnels across product pages.' },
    // Cloudflare
    { key: '__cf_bm',      owner: 'Cloudflare',          risk: 'LOW',    desc: 'Bot management token. Used to distinguish humans from automated traffic. Expires after 30 minutes.' },
    { key: 'cf_clearance', owner: 'Cloudflare',          risk: 'LOW',    desc: 'Challenge clearance. Proves you passed a Cloudflare security check.' },
    // General ad networks
    { key: 'uuid',         owner: 'Ad Network (generic)', risk: 'HIGH',  desc: 'Generic unique user ID. Used by various ad networks to track you across publisher sites.' },
    { key: 'uid',          owner: 'Ad Network (generic)', risk: 'HIGH',  desc: 'User identifier. Commonly used by data brokers and ad exchanges to sync profiles.' },
    { key: 'sync',         owner: 'Ad Network (generic)', risk: 'HIGH',  desc: 'Cookie sync token. Used to match your ID between different ad networks — your profile being traded.' },
    //DarkReader
    { key: '__darkreader__wasEnabledForHost', owner: 'Dark Reader Extension', risk: 'LOW', desc: 'Written by the Dark Reader browser extension. Records whether dark mode was applied on this domain. Not a tracker — but demonstrates that browser extensions can write to any site\'s storage without your knowledge.' },
  ],
};