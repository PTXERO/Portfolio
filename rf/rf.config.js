const RF = {

  title:   'RF',
  version: '0.3',

  // ── Accent color ─────────────────────────────────────────────
  accent:  '#42d4f5',
  accentB: '#f542a8',
  accentC: '#f5a542',

  // ── Default location ──────────────────────────────────────────
  location: {
    name:   'Pensacola, Florida',
    lat:     30.4213,
    lon:    -87.2169,
    radius:  150,
  },

  // ── Noise floor simulation ────────────────────────────────────
  noiseFloor: {
    base:        -120,
    tempK:        305,
    bandwidth:   1e6,
    humidityRH:   85,
  },

  // ── Spectrum display ──────────────────────────────────────────
  spectrum: {
    freqMin:      88,
    freqMax:      108,
    dbMin:       -140,
    dbMax:        -40,
    speed:          2,
    smoothing:     0.8,
  },

  // ── City presets ──────────────────────────────────────────────
  cities: [
    // North America
    { name:'Pensacola, FL',      lat: 30.4213, lon: -87.2169, region:'NA' },
    { name:'New York, NY',       lat: 40.7128, lon: -74.0060, region:'NA' },
    { name:'Los Angeles, CA',    lat: 34.0522, lon:-118.2437, region:'NA' },
    { name:'Chicago, IL',        lat: 41.8781, lon: -87.6298, region:'NA' },
    { name:'Miami, FL',          lat: 25.7617, lon: -80.1918, region:'NA' },
    { name:'Dallas, TX',         lat: 32.7767, lon: -96.7970, region:'NA' },
    { name:'Seattle, WA',        lat: 47.6062, lon:-122.3321, region:'NA' },
    { name:'Toronto, Canada',    lat: 43.6532, lon: -79.3832, region:'NA' },
    { name:'Mexico City, MX',    lat: 19.4326, lon: -99.1332, region:'NA' },
    { name:'Vancouver, Canada',  lat: 49.2827, lon:-123.1207, region:'NA' },
    // Europe
    { name:'London, UK',         lat: 51.5074, lon:  -0.1278, region:'EU' },
    { name:'Paris, France',      lat: 48.8566, lon:   2.3522, region:'EU' },
    { name:'Berlin, Germany',    lat: 52.5200, lon:  13.4050, region:'EU' },
    { name:'Madrid, Spain',      lat: 40.4168, lon:  -3.7038, region:'EU' },
    { name:'Rome, Italy',        lat: 41.9028, lon:  12.4964, region:'EU' },
    { name:'Amsterdam, NL',      lat: 52.3676, lon:   4.9041, region:'EU' },
    { name:'Stockholm, Sweden',  lat: 59.3293, lon:  18.0686, region:'EU' },
    { name:'Warsaw, Poland',     lat: 52.2297, lon:  21.0122, region:'EU' },
    { name:'Kyiv, Ukraine',      lat: 50.4501, lon:  30.5234, region:'EU' },
    { name:'Istanbul, Turkey',   lat: 41.0082, lon:  28.9784, region:'EU' },
    // Asia
    { name:'Tokyo, Japan',       lat: 35.6762, lon: 139.6503, region:'AS' },
    { name:'Seoul, Korea',       lat: 37.5665, lon: 126.9780, region:'AS' },
    { name:'Beijing, China',     lat: 39.9042, lon: 116.4074, region:'AS' },
    { name:'Shanghai, China',    lat: 31.2304, lon: 121.4737, region:'AS' },
    { name:'Mumbai, India',      lat: 19.0760, lon:  72.8777, region:'AS' },
    { name:'Delhi, India',       lat: 28.6139, lon:  77.2090, region:'AS' },
    { name:'Bangkok, Thailand',  lat: 13.7563, lon: 100.5018, region:'AS' },
    { name:'Singapore',          lat:  1.3521, lon: 103.8198, region:'AS' },
    { name:'Jakarta, Indonesia', lat: -6.2088, lon: 106.8456, region:'AS' },
    { name:'Manila, Philippines',lat: 14.5995, lon: 120.9842, region:'AS' },
    // Middle East & Africa
    { name:'Dubai, UAE',         lat: 25.2048, lon:  55.2708, region:'ME' },
    { name:'Cairo, Egypt',       lat: 30.0444, lon:  31.2357, region:'ME' },
    { name:'Nairobi, Kenya',     lat: -1.2921, lon:  36.8219, region:'AF' },
    { name:'Lagos, Nigeria',     lat:  6.5244, lon:   3.3792, region:'AF' },
    { name:'Johannesburg, SA',   lat:-26.2041, lon:  28.0473, region:'AF' },
    { name:'Casablanca, Morocco',lat: 33.5731, lon:  -7.5898, region:'AF' },
    // South America
    { name:'São Paulo, Brazil',  lat:-23.5505, lon: -46.6333, region:'SA' },
    { name:'Buenos Aires, AR',   lat:-34.6037, lon: -58.3816, region:'SA' },
    { name:'Bogotá, Colombia',   lat:  4.7110, lon: -74.0721, region:'SA' },
    { name:'Lima, Peru',         lat:-12.0464, lon: -77.0428, region:'SA' },
    // Oceania
    { name:'Sydney, Australia',  lat:-33.8688, lon: 151.2093, region:'OC' },
    { name:'Melbourne, Australia',lat:-37.8136,lon: 144.9631, region:'OC' },
    { name:'Auckland, NZ',       lat:-36.8485, lon: 174.7633, region:'OC' },
  ],

  // ── Tiles ─────────────────────────────────────────────────────
  tiles: [
    { id: 'oscilloscope', label: 'OSCILLOSCOPE', side: 'left',  order: 1 },
    { id: 'signalchain',  label: 'SIGNAL CHAIN', side: 'left',  order: 2 },
    { id: 'transmitter',  label: 'TRANSMITTER',  side: 'right', order: 1 },
    { id: 'ascii',        label: 'ASCII BRIDGE', side: 'right', order: 2 },
  ],

};