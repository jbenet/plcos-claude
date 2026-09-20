import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { PrefsReset } from '@/components/shell/PrefsReset';
import { ThemePicker } from '@/components/shell/ThemePicker';
import { auth } from '@/lib/auth';
import { THEMES } from '@/lib/theme';

export const dynamic = 'force-dynamic';

/**
 * Preferences, as distinct from Developer → Settings.
 *
 * This page holds what a person chooses for themselves. That one holds what the system
 * was configured with, including nine constants labelled as guesses. Putting a theme
 * picker next to a circuit-breaker threshold would have been a category error.
 */
export default async function Preferences() {
  const a = await auth();
  const user = await a.currentUser();

  return (
    <Page
      crumbs={[{ label: 'Preferences' }]}
      inspector={
        <>
          <div className="lbl">Yours, in this browser</div>
          <div className="ihead">{user.name}</div>
          <div className="imeta">{user.role}</div>

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
        What you choose for yourself, kept in this browser. Nothing on this page changes what a
        number means, who can approve anything, or what anyone else sees.
      </p>

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
          <span className="lbl">three preferences, all listed</span>
        </div>
        <div className="cbody">
          <PrefsReset />
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Who you are</h2>
          <span className="lbl">local user switcher</span>
        </div>
        <div className="cbody">
          <div className="fact"><span>Signed in as</span><span>{user.name} · {user.role}</span></div>
          <div className="fact"><span>Provider</span><span>{a.kind}</span></div>
          <p style={{ marginTop: 10 }}>
            This is not a login. Identity is a cookie holding a handle; no password is checked and
            none is simulated, because a simulated one is the thing that would quietly survive into
            a deployment. Switch user from the bottom of the rail.
          </p>
        </div>
      </div>
    </Page>
  );
}
