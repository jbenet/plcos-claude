import type { Db } from './db';

/**
 * L-series follow-on seed: funder-vehicle fit.
 *
 * Every firm below produces a *different* diagnosis, because that is the point of the
 * page — a prospect blocked by a gate, one who knows us and disagrees, one we cannot
 * reach, and one who would say yes in March all look identical in a pipeline and need
 * completely different work.
 */

type Certainty = 'known' | 'inferred' | 'guess';
type Grade = 'strong' | 'good' | 'neutral' | 'weak' | 'blocker';

interface Dim {
  code: string; grade: Grade; certainty: Certainty; finding: string;
  source?: string; as_of: string;
}
interface GateSpec {
  code: string; passed: boolean | null; detail: string; certainty: Certainty;
  source?: string; as_of: string;
}
interface Spec {
  entity: string;
  vehicle: string;
  owner: string;
  headline: string;
  profile: {
    firm_class: string; iapd: boolean | null; aum: number | null; aum_basis?: string;
    aum_certainty: Certainty; decision: string; weeks: [number, number];
    signs?: string; kills?: string; band?: [number, number];
    prior: boolean; provenance?: string; since?: string;
  };
  gates: GateSpec[];
  dims: Dim[];
  values: Array<{ value: string; match: string; grade: Grade; clear: boolean; action: string; certainty: Certainty; source?: string; as_of: string }>;
  perception: Array<{ subject: string; kind: string; fam: string; sent: string; evidence: string; certainty: Certainty; source?: string; as_of: string }>;
  engagement?: Array<{ channel: string; behaviour: string; detail: string; on: string; certainty: Certainty }>;
  links: Array<{ via?: string; kind: string; statement: string; band: string; weight: Grade; certainty: Certainty; source?: string; as_of: string }>;
}

/**
 * The dimension catalogue. Report 1 §2.5 and Report 4 §4.1 supply most of it; the
 * neuro-specific ones come from Report 1 §2.4 and Report 5 §3.
 *
 * weight_us is how much this moves OUR decision to spend time here. weight_them is how
 * much it moves THEIRS. They are different questions and the page sorts by both.
 */
const CATALOGUE: Record<string, { label: string; question: string; us: number; them: number }> = {
  invests_in_funds:     { label: 'Backs funds at all',      question: 'Do they allocate to managers, or only write directs?', us: 5, them: 2 },
  manager_stage:        { label: 'First-time managers',     question: 'Does their mandate permit a first-time or emerging manager?', us: 5, them: 3 },
  check_band:           { label: 'Cheque band overlap',     question: 'Does the cheque they write sit inside the band we can take?', us: 5, them: 4 },
  fund_size:            { label: 'Fund-size alignment',     question: 'Can they underwrite a fund this size without breaching a concentration limit?', us: 4, them: 4 },
  thesis_fit:           { label: 'Thesis fit',              question: 'Frontier science and long-duration technology — stated or revealed interest?', us: 5, them: 5 },
  industry_fit:         { label: 'Neuro exposure',          question: 'Neuro, BCI or adjacent health: have they actually deployed there?', us: 4, them: 5 },
  tech_disposition:     { label: 'Tech-forward',            question: 'AI- and frontier-tech-forward by disposition, or treating it as one sector bet?', us: 3, them: 4 },
  deployment_tempo:     { label: 'Deploying now',           question: 'Are they actively deploying this vintage, or pulling back?', us: 5, them: 3 },
  vc_exposure:          { label: 'Venture exposure',        question: 'Seeking more venture exposure, at target, or reducing?', us: 4, them: 4 },
  liquidity:            { label: 'Liquidity',               question: 'Is capital liquid and callable, or locked in concentrated positions?', us: 4, them: 5 },
  decision_speed:       { label: 'Decision speed',          question: 'Can their decision complete inside our window?', us: 5, them: 2 },
  duration_tolerance:   { label: 'Duration tolerance',      question: 'Do they understand a twelve-year horizon and negative marks for three of them?', us: 4, them: 3 },
  concession_tolerance: { label: 'Catalytic capacity',      question: 'Can they take a PRI, catalytic or first-loss position?', us: 2, them: 3 },
  signal_value:         { label: 'Signal value',            question: 'Does their name on the register unlock other LPs?', us: 3, them: 1 },
  strategic_value:      { label: 'Beyond capital',          question: 'Deal flow, scientific network, follow-on capital, LP referrals?', us: 3, them: 2 },
  referral_willingness: { label: 'Referral willingness',    question: 'Will they take reference calls and introduce us onward?', us: 3, them: 2 },
  domain_sympathy:      { label: 'Domain sympathy',         question: 'Do they understand why this takes twelve years, rather than tolerating it?', us: 4, them: 4 },
  mission_motivation:   { label: 'Stated motivation',       question: 'Has the principal publicly stated a personal interest in this field?', us: 3, them: 5 },
};

const GATES: Record<string, string> = {
  check_band:  'Cheque fits between our minimum and our concentration cap',
  mandate:     'Mandate permits a first-time, sub-$100M, single-sector fund',
  duration:    'Can hold a ten-year-plus position',
  conflict:    'No disqualifying conflict',
  accredited:  'Accredited or qualified-purchaser status verifiable',
  provenance:  'Pre-existing substantive relationship, or a confirmed warm introduction',
};

