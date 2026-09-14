/** Descarga un texto como archivo en el navegador (sin dependencias). */
export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Nombre de archivo seguro a partir de un título (conserva espacios → guiones). */
export function safeFilename(title: string, fallback = 'conversation'): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned === '' ? fallback : cleaned;
}
