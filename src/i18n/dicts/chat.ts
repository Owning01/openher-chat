import { defineDict } from '../index';

export const chat = defineDict({
  es: {
    composerPlaceholder: 'Escribe un mensaje…',
    send: 'Enviar',
    stop: 'Detener',
    streaming: 'Generando respuesta…',
    scrollToBottom: 'Ir al final',

    emptyTitle: 'Empieza la conversación',
    emptyDescription: 'Haz una pregunta o elige una sugerencia para comenzar.',
    suggestionsLabel: 'Sugerencias',
    suggestionExplain: 'Explícame un concepto complejo con una analogía',
    suggestionWrite: 'Ayúdame a redactar un correo profesional',
    suggestionSummarize: 'Resume este texto en tres puntos clave',
    suggestionCode: 'Revisa este fragmento de código y propón mejoras',

    copy: 'Copiar',
    copied: 'Copiado',
    regenerate: 'Regenerar',
    edit: 'Editar mensaje',
    delete: 'Eliminar mensaje',
    save: 'Guardar',
    cancel: 'Cancelar',
    retry: 'Reintentar',

    reasoning: 'Razonamiento',
    toolLabel: 'Herramienta: {name}',
    toolRunning: 'En curso',
    toolDone: 'Completado',
    toolError: 'Error',
    toolDurationMs: '{ms} ms',
    toolDurationSeconds: '{seconds} s',
    modelLabel: 'Modelo: {model}',

    errorAuth: 'Revisa la API key del proveedor.',
    errorRateLimit: 'El proveedor limitó la frecuencia. Inténtalo en un momento.',
    errorNetwork: 'No hay conexión con el proveedor.',
    errorTimeout: 'La respuesta tardó demasiado.',
    errorServer: 'El proveedor devolvió un error interno.',
    errorInvalidRequest: 'La solicitud no es válida para este modelo.',
    errorContextLength: 'La conversación supera el contexto del modelo.',
    errorAborted: 'La respuesta se detuvo.',
    errorUnknown: 'Ocurrió un error inesperado.',
  },
  en: {
    composerPlaceholder: 'Write a message…',
    send: 'Send',
    stop: 'Stop',
    streaming: 'Generating response…',
    scrollToBottom: 'Go to bottom',

    emptyTitle: 'Start the conversation',
    emptyDescription: 'Ask a question or pick a suggestion to get started.',
    suggestionsLabel: 'Suggestions',
    suggestionExplain: 'Explain a complex concept with an analogy',
    suggestionWrite: 'Help me draft a professional email',
    suggestionSummarize: 'Summarize this text in three key points',
    suggestionCode: 'Review this code snippet and suggest improvements',

    copy: 'Copy',
    copied: 'Copied',
    regenerate: 'Regenerate',
    edit: 'Edit message',
    delete: 'Delete message',
    save: 'Save',
    cancel: 'Cancel',
    retry: 'Retry',

    reasoning: 'Reasoning',
    toolLabel: 'Tool: {name}',
    toolRunning: 'Running',
    toolDone: 'Completed',
    toolError: 'Error',
    toolDurationMs: '{ms} ms',
    toolDurationSeconds: '{seconds} s',
    modelLabel: 'Model: {model}',

    errorAuth: 'Check the provider API key.',
    errorRateLimit: 'The provider rate-limited the request. Try again in a moment.',
    errorNetwork: 'No connection to the provider.',
    errorTimeout: 'The response took too long.',
    errorServer: 'The provider returned an internal error.',
    errorInvalidRequest: 'The request is not valid for this model.',
    errorContextLength: 'The conversation exceeds the model context.',
    errorAborted: 'The response was stopped.',
    errorUnknown: 'An unexpected error occurred.',
  },
});

export type ChatMessages = (typeof chat)['es'];

declare module '../types' {
  interface I18nSchema {
    chat: ChatMessages;
  }
}
