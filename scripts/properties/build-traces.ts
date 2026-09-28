import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditBuildTraces, buildTracesPass } from '../check-build-traces';
import type { Check } from './harness';

export async function buildTraceProperties(check: Check): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'plcos-trace-properties-'));
  let n = 0;
  async function fixture(files: string[] = ['../safe.js']) {
    const out = join(root, `build-${n++}`);
    await mkdir(out);
    await writeFile(join(out, 'server.js.nft.json'), JSON.stringify({ version: 1, files }));
    return out;
  }
  try {
    await writeFile(join(root, 'safe.js'), '/* invented */');
    const good = await auditBuildTraces(await fixture());
    check('BUILD TRACES safe inventory passes with counts', buildTracesPass(good) && good.traces === 1 && good.entries === 1, 'Invented traced JS only.');
    for (const path of ['../data/real/private.json', '../plcos-data/private.json', '../../data/real/../private.json', '../Data/Real/private.json']) {
      const result = await auditBuildTraces(await fixture([path]));
      check('BUILD TRACES refuses lexical private path or traversal', !buildTracesPass(result) && result.violations === 1, 'No forbidden file is created or opened.');
    }
    await symlink(join(root, 'data/real'), join(root, 'alias'));
    await symlink(join(root, 'alias'), join(root, 'alias-two'));
    const alias = await auditBuildTraces(await fixture(['../alias-two/absent/tail.json']));
    check('BUILD TRACES refuses chained symlink with absent target tail', !buildTracesPass(alias) && alias.violations === 1, 'Only link metadata is read, never the forbidden destination.');
    const dotdot = await auditBuildTraces(await fixture(['../alias/../safe.js']));
    check('BUILD TRACES refuses private symlink before dotdot normalization', !buildTracesPass(dotdot) && dotdot.violations === 1, 'A parent segment cannot hide an earlier private symlink target.');
    const missing = await auditBuildTraces(await fixture(['../missing/../alias/secret.json']));
    check('BUILD TRACES rechecks aliases exposed after missing component normalization', !buildTracesPass(missing) && missing.violations === 1, 'Next may normalize paths before copying.');
    const linkedManifest = await fixture();
    const outside = join(root, 'outside'); await mkdir(outside);
    await writeFile(join(outside, 'manifest.json'), JSON.stringify({ version: 1, files: ['local-alias/secret.json'] }));
    await rm(join(linkedManifest, 'server.js.nft.json'));
    await symlink(join(outside, 'manifest.json'), join(linkedManifest, 'server.js.nft.json'));
    await symlink(join(root, 'data/real'), join(linkedManifest, 'local-alias'));
    const logical = await auditBuildTraces(linkedManifest);
    check('BUILD TRACES linked manifest checks logical relative base', !buildTracesPass(logical) && logical.violations >= 2, 'Both the alias in output and the manifest entry are refused.');
    const physicalManifest = await fixture();
    await symlink(join(root, 'data/real'), join(outside, 'physical-alias'));
    await writeFile(join(outside, 'physical.json'), JSON.stringify({ version: 1, files: ['physical-alias/secret.json'] }));
    await symlink(join(outside, 'physical.json'), join(physicalManifest, 'physical.nft.json'));
    check('BUILD TRACES linked manifest checks physical relative base', !buildTracesPass(await auditBuildTraces(physicalManifest)), 'Resolved manifest location remains checked.');
    const standalone = await fixture();
    await mkdir(join(standalone, 'standalone'));
    await symlink(join(root, 'plcos-data'), join(standalone, 'standalone', 'innocent'));
    check('BUILD TRACES refuses standalone private symlink', !buildTracesPass(await auditBuildTraces(standalone)), 'Build output is inspected in addition to manifests.');
    const nested = await fixture();
    await mkdir(join(nested, 'standalone/data/real'), { recursive: true });
    check('BUILD TRACES refuses standalone private directory', !buildTracesPass(await auditBuildTraces(nested)), 'Forbidden directory is refused before traversal.');
    const malformed = await fixture();
    await writeFile(join(malformed, 'server.js.nft.json'), '{');
    check('BUILD TRACES malformed inventory fails closed', !buildTracesPass(await auditBuildTraces(malformed)), 'Parse failures expose counts only.');
    const wrongShape = await fixture();
    await writeFile(join(wrongShape, 'server.js.nft.json'), JSON.stringify({ version: 1, files: [42] }));
    check('BUILD TRACES invalid entry types fail closed', !buildTracesPass(await auditBuildTraces(wrongShape)), 'Every entry must be a nonempty string.');
    const version = await fixture();
    await writeFile(join(version, 'server.js.nft.json'), JSON.stringify({ version: 2, files: ['../safe.js'] }));
    check('BUILD TRACES unknown manifest version fails closed', !buildTracesPass(await auditBuildTraces(version)), 'Future formats need explicit review.');
    check('BUILD TRACES empty inventory fails closed', !buildTracesPass(await auditBuildTraces(await fixture([]))), 'At least one traced entry is required overall.');
    const empty = join(root, 'empty'); await mkdir(empty);
    check('BUILD TRACES missing manifests fail closed', !buildTracesPass(await auditBuildTraces(empty)), 'Existing empty output is not a proof.');
    check('BUILD TRACES missing build fails closed', !buildTracesPass(await auditBuildTraces(join(root, 'missing'))), 'Missing output is not a proof.');
    const safeLink = await fixture();
    await symlink(join(root, 'safe.js'), join(safeLink, 'safe-link.js'));
    check('BUILD TRACES safe symlink passes', buildTracesPass(await auditBuildTraces(safeLink)), 'Safe aliases remain usable.');
  } finally { await rm(root, { recursive: true, force: true }); }
}
