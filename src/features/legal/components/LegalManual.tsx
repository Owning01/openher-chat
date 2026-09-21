import { useState, useMemo } from 'react';
import type { MessageKey } from '@/i18n/types';
import { useT } from '@/i18n/useT';
import {
  BookOpen,
  Check,
  Copy,
  Info,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  ChevronDown,
  ChevronRight,
} from '@/shared/icons';
import { Badge, Button, Input, useToast } from '@/shared/ui';

export type ManualCategory =
  | 'all'
  | 'privacy'
  | 'cases'
  | 'deadlines'
  | 'adversarial'
  | 'drafting'
  | 'auditor'
  | 'templates'
  | 'faq';

export interface ManualSection {
  id: string;
  category: Exclude<ManualCategory, 'all'>;
  titleKey: MessageKey;
  descKey: MessageKey;
  contentKey: MessageKey;
  legalBasis: string;
  forensicTip: string;
  practicalPrompt?: string;
}

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: 'sec-privacy',
    category: 'privacy',
    titleKey: 'legalManual.secPrivacyTitle',
    descKey: 'legalManual.secPrivacyDesc',
    contentKey: 'legalManual.secPrivacyContent',
    legalBasis: 'Ley 23.187 art. 6 inc. f (Secreto Profesional); CPCCN art. 244; Ley 25.326 de Protección de Datos Personales.',
    forensicTip: 'Aunque el almacenamiento es estrictamente local en su equipo, en asuntos de extrema reserva (derecho de familia o secretos comerciales) es aconsejable testar o sustituir nombres propios por iniciales antes de solicitar análisis complejos al asistente.',
    practicalPrompt: 'Actúa como asistente legal forense. Mantén reserva absoluta de las circunstancias de este caso. Analiza las siguientes cláusulas contractuales identificando riesgos de nulidad relativa o absoluta sin almacenar datos de filiación.',
  },
  {
    id: 'sec-cases',
    category: 'cases',
    titleKey: 'legalManual.secCasesTitle',
    descKey: 'legalManual.secCasesDesc',
    contentKey: 'legalManual.secCasesContent',
    legalBasis: 'CPCCN arts. 40 (domicilios), 46 y 47 (personería), 330 incs. 1 y 2 (individualización de partes).',
    forensicTip: 'Una cronología minuciosa en la pestaña Hechos evita contradicciones con la prueba documental que acompañe. Asigne a cada hecho una fecha y documento de respaldo (ej: acta notarial, carta documento o factura).',
    practicalPrompt: 'A partir de los siguientes hechos cronológicos del expediente, ordena una relación circunstanciada de los acontecimientos para el capítulo de HECHOS de una demanda por incumplimiento contractual, destacando la fecha de constitución en mora.',
  },
  {
    id: 'sec-deadlines',
    category: 'deadlines',
    titleKey: 'legalManual.secDeadlinesTitle',
    descKey: 'legalManual.secDeadlinesDesc',
    contentKey: 'legalManual.secDeadlinesContent',
    legalBasis: 'CPCCN arts. 124 (plazo de gracia), 133 (notificación por nota), 155 a 159 (cómputo de plazos procesales).',
    forensicTip: 'Recuerde que el plazo de gracia rige para las dos primeras horas hábiles del día inmediato posterior. Si el juzgado habilita mesa de entradas a las 7:30 hs, el plazo vence a las 9:30 hs. Ante la duda o contingencia técnica en los portales electrónicos, presente siempre el escrito antes de las 24:00 hs del día del vencimiento ordinario.',
    practicalPrompt: 'Calcula el vencimiento fatal y el plazo de gracia (art. 124 CPCCN) para contestar el traslado de una demanda ordinaria en la Justicia Nacional en lo Civil notificada por cédula física el día miércoles 15 de octubre.',
  },
  {
    id: 'sec-adversarial',
    category: 'adversarial',
    titleKey: 'legalManual.secAdversarialTitle',
    descKey: 'legalManual.secAdversarialDesc',
    contentKey: 'legalManual.secAdversarialContent',
    legalBasis: 'CPCCN art. 347 (excepciones previas), 356 (contestación de demanda) y 377 (carga de la prueba).',
    forensicTip: 'Someter la demanda al test adversarial antes de iniciarla le ahorra meses de trámites incidentales. Si el asistente detecta riesgo de incompetencia o prescripción, adecue la pretensión o promueva medidas preparatorias para interrumpir el plazo antes de notificar el traslado.',
    practicalPrompt: 'Ponte en el rol de letrado patrocinante de la parte demandada. Lee la siguiente pretensión e identifica qué excepciones previas del art. 347 del CPCCN opondrías con mayor probabilidad de prosperar, señalando además qué hechos afirmados carecen de prueba concluyente.',
  },
  {
    id: 'sec-drafting',
    category: 'drafting',
    titleKey: 'legalManual.secDraftingTitle',
    descKey: 'legalManual.secDraftingDesc',
    contentKey: 'legalManual.secDraftingContent',
    legalBasis: 'CPCCN arts. 330 (requisitos de la demanda) y 265 (expresión de agravios con crítica concreta y razonada).',
    forensicTip: 'No pida un escrito de 20 páginas en una sola instrucción. Vaya al Estudio de Redacción, seleccione el capítulo deseado (ej. "Primer Agravio" o "Prueba Pericial") y utilice el botón de copiar instrucción para generar cada acápite con la máxima extensión y fundamentación posible.',
    practicalPrompt: 'Redacta con exhaustividad procesal el capítulo "II. HECHOS" de la demanda. Desarrolla cronológicamente cada suceso con precisión de fechas, sujetos y consecuencias jurídicas. Prohibido resumir o emplear fórmulas genéricas: elabora el relato completo a nivel de detalle judicial.',
  },
  {
    id: 'sec-auditor',
    category: 'auditor',
    titleKey: 'legalManual.secAuditorTitle',
    descKey: 'legalManual.secAuditorDesc',
    contentKey: 'legalManual.secAuditorContent',
    legalBasis: 'Ley 48 art. 14 (Cuestión Federal y Recurso Extraordinario); Acordadas CSJN 4/2007 y 12/2014.',
    forensicTip: 'La Reserva del Caso Federal debe formularse en la primera oportunidad procesal oportuna (demanda o contestación). Omitir esta reserva puede provocar la inadmisibilidad formal del Recurso Extraordinario Federal por falta de oportuno planteo constitucional.',
    practicalPrompt: 'Formula una cláusula procesal rigurosa de Reserva del Caso Federal en los términos del art. 14 de la Ley 48, invocando la vulneración de las garantías de debido proceso (art. 18 CN) y derecho de propiedad (art. 17 CN) para interponer oportunamente Recurso Extraordinario Federal ante la CSJN.',
  },
  {
    id: 'sec-templates',
    category: 'templates',
    titleKey: 'legalManual.secTemplatesTitle',
    descKey: 'legalManual.secTemplatesDesc',
    contentKey: 'legalManual.secTemplatesContent',
    legalBasis: 'CPCCN arts. 330, 346, 356, 387, 426, 458; Código Civil y Comercial art. 2541 (interpelación fehaciente).',
    forensicTip: 'Al exportar a Word (.docx), el documento respeta el espaciado e interlineado judicial habitual. Puede abrirlo directamente en Microsoft Word o LibreOffice para incorporar el número de expediente asignado y estampar la firma digital del letrado patrocinante o apoderado.',
    practicalPrompt: 'Sobre la base del reclamo de autos, redacta los puntos de pericia contable y médica para el ofrecimiento de prueba, formulando preguntas precisas y asertivas para que el perito determine el lucro cesante y la incapacidad sobreviniente.',
  },
  {
    id: 'sec-faq',
    category: 'faq',
    titleKey: 'legalManual.secFaqTitle',
    descKey: 'legalManual.secFaqDesc',
    contentKey: 'legalManual.secFaqContent',
    legalBasis: 'Leyes de aranceles y ejercicio profesional de la abogacía en el ámbito federal y provincial.',
    forensicTip: 'El software es una herramienta de asistencia y optimización de redacción forense. La dirección técnica del litigio, el análisis de congruencia y la responsabilidad profesional ante los tribunales corresponden con exclusividad al letrado firmante.',
    practicalPrompt: 'Revisa este escrito judicial antes de su presentación en tribunales y compila una lista de control con: 1) Verificación de personería invocada; 2) Precisión de la liquidación; 3) Claridad del petitorio y 4) Planteo de costas.',
  },
];

