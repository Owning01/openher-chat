# teamwork_brief.md — OpenHer Chat

> Propuesta Fase 1 (Entrevista de Alcance). **El swarm no arranca hasta la confirmación única del usuario.**

## 1. Objetivo & Audiencia

- **Producto:** OpenHer Chat — cliente de chat personal (single-user) con estética inspirada en ChatGPT/Gemini, para **Android y desktop**.
- **Audiencia:** el dueño (uso personal). Sin distribución pública inicial, sin multiusuario, sin telemetría.
- **Uso principal:** conversar con **cualquier proveedor LLM configurado por API key** (Groq, Cerebras, OpenAI-compatible, DeepSeek, Ollama/LM Studio/vLLM, Anthropic) y **investigar temas recientes** con un loop de agente y herramientas web.
- **Naturaleza del trabajo:** desarrollo de producto (no demo, no benchmark).

## 2. Modo de Integridad propuesto

**`development`** (default):
- Permitido usar librerías/frameworks aprobados.
- **Prohibido** salidas fabricadas, implementaciones fachada, placeholders o tests trucados.
- Verificación empírica real: comandos ejecutados con salida 0 antes de cada `WORKER_COMPLETE`.

## 3. Bloques de Requerimientos

**MVP (obligatorio):**
1. App shell responsive (sidebar/drawer, topbar, temas claro/oscuro/auto, i18n es/en).
2. Configuración de proveedores: plantillas (Groq, Cerebras, OpenAI, DeepSeek, Ollama, LM Studio, vLLM, Anthropic), API keys en KeyVault local, descubrimiento de modelos y selección por conversación.
3. Chat: streaming SSE, stop/abort, historial completo con presupuesto de tokens, markdown + código con copiar, regenerar, editar mensaje, borrar.
4. Conversaciones persistentes en IndexedDB: crear, listar, renombrar, borrar, recuperar interrumpidas; onboarding de proveedor.
5. Transporte robusto: fetch streaming en web/desktop; fallback `CapacitorHttp` bufferizado en Android cuando CORS/SSE no esté disponible.

**Fase 2 (agente):**
6. `runAgent`: loop multi-paso con presupuesto (pasos, tools, tokens, tiempo), retries, abort, dedupe.
7. Tools `web_search` y `open_url` con política de URL segura, proveedores Brave/Tavily/DDG + proxy opcional; modo investigación con fuentes, citas y timeline de pasos.

**Fase 3 (pulido):**
8. Packaging Android (Capacitor), PWA desktop, iconografía propia, checklist E2E, documentación.

**No-objetivos explícitos:** backend propio, multiusuario, sync cloud, RAG/embeddings, MCP, telemetría, copiar marcas/logos de terceros.

## 4. Mecanismo de Verificación Independiente

- **Automática (gate obligatorio):** `pnpm exec tsc --noEmit` limpio + `pnpm test` (Vitest) verde; cero `console.log`/TODOs/código muerto; ningún archivo fuera de `allowedFiles`.
- **Adversarial (gates por hito):** Critic (arquitectura/tipos) + Challenger (inputs extremos, abort, red cortada, presupuestos) + Auditor (comandos reales, sin tests mockeados que se autoaprueben).
- **Manual (cierre):** checklist `docs/e2e-smoke.md` en dispositivo/desktop + **Success Auditor** final.

## 5. Criterios de Aceptación del Proyecto (DoD global)

1. `pnpm install && pnpm test && pnpm exec tsc --noEmit` en verde desde repo limpio.
2. Flujo real: configurar una API key → crear chat → streaming visible → Stop funciona → recargar la app y la conversación persiste → cambiar modelo/proveedor → borrar conversación.
3. Modo investigación: con proveedor de búsqueda o proxy configurado, el agente ejecuta ≥2 pasos con tools, cita fuentes y respeta presupuestos/abort.
4. Android: APK sincronizada (`cap sync`), smoke checklist documentado; desktop: SPA/PWA funcional.
5. Cero secretos en logs/repo; cero marcas ajenas.

## 6. Directorio Dedicado

- **Repo independiente:** `G:\Proyectos\openher-chat` (git, rama `main`), separado de OpenHer.
- Artefactos de coordinación: `.agents/{teamwork_board.json,teamwork_plan.md,teamwork_progress.md}`.
- Scratch por agente: `scratch/agent-<id>/` (ignorado por git).

---

**Aprobación requerida (una sola confirmación):**

- [ ] Confirmo objetivo, alcance MVP y modo de integridad `development`.
- [ ] Autorizo `pnpm install` del scaffold (T01) y la ejecución del swarm.
