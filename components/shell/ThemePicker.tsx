'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_THEME, THEMES, THEME_KEY, type ThemeId } from '@/lib/theme';

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
    if (id === DEFAULT_THEME) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', id);
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
