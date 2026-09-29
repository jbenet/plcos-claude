/**
 * Invented names for the demo seed (29 Sep 2026: "demo screenshots must avoid real names —
 * generate random names").
 *
 * A seeded generator, so the same seed gives the same names on every machine and every reset:
 * people are a first name and a family name drawn from lists of mixed origin, so a pairing reads
 * as plausible and is unlikely to be anyone; firms are two uncommon words and a kind ("Capital",
 * "Partners", "Family Office", "Foundation", "Ventures"); companies are two words and a trade.
 *
 * The demo seed's names (fixtures/, lib/seed*.ts) were drawn from `demoNames(DEMO_NAME_SEED)` and
 * written in, so reading the seed never depends on this file. A new demo person or firm takes its
 * name from here too; `npm run boundaries` refuses the real names the seed once carried, and the
 * properties check the generator stays deterministic and the team's names come from its lists.
 */

export const DEMO_NAME_SEED = 'plcos-demo-2026-09-29';

/**
 * Given names, mixed origin, in two lists so a name agrees with the pronouns the seed's prose uses
 * for that person. Two carry accents because the seed tests accent-folding matches.
 */
export const FIRST_NAMES_F = [
  'Adaeze', 'Anaïs', 'Bettina', 'Cosima', 'Dagny', 'Elif', 'Esperanza', 'Fenna', 'Folake', 'Greer',
  'Hana', 'Ilse', 'Imogen', 'Ingrid', 'Jovana', 'Kalinda', 'Keziah', 'Leocadia', 'Linnea', 'Marit',
  'Mirela', 'Nkechi', 'Oona', 'Orla', 'Paloma', 'Perpetua', 'Renata', 'Saoirse', 'Solveig', 'Tamar',
  'Thandiwe', 'Ulla', 'Vesna', 'Xiomara', 'Zofia', 'Zoé',
] as const;
export const FIRST_NAMES_M = [
  'Anselm', 'Aurelio', 'Bram', 'Caio', 'Dmitri', 'Eero', 'Emeka', 'Fiachra', 'Ismo', 'Joaquín',
  'Kofi', 'Lior', 'Lucan', 'Mattias', 'Nuno', 'Otso', 'Quentin', 'Radek', 'Rafferty', 'Sefa',
  'Soren', 'Teodor', 'Wendel', 'Yaw',
] as const;
export const FIRST_NAMES = [...FIRST_NAMES_F, ...FIRST_NAMES_M] as const;

/** Family names, mixed origin, paired with a given name at random. */
export const LAST_NAMES = [
  'Achterberg', 'Albescu', 'Bakshi', 'Barrowcliff', 'Castellane', 'Dahlquist', 'Ekwueme', 'Falkenrath',
  'Grimaldo', 'Hallorann', 'Ivanišević', 'Jaramillo', 'Kasprzak', 'Kettleborough', 'Lindgaard', 'Marchetti',
  'Mbatha', 'Nakashima', 'Oyelaran', 'Pellegrino', 'Quaresma', 'Rautio', 'Szabó', 'Tamburini',
  'Umeadi', 'Valdivieso', 'Wennerholm', 'Xanthakis', 'Yilmazer', 'Zeferino', 'Brankovic', 'Corcoran',
  'Delahunt', 'Eskildsen', 'Fontaine', 'Gyasi', 'Holmqvist', 'Iwasaki', 'Järvinen', 'Kowalczyk',
  'Lachapelle', 'Moravec', 'Nwachukwu', 'Ferrante-Obuya', 'Petrescu', 'Rasmussen-Oda', 'Sandoval', 'Thorsby',
] as const;

/** Uncommon words for firm names; two together are unlikely to name a real firm. */
export const FIRM_WORDS = [
  'Larkspur', 'Oxbow', 'Tidemoor', 'Quillmere', 'Fernhollow', 'Saltmarsh', 'Gannet', 'Wrenfield',
  'Copperbeck', 'Moorlark', 'Thistlecombe', 'Flintmoss', 'Hollowmere', 'Kittiwake', 'Loamrise', 'Nettlebed',
  'Orrery', 'Petrel', 'Rookwood', 'Sedgewater', 'Tansy', 'Umberfield', 'Vellum', 'Whinmoor',
  'Yarrow', 'Zephyrine', 'Amberlith', 'Bramblegate', 'Cindervale', 'Dunlin', 'Eelgrass', 'Foxglove',
  'Gorsebrook', 'Heronsway', 'Ironwort', 'Jackdaw', 'Knapweed', 'Lanternfell', 'Mistlethwaite', 'Nightjar',
  'Ospreyfold', 'Pipistrel', 'Quartzmere', 'Redshank', 'Samphire', 'Teasel', 'Underhollow', 'Vetchling',
  'Wagtail', 'Yellowhammer', 'Alderwick', 'Bittern', 'Coltsfoot', 'Dogrose', 'Emberly', 'Fieldfare',
  'Greylag', 'Hawkweed', 'Inglenook', 'Juncus', 'Kestrelmoor', 'Lapwing', 'Meadowsweet', 'Nuthatch',
] as const;

export const FIRM_KINDS = ['Capital', 'Partners', 'Family Office', 'Foundation', 'Ventures'] as const;
export const COMPANY_TRADES = ['Robotics', 'Science', 'Neuro', 'Engineering', 'Institute', 'Labs'] as const;

/** FNV-1a over the seed's UTF-16 units: a 32-bit start for the generator. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** mulberry32: small, fast and the same on every platform. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoNames {
  /** A given name not drawn before from this generator (the lists repeat once exhausted);
   *  'f' or 'm' draws from one list, to agree with the pronouns the prose uses. */
  first(kind?: 'f' | 'm'): string;
  /** A family name not drawn before from this generator. */
  last(): string;
  /** "First Last". */
  person(kind?: 'f' | 'm'): string;
  /** Two firm words, not drawn before: "Kittiwake Loamrise". */
  stem(): string;
  /** "<Word> <Word> <Kind>"; the kind is drawn unless given. */
  firm(kind?: (typeof FIRM_KINDS)[number]): string;
  /** "<Word> <Word> <Trade>". */
  company(): string;
}

/** A deterministic generator: the same seed yields the same names in the same order. */
export function demoNames(seed: string = DEMO_NAME_SEED): DemoNames {
  const rand = mulberry32(hash(seed));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const fresh = (xs: readonly string[], used: Set<string>) => {
    if (xs.every((x) => used.has(x))) for (const x of xs) used.delete(x);
    for (;;) {
      const x = pick(xs);
      if (!used.has(x)) { used.add(x); return x; }
    }
  };
  const firsts = new Set<string>();
  const lasts = new Set<string>();
  const words = new Set<string>();
  const first = (kind?: 'f' | 'm') =>
    fresh(kind === 'f' ? FIRST_NAMES_F : kind === 'm' ? FIRST_NAMES_M : FIRST_NAMES, firsts);
  const last = () => fresh(LAST_NAMES, lasts);
  const stem = () => `${fresh(FIRM_WORDS, words)} ${fresh(FIRM_WORDS, words)}`;
  return {
    first, last, stem,
    person: (kind) => `${first(kind)} ${last()}`,
    firm: (kind) => `${stem()} ${kind ?? pick(FIRM_KINDS)}`,
    company: () => `${stem()} ${pick(COMPANY_TRADES)}`,
  };
}
