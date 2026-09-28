/** Exercise the shell sequence with invented database commands; no database/network. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Check } from './harness';

export async function cutoverShellProperties(check: Check) {
  const dir = await mkdtemp(join(tmpdir(), 'strip-cutover-'));
  try {
    await writeFile(join(dir,'psql'), `#!/bin/bash
url="$1"; shift
q=""; file=""
while [ $# -gt 0 ]; do
 case "$1" in -c) q="$2"; shift 2;; -f) file="$2"; shift 2;; *) shift;; esac
done
if [ -n "$file" ]; then echo "stop-jobs $url" >> "$FIXTURE_LOG"; echo 2; exit 0; fi
case "$q" in
 *system_identifier*) echo "invented/$url";;
 *pg_db_role_setting*) if [ -f "$FIXTURE_DIR/$url.frozen" ]; then echo t; else echo f; fi;;
 *"set default_transaction_read_only = on"*) touch "$FIXTURE_DIR/$url.frozen";;
 *"reset default_transaction_read_only"*) echo "flip $url" >> "$FIXTURE_LOG"; rm -f "$FIXTURE_DIR/$url.frozen";;
 *pg_terminate_backend*) echo 0;;
 *cutover_write_probe*) exit 1;;
 *pg_control_system*) echo "invented/$url";;
 *platform.migration*) echo t;;
 *pg_class*) if [ "$url" = source ]; then echo 1; else echo 0; fi;;
 *to_regprocedure*) echo f;;
esac
`,{mode:0o700});
    await writeFile(join(dir,'pg_dump'), '#!/bin/bash\nwhile [ $# -gt 0 ]; do if [ "$1" = -f ]; then echo invented > "$2"; exit 0; fi; shift; done\n',{mode:0o700});
    await writeFile(join(dir,'pg_restore'), '#!/bin/bash\nif [ "$1" = --list ]; then echo " TABLE DATA invented"; else echo restore >> "$FIXTURE_LOG"; fi\n',{mode:0o700});
    await writeFile(join(dir,'node'), `#!/bin/bash
case "$*" in
 *pg-verify.ts*)
 echo verify >> "$FIXTURE_LOG"
 while [ $# -gt 0 ]; do
  if [ "$1" = --json ]; then echo '{"tables":1,"rows":1,"sequences":0,"mismatchedTables":[],"missingTables":[],"extraTables":[],"mismatchedSequences":[],"objects":{}}' > "$2"; break; fi
  shift
 done
 echo MATCH;;
 *strip-dakota.ts*) echo strip >> "$FIXTURE_LOG"; exit "\${FIXTURE_STRIP_EXIT:-0}";;
esac
`,{mode:0o700});
    for (const mode of ['default','keep','failure']) {
      const log = join(dir, `${mode}.log`);
      await writeFile(log,'');
      const result = spawnSync('bash',['scripts/cutover.sh','run','--from','source','--to','target','--work',join(dir,mode),...(mode==='keep'?['--keep-dakota']:[])],{
        encoding:'utf8', env:{...process.env,PATH:`${dir}:${process.env.PATH}`,PG_BIN:dir,FIXTURE_LOG:log,FIXTURE_DIR:dir,FIXTURE_STRIP_EXIT:mode==='failure'?'1':'0'},
      });
      const actions = (await readFile(log,'utf8')).trim().split('\n');
      check(`CUTOVER shell ${mode} path preserves verification and target-only ordering`,
        mode==='failure' ? result.status!==0 && actions.join(',')==='restore,verify,strip'
          : result.status===0 && actions.join(',')===`restore,verify,${mode==='keep'?'':'strip,'}stop-jobs target,flip target`,
        'Command stubs: restore → MATCH → optional strip → stop target jobs → flip; strip failure cannot flip.');
      await rm(join(dir,'source.frozen'),{force:true});
      await rm(join(dir,'target.frozen'),{force:true});
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
}
