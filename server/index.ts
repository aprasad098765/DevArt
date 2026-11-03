import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { buildApi } from './api.ts';
import { hostAllowed, isLoopbackHost, originAllowed, remoteAllowed } from './access.ts';
import { one } from './db.ts';
import { attachConnection, flushAll } from './live.ts';
import { handleMcpHttp } from '../mcp/http.ts';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';

if (!isLoopbackHost(HOST) && !remoteAllowed()) {
  console.error(`DevArt has no login, so anyone who can reach it can read and change every file. Refusing to listen on ${HOST}.\nTo do this anyway, put your own authentication in front of it and set DEVART_ALLOW_REMOTE=1.`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use((req, res, next) => {
  if (hostAllowed(req.headers.host)) return next();
  res.status(403).type('text').send('DevArt only accepts requests addressed to this machine.');
});
app.use('/api/v1', buildApi());
app.all('/mcp', express.json({ limit: '10mb' }), (req, res) => handleMcpHttp(req, res, `http://127.0.0.1:${PORT}/api/v1`));

const dist = path.resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/mcp|\/collab).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const reject = (code: string) => { socket.write(`HTTP/1.1 ${code}\r\n\r\n`); socket.destroy(); };
  const url = new URL(req.url ?? '/', 'http://x');
  const m = /^\/collab\/([\w-]+)$/.exec(url.pathname);
  if (!m) return reject('404 Not Found');
  // Browsers don't apply same-origin rules to WebSockets, so the server has to.
  if (!hostAllowed(req.headers.host) || !originAllowed(req.headers.origin, req.headers.host)) return reject('403 Forbidden');
  const file = one('SELECT id, deleted_at FROM files WHERE id = ?', m[1]);
  if (!file || file.deleted_at) return reject('404 Not Found');
  wss.handleUpgrade(req, socket, head, (ws) => attachConnection(file.id as string, ws));
});

server.listen(PORT, HOST, () => console.log(`DevArt listening on http://${HOST}:${PORT}`));

const shutdown = () => { flushAll(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