const SPECS: Spec[] = [
  {
    entity: 'Cedar Trust', vehicle: 'neurotech', owner: 'mara',
    headline: 'Countersigned. The assessment is kept because a closed LP is the best calibration we have for the next one.',
    profile: { firm_class: 'endowment', iapd: true, aum: 900_000_000, aum_basis: 'Annual report, 2026', aum_certainty: 'known',
      decision: 'small_ic', weeks: [6, 10], signs: 'Ivo Lindqvist, CIO', kills: 'The investment committee, quarterly',
      band: [3_000_000, 8_000_000], prior: true, provenance: 'Introduced through Mercer & Bly, who screen managers for them. First contact 5 August 2026.', since: '2026-08-05' },
    gates: [
      { code: 'check_band', passed: true, detail: '$4.0M sits inside our $2–8M band and well under the concentration cap.', certainty: 'known', as_of: '2026-09-18' },
      { code: 'mandate', passed: true, detail: 'Life-sciences allocation was raised from 8% to 12% in the annual report; emerging managers are explicitly permitted.', certainty: 'known', as_of: '2026-09-15' },
      { code: 'duration', passed: true, detail: 'Ten-year lock accepted after seeing the recycling provision.', certainty: 'known', as_of: '2026-08-20' },
      { code: 'conflict', passed: true, detail: 'No competing neuro fund in the portfolio.', certainty: 'known', as_of: '2026-08-20' },
      { code: 'accredited', passed: true, detail: 'Third-party counsel letter on file, verified 15 September, valid a year.', certainty: 'known', as_of: '2026-09-15' },
      { code: 'provenance', passed: true, detail: 'Relationship established through Mercer & Bly on 5 August, before any offering conversation.', certainty: 'known', as_of: '2026-08-05' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'strong', certainty: 'known', finding: 'Almost all private exposure is through managers rather than directs.', as_of: '2026-08-11' },
      { code: 'manager_stage', grade: 'strong', certainty: 'known', finding: 'Four emerging-manager commitments in three years, two of them first-time funds.', as_of: '2026-08-11' },
      { code: 'check_band', grade: 'strong', certainty: 'known', finding: 'Writes $3–8M. Ours at $4.0M is mid-band for them.', as_of: '2026-09-18' },
      { code: 'fund_size', grade: 'good', certainty: 'known', finding: 'A $90M fund is small for them but inside policy at this cheque size.', as_of: '2026-08-20' },
      { code: 'thesis_fit', grade: 'strong', certainty: 'known', finding: 'Neuro sits inside their life-sciences allocation and the thesis landed in the first meeting.', as_of: '2026-08-20' },
      { code: 'industry_fit', grade: 'good', certainty: 'known', finding: 'Two prior life-sciences managers, neither neuro-specific.', as_of: '2026-08-20' },
      { code: 'tech_disposition', grade: 'neutral', certainty: 'inferred', finding: 'No AI or frontier-tech stance either way. They buy managers, not theses.', as_of: '2026-08-20' },
      { code: 'deployment_tempo', grade: 'strong', certainty: 'known', finding: 'Allocation ceiling was raised this year, which is a deployment signal rather than a statement.', source: 'S02', as_of: '2026-09-15' },
      { code: 'vc_exposure', grade: 'strong', certainty: 'known', finding: 'Life sciences moved from 8% to 12% of the endowment. They are buying.', as_of: '2026-09-15' },
      { code: 'liquidity', grade: 'strong', certainty: 'known', finding: 'Endowment with a normal spending policy. Capital calls are not a constraint.', as_of: '2026-08-20' },
      { code: 'decision_speed', grade: 'good', certainty: 'known', finding: 'Indication to countersignature took sixteen days once the committee had met.', as_of: '2026-09-18' },
      { code: 'duration_tolerance', grade: 'strong', certainty: 'known', finding: 'Accepted the ten-year lock explicitly rather than negotiating it.', as_of: '2026-08-20' },
      { code: 'concession_tolerance', grade: 'weak', certainty: 'inferred', finding: 'Market-rate only. No PRI or catalytic capacity in an endowment of this shape.', as_of: '2026-08-20' },
      { code: 'signal_value', grade: 'good', certainty: 'inferred', finding: 'Known name in the endowment world; carries weight with other endowments, less with family offices.', as_of: '2026-08-20' },
      { code: 'strategic_value', grade: 'neutral', certainty: 'inferred', finding: 'Capital and credibility. No scientific network or deal flow to offer.', as_of: '2026-08-20' },
      { code: 'referral_willingness', grade: 'good', certainty: 'inferred', finding: 'Has not been asked. Mercer & Bly screen for several endowments, which is the real referral surface.', as_of: '2026-09-18' },
      { code: 'domain_sympathy', grade: 'good', certainty: 'known', finding: 'Asked about clinical timelines unprompted and did not flinch at the answer.', as_of: '2026-08-20' },
      { code: 'mission_motivation', grade: 'neutral', certainty: 'known', finding: 'None stated. This is an allocation decision, not a personal one.', as_of: '2026-08-20' },
    ],
    values: [
      { value: 'Fee discipline benchmarked against their other managers', match: 'Documented break at $4M and above, in the side letter.', grade: 'good', clear: true, action: 'Nothing. It is signed.', certainty: 'known', as_of: '2026-09-18' },
      { value: 'Independently verifiable track record', match: 'Audited marks for three prior operating-company vehicles, held by counsel.', grade: 'good', clear: true, action: 'Offer the reference calls before the next endowment asks for them.', certainty: 'known', as_of: '2026-08-20' },
      { value: 'A recycling provision that shortens the effective lock', match: 'In the LPA, and it is what moved them on duration.', grade: 'strong', clear: true, action: 'Lead with this for every endowment, not just this one.', certainty: 'known', as_of: '2026-08-20' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'familiar', sent: 'positive', evidence: 'Knew the name before the first meeting; associated it with crypto infrastructure rather than science.', certainty: 'known', as_of: '2026-08-20' },
      { subject: 'PLC Neurotech I', kind: 'vehicle', fam: 'deep', sent: 'champion', evidence: 'Countersigned $4.0M after one pitch and one follow-up.', certainty: 'known', as_of: '2026-09-18' },
      { subject: 'The neuro thesis', kind: 'thesis', fam: 'deep', sent: 'positive', evidence: '"The thesis landed in the first meeting" — their questions were all structure and fees, never the science.', certainty: 'known', as_of: '2026-08-20' },
      { subject: 'Juan', kind: 'person', fam: 'familiar', sent: 'positive', evidence: 'Ran the pitch. Lindqvist asked for him by name on the follow-up.', certainty: 'known', as_of: '2026-08-20' },
    ],
    engagement: [
      { channel: 'newsletter', behaviour: 'subscribed', detail: 'Two people from the investment team subscribed after the pitch.', on: '2026-08-22', certainty: 'known' },
    ],
    links: [
      { via: 'Mercer & Bly', kind: 'advisor', statement: 'Mercer & Bly screen managers for Cedar and put us in front of them.', band: 'moderate', weight: 'strong', certainty: 'known', source: 'S09', as_of: '2026-08-05' },
      { via: 'Ivo Lindqvist', kind: 'personal', statement: 'Lindqvist is the CIO and signed. He is now the strongest reference we have with any endowment.', band: 'moderate', weight: 'strong', certainty: 'known', as_of: '2026-09-18' },
    ],
  },

  {
    entity: 'Northwood Capital', vehicle: 'neurotech', owner: 'juan',
    headline: 'Good fit on paper, and almost everything we believe about them comes from a 2021 spreadsheet nobody can vouch for.',
    profile: { firm_class: 'mfo', iapd: true, aum: 1_400_000_000, aum_basis: 'A 2021 CSV import of unknown provenance', aum_certainty: 'guess',
      decision: 'cio', weeks: [4, 8], signs: 'Priya Raman, head of investments since September', kills: 'The families themselves, on any single allocation',
      band: [2_000_000, 8_000_000], prior: true, provenance: 'Raman asked to be contacted at the Q3 event on 28 August, before any offering material.', since: '2026-08-28' },
    gates: [
      { code: 'check_band', passed: true, detail: 'Their $2–8M band overlaps ours across its whole width.', certainty: 'inferred', source: 'S11', as_of: '2021-06-01' },
      { code: 'mandate', passed: null, detail: 'Emerging-manager programme is active, but nobody has confirmed whether it permits a single-sector first-time fund. This is a question, not an assumption.', certainty: 'guess', as_of: '2026-09-14' },
      { code: 'duration', passed: true, detail: 'Multi-family office with a normal venture allocation. Ten years is standard for them.', certainty: 'inferred', as_of: '2026-09-08' },
      { code: 'conflict', passed: true, detail: 'No competing neuro position surfaced in diligence.', certainty: 'inferred', as_of: '2026-09-08' },
      { code: 'accredited', passed: null, detail: 'Third-party letter requested with the DDQ pack. Nothing back yet.', certainty: 'known', as_of: '2026-09-08' },
      { code: 'provenance', passed: true, detail: 'Raman asked to be contacted at the Q3 event on 28 August. Recorded the same day.', certainty: 'known', as_of: '2026-08-28' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'strong', certainty: 'known', finding: 'Emerging-manager programme takes three to five new managers a year.', source: 'S02', as_of: '2026-09-14' },
      { code: 'manager_stage', grade: 'good', certainty: 'inferred', finding: 'The programme exists for emerging managers. Whether first-time single-sector qualifies is the open question.', as_of: '2026-09-14' },
      { code: 'check_band', grade: 'good', certainty: 'guess', finding: '$2–8M, from the same 2021 CSV as the AUM figure. Treat as a starting point, not a fact.', source: 'S11', as_of: '2021-06-01' },
      { code: 'fund_size', grade: 'good', certainty: 'inferred', finding: 'A $90M fund is small for a $1.4B office but well inside a three-to-five-managers-a-year programme.', as_of: '2026-09-08' },
      { code: 'thesis_fit', grade: 'neutral', certainty: 'known', finding: 'Frontier science is not a stated focus. They liked the thesis in the room and did not seek it out.', as_of: '2026-09-08' },
      { code: 'industry_fit', grade: 'weak', certainty: 'known', finding: 'No neuro or BCI position on record. Nothing adjacent either.', as_of: '2026-09-08' },
      { code: 'tech_disposition', grade: 'neutral', certainty: 'inferred', finding: 'Generalist. No AI-forward or frontier-tech posture visible in anything public.', as_of: '2026-09-08' },
      { code: 'deployment_tempo', grade: 'good', certainty: 'inferred', finding: 'Asked for a DDQ pack within a week of meeting, which is fast for a multi-family office.', as_of: '2026-09-08' },
      { code: 'vc_exposure', grade: 'neutral', certainty: 'guess', finding: 'No signal either way. Nobody has asked whether venture is over or under target for them.', as_of: '2026-09-08' },
      { code: 'liquidity', grade: 'good', certainty: 'inferred', finding: 'Nine families, diversified. Liquidity is not the constraint; policy is.', as_of: '2026-09-08' },
      { code: 'decision_speed', grade: 'good', certainty: 'known', finding: 'CIO-decided, four to eight weeks. Inside the window if diligence starts now.', as_of: '2026-09-18' },
      { code: 'duration_tolerance', grade: 'good', certainty: 'inferred', finding: 'Standard venture allocations already in place. The horizon is not new to them.', as_of: '2026-09-08' },
      { code: 'concession_tolerance', grade: 'weak', certainty: 'inferred', finding: 'Market-rate. A multi-family office cannot take a concessionary position on behalf of nine families.', as_of: '2026-09-08' },
      { code: 'signal_value', grade: 'good', certainty: 'inferred', finding: 'A $1.4B multi-family office on the register reads well to other offices of that size.', as_of: '2026-09-08' },
      { code: 'strategic_value', grade: 'neutral', certainty: 'inferred', finding: 'Capital, and access to nine families over time. No scientific network.', as_of: '2026-09-08' },
      { code: 'referral_willingness', grade: 'neutral', certainty: 'guess', finding: 'Unknown. Never asked, and there is no basis to assume either way.', as_of: '2026-09-08' },
      { code: 'domain_sympathy', grade: 'weak', certainty: 'known', finding: 'Wants the operating-company marks independently verified before discussing the science at all.', as_of: '2026-09-08' },
      { code: 'mission_motivation', grade: 'neutral', certainty: 'known', finding: 'None stated publicly by anyone there. This is a portfolio decision.', as_of: '2026-09-08' },
    ],
    values: [
      { value: 'Independently verified track record before anything else', match: 'Audited marks exist and are held by counsel; independent verification has not been arranged.', grade: 'neutral', clear: false, action: 'Arrange the third-party verification now. It is the stated blocker and it is answerable.', certainty: 'known', as_of: '2026-09-08' },
      { value: 'Knowing who else sits on the investment committee', match: 'No external IC; GPs decide with an advisory board on conflicts.', grade: 'good', clear: true, action: 'Already answered in the room, and the answer is in the library.', certainty: 'known', as_of: '2026-09-08' },
      { value: 'A 2026 emerging-manager slot that is not already spoken for', match: 'We do not know whether one is open. They raised it, not us.', grade: 'neutral', clear: false, action: 'Ask Raman directly whether a 2026 slot exists before spending more diligence effort.', certainty: 'known', as_of: '2026-09-08' },
      { value: 'A valuation policy for pre-revenue assets they can defend to nine families', match: 'We have one; it has never been written up for an external reader.', grade: 'neutral', clear: false, action: 'Write the valuation-policy note. It is a DDQ answer that will be asked again.', certainty: 'known', as_of: '2026-10-07' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'heard_of', sent: 'neutral', evidence: 'Recognised the name, associated it with crypto, asked how that connects to neuro.', certainty: 'known', as_of: '2026-09-08' },
      { subject: 'PLC Neurotech I', kind: 'vehicle', fam: 'familiar', sent: 'neutral', evidence: 'Sat through a 45-minute intro call and asked for the DDQ pack. Process interest, not an indication.', certainty: 'known', as_of: '2026-09-08' },
      { subject: 'The neuro thesis', kind: 'thesis', fam: 'heard_of', sent: 'neutral', evidence: 'No terms discussed and no number mentioned by either side. The thesis was not the conversation.', certainty: 'known', as_of: '2026-09-08' },
      { subject: 'Juan', kind: 'person', fam: 'familiar', sent: 'positive', evidence: 'Raman asked to be contacted directly after meeting him at the Q3 event.', certainty: 'known', as_of: '2026-08-28' },
      { subject: 'The operating-company track record', kind: 'portfolio', fam: 'familiar', sent: 'skeptical', evidence: 'Wants it independently verified. That is the objection, stated plainly.', certainty: 'known', as_of: '2026-09-08' },
    ],
    engagement: [
      { channel: 'event', behaviour: 'attended', detail: 'Raman attended the Q3 event where the thesis was presented.', on: '2026-08-28', certainty: 'known' },
      { channel: 'x', behaviour: 'follows', detail: 'The firm account follows Juan. No engagement on any post.', on: '2026-09-12', certainty: 'inferred' },
    ],
    links: [
      { via: 'Priya Raman', kind: 'personal', statement: 'Met Juan at the Q3 event and asked to be contacted. This is the route, and it is direct.', band: 'moderate', weight: 'strong', certainty: 'known', as_of: '2026-08-28' },
      { via: 'Anne Quill', kind: 'co_investor', statement: 'Quill appears alongside Northwood in a 2021 co-investor list nobody can vouch for. Treat as a lead, not a link.', band: 'weak', weight: 'weak', certainty: 'guess', source: 'S11', as_of: '2021-06-01' },
    ],
  },

  {
    entity: 'Whitcomb Capital', vehicle: 'neurotech', owner: 'juan',
    headline: 'They want to come in and they cannot, on a technicality that is not negotiable.',
    profile: { firm_class: 'sfo', iapd: false, aum: 8_000_000, aum_basis: 'Stated by Whitcomb, unconfirmed since August', aum_certainty: 'guess',
      decision: 'principal', weeks: [1, 3], signs: 'Whitcomb himself', kills: 'Nobody else',
      band: [1_000_000, 5_000_000], prior: true, provenance: 'Wired the Cortex SPV in September. The relationship long predates this vehicle.', since: '2026-08-10' },
    gates: [
      { code: 'check_band', passed: true, detail: '$5.0M soft sits inside our band.', certainty: 'known', as_of: '2026-09-09' },
      { code: 'mandate', passed: true, detail: 'No mandate to breach. A principal-controlled single family office decides case by case.', certainty: 'known', as_of: '2026-09-09' },
      { code: 'duration', passed: true, detail: 'Took the Cortex SPV without raising duration at all.', certainty: 'known', as_of: '2026-09-09' },
      { code: 'conflict', passed: true, detail: 'No competing position.', certainty: 'known', as_of: '2026-09-09' },
      { code: 'accredited', passed: false, detail: 'Only a self-certification is on file. PLC Neurotech I is 506(c), where self-certification is not reasonable steps no matter who signed it.', certainty: 'known', as_of: '2026-08-14' },
      { code: 'provenance', passed: true, detail: 'Existing investor in the Cortex SPV; relationship established well before this offering.', certainty: 'known', as_of: '2026-08-10' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'good', certainty: 'known', finding: 'Took the Cortex SPV, which is the same thesis in a smaller wrapper.', as_of: '2026-09-09' },
      { code: 'manager_stage', grade: 'strong', certainty: 'known', finding: 'Principal-controlled. First-time manager is not a category they think in.', as_of: '2026-09-09' },
      { code: 'check_band', grade: 'good', certainty: 'known', finding: '$2.5M into Cortex, $5.0M soft here. Both inside band.', as_of: '2026-09-09' },
      { code: 'fund_size', grade: 'good', certainty: 'inferred', finding: 'A $5M cheque against a stated $8M budget is most of their capacity. That is the real ceiling.', as_of: '2026-08-01' },
      { code: 'thesis_fit', grade: 'strong', certainty: 'known', finding: 'Already bought the thesis once at SPV scale.', as_of: '2026-09-09' },
      { code: 'industry_fit', grade: 'strong', certainty: 'known', finding: 'Cortex is a neuro position. This is the only prospect with one already on the books through us.', as_of: '2026-09-09' },
      { code: 'tech_disposition', grade: 'good', certainty: 'inferred', finding: 'Frontier-tech disposition evident from the SPV appetite.', as_of: '2026-09-09' },
      { code: 'deployment_tempo', grade: 'strong', certainty: 'known', finding: 'Wired the SPV nineteen days after allocation. They do what they say.', as_of: '2026-09-09' },
      { code: 'vc_exposure', grade: 'good', certainty: 'guess', finding: 'Appears to be building venture exposure, on one data point.', as_of: '2026-09-09' },
      { code: 'liquidity', grade: 'neutral', certainty: 'guess', finding: 'A stated $8M budget with $7.5M already committed across two of our vehicles. Headroom is thin.', as_of: '2026-08-01' },
      { code: 'decision_speed', grade: 'strong', certainty: 'known', finding: 'One to three weeks, principal-decided. The fastest counterparty on this list.', as_of: '2026-09-09' },
      { code: 'duration_tolerance', grade: 'good', certainty: 'inferred', finding: 'Took a ten-year instrument without negotiating it.', as_of: '2026-09-09' },
      { code: 'concession_tolerance', grade: 'weak', certainty: 'guess', finding: 'No basis to think so. Never asked.', as_of: '2026-09-09' },
      { code: 'signal_value', grade: 'neutral', certainty: 'inferred', finding: 'Not a name other LPs read as validation.', as_of: '2026-09-09' },
      { code: 'strategic_value', grade: 'good', certainty: 'known', finding: 'Proved the SPV mechanism works end to end, which was worth more than the cheque.', as_of: '2026-09-09' },
      { code: 'referral_willingness', grade: 'good', certainty: 'guess', finding: 'Plausible given how the SPV went. Never asked.', as_of: '2026-09-09' },
      { code: 'domain_sympathy', grade: 'good', certainty: 'inferred', finding: 'Did not ask about clinical timelines, which usually means they already understand them.', as_of: '2026-09-09' },
      { code: 'mission_motivation', grade: 'neutral', certainty: 'known', finding: 'None stated publicly.', as_of: '2026-09-09' },
    ],
    values: [
      { value: 'Moving fast without a process tax', match: 'The SPV wired in thirty days from invite.', grade: 'strong', clear: true, action: 'Nothing to prove here.', certainty: 'known', as_of: '2026-09-09' },
      { value: 'Not handing financial documents to a manager', match: 'We cannot waive this. 506(c) requires verification, and a self-certification does not meet it.', grade: 'blocker', clear: false, action: 'Explain why the SPV was different, and offer the CPA-letter route, which does not require sending us anything.', certainty: 'known', as_of: '2026-08-14' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'deep', sent: 'positive', evidence: 'Long-standing relationship predating both vehicles.', certainty: 'known', as_of: '2026-08-10' },
      { subject: 'PLC Neurotech I', kind: 'vehicle', fam: 'familiar', sent: 'positive', evidence: 'Indicated $5.0M soft without being pushed.', certainty: 'known', as_of: '2026-09-09' },
      { subject: 'The neuro thesis', kind: 'thesis', fam: 'deep', sent: 'champion', evidence: 'Bought it at SPV scale and came back for the fund.', certainty: 'known', as_of: '2026-09-09' },
    ],
    links: [
      { kind: 'they_lp_in_us', statement: 'Wired $2.5M into SPV — Cortex on 9 September. The strongest form of prior relationship there is.', band: 'strong', weight: 'strong', certainty: 'known', as_of: '2026-09-09' },
    ],
  },

  {
    entity: 'Roos Foundation', vehicle: 'neurotech', owner: 'juan',
    headline: 'The best thesis fit in the universe, and seven years of evidence that they do not do this.',
    profile: { firm_class: 'foundation', iapd: false, aum: 5_000_000, aum_basis: 'Forwarded letter excerpt S03 — an excerpt, not a statement to us', aum_certainty: 'guess',
      decision: 'principal', weeks: [4, 12], signs: 'Delia Roos, sole trustee', kills: 'Her counsel, on the §4944(c) question',
      band: [2_000_000, 5_000_000], prior: false, provenance: 'Duettmann has offered to ask. No relationship with the foundation itself.' },
    gates: [
      { code: 'check_band', passed: true, detail: '$2–5M band overlaps ours, from a forwarded excerpt rather than a statement to us.', certainty: 'guess', source: 'S03', as_of: '2026-08-30' },
      { code: 'mandate', passed: null, detail: 'Nobody knows whether the trust deed permits a fund LP position at all. Forty-seven grants over seven years include none.', certainty: 'known', source: 'S02', as_of: '2026-09-14' },
      { code: 'duration', passed: true, detail: 'Recoverable grants already run on multi-year horizons.', certainty: 'inferred', source: 'S02', as_of: '2026-09-14' },
      { code: 'conflict', passed: true, detail: 'No competing position. They fund research, not managers.', certainty: 'inferred', as_of: '2026-09-14' },
      { code: 'accredited', passed: true, detail: 'A foundation of this size qualifies comfortably.', certainty: 'inferred', as_of: '2026-09-12' },
      { code: 'provenance', passed: null, detail: 'No pre-existing substantive relationship. Duettmann has offered to ask, which is the first rung and nothing more.', certainty: 'known', source: 'S04', as_of: '2026-09-14' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'weak', certainty: 'known', finding: 'No LP positions at all in the seven-year grants export. Thirty-nine outright grants, six recoverable, two PRIs.', source: 'S02', as_of: '2026-09-14' },
      { code: 'manager_stage', grade: 'neutral', certainty: 'guess', finding: 'Not a category they operate in, so it is neither a pass nor a fail.', as_of: '2026-09-14' },
      { code: 'check_band', grade: 'good', certainty: 'guess', finding: '$2–5M for a new relationship, from a forwarded excerpt.', source: 'S03', as_of: '2026-08-30' },
      { code: 'fund_size', grade: 'neutral', certainty: 'guess', finding: 'Irrelevant to a foundation making a PRI rather than an LP commitment.', as_of: '2026-09-14' },
      { code: 'thesis_fit', grade: 'strong', certainty: 'known', finding: 'Forty-seven grants concentrated in neurodegeneration and longevity biology — exactly our field.', source: 'S02', as_of: '2026-09-14' },
      { code: 'industry_fit', grade: 'strong', certainty: 'known', finding: 'A $3.2M recoverable grant to a translational neuro programme in June.', source: 'S06', as_of: '2026-06-18' },
      { code: 'tech_disposition', grade: 'neutral', certainty: 'guess', finding: 'Science-forward rather than technology-forward. Not the same disposition.', as_of: '2026-09-14' },
      { code: 'deployment_tempo', grade: 'good', certainty: 'known', finding: 'Deployed in June and again in September. Actively giving.', source: 'S06', as_of: '2026-09-16' },
      { code: 'vc_exposure', grade: 'weak', certainty: 'known', finding: 'Zero venture exposure on record, and no sign of seeking any.', source: 'S02', as_of: '2026-09-14' },
      { code: 'liquidity', grade: 'good', certainty: 'inferred', finding: 'A foundation with a payout obligation has to deploy. That is a structural tailwind.', as_of: '2026-09-14' },
      { code: 'decision_speed', grade: 'neutral', certainty: 'inferred', finding: 'Sole trustee, so fast in principle — but an unresolved §4944(c) question from 2024 sits in front of it.', source: 'S10', as_of: '2026-09-12' },
      { code: 'duration_tolerance', grade: 'strong', certainty: 'inferred', finding: 'Recoverable grants are long-horizon by construction.', as_of: '2026-09-14' },
      { code: 'concession_tolerance', grade: 'strong', certainty: 'known', finding: 'Two PRIs already made. This is the one prospect who can take a concessionary position by design.', source: 'S02', as_of: '2026-09-14' },
      { code: 'signal_value', grade: 'good', certainty: 'inferred', finding: 'A named neuro foundation on the register would read well to other science philanthropists.', as_of: '2026-09-14' },
      { code: 'strategic_value', grade: 'strong', certainty: 'inferred', finding: 'Deep scientific network in exactly our field, and a view of the grant landscape we do not have.', as_of: '2026-09-14' },
      { code: 'referral_willingness', grade: 'neutral', certainty: 'guess', finding: 'Unknown, and the do-not-approach instruction suggests caution about asking.', as_of: '2026-09-08' },
      { code: 'domain_sympathy', grade: 'strong', certainty: 'known', finding: 'Funds twelve-year science for a living. Nobody needs to explain the timeline.', source: 'S02', as_of: '2026-09-14' },
      { code: 'mission_motivation', grade: 'good', certainty: 'known', finding: 'The foundation exists for this field. Recorded from its public grant history and nothing else.', source: 'S02', as_of: '2026-09-14' },
    ],
    values: [
      { value: 'Instruments that are grants with a return, not fund positions', match: 'We can structure a PRI. It is a different instrument from the LP position we are otherwise selling.', grade: 'good', clear: false, action: 'Lead with the PRI structure note, not the primer. The LP path is the wrong opening with this foundation.', certainty: 'known', source: 'S02', as_of: '2026-09-14' },
      { value: 'A resolved §4944(c) position before anything is signed', match: 'Our only note on it is from March 2024 and expired. We cannot answer this today.', grade: 'weak', clear: false, action: 'Get counsel to refresh the §4944(c) position. It is the blocker and it is two years stale.', certainty: 'known', source: 'S10', as_of: '2024-03-11' },
      { value: 'Not being approached through channels they have closed', match: 'A restriction is on file and the route planner enforces it.', grade: 'good', clear: false, action: 'Nothing to say to them. The work is on our side, and it is already done.', certainty: 'known', source: 'S05', as_of: '2026-09-08' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'unaware', sent: 'unknown', evidence: 'Nothing on file suggests anyone there has heard of us.', certainty: 'guess', as_of: '2026-09-14' },
      { subject: 'PLC Neurotech I', kind: 'vehicle', fam: 'unaware', sent: 'unknown', evidence: 'No contact has been made. The connector has not asked yet.', certainty: 'known', source: 'S04', as_of: '2026-09-14' },
    ],
    links: [
      { via: 'Allison Duettmann', kind: 'advisor', statement: 'Roos publicly cited a memo Duettmann co-authored. Duettmann has offered to ask — the only tier-A route.', band: 'moderate', weight: 'strong', certainty: 'known', source: 'S06', as_of: '2026-09-14' },
      { via: 'Michael Okonjo', kind: 'board', statement: 'Both served on a research charity board until December 2023. Affiliation only — no evidence they ever spoke.', band: 'weak', weight: 'weak', certainty: 'known', source: 'S09', as_of: '2023-12-31' },
      { via: 'Jonah Hale', kind: 'advisor', statement: 'Hale introduced Roos to two managers in 2023. She has since asked not to be introduced through him.', band: 'moderate', weight: 'blocker', certainty: 'known', source: 'S05', as_of: '2026-09-08' },
    ],
  },

  {
    entity: 'Sable Point Capital', vehicle: 'neurotech', owner: 'juan',
    headline: 'The class whose whole business is backing managers like us, and we have no way to reach them.',
    profile: { firm_class: 'fof', iapd: true, aum: 470_000_000, aum_basis: 'Their own announced fund size', aum_certainty: 'known',
      decision: 'small_ic', weeks: [12, 24], signs: 'Investment committee', kills: 'Any committee member',
      band: [2_000_000, 10_000_000], prior: false, provenance: 'No relationship. Nobody in the census has a path.' },
    gates: [
      { code: 'check_band', passed: true, detail: '$2–10M. Well inside ours.', certainty: 'known', as_of: '2026-09-01' },
      { code: 'mandate', passed: true, detail: 'The mandate is explicitly first-time and emerging managers. This is the rare case where being a Fund I is the qualification.', certainty: 'known', as_of: '2026-09-01' },
      { code: 'duration', passed: true, detail: 'A fund-of-funds underwriting seed managers. Duration is the product.', certainty: 'known', as_of: '2026-09-01' },
      { code: 'conflict', passed: null, detail: 'Unknown whether they already back a neuro-adjacent manager. Worth checking before any approach.', certainty: 'guess', as_of: '2026-09-01' },
      { code: 'accredited', passed: true, detail: 'An institutional fund-of-funds. Not in question.', certainty: 'known', as_of: '2026-09-01' },
      { code: 'provenance', passed: null, detail: 'No pre-existing substantive relationship and no confirmed introduction. Not a legal bar on a 506(c) vehicle, but it is the practical one: nobody has a way in.', certainty: 'known', as_of: '2026-09-20' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'strong', certainty: 'known', finding: 'It is the only thing they do.', as_of: '2026-09-01' },
      { code: 'manager_stage', grade: 'strong', certainty: 'known', finding: 'Explicitly underwrites first-time managers. The mandate is the fit.', as_of: '2026-09-01' },
      { code: 'check_band', grade: 'strong', certainty: 'known', finding: '$2–10M into funds of our size.', as_of: '2026-09-01' },
      { code: 'fund_size', grade: 'strong', certainty: 'known', finding: 'Built for the $50–150M band. We are in the middle of it.', as_of: '2026-09-01' },
      { code: 'thesis_fit', grade: 'good', certainty: 'inferred', finding: 'Sector-agnostic by design, which means the thesis has to win on its own merits rather than on their prior interest.', as_of: '2026-09-01' },
      { code: 'industry_fit', grade: 'neutral', certainty: 'guess', finding: 'No published neuro position. Also no published anything — their portfolio is not disclosed.', as_of: '2026-09-01' },
      { code: 'tech_disposition', grade: 'good', certainty: 'inferred', finding: 'Seed-stage manager backers are structurally tech-forward.', as_of: '2026-09-01' },
      { code: 'deployment_tempo', grade: 'good', certainty: 'known', finding: 'Closed a new vehicle recently, so they are deploying rather than harvesting.', as_of: '2026-09-01' },
      { code: 'vc_exposure', grade: 'strong', certainty: 'known', finding: 'Venture exposure is the mandate, not an allocation decision.', as_of: '2026-09-01' },
      { code: 'liquidity', grade: 'strong', certainty: 'known', finding: 'Freshly closed fund. Dry powder is not the question.', as_of: '2026-09-01' },
      { code: 'decision_speed', grade: 'weak', certainty: 'known', finding: 'Twelve to twenty-four weeks through a committee. That lands well after the December close.', as_of: '2026-09-01' },
      { code: 'duration_tolerance', grade: 'strong', certainty: 'known', finding: 'Underwriting ten-year funds is their business.', as_of: '2026-09-01' },
      { code: 'concession_tolerance', grade: 'weak', certainty: 'inferred', finding: 'Market-rate fiduciary capital.', as_of: '2026-09-01' },
      { code: 'signal_value', grade: 'strong', certainty: 'known', finding: 'A seeder on the register is the single strongest validation signal available to a Fund I.', as_of: '2026-09-01' },
      { code: 'strategic_value', grade: 'strong', certainty: 'known', finding: 'Even a pass with real feedback is worth more than twenty polite family-office meetings. They are the cheapest calibration available.', as_of: '2026-09-01' },
      { code: 'referral_willingness', grade: 'strong', certainty: 'inferred', finding: 'Seeders introduce their managers to their own LP base. That is much of the product.', as_of: '2026-09-01' },
      { code: 'domain_sympathy', grade: 'neutral', certainty: 'guess', finding: 'Generalist. Twelve-year horizons will need explaining rather than assuming.', as_of: '2026-09-01' },
      { code: 'mission_motivation', grade: 'neutral', certainty: 'known', finding: 'Not applicable to an institutional allocator.', as_of: '2026-09-01' },
    ],
    values: [
      { value: 'A manager who has already assembled a real LP base', match: '$56M hard from four institutions. That is the strongest thing we can say to a seeder.', grade: 'strong', clear: false, action: 'This is the opening line when a route exists. It is currently said to nobody.', certainty: 'known', as_of: '2026-09-20' },
      { value: 'An inspectable sourcing edge, not a claimed one', match: 'The content operation and the convening programme are evidence of edge — but nothing is packaged for an allocator to inspect.', grade: 'neutral', clear: false, action: 'Package the sourcing edge as a document before approaching. It is the question they will ask second.', certainty: 'inferred', as_of: '2026-09-20' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'heard_of', sent: 'unknown', evidence: 'Unverified. A seeder of this kind reads widely, so assuming zero awareness is probably wrong — but we have no evidence either way.', certainty: 'guess', as_of: '2026-09-20' },
      { subject: 'PLC Neurotech I', kind: 'vehicle', fam: 'unaware', sent: 'unknown', evidence: 'No contact of any kind.', certainty: 'known', as_of: '2026-09-20' },
    ],
    links: [],
  },

  {
    entity: 'Tessaro Family Office', vehicle: 'neurotech', owner: 'mara',
    headline: 'Publicly stated interest in exactly this field, and nobody has ever spoken to them.',
    profile: { firm_class: 'sfo', iapd: false, aum: 300_000_000, aum_basis: 'Inferred from a fifteen-person office and industry operating-cost heuristics', aum_certainty: 'guess',
      decision: 'principal', weeks: [2, 6], signs: 'The principal', kills: 'Nobody else',
      band: [1_000_000, 4_000_000], prior: false, provenance: 'No relationship. A podcast route exists but has not been used.' },
    gates: [
      { code: 'check_band', passed: true, detail: '$1–4M, inferred from their disclosed direct positions.', certainty: 'inferred', as_of: '2026-09-02' },
      { code: 'mandate', passed: true, detail: 'A single family office with no written mandate to breach.', certainty: 'inferred', as_of: '2026-09-02' },
      { code: 'duration', passed: true, detail: 'Direct positions held for seven years and counting.', certainty: 'inferred', as_of: '2026-09-02' },
      { code: 'conflict', passed: true, detail: 'No competing neuro fund position visible.', certainty: 'guess', as_of: '2026-09-02' },
      { code: 'accredited', passed: true, detail: 'Plausible without question at this scale; verification would still be required for a 506(c) subscription.', certainty: 'inferred', as_of: '2026-09-02' },
      { code: 'provenance', passed: null, detail: 'No relationship. A podcast-guest route exists through the connector pool and has not been tried.', certainty: 'known', as_of: '2026-09-20' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'neutral', certainty: 'guess', finding: 'Mostly directs on the public record. Whether they take fund positions is unknown.', as_of: '2026-09-02' },
      { code: 'manager_stage', grade: 'good', certainty: 'guess', finding: 'Principal-controlled offices rarely screen on manager vintage.', as_of: '2026-09-02' },
      { code: 'check_band', grade: 'good', certainty: 'inferred', finding: 'Disclosed direct positions cluster at $1–4M.', as_of: '2026-09-02' },
      { code: 'fund_size', grade: 'good', certainty: 'guess', finding: 'No constraint visible at this cheque size.', as_of: '2026-09-02' },
      { code: 'thesis_fit', grade: 'strong', certainty: 'known', finding: 'The principal has spoken publicly about wanting more exposure to frontier neuroscience.', as_of: '2026-09-02' },
      { code: 'industry_fit', grade: 'good', certainty: 'inferred', finding: 'Two disclosed direct positions in adjacent health technology.', as_of: '2026-09-02' },
      { code: 'tech_disposition', grade: 'strong', certainty: 'inferred', finding: 'The disclosed book is almost entirely frontier technology.', as_of: '2026-09-02' },
      { code: 'deployment_tempo', grade: 'good', certainty: 'inferred', finding: 'Three new direct positions this year.', as_of: '2026-09-02' },
      { code: 'vc_exposure', grade: 'good', certainty: 'guess', finding: 'Appears to be increasing. Inferred from position count, which is a weak basis.', as_of: '2026-09-02' },
      { code: 'liquidity', grade: 'good', certainty: 'guess', finding: 'A fifteen-person office implies scale; the actual liquidity position is not observable.', as_of: '2026-09-02' },
      { code: 'decision_speed', grade: 'strong', certainty: 'inferred', finding: 'Principal-decided, two to six weeks. Comfortably inside the window.', as_of: '2026-09-02' },
      { code: 'duration_tolerance', grade: 'good', certainty: 'inferred', finding: 'Seven-year holds on the public record.', as_of: '2026-09-02' },
      { code: 'concession_tolerance', grade: 'neutral', certainty: 'guess', finding: 'Unknown.', as_of: '2026-09-02' },
      { code: 'signal_value', grade: 'neutral', certainty: 'guess', finding: 'Not a widely known name outside their own circle.', as_of: '2026-09-02' },
      { code: 'strategic_value', grade: 'good', certainty: 'guess', finding: 'A principal with a stated interest in the field is a potential advocate, not just a cheque.', as_of: '2026-09-02' },
      { code: 'referral_willingness', grade: 'neutral', certainty: 'guess', finding: 'Unknown. Never asked.', as_of: '2026-09-02' },
      { code: 'domain_sympathy', grade: 'strong', certainty: 'known', finding: 'Has talked publicly about the timelines in this field being the reason most investors avoid it.', as_of: '2026-09-02' },
      { code: 'mission_motivation', grade: 'strong', certainty: 'known', finding: 'A publicly stated interest in this field, recorded from what the principal said in public and nothing else.', as_of: '2026-09-02' },
    ],
    values: [
      { value: 'Conviction over consensus', match: 'A concentrated neuro fund is the opposite of a diversified allocation. That is the pitch, not a caveat.', grade: 'strong', clear: false, action: 'They have never heard it. Get the introduction first.', certainty: 'inferred', as_of: '2026-09-20' },
      { value: 'Direct access to the science, not just the returns', match: 'The convening programme and the adviser bench are exactly this, and they are not packaged for an LP.', grade: 'good', clear: false, action: 'Offer a seat at the next convening before offering a subscription document.', certainty: 'inferred', as_of: '2026-09-20' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'unaware', sent: 'unknown', evidence: 'No evidence of any awareness.', certainty: 'guess', as_of: '2026-09-20' },
      { subject: 'PLC Neurotech I', kind: 'vehicle', fam: 'unaware', sent: 'unknown', evidence: 'No contact.', certainty: 'known', as_of: '2026-09-20' },
      { subject: 'The neuro thesis', kind: 'thesis', fam: 'deep', sent: 'champion', evidence: 'They hold the thesis independently of us, which is the ideal starting position and has nothing to do with us yet.', certainty: 'known', as_of: '2026-09-02' },
    ],
    engagement: [
      { channel: 'podcast', behaviour: 'cited', detail: 'The principal named two of our podcast guests as people they follow, in a public interview.', on: '2026-09-02', certainty: 'known' },
    ],
    links: [
      { via: 'Allison Duettmann', kind: 'advisor', statement: 'Duettmann is one of the two people the principal named publicly. A podcast-guest route with genuine credibility on this topic.', band: 'moderate', weight: 'strong', certainty: 'inferred', as_of: '2026-09-02' },
    ],
  },

  {
    entity: 'Okonjo Family Office', vehicle: 'neurotech', owner: 'juan',
    headline: 'Three weeks of silence after a warm introduction, which is information rather than an absence of it.',
    profile: { firm_class: 'sfo', iapd: false, aum: 5_000_000, aum_basis: 'Inferred from their last three commitments', aum_certainty: 'guess',
      decision: 'principal', weeks: [2, 8], signs: 'Michael Okonjo', kills: 'Nobody else',
      band: [1_000_000, 3_500_000], prior: true, provenance: 'Introduced by Duettmann on 21 August. Relationship exists but is thin.', since: '2026-08-21' },
    gates: [
      { code: 'check_band', passed: true, detail: '$3.5M soft sits inside our band.', certainty: 'inferred', as_of: '2026-08-21' },
      { code: 'mandate', passed: true, detail: 'No mandate. Principal decides.', certainty: 'known', as_of: '2026-08-21' },
      { code: 'duration', passed: true, detail: 'No signal against it.', certainty: 'guess', as_of: '2026-08-21' },
      { code: 'conflict', passed: true, detail: 'None visible.', certainty: 'inferred', as_of: '2026-08-21' },
      { code: 'accredited', passed: null, detail: 'Never requested. Would be required before any subscription on a 506(c) vehicle.', certainty: 'known', as_of: '2026-09-20' },
      { code: 'provenance', passed: true, detail: 'Duettmann forwarded the opt-in request on 21 August.', certainty: 'known', as_of: '2026-08-21' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'good', certainty: 'inferred', finding: 'Routes most private exposure through funds rather than directs.', as_of: '2026-08-21' },
      { code: 'manager_stage', grade: 'good', certainty: 'guess', finding: 'Principal-controlled; manager vintage is unlikely to be a screen.', as_of: '2026-08-21' },
      { code: 'check_band', grade: 'good', certainty: 'guess', finding: '$1–3.5M inferred from their last three commitments.', as_of: '2026-07-15' },
      { code: 'fund_size', grade: 'good', certainty: 'guess', finding: 'No constraint at this cheque size.', as_of: '2026-07-15' },
      { code: 'thesis_fit', grade: 'neutral', certainty: 'guess', finding: 'Generalist with a neuro interest dating from a 2024 panel and nothing since.', source: 'S07', as_of: '2024-11-05' },
      { code: 'industry_fit', grade: 'weak', certainty: 'guess', finding: 'A single conference appearance is the entire evidence base. That is co-attendance, not interest.', source: 'S07', as_of: '2024-11-05' },
      { code: 'tech_disposition', grade: 'neutral', certainty: 'guess', finding: 'Unknown.', as_of: '2026-08-21' },
      { code: 'deployment_tempo', grade: 'weak', certainty: 'inferred', finding: 'Three weeks of silence after a warm introduction usually means not now.', as_of: '2026-09-11' },
      { code: 'vc_exposure', grade: 'neutral', certainty: 'guess', finding: 'Unknown.', as_of: '2026-08-21' },
      { code: 'liquidity', grade: 'weak', certainty: 'inferred', finding: 'A $5M inferred budget with $6.5M already committed across two of our vehicles. The conserved-pool check flags this.', as_of: '2026-09-20' },
      { code: 'decision_speed', grade: 'good', certainty: 'known', finding: 'Principal-decided when they engage. The problem is engagement, not speed.', as_of: '2026-08-21' },
      { code: 'duration_tolerance', grade: 'neutral', certainty: 'guess', finding: 'Unknown.', as_of: '2026-08-21' },
      { code: 'concession_tolerance', grade: 'neutral', certainty: 'guess', finding: 'Unknown.', as_of: '2026-08-21' },
      { code: 'signal_value', grade: 'neutral', certainty: 'guess', finding: 'Modest.', as_of: '2026-08-21' },
      { code: 'strategic_value', grade: 'good', certainty: 'known', finding: 'Okonjo is also a connector to Roos. That makes him worth keeping warm regardless of his own cheque.', source: 'S09', as_of: '2026-09-14' },
      { code: 'referral_willingness', grade: 'good', certainty: 'known', finding: 'Already carried an ask for the Rails vehicle, which is willingness demonstrated rather than assumed.', as_of: '2026-09-14' },
      { code: 'domain_sympathy', grade: 'neutral', certainty: 'guess', finding: 'Unknown.', as_of: '2026-08-21' },
      { code: 'mission_motivation', grade: 'neutral', certainty: 'known', finding: 'None stated.', as_of: '2026-08-21' },
    ],
    values: [
      { value: 'Not being asked twice for the same thing', match: 'We have one open ask and a connector at two of three. A second ask now would spend goodwill for nothing.', grade: 'good', clear: false, action: 'Do not re-ask. The November conference appearance is a cheaper contact that costs no connector goodwill.', certainty: 'known', as_of: '2026-09-11' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'heard_of', sent: 'neutral', evidence: 'Introduced by Duettmann, so aware. Nothing beyond that.', certainty: 'inferred', as_of: '2026-08-21' },
      { subject: 'PLC Neurotech I', kind: 'vehicle', fam: 'heard_of', sent: 'unknown', evidence: 'Received the opt-in request. No reply in three weeks.', certainty: 'known', as_of: '2026-09-11' },
    ],
    engagement: [
      { channel: 'event', behaviour: 'attended', detail: 'Speaking at a neurotech conference in November. Contact that costs no connector goodwill.', on: '2026-09-11', certainty: 'known' },
    ],
    links: [
      { via: 'Allison Duettmann', kind: 'advisor', statement: 'Duettmann made the introduction and is at 2 of 3 asks this quarter.', band: 'moderate', weight: 'good', certainty: 'known', as_of: '2026-08-21' },
    ],
  },

  {
    entity: 'Vantage Partners', vehicle: 'rails', owner: 'juan',
    headline: 'Committed to both funds, and the conserved-pool check says the same dollar may be counted twice.',
    profile: { firm_class: 'mfo', iapd: true, aum: 2_000_000_000, aum_basis: 'Form ADV', aum_certainty: 'known',
      decision: 'cio', weeks: [4, 8], signs: 'Their CIO', kills: 'The MFN clause, indirectly',
      band: [5_000_000, 15_000_000], prior: true, provenance: 'LP in both vehicles since May 2026.', since: '2026-05-19' },
    gates: [
      { code: 'check_band', passed: true, detail: '$12.0M hard on Rails, inside band.', certainty: 'known', as_of: '2026-05-19' },
      { code: 'mandate', passed: true, detail: 'Already committed. The mandate question is settled.', certainty: 'known', as_of: '2026-05-19' },
      { code: 'duration', passed: true, detail: 'Committed to a ten-year vehicle.', certainty: 'known', as_of: '2026-05-19' },
      { code: 'conflict', passed: null, detail: 'They filed a Form D for a new $400M vehicle in August. Whether that competes for the same capital is not known.', certainty: 'known', as_of: '2026-08-02' },
      { code: 'accredited', passed: true, detail: 'Registered-professional letter on file, verified July, valid a year.', certainty: 'known', as_of: '2026-07-02' },
      { code: 'provenance', passed: true, detail: 'LP in both vehicles.', certainty: 'known', as_of: '2026-05-19' },
    ],
    dims: [
      { code: 'invests_in_funds', grade: 'strong', certainty: 'known', finding: 'Committed to both of ours.', as_of: '2026-07-08' },
      { code: 'manager_stage', grade: 'strong', certainty: 'known', finding: 'Backed us as a first-time manager twice.', as_of: '2026-07-08' },
      { code: 'check_band', grade: 'strong', certainty: 'known', finding: '$12M and $15M. The largest cheques on either register.', as_of: '2026-07-08' },
      { code: 'fund_size', grade: 'strong', certainty: 'known', finding: 'No constraint.', as_of: '2026-07-08' },
      { code: 'thesis_fit', grade: 'good', certainty: 'known', finding: 'Bought both theses, which suggests they are buying the team rather than the sector.', as_of: '2026-07-08' },
      { code: 'industry_fit', grade: 'good', certainty: 'known', finding: 'Crypto infrastructure exposure through Rails.', as_of: '2026-05-19' },
      { code: 'tech_disposition', grade: 'strong', certainty: 'known', finding: 'Frontier technology across the disclosed book.', as_of: '2026-05-19' },
      { code: 'deployment_tempo', grade: 'strong', certainty: 'known', finding: 'Form D filed in August for a new $400M vehicle. They are raising as well as allocating.', as_of: '2026-08-02' },
      { code: 'vc_exposure', grade: 'good', certainty: 'inferred', finding: 'Increasing, on the evidence of two commitments in one year.', as_of: '2026-07-08' },
      { code: 'liquidity', grade: 'weak', certainty: 'known', finding: '$27M committed against a $25M stated budget. The conserved-pool check flags a $2M overage.', as_of: '2026-09-20' },
      { code: 'decision_speed', grade: 'good', certainty: 'known', finding: 'CIO-decided, four to eight weeks.', as_of: '2026-05-19' },
      { code: 'duration_tolerance', grade: 'strong', certainty: 'known', finding: 'Two ten-year commitments.', as_of: '2026-07-08' },
      { code: 'concession_tolerance', grade: 'weak', certainty: 'known', finding: 'They negotiated an MFN, which is the opposite of concessionary.', as_of: '2026-07-08' },
      { code: 'signal_value', grade: 'strong', certainty: 'known', finding: 'A $2B office committing twice is the strongest social proof on either register.', as_of: '2026-07-08' },
      { code: 'strategic_value', grade: 'good', certainty: 'known', finding: 'Access to their own network, untested because nobody has asked.', as_of: '2026-07-08' },
      { code: 'referral_willingness', grade: 'neutral', certainty: 'guess', finding: 'Never asked. Report 6 is blunt that under-asking existing LPs is the most common mistake managers make.', as_of: '2026-09-20' },
      { code: 'domain_sympathy', grade: 'good', certainty: 'inferred', finding: 'Two long-horizon commitments without renegotiation.', as_of: '2026-07-08' },
      { code: 'mission_motivation', grade: 'neutral', certainty: 'known', finding: 'None stated. A portfolio decision.', as_of: '2026-07-08' },
    ],
    values: [
      { value: 'Most-favoured-nation treatment on fees and reporting', match: 'Granted. The Cedar fee break now triggers it and they have not been told.', grade: 'weak', clear: false, action: 'Tell them about the Cedar break before they find it. This is a relationship risk, not a paperwork one.', certainty: 'known', as_of: '2026-09-18' },
      { value: 'Portfolio-level reporting detail', match: 'Quarterly reporting is in place and falls under their MFN.', grade: 'good', clear: true, action: 'Nothing.', certainty: 'known', as_of: '2026-06-30' },
    ],
    perception: [
      { subject: 'Protocol Labs', kind: 'firm', fam: 'deep', sent: 'champion', evidence: 'Committed to both vehicles inside one year.', certainty: 'known', as_of: '2026-07-08' },
      { subject: 'PLC Crypto/Rails', kind: 'vehicle', fam: 'deep', sent: 'champion', evidence: '$12.0M hard, wired in June.', certainty: 'known', as_of: '2026-06-02' },
    ],
    links: [
      { kind: 'they_lp_in_us', statement: 'LP in both vehicles. The highest-credibility referral source available for other LPs, and never asked.', band: 'strong', weight: 'strong', certainty: 'known', as_of: '2026-07-08' },
    ],
  },
];

