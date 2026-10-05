import { headers } from 'next/headers';
import { config } from '@/config/deployment';
import { GOOGLE_CONSOLE } from '@/lib/connectors/google-signin/setting';
import { secretSource, storageWarning } from '@/lib/settings/key';
import { platformUrl, publicUrl, requestOrigin, setupOpen } from '@/lib/settings/setup';
import { SETUP_FIELDS } from '@/lib/settings/setup-service';
import { settingsReady, settingSource, settingValue } from '@/lib/settings/store';
import { SetupWizard, type FieldInfo } from './SetupWizard';
import s from './setup.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Set up · ${config.product.name}` };

/**
 * First-run setup (docs/deploy/railway.md §3). Open only while this server signs in with Google and the
 * Google client is not configured; the code printed in the server log is the credential. Once set up, this
 * page says so and links to sign-in. It never shows a stored secret.
 */
export default async function SetupPage() {
  await settingsReady().catch(() => undefined);
  const h = await headers();
  const open = setupOpen();
  const storage = storageWarning();
  const volumeKey = secretSource().source === 'volume';
  const profileLabel = config.data.profile === 'real' ? 'Real data' : 'Demo data';

  const Brand = () => (
    <a className={s.brand} href="/">
      <span className={s.mark}>{config.product.mark}</span>
      <span><b>{config.product.name}</b><span className={s.sub}>First-run setup · {profileLabel}</span></span>
    </a>
  );

  if (!open) {
    const local = config.auth.provider !== 'google';
    return (
      <main className={s.page}>
        <div className={s.narrow}>
          <Brand />
          <div className={s.card}>
            <div className={s.head}>
              <div className="lbl">{local ? 'Nothing to set up here' : 'Set up'}</div>
              <h1>{local ? 'This server uses the user switcher' : 'This server is set up'}</h1>
              <p>{local
                ? 'Setup is for a deployed server, which signs people in with Google. This one runs on the Mac with the local user switcher; its keys come from the Keychain.'
                : 'Google sign-in is configured. Sign in as an admin to change the address, the Google client or the connector keys in Settings → Connections.'}</p>
            </div>
            <div className={s.foot}>
              <span className={s.muted}>{local ? 'Admins can still keep keys in Settings → Connections.' : 'Every change there is logged, by field.'}</span>
              <a className={`${s.btn} ${s.primary}`} href={local ? '/today' : '/signin'}>{local ? 'Open the app' : 'Sign in'}</a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const fields = Object.fromEntries(Object.entries(SETUP_FIELDS).map(([name, def]) => {
    const env = settingSource(def.key) === 'env';
    const info: FieldInfo = {
      label: def.label, help: def.help, placeholder: def.placeholder, secret: def.secret,
      env: env ? def.env : null,
      // A plain value set in the environment may be shown; a secret never is.
      envValue: env && !def.secret ? settingValue(def.key) ?? null : null,
    };
    return [name, info];
  })) as Record<keyof typeof SETUP_FIELDS, FieldInfo>;

  const suggested = settingValue('app.publicUrl') ?? platformUrl() ?? requestOrigin(h) ?? publicUrl(h);
  return (
    <main className={s.page}>
      <SetupWizard
        brand={{ mark: config.product.mark, name: config.product.name, profile: profileLabel }}
        fields={fields}
        suggestedUrl={suggested}
        suggestedFrom={settingValue('app.publicUrl') ? 'saved' : platformUrl() ? 'railway' : 'request'}
        consoleLinks={GOOGLE_CONSOLE}
        warnings={[
          ...(storage ? [storage] : []),
          ...(volumeKey ? ['PLCOS_SECRET is not set, so the key that encrypts these settings was made on the volume. It works; for a stronger split, copy it into a sealed PLCOS_SECRET variable later (Settings → Connections says how).'] : []),
        ]}
      />
    </main>
  );
}
