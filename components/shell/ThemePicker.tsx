'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_MODE, DEFAULT_THEME, MODES, MODE_KEY, THEMES, THEME_KEY, applyMode, isColourMode, themeAttr,
  type ColourMode, type ThemeId,
} from '@/lib/theme';

/**
 * The theme picker.
 *
 * Applied immediately and kept in this browser. It never reaches the server and never
 * reaches another device, which is the right shape for a preference about taste — and
 * the wrong shape for anything else, which is why nothing else lives here.
 */
export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === 'green' || stored === 'clay') setTheme(stored);
    } catch {
      /* blocked storage — the default is already applied */
    }
    setReady(true);
  }, []);

  const choose = (id: ThemeId) => {
    setTheme(id);
    const attr = themeAttr(id);
    if (attr) document.documentElement.setAttribute('data-theme', attr);
    else document.documentElement.removeAttribute('data-theme');
    try {
      window.localStorage.setItem(THEME_KEY, id);
    } catch {
      /* the session still works; it just will not survive a reload */
    }
  };

  return (
    <div className="themes" suppressHydrationWarning>
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={`theme${ready && theme === t.id ? ' on' : ''}`}
          onClick={() => choose(t.id)}
          aria-pressed={ready && theme === t.id}
          suppressHydrationWarning
        >
          <span className="sw" aria-hidden="true">
            {t.swatch.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span className="tn">
            <b>{t.name}</b>
            {ready && theme === t.id && <span className="flag f-ok">In use</span>}
          </span>
          <span className="tb">{t.blurb}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Light, dark, or follow the system (issue 0142). Separate from the theme: each theme has both.
 * Applied immediately and kept in this browser, like the theme. "System" is applied and then kept
 * up to date by THEME_BOOT's listener, which reads the stored choice each time the system changes.
 */
export function ModePicker() {
  const [mode, setMode] = useState<ColourMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODE_KEY);
      if (isColourMode(stored)) setMode(stored);
    } catch {
      /* blocked storage — the default, follow the system, is already applied */
    }
    setReady(true);
  }, []);

  const choose = (id: ColourMode) => {
    setMode(id);
    try {
      window.localStorage.setItem(MODE_KEY, id);
    } catch {
      /* the session still works; it just will not survive a reload */
    }
    applyMode(id);
  };

  return (
    <div className="themes modes" role="group" aria-label="Light or dark" suppressHydrationWarning>
      {MODES.map((m) => (
        <button
          key={m.id}
          className={`theme${ready && mode === m.id ? ' on' : ''}`}
          onClick={() => choose(m.id)}
          aria-pressed={ready && mode === m.id}
          suppressHydrationWarning
        >
          <span className="sw" aria-hidden="true">
            {m.swatch.map((c, i) => (
              <i key={`${c}${i}`} style={{ background: c }} />
            ))}
          </span>
          <span className="tn">
            <b>{m.name}</b>
            {ready && mode === m.id && <span className="flag f-ok">In use</span>}
          </span>
          <span className="tb">{m.blurb}</span>
        </button>
      ))}
    </div>
  );
}
