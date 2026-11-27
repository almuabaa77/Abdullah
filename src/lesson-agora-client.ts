import type { IAgoraRTCClient } from 'agora-rtc-sdk-ng'
import type { LessonCredentials } from './lessons'

export function configureLessonEncryption(client:IAgoraRTCClient,credentials:LessonCredentials) {
  if(!credentials.encryption)return
  const salt=Uint8Array.from(atob(credentials.encryption.salt),character=>character.charCodeAt(0))
  client.setEncryptionConfig('aes-256-gcm2',credentials.encryption.secret,salt)
}
export async function createLiveAgoraClient() {
  const {default:sdk}=await import('agora-rtc-sdk-ng')
  sdk.setLogLevel(4)
  if(!window.isSecureContext||!sdk.checkSystemRequirements())return
  const codecs=await sdk.getSupportedCodec().catch(()=>undefined)
  const codec=codecs?.video.includes('H264')&&!codecs.video.includes('VP8')?'h264':'vp8'
  return {client:sdk.createClient({mode:'live',codec}),sdk}
}

export type ConnectionProbe =
  | {state:'connected'; elapsedMs:number; rtt:number}
  | {state:'unsupported'|'timeout'|'rejected'}

export async function probeAgoraConnection(credentials:LessonCredentials):Promise<ConnectionProbe> {
  const live=await createLiveAgoraClient()
  if(!live)return {state:'unsupported'}
  const {client}=live
  let timeout:number|undefined
  const began=performance.now()
  try{
    configureLessonEncryption(client,credentials)
    const connect=async()=>{
      await client.setClientRole('audience')
      await client.join(credentials.appId,credentials.channel,credentials.token,credentials.uid)
      return {state:'connected',elapsedMs:Math.round(performance.now()-began),rtt:client.getRTCStats().RTT} as const
    }
    const deadline=new Promise<ConnectionProbe>(resolve=>{timeout=window.setTimeout(()=>resolve({state:'timeout'}),12_000)})
    return await Promise.race([connect(),deadline])
  }catch{return {state:'rejected'}}
  finally{
    window.clearTimeout(timeout)
    void client.leave().catch(()=>{})
  }
}
