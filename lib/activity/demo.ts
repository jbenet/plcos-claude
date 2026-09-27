import { aggregate, sources } from './model';
import type { ActivityData, ActivityPoint, OriginCount } from './types';
/** Invented, deterministic counts. No real fixture or database is consulted. */
export function demoActivity(asOf = new Date().toISOString()): ActivityData {
  const points: ActivityPoint[] = [], origins: OriginCount[] = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(Date.parse(asOf.slice(0, 10)) - d * 86400000).toISOString().slice(0, 10);
    sources.forEach((source, s) => {
      const segments = source === 'affinity' ? ['lists','notes','meetings'] : source === 'dakota' ? ['account','contact'] : source === 'linear' ? ['issues','projects'] : source === 'agents' ? ['W1','W1c'] : [null];
      segments.forEach((segment, n) => {
        const requests = 3 + (d * 7 + s * 3 + n) % 31, estimated = (d + s + n) % 3 === 0;
        points.push({ day, source, segment, requests, bytesIn: requests * 1600, bytesOut: requests * 120, records: requests * 4, estimated, ...(estimated ? { basis: 'Invented demo estimate based on fixture record counts.' } : {}) });
        if (['search','fetch','sec'].includes(source)) origins.push({ day, origin: source === 'sec' ? 'sec.gov' : source === 'search' ? 'search.example.org' : 'pages.example.org', requests, estimated });
      });
    });
  }
  return aggregate(points, origins, asOf);
}
