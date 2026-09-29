/** Fixture-only writers deliberately construct pre-resolver states (duplicates, redirects).
 * Production code and operational scripts have exactly one entity insertion entrance.
 */
const fixtureWriters = new Set([
  'scripts/identity-review-repeat.ts','scripts/profile-import-threads.ts','scripts/lp-units-demo.ts',
  'scripts/identity-export-perf.ts','scripts/research-export-perf.ts','scripts/network-perf.ts','scripts/responsiveness.ts',
  'scripts/viewer-speed-bench.ts','scripts/perf4-fixture.ts','scripts/findings-perf.ts',
]);
export function directEntityInsertViolation(path:string,text:string):boolean {
  if(path==='modules/identity/create.ts')return false;
  if(path.startsWith('scripts/properties/') || /^scripts\/[^/]+-properties\.ts$/.test(path) || fixtureWriters.has(path))return false;
  // Comments between SQL words and quoted schema/table names cannot bypass the guard.
  const sql=text.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ');
  return /\binsert\s+into\s+(?:"identity"|identity)\s*\.\s*(?:"entity"|entity\b)/i.test(sql);
}
