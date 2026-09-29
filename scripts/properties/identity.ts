import type { Check } from './harness';

export async function headingProperties(check: Check) {
  // Whose name leads an LP's row (issue 0013, real): the organisation's when it is the LP we're
  // targeting — a strategy's named unit first, then an institution's money — the person's otherwise.
  {
    const { orgLeads } = await import('../../lib/lp-heading');
    const cases: Array<[string | null, string | null, string | null, boolean, string]> = [
      [null, 'the fund-of-funds unit', 'institutional', false, 'no organisation on record'],
      ['Gyasi & Ferrante-Obuya', 'personal', 'fo_staff', false, 'a personal check'],
      ['Gyasi & Ferrante-Obuya', 'Gyasi & Ferrante-Obuya', 'angel', true, 'a unit named at the firm'],
      ['Gyasi & Ferrante-Obuya', null, 'fo_staff', true, 'family-office staff, no unit'],
      ['Gyasi & Ferrante-Obuya', null, 'angel', false, 'an angel, no unit'],
      ['Gyasi & Ferrante-Obuya', null, null, false, 'nothing known'],
    ];
    const wrong = cases.filter(([org, unit, type, want]) => orgLeads(org, unit, type) !== want).map((c) => c[4]);
    check('The organisation leads an LP’s row when it is the LP we’re targeting — a named unit, else an institution’s money — and the person otherwise',
      wrong.length === 0, wrong.length ? `wrong for: ${wrong.join('; ')}` : `${cases.length} cases read right`);
  }
}
