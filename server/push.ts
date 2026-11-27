import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import webPush from 'web-push'
import { ApiError, noticeRecipient, type PushGateway } from './api'
import type { Notice, State, User } from '../src/domain'

type Device = RowDataPacket & { id:string; user_id:string; locale:string; subscription:string }
type Delivery = RowDataPacket & { id:string; device_id:string; user_id:string; notice_id:string|null; attempts:number; created_at:number; available_at:number }
type Keys = {publicKey:string;privateKey:string}
const minute=60_000
const subject='https://almuabaa77.site'
const privateHeaders={'Cache-Control':'private, no-store'}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const alertDescriptions:Record<string,[string,string]>={
  daily:['هناك تحديث في سجل الحلقة.','There is an update to a circle record.'],
  attendance:['هناك تحديث في الحضور.','There is an attendance update.'],
  message:['لديك رسالة جديدة.','You have a new message.'],
  call:['لديك مكالمة واردة.','You have an incoming call.'],
  'chat-report':['هناك بلاغ محادثة بانتظار المراجعة.','A conversation report is awaiting review.'],
  leave:['هناك تحديث يتعلق بالاستئذان.','There is a leave request update.'],
  link:['هناك تحديث في طلب ربط حساب.','There is an account link update.'],
  store:['هناك تحديث في طلب من متجر النقاط.','There is a rewards shop update.'],
  exam:['هناك تحديث متعلق بالاختبارات.','There is an assessment update.'],
  announcement:['هناك إعلان جديد في التطبيق.','There is a new announcement in the app.'],
}

function endpointFor(value:unknown) {
  if(typeof value!=='string'||value.length>4096)throw new ApiError('عنوان جهاز الإشعارات غير صالح')
  const url=URL.parse(value)
  const host=url?.hostname ?? ''
  const provider=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host)
    ||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com')
  if(!url||url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!provider||url.pathname==='/') {
    throw new ApiError('خدمة الإشعارات غير مدعومة على هذا الجهاز')
  }
  return url.href
}

function subscriptionFor(input:unknown):webPush.PushSubscription {
  if(!input||typeof input!=='object')throw new ApiError('بيانات اشتراك الإشعارات غير مكتملة')
  const {endpoint,keys}=input as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}}
  const p256dh=keys?.p256dh, auth=keys?.auth
  if(typeof p256dh!=='string'||typeof auth!=='string'||!/^B[\w-]{86}$/.test(p256dh)||!/^[\w-]{22}$/.test(auth)
    ||Buffer.from(p256dh,'base64url').length!==65||Buffer.from(auth,'base64url').length!==16) {
    throw new ApiError('مفاتيح اشتراك الإشعارات غير صالحة')
  }
  return {endpoint:endpointFor(endpoint),keys:{p256dh,auth}}
}

function target(user:User,kind?:string) {
  if(user.role==='admin')return kind==='message'||kind==='chat-report'?'/admin?section=chats':'/admin'
  if(kind==='message'||kind==='call')return '/#chat'
  if(kind==='exam')return '/#exams'
  if(kind==='leave')return '/#leaves'
  if(kind==='daily'||kind==='attendance')return '/#records'
  return '/'
}

