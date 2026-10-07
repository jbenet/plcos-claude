/**
 * A park carries a date to look again (the critic's fourth round, W5 1.6): every strategy whose next
 * step parks the LP with no date gets `next.lookAgain` by rule, recorded in `made.revised`. The
 * strategy's `made.at` stays — a rule's addition is not a new reading, and a colleague's pin on it
 * stays valid. The dates are guesses, for a person to change freely.
 *
 * `--lapsed` looks again at parks whose date has passed (7 Oct 2026: most were dated 28 Sep to 5 Oct, and
 * the checker counted 1,502 steps overdue). A park waits on nothing a person owes, so when nothing new has
 * come in, the look-again is the rule's next date. `--skip <file>` names keys to leave alone (the stale
 * list: something new did come in, and those are rewritten instead). Steps that are not parks stay overdue.
 *
 *   DATA_PROFILE=real npx tsx scripts/enrich-look-again.ts [--lapsed [--skip <keys file>]]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/deployment';
import { lapsedPark, parksWithoutDate, type Strategy } from '../lib/enrich/strategy';
import { readStrategyFiles } from '../lib/enrich/strategy-files';

// GUESS — the 2027 list looks again when the new year's pipeline starts, "not now" a quarter later,
// and a "this year" park (there should be none) a month from now. Nobody has decided these.
const LOOK_AGAIN: Record<Strategy['list'], string> = { 'this year': 'Mon 2 Nov 2026', '2027': 'Mon 4 Jan 2027', 'not now': 'Mon 5 Apr 2027' };

async function main() {
  const args = process.argv.slice(2);
  const lapsed = args.includes('--lapsed');
  const skipFile = args.includes('--skip') ? args[args.indexOf('--skip') + 1] : null;
  const skip = new Set(skipFile ? (await readFile(skipFile, 'utf8')).split('\n').map((x) => x.trim()).filter(Boolean) : []);
  const dir = join(process.cwd(), config.data.root, 'enrich');
  const now = new Date().toISOString();
  const today = new Date(now.slice(0, 10));
  let set = 0, skipped = 0;
  for (const { file, s } of await readStrategyFiles(dir, () => {})) {
    const date = LOOK_AGAIN[s.list] ?? LOOK_AGAIN['2027'];
    if (lapsed) {
      if (!lapsedPark(s, today)) continue;
      if (skip.has(s.key)) { skipped++; continue; }
      const was = s.next.lookAgain ?? s.next.when ?? '';
      s.next.lookAgain = date;
      s.next.when = date;
      s.made.revised = [...(s.made.revised ?? []), { at: now, by: 'rule (scripts/enrich-look-again.ts --lapsed)', rule: `A park's date passed (${was}) with nothing new on the LP: look again ${date}, set by rule — a guess for a person to change.` }];
    } else {
      if (!parksWithoutDate(s)) continue;
      s.next.lookAgain = /search pass/i.test(s.next.what) ? `${date}, or when the search pass reads them, whichever is first` : date;
      s.made.revised = [...(s.made.revised ?? []), { at: now, by: 'rule (scripts/enrich-look-again.ts)', rule: `A park carries a date to look again (the critic, round four): ${date}, set by rule — a guess for a person to change.` }];
    }
    await writeFile(join(dir, 'strategy', file), JSON.stringify(s, null, 2));
    set++;
  }
  if (lapsed) console.log(`look again: ${set} lapsed ${set === 1 ? 'park' : 'parks'} re-dated by rule · ${skipped} skipped (stale, for a rewrite)`);
  else console.log(`look again: ${set} parked ${set === 1 ? 'strategy' : 'strategies'} given a date by rule`);
}

main();
