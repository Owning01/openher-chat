/**
 * Skill (habilidad): instrucciones reutilizables que el usuario guarda y el
 * agente puede cargar con la tool `load_skill` cuando la tarea coincide.
 * El cuerpo puede ser largo; al modelo sólo le llega nombre + descripción en el
 * system prompt y el Markdown completo cuando la pide.
 */
export interface Skill {
  id: string;
  /** Nombre estable con el que el modelo la pide (p. ej. `informe-laboral`). */
  name: string;
  /** Cuándo usarla; se muestra en el system prompt para que el modelo decida. */
  description: string;
  /** Instrucciones completas en Markdown que devuelve `load_skill`. */
  body: string;
  createdAt: number;
  updatedAt: number;
}

/** Resumen para el system prompt: nunca incluye el cuerpo (ahorra tokens/ruido). */
export interface SkillPromptEntry {
  name: string;
  description: string;
}

/** Datos editables de una skill; `id` presente = edición. */
export interface SkillDraft {
  id?: string;
  name: string;
  description: string;
  body: string;
}
