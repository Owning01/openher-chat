# Search Proxy — contrato y ejemplo mínimo

Proxy **opcional** para las tools web (`web_search`, `open_url`). Sirve para dos cosas:

1. **Evitar CORS**: en navegador/desktop web, Brave/Tavily/DuckDuckGo HTML pueden bloquear requests directos. El cliente lo reporta como `cors_blocked` con mensaje accionable.
2. **Fetch de páginas sin CORS**: `open_url` puede delegar la descarga (y la validación SSRF) en el proxy.

En Android nativo (Capacitor) las requests directas funcionan y el proxy no hace falta.
Se configura en la app con `ProxySettings`: `{ mode: 'custom', baseUrl: 'https://openher-proxy.<cuenta>.workers.dev' }`.

> **Exa no usa el proxy.** `web_search` incluye un proveedor **Exa** (MCP keyless,
> `https://mcp.exa.ai/mcp`) que emite `Access-Control-Allow-Origin: *` y responde el
> preflight `OPTIONS` (204), así que funciona **directo desde el navegador** y va siempre
> directo aunque haya proxy. Por eso el contrato de este documento cubre solo
> `brave`/`tavily`/`duckduckgo`.
>
> **`open_url` en navegador sin proxy.** Los sitios web no emiten CORS, así que el fetch
> directo falla; `open_url` reintenta con un lector público con CORS
> (`GET https://r.jina.ai/<url>`) que descarga la página server-side y devuelve markdown.
> Con proxy configurado se usa su `/v1/fetch` y el lector **no** se consulta.

## Superficie HTTP

### `POST {baseUrl}/v1/search`

Headers:

| Header | Valor |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Api-Key` | API key del proveedor seleccionado (solo para `brave`/`tavily`; DDG no usa key) |
| `Accept` | `application/json` |

Body:

```json
{ "provider": "brave", "query": "rust 2026", "count": 5, "freshness": "week" }
```

- `provider`: `"brave" | "tavily" | "duckduckgo"` (Exa no pasa por el proxy).
- `count`: entero 1–10.
- `freshness`: `"any" | "day" | "week" | "month" | "year"`.

Respuesta 200:

```json
{
  "provider": "brave",
  "results": [
    { "url": "https://example.com/a", "title": "Título", "snippet": "Texto breve…" }
  ]
}
```

Errores: status 4xx/5xx con `{ "error": "motivo" }`.
El cliente traduce `401/403` a `no_provider` (key inválida) y el resto a `http_error`.

Mapeo por proveedor dentro del proxy:

| Proveedor | Request upstream | Freshness |
| --- | --- | --- |
| `brave` | GET `https://api.search.brave.com/res/v1/web/search?q&count` + `X-Subscription-Token` | `pd/pw/pm/py` |
| `tavily` | POST `https://api.tavily.com/search` `{query,max_results,topic,days}` + `Authorization: Bearer` | `topic=news` + `days` 1/7/30/365 |
| `duckduckgo` | GET `https://html.duckduckgo.com/html/?q=` y parseo HTML best-effort | no aplica |

### `POST {baseUrl}/v1/fetch`

Body: `{ "url": "https://example.com/articulo" }`

Respuesta 200:

```json
{ "title": "Título", "text": "Texto principal…", "contentType": "text/html; charset=utf-8", "truncated": false }
```

Errores esperados: `400` URL inválida/bloqueada o redirect a destino bloqueado, `413` página > 2 MB, `502` upstream caído o más de 5 redirects.
El cliente capa el texto a 8000 caracteres localmente.

### Política de redirects (SSRF)

Un redirect es un vector SSRF clásico: un `302` desde un host público puede apuntar a
`127.0.0.1`, `169.254.169.254` o rangos privados. La política difiere según el camino:

| Camino | Comportamiento |
| --- | --- |
| `open_url` directo (sin proxy) | **Nunca sigue redirects**: pide `redirect: 'manual'` y cualquier `3xx` (o respuesta opaca, status `0`) se convierte en `blocked_url` accionable que sugiere configurar el proxy. |
| Plataforma sin control de redirects (Capacitor nativo) | `open_url` **exige proxy**: el plugin nativo sigue redirects internamente y no permite desactivarlo, así que sin proxy devuelve `blocked_url` accionable. |
| `POST /v1/fetch` (proxy) | Sigue hasta **5** saltos (`MAX_REDIRECTS`), revalidando **cada** `Location` contra la misma política (esquema, credenciales y rangos privados) antes de pedir el siguiente recurso. Un destino bloqueado o el sexto salto → error. |

En el cliente, `HttpClient` expone `supportsRedirectControl`: `FetchHttpClient` lo declara
`true` (propaga `HttpRequest.redirect` a `fetch`) y `CapacitorHttpClient` lo declara `false`.
`open_url` directo siempre pide `redirect: 'manual'` y bloquea la respuesta si el transporte
declara que no puede controlar redirects.

## Política de secretos (obligatoria)

