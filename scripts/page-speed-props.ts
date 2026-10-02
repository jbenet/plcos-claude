/** Run only the page-speed properties: `npx tsx scripts/page-speed-props.ts`. The full suite is `npm run props`. */
import { pageSpeedProperties } from './properties/page-speed';

let failed = 0, passed = 0;
await pageSpeedProperties((name, ok, detail) => {
  if (ok) passed++;
  else { failed++; console.log(`FAIL ${name}\n  ${detail.slice(0, 600)}`); }
});
console.log(`${passed} page-speed properties hold, ${failed} fail`);
process.exit(failed ? 1 : 0);
