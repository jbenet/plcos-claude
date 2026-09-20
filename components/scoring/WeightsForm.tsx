'use client';

import { useState } from 'react';
import { saveWeights } from '@/app/selection/actions';
import { DIMENSION_LABEL, DIMENSION_MEANS, type Weights } from '@/modules/scoring/client';

/**
 * The weights are the argument. They are editable here rather than buried in config,
 * because a ranking whose weights you cannot see is a ranking you cannot disagree with.
 */
export function WeightsForm({ weights }: { weights: Weights }) {
  const [v, setV] = useState({
    capacity: Math.round(weights.capacity * 100),
    affinity: Math.round(weights.affinity * 100),
    propensity: Math.round(weights.propensity * 100),
    timeToDecision: Math.round(weights.timeToDecision * 100),
  });
  const [state, setState] = useState<{ error?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const total = v.capacity + v.affinity + v.propensity + v.timeToDecision;

  const field = (key: keyof typeof v, dim: keyof typeof DIMENSION_LABEL) => (
    <label className="field" key={key}>
      <span className="lbl">
        {DIMENSION_LABEL[dim]} · {v[key]}%
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        name={key}
        value={v[key]}
        onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
        style={{ width: '100%' }}
      />
      <span className="muted" style={{ fontSize: 11, lineHeight: 1.45, display: 'block', marginTop: 2 }}>
        {DIMENSION_MEANS[dim]}
      </span>
    </label>
  );

  return (
    <form
      className="cbody"
      action={async (fd) => {
        setPending(true);
        setState((await saveWeights(fd)) ?? null);
        setPending(false);
      }}
    >
      {field('capacity', 'capacity')}
      {field('affinity', 'affinity')}
      {field('propensity', 'propensity')}
      {field('timeToDecision', 'time_to_decision')}

      <label className="field">
        <span className="lbl">Why you changed them</span>
        <input type="text" name="label" placeholder="Propensity matters more than capacity this quarter" />
      </label>

      <div className="fact">
        <span>Total</span>
        <span style={{ color: total === 100 ? 'var(--green)' : 'var(--clay)' }}>
          {total}% {total === 100 ? '' : '— must be 100'}
        </span>
      </div>

      {state?.error && (
        <div className="warn" style={{ marginTop: 12 }}>
          <div className="lbl" style={{ color: 'var(--clay)' }}>
            Not saved
          </div>
          <p>{state.error}</p>
        </div>
      )}

      <div className="acts">
        <button className="btn p" type="submit" disabled={pending || total !== 100}>
          {pending ? 'Re-ranking…' : 'Apply and re-rank'}
        </button>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        Changing the weights re-ranks everyone immediately and writes an audit row. The old weight
        set is kept — a ranking you cannot reproduce is not a ranking, it is a mood.
      </p>
    </form>
  );
}
