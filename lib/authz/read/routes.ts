import { currentUser } from '@/lib/auth';
import { routeInputs as raw } from '@/lib/routes-data';
import { licensedAccess, redactAffiliations } from './r3';
export * from '@/lib/routes-data';
export async function routeInputs(...args: Parameters<typeof raw>) {
  const [user, data] = await Promise.all([currentUser(), raw(...args)]);
  if (licensedAccess(user)) return data;
  return { ...data, affiliations: redactAffiliations(user, data.affiliations),
    rows: data.rows.map(row => ({ ...row, related: [], signals: [] })) };
}
