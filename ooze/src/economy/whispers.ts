// Whispers: the choices the tribe brings to the spear. Every few days the one they follow has
// something they can't decide alone (a thief, the sick, a hoard, one who hears the spear tell
// them to kill, an offering, a challenge, and at the end who goes on the raft), and the player,
// the voice in the spear, whispers the answer. Each answer does something and is remembered.
//
// And the island itself: the longer they stay on it, the more it works on them (Madness),
// faster under the spear's dread, slower with hope and a fire. It shows in what they say, then
// in quarrels, then in killing. The raft only holds four; they decide to send a family; and
// those left behind don't last.

import type { ExtinctionState, Survivor } from './extinction';
import { say } from './miracles';
import { remember } from './society';

export type WhisperId = 'thief' | 'sick' | 'hoard' | 'voice' | 'offering' | 'challenge' | 'who';
export type SendRule = 'strong' | 'young' | 'family';

export interface Whisper {
  id: WhisperId;
  /** Who it's about (ids), and the leader who asks. */
  who: number[];
  day: number;
}

export interface WhisperDef {
  /** The question, as the leader puts it (with names filled in). */
  ask: (ex: ExtinctionState, w: Whisper) => string;
  /** The answers the spear can give. */
  options: string[];
}

const byId = (ex: ExtinctionState, id: number) => ex.people.find((p) => p.id === id);
const nameOf = (ex: ExtinctionState, id: number) => byId(ex, id)?.name ?? 'someone';

function roll(ex: ExtinctionState): number {
  ex.luck = ((ex.luck ?? 1) * 1664525 + 1013904223) >>> 0;
  return ex.luck / 2 ** 32;
}

export const WHISPERS: Record<WhisperId, WhisperDef> = {
  thief: {
    ask: (ex, w) => `${nameOf(ex, w.who[0])} was caught taking from the stores in the night. They're all watching to see what's done.`,
    options: ['Spare them', 'Cast them out', 'Put them to the raft'],
  },
  sick: {
    ask: (ex, w) => `${nameOf(ex, w.who[0])} has a fever, and the others are afraid of catching it. They want them sent away from the camp.`,
    options: ['Keep them close', 'Send them away'],
  },
  hoard: {
    ask: (ex, w) => `${nameOf(ex, w.who[0])}'s family has been hiding food while the others went without.`,
    options: ['Make them share it', 'Let them keep it'],
  },
  voice: {
    ask: (ex, w) => `${nameOf(ex, w.who[0])} says the spear speaks to them at night, and that it wants one of them dead. Some are starting to listen.`,
    options: ['Silence them', 'Cast them out', 'Let them speak'],
  },
  offering: {
    ask: (ex, w) => `${nameOf(ex, w.who[0])} wants to lay food at the spear's foot, so it will keep watching over them. There's little enough to eat.`,
    options: ['Accept the offering', 'Refuse it'],
  },
  challenge: {
    ask: (ex, w) => `${nameOf(ex, w.who[0])} says ${nameOf(ex, w.who[1])} has led them wrong, and should lead no more.`,
    options: [`Stand by the leader`, 'Back the challenger'],
  },
  who: {
    ask: () => 'The raft will hold four. They have argued for three nights about who should go. In the end they agree: let the spear say what kind of four.',
    options: ['The strongest', 'The youngest', 'A family'],
  },
};

