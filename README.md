# OpenHer Chat

Cliente de chat multi-proveedor con modo investigación. Corre 100% local en el dispositivo (sin backend): las conversaciones viven en IndexedDB y las API keys en un vault local; solo se envía tráfico al proveedor de modelos y a las herramientas web que el usuario configure.

- Proveedores OpenAI-compatible, Anthropic y OpenAI Responses, con streaming SSE y tool calling.
- OpenCode Zen y Go: un solo proveedor por gateway que descubre todos sus modelos y enruta cada uno al endpoint correcto (`chat/completions`, `messages` o `responses`).
- Descubrimiento automático de modelos al conectar un proveedor (sin tipear modelo por modelo) e importación opcional del catálogo de un `opencode serve` local.
- Agente con presupuestos (pasos, tools, tokens, tiempo), reintentos y modo investigación.
- Herramientas web `web_search` (Brave / Tavily / DuckDuckGo, con fallback) y `open_url` con política anti-SSRF.
- Modo legal (MVP, Argentina civil y comercial): corpus normativo local verificable por hash, expediente por conversación, análisis adversarial y estudio de documentos con marcas de verificación (ver abajo).
- Ajustes de tema, idioma, proxy de búsqueda y presupuestos; wizard de onboarding.
- Packaging web (PWA instalable) y Android vía Capacitor.

## Stack

React 19 + TypeScript estricto + Vite + Tailwind CSS 4 + Zustand + React Markdown (GFM + highlight.js) + Capacitor 8 (Android). Tests con Vitest + Testing Library y `fake-indexeddb`. Gestor de paquetes: pnpm.

## Comandos

```sh
pnpm install

pnpm dev              # Vite dev server con HMR
pnpm test             # Vitest (run)
pnpm exec tsc -b      # type-check oficial del workspace
pnpm build            # type-check + build de producción a dist/
pnpm preview          # sirve dist/ localmente (PWA)

pnpm android:sync     # cap sync android (copia dist/ al proyecto nativo)
pnpm android:open     # cap open android (requiere Android Studio + JDK 21)
```

Checklist de smoke manual: `docs/e2e-smoke.md`. Setup detallado: `docs/dev-setup.md`. Contrato del proxy de búsqueda: `docs/search-proxy.md`. Estándar de proveedores y OpenCode: `docs/provider-standard.md`.

## Arquitectura

```text
src/
  app/          # shell, routing hash, bootstrap y AppServices (inyección)
  domain/       # contratos (types/ports) y lógica pura: chat, agent, providers, settings
  adapters/     # implementaciones: http, providers (openai-compatible/anthropic), storage, tools web
  features/     # UI + stores por dominio: chat, conversations, settings, onboarding, research
  shared/       # UI kit accesible, iconos, hooks, markdown y utilidades
  i18n/         # diccionarios es/en con paridad en compile-time
public/         # manifest PWA, icono propio y service worker
android/        # proyecto Capacitor (Gradle), generado con `cap add android`
docs/           # setup, contrato del proxy, smoke E2E y packs legales
```

Flujo de una conversación: `ChatPage` crea el `chatStore` → `send` persiste el mensaje de usuario y ejecuta `runAgent` → `runAgent` consume el `ProviderAdapter` (SSE) y, en modo investigación, el `ToolRegistry` → cada evento (`text-delta`, `tool-start/end`, `run-end`) actualiza bloques, pasos y la lista de conversaciones sin recargar.

Flujo de herramientas web: el toggle de investigación solo se activa si `settings.tools.webSearchEnabled` y el modelo/adapter soportan tools. `createToolRegistry` arma `web_search` y `open_url`; `web_search` usa Brave → Tavily → DuckDuckGo (o el proxy personalizado, con error accionable si la URL del proxy es inválida) y `open_url` valida cada URL contra la política anti-SSRF antes de leerla. Los resultados se normalizan a `SourceRef` deduplicadas y quedan visibles en el panel de investigación.

## Modo legal (MVP)

Asistente de redacción para escritos civiles y comerciales argentinos con corpus normativo local (3 packs nacionales, 12 artículos) verificado por hash SHA-256 y 100% en el dispositivo. Cada conversación se vincula a un expediente (`#/legal`); el turno legal compone búsqueda normativa con guard de citas (lo no textual va `[VERIFICAR]`) y exige consentimiento antes de exportar. Estado: núcleo MVP nacional; sin jurisprudencia ni todas las provincias. Documentación: `docs/legal-packs.md` (curación, licencia, hash, fases y límites) y `public/legal/README.md` (contenido y gap report). El texto del corpus es referencial; el auténtico es el Boletín Oficial.

## Seguridad y privacidad

- Las API keys se guardan en el vault local (`localStorage`, sin telemetría) y nunca se serializan en la configuración.
- `open_url` bloquea esquemas peligrosos, IPs privadas/loopback y redirects en modo directo.
- El proxy de búsqueda es opcional y su contrato está documentado en `docs/search-proxy.md`.

## Licencia y marcas

Sin licencia publicada: repositorio privado, todos los derechos reservados. OpenHer Chat no está afiliado ni patrocinado por OpenAI, Anthropic, Brave, Tavily, DuckDuckGo, Groq ni Google; todas las marcas pertenecen a sus titulares y se mencionan solo para describir compatibilidad.
