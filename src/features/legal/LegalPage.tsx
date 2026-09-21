import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { chatHref, legalHref, navigate, useRoute } from '@/app/routing';
import { useServices } from '@/app/services';
import type { CreateLegalCaseInput, LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import { truncateText } from '@/domain/chat/truncateText';
import { buildCaseBrief } from '@/domain/legal/brief';
import { buildLegalSystemPrompt } from '@/domain/legal/prompt';
import { searchLegalPassages } from '@/domain/legal/retrieval';
import { DEFAULT_LEGAL_ANALYSIS_BUDGET, DEFAULT_LEGAL_RETRIEVAL_BUDGET } from '@/domain/settings/defaults';
import type {
  LegalAnalysisBudget,
  LegalCase,
  LegalFact,
  LegalIndex,
  LegalParty,
  LegalPassage,
  LegalRetrievalBudget,
} from '@/domain/types/legal';
import type { ProviderConfig } from '@/domain/types/provider';
import type { AppSettings } from '@/domain/types/settings';
import { LocalProviderConfigRepository } from '@/features/settings/state/providerStorage';
import { useT } from '@/i18n/useT';
import { BookOpen, Plus } from '@/shared/icons';
import { Badge, Button, Dialog, Spinner } from '@/shared/ui';

import { AdversarialPanel } from './components/AdversarialPanel';
import { DocumentStudio } from './components/DocumentStudio';
import { LegalManual } from './components/LegalManual';
import { CaseForm } from './components/CaseForm';
import { CaseList } from './components/CaseList';
import { DeadlineCalculator } from './components/DeadlineCalculator';
import { PartyFormDialog } from './components/PartyFormDialog';
import { FactFormDialog } from './components/FactFormDialog';
import { KeyDateFormDialog } from './components/KeyDateFormDialog';
import { CaseStoreProvider, createCaseStore, useCaseStore } from './state/caseStore';
import { AnalysisStoreProvider, createAnalysisStore, useAnalysisStore } from './state/analysisStore';
import type { AnalysisStore, ExecuteAdversarialCall } from './state/analysisStore';
import { CitationGuardProvider } from './state/CitationGuardContext';

/** Página de expedientes: crea el store contra los servicios y delega el contenido. */
export function LegalPage() {
  const services = useServices();
  const [store] = useState(() => {
    const cases = services.legalCases;
    if (cases === undefined) return null;
    return createCaseStore({ cases, conversations: services.conversations });
  });

  if (store === null) {
    return <LegalUnavailable />;
  }
  return (
    <CaseStoreProvider store={store}>
      <LegalPageContent />
    </CaseStoreProvider>
  );
}

/** Proveedor y modelo activos para `executeCall` (resueltos de settings + catálogo). */
interface LegalProviderTarget {
  providerId: string;
  modelId: string;
  config: ProviderConfig;
}

/** Estado del corpus visible en la página (mínimo, sin bloquear). */
type LegalCorpusStatus = 'loading' | 'ready' | 'error';

function LegalPageContent() {
  const t = useT();
  const services = useServices();
  const route = useRoute();
  const routeCaseId = route.name === 'legal' ? route.caseId : null;
  const routeConversationId = route.name === 'legal' ? route.conversationId : null;

  const cases = useCaseStore((state) => state.cases);
  const selectedId = useCaseStore((state) => state.selectedId);
  const status = useCaseStore((state) => state.status);
  const error = useCaseStore((state) => state.error);
  const list = useCaseStore((state) => state.list);
  const create = useCaseStore((state) => state.create);
  const update = useCaseStore((state) => state.update);
  const select = useCaseStore((state) => state.select);
  const selected = useCaseStore((state) => state.selected);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Corpus e índice (G1): al montar se dispara `syncFromManifest()` y luego
  // `ensureIndex()`, con estado visible mínimo y sin bloquear la página. Sin
  // corpus o con fallo, el índice queda `null`: el guard es neutro, el panel
  // muestra el aviso y el estudio igual se monta (no exige índice).
  const [corpusStatus, setCorpusStatus] = useState<LegalCorpusStatus>('loading');
  const [legalIndex, setLegalIndex] = useState<LegalIndex | null>(null);
  useEffect(() => {
    const corpus = services.legalCorpus;
    if (corpus === undefined) {
      setCorpusStatus('error');
      setLegalIndex(null);
      return;
    }
    let alive = true;
    void (async () => {
      // `syncFromManifest` nunca lanza por contrato; el try es red de seguridad.
      try {
        await corpus.syncFromManifest();
      } catch {
        // Se sigue a `ensureIndex` con lo instalado que haya.
      }
      if (!alive) return;
      try {
        const index = await corpus.ensureIndex();
        if (alive) {
          setLegalIndex(index);
          setCorpusStatus('ready');
        }
      } catch {
        if (alive) {
          setLegalIndex(null);
          setCorpusStatus('error');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [services]);

  // Settings + proveedor activo para `executeCall` (G1): misma fuente de
  // catálogo que `chatStore` (`LocalProviderConfigRepository`). Sin settings o
  // sin proveedores se usan los presupuestos por defecto y el panel explica
  // que falta proveedor (claves existentes, sin bloquear la página).
  const [settingsSnapshot, setSettingsSnapshot] = useState<AppSettings | null>(null);
  const [providerTarget, setProviderTarget] = useState<LegalProviderTarget | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      let loaded: AppSettings | null = null;
      try {
        loaded = await services.settings.load();
      } catch {
        loaded = null;
      }
      if (!alive) return;
      setSettingsSnapshot(loaded);
      let providers: ProviderConfig[] = [];
      try {
        providers = await new LocalProviderConfigRepository().load();
      } catch {
        providers = [];
      }
      if (!alive) return;
      setProviderTarget(resolveLegalTarget(loaded, providers));
    })();
    return () => {
      alive = false;
    };
  }, [services]);

  // Ejecuta UNA llamada adversarial con el proveedor activo (G1):
  // `services.createAdapter` + `streamChat` recolectando `text-delta`, como el
  // turno del chat (ver `chatStore.runTurn`, sólo como referencia).
  const executeLegalCall = useCallback<ExecuteAdversarialCall>(
    async (descriptor, signal) => {
      const target = providerTarget;
      if (target === null) throw new Error('Sin proveedor configurado para el análisis.');
      const adapter = await services.createAdapter(target.config);
      if (signal.aborted) throw abortError();
      let text = '';
      for await (const event of adapter.streamChat({
        modelId: target.modelId,
        system: descriptor.system,
        messages: [{ role: 'user', content: descriptor.user }],
        maxOutputTokens: descriptor.maxOutputTokens,
        signal,
        sessionId: descriptor.sessionId,
      })) {
        if (signal.aborted) throw abortError();
        if (event.type === 'text-delta') text += event.delta;
      }
      if (signal.aborted) throw abortError();
      return text;
    },
    [services, providerTarget],
  );

  // El store se crea una sola vez; el `executeCall` vigente entra por ref para
  // no recrearlo cuando se resuelve el proveedor. Sin `legalCases` no hay
  // store (red de seguridad: `LegalPage` ya degradó a `LegalUnavailable`).
  const executeCallRef = useRef<ExecuteAdversarialCall>(() =>
    Promise.reject(new Error('Análisis no listo.')),
  );
  useEffect(() => {
    executeCallRef.current = executeLegalCall;
  }, [executeLegalCall]);
  const [analysisStore] = useState<AnalysisStore | null>(() => {
    const cases = services.legalCases;
    if (cases === undefined) return null;
    return createAnalysisStore({
      cases,
      executeCall: (descriptor, signal) => executeCallRef.current(descriptor, signal),
    });
  });

  useEffect(() => {
    void list();
  }, [list]);

  // La URL manda: un `#/legal/:caseId` selecciona el expediente al entrar o navegar.
  useEffect(() => {
    if (routeCaseId !== null) select(routeCaseId);
  }, [routeCaseId, select]);

  const selectedCase = selected();
  const saving = status === 'saving';

  // Brief, scaffold y presupuestos del análisis (G1): del caso + índice +
  // settings (con defaults si la carga falló). El brief nunca lanza.
  const budgets: LegalAnalysisBudget = settingsSnapshot?.legal.analysis ?? DEFAULT_LEGAL_ANALYSIS_BUDGET;
  const retrieval: LegalRetrievalBudget =
    settingsSnapshot?.legal.retrieval ?? DEFAULT_LEGAL_RETRIEVAL_BUDGET;
  const legalSystem = useMemo(
    () =>
      buildLegalSystemPrompt({
        locale: settingsSnapshot?.locale ?? 'es',
        perspectives: settingsSnapshot?.legal.perspectives,
        today: new Date(Date.now()).toISOString(),
      }),
    [settingsSnapshot],
  );
  const legalBrief = useMemo(
    () => (selectedCase === null ? '' : buildLegalBriefText(selectedCase, legalIndex, retrieval)),
    [selectedCase, legalIndex, retrieval],
  );

  const handleSelect = (id: string): void => {
    select(id);
    navigate(legalHref(id, routeConversationId));
  };

  const handleUpdateCase = useCallback(
    async (patch: Partial<Omit<LegalCase, 'id' | 'createdAt'>>) => {
      if (selectedCase === null) return;
      await update(selectedCase.id, patch);
    },
    [update, selectedCase],
  );

  const handleCreate = async (input: CreateLegalCaseInput): Promise<void> => {
    setSubmitError(null);
    const created = await create(input);
    if (created === null) {
      setSubmitError(t('legalCases.createError'));
      return;
    }
    setDialogOpen(false);
    navigate(legalHref(created.id, routeConversationId));
  };

  const page = (
    <section data-testid="legal-page" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-text">{t('legalCases.title')}</h2>
        <Button
          type="button"
          size="sm"
          data-testid="legal-new-case"
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => {
            setSubmitError(null);
            setDialogOpen(true);
          }}
        >
          {t('legalCases.newCase')}
        </Button>
      </header>
      {corpusStatus === 'loading' ? (
        <p
          role="status"
          data-testid="legal-corpus-loading"
          className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-muted"
        >
          {t('legalCases.loading')}
        </p>
      ) : corpusStatus === 'error' ? (
        <p
          role="alert"
          data-testid="legal-corpus-error"
          className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-warning"
        >
          {t('legalAnalysis.loadError')}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="w-full shrink-0 border-b border-border lg:w-80 lg:border-b-0 lg:border-r">
          <div className="h-full overflow-y-auto">
            <CaseList
              cases={cases}
              selectedId={selectedId}
              status={status}
              error={error}
              onSelect={handleSelect}
              onRetry={() => void list()}
            />
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <CaseDetail
            legalCase={selectedCase}
            conversationId={routeConversationId}
            onUpdateCase={handleUpdateCase}
            className="h-full"
            analysisSlot={
              analysisStore === null ? (
                <p className="mt-1 text-xs text-warning">{t('legalAnalysis.loadError')}</p>
              ) : (
                <AnalysisStoreProvider store={analysisStore}>
                  <LegalAnalysisMount
                    legalCase={selectedCase}
                    brief={legalBrief}
                    systemPrompt={legalSystem}
                    budgets={budgets}
                    index={legalIndex}
                    corpusStatus={corpusStatus}
                    providerTarget={providerTarget}
                    executeCall={executeLegalCall}
                  />
                </AnalysisStoreProvider>
              )
            }
            documentsSlot={
              <LegalDocumentsMount
                legalCase={selectedCase}
                index={legalIndex}
                cases={services.legalCases}
              />
            }
          />
        </div>
      </div>

      <Dialog open={dialogOpen} title={t('legalCases.createTitle')} onClose={() => setDialogOpen(false)}>
        {saving && cases.length === 0 ? (
          <div className="grid place-items-center p-6">
            <Spinner label={t('legalCases.loading')} />
          </div>
        ) : (
          <CaseForm
            pending={saving}
            submitError={submitError}
            onSubmit={(input) => void handleCreate(input)}
            onCancel={() => setDialogOpen(false)}
          />
        )}
      </Dialog>
    </section>
  );

  // Guard de citas (G1): igual que en `ChatPage`, sólo con índice resuelto se
  // monta el provider; sin índice el guard es neutro y nada cambia.
  if (legalIndex === null) return page;
  return <CitationGuardProvider index={legalIndex}>{page}</CitationGuardProvider>;
}

interface CaseDetailProps {
  legalCase: LegalCase | null;
  conversationId: string | null;
  className?: string;
  analysisSlot: ReactNode;
  documentsSlot: ReactNode;
  onUpdateCase?: (patch: Partial<Omit<LegalCase, 'id' | 'createdAt'>>) => Promise<void>;
}

type LegalTab = 'case' | 'deadlines' | 'analysis' | 'documents' | 'manual';

/** Detalle del expediente con tabs de trabajo y CRUD interactivo de partes, hechos y fechas. */
function CaseDetail({
  legalCase,
  conversationId,
  className,
  analysisSlot,
  documentsSlot,
  onUpdateCase,
}: CaseDetailProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<LegalTab>('case');

  const [partyDialogOpen, setPartyDialogOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<LegalParty | null>(null);

  const [factDialogOpen, setFactDialogOpen] = useState(false);
  const [editingFact, setEditingFact] = useState<LegalFact | null>(null);

  const [dateDialogOpen, setDateDialogOpen] = useState(false);

  if (legalCase === null) {
    return (
      <aside
        data-testid="legal-detail"
        aria-label={t('legalCases.title')}
        className={`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-surface-subtle/30 p-4 sm:p-6 ${className ?? ''}`}
      >
        <div className="flex flex-col gap-1">
          <p data-testid="legal-detail-empty" className="text-sm font-medium text-text">
            {t('legalCases.detailEmpty')}
          </p>
          <p className="text-xs text-muted">
            {t('legalManual.subtitle')}
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <LegalManual />
        </div>
      </aside>
    );
  }

  const handleSaveParty = (party: LegalParty) => {
    if (!onUpdateCase) return;
    const exists = legalCase.parties.some((p) => p.id === party.id);
    const parties = exists
      ? legalCase.parties.map((p) => (p.id === party.id ? party : p))
      : [...legalCase.parties, party];
    void onUpdateCase({ parties });
  };

  const handleDeleteParty = (partyId: string) => {
    if (!onUpdateCase) return;
    const parties = legalCase.parties.filter((p) => p.id !== partyId);
    void onUpdateCase({ parties });
  };

  const handleSaveFact = (fact: LegalFact) => {
    if (!onUpdateCase) return;
    const exists = legalCase.facts.some((f) => f.id === fact.id);
    const facts = exists
      ? legalCase.facts.map((f) => (f.id === fact.id ? fact : f))
      : [...legalCase.facts, fact];
    void onUpdateCase({ facts });
  };

  const handleDeleteFact = (factId: string) => {
    if (!onUpdateCase) return;
    const facts = legalCase.facts.filter((f) => f.id !== factId);
    void onUpdateCase({ facts });
  };

  const handleSaveKeyDate = (keyDate: { id: string; label: string; date: string }) => {
    if (!onUpdateCase) return;
    const keyDates = [...legalCase.keyDates, keyDate];
    void onUpdateCase({ keyDates });
  };

  const handleDeleteKeyDate = (keyDateId: string) => {
    if (!onUpdateCase) return;
    const keyDates = legalCase.keyDates.filter((k) => k.id !== keyDateId);
    void onUpdateCase({ keyDates });
  };

  return (
    <aside
      data-testid="legal-detail"
      aria-label={t('legalCases.title')}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-subtle/30 ${className ?? ''}`}
    >
      <header className="shrink-0 space-y-1 border-b border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-text">{legalCase.title}</h3>
            <p className="truncate text-xs text-muted">
              {legalCase.court} ·{' '}
              {legalCase.status === 'archived' ? t('legalCases.statusArchived') : t('legalCases.statusActive')}
            </p>
          </div>
          {conversationId !== null ? (
            <a
              href={chatHref(conversationId)}
              className="inline-flex items-center text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('legalCases.openChat')}
            </a>
          ) : null}
        </div>

        {/* Selector de pestañas */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2">
          <Button
            type="button"
            size="sm"
            variant={activeTab === 'case' ? 'primary' : 'ghost'}
            data-testid="tab-case"
            onClick={() => setActiveTab('case')}
          >
            {t('legalCases.tabCase')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeTab === 'deadlines' ? 'primary' : 'ghost'}
            data-testid="tab-deadlines"
            onClick={() => setActiveTab('deadlines')}
          >
            {t('legalCases.tabDeadlines')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeTab === 'analysis' ? 'primary' : 'ghost'}
            data-testid="tab-analysis"
            onClick={() => setActiveTab('analysis')}
          >
            {t('legalCases.tabAnalysis')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeTab === 'documents' ? 'primary' : 'ghost'}
            data-testid="tab-documents"
            onClick={() => setActiveTab('documents')}
          >
            {t('legalCases.tabDocuments')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeTab === 'manual' ? 'primary' : 'ghost'}
            data-testid="tab-manual"
            icon={<BookOpen aria-hidden="true" className="size-3.5" />}
            onClick={() => setActiveTab('manual')}
          >
            {t('legalManual.title')}
          </Button>
        </div>
      </header>

      {/* Tab: Expediente (Partes, Hechos, Fechas) */}
      <div className={`flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 ${activeTab === 'case' ? 'block' : 'hidden'}`}>
        <DetailSection
          title={t('legalCases.partiesTitle')}
          testId="legal-parties"
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="add-party-btn"
              icon={<Plus aria-hidden="true" className="size-3.5" />}
              onClick={() => {
                setEditingParty(null);
                setPartyDialogOpen(true);
              }}
            >
              {t('legalCases.addParty')}
            </Button>
          }
        >
          {legalCase.parties.length === 0 ? (
            <EmptyHint text={t('legalCases.emptyParties')} />
          ) : (
            <ul className="space-y-1.5">
              {legalCase.parties.map((party) => (
                <li
                  key={party.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-surface p-2 text-sm text-text shadow-2xs"
                >
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-text">{party.name}</span>
                    <span className="text-xs text-muted"> · {party.role}</span>
                    {party.taxId ? <span className="ml-1.5 text-xs text-muted">({party.taxId})</span> : null}
                    {party.representative ? (
                      <p className="truncate text-xs text-muted/80">{party.representative}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingParty(party);
                        setPartyDialogOpen(true);
                      }}
                    >
                      {t('legalCases.editParty')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteParty(party.id)}
                    >
                      ×
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>

        <DetailSection
          title={t('legalCases.factsTitle')}
          testId="legal-facts"
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="add-fact-btn"
              icon={<Plus aria-hidden="true" className="size-3.5" />}
              onClick={() => {
                setEditingFact(null);
                setFactDialogOpen(true);
              }}
            >
              {t('legalCases.addFact')}
            </Button>
          }
        >
          {legalCase.facts.length === 0 ? (
            <EmptyHint text={t('legalCases.emptyFacts')} />
          ) : (
            <ul className="space-y-2">
              {legalCase.facts.map((fact) => (
                <li
                  key={fact.id}
                  className="flex flex-col gap-1 rounded-md border border-border/50 bg-surface p-2.5 text-sm text-text shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-normal text-text">{fact.statement}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingFact(fact);
                          setFactDialogOpen(true);
                        }}
                      >
                        {t('legalCases.editFact')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteFact(fact.id)}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted">
                    {fact.date ? <span>📅 {fact.date}</span> : null}
                    <Badge
                      variant={
                        fact.certainty === 'certain'
                          ? 'success'
                          : fact.certainty === 'doubtful'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(`legalCases.certainty${capitalize(fact.certainty)}` as never) ?? fact.certainty}
                    </Badge>
                    {fact.source ? <span>Ref: {fact.source}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>

        <DetailSection
          title={t('legalCases.keyDatesTitle')}
          testId="legal-key-dates"
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="add-keydate-btn"
              icon={<Plus aria-hidden="true" className="size-3.5" />}
              onClick={() => setDateDialogOpen(true)}
            >
              {t('legalCases.addKeyDate')}
            </Button>
          }
        >
          {legalCase.keyDates.length === 0 ? (
            <EmptyHint text={t('legalCases.emptyKeyDates')} />
          ) : (
            <ul className="space-y-1">
              {legalCase.keyDates.map((keyDate) => (
                <li
                  key={keyDate.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-surface px-2.5 py-1.5 text-sm text-text shadow-2xs"
                >
                  <span className="font-medium">{keyDate.label}</span>
                  <div className="flex items-center gap-2 font-mono text-xs text-muted">
                    <span>{keyDate.date}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteKeyDate(keyDate.id)}
                    >
                      ×
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
      </div>

      {/* Tab: Plazos y Prescripción */}
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto p-4 ${activeTab === 'deadlines' ? 'block' : 'hidden'}`}>
        <DeadlineCalculator caseData={legalCase} />
      </div>

      {/* Tab: Análisis Adversarial */}
      <section
        data-testid="legal-analysis-mount"
        aria-label={t('legalCases.analysisTitle')}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto p-4 ${activeTab === 'analysis' ? 'block' : 'hidden'}`}
      >
        <h4 className="sr-only">{t('legalCases.analysisTitle')}</h4>
        <div className="mt-1">{analysisSlot}</div>
      </section>

      {/* Tab: Estudio de Documentos */}
      <section
        data-testid="legal-documents-mount"
        aria-label={t('legalCases.documentsTitle')}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto p-4 ${activeTab === 'documents' ? 'block' : 'hidden'}`}
      >
        <h4 className="sr-only">{t('legalCases.documentsTitle')}</h4>
        <div className="mt-1">{documentsSlot}</div>
      </section>

      {/* Tab: Manual Forense */}
      <section
        data-testid="legal-manual-mount"
        aria-label={t('legalManual.title')}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto p-4 ${activeTab === 'manual' ? 'block' : 'hidden'}`}
      >
        <h4 className="sr-only">{t('legalManual.title')}</h4>
        <LegalManual />
      </section>

      <PartyFormDialog
        open={partyDialogOpen}
        party={editingParty}
        onClose={() => setPartyDialogOpen(false)}
        onSave={handleSaveParty}
      />
      <FactFormDialog
        open={factDialogOpen}
        fact={editingFact}
        onClose={() => setFactDialogOpen(false)}
        onSave={handleSaveFact}
      />
      <KeyDateFormDialog
        open={dateDialogOpen}
        onClose={() => setDateDialogOpen(false)}
        onSave={handleSaveKeyDate}
      />
    </aside>
  );
}

function DetailSection({
  title,
  testId,
  action,
  children,
}: {
  title: string;
  testId: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="space-y-1.5 shrink-0">
      <div className="flex items-center justify-between border-b border-border/50 pb-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
        {action}
      </div>
      <div className="pt-0.5">{children}</div>
    </section>
  );
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs text-muted">{text}</p>;
}

/** El shell real siempre trae `legalCases`; este estado sólo cubre dobles de test incompletos. */
function LegalUnavailable() {
  const t = useT();
  return (
    <section data-testid="legal-page" className="flex min-h-0 flex-1 flex-col">
      <p role="alert" className="p-6 text-sm text-danger">
        {t('legalCases.unavailable')}
      </p>
    </section>
  );
}

interface LegalAnalysisMountProps {
  legalCase: LegalCase | null;
  brief: string;
  systemPrompt: string;
  budgets: LegalAnalysisBudget;
  index: LegalIndex | null;
  corpusStatus: LegalCorpusStatus;
  providerTarget: LegalProviderTarget | null;
  executeCall: ExecuteAdversarialCall;
}

/**
 * Slot del panel adversarial (G1): hidrata el último análisis del expediente y
 * monta `AdversarialPanel` con las props de T24, sin modificar el componente.
 * Sin índice o sin proveedor muestra el estado (cargando/error o falta de
 * proveedor) en vez del panel, sin bloquear el resto de la página.
 */
function LegalAnalysisMount(props: LegalAnalysisMountProps) {
  const t = useT();
  const { legalCase, brief, systemPrompt, budgets, index, corpusStatus, providerTarget, executeCall } = props;
  const runStatus = useAnalysisStore((state) => state.runStatus);
  const runError = useAnalysisStore((state) => state.error);
  const lastAnalysis = useAnalysisStore((state) => state.lastAnalysis);
  const list = useAnalysisStore((state) => state.list);
  const runAnalysis = useAnalysisStore((state) => state.runAnalysis);
  const stop = useAnalysisStore((state) => state.stop);
  const dismissError = useAnalysisStore((state) => state.dismissError);

  // Hidrata el último análisis persistido al cambiar de expediente.
  useEffect(() => {
    if (legalCase !== null) void list(legalCase.id);
  }, [list, legalCase?.id]);

  if (legalCase === null) return null;
  // El store puede traer el análisis de otro expediente al navegar: sólo vale el del caso.
  const analysisForCase = lastAnalysis !== null && lastAnalysis.caseId === legalCase.id ? lastAnalysis : null;

  if (index === null) {
    return corpusStatus === 'loading' ? (
      <p role="status" className="mt-1 text-xs text-muted">
        {t('legalCases.loading')}
      </p>
    ) : (
      <p role="alert" className="mt-1 text-xs text-warning">
        {t('legalAnalysis.loadError')}
      </p>
    );
  }
  if (providerTarget === null) {
    return (
      <div className="mt-1 space-y-0.5">
        <p className="text-xs font-medium text-text">{t('settings.providerEmptyTitle')}</p>
        <p className="text-xs text-muted">{t('settings.providerEmptyDescription')}</p>
      </div>
    );
  }
  return (
    <AdversarialPanel
      caseId={legalCase.id}
      brief={brief}
      systemPrompt={systemPrompt}
      budgets={budgets}
      index={index}
      executeCall={executeCall}
      providerId={providerTarget.providerId}
      modelId={providerTarget.modelId}
      runStatus={runStatus}
      runError={runError}
      lastAnalysis={analysisForCase}
      onRunAnalysis={runAnalysis}
      onStop={stop}
      onDismissError={dismissError}
    />
  );
}

interface LegalDocumentsMountProps {
  legalCase: LegalCase | null;
  index: LegalIndex | null;
  cases: LegalCaseRepository | undefined;
}

/**
 * Slot del estudio de documentos (G1): monta `DocumentStudio` con las props de
 * T24, sin modificar el componente. El índice es opcional (el estudio degrada
 * a marcado conservador) y la persistencia va directo al repositorio del caso.
 */
function LegalDocumentsMount({ legalCase, index, cases }: LegalDocumentsMountProps) {
  if (legalCase === null) return null;
  if (cases === undefined) return <DocumentStudio caseData={legalCase} index={index} />;
  return (
    <DocumentStudio
      caseData={legalCase}
      index={index}
      onAppendAcknowledgment={(record) => cases.appendAcknowledgment(record)}
      onSaveDocument={(document) => cases.appendDocument(document)}
    />
  );
}

/**
 * Proveedor/modelo para `executeCall`: misma precedencia que
 * `resolveModelTarget` en `chatStore` con conversación nula (duplicada acá a
 * propósito para no acoplar con `chatStore`, que otro worker edita en paralelo).
 */
function resolveLegalTarget(
  settings: AppSettings | null,
  providers: readonly ProviderConfig[],
): LegalProviderTarget | null {
  const activeId = settings?.activeProviderId;
  const provider =
    (activeId !== null && activeId !== undefined
      ? providers.find((entry) => entry.id === activeId)
      : undefined) ?? providers[0];
  if (provider === undefined) return null;
  const modelId =
    settings?.lastModelByProvider[provider.id] ?? provider.defaultModelId ?? provider.models[0]?.id ?? null;
  if (modelId === null) return null;
  return { providerId: provider.id, modelId, config: provider };
}

/**
 * Brief del expediente para el análisis: caso estructurado + pasajes del
 * índice acotados como en `chatStore` (sólo referencia). Nunca lanza: ante
 * cualquier fallo devuelve el brief sin pasajes o vacío.
 */
function buildLegalBriefText(
  legalCase: LegalCase,
  index: LegalIndex | null,
  retrieval: LegalRetrievalBudget,
): string {
  try {
    let passages: LegalPassage[] = [];
    if (index !== null) {
      try {
        const query = [legalCase.title, ...legalCase.facts.map((fact) => fact.statement)].join('\n');
        passages = searchLegalPassages(index, query, retrieval.maxPassages)
          .slice(0, Math.max(0, retrieval.maxPassages))
          .map((passage) => truncateLegalPassage(passage, retrieval.maxPassageChars));
      } catch {
        passages = [];
      }
    }
    return buildCaseBrief({ case: legalCase, passages });
  } catch {
    return '';
  }
}

/** Acota el pasaje a `maxPassageChars` (copia; misma regla que `chatStore`, sólo referencia). */
function truncateLegalPassage(passage: LegalPassage, maxPassageChars: number): LegalPassage {
  if (!Number.isFinite(maxPassageChars) || maxPassageChars <= 0) return passage;
  const limit = Math.max(0, Math.floor(maxPassageChars));
  const text = passage.provision.text;
  const truncated = truncateText(text, limit);
  if (truncated === text) return passage;
  return { ...passage, provision: { ...passage.provision, text: truncated } };
}

/** Error de abort con el `name` que `analysisStore` reconoce para liberar el turno sin persistir. */
function abortError(): Error {
  const error = new Error('Llamada abortada.');
  error.name = 'AbortError';
  return error;
}