/** At dawn: perhaps something for the spear to decide today. */
export function planWhisper(ex: ExtinctionState): void {
  if (ex.whisper || ex.day < 3 || ex.people.length < 4) return;
  // Who goes on the raft: asked once, when it's nearly built.
  const raftWork = (ex.raft?.frame ?? 0) + (ex.raft?.lashing ?? 0) + (ex.raft?.hull ?? 0);
  if (!ex.sendRule && raftWork >= 50) {
    ex.whisper = { id: 'who', who: [], day: ex.day };
    return;
  }
  if (ex.day - (ex.lastWhisper ?? -99) < 3 || roll(ex) > 0.45) return;
  const pick = (f: (p: Survivor) => boolean) => {
    const pool = ex.people.filter(f);
    return pool.length ? pool[Math.floor(roll(ex) * pool.length)] : null;
  };
  const options: [WhisperId, Survivor | null, Survivor | null][] = [
    ['thief', pick((p) => p.quirk === 'greedy' || p.hunger >= 1.5), null],
    ['sick', pick((p) => p.hunger >= 1 && p.trait !== 'young'), null],
    ['hoard', pick((p) => (p.bonds ?? []).some((b) => b.kind === 'child' || b.kind === 'parent')), null],
    ['offering', pick((p) => p.quirk === 'devout'), null],
    ['challenge', pick((p) => p.id !== ex.leader && (p.quirk === 'quarrelsome' || p.quirk === 'brave' || p.quirk === 'bitter')), ex.people.find((p) => p.id === ex.leader) ?? null],
  ];
  if ((ex.madness ?? 0) > 30) options.push(['voice', pick((p) => p.quirk !== 'steady'), null]);
  const ok = options.filter(([id, a, b]) => a && (id !== 'challenge' || b));
  if (!ok.length) return;
  const [id, a, b] = ok[Math.floor(roll(ex) * ok.length)];
  ex.whisper = { id, who: [a!.id, ...(b ? [b.id] : [])], day: ex.day };
  ex.lastWhisper = ex.day;
}

function castOut(ex: ExtinctionState, p: Survivor, why: string): void {
  ex.people = ex.people.filter((q) => q !== p);
  ex.deaths += 1;
  for (const q of ex.people) q.bonds = (q.bonds ?? []).filter((b) => b.id !== p.id);
  say(ex, why);
}

