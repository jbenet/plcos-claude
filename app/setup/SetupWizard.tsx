'use client';

import { useMemo, useState, type ReactNode } from 'react';
import s from './setup.module.css';

/**
 * The guided /setup (docs/deploy/railway.md §3). Six steps in one form held in this component's state, so
 * nothing typed is lost to a wrong code or a bad value: the server checks the code at step 1, and checks
 * every value again at the end before writing any of them. A failure brings you back to the step that
 * needs fixing, with your entries where you left them.
 */
export interface FieldInfo { label: string; help: string; placeholder: string; secret: boolean; env: string | null; envValue: string | null }
type Name = 'publicUrl' | 'googleClientId' | 'googleClientSecret' | 'affinityKey' | 'linearKey' | 'anthropicKey';
type Values = Record<Name | 'code' | 'adminEmail', string>;

const STEPS = [
  { title: 'The setup code', hint: 'From the server log' },
  { title: 'Public address', hint: 'Where people reach this app' },
  { title: 'Google sign-in', hint: 'An OAuth client, about five minutes' },
  { title: 'First admin', hint: 'Your Workspace address' },
  { title: 'Connectors', hint: 'Optional, any time later' },
  { title: 'Review and finish', hint: 'Nothing is saved until here' },
] as const;
const FIELD_STEP: Record<string, number> = { code: 0, publicUrl: 1, googleClientId: 2, googleClientSecret: 2, adminEmail: 3, affinityKey: 4, linearKey: 4, anthropicKey: 4 };

function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.copy}>
      <code>{value}</code>
      <button type="button" className={s.btn} onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const GoogleG = () => (
  <svg viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
);

