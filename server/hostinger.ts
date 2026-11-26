import express, { type ErrorRequestHandler, type Request as HttpRequest, type Response as HttpResponse } from 'express'
import { createPool, type Pool, type PoolOptions, type QueryResult, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import { api, ApiError, type Repository } from './api'
import { serveAsset } from './assets'
import { mysqlConfig, mysqlFailureIssue } from './hostinger-db'
import { revisionStream } from './revision-stream'

const env = process.env
const settings = { connectionLimit:5, connectTimeout:10000, charset:'utf8mb4' }
const port = Number(env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const config = mysqlConfig(env)
const createSchema = `
  CREATE TABLE IF NOT EXISTS halaqat_workspaces (
    id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    data LONGTEXT NOT NULL
  ) ENGINE=InnoDB CHARACTER SET utf8mb4
`

let connection:Pool|undefined
let databaseInitialization:Promise<Pool>|undefined
let databaseIssue:string|undefined = 'issue' in config ? config.issue : undefined
let databaseStatus:'not_configured'|'connecting'|'unavailable'|'ready' = 'options' in config ? 'connecting' : 'not_configured'
let retryDatabaseAt = 0

function databaseError() {
  if (databaseIssue === 'password_is_example') return new ApiError('كلمة مرور MySQL في إعدادات الاستضافة تحتاج إلى تصحيح',503)
  return new ApiError(databaseStatus === 'not_configured'
    ? 'يلزم إعداد اتصال MySQL في Hostinger'
    : 'تعذر الاتصال بقاعدة بيانات المنصة، حاول مجددًا بعد قليل',503)
}

function unavailable(error:unknown) {
  databaseInitialization = undefined
  databaseStatus = 'unavailable'
  retryDatabaseAt = Date.now() + 5000
  databaseIssue = mysqlFailureIssue(error)
  console.error(`Hostinger MySQL unavailable (${databaseIssue})`)
  return databaseError()
}

async function startDatabase(options:PoolOptions) {
  connection ??= createPool(options)
  await connection.query(createSchema)
  await connection.query('SELECT id, revision, data FROM halaqat_workspaces LIMIT 0')
  databaseStatus = 'ready'
  databaseIssue = undefined
  return connection
}

async function database() {
  if ('issue' in config || Date.now() < retryDatabaseAt) throw databaseError()
  return databaseInitialization ??= startDatabase({ ...settings, ...config.options }).catch((error)=>{throw unavailable(error)})
}

async function query<T extends QueryResult>(statement:string,values:(string|number)[]) {
  const pool = await database()
  try {
    return await pool.execute<T>(statement,values)
  } catch (error) {
    throw unavailable(error)
  }
}
const revisions = revisionStream(async () => {
  const [rows] = await query<(RowDataPacket & {revision:number})[]>('SELECT revision FROM halaqat_workspaces WHERE id=?',['school'])
  return rows[0]?.revision
})
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
    if (result.affectedRows===1 && id==='school') revisions.publish(revision+1)
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
    databaseIssue,
    phoneAuthConfigured:Boolean(env.FIREBASE_WEB_CONFIG),
  })
})
app.get('/api/workspace/events',async (req,res)=>{
  const response = await api(appRequest(req),repository,env)
  if (!response.ok) {await forward(res,response);return}
  if (res.destroyed) return
  const {revision} = await response.json() as {revision:number}
  revisions.connect(res,revision)
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
  if ('options' in config) {
    void database().catch(()=>{})
  } else {
    console.error(`Hostinger MySQL is not configured (${config.issue})`)
  }
})
process.once('SIGTERM',()=>{
  revisions.stop()
  server.close(()=>{void connection?.end()})
})
