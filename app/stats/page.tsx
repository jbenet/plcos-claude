import { redirect } from 'next/navigation';

/** LP stats across every vehicle lives at /all/stats, beside each vehicle's /<vehicle>/stats; this keeps its filters. */
export default async function StatsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v ? [v] : []) q.append(k, x);
  const query = q.toString();
  redirect(`/all/stats${query ? `?${query}` : ''}`);
}
