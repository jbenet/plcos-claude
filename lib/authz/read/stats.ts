import { currentUser } from '@/lib/auth';
import { lpStatsData as raw } from '@/lib/lp-stats/data';
import { redactStats } from './r3';
export * from '@/lib/lp-stats/data';
export async function lpStatsData(...args: Parameters<typeof raw>) { return redactStats(await currentUser(), await raw(...args)); }
