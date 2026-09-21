import { defineDict } from '../index';

export const legalManual = defineDict({
  es: {
    title: 'Manual Forense y Guía del Abogado',
    subtitle: 'Instrucciones prácticas de derecho procesal, secreto profesional y redacción de escritos judiciales para el operador jurídico.',
    badgeForensic: 'Práctica Forense',
    badgeConfidentiality: 'Secreto Profesional',
    badgeCivilProcedure: 'CPCCN / CCyC',
    searchPlaceholder: 'Buscar por tema, norma (ej: 330, Ley 48, plazos), excepción o trámite...',
    noResults: 'No se encontraron materias con ese criterio de búsqueda.',
    clearSearch: 'Limpiar búsqueda',
    filterAll: 'Todas las materias',
    copiedPrompt: '¡Instrucción procesal copiada al portapapeles!',
    copyPromptButton: 'Copiar instrucción para el asistente',
    legalBasis: 'Fundamento legal y procesal:',
    forensicTip: 'Consejo de técnica forense:',
    practicalExample: 'Instrucción modelo para dar al asistente en el chat:',

    // Categorías
    catPrivacy: 'Secreto Profesional y Privacidad',
    catCases: 'Ficha de Causa y Expediente',
    catDeadlines: 'Cómputo de Plazos Procesales',
    catAdversarial: 'Análisis Forense Adversarial',
    catDrafting: 'Redacción de Escritos Extensos',
    catAuditor: 'Auditoría Forense de Escritos',
    catTemplates: 'Modelos Procesales y Word',
    catFaq: 'Preguntas Frecuentes del Letrado',

    // Secciones detalladas
    secPrivacyTitle: 'Secreto profesional, confidencialidad y resguardo local',
    secPrivacyDesc: 'Garantía de custodia de la información de sus clientes sin servidores intermedios ni fuga de datos procesales.',
    secPrivacyContent: 'En OpenHer Chat, la base de datos de sus expedientes (partes, hechos, cronologías, documentos y borradores) no se almacena en ninguna nube de terceros ni en servidores compartidos. Reside exclusivamente en el almacenamiento local de su propio dispositivo (computadora o teléfono) mediante tecnología segura de base de datos local del navegador. Sus claves de acceso a los modelos de inteligencia artificial se guardan de forma encriptada en su equipo y nunca se transmiten a bases de datos ajenas. Esto le permite cumplir de manera irrestricta con el deber de reserva y secreto profesional propio del ejercicio de la abogacía.',

    secCasesTitle: 'Estructuración de la Ficha de Causa y Carátula Procesal',
    secCasesDesc: 'Cómo ordenar los autos, el rol de su cliente, las partes y los hechos cronológicos para nutrir las piezas procesales.',
    secCasesContent: 'Antes de redactar o analizar cualquier presentación, complete la carátula indicando el Fuero (Civil, Comercial, Laboral, Contencioso Administrativo), la Jurisdicción y el Juzgado interviniente. Defina con precisión el rol procesal de su cliente (parte actora, demandada, reconviniente o tercerista). En la sección de Partes, individualice a las personas físicas o jurídicas con sus domicilios reales, legales y electrónicos. En Hechos, consigne cada acontecimiento de forma cronológica indicando fecha, lugar y circunstancias: esta matriz factual alimenta de forma automática las demandas, memoriales y pruebas sin necesidad de reescribir la historia en cada escrito.',

    secDeadlinesTitle: 'Cómputo de Plazos Procesales y Plazo de Gracia',
    secDeadlinesDesc: 'Cálculo automatizado de días hábiles judiciales, notificación ministerial y las dos primeras horas del día posterior.',
    secDeadlinesContent: 'La calculadora de plazos computa estrictamente los días hábiles judiciales según el régimen del CPCCN, descontando sábados, domingos y feriados nacionales. Permite computar plazos a partir de una notificación personal o por cédula (a contar desde el día hábil inmediato siguiente), o bajo el régimen de notificación ministerial / "por nota" (martes y viernes, considerándose notificado en el primer día hábil posterior si fuera inhábil). Además, calcula automáticamente el vencimiento del Plazo de Gracia (art. 124 CPCCN), permitiendo la presentación válida del escrito durante las dos primeras horas del despacho judicial del día hábil posterior al vencimiento formal.',

    secAdversarialTitle: 'Análisis Forense Adversarial: El "Abogado del Diablo"',
    secAdversarialDesc: 'Sometimiento de la pretensión a la crítica del letrado de la contraparte y del magistrado antes de litigar.',
    secAdversarialContent: 'El módulo adversarial evalúa su escrito o teoría del caso desde la óptica de la contraparte antes de que usted lo presente en tribunales. Su función primordial es detectar tempranamente las Excepciones Previas del artículo 347 del CPCCN: prescripción liberatoria según los plazos del Código Civil y Comercial, falta de personería o defectos en los poderes, incompetencia de fuero o grado, defecto legal en el modo de proponer la demanda (art. 330) y litispendencia. Asimismo, evalúa la carga probatoria (art. 377 CPCCN), alertándole sobre hechos que usted afirma pero que carecen de ofrecimiento probatorio suficiente para convencer al juez.',

    secDraftingTitle: 'Redacción de Escritos Extensos por Capítulos (Anti-Truncamiento)',
    secDraftingDesc: 'La metodología probada para lograr demandas, agravios y alegatos de 10 a 30 fojas sin cortes ni resúmenes evasivos.',
    secDraftingContent: 'Todos los modelos de inteligencia artificial tienen un límite físico de longitud por respuesta (aproximadamente 3 a 5 páginas). Cuando un abogado le solicita "Redacta una demanda completa", el modelo suele cortar el texto abruptamente a mitad de página o comete "vaguedad sintética", reemplazando argumentos con frases como "[Desarrollar hechos aquí]". Para evitar esto, el Estudio de Redacción implementa la Redacción por Capítulos: usted elabora de forma independiente el Objeto, la Personería, los Hechos, el Derecho, el Ofrecimiento Probatorio, la Reserva Federal y el Petitorio. Mediante el botón "Copiar instrucción", usted obtiene una orden profesional estructurada para que el asistente redacte ese capítulo con exhaustividad, incorporando fechas, testimoniales y jurisprudencia sin omitir nada.',

    secAuditorTitle: 'Auditoría Forense de Completitud y Reserva de Caso Federal',
    secAuditorDesc: 'Monitoreo de fojas estimadas, detección de marcadores pendientes y salvaguarda de la vía ante la Corte Suprema (Ley 48 art. 14).',
    secAuditorContent: 'La pestaña de Auditoría Forense inspecciona en tiempo real el borrador del escrito. Calcula el volumen en palabras y estima la cantidad de fojas judiciales (~350 palabras por foja, conforme al uso forense tradicional). Rastrea automáticamente la existencia de marcadores pendientes [COMPLETAR ...] o citas [VERIFICAR ...] para evitar que se filtre un texto provisional. Además, verifica dos pilares procesales indispensables: la introducción oportuna de la Reserva del Caso Federal (art. 14 de la Ley 48) para asegurar el posterior Recurso Extraordinario Federal ante la CSJN en caso de sentencia adversa, y la formulación clara del Petitorio con imposición de costas.',

    secTemplatesTitle: 'Catálogo de Modelos Procesales y Exportación a Microsoft Word',
    secTemplatesDesc: 'Plantillas ajustadas al CPCCN y descarga en formato .docx con tipografía legal para Lex100 o portales provinciales.',
    secTemplatesContent: 'El sistema incluye cinco plantillas procesales canónicas: 1) Demanda ordinaria civil (art. 330 CPCCN); 2) Contestación de demanda y excepciones previas (arts. 346, 347, 355 y 356); 3) Expresión de agravios / Apelación ante Cámara con crítica concreta y razonada (art. 265 CPCCN); 4) Ofrecimiento exhaustivo de prueba (documental, absolución de posiciones, testimoniales con pliego, pericial contable/médica con puntos de pericia, e informativa con oficios judiciales); y 5) Carta documento / Interpelación prejudicial para constitución en mora e interrupción de prescripción (art. 2541 CCyC). Los escritos pueden descargarse en formato Microsoft Word (.docx) con estilo y márgenes judiciales o en Markdown.',

    secFaqTitle: 'Preguntas Frecuentes del Letrado Litigante',
    secFaqDesc: 'Respuestas directas sobre la validez, seguridad y mejores prácticas en el despacho.',
    secFaqContent: '1. ¿Puede el juzgado saber que usé un asistente? No; los escritos generados se descargan como documentos de texto ordinarios que usted revisa, ajusta con su firma ológrafa o digital y sube al portal del tribunal como cualquier escrito redactado en su procesador de textos habitual.\n2. ¿Es necesario revisar las citas de jurisprudencia y doctrina? Absolutamente sí. Toda cita debe someterse a compulsa de los fallos originales en los repertorios judiciales (Fallos CSJN, elDial, La Ley, SAIJ) antes de la suscripción del escrito.\n3. ¿Se borran mis expedientes si cierro el navegador? No; los expedientes se guardan de forma permanente en la base de datos local de su perfil de usuario en el equipo.',
  },
  en: {
    title: 'Forensic Manual & Lawyer Guide',
    subtitle: 'Practical instructions on procedural law, professional secrecy, and judicial brief drafting for legal practitioners.',
    badgeForensic: 'Forensic Practice',
    badgeConfidentiality: 'Attorney-Client Privilege',
    badgeCivilProcedure: 'Procedural Code / Civil Code',
    searchPlaceholder: 'Search by topic, statutory rule (e.g. 330, Law 48, deadlines), plea, or proceeding...',
    noResults: 'No legal topics matched your search criteria.',
    clearSearch: 'Clear search',
    filterAll: 'All legal areas',
    copiedPrompt: 'Procedural instruction copied to clipboard!',
    copyPromptButton: 'Copy drafting instruction for AI assistant',
    legalBasis: 'Statutory and procedural basis:',
    forensicTip: 'Forensic drafting tip:',
    practicalExample: 'Model prompt instruction for the chat assistant:',

    catPrivacy: 'Professional Secrecy & Privacy',
    catCases: 'Case File & Matter Management',
    catDeadlines: 'Court Deadlines Computation',
    catAdversarial: 'Forensic Adversarial Analysis',
    catDrafting: 'Long Brief Drafting by Chapters',
    catAuditor: 'Forensic Document Audit',
    catTemplates: 'Court Templates & Word Export',
    catFaq: 'Attorney FAQs',

    secPrivacyTitle: 'Professional secrecy, confidentiality, and local storage',
    secPrivacyDesc: 'Guaranteed custody of client records without intermediate cloud servers or procedural data leaks.',
    secPrivacyContent: 'In OpenHer Chat, client case records (parties, facts, timelines, documents, and drafts) are never stored in third-party clouds or shared servers. They reside exclusively in the local database of your own device (desktop or mobile). API keys remain encrypted on your device. This guarantees total compliance with attorney-client confidentiality and procedural secrecy.',

    secCasesTitle: 'Structuring the Case Matter and Court Header',
    secCasesDesc: 'How to record jurisdiction, client procedural capacity, parties, and factual chronology.',
    secCasesContent: 'Before drafting, set the Court jurisdiction, venue, and docket number. Specify your client role (plaintiff, defendant, third party). In Parties, record individual and legal entities with their domicile. In Facts, input chronology with date, place, and circumstances to automatically supply briefs and evidence.',

    secDeadlinesTitle: 'Procedural Deadlines and Grace Period Computation',
    secDeadlinesDesc: 'Automated calculation of court business days, ministerial notifications, and the 2-hour grace period.',
    secDeadlinesContent: 'The deadline calculator computes court business days excluding weekends, national holidays, and judicial recesses. It supports personal, subpoena, or ministerial notifications ("por nota" on Tuesdays and Fridays), and automatically calculates the grace period (first two business hours of the following court day under art. 124 CPCCN).',

    secAdversarialTitle: 'Forensic Adversarial Analysis: Devil\'s Advocate',
    secAdversarialDesc: 'Pre-filing scrutiny from the opponent\'s counsel and judge\'s perspectives.',
    secAdversarialContent: 'The adversarial engine tests your claim against potential preliminary pleas (art. 347 CPCCN): statute of limitations under Civil Code, lack of standing/capacity, jurisdiction defects, legal vagueness in the complaint (art. 330), and lis pendens. It also audits the burden of proof (art. 377 CPCCN) highlighting unsubstantiated factual allegations.',

    secDraftingTitle: 'Drafting Long Briefs by Chapters (Anti-Truncation)',
    secDraftingDesc: 'Proven methodology for creating 10 to 30 page briefs without AI cuts or vague summaries.',
    secDraftingContent: 'All language models have generation output limits. Requesting a full 20-page brief in one turn causes cuts or vague placeholders. Our Chapter Drafting engine divides work into independent sections (Object, Parties, Facts, Law, Evidence, Federal Reserve, Petition) and generates targeted prompts that enforce exhaustive detail without summaries.',

    secAuditorTitle: 'Forensic Document Audit & Federal Question Reservation',
    secAuditorDesc: 'Estimated judicial folio counts, pending placeholder detection, and Supreme Court federal reservation check.',
    secAuditorContent: 'The Forensic Audit tab evaluates the draft in real time: estimates judicial pages (~350 words per court folio), identifies unresolved placeholders ([COMPLETAR ...], [VERIFICAR ...]), and checks for the mandatory Federal Question Reservation (Law 48 art. 14) and explicit prayers for relief with court costs.',

    secTemplatesTitle: 'Canonical Court Templates & Word Export',
    secTemplatesDesc: 'Pre-formatted templates and .docx export ready for court filing portals.',
    secTemplatesContent: 'Includes five canonical templates: Complaint (art. 330 CPCCN), Answer & Pleas (arts. 346-356), Appeal & Grievances (art. 265), Comprehensive Evidence (witness questionnaires, interrogatories, expert inquiries, sub-poenas), and Demand Letter (art. 2541 CCyC). All can be exported to Microsoft Word (.docx) or Markdown.',

    secFaqTitle: 'Litigator Frequently Asked Questions',
    secFaqDesc: 'Direct answers regarding validity, confidentiality, and everyday law office workflows.',
    secFaqContent: '1. Does the court know AI was used? No; briefs are exported as standard Word documents for your review and official signature.\n2. Must citations be verified? Yes; always confirm precedents and statutory provisions against official legal digests.\n3. Are files lost upon closing the browser? No; all matters remain safely stored in your local profile.',
  },
});

export type LegalManualMessages = (typeof legalManual)['es'];

declare module '../types' {
  interface I18nSchema {
    legalManual: LegalManualMessages;
  }
}
