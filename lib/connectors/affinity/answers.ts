import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '@/config/deployment';
import { parseJsonc } from '@/lib/jsonc';
import { RUNGS, type LadderRung } from '@/modules/strategy';
import type { Inventory, ListInventory } from './inventory';
import { normName } from './match';

/**
 * The answer sheet for round two (N44, docs/15 §8): how each list's words are to be read.
 *
 * It is generated from the inventory, so it asks about the fields and values that are really
 * there, and it lives beside the init file in data/<profile>/ because it names lists and their
 * vocabulary. Every answer starts as null. Suggestions are comments, never values: a wrong
 * default here would turn "Soft Commit" into a commitment without anyone having said so, and a
 * null is a question the tool keeps asking. Regenerating keeps every answer already given.
 */

export const ANSWERS_PATH = join(config.data.root, 'answers.jsonc');

export type RungAnswer = LadderRung | 'none';

export interface ListAnswers {
  stage: string | null;
  rungs: Record<string, RungAnswer | null>;
  amount: string | null;
  amountMeans: 'soft' | 'hard' | null;
  owner: string | null;
  doNotContact: string | null;
  /**
   * What was written but is not a valid answer — a mistyped rung, say. Counted as unanswered,
   * reported as a problem, and written back unchanged on regeneration, so a typo is corrected
   * by the person who made it rather than erased by the tool.
   */
  unrecognised?: { rungs?: Record<string, unknown>; amountMeans?: unknown };
}

export interface AnswerReport {
  path: string;
  exists: boolean;
  /** The file as it stands, comments and all, for showing on the page. */
  text: string | null;
  lists: Record<string, ListAnswers>;
  problems: string[];
  answered: number;
  asked: number;
}

const KEYS: Array<keyof Omit<ListAnswers, 'rungs'>> = ['stage', 'amount', 'amountMeans', 'owner', 'doNotContact'];

/** What the words seem to say. Shown as a comment beside a null, never used as an answer. */
function suggestRung(value: string): string | null {
  const v = value.toLowerCase();
  if (/wired|funded|cash|received/.test(v)) return 'cash_received, if the money has arrived';
  if (/countersign/.test(v)) return 'commitment_accepted';
  if (/documents signed|docs signed|signed|committed|closed won/.test(v)) return 'commitment_accepted, if countersigned; otherwise indication_given';
  if (/soft commit|soft circle|indicat/.test(v)) return 'indication_given';
  if (/meeting|met\b/.test(v)) return 'meeting_held';
  if (/scheduling|responded|interested|replied/.test(v)) return 'target_opted_in';
  if (/pass|lost|declin|no response|not interested/.test(v)) return 'none — and a decline for this vehicle';
  if (/contacted|research|target|enriched|new|hold|to do/.test(v)) return 'none — nothing from the target yet';
  return null;
}

const j = (x: unknown) => JSON.stringify(x);

function block(l: ListInventory, prior: ListAnswers | undefined): string {
  const list = l.fields.filter((f) => f.fieldType === 'list');
  const dropdowns = list.filter((f) => /dropdown/.test(f.valueType)).sort((a, b) => b.filled - a.filled);
  const numbers = list.filter((f) => /number/.test(f.valueType)).sort((a, b) => b.filled - a.filled);
  const people = l.fields.filter((f) => /^person/.test(f.valueType) && (f.team?.length ?? 0) > 0).sort((a, b) => b.filled - a.filled);
  const dnc = l.fields.find((f) => /do not (contact|approach)|\bdnc\b/i.test(f.name));
  const stageField = (prior?.stage && l.fields.find((f) => f.name === prior.stage)) || dropdowns[0];
  const values = stageField?.values ?? [];
  const width = Math.max(0, ...values.map((v) => j(v.text).length)) + 1;
  const out: string[] = [];
  out.push(`    ${j(l.list.name)}: {`);
  out.push(`      // ${l.vehicleName ?? 'No vehicle yet: it says SPV'} · ${l.entries} entries.`);
  out.push(`      // Which field is the stage?${dropdowns[0] ? ` Suggested: ${j(dropdowns[0].name)}, filled on ${dropdowns[0].filled} of ${dropdowns[0].of}.` : ''}`);
  if (dropdowns.length > 1) out.push(`      // Other dropdowns: ${dropdowns.slice(1, 12).map((f) => f.name).join(', ')}.`);
  out.push(`      "stage": ${j(prior?.stage ?? null)},`);
  out.push(`      // For each value of ${stageField ? j(stageField.name) : 'the stage field'}: the highest rung of the ladder it actually`);
  out.push(`      // evidences, or "none". Rungs: ${RUNGS.join(', ')}.`);
  out.push(`      // A value that only says what we did — contacted, sent — evidences nothing from the target.`);
  out.push(`      "rungs": {`);
  values.forEach((v, i) => {
    const answer = prior?.rungs?.[v.text] ?? prior?.unrecognised?.rungs?.[v.text] ?? null;
    const hint = suggestRung(v.text);
    const comma = i < values.length - 1 ? ',' : '';
    out.push(`        ${(j(v.text) + ':').padEnd(width + 1)} ${j(answer)}${comma}${' '.repeat(Math.max(1, 6 - j(answer).length - comma.length))}// ${v.n}${hint ? ` · the words suggest ${hint}` : ''}`);
  });
  out.push(`      },`);
  out.push(`      // Which field, if any, is the amount?${numbers.length ? ` Candidates: ${numbers.map((f) => `${j(f.name)} (${f.filled})`).join(', ')}.` : ' None of the list fields is a number.'}`);
  out.push(`      "amount": ${j(prior?.amount ?? null)},`);
  out.push(`      // Does that amount mean "soft" (indicated) or "hard" (signed and countersigned)? Until you say, soft.`);
  out.push(`      "amountMeans": ${j(prior?.amountMeans ?? prior?.unrecognised?.amountMeans ?? null)},`);
  out.push(`      // Which field is the relationship owner?${people[0] ? ` Suggested: ${j(people[0].name)}, filled on ${people[0].filled} of ${people[0].of}.` : ''}`);
  out.push(`      "owner": ${j(prior?.owner ?? null)},`);
  out.push(`      // Which field marks do-not-contact, if any?${dnc ? ` Suggested: ${j(dnc.name)}.` : ''} Every "yes" in it becomes a do-not-approach instruction (rule 8).`);
  out.push(`      "doNotContact": ${j(prior?.doNotContact ?? null)}`);
  out.push(`    }`);
  return out.join('\n');
}

