import { redirect } from 'next/navigation';

/** It belongs with the people it is about, not with the corpus it reads. */
export default function MovedEnrichment() {
  redirect('/orgs/enrichment');
}
