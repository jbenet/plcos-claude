import { redirect } from 'next/navigation';

/** The section became "Orgs & people", because that is what is in it. */
export default async function MovedRelationships({
  params,
}: {
  params: Promise<{ group: string }>;
}) {
  const { group } = await params;
  redirect(`/orgs/g/${group === 'all' ? 'all' : group}`);
}