export async function seedFit(db: Db): Promise<{ firmProfiles: number; assessments: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from fit.assessment');
  if (existing && Number(existing.n) > 0) return { firmProfiles: 0, assessments: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;

  await db.transaction(async (tx) => {
    const seenProfiles = new Set<string>();
    for (const s of SPECS) {
      const entityId = e(s.entity);
      if (!seenProfiles.has(entityId)) {
        seenProfiles.add(entityId);
        const p = s.profile;
        await tx.query(
          `insert into fit.firm_profile
             (entity_id, firm_class, iapd_registered, est_aum, aum_basis, aum_certainty,
              decision_arch, weeks_min, weeks_max, who_signs, who_can_kill,
              check_band_min, check_band_max, prior_relationship, provenance_note, provenance_since)
           values ($1,$2::fit.firm_class,$3,$4,$5,$6::fit.certainty,$7::fit.decision_arch,
                   $8,$9,$10,$11,$12,$13,$14,$15,$16::date)
           on conflict (entity_id) do nothing`,
          [entityId, p.firm_class, p.iapd, p.aum, p.aum_basis ?? null, p.aum_certainty,
           p.decision, p.weeks[0], p.weeks[1], p.signs ?? null, p.kills ?? null,
           p.band?.[0] ?? null, p.band?.[1] ?? null, p.prior, p.provenance ?? null, p.since ?? null],
        );
      }

      const rows = await tx.query<{ assessment_id: string }>(
        `insert into fit.assessment (entity_id, vehicle_id, owner_id, headline)
         values ($1,$2,$3,$4) returning assessment_id`,
        [entityId, v(s.vehicle), u(s.owner), s.headline],
      );
      const id = rows[0]!.assessment_id;

      for (const g of s.gates) {
        await tx.query(
          `insert into fit.gate (assessment_id, code, label, passed, detail, certainty, source, as_of)
           values ($1,$2,$3,$4,$5,$6::fit.certainty,$7,$8::date)`,
          [id, g.code, GATES[g.code] ?? g.code, g.passed, g.detail, g.certainty, g.source ?? null, g.as_of],
        );
      }
      for (const dim of s.dims) {
        const meta = CATALOGUE[dim.code]!;
        await tx.query(
          `insert into fit.dimension
             (assessment_id, code, label, question, grade, certainty, finding, source, as_of, weight_us, weight_them)
           values ($1,$2,$3,$4,$5::fit.grade,$6::fit.certainty,$7,$8,$9::date,$10,$11)`,
          [id, dim.code, meta.label, meta.question, dim.grade, dim.certainty, dim.finding,
           dim.source ?? null, dim.as_of, meta.us, meta.them],
        );
      }
      for (const val of s.values) {
        await tx.query(
          `insert into fit.value_item
             (assessment_id, they_value, our_match, match_grade, clear_to_them, next_action, certainty, source, as_of)
           values ($1,$2,$3,$4::fit.grade,$5,$6,$7::fit.certainty,$8,$9::date)`,
          [id, val.value, val.match, val.grade, val.clear, val.action, val.certainty, val.source ?? null, val.as_of],
        );
      }
      for (const p of s.perception) {
        await tx.query(
          `insert into fit.perception
             (assessment_id, subject, subject_kind, familiarity, sentiment, evidence, certainty, source, as_of)
           values ($1,$2,$3,$4::fit.familiarity,$5::fit.sentiment,$6,$7::fit.certainty,$8,$9::date)`,
          [id, p.subject, p.kind, p.fam, p.sent, p.evidence, p.certainty, p.source ?? null, p.as_of],
        );
      }
      for (const en of s.engagement ?? []) {
        await tx.query(
          `insert into fit.engagement (assessment_id, channel, behaviour, detail, observed_on, certainty)
           values ($1,$2,$3,$4,$5::date,$6::fit.certainty)`,
          [id, en.channel, en.behaviour, en.detail, en.on, en.certainty],
        );
      }
      for (const l of s.links) {
        await tx.query(
          `insert into fit.link
             (assessment_id, via_entity, kind, statement, tie_band, opinion_weight, certainty, source, as_of)
           values ($1,$2,$3::fit.link_kind,$4,$5,$6::fit.grade,$7::fit.certainty,$8,$9::date)`,
          [id, l.via ? e(l.via) : null, l.kind, l.statement, l.band, l.weight, l.certainty,
           l.source ?? null, l.as_of],
        );
      }
    }
  });

  return { firmProfiles: new Set(SPECS.map((s) => s.entity)).size, assessments: SPECS.length };
}
