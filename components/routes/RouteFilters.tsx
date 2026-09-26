'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function RouteFilters({ intermediates }: { intermediates: Array<{ id: string; name: string }> }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const go = (key: string, value: string) => {
    const query = new URLSearchParams(params.toString());
    if (value) query.set(key, value); else query.delete(key);
    for (const k of ['r', 'page', 'family', 'show']) query.delete(k);
    start(() => router.replace(`${path}?${query}`, { scroll: false }));
  };
  return <div className="route-filters" aria-busy={pending}>
    <label>Exclude intermediate<select value={params.get('exclude') ?? ''} onChange={(e) => go('exclude', e.target.value)}><option value="">Nobody excluded</option>{intermediates.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
    <label>Prioritise relationship<select value={params.get('prefer') ?? ''} onChange={(e) => go('prefer', e.target.value)}>
      <option value="">Overall strength</option><option value="coinvestor">Co-investors</option><option value="our_investor">Our investors</option><option value="existing_lp">Existing LPs</option><option value="cofounder">Co-founders</option><option value="family">Family</option><option value="friend">Close friends</option>
    </select></label>
    <label>Last-hop warmth<select value={params.get('warmth') ?? ''} onChange={(e) => go('warmth', e.target.value)}><option value="">Any warmth</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>At least {n}/5</option>)}</select></label>
    <label className="route-alternatives"><input type="checkbox" checked={params.get('expanded') === '1'} onChange={(e) => go('expanded', e.target.checked ? '1' : '')} /> Include alternatives</label>
    {pending && <span role="status">Updating routes…</span>}
  </div>;
}
