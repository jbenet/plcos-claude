import { config } from '@/config/deployment';

/**
 * Where an Admin may add a vehicle from the app: a server with sign-in (Google, LabOS), or the demo's
 * invented data. Under the Mac's user switcher on real data anyone on the network could pick an admin,
 * and the vehicles there come from data/real/init.jsonc, so the form is read-only (as Settings → People is).
 */
export function vehiclesWritable(): string | null {
  if (config.auth.provider === 'google' || config.auth.provider === 'labos') return null;
  if (config.data.profile === 'demo') return null;
  return 'On this server vehicles come from data/real/init.jsonc: it uses the user switcher, so anyone on the network could pick an admin. Add a vehicle on the deployed server, where people sign in.';
}