export function backgroundPush(database:()=>Promise<Pool>,adminUid?:string) {
  let keys:Keys|undefined
  let initializing:Promise<void>|undefined
  let running=false

  async function initialize(pool:Pool) {
    if(keys)return
    await (initializing ??= (async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS halaqat_push_keys (
        id TINYINT PRIMARY KEY, public_key VARCHAR(120) NOT NULL, private_key VARCHAR(80) NOT NULL
      ) ENGINE=InnoDB`)
      await pool.query(`CREATE TABLE IF NOT EXISTS halaqat_push_devices (
        id CHAR(64) PRIMARY KEY, user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        locale CHAR(2) NOT NULL, subscription TEXT NOT NULL, last_test BIGINT NOT NULL DEFAULT 0,
        INDEX(user_id)
      ) ENGINE=InnoDB`)
      await pool.query(`CREATE TABLE IF NOT EXISTS halaqat_push_deliveries (
        id CHAR(64) PRIMARY KEY, device_id CHAR(64) NOT NULL,
        user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, notice_id VARCHAR(100),
        created_at BIGINT NOT NULL, available_at BIGINT NOT NULL, attempts TINYINT NOT NULL DEFAULT 0,
        INDEX(available_at), INDEX(device_id)
      ) ENGINE=InnoDB`)
      const generated=webPush.generateVAPIDKeys()
      await pool.execute('INSERT IGNORE INTO halaqat_push_keys VALUES (1,?,?)',[generated.publicKey,generated.privateKey])
      const [rows]=await pool.query<(RowDataPacket & Keys)[]>('SELECT public_key AS publicKey,private_key AS privateKey FROM halaqat_push_keys WHERE id=1')
      if(!rows[0])throw new Error('Web Push keys unavailable')
      keys=rows[0]
    })().finally(()=>{initializing=undefined}))
  }

  async function enqueue(connection:PoolConnection,state:State,notices:Notice[]) {
    if(!keys||!notices.length)return
    const [devices]=await connection.query<Device[]>('SELECT id,user_id FROM halaqat_push_devices')
    const users=new Map(state.users.map(user=>[user.id,user]))
    const now=Date.now()
    const rows=devices.flatMap(device=>{
      const user=users.get(device.user_id)
      const notice=user&&notices.find(item=>noticeRecipient(state,user,item,adminUid))
      return notice?[[hash(device.id+':'+notice.id),device.id,device.user_id,notice.id,now,now]]:[]
    })
    if(rows.length)await connection.query(`INSERT IGNORE INTO halaqat_push_deliveries
      (id,device_id,user_id,notice_id,created_at,available_at) VALUES ?`,[rows])
  }

  const handle:PushGateway=async (request,user,body)=>{
    const pool=await database()
    await initialize(pool).catch(()=>{throw new ApiError('تعذر تهيئة إشعارات الخلفية',503)})
    if(request.method==='GET')return Response.json({publicKey:keys!.publicKey},{headers:privateHeaders})
    if(body.action==='subscribe') {
      const subscription=subscriptionFor(body.subscription)
      const id=hash(subscription.endpoint)
      await pool.execute(`INSERT INTO halaqat_push_devices (id,user_id,locale,subscription)
        VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),locale=VALUES(locale),subscription=VALUES(subscription)`,
        [id,user.id,body.language==='en'?'en':'ar',JSON.stringify(subscription)])
    } else if(body.action==='status') {
      const [rows]=await pool.execute<RowDataPacket[]>('SELECT id FROM halaqat_push_devices WHERE id=? AND user_id=?',[hash(endpointFor(body.endpoint)),user.id])
      return Response.json({enabled:rows.length>0},{headers:privateHeaders})
    } else if(body.action==='unsubscribe') {
      await pool.execute('DELETE FROM halaqat_push_devices WHERE id=? AND user_id=?',[hash(endpointFor(body.endpoint)),user.id])
    } else if(body.action==='test') {
      const id=hash(endpointFor(body.endpoint))
      const now=Date.now()
      const [result]=await pool.execute<ResultSetHeader>('UPDATE halaqat_push_devices SET last_test=? WHERE id=? AND user_id=? AND last_test<?',[now,id,user.id,now-30_000])
      if(!result.affectedRows)throw new ApiError('فعّل التنبيهات أولًا أو انتظر قبل إعادة الاختبار',409)
      await pool.execute('INSERT INTO halaqat_push_deliveries (id,device_id,user_id,notice_id,created_at,available_at) VALUES (?,?,?,NULL,?,?)',
        [hash(randomUUID()),id,user.id,now,now])
      void drain()
    } else {
      throw new ApiError('إجراء الإشعارات غير معروف',404)
    }
    return new Response(null,{status:204,headers:privateHeaders})
  }

  async function drain() {
    const credentials=keys
    if(running||!credentials)return
    running=true
    try {
      const pool=await database()
      const now=Date.now()
      const [deliveries]=await pool.execute<Delivery[]>('SELECT * FROM halaqat_push_deliveries WHERE available_at<=? ORDER BY available_at LIMIT 16',[now])
      if(!deliveries.length)return
      const [workspaces]=await pool.query<(RowDataPacket & {data:string})[]>("SELECT data FROM halaqat_workspaces WHERE id='school'")
      const state=workspaces[0]?JSON.parse(workspaces[0].data) as State:undefined
      if(!state)return
      const users=new Map(state.users.map(user=>[user.id,user]))
      const notices=new Map(state.notices.map(notice=>[notice.id,notice]))
      await Promise.all(deliveries.map(async delivery=>{
        const [claim]=await pool.execute<ResultSetHeader>('UPDATE halaqat_push_deliveries SET available_at=? WHERE id=? AND available_at=?',
          [now+30_000,delivery.id,delivery.available_at])
        if(!claim.affectedRows)return
        const finish=()=>pool.execute('DELETE FROM halaqat_push_deliveries WHERE id=?',[delivery.id])
        const user=users.get(delivery.user_id)
        const notice=delivery.notice_id?notices.get(delivery.notice_id):undefined
        if(!user||user.status!=='active'||user.duplicateOf||user.role==='admin'&&user.id!==adminUid||now-delivery.created_at>15*minute
          ||delivery.notice_id&&(!notice||notice.readBy.includes(user.id)||!noticeRecipient(state,user,notice,adminUid))) {
          await finish()
          return
        }
        const [rows]=await pool.execute<Device[]>('SELECT * FROM halaqat_push_devices WHERE id=? AND user_id=?',[delivery.device_id,user.id])
        const device=rows[0]
        if(!device){await finish();return}
        try {
          const subscription=subscriptionFor(JSON.parse(device.subscription))
          const en=device.locale==='en'
          const kind=notice?.kind
          const description=delivery.notice_id?(alertDescriptions[kind??'']??['لديك تحديث جديد في التطبيق.','You have a new update in the app.'])
            :['وصل تنبيه الاختبار إلى هذا الجهاز.','Background notifications are working on this device.']
          const body=description[en?1:0]
          const payload=JSON.stringify({title:en?'Al-Khair Quran Circles':'حلقات جامع الخير',body,url:target(user,kind),tag:delivery.id.slice(0,20)})
          await webPush.sendNotification(subscription,payload,{TTL:kind==='call'?60:300,timeout:8000,topic:delivery.id.slice(0,24),vapidDetails:{...credentials,subject}})
          await finish()
        } catch(error) {
          const status=(error as {statusCode?:number}).statusCode
          if(status===404||status===410) {
            await pool.execute('DELETE FROM halaqat_push_devices WHERE id=? AND user_id=? AND subscription=?',[device.id,user.id,device.subscription])
            await finish()
          } else if(delivery.attempts>=3 || status!==undefined && status!==429 && status<500 || error instanceof ApiError) {
            await finish()
          } else {
            await pool.execute('UPDATE halaqat_push_deliveries SET attempts=attempts+1,available_at=? WHERE id=?',[Date.now()+15_000*2**delivery.attempts,delivery.id])
          }
        }
      }))
    } catch (error) {
      console.error('Background notifications temporarily unavailable',error instanceof Error?error.name:'UnknownError')
    } finally {running=false}
  }

  const timer=setInterval(()=>void drain(),5000)
  timer.unref()
  return {initialize,handle,enqueue,drain,ready:()=>Boolean(keys),stop:()=>clearInterval(timer)}
}
