import { redirect } from 'next/navigation';

/**
 * The dossier moved to /orgs/<id>, which is the entity's home page rather than one
 * module's view of them. The old URL is kept because links to it exist in earlier
 * changelog entries and in issues filed against it.
 */
export default async function MovedDossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/orgs/${id}`);
}
