/** `node:fs/promises` mínimo para tests con fixtures binarios (sin `@types/node`). */
declare module 'node:fs/promises' {
  export function readFile(path: string | URL): Promise<Uint8Array>;
}
