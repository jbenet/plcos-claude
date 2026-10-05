/**
 * Health details out of text that leaves for a model (docs/agent-rules/real-data.md, "Drafting context to
 * the Claude API", Juan 4 Oct 2026: approved with zero data retention and no training; "health details
 * stay redacted"). The mail desk drafts with Claude from what the outreach API returns, so that API runs
 * its text fields through here first: the desk never receives a health detail from Capital OS to pass on.
 *
 * "Health details", concretely: a medical condition, a treatment, a diagnosis, a disability, mental health,
 * pregnancy, or genetic information — about the person or their family — and the events around them (a
 * hospital stay, surgery, medical leave, a death or a bereavement). A sentence that mentions one is replaced
 * whole by REDACTED, so no part of the detail survives in a half-sentence; neighbouring redactions collapse.
 *
 * Two kinds of words. Some are about a person's health wherever they appear ("diagnosed", "surgery",
 * "pregnant", "maternity leave", "mental health"): always redacted. Others name a disease or a kind of care
 * that a neurotech fund also invests in ("Parkinson's", "cancer", "gene therapy", "ALS"): an investment
 * thesis is not a health detail, so these count only in a personal phrase — "her mother has Alzheimer's",
 * "his cancer", "battling ALS". It errs toward redacting inside that rule, like the note importer's test
 * (N56, lib/connectors/affinity/inventory.ts): a miss is the costly error.
 */

export const REDACTED = '[health detail redacted]';

/** About a person's health wherever they appear. */
const PERSONAL = [
  'diagnos(?:ed|is|es|ing)', 'misdiagnos(?:ed|is)', String.raw`pregnan\w*`, 'miscarriage', 'IVF', 'fertility treatment', 'expecting (?:a baby|twins)',
  '(?:maternity|paternity|parental|medical|sick|disability) leave', 'gave birth', 'newborn',
  String.raw`surger(?:y|ies)`, 'operated on', String.raw`hospitali[sz]\w*`, '(?:in|into|out of|from) (?:the )?hospital', 'ICU', 'intensive care',
  'hospice', String.raw`chemo\w*`, 'radiotherapy', 'radiation treatment', 'dialysis', String.raw`rehab\b`, 'in rehab', 'in therapy', 'therapist',
  'medication', 'on meds', 'prescribed', 'in treatment', 'undergoing treatment', 'treated for', '(?:a|an|the) (?:heart|lung|kidney|liver|thyroid|blood|autoimmune|neurological) condition', 'medical (?:treatment|condition|procedure|issue|issues|reasons?|emergency|history)',
  'mental health', 'panic attacks?', 'nervous breakdown', String.raw`psychiatr\w*`,
  'bipolar', 'PTSD', 'ADHD', String.raw`suicid\w*`, 'alcoholi\\w*',
  String.raw`disabilit(?:y|ies)`, 'disabled', 'wheelchair', 'hearing loss', 'lost (?:his|her|their) sight',
  'genetic (?:test|testing|condition|risk|disorder|result|results|predisposition)', 'BRCA\\d?', 'hereditary (?:condition|disease|risk)',
  'sick', 'illness(?:es)?', 'unwell', String.raw`terminal(?:ly)? ill`, 'concussion', String.raw`injur(?:ed|y|ies)`,
  'heart attack', 'passed away', 'died', 'funeral', String.raw`bereave\w*`, 'family emergency',
  'health (?:issues?|scare|problems?|reasons|condition|matters?|crisis|struggles?)',
  String.raw`lost (?:his|her|their|my|our) (?:mom|mum|mother|dad|father|wife|husband|partner|son|daughter|brother|sister|child|baby|parents?|grand\w+)`,
  '(?:passing|death) of (?:his|her|their|my|our)',
];

/** Diseases and kinds of care: health only in a personal phrase (an investment thesis names them too). */
const CONDITIONS = [
  'cancer', String.raw`tumou?rs?`, 'carcinoma', 'sarcoma', 'lymphoma', String.raw`leuka?emia`, 'melanoma', 'glioma', 'glioblastoma',
  String.raw`metasta\w*`, 'dementia', String.raw`alzheimer'?s?`, String.raw`parkinson'?s?`, 'multiple sclerosis', 'MS', 'ALS', 'epilepsy', 'seizures?',
  'diabetes', 'covid', 'long covid', 'an infection', 'a disease', 'disease', 'a disorder', String.raw`autis\w*`, 'blindness', 'deafness',
  'therapy', 'an accident', 'accident', 'death', 'a fall', 'a scare', 'a stroke', 'stroke',
  String.raw`depress(?:ed|ion)`, 'anxiety', 'burn-?out', 'addiction', 'recovery', 'recovering',
];

const WHO = String.raw`(?:his|her|their|my|our|has|had|have|having|with|from|battling|fighting|suffering|suffers|survived|survivor of|treated for|living with|caring for|care of)`;

const ALWAYS = new RegExp(String.raw`\b(?:${PERSONAL.join('|')})\b`, 'i');
const IN_PERSON = new RegExp(String.raw`\b${WHO}\s+(?:[\w'’-]+\s+){0,2}?(?:${CONDITIONS.join('|')})\b`, 'i');
/** "with" is personal only after a person or a family member: "her father, with dementia", "a son with autism". */
const WITH_INVESTMENT = /\b(?:companies|startups|founders|patients|portfolio|firms?|teams?|investing|invests|work(?:s|ing)?|partner(?:s|ing)?|focus(?:es|ed)?|treat(?:s|ing)?|target(?:s|ing)?)\s+(?:\w+\s+){0,3}?(?:with|from|for)\s+/i;

/** Whether a text mentions a health detail, by the definition above. */
export function mentionsHealthDetail(text: string): boolean {
  if (ALWAYS.test(text)) return true;
  const m = IN_PERSON.exec(text);
  if (!m) return false;
  // "a fund investing in companies with Parkinson's therapies" is a thesis; "his father, with Parkinson's" is not.
  const before = text.slice(Math.max(0, m.index - 60), m.index + m[0].length);
  return !/^(?:with|from|treated for|living with|caring for|care of)\b/i.test(m[0]) || !WITH_INVESTMENT.test(before);
}

/** Sentences: up to and including . ! ? or a line break. */
const SENTENCES = /[^.!?\n]+(?:[.!?]+["')\]’”]*\s*|\n+|$)|\n+/g;

/**
 * The text with every sentence that mentions a health detail replaced by REDACTED, and how many were.
 * Text with none comes back unchanged.
 */
export function redactHealth(text: string): { text: string; redacted: number } {
  if (!text || !mentionsHealthDetail(text)) return { text, redacted: 0 };
  let redacted = 0;
  const out: string[] = [];
  for (const part of text.match(SENTENCES) ?? [text]) {
    if (!mentionsHealthDetail(part)) { out.push(part); continue; }
    redacted++;
    const trailing = /\s*$/.exec(part)![0];
    const prev = out.length ? out[out.length - 1]! : null;
    // Two redactions side by side read as one.
    if (prev !== null && prev.trimEnd().endsWith(REDACTED)) { out[out.length - 1] = prev.trimEnd() + trailing; continue; }
    out.push(REDACTED + trailing);
  }
  return { text: out.join(''), redacted };
}

/** Redact every string in a JSON-like value: a copy and the count. Never mutates the input. */
export function redactHealthDeep<T>(value: T): { value: T; redacted: number } {
  let redacted = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') { const r = redactHealth(v); redacted += r.redacted; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, redacted };
}
