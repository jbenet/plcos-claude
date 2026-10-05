import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { config } from '../config/deployment';
import { portFor, readLayout } from '../config/ports';
import { encodeShot, SHOT } from './shot-image';
import { USER_COOKIE } from '../lib/auth/cookie';

/**
 * Changelog screenshots. `npm run shots -- L1` against a running dev server.
 * The viewport matches the design boards (1440 × 940) so a shot can be held up next to
 * design/S1-Shell-Today.html without rescaling. Each is stored as a 2000 px WebP
 * (scripts/shot-image.ts, issue 0021) and referenced from docs/changelog/entries/<version>.md by that name.
 */
interface Shot {
  name: string;
  path: string;
  prepare?: (page: Page) => Promise<void>;
  fullPage?: boolean;
  /** Narrower than the design boards, for the layouts that have to survive a small window. */
  width?: number;
  /** A taller window instead of a full-page stitch, which repeats the fixed demo bar down the page. */
  height?: number;
}

/** Select the demo's first user by cookie, and reload: server actions refuse a browser with none. */
async function asUser(page: Page) {
  await page.context().addCookies([{ name: USER_COOKIE, value: 'juan', url: page.url() }]);
  await page.reload({ waitUntil: 'networkidle' });
}

/** An LP's page by name, from whichever status it is at now: a shot that saves moves it (N61). */
async function openLp(page: Page, name: string) {
  for (const status of ['selected', 'connecting', 'discussing', 'committed', 'passed', 'sourcing', 'new']) {
    await page.goto(new URL(`/targets?status=${status}`, page.url()).toString(), { waitUntil: 'networkidle' });
    const link = page.getByRole('link', { name: new RegExp(name) }).first();
    if (await link.count()) {
      await page.goto(new URL((await link.getAttribute('href'))!, page.url()).toString(), { waitUntil: 'networkidle' });
      return;
    }
  }
  throw new Error(`No LP named ${name} in the pipeline`);
}

/** An LP's page by name on any vehicle's list: the address's /all/ wins over the switcher a page before set. */
async function openLpAnyVehicle(page: Page, name: string) {
  for (const status of ['selected', 'connecting', 'discussing', 'committed', 'passed', 'sourcing', 'new']) {
    await page.goto(new URL(`/all/pipeline?status=${status}`, page.url()).toString(), { waitUntil: 'networkidle' });
    const href = await page.evaluate((n) => [...document.querySelectorAll('a')]
      .find((a) => /\/(targets|pipeline)\/[0-9a-f-]{36}$/.test(a.getAttribute('href') ?? '') && a.innerText.includes(n))?.getAttribute('href') ?? null, name);
    if (href) { await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'networkidle' }); return; }
  }
  throw new Error(`No LP named ${name} on any vehicle's list`);
}

const N61_UPDATE =
  "Met Bram and the family office's CIO on Tuesday. They want the deck and the track record before a second meeting — very keen on the thesis.";

/**
 * /setup on a demo started as a deployed server (PLCOS_DEPLOYED=1, PORT=3113), up to a step. The code is
 * the one that server printed in its log, passed as SHOT_SETUP_CODE. Every value is invented.
 */
async function setupTo(page: Page, step: number) {
  const code = process.env.SHOT_SETUP_CODE;
  if (!code) throw new Error('Set SHOT_SETUP_CODE to the code the demo server printed.');
  const next = async () => { await page.locator('form button[type=submit]').click(); await page.waitForTimeout(300); };
  await page.locator('input[name=code]').fill(code);
  if (step === 0) return;
  await next();
  await page.getByRole('heading', { name: 'The public address' }).waitFor();
  await page.locator('input[name=publicUrl]').fill('https://raise.example.org');
  if (step === 1) return;
  await next();
  await page.locator('input[name=googleClientId]').fill('1234567890-invented.apps.googleusercontent.com');
  await page.locator('input[name=googleClientSecret]').fill('GOCSPX-invented-demo-secret');
  if (step === 2) return;
  await next();
  await page.locator('input[name=adminEmail]').fill('juan@example.com');
  if (step === 3) return;
  await next();
  await page.locator('input[name=linearKey]').fill('lin_api_inventeddemokey0042');
  if (step === 4) return;
  await next();
  if (step === 5) return;
  await next();
  await page.getByText('Continue with Google').waitFor();
}

/**
 * Signed in with Google on that demo, without Google: a session cookie for the admin /setup named, signed
 * with the same invented PLCOS_SECRET the server was started with. SHOT_ADMIN_ID and SHOT_ADMIN_EPOCH come
 * from the demo's own (test-cluster) database.
 */
