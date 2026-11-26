import type { Response } from 'express'

export function revisionStream(readRevision: () => Promise<number | undefined>) {
  const viewers = new Map<Response,number>()
  let reading = false

  function send(response: Response, revision: number) {
    if (response.destroyed || response.writableEnded) return
    if (revision <= (viewers.get(response) ?? -1)) return
    viewers.set(response,revision)
    if (!response.write(`data: ${revision}\n\n`)) response.end()
  }

  function publish(revision: number) {
    for (const response of viewers.keys()) send(response,revision)
  }

  function close() {
    for (const response of viewers.keys()) response.end()
  }

  // A shared revision-only query also observes writes from another server process.
  const poll = setInterval(async () => {
    if (!viewers.size || reading) return
    reading = true
    try {
      const revision = await readRevision()
      if (revision !== undefined) publish(revision)
    } catch { close() }
    finally { reading = false }
  },2500)
  poll.unref()

  return {
    publish,
    connect(response: Response, revision: number) {
      if (viewers.size>=40) {response.status(503).end();return}
      response.status(200).set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-store, no-transform', 'X-Accel-Buffering':'no' })
      response.flushHeaders()
      const heartbeat = setInterval(()=>{if (!response.write(': heartbeat\n\n')) response.end()},10000)
      // Reconnect periodically so the server revalidates the account and role.
      const expiry = setTimeout(()=>response.end(),50000)
      response.once('close',()=>{
        viewers.delete(response)
        clearInterval(heartbeat)
        clearTimeout(expiry)
      })
      send(response,revision)
    },
    stop() { clearInterval(poll);close() },
  }
}
