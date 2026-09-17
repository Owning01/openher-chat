import { defineDict } from '../index';

export const skills = defineDict({
  es: {
    sectionTitle: 'Habilidades',
    sectionDescription:
      'Instrucciones reutilizables que el asistente carga solo cuando la tarea coincide (por ejemplo, cómo redactar un informe).',
    localHint: 'Se guardan en este dispositivo y no se sincronizan a la nube.',
    emptyTitle: 'Todavía no hay habilidades',
    emptyDescription: 'Agregá una con sus pasos; el asistente la va a cargar cuando haga falta.',
    add: 'Agregar habilidad',
    edit: 'Editar',
    editTitle: 'Editar habilidad',
    addTitle: 'Nueva habilidad',
    name: 'Nombre',
    namePlaceholder: 'informe-laboral',
    nameHint: 'Así la pide el asistente. Sin espacios: usá guiones.',
    descriptionLabel: 'Cuándo usarla',
    descriptionPlaceholder: 'Cuando el usuario pida un informe laboral',
    descriptionHint: 'Se muestra al asistente para que decida si la carga.',
    bodyLabel: 'Instrucciones',
    bodyPlaceholder: '# Pasos\n1. Revisar el expediente\n2. Redactar el informe en Markdown',
    importFile: 'Importar archivo .md',
    importHint: 'Toma el nombre y la descripción del encabezado del archivo (si los tiene).',
    saved: 'Habilidad guardada',
    removed: 'Habilidad eliminada',
    nameRequired: 'Poné un nombre.',
    nameTaken: 'Ya existe una habilidad con ese nombre.',
    bodyRequired: 'Escribí las instrucciones de la habilidad.',
    loadError: 'No se pudieron cargar las habilidades.',
    saveError: 'No se pudo guardar la habilidad.',
    deleteError: 'No se pudo eliminar la habilidad.',
    importError: 'No se pudo leer el archivo.',
    wordCount: '{count} palabras',
  },
  en: {
    sectionTitle: 'Skills',
    sectionDescription:
      'Reusable instructions the assistant loads only when the task matches (for example, how to write a report).',
    localHint: 'Stored on this device; they are not synced to the cloud.',
    emptyTitle: 'No skills yet',
    emptyDescription: 'Add one with its steps; the assistant will load it when needed.',
    add: 'Add skill',
    edit: 'Edit',
    editTitle: 'Edit skill',
    addTitle: 'New skill',
    name: 'Name',
    namePlaceholder: 'work-report',
    nameHint: 'This is how the assistant asks for it. No spaces: use dashes.',
    descriptionLabel: 'When to use it',
    descriptionPlaceholder: 'When the user asks for a work report',
    descriptionHint: 'Shown to the assistant so it can decide whether to load it.',
    bodyLabel: 'Instructions',
    bodyPlaceholder: '# Steps\n1. Review the file\n2. Write the report in Markdown',
    importFile: 'Import .md file',
    importHint: 'Takes the name and description from the file header (when present).',
    saved: 'Skill saved',
    removed: 'Skill removed',
    nameRequired: 'Enter a name.',
    nameTaken: 'A skill with that name already exists.',
    bodyRequired: 'Write the skill instructions.',
    loadError: 'Could not load skills.',
    saveError: 'Could not save the skill.',
    deleteError: 'Could not remove the skill.',
    importError: 'Could not read the file.',
    wordCount: '{count} words',
  },
});

export type SkillMessages = (typeof skills)['es'];

declare module '../types' {
  interface I18nSchema {
    skills: SkillMessages;
  }
}
