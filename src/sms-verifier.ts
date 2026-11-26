import { RecaptchaVerifier, type Auth } from 'firebase/auth'

export class BrowserCheckError extends Error {}

class SmsVerifier extends RecaptchaVerifier {
  private interrupt?: () => void
  onVerified?: () => void

  constructor(auth:Auth, container:HTMLElement, private readonly interactive:boolean) {
    super(auth,container,{
      size:interactive?(container.clientWidth<304?'compact':'normal'):'invisible',
      ...(interactive?{}:{badge:'inline'}),
      'error-callback':()=>this.useManualCheck(),
    })
  }

  useManualCheck() {this.interrupt?.()}

  override async verify() {
    // This deadline only covers obtaining a browser token. Never retry a timed-out SMS request.
    let timer:number|undefined
    const deadline=new Promise<never>((_,reject)=>{
      this.interrupt=()=>reject(new BrowserCheckError())
      timer=window.setTimeout(this.interrupt,this.interactive?90_000:12_000)
    })
    try {
      const token=await Promise.race([super.verify(),deadline]).catch(()=>{throw new BrowserCheckError()})
      this.onVerified?.()
      return token
    } finally {
      this.interrupt=undefined
      window.clearTimeout(timer)
    }
  }
}

export function prepareSmsVerifier(auth:Auth,host:HTMLElement,interactive=false) {
  const container=document.createElement('div')
  host.append(container)
  const verifier=new SmsVerifier(auth,container,interactive)
  const warm=verifier.render().catch(()=>{})
  return {
    verifier,
    clear() {
      container.remove()
      void warm.then(()=>verifier.clear())
    },
  }
}
