import { defineDict } from '../index';

export const app = defineDict({
  es: {
    title: 'OpenHer Chat',
    menu: 'Abrir menú',
    sidebarLabel: 'Historial de conversaciones',
    settings: 'Ajustes',
    settingsTitle: 'Ajustes',
    themeCurrent: 'Tema: {mode}. Cambiar tema',
    themeError: 'No se pudo guardar el tema',
    bootErrorTitle: 'No se pudo iniciar la aplicación',
    noProviderTitle: 'Configura un proveedor',
    noProviderDescription: 'Agrega un proveedor con su API key para empezar a chatear.',
    noProviderAction: 'Ir a ajustes',
    storageErrorTitle: 'Almacenamiento no disponible',
  },
  en: {
    title: 'OpenHer Chat',
    menu: 'Open menu',
    sidebarLabel: 'Conversation history',
    settings: 'Settings',
    settingsTitle: 'Settings',
    themeCurrent: 'Theme: {mode}. Switch theme',
    themeError: 'Could not save the theme',
    bootErrorTitle: 'The app could not start',
    noProviderTitle: 'Set up a provider',
    noProviderDescription: 'Add a provider with its API key to start chatting.',
    noProviderAction: 'Go to settings',
    storageErrorTitle: 'Storage unavailable',
  },
});

export type AppMessages = (typeof app)['es'];

declare module '../types' {
  interface I18nSchema {
    app: AppMessages;
  }
}
