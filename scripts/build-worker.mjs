import { readdir, readFile, mkdir, copyFile, cp } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

const directory = 'dist/client'
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'}
const assets = {}
let serviceWorker = ''
for (const file of (await readdir(directory,{recursive:true,withFileTypes:true})).filter(d=>d.isFile())) {
  const path = join(file.parentPath,file.name)
  const route = path === 'dist/client/index.html' ? '/' : path.slice(directory.length)
  const bytes = await readFile(path)
  if (route === '/sw.js') serviceWorker = bytes.toString()
  else assets[route] = [types[extname(path)] || 'application/octet-stream',bytes.toString('base64')]
}
const version = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,12)
const preload = Object.keys(assets).filter(route => !/\/assets\/index-.*?\.js$/.test(route) || route === '/')
for (const route of Object.keys(assets)) if (route.endsWith('.js') && !/firebase|phone/.test(route)) preload.push(route)
serviceWorker = serviceWorker.replace('__BUILD_VERSION__',version).replace("'__PRECACHE_FILES__'",JSON.stringify([...new Set(preload)]))
assets['/sw.js'] = [types['.js'],Buffer.from(serviceWorker).toString('base64')]
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
