import { redirect } from 'next/navigation';
import { config } from '@/config/deployment';
import { currentUser } from '@/lib/auth';
import { MutationGuardError } from '@/lib/mutation-policy';

export default async function Home() {
  // The layout renders the sign-in message; don't race it with a redirect to Today.
  if (config.auth.provider === 'labos') {
    try { await currentUser(); }
    catch (error) { if (error instanceof MutationGuardError) return null; throw error; }
  }
  redirect('/today');
}
