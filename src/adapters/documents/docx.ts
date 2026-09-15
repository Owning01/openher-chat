/**
 * Extracción de texto de Word `.docx` con `mammoth` (texto crudo, sin estilos).
 * El loader es inyectable para tests herméticos (sin binarios reales).
 */

import { htmlToMarkdown } from './htmlToMarkdown';

export interface MammothInput {
  arrayBuffer: ArrayBuffer;
}

export interface MammothNodeInput {
  buffer: Uint8Array;
}

export interface MammothApi {
  extractRawText(input: MammothInput | MammothNodeInput): Promise<{ value: string }>;
  /** Ausente en fakes viejos: sin él la extracción Markdown cae al texto crudo. */
  convertToHtml?(input: MammothInput | MammothNodeInput, options?: unknown): Promise<{ value: string }>;
}

export type MammothLoader = () => Promise<MammothApi>;

async function defaultMammothLoader(): Promise<MammothApi> {
  return await import('mammoth');
}

function isNodeRuntime(): boolean {
  return (
    (globalThis as { process?: { versions?: Record<string, string | undefined> } }).process?.versions
      ?.node !== undefined
  );
}

function mammothErrorMessage(error: unknown): string {
  return typeof (error as { message?: unknown } | null)?.message === 'string'
    ? (error as { message: string }).message
    : '';
}

/**
 * Llama a `method` con la variante del entorno primero y la otra ante el
 * error exacto de mammoth (`Could not find file in options`), comparado por
 * mensaje porque en jsdom/vitest los errores cruzan reinos y `instanceof
 * Error` da falso negativo.
 */
async function callBothVariants(
  api: MammothApi,
  method: 'extractRawText' | 'convertToHtml',
  data: ArrayBuffer,
): Promise<string> {
  const node = isNodeRuntime();
  const first: MammothInput | MammothNodeInput = node ? { buffer: new Uint8Array(data) } : { arrayBuffer: data };
  const second: MammothInput | MammothNodeInput = node ? { arrayBuffer: data } : { buffer: new Uint8Array(data) };
  const invoke =
    method === 'extractRawText'
      ? (input: MammothInput | MammothNodeInput) => api.extractRawText(input)
      : (input: MammothInput | MammothNodeInput) => api.convertToHtml?.(input);
  try {
    const result = await invoke(first);
    return typeof result?.value === 'string' ? result.value : '';
  } catch (error) {
    if (mammothErrorMessage(error) !== 'Could not find file in options') throw error;
    const result = await invoke(second);
    return typeof result?.value === 'string' ? result.value : '';
  }
}

/**
 * Texto crudo del `.docx`; `''` si el documento no trae texto legible.
 *
 * Mammoth publica dos builds (`package.json/browser`): el de navegador acepta
 * `{arrayBuffer}` y el de Node (`fs`) solo `{path|buffer|file}`. En producción
 * (Vite) siempre corre el de navegador. Se intenta primero la variante del
 * entorno (sin `instanceof` ni detección frágil: `globalThis.process` existe
 * solo en Node) y se cae a la otra ante el error exacto de mammoth,
 * comparado por mensaje porque en jsdom/vitest los errores cruzan reinos y
 * `instanceof Error` da falso negativo.
 */
export async function extractDocxText(
  data: ArrayBuffer,
  load: MammothLoader = defaultMammothLoader,
): Promise<string> {
  const api = await load();
  return callBothVariants(api, 'extractRawText', data);
}

/**
 * Markdown estructural del `.docx` (títulos, listas, tablas) para la IA:
 * misma información que el texto crudo con menos ambigüedad. Si mammoth no
 * ofrece HTML o el resultado viene vacío, cae al texto crudo.
 */
export async function extractDocxMarkdown(
  data: ArrayBuffer,
  load: MammothLoader = defaultMammothLoader,
): Promise<string> {
  const api = await load();
  if (api.convertToHtml === undefined) return callBothVariants(api, 'extractRawText', data);
  const html = await callBothVariants(api, 'convertToHtml', data);
  const markdown = htmlToMarkdown(html);
  if (markdown !== '') return markdown;
  return callBothVariants(api, 'extractRawText', data);
}
