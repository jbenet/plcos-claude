'use client';

import { useState } from 'react';

/**
 * The only two preferences this app stores in the browser. They are listed rather than
 * hidden, because a preference you cannot find is one you cannot undo.
 */
export function PrefsReset() {
  const [done, setDone] = useState(false);

  const clear = () => {
    try {
      window.localStorage.removeItem('capitalos.nav.collapsed');
      window.localStorage.removeItem('capitalos.rightpane');
    } catch {
      /* blocked storage — nothing was stored either */
    }
    setDone(true);
    window.location.reload();
  };

  return (
    <>
      <div className="fact">
        <span>Collapsed nav sections</span>
        <span className="mono" style={{ fontSize: 11 }}>capitalos.nav.collapsed</span>
      </div>
      <div className="fact">
        <span>Right pane open or closed</span>
        <span className="mono" style={{ fontSize: 11 }}>capitalos.rightpane</span>
      </div>
      <button className="btn" onClick={clear} style={{ marginTop: 12 }} disabled={done}>
        {done ? 'Reset' : 'Reset both to defaults'}
      </button>
      <p className="note" style={{ marginTop: 10 }}>
        Stored in this browser only. They never reach the server, never reach another device, and
        come back empty in a private window — which is why nothing consequential is kept here.
      </p>
    </>
  );
}
