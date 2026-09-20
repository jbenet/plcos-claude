import { redirect } from 'next/navigation';
import { vehicleSelection } from '@/lib/session';

/** Kept because earlier changelog entries and filed issues link to it. */
export default async function FitEntityRedirect({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const { current } = await vehicleSelection();
  redirect(`/${current?.slug ?? 'all'}/fit/${entityId}`);
}
