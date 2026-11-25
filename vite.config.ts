import { defineConfig, loadEnv, type Plugin } from 'vite'
import tailwind from '@tailwindcss/vite'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { api, type Repository } from './server/api'

function previewApi(): Plugin {
  return {
    name: 'workspace-preview',
    apply: 'serve',
    configureServer(server) {
      mkdirSync('.preview', { recursive: true })
      const db = new DatabaseSync('.preview/workspaces.sqlite')
      db.exec(readFileSync('drizzle/0000_workspace.sql','utf8').replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'))
      const repo: Repository = {
        async read(id) { return db.prepare('SELECT revision,data FROM workspaces WHERE id=?').get(id) as Awaited<ReturnType<Repository['read']>> ?? null },
        async create(id,state) { db.prepare('INSERT OR IGNORE INTO workspaces(id,data) VALUES(?,?)').run(id,JSON.stringify(state)) },
        async write(id,revision,state) { return Number(db.prepare('UPDATE workspaces SET revision=revision+1,data=? WHERE id=? AND revision=?').run(JSON.stringify(state),id,revision).changes) === 1 },
      }
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use('/api', async (req,res) => {
        const headers = new Headers()
        for (const [key,val] of Object.entries(req.headers)) if (val) headers.set(key, Array.isArray(val) ? val.join(', ') : val)
        headers.set('oai-authenticated-user-id', 'local-preview')
        const data: Buffer[] = []
        for await (const chunk of req) data.push(Buffer.from(chunk))
        const result = await api(new Request(new URL('/api' + req.url, 'http://localhost'), { method:req.method,headers,body: data.length ? Buffer.concat(data) : undefined }),repo,env)
        res.statusCode = result.status
        result.headers.forEach((value,key) => res.setHeader(key,value))
        res.end(await result.text())
      })
    },
  }
}
export default defineConfig({ plugins:[tailwind(), previewApi()], build:{outDir:'dist/client'}, server:{allowedHosts:true} })
