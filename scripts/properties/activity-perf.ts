import type { Check } from './harness';
import { measureActivityPerformance } from '../activity-perf';

/** Scale fixture is generated once and always removed, including after failures. */
export async function activityPerfProperties(check: Check) {
  const result = await measureActivityPerformance();
  for (const assertion of result.assertions) check(`ACTIVITY PERF ${assertion.name}`, assertion.ok, assertion.detail);
}
