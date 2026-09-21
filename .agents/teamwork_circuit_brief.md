# Teamwork Brief — Circuito legal adversarial real (M-CIRCUIT-FIX)

## 1. Objetivo (pedido directo del usuario, YA)
El circuito redactor→atacante→juez→síntesis hoy es teatro: mismo contexto,
mismo agente en tres disfraces, documentos rotulados "prueba" y escritos que
exigen decenas de correcciones. Dejarlo como un circuito adversarial de verdad
con documentos serios y escritos utilizables.

## 2. Quejas exactas (contrato con el usuario)
1. Los roles comparten contexto; el mismo agente actúa como defensor, atacante y juez.
2. El dossier de prueba dice "documento de prueba": debe ser material serio y real.
3. Los escritos no sirven sin ~30 modificaciones: estructura, citas y formalidades AR.

## 3. Alcance
- Núcleo: `src/domain/legal/` (prompt.ts, circuit.ts, tipos), seeds y guards del
  circuito en `src/features/chat/` (ChatPage derive, chatStore legal, caseStore),
  UI mínima si hace falta (CircuitDialog).
- Dossier: `prueba-documentos/ficha-halabi.docx` (reescritura seria, SIN la palabra
  "prueba"; hechos + prueba + planteo, formato de brief profesional) + el fallo
  real ya presente (`fallo-halabi-csjn-2009.pdf`, no tocar).
- PROHIBIDO tocar (trabajo en curso del principal, sin commitear):
  `src/adapters/documents/pdf.ts`, `src/domain/chat/attachments.ts`,
  `src/features/chat/components/MessageList.tsx`, tests y fixtures asociados.

## 4. Reglas inviolables (AGENTS.md del repo)
pnpm · TypeScript estricto (`tsc -b` limpio) · cero `console.log`/comentados/huérfanos ·
cero dependencias nuevas · tests unitarios para lógica de dominio · API keys jamás
en código/logs · español en UI, prompts legales en español AR.

## 5. Diseño exigido (lo que "separación real" significa)
- Firewall de rol: cada rol con system prompt propio e independiente; el atacante
  NO recibe instrucciones del redactor; el juez recibe doc+ataque+rubrica fija, nada más.
- Tests que prueban la separación (p. ej. el seed/contexto del atacante no contiene
  instrucciones del redactor; el del juez no filtra veredicto previo).
- Contrato de salida por rol (encabezado, objeto, hechos, derecho con citas
  verificables formato Fallos, prueba, petitorio) y citas con guardia existente.
- Stretch solo si sale barato: modelo distinto por rol (default = mismo proveedor).

## 6. DoD (numérico)
- `pnpm exec tsc -b` exit 0.
- `pnpm test` verde (suite completa, sin modificar tests existentes salvo los
  que el diseño cambie con justificación en el reporte).
- Tests nuevos: separación de contextos (≥3), contrato de escrito por rol (≥4),
  dossier serio sin "prueba" (assert de contenido).
- Dossier: brief Halabi reescrito, cero ocurrencias de "prueba/test", con hechos,
  prueba documental y planteo jurídico listos para demandar.

## 8. Cierre (principal, post-evaluator)
- Veredicto final: ACCEPTED con 2 excepciones fundadas.
- E1 (dossier sin test en repo): el dossier es artefacto local untracked por
  diseño (jamás se commitea); verificado por script del worker (sha
  e42dfb60…) + chequeo python del evaluator. Un test en repo fallaría en
  clones frescos: excepción concedida.
- E2 (archivos "prohibidos" modificados): workstream paralelo del principal
  (polyfill toHex pdfjs, adjuntos colapsables, pdfReal), anterior al teamwork;
  se libera en el mismo release v1.6.0. Excepción concedida con evidencia.
- DoD conteo corregido: 4º test de contrato agregado (redactor sin semilla).
