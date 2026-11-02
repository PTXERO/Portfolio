// What the critters round the fire say to each other: a few lines back and forth, now and then.
// Who's talking matters: a little one asks, an elder remembers, the grumpy grumble, the curious
// wonder. Each talk says who can say it (by age and by temper), and what's going on (the fire,
// the season, the food, the villages won) picks among the ones that fit. Plain words.

/** How old they are, as the others see it. */
export type Age = 'little' | 'youngster' | 'grown' | 'elder';
/** What they're like: from their trait (the four who crossed), or born to it. */
export type Temper = 'bold' | 'restless' | 'curious' | 'stubborn' | 'gentle' | 'wise' | 'cheerful' | 'grumpy' | 'dreamy' | 'greedy';

export const TEMPERS: Temper[] = ['bold', 'restless', 'curious', 'stubborn', 'gentle', 'wise', 'cheerful', 'grumpy', 'dreamy', 'greedy'];
/** The four's traits, as tempers. */
export const TRAIT_TEMPER: Record<string, Temper> = { strong: 'bold', swift: 'restless', keen: 'curious', hardy: 'stubborn', frail: 'gentle', old: 'wise', young: 'cheerful' };

/** What someone's like: from their trait if they have one (the four), else born to it (the same
 * all their life). */
export function temperOf(p: { id: number; trait?: string }): Temper {
  return (p.trait && TRAIT_TEMPER[p.trait]) || TEMPERS[(Math.imul(p.id | 0, 2654435761 | 0) >>> 0) % TEMPERS.length];
}

export interface Speaker {
  name: string;
  age: Age;
  temper: Temper;
  /** One of those who crossed to this island. */
  crossed: boolean;
}

export interface TalkCtx {
  a: Speaker;
  b: Speaker;
  /** The fire, 0 (embers) to 1 (roaring). */
  heat: number;
  season: 'Spring' | 'Summer' | 'Autumn' | 'Winter';
  critters: number;
  food: string;
  rate: number;
  won: number;
  age: number;
  /** Someone else's name, the youngest and the eldest of the rest (not these two). */
  young?: string;
  old?: string;
  foragers: number;
  huts: number;
  council: boolean;
  /** Islands left behind (0 on the first). */
  crossings: number;
}

interface Talk {
  /** Who can open it, and who can answer (any, if left out). */
  a?: Age[];
  b?: Age[];
  am?: Temper[];
  bm?: Temper[];
  say: (c: TalkCtx) => string[] | null;
}

const KIDS: Age[] = ['little', 'youngster'];
const BIG: Age[] = ['grown', 'elder'];
const N = (c: TalkCtx) => c.b.name;

