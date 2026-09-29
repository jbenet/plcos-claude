import type { Check, SeedContext } from './harness';
import { freshDb } from './harness';

export async function complianceProperties({ check, db }: SeedContext) {
  const { listAccreditation } = await import('../../modules/compliance');
  const accreditation = await listAccreditation();
  const selfCert506c = accreditation.filter(
    (r) => r.exemption === '506(c)' && r.method === 'self_certified',
  );
  check(
    'Self-certification never satisfies a 506(c) vehicle',
    selfCert506c.length > 0 && selfCert506c.every((r) => !r.sufficient),
    `${selfCert506c.length} self-certified records on 506(c) vehicles, none of them sufficient`,
  );

  const solicit506b = await db.query<{ n: string }>(
    `select count(*)::text as n from compliance.solicitation s
       join platform.vehicle v on v.id = s.vehicle_id where v.exemption = '506(b)'`,
  );
  check(
    'No 506(b) vehicle appears in the solicitation log',
    Number(solicit506b[0]!.n) === 0,
    `${solicit506b[0]!.n} general-solicitation events against a 506(b) vehicle`,
  );

  const unsubstantiated = await db.query<{ n: string }>(
    "select count(*)::text as n from compliance.public_claim where status = 'in_use' and coalesce(substantiation, '') = ''",
  );
  check(
    'Every public claim in use has substantiation on file',
    Number(unsubstantiated[0]!.n) === 0,
    `${unsubstantiated[0]!.n} unsubstantiated claims in use`,
  );

}

export async function verificationVariations(check: Check) {
  // The verification gate: complete, signed, and still insufficient.
  {
    const d = await freshDb();
    const { requestHardening } = await import('../../modules/pipeline');
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    const albescu = (await d.one<{ exposure_id: string }>(
      `select x.exposure_id from pipeline.exposure x
         join identity.entity e on e.entity_id = x.entity_id
         join platform.vehicle v on v.id = x.vehicle_id
        where e.display_name = 'Albescu Capital' and v.slug = 'neurotech'`,
    ))!;
    let refusal = '';
    try {
      await requestHardening(juan.id, {
        exposureId: albescu.exposure_id, evidenceRef: 'sub-doc:albescu', note: 'Countersigned.',
      });
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    }
    check(
      'Variation — harden a subscriber who only self-certified',
      refusal.includes('reasonable steps'),
      refusal
        ? 'refused before a MONEY ticket was opened — the record is complete and still insufficient'
        : 'NOT REFUSED — a self-certified 506(c) subscriber was allowed to harden',
    );
    await d.close();
  }
}
