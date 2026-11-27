import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zipSync } from 'fflate'

const output = process.argv[2]
if (!output?.endsWith('.zip')) throw new Error('Provide a .zip output path')
const stage = await mkdtemp(join(tmpdir(), 'halaqat-hostinger-'))
try {
  const { name, version, engines } = JSON.parse(await readFile('package.json', 'utf8'))
  const { packages } = JSON.parse(await readFile('package-lock.json', 'utf8'))
  const dependencies = Object.fromEntries(['express', 'mysql2', 'web-push'].map(
    (dependency) => [dependency, packages['node_modules/' + dependency].version],
  ))
  const manifest = {
    name,
    version,
    private: true,
    type: 'module',
    main: 'start.cjs',
    engines,
    scripts: {
      start: 'node start.cjs',
      build: 'node --check start.cjs && node --check server.js && node --check halaqat-runtime.mjs',
    },
    dependencies,
  }
  await Promise.all([
    writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n'),
    writeFile(join(stage, 'start.cjs'), await readFile('start.cjs')),
    writeFile(join(stage, 'server.js'), "import './halaqat-runtime.mjs'\n"),
    writeFile(join(stage, 'halaqat-runtime.mjs'), await readFile('dist/hostinger/index.js')),
    writeFile(join(stage, 'README.md'), await readFile('README.md')),
  ])
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' })
  const files = await Promise.all((await readdir(stage)).map(async (file) => [file, await readFile(join(stage, file))]))
  const archive = zipSync(Object.fromEntries(files), { level: 6 })
  await writeFile(resolve(output), archive)
  console.log('Hostinger ZIP written to ' + output)
} finally {
  await rm(stage, { recursive: true, force: true })
}
