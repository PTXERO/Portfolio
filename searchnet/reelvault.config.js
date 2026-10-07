// ─────────────────────────────────────────────────────────────────
//  SEARCH//NET — Configuration
// ─────────────────────────────────────────────────────────────────

const REELVAULT = {

  // Where the local server listens (python searchnet/server/reelvault.py).
  // When the page is opened from the server itself this is ignored.
  apiBase: 'http://127.0.0.1:8765',

  // Results fetched per page (infinite scroll loads more)
  pageSize: 40,

  // Fall back to the built-in sample library when no server is found,
  // so the page still works when hosted statically (e.g. GitHub Pages).
  demoFallback: true,
};
