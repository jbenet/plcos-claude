import type { ReactNode } from 'react';
import Link from '@/components/ui/AppLink';
import s from './settings.module.css';

/**
 * Settings, in sections with a sidebar (issue 0130): one long page became one section at a time.
 * Your own sections are views of /settings (?section=…); the server's, for Admins, are their own pages.
 */
export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'email', label: 'Email and drafts' },
  { id: 'agents', label: 'Agent access' },
  { id: 'account', label: 'Account' },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

const SERVER = [
  { id: 'connections', label: 'Connections', href: '/settings/connections' },
  { id: 'people', label: 'People', href: '/settings/people' },
  { id: 'vehicles', label: 'Vehicles', href: '/settings/vehicles' },
] as const;

export function settingsSection(value: unknown): SettingsSection {
  return SETTINGS_SECTIONS.find((x) => x.id === value)?.id ?? 'appearance';
}

export function SettingsLayout({ current, admin, children }: {
  current: SettingsSection | (typeof SERVER)[number]['id'];
  /** Show the server's sections, which only Admins may open. */
  admin: boolean;
  children: ReactNode;
}) {
  const item = (id: string, label: string, href: string) => (
    <Link key={id} href={href} className={s.item} aria-current={id === current ? 'page' : undefined}>{label}</Link>
  );
  return (
    <div className={s.layout}>
      <nav className={s.nav} aria-label="Settings sections">
        <div className={s.group}>Yours</div>
        {SETTINGS_SECTIONS.map((x) => item(x.id, x.label, x.id === 'appearance' ? '/settings' : `/settings?section=${x.id}`))}
        {admin && <>
          <div className={s.group}>The server · Admins</div>
          {SERVER.map((x) => item(x.id, x.label, x.href))}
        </>}
      </nav>
      <div className={s.body}>{children}</div>
    </div>
  );
}
