/**
 * Lógica pura de acumulación del dictado (sin DOM ni micrófono), portada del
 * patrón de OpenHer. Invariante: estas funciones NUNCA recortan ni vacían el
 * texto previo; ante una hipótesis ambigua conservan el buffer y solo añaden.
 */

/** Añade un segmento final (Web Speech API) al buffer acumulado. */
export function appendWebFinal(prev: string, chunk: string): string {
  const c = chunk.trim();
  if (c === '') return prev;
  if (prev === '') return c;
  if (prev.endsWith(c)) return prev;
  return `${prev} ${c}`;
}

/** Texto a mostrar = finales acumulados + interim en curso. */
export function combineDisplay(finalBuffer: string, interim: string): string {
  const it = interim.trim();
  if (it === '') return finalBuffer;
  return finalBuffer === '' ? it : `${finalBuffer} ${it}`;
}

/**
 * Integra un parcial nativo en el buffer. `baseLen` es la longitud del buffer al
 * empezar la utterance actual: solo se reescribe la cola posterior a ese punto.
 * Nunca recorta.
 */
export function mergeNativePartial(prev: string, baseLen: number, text: string): string {
  const t = text.trim();
  if (t === '') return prev;
  const cut = Math.max(0, Math.min(baseLen, prev.length));
  const head = prev.slice(0, cut).trim();
  const tail = prev.slice(cut).trim();
  const withHead = (value: string): string => (head === '' ? value : `${head} ${value}`);
  if (tail === '') return withHead(t);
  if (t === tail) return prev;
  // Comparación tolerante a casing/puntuación: el final suele llegar como
  // "Hola mundo." sobre el parcial "hola mundo" y no debe duplicarse.
  const nt = normHypothesis(t);
  const ntail = normHypothesis(tail);
  if (nt !== '' && nt === ntail) return withHead(t);
  if (nt !== '' && ntail !== '' && nt.startsWith(ntail)) return withHead(t);
  if (nt !== '' && ntail !== '' && ntail.startsWith(nt)) return prev;
  if (t.startsWith(tail)) return withHead(t);
  if (tail.startsWith(t)) return prev;
  if (!prev.includes(t)) return `${prev.trim()} ${t}`;
  return prev;
}

/** Normaliza una hipótesis para comparar: sin casing ni puntuación de borde. */
function normHypothesis(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[¿¡"'(«]+/, '')
    .replace(/[.,!?;:"')»]+$/, '')
    .trim();
}
