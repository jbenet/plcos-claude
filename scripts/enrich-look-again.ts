/**
 * A park carries a date to look again (the critic's fourth round, W5 1.6): every strategy whose next
 * step parks the LP with no date gets `next.lookAgain` by rule, recorded in `made.revised`. The
 * strategy's `made.at` stays — a rule's addition is not a new reading, and a colleague's pin on it
 * stays valid. The dates are guesses, for a person to change freely.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-look-again.ts
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { parksWithoutDate, type Strategy } from '../lib/enrich/strategy';

// GUESS — the 2027 list looks again when the new year's pipeline starts, "not now" a quarter later,
// and a "this year" park (there should be none) a month from now. Nobody has decided these.
const LOOK_AGAIN: Record<Strategy['list'], string> = { 'this year': 'Mon 2 Nov 2026', '2027': 'Mon 4 Jan 2027', 'not now': 'Mon 5 Apr 2027' };

async function main() {
  const dir = join(process.cwd(), config.data.root, 'enrich', 'strategy');
  const now = new Date().toISOString();
  let set = 0;
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(await readFile(join(dir, f), 'utf8')) as Strategy;
    if (!parksWithoutDate(s)) continue;
    const date = LOOK_AGAIN[s.list] ?? LOOK_AGAIN['2027'];
    s.next.lookAgain = /search pass/i.test(s.next.what) ? `${date}, or when the search pass reads them, whichever is first` : date;
    s.made.revised = [...(s.made.revised ?? []), { at: now, by: 'rule (scripts/enrich-look-again.ts)', rule: `A park carries a date to look again (the critic, round four): ${date}, set by rule — a guess for a person to change.` }];
    await writeFile(join(dir, f), JSON.stringify(s, null, 2));
    set++;
  }
  console.log(`look again: ${set} parked ${set === 1 ? 'strategy' : 'strategies'} given a date by rule`);
}

main();
