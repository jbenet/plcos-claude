'use client';

import { useState } from 'react';
import { AUDIENCE_LABEL, USE_LABEL, type Asset } from '@/modules/content/client';

const STATUS_FLAG: Record<string, string> = {
  draft: 'f-mute', approved: 'f-ok', needs_refresh: 'f-block', withdrawn: 'f-mute',
};

/**
 * One canonical asset, its variants side by side.
 *
 * Named in CLAUDE.md because the component is the discipline: seeing the LP memo and the
 * public primer next to each other is what stops the same sentence appearing in both when
 * only one of them may carry it.
 */
export function AudienceVariants({ canonical, variants }: { canonical: Asset; variants: Asset[] }) {
  const [selected, setSelected] = useState<string>(variants[0]?.assetId ?? '');
  const current = variants.find((v) => v.assetId === selected) ?? variants[0] ?? null;

  return (
    <div className="card">
      <div className="chead">
        <h2>{canonical.title}</h2>
        <span className="lbl">
          v{canonical.version} · {canonical.claims.length} claims underneath · {variants.length} variants
        </span>
      </div>

      <div className="cbody" style={{ borderBottom: '1px solid var(--line)' }}>
        <p style={{ color: 'var(--muted)' }}>{canonical.summary}</p>
        <p style={{ fontSize: 12.5, lineHeight: 1.6 }}>{canonical.body}</p>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '12px 15px', flexWrap: 'wrap', borderBottom: '1px solid var(--line)' }}>
        {variants.map((v) => (
          <button
            key={v.assetId}
            className={`btn${v.assetId === current?.assetId ? ' p' : ''}`}
            onClick={() => setSelected(v.assetId)}
          >
            {v.audience ? AUDIENCE_LABEL[v.audience] : v.title}
          </button>
        ))}
      </div>

      {current && (
        <div className="cbody">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <b style={{ fontSize: 15, fontFamily: 'var(--display)', fontWeight: 600 }}>{current.title}</b>
            <span className={`flag ${STATUS_FLAG[current.status]}`}>{current.status.replace('_', ' ')}</span>
            <span className="flag f-mute">{USE_LABEL[current.permittedUse]}</span>
          </div>
          <p style={{ color: 'var(--muted)' }}>{current.summary}</p>
          <p style={{ fontSize: 12.5, lineHeight: 1.6 }}>{current.body}</p>

          {current.flags.length > 0 && (
            <div className="warn" style={{ marginTop: 12 }}>
              <div className="lbl" style={{ color: 'var(--clay)' }}>
                Needs refresh
              </div>
              {current.flags.map((f) => (
                <p key={f.flagId}>{f.reason}</p>
              ))}
            </div>
          )}

          <div className="lbl" style={{ marginTop: 16, marginBottom: 6 }}>
            Claims it rests on
          </div>
          {current.claims.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              None recorded — which means a changed fact would not flag this variant. That is a gap,
              not a feature.
            </p>
          ) : (
            current.claims.map((c) => (
              <div className="fact" key={c.claimId}>
                <span>
                  {c.entityName} · {c.field}
                </span>
                <span>
                  {c.value}
                  <span className="mono muted" style={{ fontSize: 10, marginLeft: 6, fontWeight: 400 }}>
                    {c.source}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
