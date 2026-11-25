import express, { type ErrorRequestHandler, type Request as HttpRequest, type Response as HttpResponse } from 'express'
import { createPool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import { api, type Repository } from './api'
import { serveAsset } from './assets'

const env = process.env
const settings = { connectionLimit:5, connectTimeout:10000, charset:'utf8mb4' }
const port = Number(env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
if (!env.DATABASE_URL && !(env.DB_HOST && env.DB_NAME && env.DB_USER && env.DB_PASSWORD)) {
  throw new Error('Configure DATABASE_URL or the Hostinger MySQL environment variables before starting')
}

const pool = createPool(env.DATABASE_URL ? { ...settings, uri:env.DATABASE_URL } : {
  ...settings, host:env.DB_HOST, port:Number(env.DB_PORT || 3306), database:env.DB_NAME, user:env.DB_USER, password:env.DB_PASSWORD,
})

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS halaqat_workspaces (
      id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      revision INT UNSIGNED NOT NULL DEFAULT 0,
      data LONGTEXT NOT NULL
    ) ENGINE=InnoDB CHARACTER SET utf8mb4
  `)
} catch (error) {
  await pool.end()
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'
  throw new Error(`Cannot initialize the Hostinger MySQL database (${code})`)
}

const repository:Repository = {
  async read(id) {
    const [rows] = await pool.execute<(RowDataPacket & {revision:number;data:string})[]>('SELECT revision,data FROM halaqat_workspaces WHERE id=?',[id])
    return rows[0] ?? null
  },
  async create(id,state) {
    await pool.execute('INSERT INTO halaqat_workspaces(id,data) VALUES(?,?) ON DUPLICATE KEY UPDATE id=id',[id,JSON.stringify(state)])
  },
  async write(id,revision,state) {
    const [result] = await pool.execute<ResultSetHeader>('UPDATE halaqat_workspaces SET revision=revision+1,data=? WHERE id=? AND revision=?',[JSON.stringify(state),id,revision])
    return result.affectedRows === 1
  },
}

function appRequest(req:HttpRequest) {
  const headers = new Headers()
  // Sites identity headers are issued by its gateway. Hostinger visitors authenticate with Firebase only.
  for (const name of ['authorization','content-type','sec-fetch-site']) {
    const value = req.get(name)
    if (value) headers.set(name,value)
  }
  const body = req.method === 'POST' && typeof req.body === 'string' ? req.body : undefined
  return new Request('http://localhost' + req.originalUrl,{method:req.method,headers,body})
}

async function forward(res:HttpResponse,response:Response) {
  response.headers.forEach((value,key)=>res.setHeader(key,value))
  res.status(response.status).send(response.body ? Buffer.from(await response.arrayBuffer()) : undefined)
}

const app = express()
app.disable('x-powered-by')
app.get('/api/health',async (_req,res)=>{
  res.setHeader('Cache-Control','no-store')
  await pool.query('SELECT 1')
  res.json({status:'ok'})
})
app.use('/api',express.text({type:'application/json',limit:80000}),async (req,res)=>{
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).set('Allow','GET, POST').json({error:'Method not allowed'})
    return
  }
  await forward(res,await api(appRequest(req),repository,env))
})
app.use(async (req,res)=>{ await forward(res,serveAsset(appRequest(req))) })

const handleError:ErrorRequestHandler = (error,_req,res,_next) => {
  const oversized = error?.type === 'entity.too.large'
  if (!oversized) console.error('Hostinger request failed',error instanceof Error ? error.name : 'UnknownError')
  res.status(oversized ? 413 : 500).set('Cache-Control','no-store').json({error:oversized ? 'حجم الطلب غير مدعوم' : 'تعذر الاتصال بالمنصة'})
}
app.use(handleError)

const server = app.listen(port,'0.0.0.0',()=>console.log(`Halaqat listening on port ${port}`))
process.once('SIGTERM',()=>server.close(()=>{void pool.end()}))
