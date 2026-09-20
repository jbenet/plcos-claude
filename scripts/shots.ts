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
};

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
    await page.goto(base + shot.path, { waitUntil: 'networkidle' });
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
