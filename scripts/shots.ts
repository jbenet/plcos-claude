import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

/**
 * Changelog screenshots. `npm run shots -- L1` against a running dev server.
 * The viewport matches the design boards (1440 × 940) so a shot can be held up next to
 * design/S1-Shell-Today.html without rescaling.
 */
interface Shot {
  name: string;
  path: string;
  prepare?: (page: Page) => Promise<void>;
  fullPage?: boolean;
}

const SHOTS: Record<string, Shot[]> = {
  L1: [
    { name: '01-today', path: '/today' },
    { name: '02-approvals', path: '/approvals' },
    {
      name: '03-feedback-box',
      path: '/m/routes',
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Give feedback' }).click();
        await page.getByPlaceholder("Guard message doesn't say whose ask is blocking").fill(
          'Route list should say which corpus was searched',
        );
        await page
          .locator('textarea')
          .fill(
            'The empty state reads as "no route exists" when all it can justify is "no route in the material available". Say which corpus and date range were inspected.',
          );
        await page.waitForTimeout(250);
      },
    },
    { name: '04-issues', path: '/issues' },
    { name: '05-issue-detail', path: '/issues/0001' },
    { name: '06-system-seams', path: '/system' },
  ],
  L2: [
    { name: '01-research', path: '/research' },
    { name: '02-dossier', path: '/research/__ROOS__' },
    {
      name: '03-evidence-ref',
      path: '/research/__ROOS__',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Source S05/ }).first().hover();
        await page.waitForTimeout(250);
      },
    },
    { name: '04-corpus', path: '/research/sources' },
  ],
  L3: [
    {
      name: '01-approvals-conflict',
      path: '/approvals',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Route to Delia Roos/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '02-adjudication',
      path: '/approvals',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('link', { name: /Route to Delia Roos/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
    { name: '03-approvals-money', path: '/approvals' },
    { name: '04-ask-log', path: '/asks' },
    { name: '05-today-queue', path: '/today' },
  ],
  L4: [
    { name: '01-routes', path: '/routes' },
    { name: '02-routes-full', path: '/routes', fullPage: true },
    {
      name: '03-no-route',
      path: '/routes',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Ivo Lindqvist' }).click();
        await page.waitForLoadState('networkidle');
      },
    },
  ],
  L5: [
    { name: '01-pursuits', path: '/targets' },
    {
      name: '02-workspace-roos',
      path: '/targets',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Delia Roos' }).first().click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '03-ladder-cedar',
      path: '/targets',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Cedar Trust' }).first().click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '04-advance-ticket',
      path: '/targets',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Northwood Capital' }).first().click();
        await page.waitForLoadState('networkidle');
        await page.getByPlaceholder('email:2026-09-22').fill('email:2026-09-19');
        await page
          .getByPlaceholder('Quote or summarise the part that justifies this rung')
          .fill('Raman said the DDQ pack looks thorough and they are keen.');
        await page.getByRole('button', { name: /Request:/ }).click();
        await page.waitForTimeout(900);
      },
    },
  ],
  L6: [
    // A fresh browser has no vehicle cookie, so this one is genuinely "All vehicles".
    { name: '01-soft-hard-all', path: '/soft-hard' },
    {
      name: '02-soft-hard-vehicle',
      path: '/soft-hard',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Vehicle/ }).click();
        await page.getByRole('menu').getByText('PLC Neurotech I').click();
        await page.waitForTimeout(900);
      },
    },
    { name: '03-forecast', path: '/forecast', fullPage: true },
    { name: '04-vehicles', path: '/vehicles' },
    {
      name: '05-money-ticket',
      path: '/approvals',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Record \$4.0M hard/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
  ],
  L7: [
    { name: '01-today-all', path: '/today' },
    {
      name: '02-today-vehicle',
      path: '/today',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('button', { name: /Vehicle/ }).click();
        await page.getByRole('menu').getByText('PLC Neurotech I').click();
        await page.waitForTimeout(900);
      },
    },
    { name: '03-calendar', path: '/calendar' },
  ],
  L8: [
    { name: '01-close-room', path: '/close', fullPage: true },
    { name: '02-spv-war-room', path: '/spv', fullPage: true },
  ],
  FINAL: [
    { name: '01-today', path: '/today', fullPage: true },
    { name: '02-issues', path: '/issues' },
    { name: '03-capability-without-screen', path: '/m/lp-fit' },
  ],
  M17: [
    { name: '01-answer-library', path: '/library', fullPage: true },
  ],
  M24: [
    { name: '01-compliance', path: '/compliance', fullPage: true },
  ],
  L13: [
    { name: '01-agent-runtime', path: '/agents', fullPage: true },
    { name: '02-grants-gate', path: '/grants' },
  ],
  L12: [
    { name: '01-content-studio', path: '/content', fullPage: true },
    {
      name: '02-wrap-refusal',
      path: '/materials',
      fullPage: true,
      prepare: async (page) => {
        const assetValue = await page
          .locator('select[name="assetId"] option', { hasText: 'Neurotech primer v4 ·' })
          .first()
          .getAttribute('value');
        await page.locator('select[name="assetId"]').selectOption(assetValue!);
        const vehicleValue = await page
          .locator('select[name="vehicleId"] option', { hasText: 'SPV — Halo' })
          .first()
          .getAttribute('value');
        await page.locator('select[name="vehicleId"]').selectOption(vehicleValue!);
        await page.locator('select[name="instrument"]').selectOption('spv');
        await page.getByRole('button', { name: /Check and request/ }).click();
        await page.waitForTimeout(1200);
      },
    },
    { name: '03-performance', path: '/performance' },
  ],
  L11: [
    { name: '01-prep-brief', path: '/meetings', fullPage: true },
    { name: '02-decision-room', path: '/decisions', fullPage: true },
  ],
  L10: [
    { name: '01-signals-today', path: '/today', fullPage: true },
    { name: '02-thresholds', path: '/system', fullPage: true },
  ],
  L9: [
    { name: '01-selection', path: '/selection', fullPage: true },
    {
      name: '02-reweighted',
      path: '/selection',
      fullPage: true,
      prepare: async (page) => {
        // Push propensity up and capacity down; the order should change and say why.
        const capacity = page.locator('input[name="capacity"]');
        const propensity = page.locator('input[name="propensity"]');
        await capacity.fill('10');
        await propensity.fill('40');
        await page.getByPlaceholder('Propensity matters more than capacity this quarter')
          .fill('Propensity matters more than capacity this quarter');
        await page.getByRole('button', { name: /Apply and re-rank/ }).click();
        await page.waitForTimeout(1200);
      },
    },
  ],
};

/** The seed mints uuids, so a fixed link is resolved at shot time. */
async function resolveTokens(page: Page, base: string, path: string): Promise<string> {
  if (!path.includes('__ROOS__')) return path;
  await page.goto(base + '/research', { waitUntil: 'networkidle' });
  const href = await page.getByRole('link', { name: 'Delia Roos' }).first().getAttribute('href');
  if (!href) throw new Error('could not resolve the Delia Roos dossier link');
  return path.replace('/research/__ROOS__', href);
}

async function main() {
  const version = process.argv[2] ?? 'L1';
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const shots = SHOTS[version];
  if (!shots) throw new Error(`No shots defined for ${version}`);

  const dir = join(process.cwd(), 'docs/changelog/shots', version.toLowerCase());
  await mkdir(dir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });

  for (const shot of shots) {
    const path = await resolveTokens(page, base, shot.path);
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (shot.prepare) await shot.prepare(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(dir, `${shot.name}.png`), fullPage: shot.fullPage ?? false });
    console.log(`shot · ${version}/${shot.name}.png`);
  }

  await browser.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
