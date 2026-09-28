'use client';

import { useId, useState, type ReactNode } from 'react';
import s from './linear.module.css';

/**
 * "Mine | Team" on My Linear. A presentation choice only: both lists are rendered on the server
 * and this picks which one shows, so switching is instant and nothing is fetched or written.
 */
export function LinearTabs({ title, tabs, initial, extra }: {
  title: ReactNode;
  tabs: Array<{ key: string; label: string; count: number; body: ReactNode }>;
  initial: string;
  extra?: ReactNode;
}) {
  const [on, setOn] = useState(initial);
  const id = useId();
  return (
    <>
      <div className="chead">
        {title}
        <div className={s.headRight}>
          {extra}
          <div className={s.tabs} role="tablist" aria-label="Whose issues">
            {tabs.map((t) => (
              <button
                key={t.key} type="button" role="tab" className={s.tab} id={`${id}-${t.key}`}
                aria-selected={on === t.key} aria-controls={`${id}-${t.key}-panel`} onClick={() => setOn(t.key)}
              >
                {t.label}<span className={s.count}>{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`${id}-${t.key}-panel`} aria-labelledby={`${id}-${t.key}`} hidden={on !== t.key}>
          {t.body}
        </div>
      ))}
    </>
  );
}
