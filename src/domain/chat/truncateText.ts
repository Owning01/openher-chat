/**
 * Recorta un texto conservando head (60%) + tail (40%) con un marcador en
 * inglés que informa cuántos caracteres se recortaron. Determinista; si el
 * texto cabe dentro de `maxChars`, se devuelve intacto.
 *
 * El corte y el conteo operan sobre code points (`Array.from`), nunca sobre
 * code units UTF-16, para no partir pares surrogados (emoji, CJK raros).
 * Si no hay espacio para head + tail (límite menor que el marcador + 4),
 * devuelve solo el marcador: es la señal mínima de truncado y evita exponer
 * contenido partido. Un `maxChars` no finito desactiva el truncado.
 */
export function truncateText(text: string, maxChars: number): string {
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : Number.POSITIVE_INFINITY;
  const codePoints = Array.from(text);
  if (codePoints.length <= limit) return text;

  const removed = codePoints.length - limit;
  const marker = `\n\n[... truncated ${removed} chars ...]\n\n`;
  if (limit < marker.length + 4) return marker;

  const headLength = Math.floor(limit * 0.6);
  const tailLength = limit - headLength;
  const head = codePoints.slice(0, headLength).join('');
  const tail = codePoints.slice(codePoints.length - tailLength).join('');
  return `${head}${marker}${tail}`;
}
