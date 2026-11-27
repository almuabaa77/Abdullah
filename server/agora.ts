import { createHash } from 'node:crypto'
import AgoraToken from 'agora-token/src/AccessToken2.js'
import type { LessonCredentials } from '../src/lessons'

export type AgoraEnvironment = {
  AGORA_APP_ID?:string; AGORA_APP_CERTIFICATE?:string
  AGORA_CUSTOMER_ID?:string; AGORA_CUSTOMER_SECRET?:string; AGORA_COHOST_AUTH_ENABLED?:string
}
import { tokenLifetime } from './lesson-media-policy'
const hex=/^[a-f0-9]{32}$/i
// Agora uses this public project identifier in the browser. Certificates stay in the environment.
const projectAppId='6d0bf82846d445e98ad9382c01906fa6'
export function agoraConfig(env:AgoraEnvironment) {
  const {AGORA_APP_ID:appId=projectAppId,AGORA_APP_CERTIFICATE:certificate,AGORA_CUSTOMER_ID:customerId,AGORA_CUSTOMER_SECRET:customerSecret}=env
  if(!appId||!hex.test(appId)||!certificate||!hex.test(certificate)||!customerId||!customerSecret||env.AGORA_COHOST_AUTH_ENABLED!=='true')return
  return {appId,certificate,authorization:'Basic '+Buffer.from(customerId+':'+customerSecret).toString('base64')}
}
type AgoraConfig=NonNullable<ReturnType<typeof agoraConfig>>
export const lessonChannel=(id:string)=>'halaqat-'+createHash('sha256').update(id).digest('hex').slice(0,36)

export function issueAgora(config:AgoraConfig,lessonId:string,uid:number,audio:boolean,video:boolean,ttl=tokenLifetime):LessonCredentials {
  const channel=lessonChannel(lessonId)
  const {AccessToken2,ServiceRtc}=AgoraToken
  const token=new AccessToken2(config.appId,config.certificate,0,ttl)
  const rtc=new ServiceRtc(channel,uid)
  rtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel,ttl)
  if(audio)rtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream,ttl)
  if(video)rtc.add_privilege(ServiceRtc.kPrivilegePublishVideoStream,ttl)
  token.add_service(rtc)
  return {appId:config.appId,channel,uid,token:token.build(),audio,video}
}
async function agoraRequest(config:AgoraConfig,path:string,body?:Record<string,unknown>) {
  const response=await fetch('https://api.agora.io/dev/v1/'+path,{method:body?'POST':'GET',headers:{
    Authorization:config.authorization,...body?{'Content-Type':'application/json'}:{},
  },body:body&&JSON.stringify(body),signal:AbortSignal.timeout(4500)})
  if(!response.ok)throw new Error('Agora REST '+response.status)
  return response.json()
}
export async function revokeAgora(config:AgoraConfig,lessonId:string,uid:number) {
  const result=await agoraRequest(config,'kicking-rule',{appid:config.appId,cname:lessonChannel(lessonId),uid,time:5,privileges:['join_channel']})
  if(!result.id)throw new Error('Agora did not confirm the restriction')
}
export async function agoraPresence(config:AgoraConfig,lessonId:string) {
  const result=await agoraRequest(config,'channel/user/'+config.appId+'/'+lessonChannel(lessonId))
  if(result.success!==true||!result.data)throw new Error('Agora did not confirm presence')
  const {channel_exist:exists,users,broadcasters,audience}=result.data
  if(exists===false)return new Set<number>()
  const lists=[users,broadcasters,audience].filter(Array.isArray) as number[][]
  if(!lists.length)throw new Error('Agora presence format unavailable')
  return new Set(lists.flat().filter(Number.isInteger))
}
