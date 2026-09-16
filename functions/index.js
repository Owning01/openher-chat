/**
 * Proxy same-origin `GET|POST /zen/**` → `https://opencode.ai/**`.
 *
 * El gateway de OpenCode no emite cabeceras CORS y la web de producción no
 * tiene el proxy de Vite (solo dev) ni `CapacitorHttp` (solo Android): sin
 * esto el navegador bloquea la app web. La función reenvía método, headers
 * de auth/contenido y cuerpo, y devuelve el stream tal cual (SSE incluido)
 * agregando `Access-Control-Allow-Origin: *`.
 *
 * Sin secretos propios: la API key del usuario viaja en el header
 * `Authorization` de su propia petición y solo se reenvía al upstream.
 */

const { onRequest } = require('firebase-functions/v2/https');

const UPSTREAM_ORIGIN = 'https://opencode.ai';
const MOUNT_PREFIX = '/zen';

/** Headers que nunca se reenvían (conexión o identidad del proxy). */
const HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'expect',
]);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '3600',
  };
}

/**
 * Valida el prefijo de montaje (`/zen`) y devuelve la ruta completa: el
 * prefijo es parte del path del upstream (`/zen/go/v1/...`), no se recorta.
 */
function upstreamPath(path) {
  if (path === MOUNT_PREFIX || path.startsWith(`${MOUNT_PREFIX}/`)) return path;
  return null;
}

/**
 * Cuerpo de la petición: el framework suele traerlo ya parseado en
 * `req.body` (y el stream queda consumido: leerlo colgaría); solo se lee
 * el stream como respaldo.
 */
function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body));
    return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

exports.zen = onRequest(
  { region: 'southamerica-east1', timeoutSeconds: 300, memoryMiB: 256 },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, corsHeaders());
      res.end();
      return;
    }
    const suffix = upstreamPath(req.path);
    if (suffix === null) {
      res.writeHead(404, corsHeaders());
      res.end();
      return;
    }

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (HOP_HEADERS.has(name.toLowerCase())) continue;
      if (value !== undefined) headers[name] = value;
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, corsHeaders());
      res.end();
      return;
    }

    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM_ORIGIN}${suffix}`, {
        method: req.method,
        headers,
        body: req.method === 'POST' ? body : undefined,
      });
    } catch {
      res.writeHead(502, corsHeaders());
      res.end();
      return;
    }

    const outHeaders = { ...corsHeaders() };
    const contentType = upstream.headers.get('content-type');
    if (contentType !== null) outHeaders['Content-Type'] = contentType;
    res.writeHead(upstream.status, outHeaders);
    if (upstream.body === null) {
      res.end();
      return;
    }
    try {
      for await (const chunk of upstream.body) res.write(chunk);
    } catch {
      // Cliente desconectado a mitad del stream: nada que hacer.
    }
    res.end();
  },
);
