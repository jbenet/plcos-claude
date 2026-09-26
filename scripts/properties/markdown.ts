import type { Check } from './harness';

export async function markdownProperties(check: Check) {
  {
    const { parseMarkdown, parseInline } = await import('../../lib/markdown');
    const sample = '| Location | Meaning |\n|---|---|\n| `data/<demo\\|real>/` | **Local** |';
    const table = parseMarkdown(sample, { document: true })[0];
    const example = '```markdown\n# Example\n```json\n{"example": true}\n```\n```\n## After';
    const blocks = parseMarkdown(example, { document: true });
    const legacy = parseMarkdown(sample)[0];
    check('System docs keep escaped table pipes in one cell and nested Markdown examples in their code block',
      table?.kind === 'table' && table.rows[0]?.length === 2 && table.rows[0]?.[0] === '`data/<demo|real>/`'
      && blocks[0]?.kind === 'code' && blocks[0].text.includes('```json')
      && blocks[1]?.kind === 'heading' && blocks[1].text === 'After'
      && parseInline('**Local**')[0]?.kind === 'strong'
      && legacy?.kind === 'table' && legacy.rows[0]?.length === 3,
      'doc tables retain literal pipes; fenced examples stay literal; existing renderers keep their default parsing');
  }
}
