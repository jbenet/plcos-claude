import { redirect } from 'next/navigation';

/**
 * Everything, across PL Capital **and** PL R&D (issue 0013).
 *
 * The vehicle-scoped page at `/all/visualizations` covers the capital vehicles; this one
 * covers every vehicle on file, the grants rail included. They were the same URL in two
 * places in the rail, which made one of them a lie.
 */
export default function Everything() {
  redirect('/everything/visualizations');
}