export function SetupWizard({ brand, fields, suggestedUrl, suggestedFrom, consoleLinks, warnings }: {
  brand: { mark: string; name: string };
  fields: Record<Name, FieldInfo>;
  suggestedUrl: string;
  suggestedFrom: 'saved' | 'railway' | 'request';
  consoleLinks: { newProject: string; branding: string; audience: string; clients: string };
  warnings: string[];
}) {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [v, setV] = useState<Values>({ code: '', publicUrl: fields.publicUrl.env ? '' : suggestedUrl, googleClientId: '', googleClientSecret: '', adminEmail: '', affinityKey: '', linearKey: '', anthropicKey: '' });
  const [error, setError] = useState<{ field: string | null; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  const base = (fields.publicUrl.envValue ?? v.publicUrl).trim().replace(/\/+$/, '') || 'https://your-app.example.org';
  const redirectUri = `${base}/auth/google/callback`;

  const post = async (mode: 'check' | 'finish') => {
    setPending(true); setError(null);
    try {
      const res = await fetch('/setup/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, ...v }) });
      const answer = await res.json().catch(() => ({ ok: false, field: null, error: 'The server did not answer clearly. Try again.' })) as { ok: boolean; field?: string | null; error?: string };
      if (!answer.ok) {
        setError({ field: answer.field ?? null, text: answer.error ?? 'Refused.' });
        if (answer.field && FIELD_STEP[answer.field] !== undefined) setStep(FIELD_STEP[answer.field]!);
        return false;
      }
      return true;
    } catch {
      setError({ field: null, text: 'The server could not be reached. Nothing was saved; your entries are still here.' });
      return false;
    } finally { setPending(false); }
  };

  const go = (to: number) => { setError(null); setStep(to); setReached((r) => Math.max(r, to)); };
  const missing = useMemo(() => {
    if (step === 1) return !fields.publicUrl.env && !/^https?:\/\/./.test(v.publicUrl.trim());
    if (step === 2) return (!fields.googleClientId.env && !v.googleClientId.trim()) || (!fields.googleClientSecret.env && !v.googleClientSecret.trim());
    if (step === 3) return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.adminEmail.trim());
    return false;
  }, [step, v, fields]);

  const next = async () => {
    if (step === 0) { if (await post('check')) go(1); return; }
    if (step === 5) { if (await post('finish')) setDone(true); return; }
    go(step + 1);
  };

  const err = (field: string) => (error?.field === field ? error.text : null);
  const input = (name: Name | 'adminEmail', info: { label: string; placeholder: string; secret?: boolean; help?: ReactNode; env?: string | null; envValue?: string | null }, extra: Record<string, unknown> = {}) => info.env ? (
    <div className={s.fixed}><span>{info.label}</span><span>{info.envValue ? <>{info.envValue} · </> : null}set in the environment ({info.env})</span></div>
  ) : (
    <label className={s.field}>
      <span>{info.label}</span>
      <input name={name} type={info.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={v[name]} onChange={set(name)} placeholder={info.placeholder} aria-invalid={!!err(name)} {...extra} />
      {err(name) ? <small style={{ color: 'var(--clay)' }}>{err(name)}</small> : info.help ? <small>{info.help}</small> : null}
    </label>
  );

  if (done) {
    return (
      <div className={s.narrow}>
        <a className={s.brand} href="/"><span className={s.mark}>{brand.mark}</span><span><b>{brand.name}</b><span>First-run setup</span></span></a>
        <div className={s.card}>
          <div className={s.done}>
            <div className={s.tick} aria-hidden>✓</div>
            <h1>Set up</h1>
            <p>Google sign-in is on and {v.adminEmail.trim().toLowerCase()} is an admin. The setup code is retired; this page now only says the server is set up. Everything else lives in Settings → Connections.</p>
            <a className={`${s.btn} ${s.google}`} href="/auth/google"><GoogleG />Continue with Google</a>
          </div>
        </div>
      </div>
    );
  }

  const optional: Array<{ name: Name; what: string }> = [
    { name: 'affinityKey', what: 'The CRM replica. Read-only.' },
    { name: 'linearKey', what: 'Issues and projects. Read-only.' },
    { name: 'anthropicKey', what: 'The W1, W1c and W5 research buttons.' },
  ];
  const shown = (name: Name) => {
    const f = fields[name];
    if (f.env) return <>set in the environment ({f.env})</>;
    const val = v[name].trim();
    if (!val) return name === 'publicUrl' ? <>{suggestedUrl} (suggested)</> : null;
    return f.secret ? <>••••{val.slice(-4)}</> : <>{val}</>;
  };

  return (
    <div className={s.frame}>
      <aside className={s.aside}>
        <a className={s.brand} href="/"><span className={s.mark}>{brand.mark}</span><span><b>{brand.name}</b><span>First-run setup</span></span></a>
        <ol className={s.steps}>
          {STEPS.map((x, i) => {
            const state = i === step ? 'current' : i <= reached ? 'done' : 'locked';
            return (
              <li key={x.title} data-state={state} aria-current={i === step ? 'step' : undefined}>
                <button type="button" disabled={i > reached} onClick={() => i <= reached && go(i)}>
                  <span className={s.dot}>{state === 'done' ? '✓' : i + 1}</span>
                  <span>{x.title}<small>{x.hint}</small></span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className={s.asideNote}>Only two values live outside the app: PLCOS_SECRET, which encrypts what you enter here, and the database connection. Secrets are stored encrypted and never shown again in full.</p>
      </aside>

      <form className={s.card} onSubmit={(e) => { e.preventDefault(); if (!missing && !pending) void next(); }} noValidate>
        <div className={s.head}>
          <div className={s.mobileStep}>Step {step + 1} of {STEPS.length} · {STEPS[step]!.title}</div>
          {step === 0 && <>
            <div className="lbl">Step 1 of 6</div>
            <h1>Enter the setup code</h1>
            <p>The server printed a one-time code when it started. On Railway: the service → <b>Deployments</b> → <b>View logs</b>, and look for <i>Not set up yet</i>. It proves you run this server.</p>
          </>}
          {step === 1 && <>
            <div className="lbl">Step 2 of 6</div>
            <h1>The public address</h1>
            <p>Where people reach the app. Google sends them back here after they sign in, so it must be exactly what the browser shows.</p>
          </>}
          {step === 2 && <>
            <div className="lbl">Step 3 of 6</div>
            <h1>Google sign-in</h1>
            <p>An OAuth client in your Google Workspace&rsquo;s Cloud project. It asks Google for a name and an email only — never mail.</p>
          </>}
          {step === 3 && <>
            <div className="lbl">Step 4 of 6</div>
            <h1>The first admin</h1>
            <p>Your Google Workspace address. You get admin access, and can then open Settings → Connections. Nobody signs up: a person signs in only once their address is on the roster.</p>
          </>}
          {step === 4 && <>
            <div className="lbl">Step 5 of 6 · optional</div>
            <h1>Connectors</h1>
            <p>Each can be skipped and added later in Settings → Connections. The connector keys are used only by the real profile; the demo uses fakes.</p>
          </>}
          {step === 5 && <>
            <div className="lbl">Step 6 of 6</div>
            <h1>Review and finish</h1>
            <p>Every value is checked before any is saved. If one is wrong, nothing is written and you are taken back to it.</p>
          </>}
        </div>

        <div className={s.body}>
          {step === 0 && warnings.map((w) => <div key={w} className={s.warn}>{w}</div>)}

          {step === 0 && (
            <label className={s.field}>
              <span>Setup code</span>
              <input className={s.code} name="code" autoFocus autoComplete="one-time-code" spellCheck={false} value={v.code} onChange={set('code')} placeholder="XXXX-XXXX-XXXX" aria-invalid={!!err('code')} />
              <small>Twelve letters and digits. Dashes and case don&rsquo;t matter. Ten wrong tries an hour from one address, then it waits.</small>
            </label>
          )}

          {step === 1 && <>
            {input('publicUrl', { ...fields.publicUrl, help: suggestedFrom === 'railway' ? 'Filled in from Railway’s domain. Change it only for a custom domain.' : suggestedFrom === 'saved' ? 'Saved earlier.' : 'Filled in from the address this page was opened at.' }, { type: 'url', inputMode: 'url' })}
            <div className={s.field}><span>Google will send people back to</span><Copy value={redirectUri} /><small>You&rsquo;ll paste this into Google in the next step. It changes as you edit the address.</small></div>
          </>}

          {step === 2 && <>
            <ol className={s.guide}>
              <li>Open the <a href={consoleLinks.newProject} target="_blank" rel="noreferrer">Google Cloud console</a>, signed in with your Workspace account, and pick or create a project for this app.</li>
              <li><a href={consoleLinks.branding} target="_blank" rel="noreferrer">Google Auth Platform → Branding</a>: an app name (<em>{brand.name}</em>) and a support email.</li>
              <li><a href={consoleLinks.audience} target="_blank" rel="noreferrer">Audience</a>: choose <b>Internal</b>. Only people in your Workspace can sign in, and Google needs no review.</li>
              <li><a href={consoleLinks.clients} target="_blank" rel="noreferrer">Clients → Create client</a>: type <b>Web application</b>. Under <b>Authorized redirect URIs</b>, add:
                <Copy value={redirectUri} />
              </li>
              <li>Create it, and copy the <b>Client ID</b> and <b>Client secret</b> here.</li>
            </ol>
            {input('googleClientId', fields.googleClientId)}
            {input('googleClientSecret', fields.googleClientSecret)}
          </>}

          {step === 3 && input('adminEmail', { label: 'Admin email', placeholder: 'you@your-workspace.org', help: 'A verified address in a Google Workspace (not @gmail.com). An existing person with this address becomes an admin; otherwise one is added.' }, { type: 'email', inputMode: 'email', autoFocus: true })}

          {step === 4 && optional.map(({ name, what }) => {
            const f = fields[name];
            return (
              <section key={name} className={s.connector}>
                <header><h3>{f.label.replace(/ API key$/, '')}</h3><span className={s.tag} data-on={!!(f.env || v[name].trim())}>{f.env ? 'from the environment' : v[name].trim() ? 'will be saved' : 'skipped'}</span></header>
                <p>{what} {f.help}</p>
                {input(name, { ...f, help: undefined })}
              </section>
            );
          })}

          {step === 5 && (
            <table className={s.review}>
              <tbody>
                {(['publicUrl', 'googleClientId', 'googleClientSecret'] as Name[]).map((n) => <tr key={n}><th>{fields[n].label}</th><td>{shown(n)}</td></tr>)}
                <tr><th>Redirect URI</th><td>{redirectUri}</td></tr>
                <tr><th>First admin</th><td>{v.adminEmail.trim().toLowerCase()}</td></tr>
                {(['affinityKey', 'linearKey', 'anthropicKey'] as Name[]).map((n) => { const x = shown(n); return <tr key={n}><th>{fields[n].label}</th><td className={x ? '' : s.none}>{x ?? 'skipped'}</td></tr>; })}
              </tbody>
            </table>
          )}

          {error && (!error.field || FIELD_STEP[error.field] !== step || error.field === 'code') && <p className={s.error} role="alert"><b>Not saved.</b> {error.text}</p>}
        </div>

        <div className={s.foot}>
          {step > 0 ? <button type="button" className={s.link} onClick={() => go(step - 1)}>Back</button> : <span className={s.muted}>Step 1 of 6</span>}
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {step === 4 && <span className={s.muted}>Skip any you don&rsquo;t have yet.</span>}
            <button type="submit" className={`${s.btn} ${s.primary}`} disabled={pending || missing}>
              {pending ? (step === 0 ? 'Checking…' : 'Saving…') : step === 0 ? 'Check the code' : step === 5 ? 'Finish setup' : 'Continue'}
            </button>
          </span>
        </div>
      </form>
    </div>
  );
}
