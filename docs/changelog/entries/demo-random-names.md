## Demo — generated names instead of real ones

Juan, 29 Sep 2026: demo screenshots must avoid real names — "generate random names". The demo
seed carried a few real people and firms alongside invented ones, and several invented firm names
("<word> Capital") match real firms. Every person and firm in the demo seed now has a generated
name.

- **The generator** is `lib/demo-names.ts`: seeded (mulberry32 from an FNV-1a hash of the seed), so
  the same seed gives the same names on every machine and every reset. People are a given name and
  a family name from mixed-origin lists, drawn to agree with the pronouns the seed's prose uses;
  firms are two uncommon words and a kind ("Capital", "Partners", "Family Office", "Foundation",
  "Ventures"); companies are two words and a trade. The names were drawn once and written into the
  seed, so seeding never depends on the generator's order.
- **What changed:** 35 people (26 LPs, connectors and Affinity contacts; 9 team display names,
  including the Linear aliases) and 38 firms and companies, with their entity keys, e-mail
  addresses, domains and slugs, across `fixtures/`, `lib/seed*.ts`, the compliance page's worked
  example and `scripts/shots.ts`. Names were replaced word for word, so the seed keeps its
  structure, counts, amounts, relationships and edge cases: a principal still shares a family
  name with their office, the accent-folding pair (an accented and an unaccented spelling of one
  name) is still a pair, the one-letter-apart family names are still one letter apart, and two
  firms that share a first word still do. Team initials follow the new names.
- **What stayed:** the vehicles (PLC Neurotech I, PLC Crypto/Rails, the SPVs, the grants rail), the
  demo's own firm (Demo Capital Partners, PL Capital), Protocol Labs (the PL network rule reads
  it), tool names, and the team's login handles, which the user switcher needs.
- **A check keeps them out.** `npm run boundaries` fails if a name the demo seed used to carry comes
  back into `fixtures/`, `lib/seed*.ts` or the generator (`scripts/demo-names-check.ts`). It keeps
  only salted SHA-256 hashes — 33 full names, 38 firm names and 35 distinctive single words — never
  the names themselves; it reads JSON `\u` escapes, and a lower-case team handle is let through.
  Run against the old seed it finds 1,220 occurrences in 43 files; against this one, none.
- **Properties:** three new ones (the generator is deterministic; the team's names come from its
  lists and the initials follow; the check finds a planted invented name spelled across spaces,
  "&" and an escape). Properties that named demo LPs now name the new ones; one that took the
  alphabetically first LP now picks its LP by name, since renaming changed the order.

`npm run props` (1,389 of 1,389), `npm run boundaries`, `npx tsc --noEmit` and `npm run e2e` (15 of
15) pass. The changelog's existing screenshots were not retaken and still show the former demo
names; new ones will show the generated names. Some developer pages still cite decisions as
"Juan's rule"; those are product notes, not demo data, and were left alone.