const TALKS: Talk[] = [
  // ---- Little ones and the grown ----
  { a: ['little'], b: BIG, say: () => ['Can I feed the fire?', 'When you\'re bigger.', 'I\'m bigger than yesterday.'] },
  { a: ['little'], b: BIG, say: () => ['Why is the fire hot?', 'So it can cook.', 'Why does it want to cook?'] },
  { a: ['little'], b: BIG, say: (c) => [`${N(c)}, where do the sparks go?`, 'Up, to be stars.', 'All of them?', 'The good ones.'] },
  { a: ['little'], b: ['elder'], say: () => ['Were you ever little?', 'Smaller than you.', 'No.', 'Smaller.'] },
  { a: ['little'], b: BIG, say: () => ['I\'m not tired.', 'Your eyes are closing.', 'They\'re resting. I\'m not.'] },
  { a: ['little'], b: BIG, say: (c) => (c.heat > 0.6 ? ['It\'s so big tonight!', 'Not too close.', 'I\'m not close. My feet are.'] : null) },
  { a: ['little'], b: BIG, say: (c) => (c.season === 'Winter' ? ['My toes are cold.', 'Put them by the fire.', 'They don\'t want to go.'] : null) },
  { a: KIDS, b: ['elder'], say: () => ['Where did we come from?', 'Across the water.', 'And before that?', '...Ask me when you\'re grown.'] },
  { a: BIG, b: ['little'], say: (c) => [`${N(c)}, stop poking the embers.`, 'I\'m helping.', 'Help from over there.'] },
  { a: BIG, b: ['little'], say: () => ['Time to sleep.', 'One more story.', 'You said that last night.', 'And you told one.'] },
  { a: ['elder'], b: ['little'], say: (c) => (c.crossings ? ['When I was your size, we lived on another island.', 'Was it nicer?', 'It was further away.'] : ['When I was your size there were only four of us.', 'Only four? Who did you play with?', 'The fire.']) },
  { a: ['youngster'], b: ['little'], say: () => ['Race you to the water.', 'It\'s dark.', 'Race you in the morning, then.'] },
  { a: ['little'], b: ['little', 'youngster'], say: () => ['I saw a fish this big.', 'Fish aren\'t that big.', 'This one was.'] },
  { a: ['youngster'], b: BIG, say: () => ['When can I go foraging?', 'When you can find your way back.', 'I always find my way back.', 'You found my bed last time.'] },
  { a: ['youngster'], b: BIG, say: (c) => (c.won ? ['Can I go to the other villages?', 'When you\'re grown.', 'Their kids are allowed.'] : null) },
  { a: KIDS, b: KIDS, say: () => ['Do you think the fire sleeps?', 'It\'s awake. Look.', 'Then why do they feed it at night?'] },

  // ---- Elders ----
  { a: ['elder'], b: BIG, say: (c) => (c.age >= 2 ? ['Remember when it was only a little fire on the beach?', 'I remember the raft.', 'You don\'t. You were too small.', 'I remember it anyway.'] : null) },
  { a: ['elder'], say: () => ['My bones know when it\'ll rain.', 'Will it rain?', 'They\'re not saying.'] },
  { a: ['elder'], say: (c) => (c.crossings && c.a.crossed ? ['I crossed the water to get here.', 'We all know.', 'Then I\'ll tell it again.'] : null) },
  { a: BIG, b: ['elder'], say: (c) => [`${N(c)}, tell the crossing.`, 'You\'ve heard it.', 'The little ones haven\'t.', 'Then sit, all of you.'] },
  { a: BIG, b: ['elder'], say: (c) => (c.old && c.old !== c.b.name ? [`${c.old} is telling the crossing again.`, 'Is it longer this time?', 'Much.'] : null) },

  // ---- Tempers ----
  { am: ['grumpy'], say: (c) => (c.critters > 30 ? ['Too many of us round one fire.', 'Then build another.', 'Then I\'d have to sit at it.'] : ['Too loud tonight.', 'Nobody\'s talking.', 'Then the fire\'s too loud.']) },
  { am: ['grumpy'], bm: ['cheerful'], say: () => ['Why are you always smiling?', 'Why aren\'t you?', '...I am. Inside.'] },
  { am: ['curious'], say: () => ['What\'s past the fog?', 'More fog.', 'And past that?'] },
  { am: ['curious'], a: BIG, say: () => ['Do you think the stars have fires too?', 'Little ones.', 'Who feeds them?'] },
  { am: ['dreamy'], say: () => ['I dreamed I could swim like the fish.', 'You can\'t swim at all.', 'In the dream I could.'] },
  { am: ['dreamy'], say: () => ['I saw a shape in the flames.', 'What shape?', 'Gone now.'] },
  { am: ['greedy'], say: (c) => ['Who ate the last of the roots?', '...', `I know it was you, ${N(c)}.`] },
  { am: ['greedy'], say: () => ['Is there more fish?', 'You\'ve had three.', 'I\'ve had two and a half.'] },
  { am: ['bold'], a: BIG, say: () => ['I could beat the next village by myself.', 'You couldn\'t beat a log.', 'I beat a log yesterday.'] },
  { am: ['restless'], say: () => ['I can\'t sit still.', 'Then forage.', 'At night?', 'Then sit still.'] },
  { am: ['gentle'], say: (c) => [`You look tired, ${N(c)}.`, 'I am.', 'Lean on me, then.'] },
  { am: ['stubborn'], say: () => ['I\'m not moving back from the fire.', 'Your fur\'s singeing.', 'It can singe.'] },
  { am: ['wise'], a: BIG, say: () => ['A fire is like a village.', 'How?', 'Feed it, and it grows. Leave it, and it goes out.'] },
  { am: ['cheerful'], say: () => ['Sing something.', 'No.', 'Hum something.', 'Mmmm.'] },

  // ---- The fire ----
  { a: BIG, say: (c) => (c.heat > 0.8 ? [`${N(c)}, move back. Your tail's smoking.`, 'It is not.', 'It is a little.'] : null) },
  { a: BIG, say: (c) => (c.heat > 0.8 ? ['Who made it so big?', 'Someone keeps feeding it.', 'Good. Keep feeding it.'] : null) },
  { say: (c) => (c.heat < 0.15 ? [`${N(c)}. ${N(c)}. The fire's going out.`, 'Mm.', 'Somebody should do something.', 'Somebody should.'] : null) },
  { say: (c) => (c.heat < 0.15 ? ['It\'s cold.', 'Then sit closer.', 'Closer to what?'] : null) },
  { say: () => ['Watch the sparks go up.', 'Where do they go?', 'Up.', 'Then where?', 'Further up.'] },

  // ---- Food and the village ----
  { a: BIG, say: (c) => (c.rate < 5 ? ['Is this all the food there is?', 'For now.', 'Then I\'m going foraging.', 'Take someone with you.'] : null) },
  { a: BIG, say: (c) => (c.foragers > 30 ? ['Have you seen how many go out foraging now?', `I counted ${c.foragers} this morning.`, 'And they all come back full.'] : null) },
  { a: BIG, say: (c) => (c.rate > 1e4 ? ['There\'s more food than we can eat.', 'Then we\'ll grow until we can.'] : null) },
  { a: BIG, b: KIDS, say: (c) => [`We've got ${c.food} put by, ${N(c)}.`, 'Is that a lot?', 'More than you can count.'] },
  { say: () => ['Fish again.', 'You like fish.', 'I liked fish.'] },
  { a: BIG, say: (c) => (c.huts < 3 ? ['Where do I sleep tonight?', 'Where you slept last night.', 'On you?'] : null) },
  { say: (c) => (c.huts >= 10 ? ['I got lost between the huts today.', 'There are only huts.', 'Exactly.'] : null) },
  { a: BIG, say: (c) => (c.critters > 40 ? [`Do you know everyone's name, ${N(c)}?`, 'Most.', 'I don\'t know half of them.', 'They don\'t know yours either.'] : null) },
  { say: (c) => (c.critters < 10 ? ['It\'s quiet with so few of us.', 'It won\'t be for long.'] : null) },
  { a: BIG, say: (c) => (c.council ? ['The elders bought another hut without asking anyone.', 'Did you want to be asked?', 'I wanted to be asked.'] : null) },
  { a: BIG, say: (c) => (c.young ? [`${c.young} took their first steps today.`, 'Toward the fire?', 'Toward the fire.', 'They always do.'] : null) },

  // ---- The island ----
  { a: BIG, say: (c) => (c.won > 0 ? ['The ones from the other village dance differently.', 'Better?', 'Louder.'] : null) },
  { a: BIG, say: (c) => (c.won > 2 ? [`${c.won} villages, and they all come to our fire now.`, 'It\'s a good fire.'] : null) },
  { say: (c) => (c.won === 0 ? ['There are others out there. I\'ve seen their smoke.', 'Are they like us?', 'I don\'t know yet.'] : null) },
  { say: () => ['Do you ever go to the edge of the island and look out?', 'Every day.', 'What for?', 'In case.'] },

  // ---- Seasons ----
  { say: (c) => (c.season === 'Winter' ? ['Everyone\'s at the fire tonight.', 'It\'s winter. Where else would they be?'] : null) },
  { say: (c) => (c.season === 'Winter' ? [`Budge up, ${N(c)}.`, 'There\'s no more budge.'] : null) },
  { say: (c) => (c.season === 'Spring' ? ['Smell that? Green things.', 'I smell smoke.', 'Under the smoke.'] : null) },
  { say: (c) => (c.season === 'Summer' ? ['Why do we sit at the fire when it\'s this warm?', 'Habit.', 'Good habit.'] : null) },
  { say: (c) => (c.season === 'Autumn' ? ['The leaves are turning.', 'Into what?', 'Red. Then nothing.'] : null) },

  // ---- Nothing much ----
  { say: (c) => [`Can I tell you something, ${N(c)}?`, 'Go on.', '...I forgot.'] },
  { say: () => ['Your coat\'s nice tonight.', 'It\'s the same coat.', 'It\'s nice tonight.'] },
  { say: () => ['I\'m going to sleep.', 'You said that before.', 'I meant it before too.'] },
];

