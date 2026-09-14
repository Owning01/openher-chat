import { defineDict } from '../index';

export const conversations = defineDict({
  es: {
    new: 'Nuevo chat',
    searchLabel: 'Buscar conversaciones',
    searchPlaceholder: 'Buscar por título',
    listLabel: 'Conversaciones',
    emptyTitle: 'Aún no hay conversaciones',
    emptyDescription: 'Crea tu primer chat para empezar.',
    noResultsTitle: 'Sin resultados',
    noResultsDescription: 'Ninguna conversación coincide con «{query}».',
    clearSearch: 'Limpiar búsqueda',
    rename: 'Renombrar',
    renameTitle: 'Renombrar conversación',
    renameLabel: 'Título',
    renamePlaceholder: 'Escribe un título',
    delete: 'Eliminar',
    deleteTitle: 'Eliminar conversación',
    deleteDescription: 'Se borrarán también sus mensajes. Esta acción no se puede deshacer.',
    untitled: 'Sin título',
    previewEmpty: 'Sin mensajes',
    itemLabel: 'Abrir conversación «{title}»',
    errorTitle: 'No se pudo completar la operación',
    createError: 'No se pudo crear la conversación',
    export: 'Exportar',
    import: 'Importar',
    importInvalid: 'El archivo no es una conversación válida.',
    messageHits: 'Coincidencias en mensajes',
  },
  en: {
    new: 'New chat',
    searchLabel: 'Search conversations',
    searchPlaceholder: 'Search by title',
    listLabel: 'Conversations',
    emptyTitle: 'No conversations yet',
    emptyDescription: 'Create your first chat to get started.',
    noResultsTitle: 'No results',
    noResultsDescription: 'No conversation matches “{query}”.',
    clearSearch: 'Clear search',
    rename: 'Rename',
    renameTitle: 'Rename conversation',
    renameLabel: 'Title',
    renamePlaceholder: 'Enter a title',
    delete: 'Delete',
    deleteTitle: 'Delete conversation',
    deleteDescription: 'Its messages will be deleted too. This action cannot be undone.',
    untitled: 'Untitled',
    previewEmpty: 'No messages',
    itemLabel: 'Open conversation “{title}”',
    errorTitle: 'The operation could not be completed',
    createError: 'Could not create the conversation',
    export: 'Export',
    import: 'Import',
    importInvalid: 'The file is not a valid conversation.',
    messageHits: 'Message matches',
  },
});

export type ConversationsMessages = (typeof conversations)['es'];

declare module '../types' {
  interface I18nSchema {
    conversations: ConversationsMessages;
  }
}