/** The spear's answer. */
export function answerWhisper(ex: ExtinctionState, option: number): void {
  const w = ex.whisper;
  if (!w) return;
  ex.whisper = undefined;
  const a = byId(ex, w.who[0]);
  const b = w.who[1] !== undefined ? byId(ex, w.who[1]) : undefined;
  const lead = ex.people.find((p) => p.id === ex.leader)?.name ?? 'the one they followed';
  const hope = (n: number) => {
    for (const p of ex.people) p.hunger = Math.max(0, p.hunger - n * 0.02);
  };
  switch (w.id) {
    case 'thief':
      if (!a) break;
      if (option === 0) {
        remember(ex, a, 'was caught stealing, and spared');
        a.quirk = a.quirk === 'greedy' ? 'steady' : a.quirk;
        ex.madness = Math.max(0, (ex.madness ?? 0) - 3);
        say(ex, `${a.name} was caught at the stores. The spear said spare them. ${a.name} wept, and didn't steal again.`);
      } else if (option === 1) castOut(ex, a, `${a.name} was caught at the stores. On the spear's word, ${lead} drove them out into the ash. No one saw them again.`);
      else {
        remember(ex, a, 'was put to the raft for stealing');
        a.job = 'build';
        a.hurt = 2;
        say(ex, `${a.name} was caught at the stores, and put to the raft from dawn to dark until it was paid back.`);
      }
      break;
    case 'sick':
      if (!a) break;
      if (option === 0) {
        remember(ex, a, 'was kept close when sick');
        ex.dread = Math.max(0, (ex.dread ?? 0) - 3);
        if (roll(ex) < 0.4) {
          const b2 = ex.people.find((p) => p !== a && p.sick === undefined);
          if (b2) {
            b2.hunger += 0.6;
            say(ex, `They kept ${a.name} close, as the spear said. ${b2.name} sat with them, and caught the fever too.`);
            break;
          }
        }
        a.hunger = Math.max(0, a.hunger - 0.4);
        say(ex, `They kept ${a.name} close, as the spear said. The fever broke in three days.`);
      } else {
        remember(ex, a, 'was sent away from the camp, sick');
        a.hunger += 0.8;
        a.grief = 3;
        say(ex, `${a.name} was sent away from the camp with the fever. They sat alone on the ash, and the others didn't look.`);
      }
      break;
    case 'hoard':
      if (!a) break;
      if (option === 0) {
        ex.plants += 6;
        ex.meat += 4;
        a.grief = 2;
        say(ex, `${a.name}'s family had been hiding food. The spear said share it, and it was shared. ${a.name} never forgave ${lead}.`);
      } else {
        a.hunger = Math.max(0, a.hunger - 0.6);
        ex.madness = (ex.madness ?? 0) + 4;
        say(ex, `${a.name}'s family kept what they'd hidden. The others knew. Something went sour in the camp.`);
      }
      break;
    case 'voice':
      if (!a) break;
      if (option === 0) {
        remember(ex, a, 'was silenced for saying the spear wanted blood');
        a.broken = true;
        ex.madness = Math.max(0, (ex.madness ?? 0) - 6);
        say(ex, `${a.name} said the spear wanted blood. ${lead} held them down until they stopped saying it.`);
      } else if (option === 1) {
        castOut(ex, a, `${a.name} said the spear wanted blood. They were driven out. For nights after, they could be heard out on the ash, still saying it.`);
        ex.madness = Math.max(0, (ex.madness ?? 0) - 3);
      } else {
        ex.madness = (ex.madness ?? 0) + 10;
        ex.prayer = (ex.prayer ?? 0) + 4;
        ex.dread = Math.min(100, (ex.dread ?? 0) + 8);
        say(ex, `${a.name} was let speak. They said the spear wanted blood. By the fire that night, more of them were nodding.`);
      }
      break;
    case 'offering':
      if (option === 0) {
        const took = Math.min(8, ex.meat + ex.plants);
        const m = Math.min(ex.meat, took);
        ex.meat -= m;
        ex.plants = Math.max(0, ex.plants - (took - m));
        ex.prayer = Math.min(40, (ex.prayer ?? 0) + 8);
        say(ex, `They laid food at the spear's foot and knelt there until dark. They prayed harder for it.`);
      } else {
        ex.prayer = Math.max(0, (ex.prayer ?? 0) - 2);
        hope(5);
        say(ex, `${a?.name ?? 'One of them'} wanted to give the spear food. The spear wanted none. They ate it themselves.`);
      }
      break;
    case 'challenge':
      if (!a) break;
      if (option === 0) {
        remember(ex, a, `challenged ${b?.name ?? 'the leader'}, and lost`);
        a.hurt = 2;
        say(ex, `${a.name} challenged ${b?.name ?? 'the leader'}. The spear stood by ${b?.name ?? 'them'}, and ${a.name} sat apart after.`);
      } else {
        ex.leader = a.id;
        if (b) remember(ex, b, `was brought down by ${a.name}`);
        remember(ex, a, 'became the one they follow');
        ex.madness = (ex.madness ?? 0) + 3;
        say(ex, `${a.name} challenged ${b?.name ?? 'the leader'}, and the spear backed them. The others follow ${a.name} now.`);
      }
      break;
    case 'who': {
      ex.sendRule = (['strong', 'young', 'family'] as SendRule[])[option] ?? 'family';
      say(ex, ex.sendRule === 'family'
        ? '“Send a family. Let what we are go on, even if we can\'t.” The spear agreed. A family would go.'
        : ex.sendRule === 'young'
          ? '“Send the young. They have the most life left in them.” The spear agreed. The youngest would go.'
          : '“Send the strong. The sea will take the weak.” The spear agreed. The strongest would go.');
      break;
    }
  }
}

