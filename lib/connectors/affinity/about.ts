/**
 * What a touchpoint is about: this raise, or something else (N59).
 *
 * Juan, 23 Sep, correcting the first reconciliation: Affinity's mail and calendar sync brings in
 * everything the team has ever exchanged with a person — a meeting in 2024 about research, an
 * email from 2021 about another company — and each was counted as though it were about the
 * fund. His rule for an email: "It should be clear from context. (should have the name of the
 * vehicle, talk about a/the fund or investing, be to/from @[the fundraising domain] addresses, or
 * similar)." Unrelated contact is kept: "email unrelated to the fundraise may still be useful for
 * intelligence gathering."
 *
 * So each record is read once, when it is translated, from what it says itself: an email's
 * subject and addresses, a meeting's title and who was invited, a note's text. In order:
 *
 *   1. It is an automatic reply — out of office and the like: about nothing; it is not a reply.
 *   2. It names a vehicle, by name or alias: about that vehicle's raise.
 *   3. It is a portfolio company's update to its investors: about something else, however much
 *      it says "investor" — the team receives those, it doesn't raise with them.
 *   4. It speaks of a fund, investing, a commitment, the data room, the deck and so on, or names
 *      the firm raising: about a raise, whichever vehicle is raising on its date.
 *   5. It is from, or addressed to, the team's fundraising domain — the sender or a direct
 *      recipient, not someone copied: the same. (N59, after the first pass: an email about something
 *      else counted because someone at the fundraising domain was on copy.)
 *   6. None of these: about something else.
 *
 * The date is not read here. Whether a record falls inside a vehicle's raise window is decided
 * per vehicle, where it is counted (modules/meetings). Every decision keeps its reason, so a
 * wrong one can be traced to the rule that made it, and to every other record the rule touched.
 */

export interface AboutVehicle { slug: string; name: string; aliases: string[] }

export interface About {
  about: 'raise' | 'other';
  /** The vehicles it names. Empty when it speaks of a raise without naming one. */
  vehicles: string[];
  basis: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const word = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(s)}(?![\\p{L}\\p{N}])`, 'iu');

/** Words of a raise. A GUESS at the vocabulary, from reading the team's notes and subjects. */
const RAISE_WORDS = /(?<![\p{L}])(fund|funds|fundrais\w*|LPs?|limited partners?|invest(?:ing|ment|ments|or|ors)?|commitments?|commit|subscriptions?|sub ?docs?|capital calls?|data ?rooms?|pitch decks?|decks?|docsend|allocations?|first close|side letters?|term sheets?|PPM|carried interest|management fees?|soft circle)(?![\p{L}])/iu;

/** An out-of-office or other automatic answer. Not a reply from anyone. */
const AUTO_REPLY = /^\s*(automatic reply|auto(?:matic)?[- ]?(?:reply|response)|autoreply|out of (?:the )?office|ooo\b|abwesenheit|réponse automatique|respuesta automática|risposta automatica)/iu;

/** A company's periodic update to its investors: received, not raised with. */
const PORTFOLIO_UPDATE = /(?<![\p{L}])((investor|monthly|quarterly|annual|weekly|shareholder)\s+(update|letter|report)s?|kpi survey|newsletter|portfolio update)(?![\p{L}])/iu;

export function aboutRaise(
  text: string, direct: Array<string | null | undefined>, vehicles: AboutVehicle[], domains: string[],
  firmNames: string[] = [],
): About {
  const t = text.replace(/\s+/g, ' ').trim();
  if (AUTO_REPLY.test(t)) return { about: 'other', vehicles: [], basis: 'an automatic reply' };
  const named = vehicles.filter((v) => [v.name, ...v.aliases].some((a) => a.trim().length >= 3 && word(a.trim()).test(t)));
  if (named.length) {
    const hit = named.map((v) => [v.name, ...v.aliases].find((a) => word(a).test(t))!);
    return { about: 'raise', vehicles: named.map((v) => v.slug), basis: `names “${hit[0]}”` };
  }
  if (PORTFOLIO_UPDATE.test(t)) {
    return { about: 'other', vehicles: [], basis: `a company's update to its investors (“${PORTFOLIO_UPDATE.exec(t)![0]}”)` };
  }
  const term = RAISE_WORDS.exec(t)?.[0];
  if (term) return { about: 'raise', vehicles: [], basis: `speaks of “${term.toLowerCase()}”` };
  const firm = firmNames.find((f) => f.trim().length >= 2 && word(f.trim()).test(t));
  if (firm) return { about: 'raise', vehicles: [], basis: `names the firm (“${firm}”)` };
  const domain = direct
    .map((a) => (a ?? '').toLowerCase().trim())
    .map((a) => domains.find((d) => a.endsWith(`@${d}`)))
    .find(Boolean);
  if (domain) return { about: 'raise', vehicles: [], basis: 'from or to the fundraising domain, not on copy' };
  return { about: 'other', vehicles: [], basis: t ? 'names no vehicle, no raise, and is not to or from the fundraising domain' : 'says nothing about what it was' };
}

/** A person-shaped address from whatever Affinity put there: a string, or { emailAddress, person }. */
export function addressOf(x: unknown): string | null {
  if (!x) return null;
  if (typeof x === 'string') return x;
  const o = x as { emailAddress?: string | null; person?: { primaryEmailAddress?: string | null } | null };
  return o.emailAddress ?? o.person?.primaryEmailAddress ?? null;
}
