import { defineDict } from '../index';

export const updates = defineDict({
  es: {
    title: 'Actualizaciones',
    description: 'Comprueba si hay una versión nueva y descarga el APK.',
    currentVersion: 'Versión instalada: {version}',
    autoCheck: 'Buscar actualizaciones al abrir',
    autoCheckHint: 'Es la única llamada de red en segundo plano de la app; no envía datos, solo pregunta a GitHub.',
    check: 'Buscar actualización',
    upToDate: 'Tienes la última versión ({version}).',
    availableTitle: 'Nueva versión {version}',
    download: 'Descargar APK',
    downloadHint:
      'Se abre el navegador para descargar el APK. Cuando termine, ábrelo desde las notificaciones para instalar encima (misma firma, no borra tus datos).',
    sha256: 'SHA-256: {hash}',
    error: 'No se pudo comprobar: {message}',
    retry: 'Reintentar',
    noticeTitle: 'Actualización disponible: {version}',
    noticeDescription: 'Hay una versión nueva de OpenHer Chat.',
    noticeAction: 'Actualizar',
    noticeDismiss: 'Descartar',
  },
  en: {
    title: 'Updates',
    description: 'Check for a new version and download the APK.',
    currentVersion: 'Installed version: {version}',
    autoCheck: 'Check for updates on startup',
    autoCheckHint: 'The app’s only background network call; it sends no data, it only asks GitHub.',
    check: 'Check for update',
    upToDate: 'You are on the latest version ({version}).',
    availableTitle: 'New version {version}',
    download: 'Download APK',
    downloadHint:
      'The browser opens to download the APK. When it finishes, open it from the notifications to install over the app (same signature, your data is kept).',
    sha256: 'SHA-256: {hash}',
    error: 'Check failed: {message}',
    retry: 'Retry',
    noticeTitle: 'Update available: {version}',
    noticeDescription: 'A new version of OpenHer Chat is available.',
    noticeAction: 'Update',
    noticeDismiss: 'Dismiss',
  },
});

export type UpdatesMessages = (typeof updates)['es'];

declare module '../types' {
  interface I18nSchema {
    updates: UpdatesMessages;
  }
}
