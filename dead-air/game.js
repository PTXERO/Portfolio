// ─────────────────────────────────────────────────────────────────
//  DEAD//AIR — game engine: rules and timing, no drawing.
//  index.html renders this state and turns g.events into effects.
//  tools/dead_air_sim.js runs it headless to check the difficulty.
// ─────────────────────────────────────────────────────────────────
(function (root) {
  const N = 12;                 // prize podiums on the strip
  const EPISODES = 15;          // a full season: three acts of five episodes
  const PILOT = 5;              // the short game: act one only
  const ACT = 5;
  const ROUND_TIME = 16;        // seconds of moving light per round
  const TARGETS = [2000, 2300, 2700, 3200, 4200, 5200, 6500, 8200, 11000, 15000, 19000, 24000, 31000, 40000, 55000];

  // Every gimmick is something you can see on the set. d(lv) = what it does at that level.
  const GIMMICKS = [
    { id: 'twin',   tag: 'TW', color: '#42d4f5', max: 3, name: 'TWIN SPOTS',      d: l => `${l} extra spotlight${l > 1 ? 's' : ''} sweep the strip and win whatever they stop on.` },
    { id: 'mirror', tag: 'MB', color: '#d8d8e0', max: 5, name: 'MIRROR BALL',     d: l => `Every buzz, the mirror ball throws ${l} stray beam${l > 1 ? 's' : ''} onto random prizes.` },
    { id: 'pyro',   tag: 'PY', color: '#ff9a2e', max: 4, name: 'PYROTECHNICS',    d: l => `A PERFECT stop fires flame jets that win ${l} prize${l > 1 ? 's' : ''} on each side.` },
    { id: 'wire',   tag: 'ZP', color: '#fff36b', max: 5, name: 'LIVE WIRE',       d: l => `Your prize arcs lightning to ${l} more of the same kind.` },
    { id: 'laser',  tag: 'LZ', color: '#f542a8', max: 4, name: 'LASER SHOW',      d: l => `Every 3rd buzz, a laser sweeps in and wins the first ${l + 1} prizes it crosses.` },
    { id: 'drone',  tag: 'DR', color: '#9d8cff', max: 4, name: 'CAMERA DRONE',    d: l => `${l} drone${l > 1 ? 's' : ''} pick off cash prizes while the light is moving.` },
    { id: 'cannon', tag: 'CN', color: '#c8f542', max: 5, name: 'T-SHIRT CANNONS', d: l => `When you bank, the cannons shoot ${l} more prize${l > 1 ? 's' : ''} into the pot first.` },
    { id: 'crowd',  tag: 'CR', color: '#f5a542', max: 4, name: 'CROWD PLEASER',   d: l => `After every buzz the audience throws ${l} fresh prize${l > 1 ? 's' : ''} onto burnt-out podiums.` },
    { id: 'bleep',  tag: 'BL', color: '#7fe0ff', max: 4, name: 'BLEEP BUTTON',    d: l => `The first ${l > 1 ? l + ' dead air stops' : 'dead air stop'} each round ${l > 1 ? 'are' : 'is'} bleeped out.` },
    { id: 'wide',   tag: 'WD', color: '#ffffff', max: 4, name: 'FOLLOW SPOT',     d: l => `The PERFECT zone is ${['', 'bigger', 'much bigger', 'huge', 'nearly the whole podium'][Math.min(l, 4)]}. PERFECT stops pay double.` },
    { id: 'gold',   tag: 'AU', color: '#ffd24a', max: 4, name: 'GOLD RUSH',       d: l => `${l} gold prize${l > 1 ? 's' : ''} on every strip, worth five times as much.` },
    { id: 'budget', tag: '$$', color: '#5fe08a', max: 5, name: 'PRIZE BUDGET',    d: l => 'A bigger prize pool: every cash and gold prize is worth $' + (10 * l) + ' more.' },
    { id: 'jack',   tag: 'JK', color: '#ff6bd6', max: 4, name: 'DIAMOND PODIUM',  d: l => `Once a round, a diamond that multiplies the whole pot by ${1.5 + 0.5 * l}.` },
    { id: 'hypeman',tag: 'HY', color: '#42d4f5', max: 5, name: 'HYPE MAN',        d: l => `Hype prizes give +${1 + l} instead of +1.` },
    { id: 'net',    tag: 'SN', color: '#42f5b0', max: 3, name: 'SAFETY NET',      d: l => `Dead air still banks ${Math.min(100, 25 * l)}% of the pot.` },
    { id: 'encore', tag: '+1', color: '#c8f542', max: 3, name: 'ENCORE',          d: l => `+${l} round${l > 1 ? 's' : ''} every episode.` },
    { id: 'clock',  tag: 'XT', color: '#ffd24a', max: 4, name: 'EXTENDED CUT',    d: l => `+${4 * l} seconds on the clock every round.` },
    { id: 'slowmo', tag: 'SL', color: '#7fe0ff', max: 3, name: 'DRAMATIC PAUSE',  d: l => `+${l} slow-mo use${l > 1 ? 's' : ''} every round.` },

    // Headliners: rare, one level only, and each one changes a rule instead of a number.
    { id: 'ghost',  rare: true, tag: 'GH', color: '#e9e9ff', max: 1, name: 'GHOST LIGHT',      d: () => 'Burnt-out podiums are no longer dead air. Stopping on one just wastes the buzz.' },
    { id: 'streak', rare: true, tag: 'HS', color: '#ff7a2e', max: 1, name: 'HOT STREAK',       d: () => 'PERFECT stops in a row pay x2, then x3, then x4 and up. One miss resets it.' },
    { id: 'combo',  rare: true, tag: 'CC', color: '#f5a542', max: 1, name: 'CROWD COMBO',      d: () => 'Every prize after the first in a single buzz adds +0.5 hype.' },
    { id: 'midas',  rare: true, tag: 'MD', color: '#ffd24a', max: 1, name: 'MIDAS TOUCH',      d: () => 'Every PERFECT stop turns two cash prizes to gold.' },
    { id: 'steady', rare: true, tag: 'SC', color: '#9d8cff', max: 1, name: 'STEADY CAM',       d: () => 'The light never speeds up.' },
    { id: 'life',   rare: true, tag: 'RR', color: '#ff5a7a', max: 1, name: 'RERUN',            d: () => 'Once an episode, dead air does not end the round: you lose half the cash and play on.' },
    { id: 'double', rare: true, tag: 'DN', color: '#ffd24a', max: 1, name: 'DOUBLE OR NOTHING', d: () => 'Every bank flips a coin: the pot pays x2.5, or half.' },
    { id: 'static', rare: true, tag: 'ST', color: '#f542a8', max: 1, name: 'STATIC CLING',     d: () => 'Start every round with +1 hype for each dead air TV on the strip.' },

    // ── Unlocked from the Money Dump (lock: true). Until unlocked they never appear. ──
    { id: 'echo',     lock: true, tag: 'EC', color: '#9d8cff', max: 3, name: 'ECHO CHAMBER',   d: l => `Every ${['', '4th', '3rd', '2nd'][l]} buzz, your prize pays out twice.` },
    { id: 'tipline',  lock: true, tag: 'TL', color: '#5fe08a', max: 5, name: 'TIP LINE',       d: l => `+$${5 * l} for every prize won by anything other than your own light.` },
    { id: 'opener',   lock: true, tag: 'CO', color: '#42d4f5', max: 3, name: 'COLD OPEN',      d: l => `The first buzz of every round pays x${1 + l}.` },
    { id: 'closer',   lock: true, tag: 'BF', color: '#ff9a2e', max: 4, name: 'BIG FINISH',     d: l => `Bank with 3 seconds or less on the clock: the pot pays x${1 + 0.25 * l}.` },
    { id: 'residual', lock: true, tag: 'RS', color: '#ffd24a', max: 4, name: 'RESIDUALS',      d: l => `Each round starts with ${5 * l}% of what the last round banked, as cash.` },
    { id: 'edges',    lock: true, tag: 'SW', color: '#d4244e', max: 3, name: 'STAGE WINGS',    d: l => `Cash and gold on the two end podiums pay x${1 + l}.` },
    { id: 'center',   lock: true, tag: 'CS', color: '#fff4c2', max: 3, name: 'CENTRE STAGE',   d: l => `Cash and gold on the two middle podiums pay x${1 + l}.` },
    { id: 'recycle',  lock: true, tag: 'RC', color: '#42f5b0', max: 3, name: 'REPEAT SHOWING', d: l => `${15 * l}% chance a prize you win stays on its podium.` },
    { id: 'sparks',   lock: true, tag: 'SK', color: '#fff36b', max: 4, name: 'SPARKLERS',      d: l => `Every PERFECT stop adds +${0.25 * l} hype.` },
    { id: 'stoppage', lock: true, tag: 'ST', color: '#7fe0ff', max: 4, name: 'STOPPAGE TIME',  d: l => `Every PERFECT stop puts ${0.5 * l} second${l === 2 ? '' : 's'} back on the clock.` },
    { id: 'antenna',  lock: true, tag: 'RE', color: '#d8d8e0', max: 4, name: 'RABBIT EARS',    d: l => `${10 * l}% chance a dead air TV next to a prize you win gets fixed into cash.` },
    { id: 'lucky',    lock: true, tag: 'LS', color: '#ff6bd6', max: 3, name: 'LUCKY SOCKS',    d: l => `${12 * l}% chance a dead air stop simply does not count.` },
    { id: 'ovation',  lock: true, tag: 'SO', color: '#f5a542', max: 4, name: 'STANDING OVATION', d: l => `Clearing the whole stage gives +${2 + l} hype instead of +2.` },
    { id: 'thrift',   lock: true, tag: 'BB', color: '#b98a4a', max: 4, name: 'BARGAIN BIN',    d: l => `$10 prizes are worth $${15 * l} more.` },
    { id: 'rainy',    lock: true, tag: 'RD', color: '#42d4f5', max: 4, name: 'RAINY DAY FUND', d: l => `Dead air still banks a flat $${100 * l}.` },

    { id: 'allin',     lock: true, rare: true, tag: 'AI', color: '#e8203a', max: 1, name: 'ALL IN',            d: () => 'You cannot bank. Every round runs to the clock, and what is in the pot when time is called pays double.' },
    { id: 'slowburn',  lock: true, rare: true, tag: 'SB', color: '#ff9a2e', max: 1, name: 'SLOW BURN',         d: () => 'The light starts at half speed, but speeds up twice as fast with every buzz.' },
    { id: 'bogo',      lock: true, rare: true, tag: 'B1', color: '#c8f542', max: 1, name: 'BUY ONE GET ONE',   d: () => 'The first prize you take each round stays on its podium.' },
    { id: 'lastlaugh', lock: true, rare: true, tag: 'LL', color: '#ffd24a', max: 1, name: 'LAST LAUGH',        d: () => 'The final round of every episode pays double.' },
    { id: 'charity',   lock: true, rare: true, tag: 'MD', color: '#5fe08a', max: 1, name: 'MATCHED DONATION',  d: () => 'Everything you bank this season pays 50% more prize money.' },
    { id: 'greenlight',lock: true, rare: true, tag: 'GL', color: '#42f5b0', max: 1, name: 'GREEN LIGHT',       d: () => 'A PERFECT stop has a 50% chance to leave the prize where it is.' },
    { id: 'auction',   lock: true, rare: true, tag: 'BW', color: '#ffd24a', max: 1, name: 'BIDDING WAR',       d: () => 'Gold pays eight times a cash prize instead of five.' },
    { id: 'understudy',lock: true, rare: true, tag: 'US', color: '#9d8cff', max: 1, name: 'UNDERSTUDY',        d: () => 'When interference or a rival takes a prize, you still get half of it.' },
    { id: 'telethon',  lock: true, rare: true, tag: 'TT', color: '#7fe0ff', max: 1, name: 'TELETHON',          d: () => '+8 seconds on every round clock, but the light is 10% faster.' },
    { id: 'vip',       lock: true, rare: true, tag: 'VP', color: '#ff5a7a', max: 1, name: 'VIP LOUNGE',        d: () => 'Showcase cars turn up three times as often, and jackpot podiums five times.' },
  ];
  const common = g => !g.rare;

  // Lucky charms: you carry one per run. Small quirks, not power.
  const CHARMS = [
    { id: 'ch_penny',    name: 'LUCKY PENNY',      desc: 'Every cash and gold prize is worth $5 more.' },
    { id: 'ch_watch',    name: 'POCKET WATCH',     desc: '+2 seconds on every round clock.' },
    { id: 'ch_lozenge',  name: 'THROAT LOZENGE',   desc: 'Every round starts with +0.5 hype.' },
    { id: 'ch_foot',     name: "RABBIT'S FOOT",    desc: 'The first dead air stop of each episode does not count.' },
    { id: 'ch_headshot', name: 'SIGNED HEADSHOT',  desc: 'One extra wheel spin for clearing episode 1.' },
    { id: 'ch_clover',   name: 'FOUR-LEAF CLOVER', desc: 'Mystery boxes never hold a toaster.' },
    { id: 'ch_battery',  name: 'SPARE BATTERY',    desc: '+1 slow-mo every round.' },
    { id: 'ch_agent',    name: "AGENT'S CARD",     desc: '+15% prize money this season.' },
    { id: 'ch_sticky',   name: 'STICKY NOTE',      desc: 'Your wheel starts with one extra gimmick wedge.' },
    { id: 'ch_plugs',    name: 'EARPLUGS',         desc: 'Interference strikes about a third less often.' },
    { id: 'ch_script',   name: 'OLD SCRIPT',       desc: 'The first round of every episode gets +4 seconds.' },
    { id: 'ch_coffee',   name: 'DECAF',            desc: 'The light is 8% slower.' },
    { id: 'ch_tooth',    name: 'GOLD TOOTH',       desc: 'One extra gold prize on every strip.' },
    { id: 'ch_mints',    name: 'BREATH MINTS',     desc: 'Specials are twice as likely to turn up.' },
    { id: 'ch_coupon',   name: 'COUPON BOOK',      desc: 'Money Dump crates cost 10% less.' },
    { id: 'ch_cue',      name: 'CUE CARDS',        desc: 'The PERFECT zone is a little bigger.' },
    { id: 'ch_pass',     name: 'STAGE PASS',       desc: 'One free bleep every round during act I.' },
    { id: 'ch_foil',     name: 'TIN FOIL HAT',     desc: 'One fewer dead air TV on every strip.' },
    { id: 'ch_tie',      name: 'LUCKY TIE',        desc: 'The final round of every episode pays 10% more.' },
    { id: 'ch_fanmail',  name: 'FAN MAIL',         desc: 'Every round starts with $20 already in the pot.' },
  ];

  // New things that can turn up on a podium once unlocked.
  const XPRIZES = [
    { id: 'clockp',    name: 'STOPWATCH',   desc: 'A strip prize: 5 seconds back on the clock.' },
    { id: 'bleepp',    name: 'BLEEP TOKEN', desc: 'A strip prize: one extra bleep for the round.' },
    { id: 'superstar', name: 'SUPERSTAR',   desc: 'A strip prize: +3 hype in one go.' },
    { id: 'coin',      name: 'LUCKY COIN',  desc: 'A strip prize: heads, the cash in your pot grows by half. Tails, you lose a quarter of it.' },
    { id: 'broom',     name: 'THE BROOM',   desc: 'A strip prize: sweeps up every $10 and $20 prize on the strip at once.' },
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
    { id: 'classic',  color: '#c8f542', spins: 0, name: 'CLASSIC NIGHT', desc: 'The show as written. No surprises.' },
    { id: 'turbo',    color: '#ff9a2e', spins: 0, name: 'DOUBLE TIME',   desc: 'The light moves 35% faster. Cash and gold pay double.' },
    { id: 'mystery',  color: '#9d8cff', spins: 1, name: 'MYSTERY NIGHT', desc: 'Every prize is under a cloth. You only see what the light is passing over.' },
    { id: 'conveyor', color: '#42d4f5', spins: 1, name: 'CONVEYOR',      desc: 'The whole strip slides one podium along every second or so.' },
    { id: 'strobe',   color: '#ffffff', spins: 1, name: 'STROBE',        desc: 'The light does not sweep. It jumps to a random podium, again and again.' },
    { id: 'pendulum', color: '#42f5b0', spins: 0, name: 'PENDULUM',      desc: 'The light swings: slow at the ends, very fast through the middle.' },
    { id: 'high',     color: '#ff6bd6', spins: 0, name: 'HIGH ROLLER',   desc: 'One fewer round, but every round starts with +2 hype.' },
    { id: 'goldnight',color: '#ffd24a', spins: 0, name: 'GOLD NIGHT',    desc: 'Three extra gold prizes on every strip, and one extra dead air.' },
    { id: 'censors',  color: '#f542a8', spins: 1, name: "CENSORS' NIGHT", desc: 'Two extra dead air on every strip. You get one free bleep a round.' },
    // Unlocked from the Money Dump.
    { id: 'reflect',  lock: true, color: '#d8d8e0', spins: 0, name: 'MIRROR IMAGE', desc: 'The right half of the strip is a mirror of the left.' },
    { id: 'shrink',   lock: true, color: '#ff5a3c', spins: 1, name: 'SHRINKING STAGE', desc: 'Every four seconds the outermost podium goes dark, prize and all.' },
    { id: 'shuffle',  lock: true, color: '#c8f542', spins: 1, name: 'SHUFFLE', desc: 'Every time you buzz, everything left on the strip changes places.' },
    { id: 'jitters',  lock: true, color: '#ff6bd6', spins: 1, name: 'STAGE FRIGHT', desc: 'The light changes direction without warning.' },
    { id: 'cashonly', lock: true, color: '#5fe08a', spins: 0, name: 'CASH ONLY', desc: 'No hype stars tonight. Cash and gold pay double.' },
    { id: 'onetake',  lock: true, color: '#7fe0ff', spins: 0, name: 'ONE TAKE', desc: 'A single round with 40 seconds on the clock.' },
  ];
  const SPECIALS = ['box', 'bomb', 'x2', 'restock'];

  // Rare events. An episode carries at most one, and most carry none.
  const SPECIAL_CHANCE = 0.06;                   // per episode, from episode 2
  const CAR_CHANCE = 0.02, JACKPOT_CHANCE = 0.008;   // per round
  const EVENTS = [
    { id: 'rival', color: '#e8203a', name: 'RIVAL CONTESTANT', desc: 'A returning champion is on stage tonight. Every few seconds they snatch a prize off the strip. Clear the episode anyway and you get an extra wheel spin.' },
    { id: 'vote',  color: '#f5a542', name: 'AUDIENCE VOTE',    desc: 'Before every round tonight the crowd votes for cash or for hype. Whatever they pick pays double that round.' },
    { id: 'offer', color: '#c8f542', name: "THE HOST'S OFFER", desc: 'After the first round the host will offer you cash to sit the next round out.' },
    { id: 'ad',    color: '#42d4f5', name: 'COMMERCIAL BREAK', desc: 'After the first round a sponsor will offer you a deal for the rest of the episode.' },
    { id: 'bonus', color: '#ffd24a', name: 'BONUS ROUND',      desc: 'Clear tonight and you play a bonus round: one buzz, four wheel tokens, eight dead air. Hit a token for an extra spin. Miss and you lose nothing.' },
  ];
  const DEALS = [
    { id: 'fast', name: 'ENERGY DRINK',  desc: 'For the rest of the episode the light is 25% faster, and cash and gold pay 50% more.' },
    { id: 'tvs',  name: 'CABLE PACKAGE', desc: 'Two extra dead air TVs on every strip for the rest of the episode, but every round starts with +2 hype.' },
    { id: 'time', name: 'EXTENDED AD',   desc: 'The ad runs long: 5 seconds off the clock for the rest of the episode, and one extra wheel spin.' },
  ];

  // Things you can do to the wheel itself.
  const WHEEL_UPS = [
    { id: 'trim', tag: 'CUT', color: '#f542a8', name: 'TRIM THE WHEEL', desc: 'Remove the DEAD AIR wedge, or a toaster if it is already gone.', ok: g => g.wheel.some(w => w.type === 'dead' || w.type === 'junk') },
    { id: 'fat',  tag: 'FAT', color: '#42d4f5', name: 'WEIGHTED WHEEL', desc: 'Every gimmick wedge gets 30% wider.', ok: () => true },
    { id: 'gold', tag: 'x2',  color: '#ffd24a', name: 'GOLDEN WEDGE',   desc: 'Add a golden wedge: land on it for two random gimmicks at once.', ok: g => g.wheel.filter(w => w.type === 'gold').length < 2 },
    { id: 'spin', tag: '+1',  color: '#c8f542', name: 'FREE SPIN',      desc: '+1 spin, right now.', ok: () => true },
  ];

  const CONTESTANTS = [
    { id: 'rookie', name: 'THE ROOKIE',  desc: 'A buzzer and a dream.', start: [], need: null },
    { id: 'stunt',  name: 'THE STUNT COORDINATOR', desc: 'Starts with PYROTECHNICS and FOLLOW SPOT.', start: ['pyro', 'wide'], need: 'Clear episode 3', ok: st => st.bestEp >= 3 },
    { id: 'nerd',   name: 'THE AV NERD', desc: 'Starts with LIVE WIRE and a CAMERA DRONE.', start: ['wire', 'drone'], need: 'Clear episode 5', ok: st => st.bestEp >= 5 },
    // Unlocked from the Money Dump.
    { id: 'weather',   lock: true, name: 'THE WEATHER PRESENTER', desc: 'Starts with LIVE WIRE and SLOW-MO to spare.', start: ['wire', 'slowmo'] },
    { id: 'shopping',  lock: true, name: 'THE SHOPPING HOST',     desc: 'Starts with PRIZE BUDGET and GOLD RUSH.', start: ['budget', 'gold'] },
    { id: 'childstar', lock: true, name: 'THE CHILD STAR',        desc: 'Starts with ENCORE and SAFETY NET.', start: ['encore', 'net'] },
    { id: 'quizchamp', lock: true, name: 'THE QUIZ CHAMP',        desc: 'Starts with FOLLOW SPOT at level 2.', start: ['wide', 'wide'] },
    { id: 'magician',  lock: true, name: 'THE STAGE MAGICIAN',    desc: 'Starts with MIRROR BALL and one random headliner.', start: ['mirror', '?rare'] },
    { id: 'guard',     lock: true, name: 'THE NIGHT GUARD',       desc: 'Starts with BLEEP BUTTON at level 2.', start: ['bleep', 'bleep'] },
    { id: 'diva',   name: 'THE DIVA',    desc: 'Starts with ENCORE and CROWD PLEASER.', start: ['encore', 'crowd'], need: 'Win a season', ok: st => st.wins >= 1 },
  ];

  // Dressing room: permanent upgrades bought with prize money. cost(l) = price of level l + 1.
  // These are long-term investments: a first level is about one good full season, a last level is a dozen or more.
  const PERKS = [
    { id: 'head',   icon: 'spin',    max: 3, name: 'HEAD START',         cost: l => [500000, 2000000, 7000000][l], d: l => `Start every season with ${l} spin${l > 1 ? 's' : ''} on the wheel.` },
    { id: 'time',   icon: 'clock',   max: 5, name: 'LONGER SLOT',        cost: l => [125000, 300000, 750000, 2000000, 5000000][l],          d: l => `+${l} second${l > 1 ? 's' : ''} on the clock every round.` },
    { id: 'warm',   icon: 'hypeman', max: 4, name: 'WARM-UP ACT',        cost: l => [200000, 600000, 1750000, 5000000][l],          d: l => `Every round starts with +${0.5 * l} hype.` },
    { id: 'budget', icon: 'budget',  max: 5, name: 'BIGGER BUDGET',      cost: l => [100000, 250000, 600000, 1500000, 4000000][l],          d: l => `Every cash and gold prize is worth $${5 * l} more.` },
    { id: 'trim',   icon: 'trim',    max: 3, name: 'LOADED WHEEL',       cost: l => [300000, 1250000, 4000000][l],          d: l => `Your wheel starts with ${l} fewer toaster${l > 1 ? 's' : ''}.` },
    { id: 'censor', icon: 'bleep',   max: 2, name: 'CENSOR ON RETAINER', cost: l => [1000000, 5000000][l],       d: l => `${l} free bleep${l > 1 ? 's' : ''} every round.` },
    { id: 'agent',  icon: 'gold',    max: 5, name: 'A BETTER AGENT',     cost: l => [150000, 400000, 1000000, 2500000, 6000000][l],          d: l => `+${20 * l}% prize money from everything you bank.` },
  ];

  const byId = (list, id) => list.find(x => x.id === id);

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
    this.rand = seed == null ? Math.random : mulberry(seed);
    this.who = who || 'rookie';
    this.ep = 0; this.total = 0;
    this.levels = {};
    this.phase = 'title';
    this.strip = []; this.pot = { cash: 0, hype: 1, xm: 1 };
    this.u = 0;                 // beam phase, 0..2N (it bounces end to end)
    this.events = []; this.q = [];
    this.t = 0; this.spins = 0; this.toasters = 0;
    this.best = 0; this.endless = false; this.droneT = [];
    const rares = GIMMICKS.filter(g => g.rare);
    const start = (byId(CONTESTANTS, this.who) || CONTESTANTS[0]).start.map(id => id === '?rare' ? rares[this.pick(rares.length)].id : id);
    start.forEach(id => { this.levels[id] = (this.levels[id] || 0) + 1; });
    // The wheel you start with: four gimmicks, three toasters and one dead air wedge.
    const pool = this.shuffle(GIMMICKS.filter(g => common(g) && this.open(g) && !start.includes(g.id))).slice(0, 4 - start.length).map(g => g.id);
    this.wheel = Array.from(new Set(start)).concat(pool).map(id => ({ type: 'g', id, w: 1 }));
    if (this.charm === 'ch_sticky') { const extra = GIMMICKS.filter(g => common(g) && this.open(g) && !this.wheel.some(w => w.id === g.id)); if (extra.length) this.wheel.push({ type: 'g', id: extra[this.pick(extra.length)].id, w: 1 }); }
    for (let i = 0; i < 3 - (this.perks.trim || 0); i++) this.wheel.push({ type: 'junk', w: 1 });
    this.wheel.push({ type: 'dead', w: 1 });
    this.shuffle(this.wheel);
  }

  const P = Game.prototype;
  P.pick = function (n) { return (this.rand() * n) | 0; };
  P.shuffle = function (a) {
    for (let i = a.length - 1; i > 0; i--) { const j = this.pick(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  P.lv = function (id) { return this.levels[id] || 0; };
  P.perk = function (id) { return this.perks[id] || 0; };
  // Time can be won back, but only 10 seconds of it per round, so a round always ends.
  P.addTime = function (sec) { const add = Math.max(0, Math.min(sec, 10 - (this.timeAdded || 0))); this.timeAdded = (this.timeAdded || 0) + add; this.clock += add; };
  P.open = function (x) { return !x.lock || this.unlocked.has(x.id); };
  P.ch = function (id) { return this.charm === 'ch_' + id; };
  // In endless the level caps come off (headliners stay one-offs).
  P.capOf = function (g) { return this.endless && !g.rare ? 99 : g.max; };
  P.emit = function (o) { if (this.events.length < 2000) this.events.push(o); };
  P.later = function (dt, fn) { this.q.push({ at: this.t + dt, fn }); };
  P.target = function (ep) {
    if (ep <= this.episodes) return TARGETS[ep - 1];
    return Math.round(TARGETS[this.episodes - 1] * Math.pow(1.5, ep - this.episodes) / 100) * 100;
  };
  P.gain = function (id) { this.levels[id] = this.lv(id) + 1; };
  // Interference: from act two static strikes burn prizes off the strip, faster every episode.
  P.stormEvery = function () { return this.ep <= ACT ? Infinity : Math.max(0.9, 5.5 - 0.3 * (this.ep - ACT - 1)) * (this.ch('plugs') ? 1.45 : 1); };
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
      spins: this.spins, toasters: this.toasters, best: this.best, banked: this.banked || 0, endless: this.endless,
      nextFormat: this.nextFormat || null, earned: this.earned || [], elapsed: this.elapsed, total: this.total,
      unlocked: Array.from(this.unlocked), charm: this.charm };
  };
  Game.restore = function (o) {
    const g = new Game(null, o.who, o.perks, o.episodes, { unlocked: o.unlocked, charm: o.charm });
    ['ep', 'levels', 'wheel', 'spins', 'toasters', 'best', 'banked', 'endless', 'nextFormat', 'earned', 'elapsed', 'total'].forEach(k => { g[k] = o[k]; });
    g.phase = o.stage === 'wheel' ? 'cleared' : 'ready';
    return g;
  };
  P.is = function (id) { return !!this.format && this.format.id === id; };
  P.deadCount = function () {
    return Math.max(1, Math.min(8, 1 + Math.ceil(this.ep / 3) + (this.is('goldnight') ? 1 : 0) + (this.is('censors') ? 2 : 0) + (this.dealIs('tvs') ? 2 : 0)) - (this.ch('foil') ? 1 : 0));
  };

  // ── Episode / round ─────────────────────────────────────────────
  P.startEpisode = function (formatId) {
    this.ep++;
    this.total = 0;
    this.format = byId(FORMATS, formatId || this.nextFormat) || FORMATS[0];
    this.nextFormat = null;
    this.lifeUsed = false; this.footUsed = false; this.prevScore = 0;
    this.deal = null; this.asked = false; this.ask = null; this.bonus = false; this.rivalScore = 0;
    this.special = this.ep >= 2 && this.rand() < SPECIAL_CHANCE * (this.ch('mints') ? 2 : 1) ? EVENTS[this.pick(EVENTS.length)].id : null;
    if (this.forceSpecial !== undefined) { this.special = this.forceSpecial; this.forceSpecial = undefined; }   // for tests
    this.rounds = this.is('onetake') ? 1 : Math.max(2, 3 + this.lv('encore') - (this.is('high') ? 1 : 0));
    this.roundsLeft = this.rounds;
    this.tokenOut = this.rand() < 0.5;        // a wheel token only turns up in about half the episodes
    this.startRound();
    this.emit({ t: 'episode' });
  };

  P.startRound = function () {
    this.strip = [];
    for (let i = 0; i < N; i++) this.strip.push({ kind: 'cash', val: 10, state: 'up' });
    this.jackOut = false;
    this.voteKind = this.special === 'vote' ? (this.rand() < 0.5 ? 'cash' : 'hype') : null;
    this.rareLeft = [];
    if (this.ep >= 2 && this.rand() < CAR_CHANCE * (this.lv('vip') ? 3 : 1)) this.rareLeft.push('car');
    if (this.rand() < JACKPOT_CHANCE * (this.lv('vip') ? 5 : 1)) this.rareLeft.push('jp');
    this.rivalT = 3.4;
    this.specialsLeft = (this.ep >= 4 ? 1 : 0) + (this.ep >= 2 && this.rand() < 0.6 ? 1 : 0) + (this.ep >= 8 && this.rand() < 0.5 ? 1 : 0);
    const order = this.shuffle(this.strip.slice());
    for (let i = 0; i < this.deadCount(); i++) order[i].kind = 'dead';
    this.dress(order.slice(this.deadCount()));
    if (this.is('reflect')) for (let i = 0; i < N / 2; i++) this.strip[N - 1 - i] = Object.assign({}, this.strip[i]);   // MIRROR IMAGE
    const tvs = this.strip.filter(q => q.kind === 'dead').length;
    const first = this.roundsLeft === this.rounds;
    this.pot = { cash: 10 * this.toasters + (this.ch('fanmail') ? 20 : 0) + Math.min(400 * this.lv('residual'), Math.floor(this.prevScore * 0.05 * this.lv('residual'))),
      hype: 1 + 0.5 * this.perk('warm') + (this.ch('lozenge') ? 0.5 : 0) + (this.dealIs('tvs') ? 2 : 0) + (this.is('high') ? 2 : 0) + (this.lv('static') ? tvs : 0), xm: 1, next2: false };
    this.buzzes = 0; this.bleeps = this.lv('bleep') + this.perk('censor') + (this.is('censors') ? 1 : 0) + (this.ch('pass') && this.ep <= ACT ? 1 : 0);
    this.slowLeft = 1 + this.lv('slowmo') + (this.ch('battery') ? 1 : 0); this.slowT = 0;
    this.clockMax = Math.max(6, (this.is('onetake') ? 40 : ROUND_TIME) + 4 * this.lv('clock') + this.perk('time') - (this.dealIs('time') ? 5 : 0) +
      (this.ch('watch') ? 2 : 0) + (this.ch('script') && first ? 4 : 0) + (this.lv('telethon') ? 8 : 0));
    this.clock = this.clockMax; this.timeAdded = 0; this.shrinkT = 4; this.shrinkSide = 0; this.jitT = 1.2;
    this.stormT = this.stormEvery();
    this.streak = 0; this.inBuzz = false;
    this.convT = 1.4; this.strobeT = 0.6;
    this.u = this.rand() * 2 * N;
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
    list.forEach(p => { p.kind = 'cash'; p.val = vals[this.pick(vals.length)]; p.state = 'up'; });
    let k = 0;
    const take = (n, kind) => { for (let i = 0; i < n && k < list.length; i++) list[k++].kind = kind; };
    if (!this.is('cashonly')) take(Math.min(2, list.length - 1), 'hype');
    if (!this.tokenOut && list.length > 3) { take(1, 'spin'); this.tokenOut = true; }
    if (this.lv('jack') && !this.jackOut && list.length > 3) { take(1, 'jack'); this.jackOut = true; }   // one diamond a round
    take(this.lv('gold') + (this.is('goldnight') ? 3 : 0) + (this.ch('tooth') ? 1 : 0), 'gold');
    // Oddities: a mystery box, a firework crate, a x2 card or a restock crate.
    while (this.rareLeft && this.rareLeft.length && k < list.length - 1) take(1, this.rareLeft.pop());   // a showcase car, the jackpot
    while (this.specialsLeft > 0 && k < list.length - 1) { const pool = SPECIALS.concat(XPRIZES.map(x => x.id).filter(id => this.unlocked.has(id))); take(1, pool[this.pick(pool.length)]); this.specialsLeft--; }
  };

  // What a cash prize pays, including the PRIZE BUDGET top-up.
  P.cashVal = function (p) {
    return Math.round((p.val + (p.val === 10 ? 15 * this.lv('thrift') : 0) + 10 * this.lv('budget') + 5 * this.perk('budget') + (this.ch('penny') ? 5 : 0)) *
      (this.is('turbo') ? 2 : 1) * (this.is('cashonly') ? 2 : 1) * (this.dealIs('fast') ? 1.5 : 1));
  };
  P.isUp = function (i) { const p = this.strip[i]; return !!p && p.state === 'up' && p.kind !== 'dead'; };
  P.upList = function () { const o = []; for (let i = 0; i < N; i++) if (this.isUp(i)) o.push(i); return o; };
  P.speed = function () {                                   // podiums per second
    return (3.6 + 0.24 * Math.min(this.ep, 18)) * (this.lv('slowburn') ? 0.5 : 1) * (1 + (this.lv('steady') ? 0 : (this.lv('slowburn') ? 0.18 : 0.09) * this.buzzes)) *
      (this.ch('coffee') ? 0.92 : 1) * (this.lv('telethon') ? 1.1 : 1) * (this.is('turbo') ? 1.35 : 1) * (this.dealIs('fast') ? 1.25 : 1) * (this.slowT > 0 ? 0.35 : 1);
  };
  // Slow-motion: a couple of seconds of a much slower light. A few uses per round.
  P.slowmo = function () {
    if (this.phase !== 'sweep' || this.slowLeft <= 0 || this.slowT > 0) return false;
    this.slowLeft--; this.slowT = 2.4;
    this.emit({ t: 'slow' });
    return true;
  };
  P.fold = function (u) { u = ((u % (2 * N)) + 2 * N) % (2 * N); return u < N ? u : 2 * N - u; };
  // Where every spotlight is right now, main beam first.
  P.beams = function () {
    const n = this.lv('twin') + 1, out = [];
    for (let k = 0; k < n; k++) out.push(this.fold(this.u + k * 2 * N / n));
    return out;
  };
  P.score = function () {
    const last = this.roundsLeft === 1;
    return Math.floor(this.pot.cash * this.pot.hype * this.pot.xm * (last && this.lv('lastlaugh') ? 2 : 1) * (last && this.ch('tie') ? 1.1 : 1));
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
        this.u = this.pick(N) + 0.2 + this.rand() * 0.6;
        this.strobeT = Math.max(0.4, 0.72 - 0.012 * this.ep) / (1 + (this.lv('steady') ? 0 : 0.05 * this.buzzes));
        this.emit({ t: 'jump' });
      }
    } else if (this.is('pendulum')) {
      this.u += this.speed() * (0.4 + 1.5 * Math.sin(Math.PI * this.fold(this.u) / N)) * dt;
    } else {
      if (this.is('jitters')) {                     // STAGE FRIGHT: the light turns round at random
        this.jitT -= dt * slow;
        if (this.jitT <= 0) { this.jitT = 0.7 + this.rand() * 1.6; this.u = 2 * N - (((this.u % (2 * N)) + 2 * N) % (2 * N)); }
      }
      this.u += this.speed() * dt;
    }
    if (this.is('shrink')) {                        // SHRINKING STAGE: the ends go dark one by one
      this.shrinkT -= dt * slow;
      if (this.shrinkT <= 0) {
        this.shrinkT = 4;
        const idx = [];
        for (let k = 0; k < N; k++) idx.push(this.shrinkSide ? N - 1 - k : k);
        const i = idx.find(j => this.strip[j].state !== 'gone');
        this.shrinkSide = 1 - this.shrinkSide;
        if (i != null && this.strip.filter(q => q.state !== 'gone').length > 4) { this.strip[i].state = 'gone'; this.emit({ t: 'shrink', i }); this.refillIfEmpty(false); }
      }
    }
    if (this.is('conveyor')) {
      this.convT -= dt * slow;
      if (this.convT <= 0) { this.convT = 1.3; this.strip.unshift(this.strip.pop()); this.emit({ t: 'shift' }); }
    }
    for (let k = 0; k < this.droneT.length; k++) {
      this.droneT[k] -= dt;
      if (this.droneT[k] <= 0) {
        this.droneT[k] = 3.2;
        const open = this.upList().filter(i => this.strip[i].kind === 'cash' || this.strip[i].kind === 'gold');
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
    if (money && (i === 0 || i === N - 1)) mult *= 1 + this.lv('edges');
    if (money && (i === N / 2 - 1 || i === N / 2)) mult *= 1 + this.lv('center');
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
    else if (p.kind === 'coin') { const up = this.rand() < 0.5; pot.cash = Math.round(pot.cash * (up ? 1.5 : 0.75)); note = up ? 'HEADS! CASH +50%' : 'TAILS. CASH -25%'; }
    else if (p.kind === 'broom') {
      this.later(0.1, () => { for (let j = 0; j < N; j++) if (this.isUp(j) && this.strip[j].kind === 'cash' && this.strip[j].val <= 20) this.win(j, 'broom', 1); });
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
    this.emit({ t: 'win', i, kind: p.kind, val, gain, via, mult, note, doubled, combo, stays });
    return true;
  };

  // Nothing left to win: the stage is re-dressed (dead air stays where it is).
  P.refillIfEmpty = function (bonus) {
    if (this.upList().length) return;
    this.dress(this.strip.filter(p => !(p.kind === 'dead' && p.state === 'up')));
    if (bonus) this.pot.hype += 2 + this.lv('ovation');
    this.emit({ t: 'refill', bonus });
  };

  // Hit the buzzer: every light stops where it is.
  P.buzz = function () {
    if (this.phase !== 'sweep') return false;
    this.phase = 'resolve';
    this.buzzes++;
    const beams = this.beams(), pos = Math.min(N - 0.001, beams[0]);
    const i = Math.floor(pos), frac = pos - i, p = this.strip[i];
    const perfect = Math.abs(frac - 0.5) < this.perfectZone();
    this.emit({ t: 'buzz', i, perfect, hit: this.isUp(i) });
    if (this.bonus) { this.endBonus(this.isUp(i), i); return true; }

    this.inBuzz = true;
    if (!this.isUp(i)) {
      this.streak = 0;
      if (p.kind !== 'dead' && this.lv('ghost')) {
        // GHOST LIGHT: a burnt-out podium is just an empty podium.
        this.emit({ t: 'whiff', i });
        this.later(0.35, () => { this.inBuzz = false; this.phase = 'sweep'; });
      } else if (this.rand() < 0.12 * this.lv('lucky') || (this.ch('foot') && !this.footUsed)) {
        // LUCKY SOCKS / RABBIT'S FOOT: this one does not count.
        if (this.ch('foot')) this.footUsed = true;
        p.state = 'gone';
        this.emit({ t: 'bleep', i, lucky: true });
        this.later(0.45, () => { this.inBuzz = false; this.phase = 'sweep'; });
      } else if (this.bleeps > 0) {
        this.bleeps--; p.state = 'gone';
        this.emit({ t: 'bleep', i });
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
    this.win(i, 'main', (perfect ? (this.lv('streak') ? 1 + this.streak : 2) : 1) * (this.buzzes === 1 ? 1 + this.lv('opener') : 1));
    if (perfect && this.lv('sparks')) this.pot.hype += 0.25 * this.lv('sparks');
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
      const j = Math.min(N - 1, Math.floor(beams[k]));
      add(0.12, () => this.win(j, 'twin', 1));
    }
    if (perfect) for (let d = 1; d <= this.lv('pyro'); d++) {
      add(0.09, () => { this.emit({ t: 'pyro', a: i - d, b: i + d }); this.win(i - d, 'pyro', 1); this.win(i + d, 'pyro', 1); });
    }
    for (let k = 0; k < this.lv('mirror'); k++) {
      add(0.1, () => { const up = this.upList(); if (!up.length) return; const j = up[this.pick(up.length)]; this.emit({ t: 'ray', i: j }); this.win(j, 'mirror', 1); });
    }
    if (this.lv('wire')) {
      let from = i;
      for (let k = 0; k < this.lv('wire'); k++) add(0.08, () => {
        const same = this.upList().filter(j => this.strip[j].kind === kind).sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
        if (!same.length) return;
        this.emit({ t: 'bolt', a: from, b: same[0] }); this.win(same[0], 'wire', 1); from = same[0];
      });
    }
    if (this.lv('laser') && this.buzzes % 3 === 0) {
      const fromLeft = this.rand() < 0.5;
      add(0.15, () => this.emit({ t: 'laser', fromLeft, n: this.lv('laser') + 1 }));
      for (let k = 0; k <= this.lv('laser'); k++) add(0.09, () => {
        const up = this.upList(); if (!up.length) return;
        this.win(fromLeft ? up[0] : up[up.length - 1], 'laser', 1);
      });
    }
    for (let k = 0; k < this.lv('crowd'); k++) add(0.14, () => {
      const dark = []; this.strip.forEach((q, j) => { if (q.state !== 'up') dark.push(j); });
      if (!dark.length) return;
      const j = dark[this.pick(dark.length)], q = this.strip[j];
      const vals = [10, 20, 20, 30, 50];
      q.kind = 'cash'; q.val = vals[this.pick(vals.length)]; q.state = 'up';
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
      this.later(at, () => { const up = this.rand() < 0.5; this.pot.xm *= up ? 2.5 : 0.5; this.emit({ t: 'coin', up }); });
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
      const done = this.ep === this.episodes && !this.endless ? 'won' : 'cleared';
      if (this.special === 'bonus') { this.afterBonus = done; this.startBonus(); } else this.phase = done;
    } else if (this.roundsLeft <= 0) this.phase = 'over';
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
    this.strip = [];
    for (let i = 0; i < N; i++) this.strip.push({ kind: 'dead', val: 10, state: 'up' });
    this.shuffle(this.strip.slice()).slice(0, 4).forEach(p => { p.kind = 'spin'; });
    this.pot = { cash: 0, hype: 1, xm: 1, next2: false };
    this.buzzes = 0; this.bleeps = 0; this.slowLeft = 0; this.slowT = 0;
    this.clockMax = 8; this.clock = 8; this.stormT = Infinity; this.droneT = []; this.q = [];
    this.voteKind = null; this.u = this.rand() * 2 * N;
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
    const gs = this.shuffle(GIMMICKS.filter(g => common(g) && this.open(g) && this.lv(g.id) < this.capOf(g))).slice(0, 2);
    // Now and then a headliner turns up in place of an ordinary wedge.
    const rares = this.shuffle(GIMMICKS.filter(g => g.rare && this.open(g) && !this.lv(g.id) && !this.wheel.some(w => w.id === g.id)));
    if (rares.length && this.ep >= 2 && this.rand() < 0.45) gs[this.pick(gs.length)] = rares[0];
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

  // Spins spent: now choose tomorrow's show from two formats.
  P.wheelDone = function () {
    if (this.phase !== 'wheel' || this.spins > 0) return false;
    this.formats = this.shuffle(FORMATS.filter(f => f !== this.format && this.open(f))).slice(0, 2);
    this.phase = 'pick';
    return true;
  };
  P.pickFormat = function (i) {
    if (this.phase !== 'pick' || !this.formats[i]) return false;
    this.nextFormat = this.formats[i].id; this.formats = null;
    this.phase = 'ready';
    return true;
  };

  // Everything the Money Dump can hand out. tier decides how often a crate rolls it.
  const UNLOCKS = [].concat(
    GIMMICKS.filter(g => g.lock && !g.rare).map(g => ({ id: g.id, cat: 'gimmick', tier: 'rare', name: g.name, desc: 'New wedge: ' + g.d(1), icon: g.id })),
    GIMMICKS.filter(g => g.lock && g.rare).map(g => ({ id: g.id, cat: 'headliner', tier: 'legendary', name: g.name, desc: 'New headliner: ' + g.d(1), icon: g.id })),
    FORMATS.filter(f => f.lock).map(f => ({ id: f.id, cat: 'format', tier: 'rare', name: f.name, desc: 'New show format: ' + f.desc, icon: 'f_' + f.id })),
    XPRIZES.map(x => ({ id: x.id, cat: 'prize', tier: 'rare', name: x.name, desc: x.desc, icon: 'p_' + x.id })),
    CONTESTANTS.filter(c => c.lock).map(c => ({ id: c.id, cat: 'contestant', tier: 'legendary', name: c.name, desc: 'New contestant: ' + c.desc, icon: 'who' })),
    CHARMS.map(c => ({ id: c.id, cat: 'charm', tier: 'common', name: c.name, desc: 'Lucky charm: ' + c.desc, icon: c.id })),
    LOOKS.map(l => ({ id: l.id, cat: 'look', tier: 'common', name: l.name, desc: 'Wardrobe: a new ' + { theme: 'set', outfit: 'outfit for your contestant', host: 'jacket for the host', buzzer: 'buzzer', confetti: 'confetti mix' }[l.slot] + '.', icon: 'look', look: l })));
  // Crate price: starts modest and climbs with every crate opened.
  const cratePrice = opened => 50000 + 5000 * opened;

  const api = { UNLOCKS, CHARMS, LOOKS, XPRIZES, cratePrice, Game, N, EPISODES, PILOT, ACT, TARGETS, GIMMICKS, WHEEL_UPS, CONTESTANTS, FORMATS, PERKS, EVENTS, byId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeadAir = api;
})(typeof window !== 'undefined' ? window : globalThis);
