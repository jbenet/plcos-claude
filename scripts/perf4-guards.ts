/** Safety properties for the invented fixture entry points; no configured DB is opened. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureVersion, safeFixtureDirectory } from './perf4-fixture';

const prefix=await safeFixtureDirectory(join(tmpdir(),'plcos-perf4-guards-'),false);
const scratch=await mkdtemp(prefix);
let passed=0;
function refused(script:string,args:string[],env:Record<string,string>,message:string) {
  const result=spawnSync(process.execPath,['--import','tsx',script,...args],{
    env:{...process.env,DATA_PROFILE:'demo',DATABASE_URL:'',PGLITE_DIR:'',...env},encoding:'utf8',timeout:10000,
  });
  assert.notEqual(result.status,0,message);
  assert.ok(result.stderr.includes(message),`Expected refusal ${message}, received ${result.stderr.slice(0,300)}`);
  passed++;
}
try {
  const seed='scripts/perf4-fixture.ts',profile='scripts/perf4-profile.ts';
  refused(seed,[],{DATA_PROFILE:'real'},'require the demo profile');
  refused(seed,[],{DATABASE_URL:'postgres://fixture.invalid/refused'},'refuse DATABASE_URL');
  refused(seed,[],{PGLITE_DIR:join(scratch,'configured')},'refuse PGLITE_DIR');
  refused(seed,['--dir',join(scratch,'real','fixture')],{},'refuse real-data paths');
  refused(seed,[],{TMPDIR:join(scratch,'real')},'refuse real-data paths');
  const target=join(scratch,'target'),linked=join(scratch,'linked');
  await mkdir(target);await symlink(target,linked);
  refused(seed,['--dir',join(linked,'fixture')],{},'refuse symbolic-link paths');
  const marked=join(scratch,'marked');await mkdir(marked);
  await writeFile(join(marked,'.perf4-invented'),fixtureVersion+'\n');
  await symlink(target,join(marked,'db'));
  refused(profile,['--dir',marked],{},'refuse symbolic-link database directories');
  const plain=join(scratch,'plain');await mkdir(plain);await mkdir(join(plain,'db'));
  await writeFile(join(plain,'.perf4-invented'),'not-an-invented-fixture');
  refused(profile,['--dir',plain],{},'Not a marked invented performance fixture');
  // Sample validation precedes the DB open; use an otherwise valid empty marked root.
  await writeFile(join(plain,'.perf4-invented'),fixtureVersion+'\n');
  for(const samples of ['Infinity','NaN','0','-1','1.5','21'])
    refused(profile,['--dir',plain,'--samples',samples],{},'--samples must be an integer');
  console.log(`${passed} performance fixture safety properties passed.`);
} finally { await rm(scratch,{recursive:true,force:true}); }
