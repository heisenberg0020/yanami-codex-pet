import http from 'node:http';
import * as fs from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore, DEFAULT_DATA_FILE } from './store.mjs';
import { catalog } from './catalog.mjs';
import { codexView } from './codex.mjs';
import { createCodexIngestor } from './codex-ingest.mjs';

export const SERVICE_ID = 'yanami-snack-club-v1';
export const DEFAULT_PORT = 17653;
export const DEFAULT_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const BODY_LIMIT = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function requestError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function headers(res) {
  res.setHeader('X-Yanami-Service', SERVICE_ID);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function json(res, status, value, head = false) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length });
  res.end(head ? undefined : body);
}

function checkHost(req, server) {
  const host = req.headers.host;
  const port = server.address()?.port;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    throw requestError('INVALID_HOST', '请求的本地服务地址不匹配。', 421);
  }
  return host;
}

function checkWriteOrigin(req, host) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) {
    throw requestError('CROSS_SITE_REQUEST', '请在本地小卡片中执行此操作。', 403);
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    throw requestError('CROSS_SITE_REQUEST', '请在本地小卡片中执行此操作。', 403);
  }
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw requestError('JSON_REQUIRED', '请求必须使用 JSON。', 415);
  }
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        if (!rejected) reject(requestError('BODY_TOO_LARGE', '请求内容过大。', 413));
        rejected = true;
        chunks.length = 0;
      } else if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(requestError('INVALID_JSON', '请求内容不是有效的 JSON。')); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(requestError('REQUEST_ABORTED', '请求已中断。')));
  });
}

function inside(root, file) {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function serveStatic(req, res, pathname, distDir) {
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
    throw requestError('INVALID_PATH', '无法访问此路径。', 400);
  }
  const root = await fs.realpath(distDir).catch(() => null);
  if (!root) throw requestError('UI_NOT_BUILT', '小卡片页面尚未构建，请先完成网页构建。', 503);
  let file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!inside(root, file)) throw requestError('INVALID_PATH', '无法访问此路径。', 400);
  let real = await fs.realpath(file).catch(() => null);
  if (!real && !extname(pathname)) real = await fs.realpath(resolve(root, 'index.html')).catch(() => null);
  if (!real || !inside(root, real)) throw requestError('NOT_FOUND', '没有找到此页面。', 404);
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw requestError('NOT_FOUND', '没有找到此页面。', 404);
  const body = await fs.readFile(real);
  res.writeHead(200, { 'Content-Type': MIME[extname(real)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Creates a server without listening. startServer is the loopback-only launcher. */
export async function createServer({ store, dataFile = DEFAULT_DATA_FILE, distDir = DEFAULT_DIST_DIR, now = Date.now, bodyLimit = BODY_LIMIT, codexSpoolDir } = {}) {
  store ??= await createStore({ dataFile, now });
  const ingestor = createCodexIngestor({ store, spoolDir: codexSpoolDir ?? resolve(dirname(store.dataFile || dataFile), 'codex-events'), now });
  const summary = (state, at) => ({ ...codexView(state.codex, state.receipts, at, ingestor.installed), ...(ingestor.notice ? { notice: ingestor.notice } : {}) });
  const server = http.createServer(async (req, res) => {
    headers(res);
    let isAction = false;
    try {
      const host = checkHost(req, server);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw requestError('INVALID_PATH', '无法访问此路径。');
      let pathname;
      try { pathname = decodeURIComponent(req.url.split('?')[0]); }
      catch { throw requestError('INVALID_PATH', '无法访问此路径。'); }
      if (pathname === '/api/state' && (req.method === 'GET' || req.method === 'HEAD')) {
        await ingestor.drain();
        const at = now();
        const state = await store.read(at);
        return json(res, 200, { state, codex: summary(state, at), catalog, now: at, ...(store.recoveryNotice ? { recoveryNotice: store.recoveryNotice } : {}) }, req.method === 'HEAD');
      }
      if (pathname === '/api/actions' && req.method === 'POST') {
        checkWriteOrigin(req, host);
        isAction = true;
        const action = await readBody(req, bodyLimit);
        await ingestor.drain();
        const at = now();
        const result = await store.dispatch(action, at);
        return json(res, 200, { ...result, codex: summary(result.state, at), catalog, now: at, ...(store.recoveryNotice ? { recoveryNotice: store.recoveryNotice } : {}) });
      }
      if (pathname.startsWith('/api/')) {
        throw requestError('METHOD_NOT_ALLOWED', '此接口不支持当前请求。', 405);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw requestError('METHOD_NOT_ALLOWED', '此页面不支持当前请求。', 405);
      await serveStatic(req, res, pathname, distDir);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      const value = { error: { code: error.code && error.status ? error.code : 'INTERNAL_ERROR', message: error.status ? error.message : '本地服务暂时遇到问题，请稍后重试。' } };
      // Invalid origins and Hosts never receive private state in their error body.
      if (isAction) {
        try { value.state = await store.read(now()); } catch { /* Keep the original error. */ }
      }
      if (status === 413) res.setHeader('Connection', 'close');
      json(res, status, value, req.method === 'HEAD');
    }
  });
  const inboxTimer = setInterval(() => ingestor.drain(), 2000);
  inboxTimer.unref();
  server.once('close', () => clearInterval(inboxTimer));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export async function startServer({ port = DEFAULT_PORT, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('YANAMI_PORT 必须是 0–65535 的整数。');
  const server = await createServer(options);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const server = await startServer({
      port: process.env.YANAMI_PORT === undefined ? DEFAULT_PORT : Number(process.env.YANAMI_PORT),
      dataFile: process.env.YANAMI_DATA_FILE || DEFAULT_DATA_FILE,
      distDir: process.env.YANAMI_DIST_DIR || DEFAULT_DIST_DIR,
      ...(process.env.YANAMI_CODEX_SPOOL ? { codexSpoolDir: process.env.YANAMI_CODEX_SPOOL } : {}),
    });
    console.log(`Yanami Snack Club: http://127.0.0.1:${server.address().port}`);
    const stop = () => server.close(() => { process.exitCode = 0; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? '本地端口已被占用，请检查已有服务或更换 YANAMI_PORT。' : error.message);
    process.exitCode = 1;
  }
}
