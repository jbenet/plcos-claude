import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { config } from '../config/deployment';

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
  /** Narrower than the design boards, for the layouts that have to survive a small window. */
  width?: number;
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
          ['Delia Roos · Mara Vance', 'Northwood · Juan', 'Cedar Trust · Juan', 'Okonjo · Sam'].forEach((t, i) => g.fillText(t, 24, 108 + i * 40));
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
        await page.getByRole('link', { name: /Route to Delia Roos/ }).click();
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
        await page.getByLabel('Search targets').fill('Kaplan');
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
    { name: '04-tessaro', path: '/neurotech/fit', prepare: async (page) => {
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
          + '- @juan asks Vantage for a reference call and a note to Raman\n'
          + '- @ines writes the CPA-letter note for Whitcomb by 2026-09-24\n',
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
          'Northwood went from 0.62 to 0.60 and nothing on the page says which reading changed. A one-line diff against the last assessment would answer it.',
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
        await page.getByRole('link', { name: /Open the page for Northwood Capital/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '03-person-two-firms',
      path: '/orgs/g/people',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Open the page for Priya Raman/ }).click();
        await page.waitForLoadState('networkidle');
        await page.getByRole('heading', { name: 'Where they sit' }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      },
    },
    {
      name: '04-summary-acts-for',
      path: '/orgs/g/people',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Summarise Jonah Hale/ }).click();
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
        await page.getByRole('link', { name: /Summarise Whitcomb Capital/ }).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
      },
    },
    {
      name: '03-org-page',
      path: '/orgs/g/all',
      fullPage: true,
      prepare: async (page) => {
        await page.getByRole('link', { name: /Open the page for Delia Roos/ }).click();
        await page.waitForLoadState('networkidle');
      },
    },
    {
      name: '04-summary-from-fit',
      path: '/fit',
      prepare: async (page) => {
        await page.getByRole('link', { name: /Summarise Okonjo Family Office/ }).click();
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
};

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
    await page.setViewportSize({ width: shot.width ?? 1440, height: shot.width && shot.width > 1500 ? 1150 : 940 });
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
