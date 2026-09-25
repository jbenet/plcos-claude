import { redirect } from 'next/navigation';

/** The section is now called "Network"; its routes stay under /orgs. */
export default async function MovedRelationships({
  params,
}: {
  params: Promise<{ group: string }>;
}) {
  const { group } = await params;
  redirect(`/orgs/g/${group === 'all' ? 'all' : group}`);
}
