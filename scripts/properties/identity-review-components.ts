import { foldIdentityReviewComponents } from '../../lib/enrich/identity-review-components';
import type { ImportDuplicateReport } from '../../lib/enrich/import-dupes';
import type { Check } from './harness';

type Group = ImportDuplicateReport['ambiguous'][number];
const reason = 'creation name-only match requires identity review';
// Frozen prior algorithm, bounded to small generated cases for semantic comparison.
function prior(groups: Group[], pairs: Array<{a:string;b:string;name:string}>): Group[] {
  let result = structuredClone(groups);
  for (const pair of pairs) {
    const ids = new Set([pair.a, pair.b]), reasons = new Set([reason]);
    let changed = true;
    while (changed) {
      changed = false;
      result = result.filter(g => {
        if (!g.entityIds.some(id => ids.has(id))) return true;
        for (const id of g.entityIds) ids.add(id);
        reasons.add(g.reason); changed = true; return false;
      });
    }
    result.push({name:pair.name, entityIds:[...ids].sort(), reason:[...reasons].join('; ')});
  }
  return result;
}
const normalized = (groups: Group[]) => JSON.stringify(groups.map(g => ({...g,
  reason:[...new Set(g.reason.split('; '))].sort().join('; '),
})).sort((a,b)=>a.entityIds.join(':').localeCompare(b.entityIds.join(':'))));
export function identityReviewComponentProperties(check: Check) {
  let same = true;
  for (let seed = 1; seed <= 100; seed++) {
    let state = seed;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const groups = Array.from({length:8}, (_,i) => ({name:`Group ${i}`, entityIds:[String(next()%24),String(next()%24)],reason:`reason ${i%3}`}));
    const pairs = Array.from({length:20}, (_,i) => ({a:String(next()%24),b:String(next()%24),name:`Pair ${i}`}));
    same &&= normalized(foldIdentityReviewComponents(groups,pairs)) === normalized(prior(groups,pairs));
  }
  check('EXPORT union-find preserves transitive group membership, names and reason sets',same,
    '100 invented graphs compare to the prior fold, including bridges, cycles, repeated edges and overlapping groups.');
  const pairs = Array.from({length:63000},(_,i)=>({a:`${i%1900}:a`,b:`${i%1900}:b`,name:`Group ${i%1900}`}));
  const start = performance.now(), result = foldIdentityReviewComponents([],pairs);
  check('EXPORT dense queued pairs keep bounded reasons',result.length===1900 && result.every(g=>g.reason===reason)
    && performance.now()-start < 5000,'63,000 edges produce 1,900 components without accumulating repeated reason text.');
}
