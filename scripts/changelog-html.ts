import { config } from '../config/deployment';
/**
 * Render CHANGELOG.md to a standalone HTML page for reading away from the repo.
 *
 * Repeatable on purpose: every future version regenerates the same page rather than
 * anyone hand-transcribing a build log. Screenshots are referenced at shots/<stage>/…,
 * which is where the publish step puts the resized copies.
 *
 *   npx tsx scripts/changelog-html.ts <out.html>
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { groupChangelog, parseInline, parseMarkdown, type Block } from '../lib/markdown';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Byte-identical screenshots are published once: a duplicate points at its twin (the first in
 * path order). The published page has a file limit, and two shots saying the same thing twice
 * spent it for nothing.
 */
const twins = new Map<string, string>();
function findTwins(dir: string) {
  const byHash = new Map<string, string>();
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.webp') ? [join(d, e.name)] : []));
  for (const f of walk(dir).sort()) {
    const h = createHash('sha1').update(readFileSync(f)).digest('hex');
    const rel = relative(dir, f);
    const first = byHash.get(h);
    if (first) twins.set(rel, first); else byHash.set(h, rel);
  }
}

/**
 * Shots published to the build log's asset store rather than as its files (N65): the page may
 * carry at most 255 files and had used them. docs/changelog/published-assets.json maps a shot's
 * path to its asset URL; a shot with no entry is still referenced as a file.
 */
let assets: Record<string, string> = {};
try { assets = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'changelog', 'published-assets.json'), 'utf8')) as Record<string, string>; } catch { assets = {}; }

const imageSrc = (href: string): string => {
  const marker = 'docs/changelog/shots/';
  const at = href.indexOf(marker);
  if (at === -1) return href;
  const rel = href.slice(at + marker.length);
  const path = twins.get(rel) ?? rel;
  return assets[path] ?? `shots/${path}`;
};

