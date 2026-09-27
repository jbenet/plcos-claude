import { coalescePage } from '@/lib/page-render';
import { redirect } from 'next/navigation';
import { vehicleSelection } from '@/lib/session';

/** Fit lives under the vehicle now, because a fit reading is only ever about one. */
async function FitRedirect() {
  const { current } = await vehicleSelection();
  redirect(`/${current?.slug ?? 'all'}/fit`);
}

export default coalescePage('/fit', FitRedirect);
