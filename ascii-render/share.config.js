// ─────────────────────────────────────────────────────────────────
//  ASCII//RENDER — Share & Remix config
//  Paste your NEW Supabase project's values below (Project Settings → API).
//  The anon/publishable key is safe in client code — Row-Level Security is the
//  real protection (same pattern as the RF app).
// ─────────────────────────────────────────────────────────────────
window.SHARE = {
  supabaseUrl:     'https://tfquiunqquuctgkpmiba.supabase.co',   // ← ptxero-rf project (active → won't pause)
  supabaseAnonKey: 'sb_publishable_-PRQWq6Bv6NrJuqpMkymgw_zORhf-mE',   // ← anon / publishable key (RF project)
  bucket:          'renders',                            // Storage bucket name
  maxSourcePx:     1600,   // source image is downscaled to this before upload (bounds storage; still reproduces well)
  workerUrl:       'https://share.ptxero.net',     // ← after deploying og-worker.js, put its URL here (e.g. https://ascii-og.<your-subdomain>.workers.dev). Empty = plain view.html links (no rich cards).
};