function inline(src: string): string {
  return parseInline(src)
    .map((s) => {
      switch (s.kind) {
        case 'code': return `<code>${esc(s.text)}</code>`;
        case 'strong': return `<strong>${esc(s.text)}</strong>`;
        case 'em': return `<em>${esc(s.text)}</em>`;
        case 'image':
          // A standalone image gets the wide wrapper too — several entries carry one
          // outside a figure table, and those are the ones worth widening the window for.
          return `<span class="shotwide"><img src="${esc(imageSrc(s.href ?? ''))}" alt="${esc(s.text)}" loading="lazy" decoding="async"></span>`;
        case 'link': {
          const href = s.href ?? '';
          return href.startsWith('http')
            ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(s.text)}</a>`
            : `<span class="path">${esc(s.text)}</span>`;
        }
        default: return esc(s.text);
      }
    })
    .join('');
}

function render(block: Block): string {
  switch (block.kind) {
    case 'heading': {
      if (block.level <= 2) return ''; // entry headings are rendered by the grouper
      return `<h${block.level} id="${block.id}">${inline(block.text)}</h${block.level}>`;
    }
    case 'paragraph': return `<p>${inline(block.text)}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${tag}>`;
    }
    case 'code': return `<pre><code>${esc(block.text)}</code></pre>`;
    case 'quote': return `<blockquote><p>${inline(block.text)}</p></blockquote>`;
    case 'table': {
      // A two-column table of image + caption is a figure list, not tabular data.
      const isFigures = block.rows.every((r) => r.length === 2 && r[0]!.startsWith('!['));
      if (isFigures) {
        return `<div class="figures">${block.rows
          .map((r) => `<figure>${inline(r[0]!)}<figcaption>${inline(r[1]!)}</figcaption></figure>`)
          .join('')}</div>`;
      }
      const head = block.head.some((h) => h !== '')
        ? `<thead><tr>${block.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
        : '';
      const body = block.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      return `<div class="scroller"><table>${head}<tbody>${body}</tbody></table></div>`;
    }
    case 'rule': return '';
  }
}

async function main() {
  findTwins(join(process.cwd(), 'docs', 'changelog', 'shots'));
  const out = process.argv[2] ?? 'changelog.html';
  const src = await readFile(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  const doc = groupChangelog(parseMarkdown(src));

  // Newest first. The file stays chronological; reading order is a rendering decision.
  const entries = [...doc.entries].reverse();
  const stages = entries.filter((e) => !e.divider);

  const body = entries
    .map((e) => {
      const content = e.blocks.map(render).join('');
      if (e.divider) {
        return `<section class="era" id="${e.id}"><p class="eralabel">${esc(e.title)}</p>${content}</section>`;
      }
      return (
        `<section class="entry" id="${e.id}">` +
        `<p class="eyebrow">${esc(e.key)}</p>` +
        `<h2>${inline(e.rest)}</h2>` +
        content +
        `</section>`
      );
    })
    .join('');

  const nav = stages
    .map(
      (e) =>
        `<a href="#${e.id}"><span class="k">${esc(e.key)}</span>` +
        (e.rest === e.key ? '' : `<span class="t">${esc(e.rest)}</span>`) +
        `</a>`,
    )
    .join('');

  const preamble = doc.preamble.map(render).join('');

  const html = `<title>${config.product.name} Build Log</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  /* The palette is the project's own, and this page wears the app's default theme: green since
     24 Sep 2026 (issue 0010), Protocol Labs' colour through the chrome. The meaning colours stay
     as CLAUDE.md settled them; only the ground, the ink and the accent move. */
  :root{
    --ground:#F1F4F0; --surface:#FFFFFF; --ink:#16201B; --muted:#54605A;
    --line:#DAE3DC; --hair:#EAF0EA; --accent:#1E8F5E; --clay:#BF4A16; --green:#0E7F55; --amber:#8A6410;
    --display:'Fraunces',Georgia,serif;
    --sans:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
    --mono:'IBM Plex Mono',ui-monospace,monospace;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --ground:#0F1512; --surface:#16201B; --ink:#E6F0E9; --muted:#8FA298;
      --line:#1F3B30; --hair:#17301F; --accent:#4FB88C; --clay:#E4793F; --green:#4FB88C; --amber:#C99B3F;
    }
  }
  :root[data-theme="dark"]{
    --ground:#0F1512; --surface:#16201B; --ink:#E6F0E9; --muted:#8FA298;
    --line:#1F3B30; --hair:#17301F; --accent:#4FB88C; --clay:#E4793F; --green:#4FB88C; --amber:#C99B3F;
  }

  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);
       font-family:var(--sans);font-size:15px;line-height:1.65;
       -webkit-font-smoothing:antialiased}

  .masthead{border-bottom:1px solid var(--line);background:var(--surface)}
  .wrap{max-width:780px;margin:0 auto;padding-inline:20px}
  .masthead .wrap{padding-block:28px 24px}
  .mark{display:inline-flex;align-items:center;gap:10px;margin-bottom:18px}
  .mark i{width:26px;height:26px;border-radius:7px;background:var(--accent);color:#fff;
          display:flex;align-items:center;justify-content:center;font-family:var(--display);
          font-style:normal;font-weight:600;font-size:15px}
  .mark b{font-family:var(--display);font-size:15px;font-weight:600}
  h1{font-family:var(--display);font-size:clamp(30px,7vw,42px);font-weight:600;
     line-height:1.12;letter-spacing:-.01em;margin:0 0 10px;text-wrap:balance}
  .lede{color:var(--muted);font-size:15.5px;margin:0;max-width:60ch}
  .facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
  .facts span{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;
              text-transform:uppercase;color:var(--muted);border:1px solid var(--line);
              border-radius:20px;padding:4px 11px}

  nav.toc{border-bottom:1px solid var(--line);background:var(--surface)}
  nav.toc .wrap{padding-block:16px 18px}
  nav.toc p{font-family:var(--mono);font-size:10px;letter-spacing:.14em;
            text-transform:uppercase;color:var(--muted);margin:0 0 10px}
  .tocgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 16px}
  .tocgrid a{display:flex;gap:8px;align-items:baseline;color:var(--ink);
             text-decoration:none;padding:4px 0;font-size:13px;border-bottom:1px solid transparent}
  .tocgrid a:hover{border-bottom-color:var(--accent)}
  .tocgrid .k{font-family:var(--mono);font-size:11px;color:var(--accent);flex:none;min-width:34px}
  .tocgrid .t{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  main .wrap{padding-block:8px 60px}
  .entry{padding-block:34px;border-bottom:1px solid var(--line)}
  .entry:last-child{border-bottom:0}
  .era{padding-block:26px 6px}
  .eralabel{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;
            text-transform:uppercase;color:var(--muted);margin:0 0 8px;
            padding-top:16px;border-top:1px solid var(--line)}
  .era p:not(.eralabel){color:var(--muted);font-size:13.5px}
  .eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;
           text-transform:uppercase;color:var(--accent);margin:0 0 6px}
  h2{font-family:var(--display);font-size:clamp(22px,4.6vw,27px);font-weight:600;
     line-height:1.2;margin:0 0 14px;scroll-margin-top:16px;text-wrap:balance}
  h3{font-family:var(--display);font-size:17px;font-weight:600;margin:26px 0 8px}
  h4{font-size:14px;font-weight:600;margin:20px 0 6px}
  p{margin:0 0 13px;max-width:66ch}
  ul,ol{margin:0 0 14px;padding-left:22px;max-width:66ch}
  li{margin-bottom:6px}
  strong{font-weight:600}
  a{color:var(--accent)}

  code{font-family:var(--mono);font-size:.86em;background:var(--hair);
       border:1px solid var(--line);border-radius:4px;padding:1px 4px}
  .path{font-family:var(--mono);font-size:.86em;color:var(--muted)}
  pre{background:var(--surface);border:1px solid var(--line);border-radius:8px;
      padding:14px 16px;overflow-x:auto;margin:0 0 16px}
  pre code{background:none;border:0;padding:0;font-size:12px;line-height:1.6}

  blockquote{margin:0 0 16px;padding:13px 16px;background:var(--surface);
             border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:0 8px 8px 0}
  blockquote p{margin:0;color:var(--muted);font-style:italic;max-width:none}

  .scroller{overflow-x:auto;margin:0 0 18px;border:1px solid var(--line);
            border-radius:8px;background:var(--surface)}
  table{border-collapse:collapse;width:100%;font-size:13px;min-width:420px}
  th{text-align:left;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;
     text-transform:uppercase;color:var(--muted);font-weight:400;
     padding:11px 14px;border-bottom:1px solid var(--line)}
  td{padding:11px 14px;border-bottom:1px solid var(--hair);vertical-align:top}
  tr:last-child td{border-bottom:0}

  /* Prose stays at a readable measure; screenshots break out of it, because the reason
     somebody widens the window is to see the screenshot. */
  .figures{display:grid;gap:26px;margin:4px 0 22px;
           width:min(1560px,calc(100vw - 40px));
           margin-inline:calc(50% - min(780px,calc(100vw - 40px))/2 - (min(1560px,calc(100vw - 40px)) - min(780px,calc(100vw - 40px)))/2)}
  .shotwide{width:min(1560px,calc(100vw - 40px));
            margin-inline:calc(50% - min(780px,calc(100vw - 40px))/2 - (min(1560px,calc(100vw - 40px)) - min(780px,calc(100vw - 40px)))/2)}
  figure img,.shotwide img{cursor:zoom-in}
  /* the lightbox */
  #lb{position:fixed;inset:0;background:rgba(10,10,9,.92);display:none;
      align-items:center;justify-content:center;padding:20px;z-index:50;cursor:zoom-out}
  #lb.on{display:flex}
  #lb img{max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  #lb .hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);color:#B9B4A8;
            font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase}
  figure{margin:0}
  figure img{display:block;width:100%;height:auto;border:1px solid var(--line);
             border-radius:8px;background:var(--surface)}
  figcaption{margin-top:9px;font-size:13px;color:var(--muted);max-width:62ch}
  figcaption strong{color:var(--ink)}
  img{max-width:100%}

  footer{border-top:1px solid var(--line);background:var(--surface)}
  footer .wrap{padding-block:24px 34px;color:var(--muted);font-size:13px}
</style>

<header class="masthead">
  <div class="wrap">
    <span class="mark"><i>${config.product.mark}</i><b>${config.product.name}</b></span>
    <h1>Build log</h1>
    <p class="lede">What landed at each stage, what was deliberately left out, and where the
      build disagreed with the plan. Generated from <code>CHANGELOG.md</code>.</p>
    <div class="facts">
      <span>${stages.length} entries</span>
      <span>L1 to L13 complete</span>
      <span>Local-first</span>
    </div>
  </div>
</header>

<nav class="toc">
  <div class="wrap">
    <p>Contents &middot; newest first</p>
    <div class="tocgrid">${nav}</div>
  </div>
</nav>

<main><div class="wrap">${preamble}${body}</div></main>

<footer>
  <div class="wrap">
    Generated from the repository, so it cannot drift from what was actually committed.
    Screenshots are the ones captured at each stage.
  </div>
</footer>

<div id="lb" role="dialog" aria-label="Full size screenshot" aria-hidden="true">
  <img alt="">
  <span class="hint">Click anywhere or press Esc to close</span>
</div>
<script>
/* Click a screenshot to see it full size. Twenty lines rather than a dependency: this
   page has to open from a file:// URL with nothing installed. */
(function () {
  var lb = document.getElementById('lb');
  var big = lb.querySelector('img');
  function open(src, alt) {
    big.src = src; big.alt = alt || '';
    lb.classList.add('on'); lb.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    lb.classList.remove('on'); lb.setAttribute('aria-hidden', 'true');
    big.removeAttribute('src'); document.body.style.overflow = '';
  }
  document.addEventListener('click', function (e) {
    var img = e.target.closest('figure img, .shotwide img');
    if (img) { open(img.currentSrc || img.src, img.alt); return; }
    if (lb.classList.contains('on')) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
</script>
`;

  await writeFile(out, html, 'utf8');
  console.log(`wrote ${out} · ${stages.length} entries, newest first · ${(html.length / 1024).toFixed(0)} KB`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
