// ─────────────────────────────────────────────────────────────────
//  DEAD//AIR — game engine: rules and timing, no drawing.
//  index.html renders this state and turns g.events into effects.
//  tools/dead_air_sim.js runs it headless to check the difficulty.
// ─────────────────────────────────────────────────────────────────
(function (root) {
  const N = 12;                 // prize podiums on the strip to start with (BIGGER STAGE adds more)
  const EPISODES = 15;          // a full season: three acts of five episodes
  const PILOT = 5;              // the short game: act one only
  const ACT = 5;
  const ROUND_TIME = 16;        // seconds of moving light per round
  const TARGETS = [2000, 2300, 2700, 3200, 4200, 5200, 6500, 8200, 11000, 15000, 19000, 24000, 31000, 40000, 55000];

  // Every gimmick is something you can see on the set. d(lv) = what it does at that level.
  const GIMMICKS = [
    { id: 'twin',   tag: 'TW', color: '#42d4f5', max: 3, name: 'TWIN SPOTS',      d: l => `+${l} spotlight${l > 1 ? 's' : ''}.` },
    { id: 'mirror', tag: 'MB', color: '#d8d8e0', max: 5, name: 'MIRROR BALL',     d: l => `${l} stray beam${l > 1 ? 's' : ''} per buzz.` },
    { id: 'pyro',   tag: 'PY', color: '#ff9a2e', max: 4, name: 'PYROTECHNICS',    d: l => `PERFECT also wins ${l} each side.` },
    { id: 'wire',   tag: 'ZP', color: '#fff36b', max: 5, name: 'LIVE WIRE',       d: l => `Chains to ${l} more of the same kind.` },
    { id: 'laser',  tag: 'LZ', color: '#f542a8', max: 4, name: 'LASER SHOW',      d: l => `Every 3rd buzz, a laser wins ${l + 1}.` },
    { id: 'drone',  tag: 'DR', color: '#9d8cff', max: 4, name: 'CAMERA DRONE',    d: l => `${l} drone${l > 1 ? 's' : ''} collect cash.` },
    { id: 'cannon', tag: 'CN', color: '#c8f542', max: 5, name: 'T-SHIRT CANNONS', d: l => `Banking fires ${l} extra prize${l > 1 ? 's' : ''}.` },
    { id: 'crowd',  tag: 'CR', color: '#f5a542', max: 4, name: 'CROWD PLEASER',   d: l => `Crowd throws on 3 extra prizes per stage${l > 1 ? ', worth x' + l : ''}.` },
    { id: 'bleep',  tag: 'BL', color: '#7fe0ff', max: 4, name: 'BLEEP BUTTON',    d: l => `${l} dead air stop${l > 1 ? 's' : ''} ignored per round.` },
    { id: 'wide',   tag: 'WD', color: '#ffffff', max: 4, name: 'FOLLOW SPOT',     d: l => `Bigger PERFECT zone (level ${l}).` },
    { id: 'gold',   tag: 'AU', color: '#ffd24a', max: 4, name: 'GOLD RUSH',       d: l => `${l} gold prize${l > 1 ? 's' : ''} per strip.` },
    { id: 'budget', tag: '$$', color: '#5fe08a', max: 5, name: 'PRIZE BUDGET',    d: l => `Prizes +$${10 * l}.` },
    { id: 'jack',   tag: 'JK', color: '#ff6bd6', max: 4, name: 'DIAMOND PODIUM',  d: l => `A diamond: pot x${1.5 + 0.5 * l}, once a round.` },
    { id: 'hypeman',tag: 'HY', color: '#42d4f5', max: 5, name: 'HYPE MAN',        d: l => `Hype prizes give +${1 + l}.` },
    { id: 'net',    tag: 'SN', color: '#42f5b0', max: 3, name: 'SAFETY NET',      d: l => `Dead air keeps ${Math.min(100, 25 * l)}%.` },
    { id: 'encore', tag: '+1', color: '#c8f542', max: 3, name: 'ENCORE',          d: l => `+${l} round${l > 1 ? 's' : ''}.` },
    { id: 'stage',  tag: 'BS', color: '#6a55c8', max: 4, name: 'BIGGER STAGE',    d: l => `+${l} podium${l > 1 ? 's' : ''}.` },
    { id: 'clock',  tag: 'XT', color: '#ffd24a', max: 4, name: 'EXTENDED CUT',    d: l => `+${4 * l} seconds.` },
    { id: 'slowmo', tag: 'SL', color: '#7fe0ff', max: 3, name: 'DRAMATIC PAUSE',  d: l => `+${l} slow-mo.` },

    // Headliners: rare, one level only, and each one changes a rule instead of a number.
    { id: 'ghost',  rare: true, tag: 'GH', color: '#e9e9ff', max: 1, name: 'GHOST LIGHT',      d: () => 'Burnt podiums are safe.' },
    { id: 'streak', rare: true, tag: 'HS', color: '#ff7a2e', max: 1, name: 'HOT STREAK',       d: () => 'PERFECT streaks pay x2, x3, x4.' },
    { id: 'combo',  rare: true, tag: 'CC', color: '#f5a542', max: 1, name: 'CROWD COMBO',      d: () => '+0.5 hype per extra prize in a buzz.' },
    { id: 'midas',  rare: true, tag: 'MD', color: '#ffd24a', max: 1, name: 'MIDAS TOUCH',      d: () => 'PERFECT turns 2 cash to gold.' },
    { id: 'steady', rare: true, tag: 'SC', color: '#9d8cff', max: 1, name: 'STEADY CAM',       d: () => 'The light never speeds up.' },
    { id: 'life',   rare: true, tag: 'RR', color: '#ff5a7a', max: 1, name: 'RERUN',            d: () => 'Once an episode, survive dead air.' },
    { id: 'double', rare: true, tag: 'DN', color: '#ffd24a', max: 1, name: 'DOUBLE OR NOTHING', d: () => 'Banking flips a coin: x2.5 or half.' },
    { id: 'static', rare: true, tag: 'ST', color: '#f542a8', max: 1, name: 'STATIC CLING',     d: () => '+1 starting hype per dead air TV.' },

    // ── More gimmicks ──
    { id: 'echo',     tag: 'EC', color: '#9d8cff', max: 3, name: 'ECHO CHAMBER',   d: l => `Every ${['', '4th', '3rd', '2nd'][l]} buzz pays twice.` },
    { id: 'tipline',  tag: 'TL', color: '#5fe08a', max: 5, name: 'TIP LINE',       d: l => `+$${5 * l} per prize a gimmick wins.` },
    { id: 'opener',   tag: 'CO', color: '#42d4f5', max: 3, name: 'COLD OPEN',      d: l => `First buzz x${1 + l}.` },
    { id: 'closer',   tag: 'BF', color: '#ff9a2e', max: 4, name: 'BIG FINISH',     d: l => `Bank in the last 3 seconds: x${1 + 0.25 * l}.` },
    { id: 'residual', tag: 'RS', color: '#ffd24a', max: 4, name: 'RESIDUALS',      d: l => `Start with ${5 * l}% of the last bank.` },
    { id: 'edges',    tag: 'SW', color: '#d4244e', max: 3, name: 'STAGE WINGS',    d: l => `End podiums x${1 + l}.` },
    { id: 'center',   tag: 'CS', color: '#fff4c2', max: 3, name: 'CENTRE STAGE',   d: l => `Middle podiums x${1 + l}.` },
    { id: 'recycle',  tag: 'RC', color: '#42f5b0', max: 3, name: 'REPEAT SHOWING', d: l => `${15 * l}% chance a prize stays.` },
    { id: 'sparks',   tag: 'SK', color: '#fff36b', max: 4, name: 'SPARKLERS',      d: l => `PERFECT: +${0.25 * l} hype.` },
    { id: 'stoppage', tag: 'ST', color: '#7fe0ff', max: 4, name: 'STOPPAGE TIME',  d: l => `PERFECT: +${0.5 * l}s.` },
    { id: 'antenna',  tag: 'RE', color: '#d8d8e0', max: 4, name: 'RABBIT EARS',    d: l => `${10 * l}% to fix a TV next door.` },
    { id: 'lucky',    tag: 'LS', color: '#ff6bd6', max: 3, name: 'LUCKY SOCKS',    d: l => `${12 * l}% chance dead air is ignored.` },
    { id: 'ovation',  tag: 'SO', color: '#f5a542', max: 4, name: 'STANDING OVATION', d: l => `Stage clear: +${2 + l} hype.` },
    { id: 'thrift',   tag: 'BB', color: '#b98a4a', max: 4, name: 'BARGAIN BIN',    d: l => `$10 prizes +$${15 * l}.` },
    { id: 'rainy',    tag: 'RD', color: '#42d4f5', max: 4, name: 'RAINY DAY FUND', d: l => `Dead air still banks $${100 * l}.` },

    { id: 'allin',     lock: true, rare: true, tag: 'AI', color: '#e8203a', max: 1, name: 'ALL IN',            d: () => 'No banking. The pot doubles at time.' },
    { id: 'slowburn',  lock: true, rare: true, tag: 'SB', color: '#ff9a2e', max: 1, name: 'SLOW BURN',         d: () => 'Half speed, but speeds up twice as fast.' },
    { id: 'bogo',      lock: true, rare: true, tag: 'B1', color: '#c8f542', max: 1, name: 'BUY ONE GET ONE',   d: () => 'First prize each round stays.' },
    { id: 'lastlaugh', lock: true, rare: true, tag: 'LL', color: '#ffd24a', max: 1, name: 'LAST LAUGH',        d: () => 'Final round pays double.' },
    { id: 'charity',   lock: true, rare: true, tag: 'MD', color: '#5fe08a', max: 1, name: 'MATCHED DONATION',  d: () => '+50% prize money.' },
    { id: 'greenlight',lock: true, rare: true, tag: 'GL', color: '#42f5b0', max: 1, name: 'GREEN LIGHT',       d: () => 'PERFECT: 50% the prize stays.' },
    { id: 'auction',   lock: true, rare: true, tag: 'BW', color: '#ffd24a', max: 1, name: 'BIDDING WAR',       d: () => 'Gold pays x8.' },
    { id: 'understudy',lock: true, rare: true, tag: 'US', color: '#9d8cff', max: 1, name: 'UNDERSTUDY',        d: () => 'Keep half of stolen prizes.' },
    { id: 'telethon',  lock: true, rare: true, tag: 'TT', color: '#7fe0ff', max: 1, name: 'TELETHON',          d: () => '+8 seconds. Light 10% faster.' },
    { id: 'vip',       lock: true, rare: true, tag: 'VP', color: '#ff5a7a', max: 1, name: 'VIP LOUNGE',        d: () => 'More cars and jackpots.' },
  ];
  const common = g => !g.rare;

  // Lucky charms: you carry one per run. Small quirks, not power.
  const CHARMS = [
    { id: 'ch_penny',    name: 'LUCKY PENNY',      desc: 'Prizes +$5.' },
    { id: 'ch_watch',    name: 'POCKET WATCH',     desc: '+2 seconds.' },
    { id: 'ch_lozenge',  name: 'THROAT LOZENGE',   desc: '+0.5 hype.' },
    { id: 'ch_foot',     name: "RABBIT'S FOOT",    desc: 'First dead air each episode ignored.' },
    { id: 'ch_headshot', name: 'SIGNED HEADSHOT',  desc: '+1 spin after episode 1.' },
    { id: 'ch_clover',   name: 'FOUR-LEAF CLOVER', desc: 'No toasters in mystery boxes.' },
    { id: 'ch_battery',  name: 'SPARE BATTERY',    desc: '+1 slow-mo.' },
    { id: 'ch_agent',    name: "AGENT'S CARD",     desc: '+15% prize money.' },
    { id: 'ch_sticky',   name: 'STICKY NOTE',      desc: '+1 wedge on your wheel.' },
    { id: 'ch_plugs',    name: 'EARPLUGS',         desc: 'Less interference.' },
    { id: 'ch_script',   name: 'OLD SCRIPT',       desc: '+4 seconds in round 1.' },
    { id: 'ch_coffee',   name: 'DECAF',            desc: 'Light 8% slower.' },
    { id: 'ch_tooth',    name: 'GOLD TOOTH',       desc: '+1 gold per strip.' },
    { id: 'ch_mints',    name: 'BREATH MINTS',     desc: 'Specials twice as likely.' },
    { id: 'ch_coupon',   name: 'COUPON BOOK',      desc: 'Crates 10% cheaper.' },
    { id: 'ch_cue',      name: 'CUE CARDS',        desc: 'Bigger PERFECT zone.' },
    { id: 'ch_pass',     name: 'STAGE PASS',       desc: '+1 bleep in act I.' },
    { id: 'ch_foil',     name: 'TIN FOIL HAT',     desc: '-1 dead air.' },
    { id: 'ch_tie',      name: 'LUCKY TIE',        desc: 'Final round +10%.' },
    { id: 'ch_fanmail',  name: 'FAN MAIL',         desc: 'Rounds start with $20.' },
  ];

  // New things that can turn up on a podium once unlocked.
  const XPRIZES = [
    { id: 'clockp',    name: 'STOPWATCH',   desc: '+5 seconds.' },
    { id: 'bleepp',    name: 'BLEEP TOKEN', desc: '+1 bleep.' },
    { id: 'superstar', name: 'SUPERSTAR',   desc: '+3 hype.' },
    { id: 'coin',      name: 'LUCKY COIN',  desc: 'Cash +50% or -25%.' },
    { id: 'broom',     name: 'THE BROOM',   desc: 'Wins every $10 and $20.' },
  ];

  // Wardrobe: looks only.
  const LOOKS = [
    { id: 'th_late',   slot: 'theme', name: 'LATE NIGHT SET',  wall: '#12234f', ray: '#1c3a80', floor: '#0c1838', curtain: '#2a5ad4', fold: '#183a9c' },
    { id: 'th_sunset', slot: 'theme', name: 'SUNSET SET',      wall: '#5c1c3a', ray: '#8a2e4a', floor: '#3a1026', curtain: '#f57a2e', fold: '#b84a12' },
    { id: 'th_70s',    slot: 'theme', name: 'SEVENTIES SET',   wall: '#4a2a12', ray: '#7a4a1c', floor: '#2e1a0a', curtain: '#d99a2e', fold: '#9c6a12' },
    { id: 'th_ice',    slot: 'theme', name: 'ICE SET',         wall: '#1c4a5c', ray: '#2e7a8a', floor: '#0f2e3a', curtain: '#bfe9f5', fold: '#7fb8c8' },
    { id: 'th_vegas',  slot: 'theme', name: 'VEGAS SET',       wall: '#1a1408', ray: '#4a3a10', floor: '#0e0b04', curtain: '#ffd24a', fold: '#a07a12' },
    { id: 'th_jungle', slot: 'theme', name: 'JUNGLE SET',      wall: '#12402a', ray: '#1e6a3e', floor: '#0a2818', curtain: '#5fe08a', fold: '#2a8a4a' },
    { id: 'th_gum',    slot: 'theme', name: 'BUBBLEGUM SET',   wall: '#6a2a6a', ray: '#a04a9a', floor: '#3e163e', curtain: '#ff8ad6', fold: '#c04a9a' },
    { id: 'th_noir',   slot: 'theme', name: 'NOIR SET',        wall: '#1e1e26', ray: '#3a3a48', floor: '#101016', curtain: '#8a8aa0', fold: '#4a4a5c' },
    { id: 'th_emerald',slot: 'theme', name: 'EMERALD SET',     wall: '#0e3a3a', ray: '#1a6060', floor: '#082424', curtain: '#12a08a', fold: '#0a6a5a' },
    { id: 'th_royal',  slot: 'theme', name: 'ROYAL SET',       wall: '#2a0e4a', ray: '#4a1a80', floor: '#18082e', curtain: '#8a2ad4', fold: '#5a129c' },
    { id: 'of_red',    slot: 'outfit', name: 'RED JUMPER',     shirt: '#e8203a', hair: '#2a1a10' },
    { id: 'of_green',  slot: 'outfit', name: 'GREEN CARDIGAN', shirt: '#2a9a5a', hair: '#8a5a22' },
    { id: 'of_gold',   slot: 'outfit', name: 'GOLD LAMÉ',      shirt: '#ffd24a', hair: '#150f24' },
    { id: 'of_pink',   slot: 'outfit', name: 'PINK BLAZER',    shirt: '#ff6bd6', hair: '#fff36b' },
    { id: 'of_purple', slot: 'outfit', name: 'PURPLE VELVET',  shirt: '#8a2ad4', hair: '#d8d8e0' },
    { id: 'of_orange', slot: 'outfit', name: 'ORANGE TRACKSUIT', shirt: '#ff9a2e', hair: '#5a3418' },
    { id: 'of_white',  slot: 'outfit', name: 'WHITE SUIT',     shirt: '#f4f4ff', hair: '#150f24' },
    { id: 'of_black',  slot: 'outfit', name: 'BLACK TURTLENECK', shirt: '#2a2a3a', hair: '#e8203a' },
    { id: 'of_lime',   slot: 'outfit', name: 'LIME WINDBREAKER', shirt: '#c8f542', hair: '#42d4f5' },
    { id: 'of_teal',   slot: 'outfit', name: 'TEAL OVERALLS',  shirt: '#12a08a', hair: '#f5a542' },
    { id: 'hj_blue',   slot: 'host', name: 'HOST: BLUE TUX',     jacket: '#2a5ad4' },
    { id: 'hj_gold',   slot: 'host', name: 'HOST: GOLD JACKET',  jacket: '#ffd24a' },
    { id: 'hj_white',  slot: 'host', name: 'HOST: WHITE DINNER JACKET', jacket: '#f4f4ff' },
    { id: 'hj_green',  slot: 'host', name: 'HOST: GREEN SEQUINS', jacket: '#2a9a5a' },
    { id: 'hj_red',    slot: 'host', name: 'HOST: RED VELVET',   jacket: '#b81430' },
    { id: 'hj_black',  slot: 'host', name: 'HOST: BLACK TIE',    jacket: '#2a2a3a' },
    { id: 'bz_blue',   slot: 'buzzer', name: 'BLUE BUZZER',   color: '#42d4f5' },
    { id: 'bz_green',  slot: 'buzzer', name: 'GREEN BUZZER',  color: '#5fe08a' },
    { id: 'bz_gold',   slot: 'buzzer', name: 'GOLD BUZZER',   color: '#ffd24a' },
    { id: 'bz_pink',   slot: 'buzzer', name: 'PINK BUZZER',   color: '#ff6bd6' },
    { id: 'bz_purple', slot: 'buzzer', name: 'PURPLE BUZZER', color: '#9d8cff' },
    { id: 'bz_white',  slot: 'buzzer', name: 'WHITE BUZZER',  color: '#f4f4ff' },
    { id: 'cf_gold',   slot: 'confetti', name: 'GOLD CONFETTI',   colors: ['#ffd24a', '#fff36b', '#a07a12', '#ffffff'] },
    { id: 'cf_pastel', slot: 'confetti', name: 'PASTEL CONFETTI', colors: ['#ffc8e8', '#c8e8ff', '#d8ffc8', '#fff0c8'] },
    { id: 'cf_mono',   slot: 'confetti', name: 'NEWSPRINT CONFETTI', colors: ['#ffffff', '#b9b9c6', '#5a5a70'] },
    { id: 'cf_fire',   slot: 'confetti', name: 'EMBER CONFETTI',  colors: ['#ff5a3c', '#ff9a2e', '#fff36b'] },
    { id: 'cf_sea',    slot: 'confetti', name: 'SEA GLASS CONFETTI', colors: ['#42d4f5', '#42f5b0', '#12a08a', '#ffffff'] },
    { id: 'cf_money',  slot: 'confetti', name: 'BANKNOTE CONFETTI', colors: ['#5fe08a', '#2a9a5a', '#c8f542'] },
  ];

  // Show formats: each one changes how the stage behaves. spins = bonus spins for clearing it.
  const FORMATS = [
    { id: 'classic',  color: '#c8f542', spins: 0, name: 'CLASSIC NIGHT', desc: 'No changes.' },
    { id: 'turbo',    color: '#ff9a2e', spins: 0, name: 'DOUBLE TIME',   desc: 'Faster light. Cash x2.' },
    { id: 'mystery',  color: '#9d8cff', spins: 1, name: 'MYSTERY NIGHT', desc: 'Prizes hidden until lit.' },
    { id: 'conveyor', color: '#42d4f5', spins: 1, name: 'CONVEYOR',      desc: 'The strip slides.' },
    { id: 'strobe',   color: '#ffffff', spins: 1, name: 'STROBE',        desc: 'The light jumps.' },
    { id: 'pendulum', color: '#42f5b0', spins: 0, name: 'PENDULUM',      desc: 'Slow ends, fast middle.' },
    { id: 'high',     color: '#ff6bd6', spins: 0, name: 'HIGH ROLLER',   desc: 'One fewer round. +2 hype.' },
    { id: 'goldnight',color: '#ffd24a', spins: 0, name: 'GOLD NIGHT',    desc: '+3 gold, +1 dead air.' },
    { id: 'censors',  color: '#f542a8', spins: 1, name: "CENSORS' NIGHT", desc: '+2 dead air, +1 bleep.' },
    // Unlocked from the Money Dump.
    { id: 'reflect',  lock: true, color: '#d8d8e0', spins: 0, name: 'MIRROR IMAGE', desc: 'Right half mirrors left.' },
    { id: 'shrink',   lock: true, color: '#ff5a3c', spins: 1, name: 'SHRINKING STAGE', desc: 'The ends go dark.' },
    { id: 'shuffle',  lock: true, color: '#c8f542', spins: 1, name: 'SHUFFLE', desc: 'Prizes move on every buzz.' },
    { id: 'jitters',  lock: true, color: '#ff6bd6', spins: 1, name: 'STAGE FRIGHT', desc: 'The light reverses at random.' },
    { id: 'cashonly', lock: true, color: '#5fe08a', spins: 0, name: 'CASH ONLY', desc: 'No hype. Cash x2.' },
    { id: 'onetake',  lock: true, color: '#7fe0ff', spins: 0, name: 'ONE TAKE', desc: 'One 40-second round.' },
  ];
  const SPECIALS = ['box', 'bomb', 'x2', 'restock'];

  // Rare events. An episode carries at most one, and most carry none.
  const SPECIAL_CHANCE = 0.06;                   // per episode, from episode 2
  const CAR_CHANCE = 0.02, JACKPOT_CHANCE = 0.008;   // per round
  const EVENTS = [
    { id: 'rival', color: '#e8203a', name: 'RIVAL CONTESTANT', desc: 'Steals prizes. Beat them: +1 spin.' },
    { id: 'vote',  color: '#f5a542', name: 'AUDIENCE VOTE',    desc: 'The crowd pick pays double.' },
    { id: 'offer', color: '#c8f542', name: "THE HOST'S OFFER", desc: 'Cash to skip a round.' },
    { id: 'ad',    color: '#42d4f5', name: 'COMMERCIAL BREAK', desc: 'A sponsor deal.' },
    { id: 'bonus', color: '#ffd24a', name: 'BONUS ROUND',      desc: 'One buzz for a spin.' },
  ];
  const DEALS = [
    { id: 'fast', name: 'ENERGY DRINK',  desc: 'Light +25%. Cash +50%.' },
    { id: 'tvs',  name: 'CABLE PACKAGE', desc: '+2 dead air. +2 hype.' },
    { id: 'time', name: 'EXTENDED AD',   desc: '-5 seconds. +1 spin.' },
  ];

  // Things you can do to the wheel itself.
  const WHEEL_UPS = [
    { id: 'trim', tag: 'CUT', color: '#f542a8', name: 'TRIM THE WHEEL', desc: 'Remove a bad wedge.', ok: g => g.wheel.some(w => w.type === 'dead' || w.type === 'junk') },
    { id: 'fat',  tag: 'FAT', color: '#42d4f5', name: 'WEIGHTED WHEEL', desc: 'Wider gimmick wedges.', ok: () => true },
    { id: 'gold', tag: 'x2',  color: '#ffd24a', name: 'GOLDEN WEDGE',   desc: 'A wedge that pays two.', ok: g => g.wheel.filter(w => w.type === 'gold').length < 2 },
    { id: 'spin', tag: '+1',  color: '#c8f542', name: 'FREE SPIN',      desc: '+1 spin.', ok: () => true },
  ];

  // Contestants: each one has a trait that bends a rule, a couple of starting gimmicks, and a look.
  const CONTESTANTS = [
    { id: 'rookie',    name: 'THE ROOKIE',            trait: "BEGINNER'S LUCK",  desc: 'First dead air each episode is ignored.', start: [], look: { shirt: '#42d4f5', hair: '#6a3a1a', prop: null } },
    { id: 'stunt',     name: 'THE STUNT COORDINATOR', trait: 'DAREDEVIL',        desc: 'PERFECT pays x2.5.', start: ['pyro', 'wide'], look: { shirt: '#ff7a2e', hair: '#2a1a10', prop: 'helmet' }, need: 'Clear episode 3', ok: st => st.bestEp >= 3 },
    { id: 'nerd',      name: 'THE AV NERD',           trait: 'TINKERER',         desc: 'Cash won by gimmicks +25%.', start: ['wire', 'drone'], look: { shirt: '#5fe08a', hair: '#150f24', prop: 'glasses' }, need: 'Clear episode 5', ok: st => st.bestEp >= 5 },
    { id: 'diva',      name: 'THE DIVA',              trait: 'SPOTLIGHT HOG',    desc: '+1 starting hype. -4 seconds.', start: ['crowd'], look: { shirt: '#b81ad4', hair: '#ffd24a', prop: 'tiara' }, need: 'Win a season', ok: st => st.wins >= 1 },
    { id: 'intern',    name: 'THE INTERN',            trait: 'FOR EXPOSURE',     desc: '+1 round. Half prize money.', start: ['opener'], look: { shirt: '#d8d8e0', hair: '#b9783a', prop: 'lanyard' }, need: 'Play 10 runs', ok: st => st.runs >= 10 },
    { id: 'gambler',   name: 'THE GAMBLER',           trait: 'HOUSE EDGE',       desc: 'A losing coin flip costs nothing.', start: ['double'], look: { shirt: '#1a6a3a', hair: '#150f24', prop: 'shades' }, need: 'Win a side bet', ok: st => !!(st.trophies && st.trophies.bet) },
    { id: 'excensor',  name: 'THE EX-CENSOR',         trait: 'RED PEN',          desc: '+2 bleeps. No slow-mo.', start: ['bleep', 'lucky'], look: { shirt: '#2a2438', hair: '#150f24', prop: 'bar' }, need: 'Beat The Censor', ok: st => !!(st.trophies && st.trophies.b_censor) },
    { id: 'exacct',    name: 'THE EX-ACCOUNTANT',     trait: 'COMPOUND INTEREST', desc: 'Pot cash +3% every 4 seconds.', start: ['budget', 'residual'], look: { shirt: '#3d6b52', hair: '#8a8aa0', prop: 'visor' }, need: 'Beat The Accountant', ok: st => !!(st.trophies && st.trophies.b_accountant) },
    { id: 'excritic',  name: 'THE EX-CRITIC',         trait: 'HIGH STANDARDS',   desc: 'PERFECT pays x3. Anything else pays half.', start: ['wide', 'sparks'], look: { shirt: '#5a4a8a', hair: '#150f24', prop: 'beret' }, need: 'Beat The Critic', ok: st => !!(st.trophies && st.trophies.b_critic) },
    { id: 'legend',    name: 'THE LEGEND',            trait: 'ONE MORE TAKE',    desc: 'Once a season, a cancelled show gets another round.', start: ['?rare'], look: { shirt: '#ffd24a', hair: '#e9e9ff', prop: 'star' }, need: 'Win at heat 3', ok: st => (st.heatBest || 0) >= 3 },
    // Found in the Prize Vault.
    { id: 'weather',   lock: true, name: 'THE WEATHER PRESENTER', trait: 'CLEAR SKIES',    desc: 'No interference.', start: ['wire', 'slowmo'], look: { shirt: '#42a0f5', hair: '#fff36b', prop: 'cloud' } },
    { id: 'shopping',  lock: true, name: 'THE SHOPPING HOST',     trait: 'MARK-UP',        desc: 'Cash prizes +$5.', start: ['budget', 'thrift'], look: { shirt: '#ffd24a', hair: '#b81430', prop: 'headset' } },
    { id: 'childstar', lock: true, name: 'THE CHILD STAR',        trait: 'COMEBACK KID',   desc: 'The last round pays x1.5.', start: ['encore', 'net'], look: { shirt: '#ff6bd6', hair: '#5a3418', prop: 'bow' } },
    { id: 'quizchamp', lock: true, name: 'THE QUIZ CHAMP',        trait: 'ON A ROLL',      desc: 'PERFECTs in a row: +0.25 hype each.', start: ['wide', 'wide'], look: { shirt: '#5fe08a', hair: '#150f24', prop: 'specs' } },
    { id: 'magician',  lock: true, name: 'THE STAGE MAGICIAN',    trait: 'VANISHING ACT',  desc: 'One less dead air TV.', start: ['?rare'], look: { shirt: '#2a2a3a', hair: '#8a2ad4', prop: 'tophat' } },
    { id: 'guard',     lock: true, name: 'THE NIGHT GUARD',       trait: 'NIGHT SHIFT',    desc: 'Slow-mo lasts twice as long.', start: ['bleep', 'slowmo'], look: { shirt: '#3a56b0', hair: '#150f24', prop: 'cap' } },
  ];

  // Dressing room: permanent upgrades bought with prize money. cost(l) = price of level l + 1.
  // These are long-term investments: a first level is about one good full season, a last level is a dozen or more.
  const PERKS = [
    { id: 'head',   icon: 'spin',    max: 3, name: 'HEAD START',         cost: l => [500000, 2000000, 7000000][l], d: l => `${l} spin${l > 1 ? 's' : ''} at the start.` },
    { id: 'time',   icon: 'clock',   max: 5, name: 'LONGER SLOT',        cost: l => [125000, 300000, 750000, 2000000, 5000000][l],          d: l => `+${l}s on the clock.` },
    { id: 'warm',   icon: 'hypeman', max: 4, name: 'WARM-UP ACT',        cost: l => [200000, 600000, 1750000, 5000000][l],          d: l => `+${0.5 * l} starting hype.` },
    { id: 'budget', icon: 'budget',  max: 5, name: 'BIGGER BUDGET',      cost: l => [100000, 250000, 600000, 1500000, 4000000][l],          d: l => `Prizes +$${5 * l}.` },
    { id: 'trim',   icon: 'trim',    max: 3, name: 'LOADED WHEEL',       cost: l => [300000, 1250000, 4000000][l],          d: l => `${l} fewer toaster${l > 1 ? 's' : ''}.` },
    { id: 'censor', icon: 'bleep',   max: 2, name: 'CENSOR ON RETAINER', cost: l => [1000000, 5000000][l],       d: l => `${l} free bleep${l > 1 ? 's' : ''}.` },
    { id: 'agent',  icon: 'gold',    max: 5, name: 'BIGGER CUT',         cost: l => [150000, 400000, 1000000, 2500000, 6000000][l],          d: l => `+${20 * l}% prize money.` },
  ];

  // Heat: after a win, stack harder rules for more prize money. Level n has every rule up to n.
  const HEAT = [
    'Light 10% faster.', '-2 seconds on the clock.', '+1 dead air.', 'Targets +20%.', 'Interference from episode 1.',
    'One fewer round.', 'Light another 10% faster.', 'Targets another +20%.', 'Another -2 seconds.', 'Another +1 dead air.',
  ];
  const HEAT_PAY = 0.15;        // extra prize money per heat level

  // Backstage events: a choice with a trade-off, booked on the schedule.
  const BACKSTAGE = [
    { id: 'censor',  name: "THE CENSOR'S FAVOUR", a: ['+1 bleep a round. Next target +15%.', { bleep: 1, target: 1.15 }], b: ['Walk away.', {}] },
    { id: 'envelope',name: 'A SPONSOR ENVELOPE',  a: ['+1 spin, +1 toaster.', { spins: 1, toasters: 1 }],                b: ['Walk away.', {}] },
    { id: 'late',    name: 'THE HOST IS LATE',    a: ['+0.5 hype all season. -2s next episode.', { hype: 0.5, clock: -2 }], b: ['Not my problem.', {}] },
    { id: 'props',   name: 'THE PROP CUPBOARD',   a: ['A random gimmick.', { gimmick: 1 }],                              b: ['+1 spin.', { spins: 1 }] },
    { id: 'focus',   name: 'FOCUS GROUP',         a: ['Next target -15%.', { target: 0.85 }],                            b: ['+3s next episode.', { clock: 3 }] },
    { id: 'union',   name: 'UNION BREAK',         a: ['+1 round next episode.', { rounds: 1 }],                          b: ['+1 slow-mo all season.', { slow: 1 }] },
  ];

  const byId = (list, id) => list.find(x => x.id === id);

  // Evolutions: max a gimmick while owning one of its partners and it becomes something bigger.
  const EVOS = [
    { id: 'pyro',   need: ['sparks', 'wide'],    color: '#ff5a2e', name: 'INFERNO',            desc: 'Every buzz sets off pyro.' },
    { id: 'wire',   need: ['mirror', 'tipline'], color: '#fff36b', name: 'CHAIN LIGHTNING',    desc: 'Chains to any prize.' },
    { id: 'drone',  need: ['tipline', 'budget'], color: '#9d8cff', name: 'DRONE SWARM',        desc: 'Twice as fast. Takes anything.' },
    { id: 'laser',  need: ['echo', 'opener'],    color: '#f542a8', name: 'LASER GRID',         desc: 'Every 2nd buzz, from both sides.' },
    { id: 'gold',   need: ['budget', 'thrift'],  color: '#ffd24a', name: 'GOLD STANDARD',      desc: '$50 prizes are gold.' },
    { id: 'cannon', need: ['crowd', 'closer'],   color: '#c8f542', name: 'PRIZE BARRAGE',      desc: 'Cannons fire on every stage clear.' },
    { id: 'bleep',  need: ['net', 'lucky'],      color: '#7fe0ff', name: 'SEVEN SECOND DELAY', desc: 'A bleeped TV becomes a $100 prize.' },
    { id: 'twin',   need: ['wide', 'mirror'],    color: '#42d4f5', name: 'FLOODLIGHTS',        desc: 'Every spotlight can hit PERFECT.' },
  ];
  // Sets: own three gimmicks from the same department and the department chips in.
  const SETS = [
    { id: 'lights', color: '#42d4f5', name: 'LIGHTING RIG',    of: ['twin', 'mirror', 'laser', 'wide'],                 desc: 'PERFECT: +1 stray beam.' },
    { id: 'fx',     color: '#ff9a2e', name: 'SPECIAL EFFECTS', of: ['pyro', 'cannon', 'sparks', 'wire'],                desc: 'Cash won by gimmicks x1.5.' },
    { id: 'crowd',  color: '#f5a542', name: 'FULL HOUSE',      of: ['crowd', 'hypeman', 'ovation', 'tipline', 'echo'],  desc: '+1 starting hype.' },
    { id: 'money',  color: '#ffd24a', name: 'DEEP POCKETS',    of: ['gold', 'budget', 'thrift', 'rainy', 'residual'],   desc: '+1 gold per strip.' },
    { id: 'safety', color: '#7fe0ff', name: 'LEGAL TEAM',      of: ['bleep', 'net', 'lucky', 'antenna'],                desc: '+1 bleep.' },
    { id: 'timing', color: '#c8f542', name: 'RUNNING ORDER',   of: ['clock', 'slowmo', 'stoppage', 'closer', 'opener'], desc: '+3 seconds.' },
    { id: 'stage',  color: '#9d8cff', name: 'SET BUILDERS',    of: ['stage', 'edges', 'center', 'recycle', 'encore'],   desc: '+1 podium.' },
  ];
  // Side gigs: now and then an episode comes with a job on the side. It pays prize money, not points.
  const GIGS = [
    { id: 'perfect', n: 6,  name: '6 PERFECTS' },
    { id: 'gold',    n: 3,  name: 'WIN 3 GOLD' },                 // only offered when there is gold on the strip
    { id: 'clear',   n: 1,  name: 'CLEAR THE STAGE' },
    { id: 'hype',    n: 4,  name: 'WIN 4 HYPE PRIZES' },
    { id: 'prizes',  n: 20, name: 'WIN 20 PRIZES' },
  ];
  const GIG_PAY = 3000;         // per episode number

  // Stage machinery: as the season goes on the set itself gains moving parts, and they stay.
  const FIXTURES = [
    { id: 'screen', ep: 3,  color: '#ffd24a', name: 'THE BIG SCREEN',  desc: 'The prize on screen pays x3.' },
    { id: 'trap',   ep: 5,  color: '#ff9a2e', name: 'TRAPDOORS',       desc: 'Two podiums take turns dropping out of sight.' },
    { id: 'turn',   ep: 8,  color: '#42d4f5', name: 'THE TURNTABLE',   desc: 'The whole stage turns.' },
    { id: 'rogue',  ep: 11, color: '#f542a8', name: 'THE ROGUE LIGHT', desc: 'Buzz where the two lights cross: x3.' },
    { id: 'black',  ep: 13, color: '#9d8cff', name: 'POWER CUTS',      desc: 'The house lights keep cutting out.' },
  ];

  // Act finales: the network sends someone down to the studio floor.
  const BOSSES = [
    { id: 'censor',     color: '#e8203a', name: 'THE CENSOR',     desc: 'The dead air moves.' },
    { id: 'accountant', color: '#5fe08a', name: 'THE ACCOUNTANT', desc: 'Skims 8% of your cash every 4 seconds.' },
    { id: 'critic',     color: '#9d8cff', name: 'THE CRITIC',     desc: 'Only PERFECT pays in full.' },
  ];
  const WAGERS = [0, 10000, 50000, 200000];   // side bet: clear the episode in round one
  const WAGER_PAYS = 3;         // what a won bet returns, stake included (round-one clears are rare)

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Game(seed, who, perks, episodes, opts) {
    this.perks = perks || {};
    this.unlocked = new Set((opts && opts.unlocked) || []);   // Money Dump unlocks
    this.charm = (opts && opts.charm) || null;                  // the one lucky charm carried this run
    this.episodes = episodes === PILOT ? PILOT : EPISODES;
    this.elapsed = 0;           // seconds on air this run, kept by the UI
    this.n = N;                 // podiums on the strip right now
    this.seed = seed == null ? null : seed >>> 0;
    this.rand = seed == null ? Math.random : mulberry(seed);
    this.heat = Math.max(0, Math.min(HEAT.length, (opts && opts.heat) | 0));
    this.code = (opts && opts.code) || null;                    // challenge code, if this is a shared season
    this.mods = { bleep: 0, hype: 0, slow: 0 };                 // season-long changes from backstage events
    this.nextMods = { target: 1, clock: 0, rounds: 0 };         // next episode only
    this.epMods = { target: 1, clock: 0, rounds: 0 };
    this.lane = 1; this.spinN = 0;
    this.who = who || 'rookie';
    this.ep = 0; this.total = 0;
    this.levels = {};
    this.phase = 'title';
    this.strip = []; this.pot = { cash: 0, hype: 1, xm: 1 };
    this.u = 0;                 // beam phase, 0..2N (it bounces end to end)
    this.events = []; this.q = [];
    this.t = 0; this.spins = 0; this.toasters = 0;
    this.best = 0; this.endless = false; this.droneT = [];
    const rares = GIMMICKS.filter(g => g.rare && this.open(g));
    const start = (byId(CONTESTANTS, this.who) || CONTESTANTS[0]).start.map(id => id === '?rare' ? rares[this.pick(rares.length)].id : id);
    start.forEach(id => { this.levels[id] = (this.levels[id] || 0) + 1; });
    // The wheel you start with: BIGGER STAGE, four more gimmicks, three toasters and one dead air wedge.
    const pool = this.shuffle(GIMMICKS.filter(g => common(g) && this.open(g) && g.id !== 'stage' && !start.includes(g.id))).slice(0, Math.max(0, 4 - start.filter(id => !byId(GIMMICKS, id).rare).length)).map(g => g.id);
    // Headliners are never wedges: the wheel is for upgrades you choose.
    this.wheel = Array.from(new Set(start)).filter(id => !byId(GIMMICKS, id).rare).concat(pool, start.includes('stage') ? [] : ['stage']).map(id => ({ type: 'g', id, w: 1 }));
    if (this.charm === 'ch_sticky') { const extra = GIMMICKS.filter(g => common(g) && this.open(g) && !this.wheel.some(w => w.id === g.id)); if (extra.length) this.wheel.push({ type: 'g', id: extra[this.pick(extra.length)].id, w: 1 }); }
    for (let i = 0; i < 3 - (this.perks.trim || 0); i++) this.wheel.push({ type: 'junk', w: 1 });
    this.wheel.push({ type: 'dead', w: 1 });
    this.shuffle(this.wheel);
    this.evo = {}; this.newEvos = []; this.sets = {};
    this.bossOrder = this.shuffle(BOSSES.map(b => b.id));
    this.wager = 0; this.nextWager = 0;
  }

  const P = Game.prototype;
  P.pick = function (n) { return (this.rand() * n) | 0; };
  P.shuffle = function (a) {
    for (let i = a.length - 1; i > 0; i--) { const j = this.pick(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  P.lv = function (id) { return this.levels[id] || 0; };
  P.tr = function (id) { return this.who === id; };          // contestant trait
  P.fix = function (id) { return this.ep >= byId(FIXTURES, id).ep; };          // is this piece of stage machinery running yet
  P.fixtures = function () { return FIXTURES.filter(f => this.ep >= f.ep); };
  P.down = function (i) { return !!this.traps && this.traps.length > 0 && this.traps[this.trapOn] === i; };     // a podium below the stage right now
  P.perk = function (id) { return this.perks[id] || 0; };
  // Restart the random stream for one named part of the season (only when the season has a seed).
  P.reseed = function (tag) {
    if (this.seed == null) return;
    let h = this.seed;
    for (const ch of String(tag)) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0;
    this.rand = mulberry(h);
  };
  // Time can be won back, but only 10 seconds of it per round, so a round always ends.
  P.addTime = function (sec) { const add = Math.max(0, Math.min(sec, 10 - (this.timeAdded || 0))); this.timeAdded = (this.timeAdded || 0) + add; this.clock += add; };
  P.open = function (x) { return !x.lock || this.unlocked.has(x.id); };
  P.ch = function (id) { return this.charm === 'ch_' + id; };
  // In endless the level caps come off (headliners stay one-offs).
  P.capOf = function (g) { return this.endless && !g.rare ? 99 : g.max; };
  P.emit = function (o) { if (this.events.length < 2000) this.events.push(o); };
  P.later = function (dt, fn) { this.q.push({ at: this.t + dt, fn }); };
  P.target = function (ep) {
    const base = ep <= this.episodes ? TARGETS[ep - 1] : TARGETS[this.episodes - 1] * Math.pow(1.5, ep - this.episodes);
    const heat = (this.heat >= 4 ? 1.2 : 1) * (this.heat >= 8 ? 1.2 : 1);
    const mod = ep === this.ep ? this.epMods.target : ep === this.ep + 1 ? this.nextMods.target : 1;
    return Math.round(base * heat * mod / 50) * 50;
  };
  P.gain = function (id) { this.levels[id] = this.lv(id) + 1; this.checkEvo(); };
  P.checkEvo = function () {
    EVOS.forEach(e => {
      if (this.evo[e.id] || this.lv(e.id) < byId(GIMMICKS, e.id).max || !e.need.some(id => this.lv(id))) return;
      this.evo[e.id] = true; this.newEvos.push(e);
    });
    SETS.forEach(t => {
      if (this.sets[t.id] || t.of.filter(id => this.lv(id)).length < 3) return;
      this.sets[t.id] = true; this.newEvos.push(Object.assign({ set: true }, t));
    });
  };
  // Interference: from act two static strikes burn prizes off the strip, faster every episode.
  P.stormEvery = function () { return this.tr('weather') || (this.ep <= ACT && this.heat < 5) ? Infinity : Math.max(0.9, 5.5 - 0.3 * Math.max(0, this.ep - ACT - 1)) * (this.ch('plugs') ? 1.45 : 1); };
  // UNDERSTUDY: half of anything the storm or a rival takes still reaches the pot.
  P.salvage = function (i) { const q = this.strip[i]; if (this.lv('understudy')) this.pot.cash += Math.round((q.kind === 'cash' ? this.cashVal(q) : q.kind === 'gold' ? this.cashVal(q) * 5 : 40) / 2); };
  P.storm = function (dt) {
    this.stormT -= dt;
    if (this.stormT > 0) return;
    this.stormT = this.stormEvery();
    const up = this.upList();
    if (up.length > 1) { const i = up[this.pick(up.length)]; this.salvage(i); this.strip[i].state = 'burnt'; this.emit({ t: 'storm', i }); }
  };
  P.dealIs = function (id) { return !!this.deal && this.deal.id === id; };
  P.act = function () { return Math.ceil(Math.max(1, this.ep) / ACT); };
  P.isFinale = function () { return this.ep > 0 && this.ep % ACT === 0 && this.ep <= this.episodes; };

  // Save and resume. A run is saved between episodes: either about to go on air, or about to spin.
  P.snapshot = function (stage) {
    return { v: 1, stage, who: this.who, perks: this.perks, episodes: this.episodes, ep: this.ep, levels: this.levels, wheel: this.wheel,
      n: this.n, spins: this.spins, toasters: this.toasters, best: this.best, banked: this.banked || 0, endless: this.endless,
      nextFormat: this.nextFormat || null, earned: this.earned || [], elapsed: this.elapsed, total: this.total,
      unlocked: Array.from(this.unlocked), charm: this.charm, seed: this.seed, heat: this.heat, code: this.code,
      mods: this.mods, nextMods: this.nextMods, lane: this.lane, spinN: this.spinN, nextSpecial: this.nextSpecial || null, mapSalt: this.mapSalt || 0,
      evo: this.evo, sets: this.sets, revived: !!this.revived, bossOrder: this.bossOrder, nextWager: this.nextWager };
  };
  Game.restore = function (o) {
    const g = new Game(o.seed == null ? null : o.seed, o.who, o.perks, o.episodes, { unlocked: o.unlocked, charm: o.charm, heat: o.heat, code: o.code });
    ['mods', 'nextMods', 'lane', 'spinN', 'nextSpecial', 'mapSalt', 'evo', 'sets', 'revived', 'bossOrder', 'nextWager'].forEach(k => { if (o[k] != null) g[k] = o[k]; });
    ['ep', 'levels', 'wheel', 'spins', 'toasters', 'best', 'banked', 'endless', 'nextFormat', 'earned', 'elapsed', 'total'].forEach(k => { g[k] = o[k]; });
    g.phase = o.stage === 'wheel' ? 'cleared' : 'ready';
    return g;
  };
  P.is = function (id) { return !!this.format && this.format.id === id; };
  P.deadCount = function () {
    return Math.max(1, Math.min(8, 1 + Math.ceil(this.ep / 3) + (this.is('goldnight') ? 1 : 0) + (this.is('censors') ? 2 : 0) + (this.dealIs('tvs') ? 2 : 0) + (this.heat >= 3 ? 1 : 0) + (this.heat >= 10 ? 1 : 0)) - (this.ch('foil') ? 1 : 0) - (this.tr('magician') ? 1 : 0));
  };

  // ── Episode / round ─────────────────────────────────────────────
  P.startEpisode = function (formatId) {
    this.ep++;
    this.total = 0;
    this.epMods = this.nextMods; this.nextMods = { target: 1, clock: 0, rounds: 0 };
    this.format = byId(FORMATS, formatId || this.nextFormat) || FORMATS[0];
    this.nextFormat = null;
    this.reseed('e' + this.ep);
    this.lifeUsed = false; this.footUsed = false; this.luckUsed = false; this.prevScore = 0;
    this.deal = null; this.asked = false; this.ask = null; this.bonus = false; this.rivalScore = 0;
    this.special = this.nextSpecial || null; this.nextSpecial = null;          // specials are booked on the schedule now
    if (this.forceSpecial !== undefined) { this.special = this.forceSpecial; this.forceSpecial = undefined; }   // for tests
    this.rounds = this.is('onetake') ? 1 : Math.max(2, 3 + this.lv('encore') - (this.is('high') ? 1 : 0) - (this.heat >= 6 ? 1 : 0) + this.epMods.rounds + (this.tr('intern') ? 1 : 0));
    this.roundsLeft = this.rounds;
    this.tokenOut = this.rand() < 0.5;        // a wheel token only turns up in about half the episodes
    this.gig = null; this.gigN = 0; this.gigDone = false;
    this.newFix = this.endless ? null : FIXTURES.find(f => f.ep === this.ep) || null;
    if (this.ep >= 2 && !this.endless && this.rand() < 0.35) { const gold = this.lv('gold') || this.sets.money || this.evo.gold || this.is('goldnight') || this.ch('tooth');
      const pool = GIGS.filter(q => !(q.id === 'hype' && this.is('cashonly')) && !(q.id === 'gold' && !gold)); this.gig = pool[this.pick(pool.length)]; }
    this.boss = this.isFinale() ? byId(BOSSES, this.bossOrder[(this.act() - 1) % this.bossOrder.length]) : null;
    this.wager = this.nextWager || 0; this.nextWager = 0; this.wagerResult = null;
    if (this.boss && this.special === 'rival') this.special = 'bonus';
    this.startRound();
    this.emit({ t: 'episode' });
  };

  P.startRound = function () {
    this.reseed('r' + this.ep + '.' + (this.rounds - this.roundsLeft));
    this.n = N + this.lv('stage') + (this.sets.stage ? 1 : 0);
    this.strip = [];
    for (let i = 0; i < this.n; i++) this.strip.push({ kind: 'cash', val: 10, state: 'up' });
    this.jackOut = false;
    this.voteKind = this.special === 'vote' ? (this.rand() < 0.5 ? 'cash' : 'hype') : null;
    this.rareLeft = [];
    if (this.ep >= 2 && this.rand() < CAR_CHANCE * (this.lv('vip') ? 3 : 1)) this.rareLeft.push('car');
    if (!this.endless && this.rand() < JACKPOT_CHANCE * (this.lv('vip') ? 5 : 1)) this.rareLeft.push('jp');
    this.rivalT = 3.4;
    this.specialsLeft = (this.ep >= 4 ? 1 : 0) + (this.ep >= 2 && this.rand() < 0.6 ? 1 : 0) + (this.ep >= 8 && this.rand() < 0.5 ? 1 : 0);
    const order = this.shuffle(this.strip.slice());
    for (let i = 0; i < this.deadCount(); i++) order[i].kind = 'dead';
    this.dress(order.slice(this.deadCount()));
    if (this.is('reflect')) for (let i = 0; i < Math.floor(this.n / 2); i++) this.strip[this.n - 1 - i] = Object.assign({}, this.strip[i]);   // MIRROR IMAGE
    const tvs = this.strip.filter(q => q.kind === 'dead').length;
    const first = this.roundsLeft === this.rounds;
    this.pot = { cash: (this.toasters >= 5 ? 50 : 10) * this.toasters + (this.ch('fanmail') ? 20 : 0) + Math.min(400 * this.lv('residual'), Math.floor(this.prevScore * 0.05 * this.lv('residual'))),
      hype: 1 + 0.5 * this.perk('warm') + this.mods.hype + (this.sets.crowd ? 1 : 0) + (this.tr('diva') ? 1 : 0) + (this.ch('lozenge') ? 0.5 : 0) + (this.dealIs('tvs') ? 2 : 0) + (this.is('high') ? 2 : 0) + (this.lv('static') ? tvs : 0), xm: 1, next2: false };
    this.buzzes = 0; this.bleeps = this.lv('bleep') + (this.sets.safety ? 1 : 0) + (this.tr('excensor') ? 2 : 0) + this.perk('censor') + this.mods.bleep + (this.is('censors') ? 1 : 0) + (this.ch('pass') && this.ep <= ACT ? 1 : 0);
    this.slowLeft = this.tr('excensor') ? 0 : 1 + this.lv('slowmo') + this.mods.slow + (this.ch('battery') ? 1 : 0); this.slowT = 0;
    this.clockMax = Math.max(6, (this.is('onetake') ? 40 : ROUND_TIME) + 4 * this.lv('clock') + (this.sets.timing ? 3 : 0) + this.perk('time') - (this.dealIs('time') ? 5 : 0) +
      (this.ch('watch') ? 2 : 0) + (this.ch('script') && first ? 4 : 0) + (this.lv('telethon') ? 8 : 0) +
      this.epMods.clock - (this.tr('diva') ? 4 : 0) - (this.heat >= 2 ? 2 : 0) - (this.heat >= 9 ? 2 : 0));
    this.clock = this.clockMax; this.timeAdded = 0; this.shrinkT = 4; this.shrinkSide = 0; this.jitT = 1.2;
    this.stormT = this.stormEvery(); this.bossT = 3; this.intT = 4;
    this.streak = 0; this.inBuzz = false;
    this.tossLeft = this.lv('crowd') ? 3 : 0;
    this.convT = 1.4; this.strobeT = 0.6;
    // stage machinery for this round
    this.feat = -1; this.featT = 1.2; this.turnT = 2.6; this.blackT = 5; this.black = 0;
    this.traps = []; this.trapOn = 0; this.trapT = 2.5;
    if (this.fix('trap')) { const a = this.pick(this.n); this.traps = [a, (a + 3 + this.pick(this.n - 5)) % this.n]; }
    this.u = this.rand() * 2 * this.n; this.v = this.rand() * 2 * this.n;
    this.droneT = [];
    for (let i = 0; i < this.lv('drone'); i++) this.droneT.push(2 + i * 1.1);
    this.q = [];
    this.phase = 'sweep';
    this.emit({ t: 'round' });
  };

  // Put fresh prizes on a set of podiums.
  P.dress = function (list) {
    this.shuffle(list);
    const vals = [10, 10, 10, 20, 20, 20, 30, 30, 50, 50];
    list.forEach(p => { p.kind = 'cash'; p.val = vals[this.pick(vals.length)]; p.state = 'up'; if (this.evo.gold && p.val === 50) p.kind = 'gold'; });
    let k = 0;
    const take = (n, kind) => { for (let i = 0; i < n && k < list.length; i++) list[k++].kind = kind; };
    if (!this.is('cashonly')) take(Math.min(2, list.length - 1), 'hype');
    if (!this.tokenOut && list.length > 3) { take(1, 'spin'); this.tokenOut = true; }
    if (this.lv('jack') && !this.jackOut && list.length > 3) { take(1, 'jack'); this.jackOut = true; }   // one diamond a round
    take(this.lv('gold') + (this.sets.money ? 1 : 0) + (this.is('goldnight') ? 3 : 0) + (this.ch('tooth') ? 1 : 0), 'gold');
    // Oddities: a mystery box, a firework crate, a x2 card or a restock crate.
    while (this.rareLeft && this.rareLeft.length && k < list.length - 1) take(1, this.rareLeft.pop());   // a showcase car, the jackpot
    while (this.specialsLeft > 0 && k < list.length - 1) { const pool = SPECIALS.concat(XPRIZES.map(x => x.id).filter(id => this.unlocked.has(id))); take(1, pool[this.pick(pool.length)]); this.specialsLeft--; }
  };

  // What a cash prize pays, including the PRIZE BUDGET top-up.
  P.cashVal = function (p) {
    return Math.round((p.val + (p.val === 10 ? 15 * this.lv('thrift') : 0) + 10 * this.lv('budget') + 5 * this.perk('budget') + (this.ch('penny') ? 5 : 0) + (this.tr('shopping') ? 5 : 0)) *
      (this.is('turbo') ? 2 : 1) * (this.is('cashonly') ? 2 : 1) * (this.dealIs('fast') ? 1.5 : 1));
  };
  P.isUp = function (i) { const p = this.strip[i]; return !!p && p.state === 'up' && p.kind !== 'dead' && !this.down(i); };
  P.upList = function () { const o = []; for (let i = 0; i < this.n; i++) if (this.isUp(i)) o.push(i); return o; };
  P.speed = function () {                                   // podiums per second
    return (3.6 + 0.24 * Math.min(this.ep, 18)) * (1 + (this.heat >= 1 ? 0.1 : 0) + (this.heat >= 7 ? 0.1 : 0)) * (this.lv('slowburn') ? 0.5 : 1) * (1 + (this.lv('steady') ? 0 : Math.min(this.lv('slowburn') ? 1.4 : 0.7, (this.lv('slowburn') ? 0.14 : 0.07) * this.buzzes))) *
      (this.ch('coffee') ? 0.92 : 1) * (this.lv('telethon') ? 1.1 : 1) * (this.is('turbo') ? 1.35 : 1) * (this.dealIs('fast') ? 1.25 : 1) * (this.slowT > 0 ? 0.35 : 1);
  };
  // Slow-motion: a couple of seconds of a much slower light. A few uses per round.
  P.slowmo = function () {
    if (this.phase !== 'sweep' || this.slowLeft <= 0 || this.slowT > 0) return false;
    this.slowLeft--; this.slowT = this.tr('guard') ? 4.8 : 2.4;
    this.emit({ t: 'slow' });
    return true;
  };
  P.fold = function (u) { u = ((u % (2 * this.n)) + 2 * this.n) % (2 * this.n); return u < this.n ? u : 2 * this.n - u; };
  // Where every spotlight is right now, main beam first.
  P.beams = function () {
    const n = this.lv('twin') + 1, out = [];
    for (let k = 0; k < n; k++) out.push(this.fold(this.u + k * 2 * this.n / n));
    return out;
  };
  P.score = function () {
    const last = this.roundsLeft === 1;
    return Math.floor(this.pot.cash * this.pot.hype * this.pot.xm * (last && this.lv('lastlaugh') ? 2 : 1) * (last && this.ch('tie') ? 1.1 : 1) * (last && this.tr('childstar') ? 1.5 : 1));
  };
  P.perfectZone = function () { return Math.min(0.45, 0.15 + 0.075 * this.lv('wide') + (this.ch('cue') ? 0.04 : 0)); };

  P.step = function (dt) {
    this.t += dt;
    if (this.q.length) {
      const due = this.q.filter(a => a.at <= this.t);
      if (due.length) { this.q = this.q.filter(a => a.at > this.t); due.sort((a, b) => a.at - b.at).forEach(a => a.fn()); }
    }
    if (this.phase !== 'sweep') return;
    // The round clock only runs while the light is moving. Slow-mo does not slow it.
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0;
      if (this.bonus) { this.endBonus(false, null); return; }
      this.emit({ t: 'timeup' });
      if (!this.bank()) { this.phase = 'resolve'; this.later(0.6, () => this.endRound(this.score(), false)); }
      return;
    }
    const slow = this.slowT > 0 ? 0.35 : 1;
    if (this.slowT > 0) this.slowT -= dt;
    this.storm(dt * slow);
    if (this.boss && !this.bonus && (this.boss.id === 'censor' || this.boss.id === 'accountant')) {
      this.bossT -= dt * slow;
      if (this.bossT <= 0) {
        if (this.boss.id === 'censor') {              // a dead air TV swaps places with a prize
          this.bossT = 3;
          const tvs = [], up = this.upList();
          this.strip.forEach((q, j) => { if (q.kind === 'dead' && q.state === 'up') tvs.push(j); });
          if (tvs.length && up.length > 1) {
            const a = tvs[this.pick(tvs.length)], b = up[this.pick(up.length)];
            const tmp = this.strip[a]; this.strip[a] = this.strip[b]; this.strip[b] = tmp;
            this.emit({ t: 'bossmove', a, b });
          }
        } else {
          this.bossT = 4;
          const cut = Math.floor(this.pot.cash * 0.08);
          if (cut > 0) { this.pot.cash -= cut; this.emit({ t: 'skim', cut }); }
        }
      }
    }
    if (!this.bonus) {
      if (this.fix('screen')) {                     // THE BIG SCREEN: one prize at a time is on screen
        this.featT -= dt * slow;
        if (this.featT <= 0 || (this.feat >= 0 && !this.isUp(this.feat))) {
          const up = this.upList().filter(i => this.strip[i].kind === 'cash' || this.strip[i].kind === 'gold');
          const was = this.feat;
          this.feat = up.length ? up[this.pick(up.length)] : -1; this.featT = 3.5;
          if (this.feat >= 0 && this.feat !== was) this.emit({ t: 'feat', i: this.feat });
        }
      }
      if (this.traps.length) {                      // TRAPDOORS: the two take turns
        this.trapT -= dt * slow;
        if (this.trapT <= 0) { this.trapT = 2.5; this.emit({ t: 'trap', up: this.traps[this.trapOn], i: this.traps[1 - this.trapOn] }); this.trapOn = 1 - this.trapOn; }
      }
      if (this.fix('turn') && !this.is('conveyor')) {     // THE TURNTABLE
        this.turnT -= dt * slow;
        if (this.turnT <= 0) { this.turnT = 2.6; this.strip.unshift(this.strip.pop()); if (this.feat >= 0) this.feat = (this.feat + 1) % this.n; this.emit({ t: 'shift' }); }
      }
      if (this.fix('rogue')) this.v -= this.speed() * 0.6 * dt;       // THE ROGUE LIGHT sweeps the other way
      if (this.fix('black')) {                      // POWER CUTS
        if (this.black > 0) this.black -= dt;
        else { this.blackT -= dt; if (this.blackT <= 0) { this.blackT = 6; this.black = 1.2; this.emit({ t: 'black' }); } }
      }
    }
    if (this.tr('exacct') && !this.bonus) {
      this.intT -= dt * slow;
      if (this.intT <= 0) { this.intT = 4; const add = Math.floor(this.pot.cash * 0.03); if (add > 0) { this.pot.cash += add; this.emit({ t: 'interest', add }); } }
    }
    if (this.special === 'rival' && !this.bonus) {
      this.rivalT -= dt * slow;
      if (this.rivalT <= 0) {
        this.rivalT = 3.4;
        const up = this.upList();
        if (up.length > 1) { const i = up[this.pick(up.length)]; this.rivalScore += this.strip[i].kind === 'cash' ? this.cashVal(this.strip[i]) : 50; this.salvage(i); this.strip[i].state = 'burnt'; this.emit({ t: 'rival', i }); }
      }
    }
    if (this.is('strobe')) {
      // The light jumps from podium to podium instead of sweeping.
      this.strobeT -= dt * slow;
      if (this.strobeT <= 0) {
        this.u = this.pick(this.n) + 0.2 + this.rand() * 0.6;
        this.strobeT = Math.max(0.4, 0.72 - 0.012 * this.ep) / (1 + (this.lv('steady') ? 0 : 0.05 * this.buzzes));
        this.emit({ t: 'jump' });
      }
    } else if (this.is('pendulum')) {
      this.u += this.speed() * (0.4 + 1.5 * Math.sin(Math.PI * this.fold(this.u) / this.n)) * dt;
    } else {
      if (this.is('jitters')) {                     // STAGE FRIGHT: the light turns round at random
        this.jitT -= dt * slow;
        if (this.jitT <= 0) { this.jitT = 0.7 + this.rand() * 1.6; this.u = 2 * this.n - (((this.u % (2 * this.n)) + 2 * this.n) % (2 * this.n)); }
      }
      this.u += this.speed() * dt;
    }
    if (this.is('shrink')) {                        // SHRINKING STAGE: the ends go dark one by one
      this.shrinkT -= dt * slow;
      if (this.shrinkT <= 0) {
        this.shrinkT = 4;
        const idx = [];
        for (let k = 0; k < this.n; k++) idx.push(this.shrinkSide ? this.n - 1 - k : k);
        const i = idx.find(j => this.strip[j].state !== 'gone');
        this.shrinkSide = 1 - this.shrinkSide;
        if (i != null && this.strip.filter(q => q.state !== 'gone').length > 4) { this.strip[i].state = 'gone'; this.emit({ t: 'shrink', i }); this.refillIfEmpty(false); }
      }
    }
    if (this.is('conveyor')) {
      this.convT -= dt * slow;
      if (this.convT <= 0) { this.convT = 1.3; this.strip.unshift(this.strip.pop()); if (this.feat >= 0) this.feat = (this.feat + 1) % this.n; this.emit({ t: 'shift' }); }
    }
    for (let k = 0; k < this.droneT.length; k++) {
      this.droneT[k] -= dt;
      if (this.droneT[k] <= 0) {
        this.droneT[k] = this.evo.drone ? 1.6 : 3.2;
        const open = this.upList().filter(i => this.evo.drone || this.strip[i].kind === 'cash' || this.strip[i].kind === 'gold');
        if (open.length) { const i = open[this.pick(open.length)]; this.emit({ t: 'zap', k, i }); this.win(i, 'drone', 1); this.refillIfEmpty(false); }
      }
    }
  };

  // Take a prize off a podium into the pot. Returns false if there was nothing to take.
  P.win = function (i, via, mult) {
    if (!this.isUp(i)) return false;
    const p = this.strip[i], pot = this.pot;
    let val = 0, gain = 0, note = '';
    const doubled = pot.next2 && (p.kind === 'cash' || p.kind === 'gold' || p.kind === 'hype');
    if (doubled) { mult *= 2; pot.next2 = false; }
    const voted = this.voteKind === 'cash' ? (p.kind === 'cash' || p.kind === 'gold') : this.voteKind === 'hype' && p.kind === 'hype';
    if (voted) mult *= 2;
    const money = p.kind === 'cash' || p.kind === 'gold';
    if (p.kind === 'gold') this.gigTick('gold'); else if (p.kind === 'hype') this.gigTick('hype');
    this.gigTick('prizes');
    const onScreen = money && i === this.feat && this.fix('screen') && !this.bonus;
    if (onScreen) { mult *= 3; this.feat = -1; this.featT = 0.8; }
    if (money && via !== 'main' && this.sets.fx) mult *= 1.5;
    if (money && via !== 'main' && this.tr('nerd')) mult *= 1.25;
    if (money && (i === 0 || i === this.n - 1)) mult *= 1 + this.lv('edges');
    if (money && (i === Math.floor((this.n - 1) / 2) || i === Math.ceil((this.n - 1) / 2))) mult *= 1 + this.lv('center');
    if (p.kind === 'cash') { val = this.cashVal(p) * mult; pot.cash += val; }
    else if (p.kind === 'gold') { val = this.cashVal(p) * (this.lv('auction') ? 8 : 5) * mult; pot.cash += val; }
    else if (p.kind === 'hype') { gain = (1 + this.lv('hypeman')) * mult; pot.hype += gain; }
    else if (p.kind === 'jack') { gain = 1.5 + 0.5 * this.lv('jack'); pot.xm *= gain; }
    else if (p.kind === 'spin') { this.spins++; }
    else if (p.kind === 'x2') { pot.next2 = true; }
    else if (p.kind === 'car') { val = 300 + 30 * this.lv('budget'); pot.cash += val; }          // the showcase prize
    else if (p.kind === 'jp') { note = 'JACKPOT'; }                                                // paid out as prize money by the UI
    else if (p.kind === 'box') {
      // Mystery box: could be anything.
      const r = this.rand();
      if (r < 0.4) { val = (100 + 20 * this.lv('budget')) * (this.is('turbo') ? 2 : 1); pot.cash += val; note = 'JACKPOT'; }
      else if (r < 0.65) { gain = 2; pot.hype += 2; note = 'HYPE'; }
      else if (r < 0.73) { this.spins++; note = 'SPIN'; }
      else if (this.ch('clover')) { val = 100; pot.cash += val; note = 'JACKPOT'; }
      else { this.toasters++; note = 'TOASTER'; }
    } else if (p.kind === 'bomb') {
      // Firework crate: takes out the prizes either side of it (and sets off other crates).
      this.later(0.12, () => { this.emit({ t: 'boom', i }); this.win(i - 1, 'bomb', 1); this.win(i + 1, 'bomb', 1); });
    } else if (p.kind === 'restock') {
      const vals = [20, 20, 30, 50];
      this.strip.forEach((q, j) => {
        if (q.state === 'up' || j === i) return;
        q.kind = 'cash'; q.val = vals[this.pick(vals.length)]; q.state = 'up';
        this.emit({ t: 'toss', i: j });
      });
    }
    else if (p.kind === 'clockp') { this.addTime(5); note = '+5 SECONDS'; }
    else if (p.kind === 'bleepp') { this.bleeps++; note = '+1 BLEEP'; }
    else if (p.kind === 'superstar') { gain = 3; pot.hype += 3; }
    else if (p.kind === 'coin') { const up = this.rand() < 0.5; pot.cash = Math.round(pot.cash * (up ? 1.5 : this.tr('gambler') ? 1 : 0.75)); note = up ? 'HEADS! CASH +50%' : (this.tr('gambler') ? 'TAILS. NO LOSS' : 'TAILS. CASH -25%'); }
    else if (p.kind === 'broom') {
      this.later(0.1, () => { for (let j = 0; j < this.n; j++) if (this.isUp(j) && this.strip[j].kind === 'cash' && this.strip[j].val <= 20) this.win(j, 'broom', 1); });
    }
    if (via !== 'main' && this.lv('tipline')) { const tip = 5 * this.lv('tipline'); pot.cash += tip; val += tip; }
    if (this.lv('antenna')) for (const j of [i - 1, i + 1]) {          // RABBIT EARS
      const q = this.strip[j];
      if (q && q.kind === 'dead' && q.state === 'up' && this.rand() < 0.1 * this.lv('antenna')) { q.kind = 'cash'; q.val = 20; this.emit({ t: 'fixed', i: j }); }
    }
    this.lastWin = { val, gain };
    const stays = (money || p.kind === 'hype') && this.rand() < 0.15 * this.lv('recycle');   // REPEAT SHOWING
    let combo = false;
    if (this.inBuzz && via !== 'main' && this.lv('combo')) { pot.hype += 0.5; combo = true; }
    p.state = stays ? 'up' : 'burnt';
    this.emit({ t: 'win', i, kind: p.kind, val, gain, via, mult, note, doubled, combo, stays, onScreen });
    return true;
  };

  // Nothing left to win: the stage is re-dressed (dead air stays where it is).
  P.refillIfEmpty = function (bonus) {
    if (this.upList().length) return;
    this.dress(this.strip.filter(p => !(p.kind === 'dead' && p.state === 'up')));
    this.tossLeft = this.lv('crowd') ? 3 : 0;       // a fresh stage, a fresh armful for the crowd
    if (bonus) { this.pot.hype += 2 + this.lv('ovation'); this.gigTick('clear'); }
    if (bonus && this.evo.cannon) for (let k = 0; k < 2; k++) this.later(0.5 + 0.18 * k, () => {
      const up = this.upList(); if (!up.length || this.phase === 'tally') return;
      const j = up[this.pick(up.length)]; this.emit({ t: 'cannon', i: j, left: k === 0 }); this.win(j, 'cannon', 1);
    });
    this.emit({ t: 'refill', bonus });
  };

  // Hit the buzzer: every light stops where it is.
  P.buzz = function () {
    if (this.phase !== 'sweep') return false;
    this.phase = 'resolve';
    this.buzzes++;
    const beams = this.beams(), pos = Math.min(this.n - 0.001, beams[0]);
    const i = Math.floor(pos), frac = pos - i, p = this.strip[i];
    const perfect = Math.abs(frac - 0.5) < this.perfectZone();
    this.emit({ t: 'buzz', i, perfect, hit: this.isUp(i) });
    if (perfect && this.isUp(i)) this.gigTick('perfect');
    if (this.bonus) { this.endBonus(this.isUp(i), i); return true; }

    this.inBuzz = true;
    if (this.down(i)) {                             // the podium is under the stage: nothing happens
      this.streak = 0;
      this.emit({ t: 'whiff', i, trap: true });
      this.later(0.3, () => { this.inBuzz = false; this.phase = 'sweep'; });
      return true;
    }
    if (!this.isUp(i)) {
      this.streak = 0;
      if (p.kind !== 'dead' && this.lv('ghost')) {
        // GHOST LIGHT: a burnt-out podium is just an empty podium.
        this.emit({ t: 'whiff', i });
        this.later(0.35, () => { this.inBuzz = false; this.phase = 'sweep'; });
      } else if (this.rand() < 0.12 * this.lv('lucky') || (this.ch('foot') && !this.footUsed) || (this.tr('rookie') && !this.luckUsed)) {
        // LUCKY SOCKS / RABBIT'S FOOT / BEGINNER'S LUCK: this one does not count.
        if (this.ch('foot') && !this.footUsed) this.footUsed = true; else if (this.tr('rookie')) this.luckUsed = true;
        p.state = 'gone';
        this.emit({ t: 'bleep', i, lucky: true });
        this.later(0.45, () => { this.inBuzz = false; this.phase = 'sweep'; });
      } else if (this.bleeps > 0) {
        this.bleeps--;
        if (this.evo.bleep) { p.kind = 'cash'; p.val = 100; p.state = 'up'; } else p.state = 'gone';
        this.emit({ t: 'bleep', i, prize: !!this.evo.bleep });
        this.later(0.45, () => { this.inBuzz = false; this.phase = 'sweep'; });
      } else {
        if (this.lv('life') && !this.lifeUsed) {
          // RERUN: once an episode the show goes on, minus half the cash.
          this.lifeUsed = true; this.pot.cash = Math.floor(this.pot.cash / 2); p.state = 'gone';
          this.emit({ t: 'rerun', i });
          this.later(0.9, () => { this.inBuzz = false; this.phase = 'sweep'; });
          return true;
        }
        const kept = Math.floor(this.score() * Math.min(1, 0.25 * this.lv('net'))) + 100 * this.lv('rainy');
        this.emit({ t: 'bust', i, kept, lost: Math.max(0, this.score() - kept) });
        this.later(0.2, () => this.endRound(kept, true));
      }
      return true;
    }

    let at = 0;
    const add = (dt, fn) => { at += dt; this.later(at, fn); };
    const kind = p.kind;
    this.streak = perfect ? this.streak + 1 : 0;
    const cross = this.fix('rogue') && Math.floor(Math.min(this.n - 0.001, this.fold(this.v))) === i;      // both lights on the same podium
    if (cross) this.emit({ t: 'cross', i });
    this.win(i, 'main', (cross ? 3 : 1) * (perfect ? (this.lv('streak') ? 1 + this.streak : 2) * (this.tr('stunt') ? 1.25 : this.tr('excritic') ? 1.5 : 1) : (this.boss && this.boss.id === 'critic') || this.tr('excritic') ? 0.5 : 1) * (this.buzzes === 1 ? 1 + this.lv('opener') : 1));
    if (perfect && this.lv('sparks')) this.pot.hype += 0.25 * this.lv('sparks');
    if (perfect && this.streak >= 2 && this.tr('quizchamp')) { this.pot.hype += 0.25; this.emit({ t: 'roll', i }); }
    if (perfect && this.lv('stoppage')) this.addTime(0.5 * this.lv('stoppage'));
    if ((this.lv('bogo') && this.buzzes === 1) || (perfect && this.lv('greenlight') && this.rand() < 0.5)) { p.state = 'up'; this.emit({ t: 'stays', i }); }
    if (this.lv('echo') && this.buzzes % Math.max(2, 5 - this.lv('echo')) === 0) add(0.14, () => {
      const w = this.lastWinMain; this.pot.cash += w.val; this.pot.hype += w.gain;
      this.emit({ t: 'echo', i, val: w.val, gain: w.gain });
    });
    this.lastWinMain = this.lastWin;
    if (perfect && this.lv('midas')) add(0.1, () => {
      const cash = this.shuffle(this.upList().filter(j => this.strip[j].kind === 'cash')).slice(0, 2);
      cash.forEach(j => { this.strip[j].kind = 'gold'; this.emit({ t: 'midas', i: j }); });
    });

    for (let k = 1; k < beams.length; k++) {
      const j = Math.min(this.n - 1, Math.floor(beams[k]));
      const sharp = this.evo.twin && Math.abs(beams[k] - j - 0.5) < this.perfectZone();     // FLOODLIGHTS
      add(0.12, () => { if (sharp && this.isUp(j)) this.emit({ t: 'sharp', i: j }); this.win(j, 'twin', sharp ? 2 : 1); });
    }
    for (let d = 1; d <= (perfect ? this.lv('pyro') : this.evo.pyro ? 2 : 0); d++) {
      add(0.09, () => { this.emit({ t: 'pyro', a: i - d, b: i + d }); this.win(i - d, 'pyro', 1); this.win(i + d, 'pyro', 1); });
    }
    for (let k = 0; k < this.lv('mirror') + (perfect && this.sets.lights ? 1 : 0); k++) {
      add(0.1, () => { const up = this.upList(); if (!up.length) return; const j = up[this.pick(up.length)]; this.emit({ t: 'ray', i: j }); this.win(j, 'mirror', 1); });
    }
    if (this.lv('wire')) {
      let from = i;
      for (let k = 0; k < this.lv('wire'); k++) add(0.08, () => {
        const same = this.upList().filter(j => this.evo.wire || this.strip[j].kind === kind).sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
        if (!same.length) return;
        this.emit({ t: 'bolt', a: from, b: same[0] }); this.win(same[0], 'wire', 1); from = same[0];
      });
    }
    if (this.lv('laser') && this.buzzes % (this.evo.laser ? 2 : 3) === 0) {
      const first = this.rand() < 0.5;
      (this.evo.laser ? [first, !first] : [first]).forEach(fromLeft => {
        add(0.15, () => this.emit({ t: 'laser', fromLeft, n: this.lv('laser') + 1 }));
        for (let k = 0; k <= this.lv('laser'); k++) add(0.09, () => {
          const up = this.upList(); if (!up.length) return;
          this.win(fromLeft ? up[0] : up[up.length - 1], 'laser', 1);
        });
      });
    }
    // CROWD PLEASER: one extra prize after a buzz, up to three per stage. Because the
    // supply is fixed, the stage always runs out and refills; the crowd can never stall a round.
    if (this.lv('crowd')) add(0.14, () => {
      if (this.tossLeft <= 0 || !this.upList().length) return;     // out of prizes to throw, or that buzz just cleared the stage
      const dark = []; this.strip.forEach((q, j) => { if (q.state !== 'up') dark.push(j); });
      if (!dark.length) return;
      const j = dark[this.pick(dark.length)], q = this.strip[j];
      const vals = [20, 20, 30, 50, 50];
      q.kind = 'cash'; q.val = vals[this.pick(vals.length)] * this.lv('crowd'); q.state = 'up';   // higher levels throw better prizes, not more of them
      this.tossLeft--;
      this.emit({ t: 'toss', i: j });
    });
    add(0.3, () => {
      this.refillIfEmpty(true);
      if (this.is('shuffle')) { this.shuffle(this.strip); this.emit({ t: 'shuffled' }); }
      this.inBuzz = false; this.phase = 'sweep';
    });
    return true;
  };

  P.bank = function () {
    if (this.phase !== 'sweep' || this.buzzes === 0) return false;
    if (this.lv('allin') && this.clock > 0) return false;          // ALL IN: no banking until time is called
    this.phase = 'resolve';
    if (this.lv('allin')) { this.pot.xm *= 2; this.emit({ t: 'note', text: 'ALL IN! ×2' }); }
    if (this.lv('closer') && this.clock <= 3) { this.pot.xm *= 1 + 0.25 * this.lv('closer'); this.emit({ t: 'note', text: 'BIG FINISH ×' + (1 + 0.25 * this.lv('closer')) }); }
    let at = 0;
    for (let k = 0; k < this.lv('cannon'); k++) {
      at += 0.16;
      this.later(at, () => { const up = this.upList(); if (!up.length) return; const j = up[this.pick(up.length)]; this.emit({ t: 'cannon', i: j, left: k % 2 === 0 }); this.win(j, 'cannon', 1); });
    }
    if (this.lv('double')) {
      at += 0.3;
      this.later(at, () => { const up = this.rand() < 0.5; this.pot.xm *= up ? 2.5 : this.tr('gambler') ? 1 : 0.5; this.emit({ t: 'coin', up }); });
      at += 1.0;
    }
    this.later(at + 0.25, () => this.endRound(this.score(), false));
    return true;
  };

  P.endRound = function (score, bust) {
    const pot = this.pot;
    this.total += score;
    this.prevScore = score;
    this.banked = (this.banked || 0) + score;
    if (score > this.best) this.best = score;
    this.roundsLeft--;
    this.last = { cash: pot.cash, hype: pot.hype, xm: pot.xm, score, bust };
    this.phase = 'tally';
    this.emit({ t: 'roundEnd', cash: pot.cash, hype: pot.hype, xm: pot.xm, score, bust });
  };

  // Called by the UI once the tally has played.
  P.next = function () {
    if (this.phase !== 'tally') return;
    const tgt = this.target(this.ep);
    if (this.total >= tgt) {
      // Spins: one for clearing, one for doubling the target, one if the format was a tough one.
      this.earned = [['EPISODE CLEARED', 1]];
      if (this.total >= 2 * tgt) this.earned.push(['DOUBLED THE TARGET', 1]);
      if (this.format.spins) this.earned.push([this.format.name, this.format.spins]);
      if (this.special === 'rival') this.earned.push(['BEAT THE RIVAL', 1]);
      if (this.ch('headshot') && this.ep === 1) this.earned.push(['SIGNED HEADSHOT', 1]);
      if (this.isFinale() && this.ep < this.episodes) this.earned.push(['ACT ' + this.act() + ' WRAPPED', 1]);
      this.earned.forEach(e => { this.spins += e[1]; });
      if (this.wager) this.wagerResult = { stake: this.wager, won: this.roundsLeft === this.rounds - 1 };
      if (this.isFinale()) {                       // the network books a headliner: given, not chosen
        const pool = GIMMICKS.filter(g => g.rare && this.open(g) && !this.lv(g.id));
        if (pool.length) { this.booked = pool[this.pick(pool.length)]; this.gain(this.booked.id); }
      }
      const done = this.ep === this.episodes && !this.endless ? 'won' : 'cleared';
      if (this.special === 'bonus') { this.afterBonus = done; this.startBonus(); } else this.phase = done;
    } else if (this.roundsLeft <= 0 && this.tr('legend') && !this.revived) {
      this.revived = true; this.roundsLeft = 1; this.rounds++;          // ONE MORE TAKE
      this.startRound(); this.emit({ t: 'revive' });
    } else if (this.roundsLeft <= 0) { if (this.wager) this.wagerResult = { stake: this.wager, won: false }; this.phase = 'over'; }
    else if ((this.special === 'offer' || this.special === 'ad') && !this.asked) {
      // The host's offer / the sponsor's deal: a question for the player before the next round.
      this.asked = true;
      this.ask = this.special === 'offer'
        ? { type: 'offer', amount: Math.max(50, Math.round(0.3 * tgt / 50) * 50) }
        : { type: 'ad', deal: DEALS[this.pick(DEALS.length)] };
      this.phase = 'ask';
    } else this.startRound();
  };

  P.answer = function (yes) {
    if (this.phase !== 'ask') return;
    const a = this.ask; this.ask = null;
    if (yes && a.type === 'offer') {              // take the money, sit the round out
      this.pot = { cash: a.amount, hype: 1, xm: 1, next2: false };
      this.endRound(a.amount, false);
      return;
    }
    if (yes && a.type === 'ad') { this.deal = a.deal; if (a.deal.id === 'time') this.spins++; }
    this.startRound();
  };

  // Bonus round: one buzz at four wheel tokens among eight dead air. Nothing to lose.
  P.startBonus = function () {
    this.reseed('b' + this.ep);
    this.n = N + this.lv('stage') + (this.sets.stage ? 1 : 0);
    this.strip = [];
    for (let i = 0; i < this.n; i++) this.strip.push({ kind: 'dead', val: 10, state: 'up' });
    this.shuffle(this.strip.slice()).slice(0, 4).forEach(p => { p.kind = 'spin'; });
    this.pot = { cash: 0, hype: 1, xm: 1, next2: false };
    this.buzzes = 0; this.bleeps = 0; this.slowLeft = 0; this.slowT = 0;
    this.clockMax = 8; this.clock = 8; this.stormT = Infinity; this.droneT = []; this.q = [];
    this.voteKind = null; this.u = this.rand() * 2 * this.n;
    this.bonus = true; this.phase = 'sweep';
    this.emit({ t: 'bonus' });
  };
  P.endBonus = function (hit, i) {
    this.bonus = false;
    if (hit) { this.spins++; this.earned.push(['BONUS ROUND', 1]); this.strip[i].state = 'burnt'; }
    this.phase = 'resolve';
    this.emit({ t: 'bonusEnd', hit, i });
    this.later(1.3, () => { this.phase = this.afterBonus; });
  };

  // ── The wheel ───────────────────────────────────────────────────
  // After an episode: pick one of three things to bolt onto the wheel.
  P.openWheel = function () {
    if (this.phase === 'won') this.endless = true;
    this.reseed('o' + this.ep);
    const gs = this.shuffle(GIMMICKS.filter(g => common(g) && this.open(g) && this.lv(g.id) < this.capOf(g))).slice(0, 2);
    const ups = this.shuffle(WHEEL_UPS.filter(u => u.ok(this)));
    this.offers = gs.map(g => ({ type: 'g', def: g }));
    this.offers.push({ type: 'up', def: ups[0] });
    this.phase = 'load';
  };

  P.takeOffer = function (i) {
    const o = this.phase === 'load' && this.offers[i];
    if (!o) return null;
    let at = -1;
    if (o.type === 'g') at = this.addWedge({ type: 'g', id: o.def.id, w: 1 });
    else if (o.def.id === 'trim') {
      let k = this.wheel.findIndex(w => w.type === 'dead');
      if (k < 0) k = this.wheel.findIndex(w => w.type === 'junk');
      if (k >= 0) this.wheel.splice(k, 1);
    } else if (o.def.id === 'fat') this.wheel.forEach(w => { if (w.type === 'g' || w.type === 'gold') w.w *= 1.3; });
    else if (o.def.id === 'gold') at = this.addWedge({ type: 'gold', w: 1 });
    else if (o.def.id === 'spin') this.spins += 1;
    this.offers = null;
    this.phase = 'wheel';
    return { offer: o, at };
  };

  // A new wedge takes the place of a toaster while there is more than one, otherwise the wheel grows.
  P.addWedge = function (w) {
    const k = this.wheel.findIndex(x => x.type === 'junk');
    if (k >= 0 && this.wheel.filter(x => x.type === 'junk').length > 1) { this.wheel[k] = w; return k; }
    this.wheel.push(w); return this.wheel.length - 1;
  };

  P.wheelTotal = function () { return this.wheel.reduce((s, w) => s + w.w, 0); };

  // Spin once. The result is decided and applied here; the UI just has to land on `index`.
  P.spin = function () {
    if (this.phase !== 'wheel' || this.spins <= 0) return null;
    this.reseed('s' + this.ep + '.' + (this.spinN++));
    this.spins--;
    let r = this.rand() * this.wheelTotal(), index = 0;
    for (; index < this.wheel.length - 1; index++) { r -= this.wheel[index].w; if (r < 0) break; }
    const w = this.wheel[index], res = { index, type: w.type, got: [], frac: 0.15 + this.rand() * 0.7 };
    const give = id => {
      const g = byId(GIMMICKS, id);
      if (this.lv(id) < this.capOf(g)) { this.gain(id); res.got.push(g); return; }
      // Already maxed: the wedge pays out some other gimmick instead.
      const pool = GIMMICKS.filter(o => common(o) && this.open(o) && this.lv(o.id) < this.capOf(o));
      res.maxed = g;
      if (pool.length) { const o = pool[this.pick(pool.length)]; this.gain(o.id); res.got.push(o); }
    };
    if (w.type === 'g') give(w.id);
    else if (w.type === 'gold') this.shuffle(GIMMICKS.filter(g => common(g) && this.open(g) && this.lv(g.id) < this.capOf(g))).slice(0, 2).forEach(g => give(g.id));
    else if (w.type === 'junk') this.toasters++;
    return res;
  };

  // The schedule. Each episode has three bookings, one per lane; from your lane you can reach
  // the same lane or the one next to it. A booking is a format, sometimes with something extra.
  P.bookings = function (ep) {
    const keep = this.rand;
    if (this.seed != null) this.reseed('m' + ep); else this.rand = mulberry((this.mapSalt = this.mapSalt || (Math.random() * 1e9) | 0) + ep * 7919);
    let formats = this.shuffle(FORMATS.filter(f => this.open(f)));
    if (ep <= 3) {                                 // the first few schedules carry at most one tough show
      let tough = 0;
      formats = formats.filter(f => !f.spins || tough++ < 1);
    }
    formats = this.shuffle(formats.slice(0, 3));
    const extras = ['rival', 'vote', 'offer', 'ad', 'bonus', 'event', 'event'];
    const chance = 0.3 * (this.ch('mints') ? 2 : 1);
    const out = formats.map(f => ({ format: f.id, extra: ep >= 2 && this.rand() < chance ? extras[this.pick(extras.length)] : null }));
    this.rand = keep;
    return out;
  };
  P.setWager = function (stake) { this.nextWager = WAGERS.includes(stake) && !this.code && !this.endless && this.ep < this.episodes ? stake : 0; return this.nextWager; };
  P.gigTick = function (id) {
    if (!this.gig || this.gig.id !== id || this.gigDone || this.bonus) return;
    if (++this.gigN >= this.gig.n) { this.gigDone = true; this.emit({ t: 'gig', pay: GIG_PAY * this.ep }); }
  };
  P.canReach = function (lane) { return Math.abs(lane - this.lane) <= 1; };

  // Spins spent: now choose your next booking.
  P.wheelDone = function () {
    if (this.phase !== 'wheel' || this.spins > 0) return false;
    if (this.nextFormat) { this.phase = 'ready'; return true; }       // already booked (spins came from backstage)
    this.choices = this.bookings(this.ep + 1);
    this.phase = 'pick';
    return true;
  };
  P.pickFormat = function (lane) {
    const node = this.phase === 'pick' && this.choices && this.choices[lane];
    if (!node || !this.canReach(lane)) return false;
    this.lane = lane; this.choices = null;
    this.nextFormat = node.format;
    this.nextSpecial = EVENTS.some(e => e.id === node.extra) ? node.extra : null;
    if (node.extra === 'event') {                 // something happens backstage first
      this.reseed('v' + this.ep);
      this.event = BACKSTAGE[this.pick(BACKSTAGE.length)];
      this.phase = 'event';
    } else this.phase = 'ready';
    return true;
  };
  P.answerEvent = function (takeA) {
    if (this.phase !== 'event') return null;
    const fx = (takeA ? this.event.a : this.event.b)[1], res = { fx, got: null };
    if (fx.bleep) this.mods.bleep += fx.bleep;
    if (fx.hype) this.mods.hype += fx.hype;
    if (fx.slow) this.mods.slow += fx.slow;
    if (fx.target) this.nextMods.target *= fx.target;
    if (fx.clock) this.nextMods.clock += fx.clock;
    if (fx.rounds) this.nextMods.rounds += fx.rounds;
    if (fx.spins) this.spins += fx.spins;
    if (fx.toasters) this.toasters += fx.toasters;
    if (fx.gimmick) { const pool = GIMMICKS.filter(g => common(g) && this.open(g) && this.lv(g.id) < this.capOf(g)); if (pool.length) { res.got = pool[this.pick(pool.length)]; this.gain(res.got.id); } }
    this.event = null;
    // Spins handed out backstage are spent on the wheel before going on air.
    this.phase = this.spins > 0 ? 'wheel' : 'ready';
    return res;
  };

  // Everything the Money Dump can hand out. tier decides how often a crate rolls it.
  const UNLOCKS = [].concat(
    GIMMICKS.filter(g => g.lock && !g.rare).map(g => ({ id: g.id, cat: 'gimmick', tier: 'rare', name: g.name, desc: g.d(1), icon: g.id })),
    GIMMICKS.filter(g => g.lock && g.rare).map(g => ({ id: g.id, cat: 'headliner', tier: 'legendary', name: g.name, desc: g.d(1), icon: g.id })),
    FORMATS.filter(f => f.lock).map(f => ({ id: f.id, cat: 'format', tier: 'rare', name: f.name, desc: f.desc, icon: 'f_' + f.id })),
    XPRIZES.map(x => ({ id: x.id, cat: 'prize', tier: 'rare', name: x.name, desc: x.desc, icon: 'p_' + x.id })),
    CONTESTANTS.filter(c => c.lock).map(c => ({ id: c.id, cat: 'contestant', tier: 'legendary', name: c.name, desc: c.trait + ': ' + c.desc, icon: 'who' })),
    CHARMS.map(c => ({ id: c.id, cat: 'charm', tier: 'common', name: c.name, desc: c.desc, icon: c.id })),
    []);
  // Wardrobe is bought directly in the dressing room.
  const LOOK_PRICE = { theme: 75000, outfit: 30000, host: 40000, buzzer: 20000, confetti: 20000 };
  // Crate price: starts modest and climbs with every crate opened.
  const cratePrice = opened => 60000 + 10000 * opened;

  const api = { FIXTURES, WAGER_PAYS, SETS, GIGS, GIG_PAY, EVOS, BOSSES, WAGERS, UNLOCKS, CHARMS, LOOKS, LOOK_PRICE, XPRIZES, HEAT, HEAT_PAY, BACKSTAGE, cratePrice, Game, N, EPISODES, PILOT, ACT, TARGETS, GIMMICKS, WHEEL_UPS, CONTESTANTS, FORMATS, PERKS, EVENTS, byId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeadAir = api;
})(typeof window !== 'undefined' ? window : globalThis);
