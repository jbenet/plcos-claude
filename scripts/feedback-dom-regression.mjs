/**
 * Actual React/Tiptap DOM events without a browser process. Dependencies stay outside this repo:
 * npm install --prefix /tmp/0064-dom jsdom fake-indexeddb
 * JSDOM_MODULE=/tmp/0064-dom/node_modules/jsdom/lib/api.js \
 * INDEXEDDB_MODULE=/tmp/0064-dom/node_modules/fake-indexeddb/build/esm/index.js \
 * node --import tsx scripts/feedback-dom-regression.mjs
 * This checks behavior, not browser layout or pixels.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.JSDOM_MODULE, 'Set JSDOM_MODULE to an external jsdom installation');
const { JSDOM } = await import(pathToFileURL(process.env.JSDOM_MODULE).href);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3211', pretendToBeVisual: true,
});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node',
  'Text', 'DocumentFragment', 'MutationObserver', 'DOMParser', 'File', 'FileReader', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; these only prevent selection scrolling from asking for unavailable geometry.
const rect = () => ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0 });
dom.window.Range.prototype.getBoundingClientRect = rect;
dom.window.Range.prototype.getClientRects = () => [rect()];
dom.window.HTMLElement.prototype.getClientRects = () => [rect()];
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.scrollBy = () => {};
// jsdom omits this browser getter; mirror inherited contenteditable for typing guards.
Object.defineProperty(dom.window.HTMLElement.prototype, 'isContentEditable', {
  configurable: true, get() { return Boolean(this.closest('[contenteditable="true"]')); },
});
const React = await import('react');
globalThis.React = React;
const { createRoot } = await import('react-dom/client');
const { NodeSelection } = await import('@tiptap/pm/state');
const { MarkdownField, packAttachments } = await import('../components/ui/MarkdownField.tsx');
const { fileIssueSink } = await import('../lib/issues/file.ts');
const { fileFeedback } = await import('../modules/platform/service.ts');
const { config } = await import('../config/deployment.ts');
assert.equal(config.data.profile, 'demo', 'Refuse real profile');
const scratch = await mkdtemp(join(tmpdir(), 'plcos-feedback-dom-'));
const sink = fileIssueSink(relative(process.cwd(), scratch));
const bytes = [1, 2, 3].map(n => Buffer.from(`invented-image-${n}`));
const files = bytes.map((buffer, n) => new File([buffer], `invented-${n + 1}.png`, { type: 'image/png' }));
let model, updateImages, root, assertions = 0;
const check = text => { assertions++; console.log(`PASS ${text}`); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function settle(predicate = () => true) {
  for (let n = 0; n < 100; n++) {
    await React.act(async () => { await pause(); });
    if (predicate()) return;
  }
  throw new Error('DOM regression did not settle');
}
async function mount(initial = { body: '', images: [] }) {
  if (root) await React.act(async () => root.unmount());
  root = createRoot(document.getElementById('root'));
  function Harness() {
    const [body, setBody] = React.useState(initial.body);
    const [images, setImages] = React.useState(initial.images);
    const [pending, setPending] = React.useState(false);
    model = { body, images, pending }; updateImages = setImages;
    return React.createElement(MarkdownField, { value: body, onChange: setBody, images,
      onImages: setImages, onPendingChange: setPending });
  }
  await React.act(async () => root.render(React.createElement(Harness)));
  await settle(() => Boolean(document.querySelector('.mdrich')));
}
function trigger(method, selected) {
  const event = new Event(method === 'picker' ? 'change' : method, { bubbles: true, cancelable: true });
  if (method === 'picker') {
    const input = document.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { configurable: true, value: selected });
    input.dispatchEvent(event);
  } else {
    const transfer = { files: selected, types: ['Files', 'text/html'], getData: type => type === 'text/html' ? '<p>Companion clipboard HTML</p>' : '' };
    Object.defineProperty(event, method === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer });
    (document.querySelector('.mdrich') ?? document.querySelector('textarea')).dispatchEvent(event);
    assert.ok(event.defaultPrevented, 'File events intercepted before native editor handling');
  }
}
async function add(method, selected, count) {
  await React.act(async () => trigger(method, selected));
  await settle(() => model.images.length === count && !model.pending);
  assert.equal(document.querySelectorAll('.mdembed img').length, count);
  assert.ok(!model.body.includes('Companion clipboard HTML'));
}
async function toggle(text) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === text);
  assert.ok(button, text);
  await React.act(async () => button.click());
  await settle();
}
async function roundtrip(count) {
  await toggle('Markdown');
  assert.equal((document.querySelector('textarea').value.match(/attachment:\d+/g) ?? []).length, count);
  await toggle('Rich');
  assert.equal(document.querySelectorAll('.mdembed img').length, count);
}
async function persist(count) {
  const packed = packAttachments(model.body, model.images);
  assert.equal(packed.images.length, count, 'All DOM-inserted images reach filing');
  const issue = await fileFeedback({ handle: 'fixture', resolveUser: async () => { throw new Error('Invented DB failure'); } }, {
    title: 'Invented DOM image regression', body: packed.body, kind: 'bug', priority: 'P2', page: '/fixture', context: {},
    attachments: packed.images.map(img => ({ kind: 'image', contentType: 'image/png', name: img.name, base64: img.dataUrl.split(',')[1] })),
  }, { sink });
  assert.equal(issue.attachments.length, count);
  for (const [index, path] of issue.attachments.entries()) {
    assert.ok(issue.body.includes(`(${path})`));
    assert.deepEqual(await readFile(join(scratch, path)), Buffer.from(packed.images[index].dataUrl.split(',')[1], 'base64'));
  }
}

try {
  for (const method of ['paste', 'drop', 'picker']) for (const count of [2, 3]) {
    await mount(); await add(method, files.slice(0, count), count); await roundtrip(count); await persist(count);
    check(`${method}: ${count} actual FileReader→React→Tiptap images survive roundtrip and exact-byte filing`);
  }
  await mount(); await add('picker', files.slice(0, 1), 1);
  for (let n = 1; n < 3; n++) {
    const editor = document.querySelector('.mdrich').editor;
    let at;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image' && at === undefined) at = pos; });
    await React.act(async () => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at))));
    await add(n === 1 ? 'paste' : 'drop', files.slice(n, n + 1), n + 1);
  }
  await roundtrip(3); await persist(3);
  check('Adding after a selected image keeps all prior attachments');
  await mount();
  await React.act(async () => { trigger('paste', files.slice(0, 1)); trigger('drop', files.slice(1, 2)); trigger('picker', files.slice(2)); });
  await settle(() => model.images.length === 3 && !model.pending);
  assert.deepEqual(model.images.map(img => img.name), files.map(file => file.name));
  await roundtrip(3); await persist(3);
  check('Overlapping paste/drop/picker batches preserve order and every image');
  const kept = structuredClone(model);
  await mount({ body: kept.body, images: [] });
  await React.act(async () => updateImages(kept.images));
  await settle(() => [...document.querySelectorAll('.mdembed img')].every(img => img.src.startsWith('data:')));
  assert.equal(document.querySelectorAll('.mdembed img').length, 3);
  await roundtrip(3); await persist(3);
  check('Delayed restored pictures resolve existing markdown tokens without losing images');
  await mount({ body: kept.body, images: [] });
  await toggle('Markdown');
  await React.act(async () => updateImages(kept.images));
  await toggle('Rich');
  assert.equal(document.querySelectorAll('.mdembed img').length, 3);
  assert.ok([...document.querySelectorAll('.mdembed img')].every(img => img.src.startsWith('data:')));
  await persist(3);
  check('Pictures restored while source is open survive return to rich text');
  await mount(); await toggle('Markdown');
  await React.act(async () => { trigger('paste', files.slice(0, 1)); trigger('drop', files.slice(1)); });
  await settle(() => model.images.length === 3 && !model.pending);
  assert.equal((document.querySelector('textarea').value.match(/attachment:\d+/g) ?? []).length, 3);
  await toggle('Rich'); await persist(3);
  check('Overlapping source-mode image ingestion keeps every token and file');
  if (process.env.INDEXEDDB_MODULE) {
    const { indexedDB } = await import(pathToFileURL(process.env.INDEXEDDB_MODULE).href);
    Object.defineProperty(window, 'indexedDB', { value: indexedDB });
    const drafts = await import('../lib/feedback-drafts.ts');
    const path = '/invented-draft';
    drafts.writeDraft(path, { title: 'Invented', body: kept.body, pictures: 3 });
    // Do not await between saves: restoration must observe the newer queued write.
    const first = drafts.writePictures(path, { shots: [], images: kept.images.slice(0, 1) });
    const second = drafts.writePictures(path, { shots: [], images: kept.images });
    const restored = await drafts.readPictures(path);
    assert.ok(await first && await second);
    assert.equal(restored.images.length, 3);
    await mount({ body: drafts.readDraft(path).body, images: [] });
    await React.act(async () => updateImages(restored.images));
    await settle(() => document.querySelectorAll('.mdembed img').length === 3);
    await persist(3);
    await drafts.discardDraft(path);
    assert.equal(await drafts.readPictures(path), null);
    check('Queued IndexedDB saves restore newest complete attachment set and discard in order');
  }
  {
    const { isFeedbackKey } = await import('../lib/keyboard-shortcuts.ts');
    const key = (options = {}, target = document.body) => {
      const event = new KeyboardEvent('keydown', { code: 'KeyF', key: 'ƒ', altKey: true, bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event);
      return isFeedbackKey(event);
    };
    assert.ok(key()); assert.ok(key({ key: 'f' }));
    for (const options of [{ code: 'KeyG' }, { altKey: false }, { shiftKey: true }, { ctrlKey: true },
      { metaKey: true }, { repeat: true }, { isComposing: true }]) assert.equal(key(options), false);
    for (const tag of ['input', 'textarea', 'select', 'div']) {
      const field = document.createElement(tag);
      if (tag === 'div') field.setAttribute('contenteditable', 'true');
      document.body.append(field);
      assert.equal(key({}, field), false);
      if (tag === 'div') { const child = document.createElement('span'); field.append(child); assert.equal(key({}, child), false); }
      field.remove();
    }
    const handled = new KeyboardEvent('keydown', { code: 'KeyF', key: 'ƒ', altKey: true, cancelable: true });
    handled.preventDefault(); assert.equal(isFeedbackKey(handled), false);
    check('Option-generated ƒ and Alt+F match; typing, modifiers, composition, repeats and handled keys are ignored');
  }
  console.log(`DOM feedback regression: ${assertions} checks passed; browser visual/layout checks not covered.`);
} finally {
  if (root) await React.act(async () => root.unmount());
  await rm(scratch, { recursive: true, force: true });
  dom.window.close();
}
