// Utilidades HTTP mínimas: respuestas JSON, errores y servidor de archivos estáticos.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function send(req, res, status, body, contentType, extraHeaders = {}) {
  const headers = { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', ...extraHeaders };
  let payload = typeof body === 'string' ? Buffer.from(body) : body;
  if (payload.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    payload = zlib.gzipSync(payload);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  headers['Content-Length'] = payload.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

export function sendJson(req, res, status, data) {
  send(req, res, status, JSON.stringify(data), MIME['.json'], { 'Cache-Control': 'no-store' });
}

export function sendError(req, res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error('[api]', err);
  sendJson(req, res, status, { error: err.message || 'Error interno', ...(err.details ? { detalles: err.details } : {}) });
}

// Sirve archivos de `rootDir` impidiendo salir de esa carpeta (path traversal).
export function serveStatic(req, res, rootDir, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    throw new HttpError(400, 'Ruta inválida');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(rootDir, '.' + rel);
  if (file !== rootDir && !file.startsWith(rootDir + path.sep)) throw new HttpError(403, 'Acceso denegado');

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new HttpError(404, 'No encontrado');
  }
  if (stat.isDirectory()) {
    res.writeHead(301, { Location: urlPath.replace(/\/?$/, '/') });
    return res.end();
  }

  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  const isVendor = rel.startsWith('/vendor/');
  const headers = {
    ETag: etag,
    // Librerías de terceros versionadas: caché larga. Código propio: revalidar siempre (ETag).
    'Cache-Control': isVendor ? 'public, max-age=604800' : 'no-cache',
  };
  const body = fs.readFileSync(file);
  if (COMPRESSIBLE.has(ext)) return send(req, res, 200, body, MIME[ext], headers);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}
