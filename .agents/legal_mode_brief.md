# legal_mode_brief.md — Brief de Fase 1 (para aprobación)

> Salida de la **Fase 1 (Entrevista de alcance)** del protocolo teamwork.
> Ruta: `legal-mode-v2` · Modo de integridad: `development` · Alcance: **solo planificación**
> (no se modificó código de producto).

## Artefactos de esta corrida

| Artefacto | Qué es |
|---|---|
| `.agents/legal_mode_plan.md` | Plan maestro v2 (remediado tras gate adversarial) |
| `.agents/legal_mode_board.json` | DAG máquina-legible: 24 tareas + 3 gates, propiedad exclusiva de archivos |
| `.agents/legal_mode_review_challenger.md` | Informe adversarial (Challenger) |
| `.agents/legal_mode_review_critic.md` | Revisión de arquitectura/contratos (Critic) |
| `.agents/legal_mode_progress.md` | Registro de la corrida y auditoría de integridad |

## Los 5 pilares

1. **Objetivo y audiencia.** Herramienta de trabajo para un abogado argentino (single-user, local) que
   analiza casos de **derecho civil y comercial** de forma adversarial: documentos de **defensa** del
   cliente, documentos de **ataque** (rol de la contraparte), inventario de qué puede usar el atacante
   contra el cliente, qué puede usar la defensa, y **postura probable del juez**. Se preconfigura en el
   primer inicio y carga conocimiento normativo offline.
2. **Bloques de requerimiento.**
   - R1 Modo legal preconfigurable en el primer inicio (sin romper el onboarding existente).
   - R2 Corpus normativo offline, versionado y verificable por hash (nunca en el bundle inicial).
   - R3 Análisis adversarial en 4 perspectivas + síntesis, persistido por expediente.
   - R4 Generación de documentos (ataque y defensa) con checklist legal argentino.
   - R5 Anti-alucinación: **cero** citas de normas ausentes del índice; no verificado ⇒ `[VERIFICAR]`.
   - R6 Confidencialidad: anonimización antes de enviar al proveedor, 100% local, sin telemetría.
   - R7 Motor de plazos/prescripción con reglas versionadas y flag `verified`.
   - R8 **Modos combinables** (v2.1): el modo legal no depende del primer inicio. Se activa por **tres
     vías no excluyentes** — onboarding, Ajustes y un **menú de modos en el chat** (`ModesMenu`, botón en
     la cabecera tipo menú hamburguesa) — y se combina con el modo investigación
     (General / Investigación / Legal / Investigación + Legal).
3. **Mecanismo de verificación independiente.**
   - `pnpm exec tsc -b` limpio + `pnpm test` verde por hito (+ `pnpm build` en M1/M3).
   - Contratos de repositorio compartidos real↔fake (patrón `conversationContract`).
   - Golden set de 30 escritos: **≥80 %** de citas resueltas en el corpus; **0** citas fuera del pack
     reportadas como `verified`.
   - `scripts/legal/verify-packs.mjs`: valida texto contra `sourceUrl` o registra verificación manual.
4. **Criterios de aceptación (DoD).** Los 7 DoD medibles del plan §5 + checklist de §13.1. Un hito no se
   cierra por declaración del worker: pasa por Critic + Bug Hunter + Challenger (G1), Auditor (G2) y
   Evaluator (G3).
5. **Directorio dedicado.** Trabajo dentro del repo existente bajo `src/domain/legal/**`,
   `src/features/legal/**`, `src/adapters/legal/**`, `public/legal/packs/**` y `docs/legal-*.md`.
   Artefactos de proceso en `.agents/`.

## Estimación (relativa) y forma de trabajo

| Hito | Contenido | Esfuerzo |
|---|---|---|
| M0 | Dominio legal + hardening del agente (prerrequisito) | L |
| M1 | Persistencia IDB v2 + corpus curado | M |
| M2 | Integración de chat + tools legales | M |
| M3 | Adversarial + documentos + confianza + modos + onboarding | L+ |
| G1/G2/G3 | Gates adversariales, integridad y aceptación | S c/u |

## Decisiones que requieren tu respuesta

Ver `.agents/legal_mode_plan.md` §10. La decisión "modo global vs por conversación" quedó **resuelta por
D17** (per-conversación, con defaults globales). Siguen abiertas 9, cada una con recomendación; las
bloqueantes para arrancar son: jurisdicción del MVP, licencia/fuente del corpus y nivel de anonimización.

Semántica de modos (D17): los modos son **ortogonales y por conversación** — `researchMode` (Investigación)
y `legalCaseId` (Legal) — así que cualquier **combinación** es válida. El menú del chat **deriva** el
estado; no introduce un "modo actual" que duplique la fuente de verdad.

## No-objetivos del MVP

Sin jurisprudencia embebida, sin todas las provincias, sin PDF/OCR, sin nube, sin embeddings, sin
dependencias nuevas, y **sin reemplazar el criterio del abogado**. Genera **borradores para revisión
profesional**, nunca escritos "listos para presentar".
