# AGENTS.md — OpenHer Chat

**Qué es:** cliente de chat personal (single-user) con estética inspirada en ChatGPT/Gemini, para **Android y desktop**. Conversa con cualquier proveedor LLM que el usuario configure por API key (Groq, Cerebras, OpenAI-compatible incluyendo Ollama/LM Studio/vLLM, Anthropic) y ejecuta un loop de agente con herramientas para investigación web.

**Repo:** separado de OpenHer (`opencode-remote-android`). No importar código de ese repo; se pueden portar patrones (SSE, prompt cache, providers) manteniendo este repo autocontenido.

## Stack (fijo — no cambiar sin orden del Architect)

- Vite + React 19 + TypeScript estricto + Tailwind CSS 4
- pnpm
- Capacitor 8 (Android) · Desktop: la misma SPA (PWA). Empaquetado nativo (Tauri/Electron) se decide en fase final.
- Persistencia: IndexedDB (conversaciones) + localStorage (preferencias)
- Tests: Vitest

## Reglas inviolables (teamwork ground rules)

1. **File scoping**: cada builder modifica únicamente los archivos asignados en su `TASK_DISPATCH`. Cambios fuera de alcance = `REJECTED` automático.
2. **Cero dependencias nuevas** sin aprobación explícita del Architect/Orchestrator.
3. **TypeScript estricto**: `tsc --noEmit` limpio; evitar `any` (si es inevitable, justificar en el reporte).
4. **Cero debug debris**: nada de `console.log`, código comentado, archivos huérfanos ni TODOs sin tarea.
5. **TDD ligero**: la lógica de dominio (agente, providers, presupuesto de tokens, persistencia) lleva tests unitarios.
6. **Sin marcas ajenas**: estética inspirada en ChatGPT/Gemini; prohibido copiar logos, nombres o assets de OpenAI/Google/Anthropic.
7. **Secretos**: API keys solo en almacenamiento local del dispositivo; nunca en logs, código, tests ni repositorio. Sin telemetría.

## Verificación obligatoria antes de `TASK_COMPLETE`

```sh
pnpm exec tsc --noEmit
pnpm test
```

## Estructura

La define el Architect en `.agents/teamwork_board.json`; mantenerla sin desviación.
