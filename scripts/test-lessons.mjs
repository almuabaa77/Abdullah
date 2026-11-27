import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

const directory=await mkdtemp(join(tmpdir(),'halaqat-lessons-'))
try {
  const bundle=join(directory,'lessons.test.cjs')
  await build({entryPoints:['tests/lessons.test.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs',target:'node22'})
  const result=spawnSync(process.execPath,['--test',bundle],{stdio:'inherit'})
  process.exitCode=result.status??1
} finally {
  await rm(directory,{recursive:true,force:true})
}