/** The four who go, by what the spear said (the healthiest, if it never said). */
export function chooseFour(ex: ExtinctionState): number[] {
  const well = (p: Survivor) => (p.sick !== undefined ? -10 : 0) - p.hunger;
  const ranked = (score: (p: Survivor) => number) => [...ex.people].sort((a, b) => score(b) - score(a)).slice(0, 4).map((p) => p.id);
  if (ex.sendRule === 'young') return ranked((p) => well(p) + (p.trait === 'young' ? 3 : p.trait === 'old' ? -3 : 0));
  if (ex.sendRule === 'strong') return ranked((p) => well(p) + (p.trait === 'strong' || p.trait === 'hardy' ? 3 : p.trait === 'frail' || p.trait === 'old' ? -2 : 0));
  // A family: a pair of mates and their children, as many as fit (the best such family);
  // others to make up four.
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const p of ex.people) {
    const mate = (p.bonds ?? []).find((b) => b.kind === 'mate' && byId(ex, b.id));
    if (!mate) continue;
    const kids = (p.bonds ?? []).filter((b) => b.kind === 'parent' && byId(ex, b.id)).map((b) => b.id);
    const fam = [p.id, mate.id, ...kids].slice(0, 4);
    const sc = fam.length * 3 + fam.reduce((s, id) => s + well(byId(ex, id)!), 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = fam;
    }
  }
  const rest = [...ex.people].filter((p) => !best.includes(p.id)).sort((a, b) => well(b) - well(a));
  while (best.length < 4 && rest.length) best.push(rest.shift()!.id);
  return best;
}

/** Each night on the spear's island works on them (more under its dread; hope and a fire hold
 * it off); what it does shows, in stages. */
export function madnessNight(ex: ExtinctionState, fire: boolean, hope: number): void {
  if (ex.day < 10) return;
  const m0 = ex.madness ?? 0;
  const m = Math.max(0, Math.min(100, m0 + 1.2 + (ex.dread ?? 0) / 40 - (hope >= 60 ? 1 : 0) - (fire ? 0.5 : 0)));
  ex.madness = m;
  const crossed = (k: number) => m0 < k && m >= k;
  const any = () => ex.people[Math.floor(roll(ex) * ex.people.length)];
  if (crossed(15) && ex.people.length) say(ex, `${any().name} said the spear hums at night, in a voice. The others laughed. Not all of them.`);
  if (crossed(35) && ex.people.length) say(ex, 'Quarrels over nothing now: who sleeps nearest the fire, who looked at whom. “This island is doing it to us,” someone said.');
  if (crossed(55) && ex.people.length) say(ex, '“If we stay any longer we\'ll go mad.” No one argued any more.');
  // At its worst, they kill each other over nothing (food or no food).
  if (m >= 60 && ex.people.length > 4 && roll(ex) < (m - 50) / 200) {
    const a = any();
    const b = ex.people.filter((p) => p !== a)[Math.floor(roll(ex) * (ex.people.length - 1))];
    if (a && b) {
      ex.people = ex.people.filter((p) => p !== b);
      ex.deaths += 1;
      for (const q of ex.people) q.bonds = (q.bonds ?? []).filter((x) => x.id !== b.id);
      remember(ex, a, `killed ${b.name}`);
      say(ex, `${a.name} killed ${b.name} in the night. Asked why, they couldn't say.`);
    }
  }
}

/** What became of those left on the ash, for the Chronicle (after the raft is gone). */
export function leftBehind(ex: ExtinctionState, family: string[]): string[] {
  const left = ex.people.filter((p) => !family.includes(p.name));
  if (!left.length) return [];
  const names = left.slice(0, 3).map((p) => p.name);
  const last = left[left.length - 1].name;
  return [
    `On the ash, ${left.length} watched the raft until it was gone.`,
    `Without the four, the quarrels came quicker. ${names[0] ?? 'Someone'} was the first to be killed, by someone they'd shared a fire with.`,
    'The fires went out one by one. No one would sit with anyone.',
    `${last} was the last. They stood at the spear's foot a long time, then walked into the sea.`,
  ];
}
