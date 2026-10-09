import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { PrefsReset } from '@/components/shell/PrefsReset';
import { ModePicker, ThemePicker } from '@/components/shell/ThemePicker';
import { auth } from '@/lib/auth';
import { THEMES } from '@/lib/theme';
import { MailguardConnect } from '@/components/email/MailguardConnect';
import { CalendarFeeds } from '@/components/calendar/CalendarFeeds';
import { McpTokens } from '@/components/mcp/McpTokens';
import { VoiceCard } from '@/components/email/VoiceCard';
import { SettingsLayout, settingsSection } from '@/components/settings/SettingsNav';

export const dynamic = 'force-dynamic';

/**
 * Preferences, as distinct from Developer → Settings.
 *
 * This page holds what a person chooses for themselves. That one holds what the system
 * was configured with, including nine constants labelled as guesses. Putting a theme
 * picker next to a circuit-breaker threshold would have been a category error.
 */
async function Preferences({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const a = await auth();
  const user = await a.currentUser();
  const section = settingsSection((await searchParams).section);

  return (
    <Page
      crumbs={[{ label: 'Preferences' }]}
      inspector={
        <>
          <div className="lbl">Yours, in this browser</div>
          <div className="ihead">{user.name}</div>
          <div className="imeta">{user.role}</div>

          <div className="kv"><span>Light or dark</span><span>light, dark or system</span></div>
          <div className="kv"><span>Theme</span><span>{THEMES.length} available</span></div>
          <div className="kv"><span>Stored in</span><span className="mono" style={{ fontSize: 11 }}>localStorage</span></div>
          <div className="kv"><span>Reaches the server</span><span>no</span></div>
          <div className="kv"><span>Reaches other devices</span><span>no</span></div>

          <div className="scope">
            <div className="lbl">Why none of this is in the database</div>
            <p>
              A theme and a collapsed nav section are taste. They come back empty in a private
              window and that is fine, because nothing here changes what a number means. Anything
              that did would belong in a table with an audit row behind it.
            </p>
          </div>

          <div className="note">
            Looking for the guessed constants, the seams or the connector status? Those are
            configuration rather than preference —{' '}
            <Link href="/dev/settings">Developer → Settings</Link>.
          </div>
        </>
      }
    >
      <div className="lbl">Preferences</div>
      <h1>Your settings</h1>
      <p className="sublede">
        What you choose for yourself, kept in this browser — except your mailguard token, your voice
        for drafts and your MCP tokens, which the server keeps for you alone. Nothing on this page changes what a number means, who can
        approve anything, or what anyone else sees.
      </p>

      <SettingsLayout current={section} admin={user.access === 'admin'}>
        {section === 'appearance' && <>
          <div className="card">
            <div className="chead">
              <h2>Light or dark</h2>
              <span className="lbl">applies immediately · remembered on this device</span>
            </div>
            <div className="cbody">
              <ModePicker />
            </div>
            <p className="cover">
              <b>System follows this device.</b> If your computer or phone switches to dark in the evening,
              this page switches with it. Light and Dark stay put. Either theme below comes in both; in dark,
              clay, green, amber and purple are brighter steps of the same colours and keep their meanings.
            </p>
          </div>

          <div className="card">
            <div className="chead">
              <h2>Theme</h2>
              <span className="lbl">applies immediately · remembered on this device</span>
            </div>
            <div className="cbody">
              <ThemePicker />
            </div>
            <p className="cover">
              <b>A theme changes the chrome, never a meaning.</b> The accent, the ground and the rail
              move; clay still means refused, green still means passed, amber still means needs a
              look, and purple still means inferred. A palette that meant different things on
              different themes would be worse than having one palette — so the four semantic colours
              are fixed and every state still carries a word beside its colour.
            </p>
          </div>

          <div className="card">
            <div className="chead">
              <h2>Layout</h2>
              <span className="lbl">four preferences, all listed</span>
            </div>
            <div className="cbody">
              <PrefsReset />
            </div>
          </div>
        </>}
        {section === 'email' && <>
          {/* Your mailguard token, for moving drafts into your Gmail (docs/25 §12). Not taste: it is audited and lives server-side. */}
          <MailguardConnect />

          {/* Your calendars' private addresses, for the Calendar page's Travel and Events lanes (issue 0021). Read only. */}
          <CalendarFeeds />

          {/* How you write, for drafts written for you (docs/email-guidelines.md §Voice). Server-side: drafters read it. */}
          <VoiceCard />
        </>}
        {section === 'agents' && <>
          {/* Tokens for agents over MCP (docs/26). Server-side and audited, like the mailguard token. */}
          <McpTokens />
        </>}
        {section === 'account' && <>
          <div className="card">
            <div className="chead">
              <h2>Who you are</h2>
              <span className="lbl">{a.kind === 'google' ? 'Google sign-in' : a.kind === 'labos' ? 'LabOS' : 'local user switcher'}</span>
            </div>
            <div className="cbody">
              <div className="fact"><span>Signed in as</span><span>{user.name} · {user.role}</span></div>
              <div className="fact"><span>Provider</span><span>{a.kind}</span></div>
              {a.kind === 'google' ? (
                <>
                  <p style={{ marginTop: 10 }}>
                    Signed in with your Google Workspace account ({user.email}). The session is a signed cookie;
                    an admin can end all of yours at once from Settings → Connections.
                  </p>
                  <form method="post" action="/auth/signout"><button className="btn" type="submit">Sign out</button></form>
                </>
              ) : (
                <p style={{ marginTop: 10 }}>
                  This is not a login. Identity is a cookie holding a handle; no password is checked and
                  none is simulated, because a simulated one is the thing that would quietly survive into
                  a deployment. Switch user from the bottom of the rail.
                </p>
              )}
            </div>
          </div>
        </>}
      </SettingsLayout>
    </Page>
  );
}

export default coalescePage('/settings', Preferences);
