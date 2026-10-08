/**
 * An organization field that is really a short biography (issue 0138): "Former X / Y",
 * "Personal investing (formerly X)", "X (General Partner) / Y (former CEO)". Stored whole, each
 * became an organization of its own beside the real X and Y. This reads such a field into the
 * organizations it names, each with the role and whether it is a former one, so the import records
 * affiliations with X and Y instead of a new organization named after the sentence.
 *
 * A field it cannot read as more than one plain name comes back unchanged, as one current part.
 */
export interface AffiliationPart {
  org: string;
  role: string | null;
  former: boolean;
}

/** Words that describe how someone invests, not an organization to file them under. */
const NOT_AN_ORG = /^(?:personal(?:\s+investing|\s+investments?|\s+capital)?|independent|self[- ]employed|angel(?:\s+investor)?|individual(?:\s+investor)?|private\s+investor|n\/?a|none|unknown|-)$/i;
const FORMER_PREFIX = /^(?:former(?:ly)?|ex-|ex\s|previously|prev\.?)\s*(?:at\s+|of\s+)?/i;
const FORMERLY_PAREN = /\(\s*(?:former(?:ly)?|ex-|previously)\s*(?:at\s+|of\s+)?([^()]+?)\s*\)/gi;
const ROLE_PAREN = /\(\s*([^()]+?)\s*\)\s*$/;
const ROLE_WORDS = /\b(?:partner|gp|lp|founder|co-?founder|ceo|cto|cfo|coo|president|director|chair(?:man|woman)?|principal|manager|managing|advisor|adviser|investor|associate|vp|vice|head|member|board|officer|lead|analyst|venture)\b/i;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim();
}

/** The organizations a free-text organization field names. */
export function affiliationParts(text: string | null | undefined): AffiliationPart[] {
  const whole = clean(text ?? '');
  if (!whole) return [];
  const parts: AffiliationPart[] = [];
  const add = (org: string, role: string | null, former: boolean) => {
    const name = clean(org);
    if (!name || NOT_AN_ORG.test(name)) return;
    if (!parts.some((p) => p.org.toLowerCase() === name.toLowerCase())) parts.push({ org: name, role: role ? clean(role) : null, former });
  };
  for (const raw of whole.split(/\s+[/|]\s+/)) {
    let seg = clean(raw);
    // "Personal investing (formerly X)": X is a former affiliation; what is left is read on its own.
    seg = seg.replace(FORMERLY_PAREN, (m: string, org: string) => {
      if (ROLE_WORDS.test(org)) return m; // "(former CEO)" is a role, read below
      add(org, null, true);
      return '';
    });
    seg = clean(seg);
    let former = false;
    if (FORMER_PREFIX.test(seg)) { former = true; seg = clean(seg.replace(FORMER_PREFIX, '')); }
    let role: string | null = null;
    const paren = ROLE_PAREN.exec(seg);
    // A trailing parenthetical is a role only when it reads as one; "Acme (UK)" keeps its name.
    if (paren && ROLE_WORDS.test(paren[1]!)) {
      role = paren[1]!;
      seg = clean(seg.slice(0, paren.index));
      if (FORMER_PREFIX.test(role)) { former = true; role = clean(role.replace(FORMER_PREFIX, '')); }
    }
    add(seg, role, former);
  }
  // Nothing to split: the field is one name, whatever it says, and is kept as it was written.
  if (parts.length <= 1 && !/\s[/|]\s|\(\s*(?:former|ex-|previously)|^(?:former|ex-|previously)\b/i.test(whole) && !(parts[0]?.role)) {
    return NOT_AN_ORG.test(whole) ? [] : [{ org: whole, role: null, former: false }];
  }
  return parts;
}
