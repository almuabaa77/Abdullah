import { agoraConfig, agoraPresence, createAgoraStatusCheck, issueAgora, revokeAgora } from './agora'
import { applyPresence, runLessonSchedule } from './lesson-workspace'
import express, { type ErrorRequestHandler, type Request as HttpRequest, type Response as HttpResponse } from 'express'
import { createPool, type Pool, type PoolOptions, type QueryResult, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import { api, ApiError, type Repository } from './api'
import { serveAsset } from './assets'
import { mysqlConfig, mysqlFailureIssue } from './hostinger-db'
import { revisionStream } from './revision-stream'
import { backgroundPush } from './push'
import { publishScheduled } from './announcements'
import { noticeExpiresAt, type State } from '../src/domain'

const env = process.env
const settings = { connectionLimit:5, connectTimeout:10000, charset:'utf8mb4' }
const port = Number(env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const config = mysqlConfig(env)
const push = backgroundPush(database,env.BOOTSTRAP_UID)
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
  await push.initialize(connection).catch(()=>console.error('Background notifications could not initialize'))
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
  async write(id,revision,state,notices=[]) {
    const sql='UPDATE halaqat_workspaces SET revision=revision+1,data=? WHERE id=? AND revision=?'
    const parameters=[JSON.stringify(state),id,revision]
    let saved:boolean
    if(id==='school'&&notices.length&&push.ready()) {
      const pool=await database()
      const session=await pool.getConnection()
      try {
        await session.beginTransaction()
        const [result]=await session.execute<ResultSetHeader>(sql,parameters)
        saved=result.affectedRows===1
        if(saved)await push.enqueue(session,state,notices)
        await session.commit()
      } catch(error) {
        await session.rollback().catch(()=>{})
        throw unavailable(error)
      } finally {session.release()}
    } else {
      const [result]=await query<ResultSetHeader>(sql,parameters)
      saved=result.affectedRows===1
    }
    if(saved&&id==='school') {
      revisions.publish(revision+1)
      const recipients = new Set(notices.filter(notice=>notice.recordReminder).flatMap(notice=>notice.users ?? []))
      if(recipients.size)revisions.publishReminders(revision+1,recipients)
      if(notices.length)void push.drain()
    }
    return saved
  },
}

const agora=agoraConfig(env)
const agoraStatus=createAgoraStatusCheck(env)
let publishing=false
const scheduleTimer=setInterval(async()=>{
  if(publishing||databaseStatus!=='ready')return
  publishing=true
  try {
    for(let attempt=0;attempt<4;attempt++){
      const current=await repository.read('school')
      if(!current)break
      const state=JSON.parse(current.data) as State
      const due=publishScheduled(state)
      const now=Date.now()
      const previousNotices=state.notices.length
      const scheduledLessons=runLessonSchedule(state,now)
      const lessonNotices=state.notices.slice(0,state.notices.length-previousNotices)
      const notices=state.notices.filter(notice=>notice.kind==='announcement'||noticeExpiresAt(notice)>now)
      if(!scheduledLessons&&!due.length&&notices.length===state.notices.length)break
      state.notices=notices
      if(await repository.write('school',current.revision,state,[...due,...lessonNotices]))break
    }
  } catch(error) {
    console.error('Scheduled workspace maintenance failed',error instanceof Error?error.name:'UnknownError')
  } finally {publishing=false}
},10_000)
scheduleTimer.unref()

let checkingRtc=false
let presenceCursor=0
const rtcTimer=setInterval(async()=>{
  if(checkingRtc||databaseStatus!=='ready')return
  checkingRtc=true
  try {
    const snapshot=await repository.read('school')
    if(!snapshot)return
    const state=JSON.parse(snapshot.data) as State
    const now=Date.now()
    const restrictions=state.lessonRestrictions??[]
    const next=restrictions.filter(rule=>rule.nextAttempt<=now&&rule.expiresAt>now).slice(0,12)
    const live=(state.lessons??[]).filter(lesson=>lesson.status==='live')
    const window=live.slice(presenceCursor,presenceCursor+8)
    presenceCursor=presenceCursor+8>=live.length?0:presenceCursor+8
    const results=agora?await Promise.all(next.map(async rule=>{
      try{await revokeAgora(agora,rule.lessonId,rule.uid);return {rule,approved:true}}
      catch{return {rule,approved:false}}
    })):[]
    const presence=agora?await Promise.all(window.map(async lesson=>{
      try{return {id:lesson.id,ids:await agoraPresence(agora,lesson.id)}}
      catch{return {id:lesson.id,ids:undefined}}
    })):[]
    if(!results.length&&!presence.length&&!restrictions.some(rule=>rule.expiresAt<=now))return
    for(let retry=0;retry<4;retry++){
      const current=await repository.read('school')
      if(!current)break
      const updated=JSON.parse(current.data) as State
      updated.lessonRestrictions=(updated.lessonRestrictions??[]).filter(rule=>rule.expiresAt>now&&!results.some(result=>result.approved&&result.rule.id===rule.id))
      for(const {rule,approved} of results)if(!approved){
        const target=updated.lessonRestrictions.find(item=>item.id===rule.id)
        if(target&&target.attempts===rule.attempts){
          target.attempts++
          target.nextAttempt=now+Math.min(60_000,2500*2**target.attempts)
        }
      }
      for(const entry of presence){
        const lesson=updated.lessons?.find(item=>item.id===entry.id&&item.status==='live')
        if(lesson&&entry.ids)applyPresence(lesson,entry.ids,now)
      }
      updated.lessonHealth={...updated.lessonHealth,lastError:results.some(result=>!result.approved)||presence.some(item=>!item.ids)?'تعذر تأكيد طلب لدى Agora. ستُعاد المحاولة.':undefined}
      if(await repository.write('school',current.revision,updated))break
    }
  } catch { console.error('Meeting media maintenance failed') }
  finally{checkingRtc=false}
},10_000)
rtcTimer.unref()

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
  res.setHeader('Permissions-Policy','camera=(self), microphone=(self)')
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
    pushReady:push.ready(),
    lessonRtcConfigured:Boolean(agora),
  })
})
app.get('/api/workspace/events',async (req,res)=>{
  const response = await api(appRequest(req),repository,env)
  if (!response.ok) {await forward(res,response);return}
  if (res.destroyed) return
  const {revision,recipient} = await response.json() as {revision:number;recipient?:string}
  revisions.connect(res,revision,recipient)
})
app.use('/api',express.text({type:'application/json',limit:80000}),async (req,res)=>{
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).set('Allow','GET, POST').json({error:'Method not allowed'})
    return
  }
  await forward(res,await api(appRequest(req),repository,env,push.handle,agora?grant=>issueAgora(agora,grant.lessonId,grant.uid,grant.audio,grant.video,grant.ttl):undefined,agoraStatus))
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
  clearInterval(scheduleTimer)
  clearInterval(rtcTimer)
  push.stop()
  revisions.stop()
  server.close(()=>{void connection?.end()})
})
