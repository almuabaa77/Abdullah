import express, { type ErrorRequestHandler, type Request as HttpRequest, type Response as HttpResponse } from 'express'
import { createPool, type Pool, type QueryResult, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import { api, ApiError, type Repository } from './api'
import { serveAsset } from './assets'

const env = process.env
const settings = { connectionLimit:5, connectTimeout:10000, charset:'utf8mb4' }
const port = Number(env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const databaseConfigured = Boolean(env.DATABASE_URL || (env.DB_HOST && env.DB_NAME && env.DB_USER && env.DB_PASSWORD))
const createSchema = `
  CREATE TABLE IF NOT EXISTS halaqat_workspaces (
    id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    data LONGTEXT NOT NULL
  ) ENGINE=InnoDB CHARACTER SET utf8mb4
`

let connection:Pool|undefined
let databaseInitialization:Promise<Pool>|undefined
let databaseStatus:'not_configured'|'connecting'|'unavailable'|'ready' = databaseConfigured ? 'connecting' : 'not_configured'
let retryDatabaseAt = 0

function unavailable(error:unknown) {
  databaseInitialization = undefined
  databaseStatus = 'unavailable'
  retryDatabaseAt = Date.now() + 5000
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code : 'UNKNOWN'
  console.error(`Hostinger MySQL unavailable (${code})`)
  return new ApiError('تعذر الاتصال بقاعدة بيانات المنصة، حاول مجددًا بعد قليل',503)
}

async function startDatabase() {
  connection ??= createPool(env.DATABASE_URL ? { ...settings, uri:env.DATABASE_URL } : {
    ...settings, host:env.DB_HOST, port:Number(env.DB_PORT || 3306), database:env.DB_NAME, user:env.DB_USER, password:env.DB_PASSWORD,
  })
  await connection.query(createSchema)
  databaseStatus = 'ready'
  return connection
}

async function database() {
  if (!databaseConfigured) throw new ApiError('يلزم إعداد اتصال MySQL في Hostinger',503)
  if (Date.now() < retryDatabaseAt) throw new ApiError('تعذر الاتصال بقاعدة بيانات المنصة، حاول مجددًا بعد قليل',503)
  return databaseInitialization ??= startDatabase().catch((error)=>{throw unavailable(error)})
}

async function query<T extends QueryResult>(statement:string,values:(string|number)[]) {
  const pool = await database()
  try {
    return await pool.execute<T>(statement,values)
  } catch (error) {
    throw unavailable(error)
  }
}
const repository:Repository = {
  async read(id) {
    const [rows] = await query<(RowDataPacket & {revision:number;data:string})[]>('SELECT revision,data FROM halaqat_workspaces WHERE id=?',[id])
    return rows[0] ?? null
  },
  async create(id,state) {
    await query('INSERT INTO halaqat_workspaces(id,data) VALUES(?,?) ON DUPLICATE KEY UPDATE id=id',[id,JSON.stringify(state)])
  },
  async write(id,revision,state) {
    const [result] = await query<ResultSetHeader>('UPDATE halaqat_workspaces SET revision=revision+1,data=? WHERE id=? AND revision=?',[JSON.stringify(state),id,revision])
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
app.use((_req,res,next)=>{
  res.setHeader('X-Halaqat-App','hostinger')
  next()
})
app.get('/api/health',(_req,res)=>{
  if (databaseStatus === 'unavailable' && Date.now() >= retryDatabaseAt) void database().catch(()=>{})
  res.setHeader('Cache-Control','no-store')
  res.json({
    app:'halaqat-al-khair',
    status:databaseStatus === 'ready' ? 'ok' : 'degraded',
    database:databaseStatus,
    phoneAuthConfigured:Boolean(env.FIREBASE_WEB_CONFIG),
  })
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

const server = app.listen(port,'0.0.0.0',()=>{
  console.log(`Halaqat listening on 0.0.0.0:${port}`)
  if (databaseConfigured) {
    void database().catch(()=>{})
  } else {
    console.error('Hostinger MySQL is not configured. Set DATABASE_URL or the DB_HOST, DB_NAME, DB_USER and DB_PASSWORD values.')
  }
})
process.once('SIGTERM',()=>server.close(()=>{void connection?.end()}))
