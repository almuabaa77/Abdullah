export type RecordStreamStatus = 'connecting' | 'live' | 'polling'

async function readRevisions(token:string,signal:AbortSignal,onRevision:(revision:number)=>void,onHeartbeat:()=>void,reminders:boolean) {
  const response = await fetch('/api/workspace/events'+(reminders?'?scope=reminders':''),{headers:{Authorization:'Bearer '+token},cache:'no-store',signal})
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Record updates unavailable')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ''
  try {
    while (!signal.aborted) {
      const {done,value} = await reader.read()
      if (done || signal.aborted) break
      const lines = (pending+value).split('\n')
      pending = lines.pop() ?? ''
      if (pending.length>4096) throw new Error('Invalid record update')
      for (const line of lines) {
        const revision = line.match(/^data: (\d+)\s*$/)
        if (revision) {
          onHeartbeat()
          onRevision(Number(revision[1]))
        } else if (line.startsWith(':')) {
          onHeartbeat()
        }
      }
    }
  } finally {
    await reader.cancel().catch(()=>{})
    reader.releaseLock()
  }
}

export function subscribeRecordRevisions(token:string,onRevision:(revision:number)=>void,onStatus:(status:RecordStreamStatus)=>void,reminders=false) {
  let closed = false
  let current:AbortController|undefined
  let retry:number|undefined
  let delay = 1500

  async function connect() {
    current = new AbortController()
    const connection = current
    let deadline = window.setTimeout(()=>connection.abort(),12_000)
    try {
      await readRevisions(token,connection.signal,onRevision,()=>{
        window.clearTimeout(deadline)
        deadline = window.setTimeout(()=>connection.abort(),22_000)
        delay = 1500
        onStatus('live')
      },reminders)
    } catch { /* Periodic reads keep the view current during a stream interruption. */ }
    finally {window.clearTimeout(deadline)}
    if (closed) return
    onStatus('polling')
    retry = window.setTimeout(()=>void connect(),delay)
    delay = Math.min(delay*2,30_000)
  }

  onStatus('connecting')
  void connect()
  return ()=>{
    closed = true
    current?.abort()
    window.clearTimeout(retry)
  }
}
