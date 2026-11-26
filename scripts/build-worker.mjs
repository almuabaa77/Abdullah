import { readdir, readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

const directory = 'dist/client'
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'}
const assets = {}
let serviceWorker = await readFile('public/sw.js','utf8')
const versionMeta = /(<meta name="app-version" content=")[^"]*(")/
for (const file of (await readdir(directory,{recursive:true,withFileTypes:true})).filter(d=>d.isFile())) {
  const path = join(file.parentPath,file.name)
  const route = path === 'dist/client/index.html' ? '/' : path.slice(directory.length)
  if (route==='/sw.js'||route==='/app-version.json') continue
  let bytes = await readFile(path)
  if (route==='/') bytes = Buffer.from(bytes.toString('utf8').replace(versionMeta,(_,prefix,suffix)=>prefix+'__BUILD_VERSION__'+suffix))
  assets[route] = [types[extname(path)] || 'application/octet-stream',bytes.toString('base64')]
}
const routes = Object.keys(assets).sort()
const version = createHash('sha256').update(JSON.stringify(routes.map(route=>[route,assets[route]]))).update(serviceWorker).digest('hex').slice(0,12)
const html = Buffer.from(assets['/'][1],'base64').toString('utf8').replace('__BUILD_VERSION__',version)
serviceWorker = serviceWorker.replace('__BUILD_VERSION__',version).replace("'__CACHEABLE_FILES__'",JSON.stringify(routes.filter(route=>route.startsWith('/assets/'))))
const versionFile = JSON.stringify({version})
assets['/'] = [types['.html'],Buffer.from(html).toString('base64')]
assets['/sw.js'] = [types['.js'],Buffer.from(serviceWorker).toString('base64')]
assets['/app-version.json'] = [types['.json'],Buffer.from(versionFile).toString('base64')]
await Promise.all([
  writeFile(join(directory,'index.html'),html),
  writeFile(join(directory,'sw.js'),serviceWorker),
  writeFile(join(directory,'app-version.json'),versionFile),
])
const embedAssets = {
  name:'embed-assets',
  setup(plugin) {
    plugin.onResolve({filter:/generated-assets$/}, () => ({path:'assets',namespace:'embedded'}))
    plugin.onLoad({filter:/.*/,namespace:'embedded'}, () => ({
      contents:'export const assetList = ' + JSON.stringify(assets),
      loader:'js',
    }))
  },
}
await Promise.all([
  build({entryPoints:['server/worker.ts'],outfile:'dist/server/index.js',bundle:true,platform:'browser',format:'esm',target:'es2022',plugins:[embedAssets]}),
  build({entryPoints:['server/hostinger.ts'],outfile:'dist/hostinger/index.js',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',plugins:[embedAssets]}),
])
await mkdir('dist/.openai',{recursive:true})
await copyFile('.openai/hosting.json','dist/.openai/hosting.json')
await cp('drizzle','dist/drizzle',{recursive:true})