async function signedInAt(page: Page, path: string) {
  const id = process.env.SHOT_ADMIN_ID, epoch = Number(process.env.SHOT_ADMIN_EPOCH ?? 0);
  if (!id || !process.env.PLCOS_SECRET) throw new Error('Set SHOT_ADMIN_ID and the server\'s PLCOS_SECRET.');
  const { sessionCookie, sessionValue } = await import('../lib/auth/session');
  await page.context().addCookies([{ name: sessionCookie(true), value: encodeURIComponent(sessionValue({ id, sessionEpoch: epoch }, 1).value), url: page.url().replace(/^http:/, 'https:'), secure: true, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(new URL(path, page.url()).toString(), { waitUntil: 'networkidle' });
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
        await page.getByRole('link', { name: /Route to Solveig Quaresma/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '02-adjudication',
      path: '/approvals',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('link', { name: /Route to Solveig Quaresma/ }).click();
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
        await page.getByRole('link', { name: 'Emeka Holmqvist' }).click();
        await page.waitForLoadState('networkidle');
      },
    },
  ],
  L5: [
    { name: '01-pursuits', path: '/targets' },
    {
      name: '02-workspace-quaresma',
      path: '/targets',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Solveig Quaresma' }).first().click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '03-ladder-fernhollow-umberfield',
      path: '/targets',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Fernhollow Umberfield Trust' }).first().click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '04-advance-ticket',
      path: '/targets',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Vetchling Wagtail Capital' }).first().click();
        await page.waitForLoadState('networkidle');
        await page.getByPlaceholder('email:2026-09-22').fill('email:2026-09-19');
        await page
          .getByPlaceholder('Quote or summarise the part that justifies this rung')
          .fill('Eskildsen said the DDQ pack looks thorough and they are keen.');
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
  N42: [
    {
      name: '01-held',
      path: '/dev/affinity/lists',
      prepare: async (page) => {
        // The fixtures changed shape in this version; discovery lands the new lists first.
        await page.getByRole('button', { name: /Discover/ }).click();
        await page.getByText('matched').first().waitFor();
        await page.goto(page.url().replace('/lists', '/slice'), { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: /Read the/ }).click();
        await page.getByRole('button', { name: /Notes only/ }).waitFor({ timeout: 30_000 });
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '02-read',
      path: '/dev/affinity/slice',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('button', { name: /Notes and relationships/ }).click();
        await page.getByText(/relationship sets/).first().waitFor({ timeout: 30_000 });
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => window.scrollTo(0, 0));
      },
    },
  ],
  N85: [
    {
      name: '01-shortcuts',
      path: '/today',
      prepare: async (page) => {
        await page.keyboard.press('?');
        await page.locator('dialog.shortcuts-dialog[open]').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-docs',
      path: '/developer/docs',
      prepare: async (page) => {
        // A fresh browser has no vehicle cookie, so "All vehicles" is expanded under
        // PL Capital by default, and its long submodule list pushes the Developer
        // section below the fold; Developer also defaults to collapsed (lib/nav.ts), so
        // its "Docs" item never renders on a fresh load. Collapse the sections above it
        // and expand Developer so Docs stays in view (same collapsing pattern as N84's
        // 01-network shot).
        await page.getByRole('button', { name: 'PL Capital' }).click();
        await page.getByRole('button', { name: 'PL R&D' }).click();
        await page.getByRole('button', { name: 'Network' }).click();
        await page.getByRole('button', { name: 'Other' }).click();
        await page.getByRole('button', { name: 'Developer' }).click();
        await page.waitForTimeout(400);
      },
    },
    { name: '03-a-doc', path: '/developer/docs/docs-15-affinity-integration' },
  ],
  N84: [
    {
      name: '01-network',
      path: '/orgs/g/connectors',
      prepare: async (page) => {
        // A fresh browser has no vehicle cookie, so "All vehicles" is expanded under
        // PL Capital by default, and its long submodule list pushes the Network section
        // below the fold. Collapse PL Capital so Network's heading stays in view (same
        // pattern as N1's 04-nav-collapsed shot).
        await page.getByRole('button', { name: 'PL Capital' }).click();
        await page.waitForTimeout(400);
      },
    },
  ],
  N83: [
    {
      name: '01-rungs-to-check-again',
      path: '/approvals?view=reconcile',
      prepare: async (page) => {
        await page.locator('#recheck').waitFor({ timeout: 15_000 });
        await page.locator('#recheck').evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -90));
        await page.waitForTimeout(300);
      },
    },
  ],
  N82: [
    {
      name: '01-ties-to-confirm',
      path: '/all/routes',
      prepare: async (page) => {
        await page.locator('a.tix', { hasText: 'Solveig Quaresma' }).first().click();
        await page.locator('.edgereview').first().waitFor({ timeout: 15_000 });
        await page.waitForLoadState('networkidle');
        // The target list scrolls its current row into view once it loads; scroll after it.
        await page.waitForTimeout(1200);
        await page.locator('.edgereview').first().evaluate((el) => el.closest('.route')?.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -90));
        await page.waitForTimeout(300);
      },
    },
  ],
  N81: [
    {
      name: '01-timeline-by-vehicle',
      path: '/neurotech/pipeline?status=committed',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Thandiwe Petrescu' }).first().click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'Timeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-tag-a-row',
      path: '/neurotech/pipeline?status=committed',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'Thandiwe Petrescu' }).first().click();
        await page.waitForLoadState('networkidle');
        await page.locator('.tl-filter a', { hasText: 'Vehicle unclear' }).click();
        await page.waitForURL(/tl=unclear/);
        await page.waitForLoadState('networkidle');
        const row = page.locator('.tl-row', { has: page.locator('.vtag.unclear') }).first();
        await row.locator('details.retag > summary').click();
        await row.locator('.retag-body').waitFor();
        await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
      },
    },
  ],
  N80: [
    {
      name: '01-records-to-fix',
      path: '/developer/enrich',
      prepare: async (page) => {
        await page.getByRole('heading', { name: 'Records to fix in Affinity' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
  ],
  N79: [
    {
      name: '01-routes-in-touch',
      path: '/all/routes?touch=1',
      prepare: async (page) => {
        await page.locator('a.tix:has(.ttouch)').first().click();
        await page.locator('.intouch').first().waitFor({ timeout: 15_000 });
        await page.waitForLoadState('networkidle');
      },
    },
    { name: '02-routes-in-touch-left-out', path: '/all/routes' },
    {
      name: '03-feedback-drafts',
      path: '/today',
      prepare: async (page) => {
        // A draft left on another page, as the box keeps one.
        await page.evaluate(() => localStorage.setItem('capitalos.feedback.draft:/all/routes', JSON.stringify({
          title: 'Mark the LPs we already know', body: 'A small check beside their names, and a filter to hide them.',
          kind: 'request', priority: 'P2', at: new Date(Date.now() - 42 * 60_000).toISOString(), pictures: 0,
        })));
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('.rail .railrow button').filter({ hasText: 'Feedback' }).first().click();
        await page.locator('[aria-label="Give feedback"] .fbshots img').first().waitFor({ timeout: 20_000 });
        await page.locator('[aria-label="Give feedback"] .drawerhead button').filter({ hasText: 'Drafts' }).click();
        await page.locator('[aria-label="Give feedback"] .draftlist').waitFor();
        await page.waitForTimeout(300);
      },
    },
  ],
  N78: [
    {
      name: '01-captured-folded',
      path: '/all/calendar',
      prepare: async (page) => {
        await page.locator('.rail .railrow button').filter({ hasText: 'Feedback' }).first().click();
        await page.locator('[aria-label="Give feedback"] .fbshots img').first().waitFor({ timeout: 20_000 });
        await page.locator('[aria-label="Give feedback"]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(300);
      },
    },
  ],
  N77: [
    { name: '01-routes-with-scores', path: '/all/routes' },
    {
      name: '02-routes-search',
      path: '/all/routes?q=family',
    },
  ],
  N76: [
    {
      name: '01-calendar-numbers',
      path: '/all/calendar',
      prepare: async (page) => {
        await page.locator('.calstats').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-calendar-list',
      path: '/all/calendar',
      prepare: async (page) => {
        await page.locator('.dfilters').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -120));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '03-a-kept-draft',
      path: '/all/calendar',
      prepare: async (page) => {
        const open = async () => {
          await page.locator('.rail .railrow button').filter({ hasText: 'Feedback' }).first().click();
          await page.locator('[aria-label="Give feedback"] [contenteditable="true"]').first().waitFor({ timeout: 15_000 });
        };
        await open();
        await page.getByPlaceholder(/intake names it/).fill('The dead weeks lane is hard to read');
        await page.locator('[aria-label="Give feedback"] [contenteditable="true"]').first().click();
        await page.keyboard.type('Half-written when the server restarted: the lane labels overlap the first week.');
        await page.waitForTimeout(400);
        await page.reload({ waitUntil: 'networkidle' });
        await open();
        await page.waitForTimeout(600);
      },
    },
  ],
  N75: [
    {
      name: '01-update-or-touchpoint',
      path: '/all/pipeline',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        await page.getByRole('radio', { name: /touchpoint/i }).first().click();
        await page.locator('.entrytouch').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -160));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-add-context',
      path: '/all/pipeline',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        // Fictional, like everything on the demo: one entry, added once.
        if (!(await page.getByText(/moved the office.s venture allocation/).count())) {
          await page.getByLabel('Context or a correction').fill('He moved the office’s venture allocation to a new CIO in August: ask her, not him, about fund commitments.');
          await page.getByRole('button', { name: 'Add it' }).click();
          await page.getByText(/moved the office.s venture allocation/).first().waitFor({ timeout: 30_000 });
        }
        await page.locator('.addcontext').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -90));
        await page.waitForTimeout(300);
      },
    },
    { name: '03-the-calendar', path: '/neurotech/calendar' },
  ],
  N74: [
    {
      name: '01-the-org-leads',
      path: '/rails/pipeline?status=discussing',
      prepare: async (page) => {
        await page.locator('table.pipeline').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -140));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-the-org-on-its-page',
      path: '/rails/pipeline?status=discussing',
      prepare: async (page) => {
        await page.locator('tr', { hasText: 'Imogen Brankovic' }).locator('a').first().click();
        await page.waitForURL(/\/rails\/pipeline\/[0-9a-f-]{36}/, { timeout: 60_000 });
        await page.waitForLoadState('networkidle');
      },
    },
  ],
  N73: [
    {
      name: '01-the-table-in-its-card',
      path: '/neurotech/pipeline?status=discussing',
      width: 1280,
      prepare: async (page) => {
        await page.locator('table.pipeline').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -140));
        await page.waitForTimeout(300);
      },
    },
  ],
  N72: [
    { name: '01-green-by-default', path: '/today' },
    { name: '02-the-page-you-are-on', path: '/neurotech/pipeline?status=discussing' },
    {
      name: '03-the-theme-picker',
      path: '/settings',
      prepare: async (page) => {
        await page.getByText(/In use/).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await page.waitForTimeout(300);
      },
    },
  ],
  N71: [
    {
      name: '01-fact-check-rounds',
      path: '/developer/enrich',
      prepare: async (page) => {
        await page.getByRole('heading', { name: /How good it is/ }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
  ],
  N70: [
    {
      name: '01-a-few-searches',
      path: '/all/pipeline',
      prepare: async (page) => {
        await openLp(page, 'Yaw Albescu');
        await page.getByRole('heading', { name: 'From public sources' }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '03-the-loops-measurements',
      path: '/developer/enrich',
      prepare: async (page) => {
        await page.getByRole('heading', { name: /How good it is/ }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-a-fact-check',
      path: '/all/pipeline',
      prepare: async (page) => {
        await openLp(page, 'Paloma Jaramillo');
        await page.getByText(/Corrected on/).first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await page.waitForTimeout(300);
      },
    },
  ],
  N69: [
    {
      name: '01-a-reply-we-owe',
      path: '/all/pipeline',
      prepare: async (page) => {
        await openLp(page, 'Anaïs Fontaine');
        await page.getByRole('heading', { name: 'Before any outreach' }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -120));
        await page.waitForTimeout(300);
      },
    },
  ],
  N68: [
    {
      name: '01-page-reads-only',
      path: '/neurotech/pipeline',
      prepare: async (page) => {
        await openLp(page, 'Paloma Jaramillo');
        await page.getByRole('heading', { name: 'From public sources' }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
  ],
  N67: [
    {
      name: '01-a-shared-record',
      path: '/neurotech/pipeline',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        await page.getByRole('heading', { name: 'From public sources' }).evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
  ],
  N66: [
    {
      name: '01-the-connector-plan',
      path: '/developer/enrich',
      prepare: async (page) => {
        await page.getByRole('heading', { name: /The connector plan/ }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-the-line-by-status',
      path: '/neurotech/visualizations?view=line',
      prepare: async (page) => {
        await page.getByRole('heading', { name: 'The line' }).first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
    {
      name: '03-the-room-by-status',
      path: '/neurotech/visualizations?view=room',
      prepare: async (page) => {
        await page.getByRole('heading', { name: 'The room' }).first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
      },
    },
  ],
  N65: [
    {
      name: '01-triage-without-the-web',
      path: '/developer/enrich',
      prepare: async (page) => {
        await page.locator('details summary', { hasText: 'The warm ones' }).first().click().catch(() => {});
        await page.getByRole('heading', { name: /Triage/ }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-the-suggestions-together',
      path: '/developer/enrich',
      prepare: async (page) => {
        await page.getByRole('heading', { name: 'The suggestions, together' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
  ],
  N64: [
    {
      name: '01-a-suggested-strategy',
      path: '/targets?status=discussing',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        await page.getByRole('heading', { name: 'Suggested strategy' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-from-public-sources',
      path: '/targets?status=discussing',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        await page.locator('.pubprof details summary').first().click();
        await page.getByRole('heading', { name: 'From public sources' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '03-the-research-set-and-the-import',
      path: '/dev/enrich',
      prepare: async (page) => { await page.waitForTimeout(200); },
    },
  ],
  N63: [
    {
      name: '01-type-anywhere-any-size-any-colour',
      path: '/today',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2800);
        await page.getByRole('button', { name: /Annotate screenshot 1/ }).click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Add a label' }).click();
        const box = (await page.locator('.setcanvas').boundingBox())!;
        await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
        await page.waitForTimeout(400);
        // Typed at the end, then in the middle: the caret stays where it was put (issue 0005).
        await page.keyboard.type('This number is wrong.', { delay: 3 });
        for (let i = 0; i < 'is wrong.'.length; i++) await page.keyboard.press('ArrowLeft');
        await page.keyboard.type('in the header ', { delay: 3 });
        await page.getByLabel('Text size in pixels').last().fill('37');
        await page.getByLabel('Any colour').last().fill('#2f6fb3');
        await page.waitForTimeout(400);
      },
    },
    {
      name: '02-a-plain-line',
      path: '/today',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2800);
        await page.getByRole('button', { name: /Annotate screenshot 1/ }).click();
        await page.waitForTimeout(500);
        const box = (await page.locator('.setcanvas').boundingBox())!;
        const drag = async (x0: number, y0: number, x1: number, y1: number) => {
          await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
          await page.mouse.up();
        };
        await page.getByRole('button', { name: 'Draw a line' }).click();
        await drag(0.18, 0.42, 0.52, 0.42);
        await page.getByRole('button', { name: 'Point at something' }).click();
        await drag(0.7, 0.62, 0.56, 0.45);
        await page.waitForTimeout(300);
      },
    },
  ],
  N62: [
    {
      name: '01-where-the-pursuits-stand',
      path: '/overview',
      prepare: async (page) => {
        await page.request.post(new URL('/api/session', page.url()).toString(), { data: { vehicleSlug: 'neurotech' } });
        await page.goto(new URL('/overview', page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Where the pursuits stand' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-lately',
      path: '/overview',
      prepare: async (page) => {
        await page.getByRole('heading', { name: 'Lately' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '03-waiting-on-a-first-reply',
      path: '/today',
      prepare: async (page) => {
        await page.request.post(new URL('/api/session', page.url()).toString(), { data: { vehicleSlug: 'all' } });
        // Someone reaches out, and says so on the LP's page: Connecting, waiting on a reply.
        await openLp(page, 'Adaeze Lindgaard');
        await page.locator('.updbox textarea').fill('Emailed Adaeze this morning to ask for twenty minutes before the IC.');
        await page.getByRole('button', { name: 'Save update' }).click();
        await page.locator('.updbox .stat.ready').waitFor({ timeout: 15000 });
        await page.goto(new URL('/today', page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Waiting on a first reply' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
  ],
  N61: [
    {
      name: '01-an-update-read-as-you-type',
      path: '/targets?status=selected',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        await page.getByRole('heading', { name: 'Timeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.locator('.updbox textarea').fill(N61_UPDATE);
        await page.waitForTimeout(250);
      },
    },
    {
      name: '02-the-state-changing-on-the-timeline',
      path: '/targets?status=selected',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        await page.locator('.updbox textarea').fill(N61_UPDATE);
        await page.getByRole('button', { name: 'Save update' }).click();
        await page.locator('.updbox .stat.ready').waitFor({ timeout: 15000 });
        await page.reload({ waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Timeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
  ],
  N60: [
    {
      name: '01-status-with-its-evidence',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-passed-and-why',
      path: '/targets?status=passed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Xiomara Castellane/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
      },
    },
  ],
  N59: [
    {
      name: '01-only-this-raise',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Elif Pellegrino/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Timeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-contact-history',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Elif Pellegrino/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        const own = await page.locator('.elsewhere a').first().getAttribute('href');
        await page.goto(new URL(own!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Contact history' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
  ],
  N58: [
    {
      name: '01-captured-as-drawn',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.locator('button', { hasText: /^\s*✎?\s*Feedback\s*$/ }).first().click();
        await page.locator('.shotthumb img').first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-scrolled-full-size',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(300);
        await page.locator('button', { hasText: /^\s*✎?\s*Feedback\s*$/ }).first().click();
        await page.locator('.shotthumb img').first().waitFor({ timeout: 30_000 });
        await page.locator('.shotopen').first().click();
        await page.waitForTimeout(600);
      },
    },
  ],
  N57: [
    {
      name: '01-on-file-not-accepted',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
      },
    },
    { name: '02-ladders-behind-their-records', path: '/approvals?view=reconcile' },
    {
      // Approves the demo's proposals: every shot after this one sees them recorded.
      name: '03-approved-in-one-go',
      path: '/approvals?view=reconcile',
      prepare: async (page) => {
        await Promise.all([
          page.waitForURL(/approved=/, { timeout: 60_000 }),
          page.getByRole('button', { name: 'Approve the checked' }).click(),
        ]);
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '04-accepted',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
      },
    },
    {
      name: '05-status-behind-the-log',
      path: '/targets?status=selected',
      prepare: async (page) => {
        await page.locator('.pfilters select[aria-label="Flags"]').selectOption('ahead');
        await page.waitForTimeout(250);
      },
    },
  ],
  N56: [
    {
      name: '01-one-timeline',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Elif Pellegrino/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Timeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-questions-and-a-redaction',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Timeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
  ],
  N55: [
    {
      name: '01-a-thread-opened',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Elif Pellegrino/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.locator('details.thread summary').first().click();
        await page.getByRole('heading', { name: 'Touchpoints' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-notes-read',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Elif Pellegrino/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
      },
    },
    { name: '03-suggested-reads', path: '/targets?status=committed' },
    {
      name: '04-confirmed',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Elif Pellegrino/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        const confirm = page.getByRole('button', { name: 'Confirm' });
        if (await confirm.count()) {
          await confirm.first().click();
          await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => b.textContent === 'Confirm'), undefined, { timeout: 20_000 });
          await page.waitForLoadState('networkidle');
        }
        await page.getByRole('heading', { name: 'Touchpoints' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
  ],
  N54: [
    {
      name: '01-the-calendar',
      path: '/dev/affinity/meetings',
      prepare: async (page) => {
        const read = page.getByRole('button', { name: /Read the calendar|Read the window again/ });
        await read.first().click();
        await page.waitForFunction(() => !/reading now/i.test(document.body.innerText) && /Last complete read/.test(document.body.innerText), undefined, { timeout: 60_000 });
        await page.waitForLoadState('networkidle');
        const tr = page.getByRole('button', { name: /Translate: turn the meetings/ });
        if (await tr.count()) {
          await tr.click();
          await page.waitForLoadState('networkidle');
        }
        await page.goto(page.url(), { waitUntil: 'networkidle' });
      },
    },
    {
      name: '02-dated-meetings',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Touchpoints' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
  ],
  N53: [
    {
      name: '01-search-and-filter',
      path: '/targets?status=discussing',
      prepare: async (page) => {
        await page.locator('.pfilters input[type=search]').fill('juan');
        await page.locator('.pfilters select[aria-label="Meetings"]').selectOption('some');
        await page.waitForTimeout(250);
      },
    },
    {
      name: '02-sorted',
      path: '/targets?status=selected',
      prepare: async (page) => {
        await page.locator('th button', { hasText: 'Last touch' }).click();
        await page.waitForTimeout(250);
      },
    },
    { name: '03-passed', path: '/targets?status=passed' },
  ],
  N52: [
    { name: '01-committed', path: '/targets?status=committed' },
    {
      name: '02-signed-per-affinity',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Hana Rasmussen-Oda/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByText('Record what happened').click();
        await page.getByRole('heading', { name: 'Close track' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -90));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '03-signed-again',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Elif Pellegrino/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        // Recorded here, once: a signature, then a second one with its reason.
        if (!(await page.getByText('Subscription agreement, v2').count())) {
          for (const [on, doc, reason] of [['2026-09-19', 'Subscription agreement, v1', ''], ['2026-09-22', 'Subscription agreement, v2', 'Their holding entity changed its name']] as const) {
            const card = page.locator('.card', { hasText: 'Close track' }).first();
            await card.getByText('Record what happened').click();
            await card.locator('input[name=on]').fill(on);
            await card.locator('input[name=document]').fill(doc);
            if (reason) await card.locator('input[name=reason]').fill(reason);
            await card.getByRole('button', { name: 'Record it' }).click();
            await card.getByText('Recorded').waitFor({ timeout: 10_000 });
            await page.reload({ waitUntil: 'networkidle' });
          }
        }
        await page.getByRole('heading', { name: 'Close track' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -90));
        await page.waitForTimeout(200);
      },
    },
  ],
  N51: [
    { name: '01-pipeline-with-the-log', path: '/targets?status=selected' },
    {
      name: '02-the-log',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        // Logged here, once: the third meeting, with their read.
        if (!(await page.getByText('the data room walkthrough').count())) {
          await page.getByText('Log a touchpoint').click();
          await page.locator('input[name=on]').fill('2026-09-20');
          await page.locator('input[name=summary]').fill('Third meeting: the data room walkthrough');
          await page.locator('select[name=read]').selectOption('very_interested');
          await page.getByRole('button', { name: 'Log it' }).click();
          await page.getByText('Logged').waitFor({ timeout: 10_000 });
          await page.reload({ waitUntil: 'networkidle' });
        }
        await page.getByRole('heading', { name: 'Touchpoints' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -250));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '03-form',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByText('Log a touchpoint').click();
        await page.getByRole('radio', { name: 'Research pass' }).click();
        await page.getByRole('button', { name: 'Log it' }).click();
        await page.getByText(/Say what the research pass looked at/).waitFor({ timeout: 10_000 });
        await page.getByRole('heading', { name: 'Touchpoints' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, 380));
        await page.waitForTimeout(200);
      },
    },
  ],
  N50: [
    { name: '01-pipeline', path: '/targets', fullPage: true },
    {
      name: '02-read-from-affinity',
      path: '/targets?status=committed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByText('Change the status').click();
        await page.waitForTimeout(300);
      },
    },
    {
      name: '03-set-here',
      path: '/targets?status=passed',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Xiomara Castellane/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        // Set by a person, through the form: who ended it, why, and when to try again.
        await page.getByText('Change the status').click();
        await page.getByRole('radio', { name: 'Passed' }).click();
        await page.locator('select[name=passedBy]').selectOption('them');
        await page.locator('select[name=reason]').selectOption('timing');
        await page.locator('input[name=nextStep]').fill('Ask again after their Q1 allocation meeting');
        await page.locator('input[name=nextStepOn]').fill('2027-01-20');
        await page.getByRole('button', { name: 'Save status' }).click();
        await page.getByText('Saved').waitFor({ timeout: 10_000 });
        await page.reload({ waitUntil: 'networkidle' });
      },
    },
    {
      name: '04-mapping',
      path: '/dev/affinity/mapping',
      prepare: async (page) => {
        await page.getByRole('heading', { name: 'Our statuses' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
        await page.waitForTimeout(200);
      },
    },
  ],
  N49: [
    {
      name: '01-every-note',
      path: '/dev/affinity/notes',
      fullPage: true,
      prepare: async (page) => {
        // The demo copy may be empty (a reset) or already read; either way, end on a full read.
        const read = page.getByRole('button', { name: /Read every note|Read everything again/ });
        if (!(await read.count())) {
          await page.getByRole('button', { name: /Count the notes|Count again/ }).first().click();
          await page.waitForLoadState('networkidle');
        }
        await page.getByRole('button', { name: /Read every note|Read everything again/ }).click();
        // The read runs in the server while the page refreshes itself; wait for it to finish.
        await page.waitForFunction(() => {
          const t = document.body.innerText;
          return !/reading now/i.test(t) && /Last complete read\s*just now · everything/.test(t);
        }, undefined, { timeout: 60_000 });
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => window.scrollTo(0, 0));
      },
    },
    {
      name: '02-on-the-lp',
      path: '/targets',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Thandiwe Petrescu/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Notes in Affinity' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '03-only-what-changed',
      path: '/dev/affinity/notes',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Read what changed/ }).click();
        await page.waitForFunction(() => {
          const t = document.body.innerText;
          return !/reading now/i.test(t) && /Last complete read\s*just now · what changed since/.test(t);
        }, undefined, { timeout: 60_000 });
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => window.scrollTo(0, 0));
      },
    },
  ],
  N48: [
    {
      name: '01-notes-counted',
      path: '/dev/affinity/slice',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Count the notes|Count again/ }).click();
        await page.getByText('Notes in the account').waitFor();
        await page.getByRole('heading', { name: 'Notes, the cheaper way?' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-allowlist',
      path: '/dev/affinity',
      prepare: async (page) => {
        await page.getByRole('heading', { name: 'What this server may ask' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
        await page.waitForTimeout(200);
      },
    },
  ],
  N47: [
    {
      name: '01-translated',
      path: '/dev/affinity/mapping',
      prepare: async (page) => {
        await page.getByRole('button', { name: /^Translate( again)?$/ }).click();
        await page.getByText('Pursuits by vehicle').waitFor();
        await page.getByRole('heading', { name: 'Translate into the tool' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
        await page.waitForTimeout(200);
      },
    },
    { name: '02-claim-beside-evidence', path: '/vehicles' },
    {
      name: '03-a-translated-pursuit',
      path: '/vehicles',
      prepare: async (page) => {
        const href = await page.getByRole('link', { name: /Hana Rasmussen-Oda/ }).first().getAttribute('href');
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        await page.waitForTimeout(200);
      },
    },
  ],
  N46: [
    {
      name: '01-our-stages',
      path: '/dev/affinity/lists',
      prepare: async (page) => {
        // The demo fixtures gained fields in this version: land them, then write the mapping.
        await page.getByRole('button', { name: /Discover/ }).click();
        await page.getByText('matched').first().waitFor();
        await page.goto(page.url().replace('/lists', '/slice'), { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: /Read the/ }).click();
        await page.getByRole('button', { name: /Notes and relationships/ }).click({ timeout: 30_000 });
        await page.getByText(/relationship sets/).first().waitFor({ timeout: 30_000 });
        await page.goto(page.url().replace('/slice', '/mapping'), { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: /Write the proposed mapping|Regenerate, keeping your edits/ }).click();
        await page.getByText('Status words with a meaning').waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
      },
    },
    {
      name: '02-a-list-mapped',
      path: '/dev/affinity/mapping',
      prepare: async (page) => {
        // Not scrollIntoViewIfNeeded: the heading sits on the fold, which counts as visible.
        await page.getByRole('heading', { name: 'PLC Neurotech I — LP pipeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
        await page.waitForTimeout(200);
      },
    },
  ],
  N45: [
    {
      name: '01-lists-compared',
      path: '/dev/affinity/lists',
      prepare: async (page) => {
        // The demo database was rebuilt in this version; land the fake Affinity again first.
        await page.getByRole('button', { name: /Discover/ }).click();
        await page.getByText('matched').first().waitFor();
        await page.goto(page.url().replace('/lists', '/slice'), { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: /Read the/ }).click();
        await page.getByRole('button', { name: /Notes and relationships/ }).click({ timeout: 30_000 });
        await page.getByText(/relationship sets/).first().waitFor({ timeout: 30_000 });
        await page.goto(page.url().replace('/slice', '/inventory'), { waitUntil: 'networkidle' });
        await page.getByText('Older lists, against the one in use').scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -60));
        await page.waitForTimeout(200);
      },
    },
    { name: '02-history-tag', path: '/today' },
  ],
  N44: [
    {
      name: '01-answer-sheet',
      path: '/dev/affinity/inventory',
      prepare: async (page) => {
        await page.getByRole('button', { name: /answer sheet|keeping your answers/ }).click();
        await page.getByText('Show the file').waitFor();
        await page.getByText('Show the file').click();
        await page.locator('details.sheet').scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
      },
    },
    // Run after answering two values by hand in data/demo/answers.jsonc — one with a rung name
    // that does not exist — so the card shows the count moving and the file's mistake named.
    {
      name: '02-a-wrong-answer',
      path: '/dev/affinity/inventory',
      prepare: async (page) => {
        await page.getByText('Answer sheet', { exact: true }).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -60));
        await page.waitForTimeout(200);
      },
    },
  ],
  N43: [
    { name: '01-inventory', path: '/dev/affinity/inventory', fullPage: true },
    { name: '02-questions', path: '/dev/affinity/inventory' },
  ],
  N41: [
    {
      name: '01-lists-discovered',
      path: '/dev/affinity/lists',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('button', { name: /Discover/ }).click();
        await page.getByText('matched').first().waitFor();
        await page.waitForLoadState('networkidle');
        await page.locator('tr', { hasText: 'LP pipeline' }).locator('details summary').click();
        // Opening it scrolls the page, and a full-page capture draws the sticky bars wherever
        // the scroll left them.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
      },
    },
    { name: '02-from-the-affinity-page', path: '/dev/affinity' },
  ],
  N40: [
    { name: '01-changelog-webp', path: '/dev/changelog' },
    { name: '02-issue-0021', path: '/issues/0021' },
  ],
  N39: [
    {
      name: '01-connection-tested',
      path: '/dev/affinity',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Test the connection' }).click();
        await page.getByText('Scale or Advanced').first().waitFor();
        await page.waitForLoadState('networkidle');
      },
    },
    { name: '02-guesses', path: '/dev/settings' },
  ],
  // Demo only, like every entry here: refuseReal() stops the run on anything else.
  N38: [
    { name: '01-data-page', path: '/dev/data', fullPage: true },
    { name: '02-demo-badge', path: '/today' },
    { name: '03-strategy-all-vehicles', path: '/all/strategy' },
  ],
  N37: [
    { name: '01-annotate-from-the-picture', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.locator('.mdrich').click();
        await page.keyboard.type('The owner column is wrong on the ask log:', { delay: 2 });
        await page.evaluate(async () => {
          const c = document.createElement('canvas'); c.width = 520; c.height = 260;
          const g = c.getContext('2d')!;
          g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 520, 260);
          g.fillStyle = '#1A1917'; g.font = '600 22px sans-serif'; g.fillText('Ask log · owner', 24, 44);
          g.fillStyle = '#E4E0D6'; for (let i = 0; i < 4; i++) g.fillRect(24, 72 + i * 44, 472, 1);
          g.fillStyle = '#5E5A52'; g.font = '16px sans-serif';
          ['Solveig Quaresma · Keziah Grimaldo', 'Vetchling Wagtail · Lior', 'Fernhollow Umberfield Trust · Lior'].forEach((t, i) => g.fillText(t, 24, 100 + i * 44));
          const blob: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/png'));
          const dt = new DataTransfer(); dt.items.add(new File([blob], 'ask-log.png', { type: 'image/png' }));
          document.querySelector('.mdfield > div:nth-of-type(2)')!
            .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        });
        await page.waitForTimeout(700);
        await page.locator('.mdembed').first().getByRole('button', { name: /Annotate/ }).click();
        await page.waitForTimeout(500);
        const box = (await page.locator('.setcanvas').boundingBox())!;
        await page.getByRole('button', { name: 'Box it' }).click();
        await page.mouse.move(box.x + box.width * 0.03, box.y + box.height * 0.26);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.43, { steps: 8 });
        await page.mouse.up();
        await page.getByRole('button', { name: 'Done' }).last().click();
        await page.waitForTimeout(700);
        await page.locator('.mdembed').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      } },
    { name: '02-wider', path: '/today', width: 1600, prepare: async (page) => {
        await page.evaluate(() => { try { localStorage.removeItem('capitalos.feedback.wide'); } catch { /* */ } });
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByRole('button', { name: /Wider/ }).click();
        await page.waitForTimeout(500);
        await page.locator('.mdrich').click();
        await page.keyboard.type('A long report gets the room it needs. The words sit on the left and the pictures on the right, and the choice is remembered in this browser.', { delay: 1 });
        await page.waitForTimeout(300);
      } },
  ],
  N36: [
    { name: '01-section-headings', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByText('State of play').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      } },
    { name: '02-labels', path: '/approvals', prepare: async (page) => {
        await page.waitForTimeout(300);
      } },
    { name: '03-the-name', path: '/today', prepare: async (page) => {
        await page.waitForTimeout(300);
      } },
  ],
  N35: [
    { name: '01-pick-a-part', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByRole('button', { name: /Pick a part/ }).click();
        await page.waitForTimeout(300);
        // The four headline cards, dragged corner to corner.
        const cards = await page.locator('.kpis').first().boundingBox();
        await page.mouse.move(cards!.x - 6, cards!.y - 6);
        await page.mouse.down();
        await page.mouse.move(cards!.x + cards!.width + 6, cards!.y + cards!.height + 6, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(3500);
        await page.locator('.shotlist .shotopen').last().click();
        await page.waitForTimeout(600);
      } },
    { name: '02-dropped-image-annotated', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.locator('.mdrich').click();
        await page.keyboard.type('The ask log shows the wrong owner. See the picture:', { delay: 2 });
        await page.evaluate(async () => {
          const c = document.createElement('canvas'); c.width = 520; c.height = 300;
          const g = c.getContext('2d')!;
          g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 520, 300);
          g.fillStyle = '#1A1917'; g.font = '600 22px sans-serif'; g.fillText('Ask log · owner', 24, 48);
          g.fillStyle = '#E4E0D6'; for (let i = 0; i < 5; i++) g.fillRect(24, 80 + i * 40, 472, 1);
          g.fillStyle = '#5E5A52'; g.font = '16px sans-serif';
          ['Solveig Quaresma · Keziah Grimaldo', 'Vetchling Wagtail · Lior', 'Fernhollow Umberfield Trust · Lior', 'Kowalczyk · Fiachra'].forEach((t, i) => g.fillText(t, 24, 108 + i * 40));
          const blob: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/png'));
          const dt = new DataTransfer(); dt.items.add(new File([blob], 'ask-log.png', { type: 'image/png' }));
          document.querySelector('.mdfield > div:nth-of-type(2)')!
            .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        });
        await page.waitForTimeout(700);
        await page.locator('.dropstrip .shotopen').first().click();
        await page.waitForTimeout(500);
        const box = (await page.locator('.setcanvas').boundingBox())!;
        await page.getByRole('button', { name: 'Box it' }).click();
        await page.mouse.move(box.x + box.width * 0.03, box.y + box.height * 0.3);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.44, { steps: 8 });
        await page.mouse.up();
        await page.getByRole('button', { name: 'Done' }).last().click();
        await page.waitForTimeout(700);
        await page.locator('.dropstrip').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      } },
    { name: '03-give-more-feedback', path: '/today', prepare: async (page) => {
        // Never write a real issue from a screenshot run: intake is answered here.
        let n = 41;
        await page.route('**/api/feedback', async (route) => {
          n += 1;
          const body = route.request().postDataJSON() as { body?: string };
          const title = (body.body ?? '').split('.')[0]!.trim();
          await route.fulfill({ json: { id: `00${n}`, title, location: `issues/00${n}.md` } });
        });
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        for (const text of ['The rail loses its scroll position when I switch user.', 'Approvals should say who is waiting on whom.']) {
          await page.locator('.mdrich').click();
          await page.keyboard.type(text, { delay: 2 });
          await page.keyboard.press('Meta+Enter');
          await page.waitForTimeout(1200);
          if (text.startsWith('The rail')) {
            await page.getByRole('button', { name: 'Give more feedback' }).click();
            await page.waitForTimeout(2600);
          }
        }
        await page.waitForTimeout(400);
      } },
  ],
  N34: [
    { name: '01-the-network', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The network/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '02-the-leverage', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The leverage/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '03-the-coverage', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The coverage/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '04-the-radar', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The radar/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '05-the-strip', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The strip/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '06-console', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The network/ }).click();
        await page.waitForTimeout(400);
        await page.locator('.netnode').last().click();
        await page.waitForTimeout(400);
      } },
    { name: '07-filter', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.locator('.filterbar select').nth(1).selectOption('blocked');
        await page.waitForTimeout(400);
      } },
  ],
  N33: [
    { name: '01-issues-fixed-in', path: '/issues', prepare: async (page) => {
        await page.getByRole('button', { name: 'Any status' }).click();
        await page.waitForTimeout(350);
      } },
    { name: '02-fix-history', path: '/issues/0014', prepare: async (page) => {
        await page.waitForTimeout(300);
      } },
    { name: '03-everything', path: '/everything/visualizations', width: 1600, prepare: async (page) => {
        await page.waitForTimeout(500);
      } },
  ],
  N32: [
    { name: '01-typing', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2800);
        await page.getByRole('button', { name: /Annotate screenshot 1/ }).click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Add a label' }).click();
        const box = (await page.locator('.setcanvas').boundingBox())!;
        await page.mouse.click(box.x + box.width * 0.28, box.y + box.height * 0.26);
        await page.waitForTimeout(500);
        await page.keyboard.type('This number is wrong, and the label wraps instead of running off the edge.', { delay: 3 });
        await page.keyboard.press('Enter');
        await page.keyboard.type('Return makes a line break.', { delay: 3 });
        await page.waitForTimeout(350);
      } },
    { name: '02-placed-and-movable', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2800);
        await page.getByRole('button', { name: /Annotate screenshot 1/ }).click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Add a label' }).click();
        const box = (await page.locator('.setcanvas').boundingBox())!;
        await page.mouse.click(box.x + box.width * 0.26, box.y + box.height * 0.22);
        await page.waitForTimeout(500);
        await page.keyboard.type('Placed, then dragged here and narrowed by its corner.', { delay: 3 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const before = (await page.locator('.setlabel').first().boundingBox())!;
        await page.mouse.move(before.x + 40, before.y + 10);
        await page.mouse.down();
        await page.mouse.move(before.x + 150, before.y + 220, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(400);
      } },
  ],
  N31: [
    { name: '01-no-title-needed', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.locator('.mdrich').click();
        await page.locator('.mdrich').type('The rail scroll position jumps to the top when I switch user.', { delay: 4 });
        await page.waitForTimeout(400);
      } },
    { name: '02-markdown-source', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByRole('button', { name: 'Markdown' }).click();
        const ta = page.locator('.mdfield textarea');
        await ta.click();
        await ta.type('```json\n{ "route": "/approvals" }\n```\n\nTyping this used to be impossible.', { delay: 6 });
        await page.waitForTimeout(400);
      } },
    { name: '03-shortcuts', path: '/today', prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByRole('button', { name: /all shortcuts/ }).click();
        await page.waitForTimeout(350);
      } },
  ],
  N30: [
    { name: '01-record-the-wire', path: '/soft-hard', prepare: async (page) => {
        await page.getByRole('heading', { name: 'The hard track' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const btn = page.getByRole('button', { name: 'Record the wire' }).first();
        if (await btn.count()) await btn.click();
        await page.waitForTimeout(300);
      } },
    { name: '02-what-moves-the-score', path: '/neurotech/fit/__CEDAR_FIT__', prepare: async (page) => {
        await page.getByRole('heading', { name: 'What moves this number' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '03-one-collision', path: '/approvals', prepare: async (page) => {
        await page.getByRole('link', { name: /Route to Solveig Quaresma/ }).click();
        await page.waitForLoadState('networkidle');
        await page.getByText(/guard.*refusing/i).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N29: [
    { name: '01-the-map', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The map/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '02-the-plant', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The plant/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '03-the-moves', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The moves/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '04-the-grid', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The grid/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '05-the-economy', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The economy/ }).click();
        await page.waitForTimeout(500);
      } },
    { name: '06-ten-tabs', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.waitForTimeout(400);
      } },
  ],
  N28: [
    { name: '01-the-line', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.waitForTimeout(500);
      } },
    { name: '02-the-load', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The load/ }).click();
        await page.waitForTimeout(450);
      } },
    { name: '03-the-flow', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The flow/ }).click();
        await page.waitForTimeout(450);
      } },
    { name: '04-the-clock', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The clock/ }).click();
        await page.waitForTimeout(450);
      } },
    { name: '05-the-room', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('tab', { name: /The room/ }).click();
        await page.waitForTimeout(450);
      } },
    { name: '06-one-vehicle', path: '/neurotech/visualizations', width: 1600, prepare: async (page) => {
        await page.waitForTimeout(500);
      } },
    { name: '07-the-list', path: '/all/visualizations', width: 1600, prepare: async (page) => {
        await page.getByRole('heading', { name: 'The same floor, as a list' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      } },
  ],
  N27: [
    { name: '01-issue-filters', path: '/issues', prepare: async (page) => {
        await page.getByRole('button', { name: 'P2' }).click();
        await page.waitForTimeout(350);
      } },
  ],
  N26: [
    { name: '01-both-labelled', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('heading', { name: 'Every way we could find out' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '02-person-runs-it', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('button', { name: 'A person runs it' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('heading', { name: 'Every way we could find out' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '03-agent-runs-it', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('button', { name: 'Agent runs it' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('heading', { name: 'Every way we could find out' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '04-queue', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('heading', { name: 'The queue' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N25: [
    { name: '01-rows', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('button', { name: 'Agent runs it' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('heading', { name: 'Every way we could find out' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '02-sorted-by-cost', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('columnheader', { name: /Cost/ }).click();
        await page.waitForTimeout(400);
        await page.getByRole('heading', { name: 'Every way we could find out' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N24: [
    { name: '01-wide', path: '/routes', prepare: async (page) => {
        await page.getByText('How much weight this carries').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '02-narrow', path: '/routes', width: 1180, prepare: async (page) => {
        await page.getByText('How much weight this carries').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N23: [
    { name: '01-bars', path: '/routes', prepare: async (page) => {
        await page.getByText('How much weight this carries').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '02-routes-full', path: '/routes', fullPage: true },
    { name: '03-lightbox', path: '/dev/changelog', prepare: async (page) => {
        await page.locator('img.clshot').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await page.locator('img.clshot').first().click();
        await page.waitForTimeout(700);
      } },
  ],
  N22: [
    { name: '01-picker-and-bars', path: '/routes' },
    { name: '02-search', path: '/routes', prepare: async (page) => {
        await page.getByLabel('Search targets').fill('Jaramillo');
        await page.waitForTimeout(400);
      } },
    { name: '03-score-filter', path: '/routes', prepare: async (page) => {
        await page.getByRole('button', { name: '75+' }).click();
        await page.waitForTimeout(400);
      } },
    { name: '04-propose', path: '/routes', prepare: async (page) => {
        await page.getByText('The ask to make.').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N21: [
    { name: '01-queue-and-table', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('heading', { name: 'The queue' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '02-weights', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('button', { name: 'Adjust the weights' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('heading', { name: 'The queue' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      } },
    { name: '03-filters', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('button', { name: 'Agent runs it' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('heading', { name: 'Every way we could find out' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      } },
    { name: '04-chosen', path: '/orgs/enrichment', prepare: async (page) => {
        await page.getByRole('heading', { name: 'Every way we could find out' })
          .scrollIntoViewIfNeeded();
        await page.getByRole('checkbox').nth(1).check();
        await page.waitForTimeout(1600);
        await page.getByRole('heading', { name: 'The queue' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      } },
  ],
  N20: [
    { name: '01-changelog-wide', path: '/dev/changelog' },
  ],
  N19: [
    {
      name: '01-seeded-and-buttons',
      path: '/neurotech/strategy',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByPlaceholder("Guard message doesn't say whose ask is blocking").fill(
          'Leverage should say what it would be if the effort estimate is wrong',
        );
        await page.waitForTimeout(400);
      },
    },
    {
      name: '02-two-screenshots',
      path: '/neurotech/strategy',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByRole('button', { name: 'Pick a part' }).click();
        await page.waitForTimeout(500);
        await page.mouse.move(420, 300);
        await page.mouse.down();
        await page.mouse.move(1180, 560, { steps: 14 });
        await page.mouse.up();
        await page.waitForTimeout(3200);
      },
    },
    {
      name: '03-text-tool',
      path: '/neurotech/strategy',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByRole('button', { name: 'Annotate screenshot 1' }).click();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: 'Add a label' }).click();
        const box = await page.locator('canvas.setcanvas').boundingBox();
        if (box) await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.42);
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /^L$/ }).click();
        await page.locator('input.settext').click();
        await page.keyboard.type('what if this is 5 days?');
        await page.waitForTimeout(400);
      },
    },
    {
      name: '04-placed-label',
      path: '/neurotech/strategy',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2600);
        await page.getByRole('button', { name: 'Annotate screenshot 1' }).click();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: 'Add a label' }).click();
        const box = await page.locator('canvas.setcanvas').boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.42);
          await page.waitForTimeout(400);
          await page.getByRole('button', { name: /^L$/ }).click();
          await page.locator('input.settext').click();
          await page.keyboard.type('what if this is 5 days?');
          await page.getByRole('button', { name: 'Place the label' }).click();
          await page.waitForTimeout(300);
          await page.getByRole('button', { name: 'Point at something' }).click();
          await page.mouse.move(box.x + box.width * 0.44, box.y + box.height * 0.44);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.36, { steps: 10 });
          await page.mouse.up();
        }
        await page.waitForTimeout(400);
      },
    },
  ],
  N18: [
    {
      name: '01-no-screenshot-yet',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(700);
        await page.getByPlaceholder("Guard message doesn't say whose ask is blocking").fill(
          'Blocked actions should name the ticket that would unblock them',
        );
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-rich-editor',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: 'Markdown' }).click();
        await page.locator('.mdfield textarea').fill('### What I expected\n\nThe score to say **which reading** moved it, not just the total. On `/approvals` there are four open tickets and two are for the same target.\n\n- link the row to the ticket when one exists\n- say "no ticket yet" when one does not\n');
        await page.getByRole('button', { name: 'Rich' }).click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: '03-source-view',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: 'Markdown' }).click();
        await page.locator('.mdfield textarea').fill('### What I expected\n\nThe score to say **which reading** moved it, not just the total. On `/approvals` there are four open tickets and two are for the same target.\n\n- link the row to the ticket when one exists\n- say "no ticket yet" when one does not\n');
        await page.waitForTimeout(400);
      },
    },
    {
      name: '04-region-picker',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: 'Pick a part' }).click();
        await page.waitForTimeout(400);
        await page.mouse.move(400, 260);
        await page.mouse.down();
        await page.mouse.move(980, 470, { steps: 14 });
        await page.waitForTimeout(350);
      },
    },
    {
      name: '05-cropped',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(700);
        await page.getByRole('button', { name: 'Pick a part' }).click();
        await page.waitForTimeout(400);
        await page.mouse.move(400, 260);
        await page.mouse.down();
        await page.mouse.move(980, 470, { steps: 14 });
        await page.mouse.up();
        await page.waitForTimeout(3500);
      },
    },
  ],
  N17: [
    { name: '01-gaps', path: '/research/enrichment' },
    { name: '02-catalogue', path: '/research/enrichment', prepare: async (page) => {
        await page.getByRole('heading', { name: 'Buy', exact: true }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '03-rejected', path: '/research/enrichment', prepare: async (page) => {
        await page.getByText('bulk people data', { exact: false }).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '04-target-gaps', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'what to do →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'What we do not know about them' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N16: [
    { name: '01-routes-influence', path: '/routes', fullPage: true },
    { name: '02-decomposition', path: '/routes', prepare: async (page) => {
        await page.getByText('How much weight this carries').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N15: [
    { name: '01-state-of-play', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'what to do →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
      } },
    { name: '02-needs', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'what to do →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'What they need before they can say yes' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '03-option-space', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'what to do →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'What we could do' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '04-oyelaran', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'what to do →' }).nth(1).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'What they need before they can say yes' })
          .scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
  ],
  N14: [
    { name: '01-assessment', path: '/neurotech/strategy' },
    { name: '02-board', path: '/neurotech/strategy', prepare: async (page) => {
        await page.getByRole('heading', { name: 'What to do next' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '03-compounding', path: '/neurotech/strategy', prepare: async (page) => {
        await page.getByRole('heading', { name: 'What compounds' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '04-commit', path: '/neurotech/strategy', prepare: async (page) => {
        await page.getByRole('heading', { name: 'Propose and commit' }).scrollIntoViewIfNeeded();
        await page.locator('.mdfield textarea').fill(
          '- @mara books the third-party verification this week, letter by 2026-10-02\n'
          + '- @juan asks Greylag Gorsebrook for a reference call and a note to Eskildsen\n'
          + '- @ines writes the CPA-letter note for Albescu by 2026-09-24\n',
        );
        await page.waitForTimeout(400);
      } },
    { name: '05-assigned', path: '/neurotech/strategy', prepare: async (page) => {
        await page.getByRole('heading', { name: 'What to do next' }).scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: 'Assign' }).first().click();
        await page.waitForTimeout(1800);
        await page.getByRole('heading', { name: 'What to do next' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      } },
  ],
  N13: [
    {
      name: '01-markdown-write',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(3000);
        await page.getByPlaceholder("Guard message doesn't say whose ask is blocking").fill(
          'Blocked actions should carry the ticket that would unblock them',
        );
        await page.locator('.mdfield textarea').fill(
          '### What I expected\n\n'
          + 'The standup names the **ticket kind** an action needs, but not *which* open ticket '
          + 'would satisfy it. On `/approvals` there are four, and two of them are for the same '
          + 'target.\n\n'
          + '- link the row to the ticket when one already exists\n'
          + '- say "no ticket yet" when one does not\n',
        );
        await page.waitForTimeout(400);
      },
    },
    {
      name: '02-markdown-preview',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(3000);
        await page.locator('.mdfield textarea').fill(
          '### What I expected\n\n'
          + 'The standup names the **ticket kind** an action needs, but not *which* open ticket '
          + 'would satisfy it.\n\n'
          + '- link the row to the ticket when one already exists\n'
          + '- say "no ticket yet" when one does not\n',
        );
        await page.getByRole('button', { name: 'Preview' }).click();
        await page.waitForTimeout(400);
      },
    },
    { name: '03-issue-rendered', path: '/issues/0008', fullPage: true },
  ],
  N12: [
    { name: '01-deep-crumb', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
      } },
    { name: '02-crumb-hover', path: '/research/sources' },
  ],
  N11: [
    {
      name: '01-real-capture',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(3000);
        await page.getByPlaceholder("Guard message doesn't say whose ask is blocking").fill(
          'Ranks jump around when a gate is answered',
        );
        await page.waitForTimeout(300);
      },
    },
    {
      name: '02-toolbar-on-the-image',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(3000);
        await page.getByRole('button', { name: 'Open the screenshot to annotate it' }).click();
        await page.waitForTimeout(700);
        const box = await page.locator('canvas.setcanvas').boundingBox();
        if (box) {
          // freehand is the default tool now — no click needed
          await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.30);
          await page.mouse.down();
          for (let i = 0; i <= 22; i += 1) {
            const t = i / 22;
            await page.mouse.move(
              box.x + box.width * (0.30 + 0.16 * Math.sin(t * Math.PI * 2)),
              box.y + box.height * (0.30 + 0.07 * Math.cos(t * Math.PI * 2)),
            );
          }
          await page.mouse.up();
        }
        await page.waitForTimeout(400);
      },
    },
    {
      name: '03-undo-redo',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(3000);
        await page.getByRole('button', { name: 'Open the screenshot to annotate it' }).click();
        await page.waitForTimeout(700);
        const box = await page.locator('canvas.setcanvas').boundingBox();
        if (box) {
          await page.getByRole('button', { name: 'Point at something' }).click();
          await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.33, box.y + box.height * 0.3, { steps: 10 });
          await page.mouse.up();
          await page.getByRole('button', { name: 'Box it' }).click();
          await page.mouse.move(box.x + box.width * 0.24, box.y + box.height * 0.24);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.33, { steps: 10 });
          await page.mouse.up();
          await page.keyboard.press('Meta+z');
          await page.waitForTimeout(250);
        }
        await page.waitForTimeout(300);
      },
    },
  ],
  N10: [
    { name: '01-overview-section', path: '/today' },
    {
      name: '02-overview-collapsed',
      path: '/today',
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Overview' }).click();
        await page.waitForTimeout(400);
      },
    },
  ],
  N9: [
    { name: '01-standup-today', path: '/standup/2026-09-20', fullPage: true },
    { name: '02-standup-pinned', path: '/standup/2026-09-19', fullPage: true },
    { name: '03-standup-actions', path: '/standup/2026-09-20', prepare: async (page) => {
        await page.getByRole('heading', { name: 'What to do, in order' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      } },
    { name: '04-calendar-all', path: '/all/calendar' },
    { name: '05-calendar-vehicle', path: '/neurotech/calendar', fullPage: true },
  ],
  N8: [
    { name: '04-issue-with-shot', path: '/issues/0007', fullPage: true },
    {
      name: '01-feedback-with-shot',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2500);
        await page.getByPlaceholder("Guard message doesn't say whose ask is blocking").fill(
          'The fit score needs a "why this moved" line',
        );
        await page.locator('textarea').fill(
          'Vetchling Wagtail went from 0.62 to 0.60 and nothing on the page says which reading changed. A one-line diff against the last assessment would answer it.',
        );
        await page.waitForTimeout(400);
      },
    },
    {
      name: '02-annotating',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: 'Open the screenshot to annotate it' }).click();
        await page.waitForTimeout(600);
        const box = await page.locator('canvas.setcanvas').boundingBox();
        if (box) {
          // an arrow at the score
          await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.34);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.22, { steps: 12 });
          await page.mouse.up();
          // a box around the distribution strip
          await page.getByRole('button', { name: 'Box it' }).click();
          await page.mouse.move(box.x + box.width * 0.26, box.y + box.height * 0.245);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.33, { steps: 12 });
          await page.mouse.up();
        }
        await page.waitForTimeout(400);
      },
    },
    {
      name: '03-annotated-thumb',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Feedback/ }).click();
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: 'Open the screenshot to annotate it' }).click();
        await page.waitForTimeout(600);
        const box = await page.locator('canvas.setcanvas').boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.34);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.22, { steps: 12 });
          await page.mouse.up();
        }
        await page.getByRole('button', { name: 'Done' }).click();
        await page.waitForTimeout(700);
        await page.getByPlaceholder("Guard message doesn't say whose ask is blocking").fill(
          'The fit score needs a "why this moved" line',
        );
        await page.waitForTimeout(300);
      },
    },
  ],
  N7: [
    { name: '01-people-tab', path: '/orgs/g/people', fullPage: true },
    {
      name: '02-firm-people',
      path: '/orgs/g/firms',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('link', { name: /Open the page for Vetchling Wagtail Capital/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '03-person-two-firms',
      path: '/orgs/g/people',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Open the page for Perpetua Eskildsen/ }).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'Where they sit' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      },
    },
    {
      name: '04-summary-acts-for',
      path: '/orgs/g/people',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Summarise Anselm Rautio/ }).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
      },
    },
    { name: '05-firms-tab', path: '/orgs/g/firms' },
  ],
  N6: [
    { name: '01-preferences', path: '/settings' },
    {
      name: '02-green-theme',
      path: '/settings',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Green/ }).click();
        await page.waitForTimeout(400);
      },
    },
    {
      name: '03-green-overview',
      path: '/settings',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Green/ }).click();
        await page.waitForTimeout(300);
        await page.getByRole('button', { name: /PLC Neurotech I/ }).click();
        await page.waitForTimeout(1500);
      },
    },
    {
      name: '04-green-fit',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '05-grants-under-rnd',
      path: '/grants',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Grants rail/ }).click();
        await page.waitForTimeout(1500);
      },
    },
  ],
  N5: [
    { name: '01-score-and-rank', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
      } },
    { name: '02-readings', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'Firm–vehicle fit' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      } },
    { name: '03-rollup-ranked', path: '/neurotech/fit', fullPage: true },
    { name: '04-top-of-pool', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).first().click();
        await page.waitForLoadState('networkidle');
      } },
    { name: '05-blocked-last', path: '/neurotech/fit', prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).last().click();
        await page.waitForLoadState('networkidle');
      } },
  ],
  N4: [
    { name: '01-orgs-directory', path: '/orgs/g/all', fullPage: true },
    {
      name: '02-summary-pane',
      path: '/orgs/g/all',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Summarise Albescu Capital/ }).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
      },
    },
    {
      name: '03-org-page',
      path: '/orgs/g/all',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('link', { name: /Open the page for Solveig Quaresma/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '04-summary-from-fit',
      path: '/fit',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Summarise Kowalczyk Family Office/ }).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
      },
    },
    { name: '05-connectors', path: '/orgs/g/connectors' },
  ],
  N3: [
    { name: '01-fit-all-vehicles', path: '/all/fit', fullPage: true },
    { name: '02-fit-one-vehicle', path: '/neurotech/fit', fullPage: true },
    {
      name: '03-diagnosis-and-gates',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '04-dimensions-biggest-misses',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: 'Biggest misses' }).click();
        await page.getByRole('heading', { name: 'Firm–vehicle fit' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      },
    },
    {
      name: '05-value-and-perception',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(2).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'What they think of us' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      },
    },
    {
      name: '06-ties-and-decision',
      path: '/neurotech/fit',
      prepare: async (page) => {
        await page.getByRole('link', { name: 'full assessment →' }).nth(3).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'Ties between us' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
      },
    },
  ],
  N2: [
    { name: '01-changelog-newest-first', path: '/dev/changelog' },
  ],
  N1: [
    { name: '01-overview-all', path: '/overview' },
    {
      name: '02-overview-vehicle',
      path: '/overview',
      prepare: async (page) => {
        await page.getByRole('button', { name: /PLC Neurotech I/ }).click();
        await page.waitForTimeout(1400);
      },
    },
    {
      name: '03-pane-closed',
      path: '/overview',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Hide the detail pane/ }).click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: '04-nav-collapsed',
      path: '/overview',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Show the detail pane/ }).click();
        await page.getByRole('button', { name: 'PL Capital' }).click();
        await page.getByRole('button', { name: 'Relationships' }).click();
        await page.getByRole('button', { name: 'Developer' }).click();
        await page.waitForTimeout(500);
      },
    },
    { name: '05-operations', path: '/operations' },
    { name: '06-relationships', path: '/orgs/g/all' },
    { name: '07-rnd', path: '/rnd' },
    { name: '08-dev-changelog', path: '/dev/changelog' },
    { name: '09-dev-status', path: '/dev/status' },
    { name: '10-dev-modules', path: '/dev/modules' },
    { name: '11-dev-settings', path: '/dev/settings' },
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

  // Issue 0115 — batches 13 to 19 had no screenshots because the builders on those
  // branches could not run a server. These backfill the UI-visible ones.
  'fit-0096': [
    { name: '01-actions', path: '/neurotech/fit', fullPage: true },
  ],
  'tables-0091-0093': [
    { name: '01-selection-table', path: '/selection', fullPage: true },
    { name: '02-pipeline-org-row', path: '/neurotech/pipeline?status=discussing', fullPage: true },
  ],
  'strategy-0097': [
    { name: '01-what-to-do', path: '/neurotech/strategy', fullPage: true },
  ],
  'developer-0098-0101': [
    { name: '01-changelog-batches', path: '/dev/changelog' },
    { name: '02-status-sources', path: '/dev/status', fullPage: true },
    { name: '03-workflows', path: '/dev/workflows', fullPage: true },
  ],
  'shell-phone-0090': [
    {
      name: '01-phone-menu',
      path: '/today',
      width: 390,
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Open the menu' }).click();
        await page.waitForTimeout(250);
      },
    },
    { name: '02-tablet-pane', path: '/neurotech/fit', width: 768, fullPage: true },
  ],
  'connectors-0103': [
    { name: '01-activity-charts', path: '/dev/connectors', fullPage: true },
  ],
  'selection-0104': [
    { name: '01-move-to-selected', path: '/neurotech/selection', fullPage: true },
  ],
  'person-dupes-0105': [
    { name: '01-org-grouping', path: '/neurotech/pipeline?status=discussing', fullPage: true },
  ],
  'selection-0109': [
    { name: '01-one-panel', path: '/neurotech/selection', fullPage: true },
  ],
  'connectors-0106-0108': [
    { name: '01-connectors-deduped', path: '/dev/connectors', fullPage: true },
  ],
  'responsive-server': [
    { name: '01-status-event-loop', path: '/dev/status', fullPage: true },
  ],
  'spv-stance': [
    { name: '01-selection-spv-column', path: '/spv-cortex/selection', fullPage: true },
  ],
  'lp-stats': [
    { name: '01-stats-panels', path: '/neurotech/stats', fullPage: true },
  ],
  'lp-stats-2': [
    { name: '01-stats-spv-coverage', path: '/neurotech/stats', fullPage: true },
  ],
  'linear-readonly': [
    { name: '01-dev-linear', path: '/dev/linear', fullPage: true },
  ],
  'linear-plc-only': [
    { name: '01-dev-linear-scoped', path: '/dev/linear', fullPage: true },
  ],
  'linear-views': [
    { name: '01-standup-my-linear', path: '/standup', fullPage: true },
    { name: '02-overview-workstreams', path: '/neurotech/overview', fullPage: true },
  ],
  'workflow-api': [
    { name: '01-enrich-workflow-buttons', path: '/dev/enrich', fullPage: true },
  ],
  'status-0114': [
    { name: '01-status-mark', path: '/today' },
    {
      name: '02-status-panel-open',
      path: '/today',
      prepare: async (page) => {
        await page.getByRole('button', { name: /^Status:/ }).click();
        await page.waitForTimeout(250);
      },
    },
  ],
  // Issue 0120: the Strategic column and filter, at the issue's viewport. A user is selected first, so
  // the detail beside the list can read the LP's reasons.
  'strategic-0120': [
    { name: '01-selection-strategic-column', path: '/spv-cortex/selection?status=all&sort=strategic&dir=desc', width: 1587, fullPage: true,
      prepare: async (page) => { await asUser(page); await page.locator('tr[data-lp]', { hasText: 'Iwasaki Family Office' }).click(); await page.getByText('derived, not part of the score').waitFor(); } },
    { name: '02-fund-high-or-some', path: '/neurotech/selection?status=all&strategic=useful&sort=strategic&dir=desc', width: 1587, fullPage: true,
      prepare: async (page) => { await asUser(page); await page.getByText('assessed, not part of the score').waitFor(); } },
  ],
  'selection-0113': [
    { name: '01-type-icons-toggles', path: '/selection', fullPage: true },
  ],
  'interactions-0045': [
    { name: '01-interaction-history', path: '/dev/affinity/meetings', fullPage: true },
  ],
  'import-dupes': [
    { name: '01-enrich-merge-duplicates', path: '/dev/enrich', fullPage: true },
  ],
  'identity-review': [
    { name: '01-enrich-identity-review', path: '/dev/enrich', fullPage: true },
  ],
  // Routes through X (2 Oct 2026). The seed mints ids, so each shot picks its node in the picker.
  'routes-through': [
    { name: '01-through-a-connector', path: '/routes?mode=through&q=Umeadi', fullPage: true, prepare: throughPick('Orla Umeadi') },
    { name: '02-restriction-holds-a-tie-back', path: '/routes?mode=through&q=Rautio', fullPage: true, prepare: throughPick('Anselm Rautio') },
    { name: '03-through-a-team-member', path: '/routes?mode=through&q=Lior', fullPage: true, prepare: throughPick('Lior') },
  ],
  // MCP access (docs/26): Preferences → MCP access, after making one token and revoking an older one.
  // The token shown is minted by this demo server, on invented data.
  // Settings, /setup and Google sign-in (docs/deploy/railway.md §3), against a demo started with
  // PLCOS_DEPLOYED=1 PORT=3113 and an invented PLCOS_SECRET, with SHOT_SETUP_CODE from its log. 08 finishes
  // setup; 09–10 are signed in as the admin it named (signedInAt).
  'railway-setup': [
    { name: '01-setup-code', path: '/setup', prepare: (page) => setupTo(page, 0) },
    { name: '02-setup-address', path: '/setup', prepare: (page) => setupTo(page, 1) },
    { name: '03-setup-google', path: '/setup', fullPage: true, prepare: (page) => setupTo(page, 2) },
    { name: '04-setup-admin', path: '/setup', prepare: (page) => setupTo(page, 3) },
    { name: '05-setup-connectors', path: '/setup', fullPage: true, prepare: (page) => setupTo(page, 4) },
    { name: '06-setup-review', path: '/setup', prepare: (page) => setupTo(page, 5) },
    { name: '07-setup-mobile', path: '/setup', width: 390, height: 1900, prepare: (page) => setupTo(page, 2) },
    { name: '08-setup-done', path: '/setup', prepare: (page) => setupTo(page, 6) },
    { name: '09-settings-connections', path: '/setup', fullPage: true, prepare: (page) => signedInAt(page, '/settings/connections') },
    { name: '10-settings-people', path: '/setup', fullPage: true, prepare: (page) => signedInAt(page, '/settings/people') },
  ],
  mcp: [
    {
      name: '01-preferences-mcp-tokens',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        const card = page.locator('#mcp');
        const make = async (label: string, draft: boolean) => {
          await card.getByPlaceholder('Claude Code on the Mac').fill(label);
          if (draft) await card.locator('input[name=tools][value=draft]').check();
          await card.getByRole('button', { name: 'Make token' }).click();
          await card.locator('code').first().waitFor();
        };
        await make('Claude Desktop (old laptop)', false);
        await page.reload({ waitUntil: 'networkidle' });
        await card.locator('tr', { hasText: 'Claude Desktop (old laptop)' }).getByRole('button', { name: 'Revoke' }).first().click();
        await card.locator('tr', { hasText: 'Claude Desktop (old laptop)' }).getByText(/^revoked/).first().waitFor();
        await make('Claude Code on the Mac', true);
        await card.locator('tr', { hasText: 'Claude Code on the Mac' }).first().waitFor();
        await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
  ],
  // The mail desk's asks (docs/27): an indicated amount from the LP page's update box, shown beside soft and hard
  // on the LP page and the vehicle's status; Preferences makes a desk token with the outreach scope.
  outreach: [
    {
      name: '01-update-box-indicated',
      path: '/neurotech/pipeline?status=discussing',
      prepare: async (page) => {
        await asUser(page);
        const href = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
          .find((h) => /\/pipeline\/[0-9a-f-]{36}$/.test(h)) ?? null);
        if (!href) throw new Error('No LP at Discussing on the Neurotech pipeline');
        await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'networkidle' });
        const box = page.getByPlaceholder("Add an update: what happened, what changed, what's next");
        await box.fill('Call today with their CIO: they are thinking $3M-4M for the first close. Next: send the deck by Friday.');
        await page.locator('input[name=indicated]').check();
        await box.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -90));
      },
    },
    {
      name: '02-lp-page-indicated',
      path: '/neurotech/pipeline?status=discussing',
      prepare: async (page) => {
        await asUser(page);
        const href = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
          .find((h) => /\/pipeline\/[0-9a-f-]{36}$/.test(h)) ?? null);
        await page.goto(new URL(href!, page.url()).toString(), { waitUntil: 'networkidle' });
        const box = page.getByPlaceholder("Add an update: what happened, what changed, what's next");
        await box.fill('Call today with their CIO: they are thinking $3M-4M for the first close. Next: send the deck by Friday.');
        await page.locator('input[name=indicated]').check();
        await page.getByRole('button', { name: 'Save update' }).click();
        await page.waitForFunction((b) => (b as HTMLTextAreaElement).value === '', await box.elementHandle());
        await page.reload({ waitUntil: 'networkidle' });
        const line = page.locator('[data-indicated]').first();
        await line.waitFor();
        await line.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      },
    },
    { name: '03-vehicle-status-indicated', path: '/neurotech/status', prepare: asUser },
    {
      name: '04-preferences-desk-token',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        const card = page.locator('#mcp');
        await card.getByPlaceholder('Claude Code on the Mac').fill("Juan's iPad mail desk");
        await card.locator('input[name=tools][value=outreach-write]').check();
        await card.locator('select[name=days]').selectOption('30');
        await card.getByRole('button', { name: 'Make token' }).click();
        await card.locator('code').first().waitFor();
        await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
    {
      // Developer → Agent activity after a few juanmail calls over the REST wrapper (the same record as MCP).
      name: '05-agent-activity',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        const card = page.locator('#mcp');
        await card.getByPlaceholder('Claude Code on the Mac').fill('juanmail');
        await card.locator('input[name=tools][value=outreach-write]').check();
        await card.getByRole('button', { name: 'Make token' }).click();
        const secret = (await card.locator('code').first().innerText()).trim();
        const headers = { Authorization: `Bearer ${secret}`, 'X-Correlation-Id': 'wave-2026-10-04', 'User-Agent': 'juanmail-server/0.1' };
        const base = new URL(page.url()).origin;
        await page.request.get(`${base}/api/outreach/vehicles`, { headers });
        const q = await (await page.request.get(`${base}/api/outreach/queue?vehicle=all&bucket=invite&limit=3`, { headers })).json() as { data: { rows: Array<{ pursuitId: string }> } };
        const first = q.data.rows[0]?.pursuitId;
        if (first) {
          await page.request.post(`${base}/api/outreach/tickets`, { headers, data: { kind: 'SEND', pursuitId: first, scope: { recipients: ['partner@invented.example'] }, coordination: { choice: 'send_separately' } } });
          await page.request.post(`${base}/api/outreach/sent`, { headers, data: { ticketId: '00000000-0000-4000-8000-000000000000', pursuitId: first, recipients: ['partner@invented.example'], gmailMessageId: 'invented-1', sentAt: new Date().toISOString() } });
        }
        await page.goto(`${base}/developer/agent-activity`, { waitUntil: 'networkidle' });
      },
    },
  ],
  // Mailguard (docs/25 §12), on the demo's fake mailguard: Preferences → Email refuses a token that can send, then
  // connects a drafts-only one and tests it. Both tokens are invented by the fake.
  mailguard: [
    {
      name: '01-refused-can-send',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        const card = page.locator('#email');
        const forget = card.getByRole('button', { name: 'Forget this token' });
        if (await forget.count()) { await forget.click(); await card.getByLabel('Your mailguard token').waitFor(); }
        const { fakeDir } = await import('../lib/connectors/mailguard');
        const { fakeMintKey } = await import('../lib/connectors/mailguard/fake');
        const sender = await fakeMintKey(fakeDir(), { mailbox: 'someone@example.test', tool: 'Inbox helper', grant: ['draft', 'read.metadata', 'send'] });
        await card.getByLabel('Your mailguard token').fill(sender);
        await card.getByRole('button', { name: 'Connect', exact: true }).click();
        await card.locator('[role="status"]', { hasText: 'This token can send email.' }).waitFor();
        await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
    {
      name: '02-connected-drafts-only',
      path: '/settings',
      prepare: async (page) => {
        const card = page.locator('#email');
        await card.getByRole('button', { name: 'Use a demo token (drafts only)' }).click();
        await card.getByRole('button', { name: 'Test the connection' }).click();
        await card.locator('[role="status"]', { hasText: /drafts-only/ }).waitFor();
        await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
  ],
  // Email drafts (docs/25), on the demo's fake mailguard: connect, draft from the strategy, move, the intro ask.
  'email-drafts': [
    {
      name: '01-lp-first-message',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        const connect = page.getByRole('button', { name: 'Use a demo token (drafts only)' });
        if (await connect.count()) { await connect.click(); await page.getByRole('button', { name: 'Test the connection' }).waitFor(); }
        await openLp(page, 'Bram Kowalczyk');
        const box = page.locator('#email');
        const start = box.getByRole('button', { name: 'Draft the first message' });
        if (await start.count()) { await start.click(); await box.locator('.ProseMirror').waitFor(); }
        await box.getByLabel('To').fill('Bram Kowalczyk <bram@example.org>');
        if (!(await box.getByText('one-pager.pdf').count())) {
          await box.locator('input[type=file]').setInputFiles({ name: 'one-pager.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% invented demo file\n') });
          await box.getByText('one-pager.pdf').waitFor();
        }
        await box.getByText('Saved', { exact: true }).waitFor({ timeout: 15000 });
        await box.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
    {
      name: '02-moved-and-the-message',
      path: '/settings',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        const box = page.locator('#email');
        await box.getByRole('button', { name: /Move to Gmail drafts|Update the Gmail draft/ }).click();
        await box.locator('[role="status"]', { hasText: /draft in/ }).waitFor({ timeout: 20000 });
        await box.getByRole('button', { name: 'Preview the message' }).click();
        await box.getByText('The message as it goes to Gmail').waitFor();
        await box.getByRole('button', { name: /Update the Gmail draft/ }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -160));
      },
    },
    {
      name: '03-route-intro-ask',
      path: '/settings',
      prepare: async (page) => {
        await openLp(page, 'Bram Kowalczyk');
        await page.getByRole('link', { name: 'Find a Warm Intro' }).click();
        await page.waitForURL(/routes/);
        // The first route through a connector, opened: its intro ask box sits under its "Propose" button.
        const routes = page.url();
        const start = page.getByRole('button', { name: /^Draft the intro ask to / }).first();
        for (let r = 0; r < 8 && !(await start.count()); r++) await page.goto(`${routes}&r=${r}`, { waitUntil: 'networkidle' });
        await start.click();
        const box = page.locator('#email');
        await box.locator('.ProseMirror').waitFor();
        await box.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
  ],
  // Email guidelines (docs/email-guidelines.md), on invented demo data: your voice in Preferences; a first
  // message from the strategy's own field; the intro ask the route calls for, empty with the structure; and
  // the check when the strategy names another sender. The demo's fixture strategies carry `firstMessage`.
  'email-guidelines': [
    {
      name: '01-preferences-your-voice',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        const card = page.locator('#voice');
        await card.locator('textarea[name=style]').fill('Short and warm. First name, no “Dear”. One idea, then one question. I sign off “Best, Lior”. Never “circle back” or “excited to share”.');
        const samples = card.locator('textarea[name=sample]');
        await samples.nth(0).fill('Hi Ana,\n\nThanks for Tuesday. You asked how we choose between two teams on one problem: the one with its own data. Happy to show you two examples.\n\nWould Thursday at 4 work?\n\nBest,\nLior');
        await samples.nth(1).fill('Hi Bo,\n\nQuick one: is the board still meeting on the 14th? If so, I will send the note the week before.\n\nBest,\nLior');
        await card.getByRole('button', { name: 'Save my voice' }).click();
        await card.locator('[role="status"]', { hasText: /^Saved/ }).waitFor();
        await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
    {
      name: '02-first-message-from-the-strategy',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        const connect = page.getByRole('button', { name: 'Use a demo token (drafts only)' });
        if (await connect.count()) { await connect.click(); await page.getByRole('button', { name: 'Test the connection' }).waitFor(); }
        await openLp(page, 'Bram Kowalczyk');
        const box = page.locator('#email');
        const start = box.getByRole('button', { name: 'Draft the first message' });
        if (await start.count()) { await start.click(); await box.locator('.ProseMirror').waitFor(); }
        await box.getByText('Your voice', { exact: true }).click();
        await box.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
    {
      name: '03-intro-ask-the-route-calls-for',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        // An LP whose best route goes through a connector, on an SPV's list.
        await openLpAnyVehicle(page, 'Renata Corcoran');
        const box = page.locator('#email');
        const start = box.getByRole('button', { name: /^Draft the intro ask to / });
        if (await start.count()) { await start.click(); await box.locator('.ProseMirror').waitFor(); }
        await box.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -70));
      },
    },
    {
      name: '04-another-sender-holds-the-route',
      path: '/settings',
      prepare: async (page) => {
        await asUser(page);
        await openLpAnyVehicle(page, 'Paloma Jaramillo');
        const box = page.locator('#email');
        const start = box.getByRole('button', { name: 'Draft the first message' });
        if (await start.count()) { await start.click(); await box.locator('.ProseMirror').waitFor(); }
        await box.getByLabel('To').fill('Paloma Jaramillo <paloma@example.org>');
        await box.getByText('Saved', { exact: true }).waitFor({ timeout: 15000 });
        await box.locator('ul[aria-label="Checks on this draft"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      },
    },
  ],
};

/** Open one node in the "Routes through" view from the picker, by its name. */
function throughPick(name: string) {
  return async (page: Page) => {
    await asUser(page);
    await page.locator('.route-picker a.tix').filter({ has: page.locator('.tixline b', { hasText: name }) }).first().click();
    await page.locator('h1', { hasText: `Routes through ${name}` }).waitFor();
    await page.waitForLoadState('networkidle');
  };
}

/** The seed mints uuids, so a fixed link is resolved at shot time. */
async function resolveTokens(page: Page, base: string, path: string): Promise<string> {
  if (path.includes('__CEDAR_FIT__')) {
    await page.goto(`${base}/neurotech/fit`, { waitUntil: 'networkidle' });
    const href = await page.locator('a.xref[href^="/neurotech/fit/"]').first().getAttribute('href');
    if (!href) throw new Error('could not resolve a fit assessment link');
    return href;
  }
  if (!path.includes('__ROOS__')) return path;
  await page.goto(base + '/research', { waitUntil: 'networkidle' });
  const href = await page.getByRole('link', { name: 'Solveig Quaresma' }).first().getAttribute('href');
  if (!href) throw new Error('could not resolve the Solveig Quaresma dossier link');
  return path.replace('/research/__ROOS__', href);
}

/**
 * Screenshots are committed and published in the build log, so they are only ever of the
 * demo. Asking the server, rather than trusting the environment of this script, catches
 * BASE_URL pointed at the real server as well as DATA_PROFILE=real in this shell.
 */
async function refuseReal(base: string) {
  if (config.data.profile === 'real') {
    throw new Error('Refusing to take screenshots in the real profile. Screenshots are committed and published.');
  }
  const res = await fetch(`${base}/api/profile`, { redirect: 'manual', headers: { cookie: `${USER_COOKIE}=juan` } }).catch(() => null);
  // Behind Google sign-in (a demo started with PLCOS_DEPLOYED=1, railway-setup) every API asks to sign in
  // first; /setup and /signin say which data the server holds instead.
  if (res && res.status >= 300 && res.status < 400) {
    const page = await fetch(`${base}/setup`).then((r) => r.text()).catch(() => '');
    if (!page.includes('Demo data')) throw new Error(`${base} does not say it serves the demo. Screenshots only ever show the demo.`);
    return;
  }
  if (!res || !res.ok) throw new Error(`${base}/api/profile did not answer — is the demo server running?`);
  const { profile } = (await res.json()) as { profile?: string };
  if (profile !== 'demo') {
    throw new Error(`${base} is serving the ${profile ?? 'unknown'} profile. Screenshots only ever show the demo.`);
  }
}

async function main() {
  const version = process.argv[2] ?? 'L1';
  // This folder's demo server: its port from .ports.json, or PORT (config/ports.ts).
  const base = process.env.BASE_URL ?? `http://localhost:${portFor('demo', readLayout())}`;
  // `npm run shots -- N57 04` retakes only the shots whose names start with "04".
  const only = process.argv[3];
  const shots = SHOTS[version]?.filter((s) => !only || s.name.startsWith(only));
  if (!shots?.length) throw new Error(`No shots defined for ${version}${only ? ` starting ${only}` : ''}`);
  await refuseReal(base);

  const dir = join(process.cwd(), 'docs/changelog/shots', version.toLowerCase());
  await mkdir(dir, { recursive: true });

  /**
   * The feedback box asks for a real screen capture first. Headless Chromium will not grant
   * that without these flags, and without them the changelog would only ever show the
   * fallback renderer — which is the path we are trying to demonstrate away from.
   */
  const browser = await chromium.launch({
    args: [
      '--auto-accept-this-tab-capture',
      // Must match the page title, or the auto-select never finds the tab.
      `--auto-select-desktop-capture-source=${config.product.name}`,
      '--use-fake-ui-for-media-stream',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });

  for (const shot of shots) {
    await page.setViewportSize({ width: shot.width ?? 1440, height: shot.height ?? (shot.width && shot.width > 1500 ? 1150 : 940) });
    const path = await resolveTokens(page, base, shot.path);
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (shot.prepare) await shot.prepare(page);
    await page.waitForTimeout(150);
    const png = await page.screenshot({ fullPage: shot.fullPage ?? false });
    const image = await encodeShot(png);
    await writeFile(join(dir, `${shot.name}${SHOT.ext}`), image);
    // A capture from before issue 0021 would otherwise sit beside its replacement.
    await rm(join(dir, `${shot.name}.png`), { force: true });
    console.log(`shot · ${version.toLowerCase()}/${shot.name}${SHOT.ext} · ${Math.round(image.length / 1024)} KB`);
  }

  await browser.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
