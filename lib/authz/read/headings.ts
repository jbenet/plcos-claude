import { currentUser } from '@/lib/auth';
import * as raw from '@/lib/lp-heading';
import { licensedAccess } from './r3';
export * from '@/lib/lp-heading';
export async function lpHeadings(...args: Parameters<typeof raw.lpHeadings>) {
  if (licensedAccess(await currentUser())) return raw.lpHeadings(...args);
  return new Map(args[0].map(row => [row.pursuitId, { org: null, orgId: null, orgFirst: false }]));
}
export async function relatedLpHeadings(...args: Parameters<typeof raw.relatedLpHeadings>) {
  return licensedAccess(await currentUser()) ? raw.relatedLpHeadings(...args) : [];
}
