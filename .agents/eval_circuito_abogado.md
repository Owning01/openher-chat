# Evaluación en vivo — circuito legal como abogado (caso ficticio)

Fecha: 2026-09-15. Método: actuar como abogado con caso INCOMPLETO usando el
sistema real (código + documentos + modelos reales vía OpenCode Go), anotando
cada error. Modelos: SOLO `muse-spark-1.3-contributor` (transporte
`/responses`), salvo la primera corrida descartada con qwen (sirvió para E4).

Caso ficticio: **Salinas c/ Quiroga s/ cobro de alquileres y desalojo**
(Yatay 482 3°B, CABA; $450.000/mes; períodos ene–mar 2026 en disputa).
Documentación traída (incompleta a propósito): relato con huecos, contrato en
Word, boleta de depósito judicial en PDF, foto de recibo manuscrito. Faltan:
comprobantes de transferencia, intimación fehaciente, chats de WhatsApp.

Fixtures y transcripts: temporales, borrados al cerrar (`run.jsonl` vivió en
el dir temporal de evaluación). Transcripts analizados por script, no a ojo.

## Límites del método (honestos)

- Sin navegador automatizable con red (Playwright sandbox sin DNS; desktop
  desconectado): la UI React NO se piloteó en esta pasada. El wiring UI está
  cubierto por 1474 tests; acá se evalúan ingesta real, transportes reales,
  herramientas legales reales, calidad de cada rol y generación de archivos.
- La API key usada es la del usuario (solo env, nunca en archivos) y debe
  ROTARSE al terminar (viajó por el chat).
- pdfjs main build no corre en Node (E3): la extracción PDF se validó con el
  build legacy (mismo parser) vía el loader inyectable; la ruta de producción
  (navegador) sigue sin cobertura automatizada.

## Resultados por paso (corrida válida, muse-spark)

| Paso | Salida | Tiempo | Marcas | Stop |
|---|---|---|---|---|
| S0 ingesta | relato 1094 ch; docx 1869 ch; pdf 460 ch (1 pág, 0 vacías); foto 66KB→88KB dataURL | — | — | — |
| S1 redactor | 9508 ch | 48s | V1 C2 | end_turn |
| S2 visión (foto recibo) | 871 ch, transcribe monto/enero/firma ilegible/Quiroga | 10s | — | end_turn |
| S3 atacante runAgent | 5× `legal_search` ok (2307/2845/464/2025/408 ch); texto 174 ch | 30s | — | end_turn |
| S3b ataque directo+regla | 12313 ch | 58s | V1 C1 | end_turn |
| S4 juez (ataque flaco) | 7060 ch | 40s | V2 C5 | end_turn |
| S4b juez (ataque real) | 6615 ch, 10 tesis, detecta inconsistencia del plazo | 51s | V4 C4 | end_turn |
| S5b síntesis | 14537 ch | 38s | V2 C2 | end_turn |
| S6-html | 6062 ch standalone con CSS print A4 | 21s | — | end_turn |
| S6b-word (con doc) | 7260 ch listo para copiar + nota de maquetado | 42s | V0 C1 | end_turn |
| S6b-pdf (con doc) | 7242 ch carátula + texto listo | 26s | V2 C3 | end_turn |

Calidad observada: redactor con estructura de demanda argentina completa,
aritmética correcta ($1.350.000), uso del contrato Y la boleta, cero artículos
inventados. Juez honesto con material flaco ("aporte autónomo igual a cero",
cero números de artículo sin índice) y con material real (10 tesis, cita
cláusulas verbatim del expediente, detecta que el contrato vence en febrero
pero se reclama marzo). Síntesis fusiona 1+2+3 con advertencias y marcas.
Visión multimodal de punta a punta por transporte `responses`: OK.

## Hallazgos

### E1 — `extractDocxText` rechazaba `{arrayBuffer}` en el build de Node [FIX]
Mammoth publica dos builds (`package.json/browser`): navegador acepta
`{arrayBuffer}`, Node (`fs`) solo `{path|buffer|file}`. Producción (Vite) OK;
Node/jsdom fallaba. Ningún test lo ejercitaba.
Fix en `src/adapters/documents/docx.ts` + test (`docx.test.ts`).

