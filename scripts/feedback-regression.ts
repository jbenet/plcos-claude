/** Fictional browser regressions. Run against PORT=3211 demo with node --import tsx. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { config } from '../config/deployment';
import { fileIssueSink } from '../lib/issues/file';
import { fileFeedback } from '../modules/platform/service';
import { withDb, type Db } from '../lib/db';
import type { IssueAttachment } from '../lib/issues';
import { packAttachments } from '../components/ui/MarkdownField';

assert.equal(config.data.profile, 'demo', 'Browser regression refuses real data');
const origin = 'http://localhost:3211';
const fixtureDir = join(process.cwd(), 'app/dev/feedback-regression');
const scratch = await mkdtemp(join(tmpdir(), 'plcos-feedback-regression-'));
const fixture = `import { FeedbackButton } from '@/components/shell/FeedbackBox';
export default function Page() { return <section aria-label="Feedback regression fixture"><h1>Invented feedback fixture</h1><FeedbackButton /></section>; }
`;
const images = await Promise.all(['#e43636', '#38a254', '#3262d4'].map(async (color, i) => ({
  name: `invented-image-${i + 1}.png`, mimeType: 'image/png',
  buffer: await sharp({ create: { width: 120, height: 80, channels: 4, background: color } }).png().toBuffer(),
})));
type Payload = { title: string; body: string; kind: 'bug'; priority: 'P2'; page: string;
  context: Record<string, unknown>; screenshots: string[]; images: { name: string; dataUrl: string }[]; imageOffset: number };
let passed = 0;
const ok = (name: string) => { passed++; console.log(`PASS ${name}`); };
if (process.argv.includes('--server-only')) {
  try {
    for (const path of ['/today', '/settings', '/developer/issues']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200, `${path} responds`);
      const html = await response.text();
      assert.match(html, /aria-keyshortcuts="Alt\+f"/i, `${path} renders feedback shortcut`);
      assert.match(html, /shortcuts-dialog/);
      ok(`SSR ${path}: feedback launcher and shortcut help present`);
    }
    for (const count of [2, 3]) {
      const input = images.slice(0, count).map((f, i) => ({ index: i + 1, name: f.name,
        contentType: 'image/png', dataUrl: `data:image/png;base64,${f.buffer.toString('base64')}` }));
      const packed = packAttachments(input.map(i => `![${i.name}](attachment:${i.index})`).join('\n\n'), input);
      await persist({ title: 'Invented filing regression', body: packed.body, kind: 'bug', priority: 'P2',
        page: '/today', context: {}, screenshots: [input[0]!.dataUrl], images: packed.images, imageOffset: 1 }, count, count === 3);
      ok(`${count} embedded images plus screenshot persist with exact bytes and correct body references, metadata ${count === 3 ? 'stalled' : 'failed'}`);
    }
    console.log(`Server-only feedback regression: ${passed} checks passed; browser transport, visual and draft interaction checks NOT RUN.`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
  process.exit(0);
}
const browser = await chromium.launch({ headless: true });
let fixtureCreated = false;

async function open(page: Page) {
  await page.goto(`${origin}/dev/feedback-regression`, { waitUntil: 'networkidle' });
  await page.getByRole('region', { name: 'Feedback regression fixture' }).getByRole('button').click();
  await page.locator('.mdrich').waitFor();
  await page.locator('.shotthumb img').first().waitFor();
  await page.getByPlaceholder('Left blank, intake names it from your first line').fill('Invented attachment regression');
}

async function add(page: Page, method: 'paste' | 'drop' | 'picker', count: number, offset = 0) {
  const files = images.slice(offset, offset + count);
  if (method === 'picker') {
    await page.locator('.mdfield input[type=file]').setInputFiles(files);
  } else {
    await page.locator('.mdrich').evaluate((element, input) => {
      const transfer = new DataTransfer();
      for (const file of input.files) {
        const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: 'image/png' }));
      }
      // Real clipboard/drop payloads can carry HTML alongside files. Native editor handling
      // must not run first and insert a second, untracked copy or alter the selection.
      transfer.setData('text/html', '<p>Clipboard companion HTML</p>');
      const event = input.method === 'paste'
        ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
        : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      element.dispatchEvent(event);
    }, { method, files: files.map(f => ({ name: f.name, base64: f.buffer.toString('base64') })) });
  }
  await page.waitForFunction((minimum) => document.querySelectorAll('.mdembed img').length >= minimum, offset + count);
}

async function roundTrip(page: Page, count: number) {
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const source = await page.locator('.mdfield textarea').inputValue();
  assert.equal((source.match(/attachment:\d+/g) ?? []).length, count);
  assert.ok(!source.includes('data:image'), 'Stored markdown contains attachment tokens only');
  await page.getByRole('button', { name: 'Rich', exact: true }).click();
  assert.equal(await page.locator('.mdembed img').count(), count);
}

async function persist(payload: Payload, expected: number, stalledMetadata = false) {
  assert.equal(payload.images.length, expected, 'POST contains every embedded image');
  const attachments: IssueAttachment[] = [
    ...payload.screenshots.map(dataUrl => ({ kind: 'screenshot' as const, contentType: 'image/png' as const, base64: dataUrl.split(',')[1]! })),
    ...payload.images.map(image => ({ kind: 'image' as const, contentType: 'image/png' as const, name: image.name, base64: image.dataUrl.split(',')[1]! })),
  ];
  const sink = fileIssueSink(relative(process.cwd(), scratch));
  const metadataDb: Db = {
    kind: 'pglite',
    query: async () => { if (stalledMetadata) return new Promise<never>(() => {}); throw new Error('Invented metadata failure'); },
    one: async () => { if (stalledMetadata) return new Promise<never>(() => {}); throw new Error('Invented metadata failure'); },
    exec: async () => {}, transaction: async fn => fn(metadataDb), close: async () => {},
  };
  const issue = await withDb(metadataDb, () => fileFeedback({
    id: '70000000-0000-4000-8000-000000000001', handle: 'fictional-tester',
    name: 'Fictional Tester', initials: 'FT', role: 'team', email: 'tester@example.invalid',
      access: 'viewer', vehicles: [], approves: [],
  }, { ...payload, attachments }, { sink }));
  assert.equal(issue.attachments.length, attachments.length);
  const markdown = await readFile(issue.location, 'utf8');
  for (const [index, attachment] of attachments.entries()) {
    const path = issue.attachments[index]!;
    assert.deepEqual(await readFile(join(scratch, path)), Buffer.from(attachment.base64, 'base64'));
    assert.ok(markdown.includes(path));
    if (attachment.kind === 'image') assert.ok(issue.body.includes(`(${path})`), 'Body resolves every image');
  }
  assert.ok(!issue.body.includes('(attachment:'));
  return issue;
}

try {
  await mkdir(join(process.cwd(), 'app/dev'), { recursive: true });
  await mkdir(fixtureDir, { recursive: false });
  fixtureCreated = true;
  await writeFile(join(fixtureDir, 'page.tsx'), fixture);
  for (const method of ['paste', 'drop', 'picker'] as const) {
    for (const count of [2, 3]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      let saved = false;
      await page.route('**/api/feedback', async route => {
        const sent = route.request().postDataJSON() as Payload & { clientId: string };
        const issue = await persist(sent, count, count === 3);
        saved = true;
        // The server's reply since the journal (ac26ce7): journaled, the client id echoed, the number if filed.
        await route.fulfill({ status: 202, json: { journaled: true, clientId: sent.clientId, repeat: false, id: issue.id } });
      });
      await open(page);
      await add(page, method, count);
      await roundTrip(page, count);
      await page.getByRole('button', { name: 'File it', exact: true }).click();
      await page.getByRole('heading', { name: /Filed as issue/ }).waitFor();
      assert.ok(saved);
      ok(`${method}: ${count} images survive rich/source and file with exact bytes, despite unavailable metadata`);
      await context.close();
    }
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await open(page);
    await add(page, 'picker', 1);
    await page.locator('.mdembed img').first().click();
    await add(page, 'paste', 1, 1);
    await page.locator('.mdembed img').first().click();
    await add(page, 'drop', 1, 2);
    await roundTrip(page, 3);
    const bars = await page.evaluate(() => {
      const shot = document.querySelector('.shotthumb')!;
      const embed = document.querySelector('.mdembed')!;
      return [shot, embed].map(parent => {
        const bar = parent.querySelector('.mdembedbar')!;
        const p = parent.getBoundingClientRect(), b = bar.getBoundingClientRect();
        const button = bar.querySelector('button')!;
        return { top: b.top - p.top, right: p.right - b.right, background: getComputedStyle(button).backgroundColor,
          font: getComputedStyle(button).fontSize, radius: getComputedStyle(button).borderRadius };
      });
    });
    assert.ok(Math.abs(bars[0]!.top - bars[1]!.top) <= 2 && Math.abs(bars[0]!.right - bars[1]!.right) <= 2);
    assert.equal(bars[0]!.background, bars[1]!.background);
    assert.equal(bars[0]!.font, bars[1]!.font);
    assert.equal(bars[0]!.radius, bars[1]!.radius);
    // Screenshot is local temporary demo evidence, never a changelog artifact.
    await page.screenshot({ path: join(scratch, 'feedback-demo.png') });
    ok('Sequential selected-image additions preserve all three; screenshot and embed controls match top-right');
    for (const response of ['failure', 'stall'] as const) {
      let captured: Payload | null = null;
      await page.route('**/api/feedback', async route => {
        captured = route.request().postDataJSON() as Payload;
        await persist(captured, 3, true);
        if (response === 'failure') await route.fulfill({ status: 500, json: { error: 'Invented response failure' } });
        else await new Promise<void>(resolve => page.once('close', () => resolve()));
      });
      await page.getByRole('button', { name: 'File it', exact: true }).click();
      await page.waitForTimeout(500);
      assert.ok(captured);
      if (response === 'failure') await page.getByText('Invented response failure', { exact: false }).waitFor();
      // Since the journal (ac26ce7) an unanswered report waits in this browser's outbox, not in the
      // draft, and is sent again; the filed screen says where it is.
      await page.getByRole('heading', { name: /^Kept in this browser/ }).waitFor();
      await page.reload({ waitUntil: 'load' });
      const kept = await page.evaluate(() => new Promise<number>((resolve) => {
        const open = indexedDB.open('capitalos-outbox');
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const count = open.result.transaction('entries', 'readonly').objectStore('entries').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => resolve(-1);
        };
      }));
      assert.ok(kept >= 1, `the outbox keeps the report through a reload (${kept})`);
      ok(`${response}: the report stays in this browser's outbox through response loss plus reload, and the box says so`);
      await page.getByRole('region', { name: 'Feedback regression fixture' }).getByRole('button').click();
      await page.locator('.mdrich').waitFor();
      await add(page, 'picker', 3);
      await page.unroute('**/api/feedback');
    }
    await context.close();
  }

  {
    // Reports come in batches (issue 0017): File keeps the box open on a filed screen, and
    // "Give more feedback" or ⌘/Ctrl+Enter starts the next one (lost in ac26ce7, restored 29 Sep).
    const context = await browser.newContext();
    const page = await context.newPage();
    // A dev server refuses feedback (only live files it), so the live server's reply is played here.
    let next = 9001;
    await page.route('**/api/feedback', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const sent = route.request().postDataJSON() as { clientId: string };
      await route.fulfill({ status: 202, json: { journaled: true, clientId: sent.clientId, repeat: false, id: String(next++) } });
    });
    await page.goto(`${origin}/dev/feedback-regression`, { waitUntil: 'networkidle' });
    for (const [n, words] of [[1, 'Invented first report in a batch'], [2, 'Invented second report in a batch']] as const) {
      if (n === 1) await page.getByRole('region', { name: 'Feedback regression fixture' }).getByRole('button').click();
      await page.locator('.mdrich').waitFor();
      await page.locator('.shotthumb img').first().waitFor();
      assert.equal((await page.locator('.mdrich').innerText()).trim(), '', `report ${n} starts empty`);
      await page.locator('.mdrich').click();
      await page.keyboard.type(words);
      await page.getByRole('button', { name: 'File it', exact: true }).click();
      await page.getByRole('button', { name: 'Give more feedback' }).waitFor();
      await page.getByRole('heading', { name: /^Filed as issue \d+$/ }).waitFor({ timeout: 30_000 })
        .catch(async (err) => { throw new Error(`report ${n}: the filed screen says "${await page.locator('.drawer h2:not(.fbhead)').innerText()}"`, { cause: err }); });
      if (n === 1) await page.keyboard.press('Control+Enter');
    }
    await page.getByText('Filed while this was open · 2').waitFor();
    assert.equal(await page.locator('.filedlist a.filedrow').count(), 2);
    // FEEDBACK_SHOT=<path.png>: keep the filed screen for a changelog entry (invented reports only).
    if (process.env.FEEDBACK_SHOT) await page.screenshot({ path: process.env.FEEDBACK_SHOT });
    await page.getByRole('button', { name: 'Give more feedback' }).click();
    await page.locator('.mdrich').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.drawer').count(), 0);
    ok('Filing keeps the box open on a filed screen; ⌘↵ and Give more feedback start the next; the batch is listed with numbers');
    await context.close();
  }

  {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const path of ['/today', '/settings', '/developer/issues']) {
      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
      await page.keyboard.press('Alt+f');
      await page.getByRole('heading', { name: 'Feedback is filed from the live app' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.drawer').count(), 0);
      ok(`Alt+F opens feedback on ${path} with closed keyboard-help dialog mounted`);
    }
    await page.keyboard.press('?');
    await page.locator('dialog[open]').waitFor();
    await page.keyboard.press('Alt+f');
    assert.equal(await page.locator('.drawer').count(), 0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      for (const tag of ['input', 'textarea', 'div']) {
        const element = document.createElement(tag);
        if (tag === 'div') element.contentEditable = 'true';
        document.body.append(element); element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'ƒ', altKey: true, bubbles: true }));
        element.remove();
      }
    });
    assert.equal(await page.locator('.drawer').count(), 0);
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'ƒ', altKey: true, bubbles: true })));
    await page.getByRole('heading', { name: 'Feedback is filed from the live app' }).waitFor();
    ok('Shortcut ignores typing and open help; Option-produced ƒ opens feedback outside fields');
    await context.close();
  }
  console.log(`Feedback regression: ${passed} checks passed. Demo visual evidence: ${join(scratch, 'feedback-demo.png')}`);
} finally {
  await browser.close();
  if (fixtureCreated) await rm(fixtureDir, { recursive: true, force: true });
  // Preserve the single demo screenshot for local visual review; remove filed scratch records.
  for (const name of await readdir(scratch)) {
    if (name !== 'feedback-demo.png') await rm(join(scratch, name), { recursive: true, force: true });
  }
}
