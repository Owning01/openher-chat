import { defineDict } from '../index';

export const common = defineDict({
  es: {
    save: 'Guardar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    copy: 'Copiar',
    copied: 'Copiado',
    error: 'Error',
    retry: 'Reintentar',
    loading: 'Cargando…',
    search: 'Buscar',
    delete: 'Eliminar',
    confirm: 'Confirmar',
    back: 'Atrás',
    next: 'Siguiente',
    skip: 'Omitir',
    test: 'Probar',
    connected: 'Conectado',
    failed: 'Falló',
    language: 'Idioma',
    apply: 'Aplicar',
    none: 'Ninguno',
    dismiss: 'Descartar',
    clear: 'Limpiar',
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
    error: 'Error',
    retry: 'Retry',
    loading: 'Loading…',
    search: 'Search',
    delete: 'Delete',
    confirm: 'Confirm',
    back: 'Back',
    next: 'Next',
    skip: 'Skip',
    test: 'Test',
    connected: 'Connected',
    failed: 'Failed',
    language: 'Language',
    apply: 'Apply',
    none: 'None',
    dismiss: 'Dismiss',
    clear: 'Clear',
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