### E2 — `instanceof Error` falso negativo cruzando reinos (jsdom) [FIX]
El `catch` del fallback no se activaba en vitest; el rechazo original se
propagaba (y como "unhandled"). Fix: intento determinista por entorno
(`globalThis.process`, sin `instanceof`) + comparación por mensaje como
respaldo. S0 posterior: verde, cero rechazos fantasma.

### E3 — pdfjs main no corre en Node; extracción PDF real sin cobertura [GAP]
`UnknownErrorException: hashOriginal.toHex` (falta WebCrypto; el propio pdfjs
pide el build legacy en Node). Producción OK (navegador real). Recomendación:
test permanente con fixture PDF real + legacy build.

### E4 — modelos que razonan se comen el cupo de salida [PRODUCTO, qwen]
Primera corrida (qwen3.8-max, descartada por orden del usuario): 6/6 turnos
directos en `max_tokens` con texto vacío y `completionTokens` == cap exacto;
el razonamiento consumió todo. muse-spark (`reasoningChars: 0` en todos los
turnos) no lo sufre. Recomendación: validar presupuesto thinking-vs-max en el
mapeo por transporte o advertirlo; hoy un modelo razonador + cap chico =
respuesta vacía silenciosa.

### E5 — atacante sin escrito NO inventa [OK, verificado]
Con semilla vacía se negó a atacar, no inventó hechos ni citas (6×
`[VERIFICAR]`, 2× `[COMPLETAR]`). Su cita de CPCCN 347 es textual del pack
(diff contra `ar-cpccn-core.json`). S3b directo (sin tools): 0 artículos
inventados, remite a norma "no provista" + `[VERIFICAR]`.

### E6 — el juez ignora el veredicto en % dos veces [FIX aplicado]
Scaffold exige `Verdict: side A x% / side B y%` obligatorio; S4 y S4b (con
ataque real) dan análisis excelente ("Ventaja clara B") pero cero líneas con
`%`. Fix: atacante... (juez) línea de cierre obligatorio explícito
("never close the answer without it") en `prompt.ts` + asserts en
`prompt.test.ts`. Requiere re-validación con modelo en próximo caso.

### E7 — el atacante anuncia en vez de atacar y el run termina [FIX aplicado]
S3 (runAgent + 5 tools ok): el modelo escribió un anuncio de 174 ch y el loop
terminó correctamente (end_turn sin más steps). El circuito se cortaba con
semilla de juez casi vacía. S3b con regla anti-preámbulo → ataque completo de
12313 ch. Fix: regla "empezá por el punto 1, sin preámbulos; el ataque completo
va en esta respuesta" en el scaffold atacante + asserts. Requiere
re-validación con modelo.

### E8 — Word/PDF binarios NO se generan (expectativa vs realidad) [GAP]
Ni el modelo (no puede adjuntar binarios: "no puedo adjuntarte un .docx") ni
la app (descargas solo `.md` por mensaje y por conversación) generan
`.docx`/`.pdf`. Verificado: HTML standalone ✓ (6062 ch, print-ready),
Markdown ✓ nativo, Word/PDF solo como texto listo-para-copiar con
instrucciones de maquetado. Propuesta (requiere aprobación, nueva dep o
impresión del navegador): exportar `.html` (trivial, es texto), `.docx`
cliente (librería nueva) o PDF vía diálogo de impresión del HTML.

## Mejoras aplicadas en esta sesión

1. `docx.ts`: variante por entorno + fallback realm-safe.
2. `docx.test.ts`: 2 tests nuevos (variante Node, no-reintento ante otro error).
3. `prompt.ts`: anti-preámbulo atacante + cierre obligatorio del veredicto;
   comentario stale "tres roles" → cuatro.
4. `prompt.test.ts`: asserts de ambas reglas.

## Propuestas no aplicadas (decisión del usuario)

- P1: validación thinking-vs-maxtokens (E4).
- P2: export `.html` / `.docx` / PDF (E8, P2 exige aprobar dependencia).
- P3: test permanente PDF-real con legacy build (E3).
- P4: re-validar E6/E7 con modelo tras los cambios de scaffold.
- P5: ROTAR la API key de OpenCode Go (viajó por el chat).
