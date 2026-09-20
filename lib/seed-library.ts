import type { Db } from './db';

/**
 * Library seed: five approved answers, one of them resting on a claim that has since been
 * superseded — which is the whole reason an answer carries its own approval state.
 */
export async function seedLibrary(db: Db): Promise<{ answers: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from library.answer');
  if (existing && Number(existing.n) > 0) return { answers: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const claims = await db.query<{ claim_id: string; field: string; entity_id: string }>(
    'select claim_id, field, entity_id from research.claim',
  );
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const claimFor = (entity: string, field: string) =>
    claims.find((c) => c.entity_id === e(entity) && c.field === field)?.claim_id ?? null;

  const answers: Array<{
    question: string; answer: string; status: string; owner: string;
    approvedBy?: string; approvedOn?: string; expires?: string;
    docs?: string[]; claims?: Array<[string, string]>;
    uses?: Array<{ context: string; entity?: string; on: string; by: string }>;
  }> = [
    {
      question: 'What is the team’s track record, and can it be verified independently?',
      answer:
        'Three prior vehicles at the operating company, with audited marks held by counsel and ' +
        'available under NDA. No realised exits in this structure; the marks are carried, not realised, ' +
        'and we say so before anyone asks.',
      status: 'approved', owner: 'juan', approvedBy: 'tomas', approvedOn: '2026-06-08',
      expires: '2027-06-08',
      uses: [
        { context: 'Cedar Trust pitch — track-record objection', entity: 'Cedar Trust', on: '2026-08-20', by: 'mara' },
        { context: 'Northwood intro call', entity: 'Northwood Capital', on: '2026-09-08', by: 'juan' },
      ],
    },
    {
      question: 'Who sits on the investment committee, and how are conflicts handled?',
      answer:
        'There is no external investment committee. Decisions are the general partners, with an ' +
        'advisory board that reviews conflicts and related-party transactions. The LPA sets out the ' +
        'recusal mechanics.',
      status: 'approved', owner: 'tomas', approvedBy: 'tomas', approvedOn: '2026-07-02',
      uses: [{ context: 'Northwood intro call — governance objection', entity: 'Northwood Capital', on: '2026-09-08', by: 'juan' }],
    },
    {
      question: 'What are the fee terms, and is there a break at size?',
      answer:
        'Standard schedule in the LPA, with a documented break at $4M and above. Any break granted ' +
        'flows through to the Vantage most-favoured-nation provision, which is why the side-letter ' +
        'register is checked before a break is offered.',
      status: 'approved', owner: 'tomas', approvedBy: 'tomas', approvedOn: '2026-09-18',
      uses: [{ context: 'Cedar Trust — terms objection', entity: 'Cedar Trust', on: '2026-08-20', by: 'tomas' }],
    },
    {
      question: 'How does a programme-related investment work for a foundation?',
      answer:
        'A PRI is a grant instrument with a return, treated under §4944(c). It is described as a ' +
        'grant with recoverability, never as a fund position. Jurisdictional treatment is unresolved ' +
        'and the answer says so rather than glossing it.',
      status: 'needs_review', owner: 'tomas', approvedBy: 'tomas', approvedOn: '2024-03-11',
      expires: '2025-03-11',
      claims: [['Roos Foundation', 'Instruments used']],
      docs: ['S10'],
      uses: [{ context: 'Roos Foundation strategy note', entity: 'Roos Foundation', on: '2026-09-14', by: 'tomas' }],
    },
    {
      question: 'What cheque size does the fund expect from a new relationship?',
      answer:
        'Between $2M and $5M for a first commitment. This rests on a forwarded letter excerpt rather ' +
        'than a statement made to us, and the answer carries that qualification wherever it is used.',
      status: 'approved', owner: 'ines', approvedBy: 'juan', approvedOn: '2026-08-31',
      claims: [['Delia Roos', 'Cheque band']],
      docs: ['S03'],
    },
    {
      question: 'What is the liquidity profile, and how long is the lock?',
      answer: 'Ten years with two one-year extensions, and a recycling provision that shortens the effective lock.',
      status: 'draft', owner: 'juan',
      uses: [{ context: 'Cedar Trust — liquidity objection', entity: 'Cedar Trust', on: '2026-08-20', by: 'mara' }],
    },
  ];

  await db.transaction(async (tx) => {
    for (const a of answers) {
      const rows = await tx.query<{ answer_id: string }>(
        `insert into library.answer
           (question, answer, status, approved_by, approved_on, expires_on, owner_id)
         values ($1,$2,$3::library.answer_status,$4,$5::date,$6::date,$7) returning answer_id`,
        [a.question, a.answer, a.status, a.approvedBy ? u(a.approvedBy) : null,
         a.approvedOn ?? null, a.expires ?? null, u(a.owner)],
      );
      const answerId = rows[0]!.answer_id;

      for (const [entity, field] of a.claims ?? []) {
        const claimId = claimFor(entity, field);
        if (claimId) {
          await tx.query('insert into library.answer_source (answer_id, claim_id) values ($1,$2)', [answerId, claimId]);
        }
      }
      for (const doc of a.docs ?? []) {
        await tx.query('insert into library.answer_source (answer_id, doc_id) values ($1,$2)', [answerId, doc]);
      }
      for (const use of a.uses ?? []) {
        await tx.query(
          'insert into library.answer_use (answer_id, context, entity_id, used_on, used_by) values ($1,$2,$3,$4::date,$5)',
          [answerId, use.context, use.entity ? e(use.entity) : null, use.on, u(use.by)],
        );
      }
    }
  });

  return { answers: answers.length };
}
