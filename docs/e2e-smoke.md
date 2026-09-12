# Smoke E2E — OpenHer Chat

Checklist manual para cerrar el MVP (T16). Combina verificación automatizada (abajo) con una pasada manual sobre web y Android.

## Preparación

```sh
pnpm install
pnpm exec tsc -b
pnpm test
pnpm build
pnpm preview          # web: http://localhost:4173 (PWA)
```

Para Android (requiere Android Studio + JDK 21 + SDK para compilar el APK):

```sh
pnpm android:sync
pnpm android:open
```

## Checklist manual

### 1. Crear chat

- [ ] Desde la pantalla vacía, elegir una sugerencia o escribir un mensaje y enviarlo con Enter.
- Esperado: se crea la conversación, la URL pasa a `#/chat/<id>`, el mensaje aparece al instante y la barra lateral muestra título y preview sin recargar.
- Resultado: pendiente de ejecución manual (cobertura automatizada: `src/features/chat/ChatPage.test.tsx`, `src/features/chat/state/chatStore.test.ts`).

### 2. Configurar Groq key

- [ ] Ajustes → Proveedores → Agregar proveedor → plantilla Groq → pegar API key → Guardar key.
- Esperado: badge "Guardada"; la key no aparece en `localStorage` (`openher.providers.v1`) ni en la configuración serializada.
- Resultado: pendiente de ejecución manual (cobertura automatizada: `src/features/settings/SettingsPage.test.tsx`, `src/features/settings/state/settingsStore.test.ts`).

### 3. Streaming visible

- [ ] Enviar un mensaje con un proveedor real y observar la respuesta.
- Esperado: el texto aparece incrementalmente, el indicador de streaming permanece visible y el scroll sigue el fondo.
- Resultado: pendiente de ejecución manual (requiere API key real).

### 4. Stop

- [ ] A mitad de una respuesta, pulsar Detener.
- Esperado: se conserva el texto parcial, el mensaje queda sellado como `aborted` y no quedan requests ni timers vivos.
- Nota: tras enviar, el botón Detener queda deshabilitado ~400 ms para que el segundo click de un doble click sobre Enviar no cancele el turno.
- Resultado: pendiente de ejecución manual (cobertura automatizada: `src/features/chat/components/Composer.test.tsx`, `src/features/chat/state/chatStore.test.ts`).

### 5. Recargar persiste

- [ ] Recargar la pestaña (F5) con una conversación abierta.
- Esperado: título, mensajes, preview y contador de la conversación se restauran desde IndexedDB; tema e idioma se mantienen.
- Resultado: pendiente de ejecución manual.

### 6. Tema

- [ ] Alternar claro / oscuro / sistema desde la barra superior o Ajustes → Apariencia.
- Esperado: el tema cambia sin recargar; en Chrome cambia también el `theme-color`; contraste AA en ambos modos.
- Resultado: pendiente de ejecución manual.

### 7. Idioma

- [ ] Cambiar entre Español e English en Ajustes → Apariencia.
- Esperado: toda la interfaz cambia de idioma sin recargar; no quedan claves crudas visibles.
- Resultado: pendiente de ejecución manual (paridad es/en cubierta por `src/i18n/i18n.test.ts`).

### 8. Investigación con key/proxy

- [ ] Habilitar Búsqueda web, configurar Brave/Tavily (con key) o proxy personalizado, y activar el toggle de Investigación en el chat.
- [ ] Preguntar algo que requiera datos actuales (p. ej. "¿qué se anunció hoy en…?").
- Esperado: aparecen pasos en vivo, `web_search`/`open_url` colapsables, fuentes deduplicadas en el panel y el medidor de presupuesto avanza; sin avisos de configuración.
- Resultado: pendiente de ejecución manual (requiere key/proxy reales).

### 9. Degradación sin proxy

- [ ] En navegador, sin proxy y sin keys, intentar una búsqueda (modo DuckDuckGo) y revisar el aviso del toggle.
- [ ] Configurar `proxy.mode = custom` con URL vacía y ejecutar la tool; repetir con una URL inválida (p. ej. `ftp://proxy.test`).
- Esperado: aviso accionable en el toggle; las tools devuelven `missing_proxy`/`invalid_proxy` sin caer silenciosamente a DuckDuckGo/directo y sin tocar la red.
- Resultado: pendiente de ejecución manual (cobertura automatizada: `src/adapters/tools/index.test.ts`, `src/adapters/tools/webSearch/index.test.ts`, `src/features/research/selectors.test.ts`).

### 10. Android `cap sync`

- [x] `pnpm build` y `pnpm android:sync` desde la raíz del repo.
- Esperado: `cap sync` copia `dist/` a `android/app/src/main/assets/public` (incluye `manifest.webmanifest`, `sw.js` e `icons/icon.svg`) y genera `capacitor.config.json` con `appId: app.openher.chat`.
- Resultado: PASÓ — ver evidencia abajo; la compilación del APK queda fuera de alcance (requiere SDK/JDK).
- [ ] Opcional: `pnpm android:open` + Run en un emulador (requiere Android Studio + JDK 21 + SDK).

### 11. PWA (extra)

- [ ] `pnpm preview` en producción: verificar en DevTools que el manifest carga, que el service worker se registra (solo web, nunca dentro de Capacitor) y que la navegación usa network-first con fallback offline del shell.
- Resultado: pendiente de ejecución manual.

## Resultados de la corrida automatizada (2026-09-11)

| Verificación | Comando | Resultado |
| --- | --- | --- |
| Type-check | `pnpm exec tsc -b` | PASS — exit 0, sin errores |
| Suite completa | `pnpm test` | PASS — 76 archivos / 718 tests, 0 fallos |
| Build | `pnpm build` | PASS — exit 0 |
| Capacitor sync | `npx cap sync android` | PASS — `Sync finished`, assets copiados |

### Tamaños de build (code-split de rutas)

| Chunk | Antes | Después |
| --- | --- | --- |
| `index` (inicial) | 731.88 kB (gzip 225.22) | 695.64 kB (gzip 218.46) |
| `SettingsPage` | — | 22.79 kB (gzip 5.62) |
| `OnboardingPage` | — | 12.23 kB (gzip 3.59) |
| `ProviderForm` (compartido) | — | 6.98 kB (gzip 2.37) |
| CSS | 29.38 kB | 29.49 kB |

El chunk inicial baja al diferir Ajustes y Onboarding. El aviso de Vite `>500 kB` sigue apareciendo porque `react-markdown` + `remark-gfm` + `highlight.js` viven en el chunk inicial; un chunk manual para markdown/highlight queda como optimización opcional futura (fuera del alcance de T16).
