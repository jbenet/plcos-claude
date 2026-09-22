import { config } from '@/config/deployment';

/**
 * The Affinity key, read from the environment here and nowhere else — the boundary check
 * fails the build if anything outside this folder names the variable.
 *
 * `npm run dev:real` puts it there from 1Password (scripts/with-affinity-key.sh). Nothing
 * writes it to disk, and the demo profile never sees it, even when the shell has it set.
 */
export function affinityKey(): string | null {
  if (config.data.profile !== 'real') return null;
  const key = process.env.AFFINITY_API_KEY?.trim();
  return key ? key : null;
}
