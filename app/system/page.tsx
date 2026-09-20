import { redirect } from 'next/navigation';

/** System & seams split into Developer → Status and Developer → Connectors. */
export default function System() {
  redirect('/dev/status');
}
