/**
 * First-run setup (docs/deploy/railway.md §3; MailGuard's integrations.ts). Until Google sign-in is
 * configured nobody can sign in to a deployed server, so nobody could reach Settings. /setup covers that
 * gap: it is open only while the server signs in with Google and the client is not configured, and only
 * with a one-time code printed in the server log at boot (Railway shows it in Deploy Logs). The code lives
 * in this process's memory, is never shown in the app, and is compared in constant time.
 */
import { randomBytes } from 'node:crypto';
import { config } from '@/config/deployment';
import { sameText } from './crypto';
import { googleConfigured, settingValue } from './store';
import { PUBLIC_URL_SETTING } from './registry';

const g = globalThis as typeof globalThis & { __plcosSetupCode?: string; __plcosSetupAnnounced?: boolean };

/** Open while this server signs in with Google and the Google client is not known. Never on the Mac. */
export const setupOpen = (): boolean => config.auth.provider === 'google' && !googleConfigured();

/** The current code, made on first use: three groups of four hex digits (48 bits). */
export function setupCode(): string {
  if (!g.__plcosSetupCode) {
    const raw = randomBytes(6).toString('hex').toUpperCase();
    g.__plcosSetupCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  }
  return g.__plcosSetupCode;
}

/** Spaces and case don't matter; the dashes may be left out. */
export function checkSetupCode(input: unknown): boolean {
  if (typeof input !== 'string' || input.length > 64) return false;
  const typed = input.toUpperCase().replace(/[^0-9A-F]/g, '');
  const want = setupCode().replace(/-/g, '');
  // The length is public (twelve digits); only the digits are compared in constant time.
  return sameText(typed, want);
}

/** After setup, a fresh code, so the old one (seen in the log) is no use. */
export function retireSetupCode() { delete g.__plcosSetupCode; delete g.__plcosSetupAnnounced; }

/** The address Railway gives the service, when it runs there. */
export function platformUrl(env: Record<string, string | undefined> = process.env): string | null {
  const d = env.RAILWAY_PUBLIC_DOMAIN?.trim().toLowerCase();
  return d && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) ? `https://${d}` : null;
}

/** The origin a request came to, from its Host (and the proxy's X-Forwarded-Proto). */
export function requestOrigin(h: Pick<Headers, 'get'> | null | undefined): string | null {
  const host = h?.get('host')?.trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/.test(host)) return null;
  const proto = h?.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return `${proto === 'https' || proto === 'http' ? proto : 'http'}://${host}`;
}

/**
 * Where people reach this app: the setting (or PLCOS_PUBLIC_URL), else Railway's domain, else the address
 * the request came to. Google's redirect URI is built from it.
 */
export function publicUrl(h?: Pick<Headers, 'get'> | null): string {
  return settingValue(PUBLIC_URL_SETTING.key) ?? platformUrl() ?? requestOrigin(h) ?? `http://localhost:${config.data.port ?? 3000}`;
}

/** At boot (instrumentation.ts): once the settings are loaded, print the code if setup is open. */
export async function announceAtBoot(): Promise<void> {
  if (config.auth.provider !== 'google') return;
  const { settingsReady } = await import('./store');
  await settingsReady();
  announceSetup();
}

/** Print the code, once per code, while setup is open. Called at boot and when sign-in is removed. */
export function announceSetup(log: (line: string) => void = console.log): boolean {
  if (!setupOpen() || g.__plcosSetupAnnounced) return false;
  g.__plcosSetupAnnounced = true;
  log(`[setup] Not set up yet. Open ${publicUrl()}/setup and enter the code ${setupCode()}`);
  return true;
}
