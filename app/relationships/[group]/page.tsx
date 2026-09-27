import { coalescePage } from '@/lib/page-render';
import { redirect } from 'next/navigation';

/** The section is now called "Network"; its routes stay under /orgs. */
async function MovedRelationships({
  params,
}: {
  params: Promise<{ group: string }>;
}) {
  const { group } = await params;
  redirect(`/orgs/g/${group === 'all' ? 'all' : group}`);
}

export default coalescePage('/relationships/[group]', MovedRelationships);
