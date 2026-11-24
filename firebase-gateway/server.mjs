import { createServer } from 'node:http';
import { request } from 'node:https';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

function forwardedHeaders(headers) {
  const extra = String(headers.connection || '').split(',').map(value => value.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !hopHeaders.has(name) && !extra.includes(name)));
}

export function createGateway(configuredOrigin) {
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('WASLAH_ORIGIN must be the HTTPS origin of the persistent Waslah server.');
  }
  return createServer((req, res) => {
    let target;
    try {
      target = new URL(req.url, origin);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.origin !== origin.origin) {
      res.writeHead(400).end();
      return;
    }
    const upstream = request(target, {
      method: req.method,
      headers: forwardedHeaders(req.headers),
      timeout: 55000,
    }, reply => {
      res.writeHead(reply.statusCode || 502, forwardedHeaders(reply.headers));
      reply.on('error', error => res.destroy(error));
      reply.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Origin timeout')));
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502, { 'Cache-Control': 'no-store' }).end('Waslah origin is unavailable.');
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 8080);
  createGateway(process.env.WASLAH_ORIGIN).listen(port, '0.0.0.0');
}
