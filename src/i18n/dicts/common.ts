import { defineDict } from '../index';

export const common = defineDict({
  es: {
    save: 'Guardar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    copy: 'Copiar',
    copied: 'Copiado',
    retry: 'Reintentar',
    loading: 'Cargando…',
    delete: 'Eliminar',
    back: 'Atrás',
    next: 'Siguiente',
    test: 'Probar',
    connected: 'Conectado',
    none: 'Ninguno',
    dismiss: 'Descartar',
    confirmDelete: '¿Eliminar «{name}»?',
    'theme.light': 'Claro',
    'theme.dark': 'Oscuro',
    'theme.system': 'Sistema',
  },
  en: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied',
    retry: 'Retry',
    loading: 'Loading…',
    delete: 'Delete',
    back: 'Back',
    next: 'Next',
    test: 'Test',
    connected: 'Connected',
    none: 'None',
    dismiss: 'Dismiss',
    confirmDelete: 'Delete “{name}”?',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',
  },
});

export type CommonMessages = (typeof common)['es'];

declare module '../types' {
  interface I18nSchema {
    common: CommonMessages;
  }
}