export function answerSheet(inv: Inventory, prior: Record<string, ListAnswers> = {}): string {
  const find = (name: string) => Object.entries(prior).find(([k]) => normName(k) === normName(name))?.[1];
  const lists = inv.lists.filter((l) => l.entries > 0);
  return [
    `// Round two (docs/15 §8): how each list's words are to be read. Generated ${inv.at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '// from the inventory, in data/' + config.data.profile + '/ because it names lists and their vocabulary.',
    '//',
    '// Fill in the nulls. None of them is a default: an unanswered field is read as unknown, never as',
    '// its likeliest meaning, and the suggestions in the comments are only that. Regenerating from the',
    '// Inventory page keeps every answer given here and rewrites the comments.',
    '{',
    '  "lists": {',
    lists.map((l) => block(l, find(l.list.name))).join(',\n'),
    '  }',
    '}',
    '',
  ].join('\n');
}

/** `path` is for the property harness; the app always uses ANSWERS_PATH. */
export async function readAnswers(inv?: Inventory, path = ANSWERS_PATH): Promise<AnswerReport> {
  const report: AnswerReport = { path, exists: false, text: null, lists: {}, problems: [], answered: 0, asked: 0 };
  let text: string;
  try {
    text = await readFile(join(process.cwd(), path), 'utf8');
    report.exists = true;
    report.text = text;
  } catch {
    return report;
  }
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (err) {
    report.problems.push(`Not valid JSON: ${(err as Error).message}`);
    return report;
  }
  const lists = ((raw as { lists?: unknown }).lists ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, a] of Object.entries(lists)) {
    const known = inv?.lists.find((l) => normName(l.list.name) === normName(name));
    if (inv && !known) report.problems.push(`"${name}" is not a list the slice read.`);
    const fieldNames = new Set(known?.fields.map((f) => f.name) ?? []);
    const field = (key: string): string | null => {
      const v = a[key];
      if (v === null || v === undefined) return null;
      if (typeof v !== 'string') {
        report.problems.push(`"${name}".${key} must be a field name or null.`);
        return null;
      }
      if (known && !fieldNames.has(v)) report.problems.push(`"${name}".${key}: there is no field called "${v}" on that list.`);
      return v;
    };
    const rungs: Record<string, RungAnswer | null> = {};
    const unrecognised: NonNullable<ListAnswers['unrecognised']> = {};
    for (const [value, r] of Object.entries((a.rungs ?? {}) as Record<string, unknown>)) {
      if (r === null) rungs[value] = null;
      else if (r === 'none' || (RUNGS as string[]).includes(String(r))) rungs[value] = r as RungAnswer;
      else {
        report.problems.push(`"${name}".rungs["${value}"]: "${String(r)}" is not a rung. Use one of ${RUNGS.join(', ')}, or "none".`);
        rungs[value] = null;
        (unrecognised.rungs ??= {})[value] = r;
      }
    }
    const means = a.amountMeans;
    if (means !== null && means !== undefined && means !== 'soft' && means !== 'hard') {
      report.problems.push(`"${name}".amountMeans must be "soft", "hard" or null.`);
      unrecognised.amountMeans = means;
    }
    const answers: ListAnswers = {
      stage: field('stage'), rungs, amount: field('amount'),
      amountMeans: means === 'soft' || means === 'hard' ? means : null,
      owner: field('owner'), doNotContact: field('doNotContact'),
      ...(unrecognised.rungs || unrecognised.amountMeans !== undefined ? { unrecognised } : {}),
    };
    report.lists[name] = answers;
    for (const k of KEYS) {
      report.asked++;
      if (answers[k] !== null) report.answered++;
    }
    for (const r of Object.values(rungs)) {
      report.asked++;
      if (r !== null) report.answered++;
    }
  }
  return report;
}

/** Writes the sheet, keeping every answer the current one holds. */
export async function writeAnswerSheet(inv: Inventory, path = ANSWERS_PATH): Promise<string> {
  const prior = await readAnswers(undefined, path);
  const abs = join(process.cwd(), path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, answerSheet(inv, prior.lists));
  return path;
}
