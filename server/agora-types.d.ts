declare module 'agora-token/src/AccessToken2.js' {
  export class AccessToken2 {
    constructor(appId:string,certificate:string,issueTimestamp:number,expiresIn:number)
    add_service(service:ServiceRtc):void
    build():string
  }
  export class ServiceRtc {
    static kPrivilegeJoinChannel:number
    static kPrivilegePublishAudioStream:number
    static kPrivilegePublishVideoStream:number
    constructor(channel:string,uid:number)
    add_privilege(privilege:number,expiresIn:number):void
  }
}
