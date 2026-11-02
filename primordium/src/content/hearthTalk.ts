// What the critters round the fire say to each other: a few lines back and forth, now and then,
// about what's going on (the fire, the food, the season, the newest of them, the villages won).
// `a` opens, `b` answers, and they take turns down the list. Plain words: they're new at this.

export interface TalkCtx {
  a: string;
  b: string;
  /** The fire, 0 (embers) to 1 (roaring). */
  heat: number;
  season: 'Spring' | 'Summer' | 'Autumn' | 'Winter';
  critters: number;
  /** Food, as the top bar shows it. */
  food: string;
  rate: number;
  won: number;
  age: number;
  /** The youngest of them, and the oldest (names), when there are others than these two. */
  young?: string;
  old?: string;
  foragers: number;
  huts: number;
  /** Whether the council buys by itself. */
  council: boolean;
}

type Talk = (c: TalkCtx) => string[] | null;

const TALKS: Talk[] = [
  // The fire.
  (c) => (c.heat > 0.8 ? [`${c.b}, move back. Your tail's smoking.`, 'It is not.', 'It is a little.'] : null),
  (c) => (c.heat > 0.8 ? ['Who made it so big?', 'Someone keeps feeding it.', 'Good. Keep feeding it.'] : null),
  (c) => (c.heat > 0.6 ? ['Everything cooks faster when it\'s like this.', 'Everything tastes better too.'] : null),
  (c) => (c.heat < 0.15 ? [`${c.b}. ${c.b}. The fire's going out.`, 'Mm.', 'Somebody should do something.', 'Somebody should.'] : null),
  (c) => (c.heat < 0.15 ? ['It\'s cold.', 'Then sit closer.', 'Closer to what?'] : null),
  (c) => (c.heat < 0.3 ? ['Do you think it gets lonely when nobody feeds it?', 'It\'s a fire, ' + c.a + '.', 'Still.'] : null),
  () => ['Watch the sparks go up.', 'Where do they go?', 'Up.', 'Then where?', 'Further up.'],
  () => ['I saw a shape in the flames.', 'What shape?', 'Gone now.'],

  // Food.
  (c) => (c.rate < 5 ? ['Is this all the food there is?', 'For now.', 'Then I\'m going foraging.', 'Take someone with you.'] : null),
  (c) => (c.foragers > 30 ? ['Have you seen how many go out foraging now?', `I counted ${c.foragers} this morning.`, 'And they all come back full.'] : null),
  (c) => (c.rate > 1e4 ? ['There\'s more food than we can eat.', 'Then we\'ll grow until we can.'] : null),
  (c) => [`We've got ${c.food} put by, ${c.b}.`, 'Is that a lot?', 'I don\'t know how to count that high.'],
  () => ['Fish again.', 'You like fish.', 'I liked fish.'],
  (c) => ['Who ate the last of the roots?', '...', `I know it was you, ${c.b}.`],

  // The village.
  (c) => (c.huts < 3 ? ['Where do I sleep tonight?', 'Where you slept last night.', 'On you?'] : null),
  (c) => (c.huts >= 10 ? ['I got lost between the huts today.', 'There are only huts.', 'Exactly.'] : null),
  (c) => (c.critters > 40 ? [`Do you know everyone's name, ${c.b}?`, 'Most.', 'I don\'t know half of them.', 'They don\'t know yours either.'] : null),
  (c) => (c.critters < 10 ? ['It\'s quiet with so few of us.', 'It won\'t be for long.'] : null),
  (c) => (c.council ? ['The elders bought another hut without asking anyone.', 'Did you want to be asked?', 'I wanted to be asked.'] : null),
  (c) => (c.young ? [`${c.young} took their first steps today.`, 'Toward the fire?', 'Toward the fire.', 'They always do.'] : null),
  (c) => (c.young ? [`Little ${c.young} asked me where we came from.`, 'What did you say?', 'I said: across the water.', 'And?', 'And they asked what was before that.'] : null),
  (c) => (c.old ? [`${c.old} is telling the crossing again.`, 'Is it longer this time?', 'Much.'] : null),
  (c) => (c.old ? [`Ask ${c.old} about the old island.`, 'I did once.', 'And?', 'They went quiet.'] : null),

  // The island and the others on it.
  (c) => (c.won > 0 ? ['The ones from the other village dance differently.', 'Better?', 'Louder.'] : null),
  (c) => (c.won > 2 ? [`${c.won} villages, and they all come to our fire now.`, 'It\'s a good fire.'] : null),
  (c) => (c.won === 0 ? ['There are others out there. I\'ve seen their smoke.', 'Are they like us?', 'I don\'t know yet.'] : null),
  () => ['The scouts found something in the fog.', 'What?', 'They won\'t say until they\'re sure.'],
  () => ['Do you ever go to the edge of the island and look out?', 'Every day.', 'What for?', 'In case.'],

  // The seasons.
  (c) => (c.season === 'Winter' ? ['Everyone\'s at the fire tonight.', 'It\'s winter. Where else would they be?'] : null),
  (c) => (c.season === 'Winter' ? [`Budge up, ${c.b}.`, 'There\'s no more budge.'] : null),
  (c) => (c.season === 'Spring' ? ['Smell that? Green things.', 'I smell smoke.', 'Under the smoke.'] : null),
  (c) => (c.season === 'Summer' ? ['Why do we sit at the fire when it\'s this warm?', 'Habit.', 'Good habit.'] : null),
  (c) => (c.season === 'Autumn' ? ['The leaves are turning.', 'Into what?', 'Red. Then nothing.'] : null),

  // The Ages.
  (c) => (c.age >= 2 ? ['Remember when it was only a little fire on the beach?', 'I remember the raft.', 'You don\'t. You weren\'t born.', 'I remember it anyway.'] : null),
  (c) => (c.age >= 2 ? ['They\'re building something big by the hearth.', 'What is it for?', 'For being big, I think.'] : null),

  // Nothing much.
  (c) => [`Can I tell you something, ${c.b}?`, 'Go on.', '...I forgot.'],
  () => ['Do you think the stars have fires too?', 'Little ones.', 'Who feeds them?'],
  () => ['Your coat\'s nice tonight.', 'It\'s the same coat.', 'It\'s nice tonight.'],
  () => ['Sing something.', 'No.', 'Hum something.', 'Mmmm.'],
  () => ['I\'m going to sleep.', 'You said that before.', 'I meant it before too.'],
];

/** Something for two of them to say to each other (a, b, a, b...), fitting what's going on. */
export function pickTalk(c: TalkCtx, last: number[] = []): { i: number; lines: string[] } {
  const fits = TALKS.map((t, i) => ({ i, lines: t(c) })).filter((x): x is { i: number; lines: string[] } => !!x.lines && !last.includes(x.i));
  // (What's going on just now is likelier than the idle chatter: the list's specials come first.)
  const special = fits.filter((x) => x.i < TALKS.length - 6);
  const pool = special.length && Math.random() < 0.75 ? special : fits;
  return pool[Math.floor(Math.random() * pool.length)] ?? { i: -1, lines: ['...', '...'] };
}
