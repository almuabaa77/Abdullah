import { api, type Env, type Repository } from './api'
import { serveAsset } from './assets'
type Prepared = {
  bind(...values: (string | number)[]): Prepared
  first<T>(): Promise<T | null>
  run(): Promise<{meta:{changes:number}}>
}
type WorkerEnv = Env & { DB?: { prepare(query:string):Prepared } }
export default {
  async fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      if (!env.DB) return Response.json({ error: 'قاعدة بيانات المنصة غير متصلة' },{status:503,headers:{'Cache-Control':'no-store'}})
      const db = env.DB
      const repository: Repository = {
        read: id => db.prepare('SELECT revision,data FROM workspaces WHERE id=?').bind(id).first(),
        async create(id,state) { await db.prepare('INSERT OR IGNORE INTO workspaces(id,data) VALUES(?,?)').bind(id,JSON.stringify(state)).run() },
        async write(id,revision,state) { return (await db.prepare('UPDATE workspaces SET revision=revision+1,data=? WHERE id=? AND revision=?').bind(JSON.stringify(state),id,revision).run()).meta.changes === 1 },
      }
      return api(request,repository,env)
    }
    return serveAsset(request)
  },
}