const fits = (t: Talk, a: Speaker, b: Speaker) => (!t.a || t.a.includes(a.age)) && (!t.b || t.b.includes(b.age)) && (!t.am || t.am.includes(a.temper)) && (!t.bm || t.bm.includes(b.temper));

/** Something for two of them to say to each other (who opens may swap, so it fits them): the
 * lines, and which of the two opens (0: a, 1: b). The ones about who they are, or what's going
 * on, are likelier than the idle chatter. */
export function pickTalk(c: TalkCtx, last: number[] = []): { i: number; lines: string[]; first: 0 | 1 } {
  const swapped: TalkCtx = { ...c, a: c.b, b: c.a };
  const all: { i: number; lines: string[]; first: 0 | 1; who: boolean }[] = [];
  TALKS.forEach((t, i) => {
    if (last.includes(i)) return;
    for (const [ctx, first] of [[c, 0], [swapped, 1]] as const) {
      if (!fits(t, ctx.a, ctx.b)) continue;
      const lines = t.say(ctx);
      if (lines) {
        all.push({ i, lines, first, who: !!(t.a || t.b || t.am || t.bm) });
        break;
      }
    }
  });
  const pick = (xs: typeof all) => xs[Math.floor(Math.random() * xs.length)];
  const about = all.filter((x) => x.who);
  const chosen = (about.length && Math.random() < 0.7 ? pick(about) : pick(all)) ?? { i: -1, lines: ['...', '...'], first: 0 as const };
  return { i: chosen.i, lines: chosen.lines, first: chosen.first };
}