export interface LegalManualProps {
  className?: string;
  defaultCategory?: ManualCategory;
}

export function LegalManual({ className = '', defaultCategory = 'all' }: LegalManualProps) {
  const t = useT();
  const { push } = useToast();
  const [category, setCategory] = useState<ManualCategory>(defaultCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    // Expand first 3 by default
    return {
      'sec-privacy': true,
      'sec-cases': true,
      'sec-drafting': true,
    };
  });
  const [copiedSectionId, setCopiedSectionId] = useState<string | null>(null);

  const categories = useMemo<{ id: ManualCategory; label: string }[]>(
    () => [
      { id: 'all', label: t('legalManual.filterAll') },
      { id: 'privacy', label: t('legalManual.catPrivacy') },
      { id: 'cases', label: t('legalManual.catCases') },
      { id: 'deadlines', label: t('legalManual.catDeadlines') },
      { id: 'adversarial', label: t('legalManual.catAdversarial') },
      { id: 'drafting', label: t('legalManual.catDrafting') },
      { id: 'auditor', label: t('legalManual.catAuditor') },
      { id: 'templates', label: t('legalManual.catTemplates') },
      { id: 'faq', label: t('legalManual.catFaq') },
    ],
    [t],
  );

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return MANUAL_SECTIONS.filter((sec) => {
      if (category !== 'all' && sec.category !== category) return false;
      if (!q) return true;

      const title = t(sec.titleKey).toLowerCase();
      const desc = t(sec.descKey).toLowerCase();
      const content = t(sec.contentKey).toLowerCase();
      const basis = sec.legalBasis.toLowerCase();
      const tip = sec.forensicTip.toLowerCase();

      return (
        title.includes(q) ||
        desc.includes(q) ||
        content.includes(q) ||
        basis.includes(q) ||
        tip.includes(q)
      );
    });
  }, [category, searchQuery, t]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    MANUAL_SECTIONS.forEach((s) => {
      next[s.id] = true;
    });
    setExpandedSections(next);
  };

  const collapseAll = () => {
    setExpandedSections({});
  };

  const handleCopyPrompt = async (sectionId: string, promptText: string) => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedSectionId(sectionId);
      push({
        title: t('legalManual.copiedPrompt'),
        variant: 'success',
      });
      window.setTimeout(() => {
        setCopiedSectionId((curr) => (curr === sectionId ? null : curr));
      }, 2500);
    } catch {
      // Ignorar fallo de portapapeles si el contexto no lo permite
    }
  };

  return (
    <div
      data-testid="legal-manual"
      className={`flex flex-col gap-6 max-w-5xl mx-auto p-4 sm:p-6 text-text ${className}`}
    >
      {/* Encabezado del Manual Forense */}
      <header className="flex flex-col gap-3 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary" className="gap-1.5 py-1 px-2.5 font-medium">
            <Scale className="size-3.5" aria-hidden="true" />
            {t('legalManual.badgeForensic')}
          </Badge>
          <Badge variant="neutral" className="gap-1.5 py-1 px-2.5">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            {t('legalManual.badgeConfidentiality')}
          </Badge>
          <Badge variant="neutral" className="py-1 px-2.5">
            {t('legalManual.badgeCivilProcedure')}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <BookOpen className="size-7 text-primary shrink-0" aria-hidden="true" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">
            {t('legalManual.title')}
          </h1>
        </div>
        <p className="text-sm sm:text-base text-muted max-w-3xl leading-relaxed">
          {t('legalManual.subtitle')}
        </p>
      </header>

      {/* Controles de Búsqueda y Filtros */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
          <Input
            data-testid="legal-manual-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('legalManual.searchPlaceholder')}
            className="pl-9 pr-8 w-full"
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label={t('legalManual.clearSearch')}
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {/* Píldoras de Materia */}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Categorías">
          {categories.map((cat) => {
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`manual-filter-${cat.id}`}
                onClick={() => setCategory(cat.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-surface border border-border text-muted hover:text-text hover:bg-surface-subtle'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Acciones de expandir / colapsar */}
        <div className="flex items-center justify-between pt-2 text-xs text-muted">
          <span>
            {filteredSections.length}{' '}
            {filteredSections.length === 1 ? 'materia encontrada' : 'materias encontradas'}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={expandAll}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              Expandir todo
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={collapseAll}
              className="hover:text-primary transition-colors cursor-pointer"
            >
              Colapsar todo
            </button>
          </div>
        </div>
      </div>

      {/* Listado de Secciones Procesales */}
      {filteredSections.length === 0 ? (
        <div
          data-testid="manual-no-results"
          className="flex flex-col items-center justify-center p-12 text-center rounded-lg border border-dashed border-border bg-surface-subtle/30"
        >
          <Info className="size-10 text-muted mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-text">{t('legalManual.noResults')}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="manual-reset-search"
            onClick={() => {
              setSearchQuery('');
              setCategory('all');
            }}
            className="mt-3"
          >
            {t('legalManual.clearSearch')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredSections.map((sec) => {
            const isExpanded = expandedSections[sec.id] ?? false;
            const isCopied = copiedSectionId === sec.id;

            return (
              <article
                key={sec.id}
                data-testid={`manual-section-${sec.id}`}
                className="rounded-lg border border-border bg-surface shadow-xs transition-shadow hover:shadow-sm overflow-hidden"
              >
                {/* Cabecera de la Materia */}
                <button
                  type="button"
                  onClick={() => toggleSection(sec.id)}
                  className="flex w-full items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-surface-subtle/50 cursor-pointer"
                  aria-expanded={isExpanded}
                >
                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                        {t(`legalManual.cat${sec.category.charAt(0).toUpperCase() + sec.category.slice(1)}` as never)}
                      </span>
                    </div>
                    <h2 className="text-base sm:text-lg font-semibold text-text">
                      {t(sec.titleKey as never)}
                    </h2>
                    <p className="text-xs sm:text-sm text-muted">{t(sec.descKey as never)}</p>
                  </div>
                  <div className="shrink-0 pt-1 text-muted">
                    {isExpanded ? (
                      <ChevronDown className="size-5" />
                    ) : (
                      <ChevronRight className="size-5" />
                    )}
                  </div>
                </button>

                {/* Contenido Desplegable */}
                {isExpanded ? (
                  <div className="border-t border-border/60 p-4 sm:p-5 flex flex-col gap-4 bg-background/50 text-sm leading-relaxed">
                    {/* Explicación en lenguaje legal */}
                    <div className="whitespace-pre-line text-text/90">
                      {t(sec.contentKey as never)}
                    </div>

                    {/* Fundamento legal y procesal */}
                    <div className="rounded-md border border-border/80 bg-surface-subtle/40 p-3 text-xs flex flex-col gap-1">
                      <span className="font-semibold text-text flex items-center gap-1.5">
                        <Scale className="size-3.5 text-primary" aria-hidden="true" />
                        {t('legalManual.legalBasis')}
                      </span>
                      <span className="text-muted italic">{sec.legalBasis}</span>
                    </div>

                    {/* Consejo Forense Práctico */}
                    <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs flex flex-col gap-1">
                      <span className="font-semibold text-warning-foreground flex items-center gap-1.5">
                        <ShieldCheck className="size-3.5 text-warning" aria-hidden="true" />
                        {t('legalManual.forensicTip')}
                      </span>
                      <span className="text-text/90">{sec.forensicTip}</span>
                    </div>

                    {/* Instrucción modelo para el asistente de IA con botón de copiado */}
                    {sec.practicalPrompt ? (
                      <div className="rounded-md border border-primary/25 bg-primary/5 p-3 text-xs flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-primary flex items-center gap-1.5">
                            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
                            {t('legalManual.practicalExample')}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleCopyPrompt(sec.id, sec.practicalPrompt ?? '')}
                            icon={
                              isCopied ? (
                                <Check className="size-3.5 text-success" />
                              ) : (
                                <Copy className="size-3.5" />
                              )
                            }
                            className="h-7 text-xs px-2"
                          >
                            {isCopied ? '¡Copiado!' : t('legalManual.copyPromptButton')}
                          </Button>
                        </div>
                        <p className="font-mono text-xs bg-surface/80 border border-border/60 rounded p-2.5 text-text select-all whitespace-pre-wrap">
                          {sec.practicalPrompt}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