- **Nunca loguear `X-Api-Key`** ni `Authorization`: no incluir headers en `console.log`, trazas, analytics ni mensajes de error.
- No persistir la key: se usa en memoria solo para el request upstream y se descarta.
- No devolver la key en la respuesta ni en el cuerpo de errores.
- Servir solo por HTTPS (Cloudflare Workers lo hace por defecto).
- Recomendado: proteger el Worker con Cloudflare Access o una ruta secreta, porque `/v1/fetch` es un servicio de fetch server-side.
- `/v1/fetch` **debe** aplicar la misma política de URLs que `urlPolicy.ts`: solo `http`/`https`, sin credenciales embebidas, sin `localhost`/`127.0.0.0/8`/`10/8`/`172.16/12`/`192.168/16`/`169.254/16`/`::1`/`fe80::/10`, timeout 15 s y tope 2 MB, revalidando redirects (máx 5).

## Ejemplo mínimo: Cloudflare Worker

Snippet autocontenido (sin dependencias del repo; pegar como `worker.js` y `wrangler deploy`):

```js
const FRESHNESS_BRAVE = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };
const FRESHNESS_TAVILY = { day: 1, week: 7, month: 30, year: 365 };
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (pathname === '/v1/search') return handleSearch(request);
    if (pathname === '/v1/fetch') return handleFetch(request);
    return json({ error: 'not_found' }, 404);
  },
};

async function handleSearch(request) {
  const body = await request.json();
  const apiKey = request.headers.get('X-Api-Key') || '';
  const query = String(body.query || '').slice(0, 400);
  const count = Math.min(Math.max(Number(body.count) || 5, 1), 10);
  if (!query) return json({ error: 'missing_query' }, 400);

  if (body.provider === 'brave') {
    if (!apiKey) return json({ error: 'missing_key' }, 401);
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    const freshness = FRESHNESS_BRAVE[body.freshness];
    if (freshness) url.searchParams.set('freshness', freshness);
    const upstream = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } });
    if (!upstream.ok) return json({ error: 'provider_status' }, upstream.status === 401 || upstream.status === 403 ? 401 : 502);
    const data = await upstream.json();
    return json({
      provider: 'brave',
      results: (data.web?.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.description })),
    });
  }

  if (body.provider === 'tavily') {
    if (!apiKey) return json({ error: 'missing_key' }, 401);
    const days = FRESHNESS_TAVILY[body.freshness];
    const upstream = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: count, topic: days ? 'news' : 'general', ...(days ? { days } : {}) }),
    });
    if (!upstream.ok) return json({ error: 'provider_status' }, upstream.status === 401 || upstream.status === 403 ? 401 : 502);
    const data = await upstream.json();
    return json({
      provider: 'tavily',
      results: (data.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.content })),
    });
  }

  if (body.provider === 'duckduckgo') {
    const page = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'text/html' },
    });
    if (!page.ok) return json({ error: 'provider_status' }, 502);
    return json({ provider: 'duckduckgo', results: parseDuckDuckGo(await page.text()).slice(0, count) });
  }

  return json({ error: 'unknown_provider' }, 400);
}

async function handleFetch(request) {
  const { url } = await request.json();
  if (!isPublicHttpUrl(url)) return json({ error: 'blocked_url' }, 400);
  const upstream = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (!upstream.ok) return json({ error: 'fetch_failed' }, 502);
  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413);
  const html = new TextDecoder().decode(buffer);
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
  return json({ title, text, contentType: upstream.headers.get('content-type') || '', truncated: text.length >= 8000 });
}

function isPublicHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === '::1' || /^fe[89ab][0-9a-f]:/i.test(host)) return false;
  return true;
}

function parseDuckDuckGo(html) {
  const results = [];
  const regex = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let href = match[1].replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = `https:${href}`;
    try {
      const link = new URL(href, 'https://duckduckgo.com');
      const target = link.hostname.endsWith('duckduckgo.com') ? link.searchParams.get('uddg') : link.toString();
      if (target) results.push({ url: target, title: match[2].replace(/<[^>]*>/g, '').trim() });
    } catch {
      /* ignora links malformados */
    }
  }
  return results;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
```

> El snippet prioriza claridad. Para producción es obligatorio: streaming con tope duro de bytes, lista completa de rangos privados (incluida `64:ff9b::/96`) y revalidación manual de redirects (`redirect: 'manual'` + `MAX_REDIRECTS = 5`) validando cada `Location`.

## Comportamiento del cliente

| Situación | Resultado |
| --- | --- |
| Sin proxy, red bloqueada en navegador | `cors_blocked` con mensaje que sugiere configurar el proxy |
| Sin proxy, `web_search` en Android nativo | request directa |
| Sin proxy, `web_search` en navegador (modo `auto`/`exa`) | **Exa MCP responde 200 directo sin key** (CORS `*`); no requiere proxy |
| Sin proxy, `open_url` en navegador con CORS bloqueado | Reintenta con lector público con CORS (`r.jina.ai`); si también falla → `cors_blocked` |
| Sin proxy, `open_url` con redirect (`3xx`/opaco) | `blocked_url`: nunca se siguen redirects en modo directo (el lector sí puede resolver la página) |
| Sin proxy, `open_url` en Android nativo | `blocked_url`: el transporte no puede verificar redirects, exige proxy |
| Proxy configurado, proveedor ok | `SourceRef[]` deduplicados, `provider` informado |
| Proxy caído | `network`/`cors_blocked` con mensaje sobre el proxy |
| `X-Api-Key` rechazada (401/403) | `no_provider`: revisar key en Settings |
