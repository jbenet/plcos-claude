import { currentUser } from '@/lib/auth';
import * as raw from '@/modules/identity';
import { redactAffiliations } from './r3';
export * from '@/modules/identity';
export async function affiliationsFor(...args: Parameters<typeof raw.affiliationsFor>) { return redactAffiliations(await currentUser(), await raw.affiliationsFor(...args)); }
export async function peopleAt(...args: Parameters<typeof raw.peopleAt>) { return redactAffiliations(await currentUser(), await raw.peopleAt(...args)); }
export async function orgsFor(...args: Parameters<typeof raw.orgsFor>) { return redactAffiliations(await currentUser(), await raw.orgsFor(...args)); }
export async function listAffiliations(...args: Parameters<typeof raw.listAffiliations>) { return redactAffiliations(await currentUser(), await raw.listAffiliations(...args)); }
