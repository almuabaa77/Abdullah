export async function watchRecordRevisions(token: string, signal: AbortSignal, onRevision: (revision:number) => void, onMessage: () => void) {
  const response = await fetch('/api/workspace/events',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal})
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Record updates unavailable')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ''
  try {
    while (!signal.aborted) {
      const {done,value} = await reader.read()
      if (done) break
      onMessage()
      const lines = (pending+value).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const match = line.match(/^data: (\d+)\s*$/)
        if (match) onRevision(Number(match[1]))
      }
    }
  } finally {
    await reader.cancel().catch(()=>{})
    reader.releaseLock()
  }
}
