import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '@/app/services';
import { ServicesProvider } from '@/app/services';
import {
  ConversationsStoreProvider,
  createConversationsStore,
} from '@/features/conversations/state/conversationsStore';
import { CaseStoreProvider } from '@/features/legal/state/CaseStoreContext';
import { createCaseStore } from '@/features/legal/state/caseStore';
import type { CaseStore } from '@/features/legal/state/caseStore';
import { PROVIDERS_STORAGE_KEY } from '@/features/settings/state/providerStorage';
import { setLocale, t } from '@/i18n';
import { MemoryLegalCaseRepository } from '@/test/fakes/MemoryRepos';

import { ChatPage } from './ChatPage';
import { assistantMessage, userMessage } from './components/__fixtures__/messages';
import {
  createChatHarness,
  createProviderConfig,
  deferred,
  scriptFor,
  waitForAbort,
} from './state/__fixtures__/chatTestHarness';

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  setLocale('es');
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
  localStorage.clear();
  setLocale('es');
});

function renderChatPage(services: AppServices) {
  const conversations = createConversationsStore(services.conversations);
  render(
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={conversations}>
        <ChatPage />
      </ConversationsStoreProvider>
    </ServicesProvider>,
  );
  return { conversations };
}

/** Variante con expediente: monta el provider opcional del caseStore sobre el chat. */
function renderChatPageWithCases(services: AppServices, caseStore: CaseStore) {
  const conversations = createConversationsStore(services.conversations);
  render(
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={conversations}>
        <CaseStoreProvider store={caseStore}>
          <ChatPage />
        </CaseStoreProvider>
      </ConversationsStoreProvider>
    </ServicesProvider>,
  );
  return { conversations };
}

function openModesMenu(): void {
  fireEvent.click(screen.getByTestId('modes-menu-button'));
}

describe('ChatPage', () => {
  it('muestra el estado vacío con sugerencias y el composer', async () => {
    const harness = createChatHarness();
    renderChatPage(harness.services);

    const empty = await screen.findByTestId('chat-empty');
    expect(within(empty).getAllByRole('button')).toHaveLength(4);
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-streaming-indicator')).not.toBeInTheDocument();
  });

  it('carga la conversación del router con título, mensajes y modelo', async () => {
    const harness = createChatHarness();
    const conversation = await harness.repo.create({ title: 'Mi chat' });
    await harness.repo.appendMessage(
      userMessage('m1', 'hola', { conversationId: conversation.id, createdAt: 1 }),
    );
    await harness.repo.appendMessage(
      assistantMessage('m2', [{ type: 'text', text: 'respuesta' }], {
        conversationId: conversation.id,
        modelId: 'model-1',
        createdAt: 2,
      }),
    );
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    expect(await screen.findByText('Mi chat')).toBeInTheDocument();
    expect(await screen.findByText('hola')).toBeInTheDocument();
    expect(await screen.findByText('respuesta')).toBeInTheDocument();
    expect(screen.getByText('model-1')).toBeInTheDocument();
  });

  it('envía desde el composer y sincroniza la URL con la conversación creada', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    harness.provider.scripts.push(scriptFor('respuesta del modelo'));
    renderChatPage(harness.services);

    const textarea = await screen.findByRole('textbox', { name: 'Escribe un mensaje…' });
    fireEvent.change(textarea, { target: { value: 'buenas' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(await screen.findByText('respuesta del modelo')).toBeInTheDocument();
    expect(within(screen.getByTestId('chat-message-list')).getByText('buenas')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/.+/));
    expect(harness.adapterConfigs.map((config) => config.id)).toContain('provider-1');
  });

  it('un doble click en una sugerencia corre un único turno y refresca el historial', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    harness.provider.scripts.push(scriptFor('respuesta única'));
    const { conversations } = renderChatPage(harness.services);

    const empty = await screen.findByTestId('chat-empty');
    const suggestion = within(empty).getAllByRole('button')[0];
    if (suggestion === undefined) throw new Error('missing suggestion');
    fireEvent.click(suggestion);
    fireEvent.click(suggestion);

    expect(await screen.findByText('respuesta única')).toBeInTheDocument();
    // El auto-título añade una llamada lateral (`toolChoice: none`); el turno es único.
    const turnRequests = harness.provider.requests.filter((request) => request.toolChoice !== 'none');
    expect(turnRequests).toHaveLength(1);
    expect(turnRequests[0]?.messages.at(-1)?.content).toBe(suggestion.textContent);

    const conversationsInRepo = await harness.repo.list();
    expect(conversationsInRepo).toHaveLength(1);
    const persisted = await harness.repo.listMessages(conversationsInRepo[0]?.id ?? '');
    expect(persisted.map((message) => message.role)).toEqual(['user', 'assistant']);

    await waitFor(() => {
      expect(conversations.getState().items.map((item) => item.id)).toEqual([conversationsInRepo[0]?.id]);
    });
  });

  it('aborta el run en vuelo al desmontar la página', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    harness.provider.scripts.push({
      events: [{ type: 'text-delta', delta: 'parcial' }, { type: 'stop', reason: 'aborted' }],
      onEvent: async (_event, index, signal) => {
        if (index === 1) await waitForAbort(signal);
      },
    });
    renderChatPage(harness.services);

    const textarea = await screen.findByRole('textbox', { name: 'Escribe un mensaje…' });
    fireEvent.change(textarea, { target: { value: 'hola' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(await screen.findByText('parcial')).toBeInTheDocument();

    cleanup();

    await waitFor(async () => {
      const [conversation] = await harness.repo.list();
      const messages = conversation === undefined ? [] : await harness.repo.listMessages(conversation.id);
      expect(messages.at(-1)?.status).toBe('aborted');
    });
  });

  it('refleja preview y messageCount en la lista durante el turno, sin recargar', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    const gate = deferred();
    harness.provider.scripts.push({
      events: [{ type: 'text-delta', delta: 'respuesta' }, { type: 'stop', reason: 'end_turn' }],
      onEvent: async (_event, index) => {
        if (index === 0) await gate.promise;
      },
    });
    const { conversations } = renderChatPage(harness.services);

    const textarea = await screen.findByRole('textbox', { name: 'Escribe un mensaje…' });
    fireEvent.change(textarea, { target: { value: 'buenas' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      const [item] = conversations.getState().items;
      expect(item?.lastMessagePreview).toBe('buenas');
      expect(item?.messageCount).toBe(1);
    });

    gate.resolve();
    expect(await screen.findByText('respuesta')).toBeInTheDocument();
  });

  it('cambia el modelo desde el chat y lo persiste en la conversación', async () => {
    const harness = createChatHarness();
    localStorage.setItem(
      PROVIDERS_STORAGE_KEY,
      JSON.stringify([
        createProviderConfig({
          models: [
            { id: 'model-1', label: 'Model 1', source: 'manual' },
            { id: 'model-2', label: 'Model 2', source: 'manual' },
          ],
          defaultModelId: 'model-1',
        }),
      ]),
    );
    const conversation = await harness.repo.create({ title: 'Mi chat' });
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    const select = await screen.findByRole('combobox', { name: 'Modelo' });
    expect(select).toHaveValue('0');
    fireEvent.change(select, { target: { value: '1' } });

    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.modelId).toBe('model-2');
    });
  });
});

/**
 * Regresión: con una conversación cargada en el store, el efecto que sincroniza
 * la URL tras el primer envío devolvía el hash a `#/chat/:id` al salir del chat
 * (Ajustes nunca abría). El bug se reportó desde v1.0.0.
 */
describe('ChatPage - sincronización de URL', () => {
  it('no devuelve la URL al chat cuando la ruta deja de ser el chat', async () => {
    const harness = createChatHarness();
    const conversation = await harness.repo.create({ title: 'Mi chat' });
    await harness.repo.appendMessage(
      userMessage('m1', 'hola', { conversationId: conversation.id, createdAt: 1 }),
    );
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    // El mensaje visible prueba que el store ya cargó la conversación.
    expect(await screen.findByText('hola')).toBeInTheDocument();

    // Salir del chat (p. ej. Ajustes) con la página aún montada.
    window.location.hash = '#/settings';
    // Deja correr el hashchange y los efectos de React antes de mirar la URL.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(window.location.hash).toBe('#/settings');
  });
});

describe('ChatPage - menú de modos (T27)', () => {  it('abre el menú de modos desde la cabecera con el estado general', async () => {
    const harness = createChatHarness();
    renderChatPage(harness.services);

    openModesMenu();
    expect(await screen.findByTestId('modes-menu')).toBeInTheDocument();
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent('Modo general');
  });

  it('encender el modo legal sin caso crea un expediente mínimo y activa directo', async () => {
    const harness = createChatHarness();
    const caseStore = createCaseStore({ cases: new MemoryLegalCaseRepository() });
    renderChatPageWithCases(harness.services, caseStore);

    openModesMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));

    // Activación directa: sin diálogo bloqueante; el expediente mínimo queda creado.
    await waitFor(() =>
      expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'true'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(caseStore.getState().cases).toHaveLength(1);
    });
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent('Consulta sin título');
  });

  it('con un expediente existente, encender el modo lo vincula automáticamente', async () => {
    const harness = createChatHarness();
    const legalRepo = new MemoryLegalCaseRepository();
    await legalRepo.create({
      title: 'Pérez c/ Gómez',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    renderChatPageWithCases(harness.services, caseStore);

    openModesMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));

    // Activación directa: reutiliza el expediente existente sin diálogo.
    await waitFor(() =>
      expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'true'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Expediente vinculado: Pérez c/ Gómez.',
    );
  });

  it('apagar el modo legal desde el menú desvincula el expediente', async () => {
    const harness = createChatHarness();
    const legalRepo = new MemoryLegalCaseRepository();
    await legalRepo.create({
      title: 'Caso testigo',
      jurisdiction: 'caba',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    renderChatPageWithCases(harness.services, caseStore);

    openModesMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    await waitFor(() =>
      expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'true'),
    );

    openModesMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent('Modo general');
  });

  it('el switch del composer y el menú convergen al mismo estado persistido', async () => {
    const harness = createChatHarness();
    const conversation = await harness.repo.create({ title: 'Chat con modos' });
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    // Vía 1: el Switch del composer (se mantiene intacto, misma fuente).
    const researchSwitch = await screen.findByRole('switch', { name: 'Investigación' });
    await waitFor(() => expect(researchSwitch).toBeEnabled());
    fireEvent.click(researchSwitch);
    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.researchMode).toBe(true);
    });

    // El menú refleja la misma fuente sin duplicarla.
    openModesMenu();
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'true');

    // Vía 2: el menú apaga y el composer lo refleja.
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.researchMode).toBe(false);
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Investigación' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });
  });

  it('los modos son ortogonales: uno no altera el otro ni en el repo', async () => {
    const harness = createChatHarness();
    const conversation = await harness.repo.create({ title: 'Chat ortogonal' });
    window.location.hash = `#/chat/${conversation.id}`;
    const legalRepo = new MemoryLegalCaseRepository();
    const created = await legalRepo.create({
      title: 'Caso ortogonal',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    renderChatPageWithCases(harness.services, caseStore);

    // Activa el modo legal (auto-vincula el expediente): investigación sigue apagada.
    openModesMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.legalCaseId).toBe(created.id);
    });
    expect((await harness.repo.get(conversation.id))?.researchMode).toBe(false);

    // Enciende investigación: el vínculo legal queda intacto (combinación ambos).
    openModesMenu();
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.researchMode).toBe(true);
    });
    expect((await harness.repo.get(conversation.id))?.legalCaseId).toBe(created.id);
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Investigación y expediente activos: Caso ortogonal.',
    );

    // Apaga investigación: el vínculo legal sigue intacto.
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.researchMode).toBe(false);
    });
    expect((await harness.repo.get(conversation.id))?.legalCaseId).toBe(created.id);
  });
});

describe('ChatPage - modo legal con expediente (G1)', () => {
  it('vincular un expediente muestra el preview de privacidad y el consentimiento persiste en el caso', async () => {
    const harness = createChatHarness();
    const legalRepo = new MemoryLegalCaseRepository();
    const created = await legalRepo.create({
      title: 'Caso G1',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    renderChatPageWithCases(harness.services, caseStore);

    // Sin vínculo no hay preview: el modo general queda intacto.
    expect(screen.queryByTestId('legal-privacy-preview')).not.toBeInTheDocument();

    openModesMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));

    // Con el vínculo automático aparece el preview (conteos vacíos: el mapping aún no existe).
    const preview = await screen.findByTestId('legal-privacy-preview');
    expect(preview).toHaveTextContent('Sin datos anonimizados en este envío.');

    // El consentimiento persiste en `LegalCase.consent` vía `caseStore.update`.
    fireEvent.click(within(preview).getByRole('checkbox'));
    await waitFor(async () => {
      expect((await legalRepo.get(created.id))?.consent).toBeDefined();
    });
    expect(await screen.findByText('Consentimiento aceptado para esta sesión.')).toBeInTheDocument();
  });

  it('en modo legal el listado se renderiza con el guard neutro (sin corpus)', async () => {
    const harness = createChatHarness();
    const legalRepo = new MemoryLegalCaseRepository();
    const created = await legalRepo.create({
      title: 'Caso G1',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    const conversation = await harness.repo.create({ title: 'Chat legal' });
    await harness.repo.update(conversation.id, { legalCaseId: created.id });
    await harness.repo.appendMessage(
      userMessage('m1', 'hola', { conversationId: conversation.id, createdAt: 1 }),
    );
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPageWithCases(harness.services, caseStore);

    expect(await screen.findByText('hola')).toBeInTheDocument();
    expect(screen.queryByText(/VERIFICAR/)).not.toBeInTheDocument();
    expect(await screen.findByTestId('legal-privacy-preview')).toBeInTheDocument();
  });
});

describe('ChatPage - circuito adversarial', () => {
  it('derivar al atacante crea el chat vinculado con rol y auto-envía la semilla', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    const legalRepo = new MemoryLegalCaseRepository();
    const created = await legalRepo.create({
      title: 'Caso circuito',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    await legalRepo.update(created.id, {
      consent: { at: 1, text: 'consentimiento', scope: 'sensitive-data' },
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    await caseStore.getState().list();
    const conversation = await harness.repo.create({ title: 'Borrador' });
    await harness.repo.update(conversation.id, { legalCaseId: created.id, legalRole: 'redactor' });
    await harness.repo.appendMessage(
      userMessage('m1', 'redactá la demanda', { conversationId: conversation.id, createdAt: 1 }),
    );
    await harness.repo.appendMessage(
      assistantMessage('m2', [{ type: 'text', text: '# Demanda\n\nContenido.' }], {
        conversationId: conversation.id,
        createdAt: 2,
      }),
    );
    harness.provider.scripts.push(scriptFor('Ataque: excepción de prescripción.'));
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPageWithCases(harness.services, caseStore);

    // Esperar el documento en pantalla: sin markdown del asistente no hay derivación.
    expect(await screen.findByText('Contenido.')).toBeInTheDocument();

    // El botón del circuito sólo aparece en modo legal.
    fireEvent.click(await screen.findByTestId('circuit-open'));
    fireEvent.click(await screen.findByRole('button', { name: t('chat.circuitDeriveAtacante') }));

    // El chat derivado existe, vinculado al caso y con rol atacante.
    let derivedId: string | null = null;
    await waitFor(async () => {
      const derived = (await harness.repo.list()).find(
        (entry) => entry.id !== conversation.id && entry.legalRole === 'atacante',
      );
      expect(derived).not.toBeUndefined();
      derivedId = derived?.id ?? null;
    });
    expect(derivedId).not.toBeNull();

    // El chat derivado se auto-envía: llega la respuesta del atacante.
    expect(await screen.findByText('Ataque: excepción de prescripción.')).toBeInTheDocument();

    const derived = await harness.repo.get(derivedId ?? '');
    expect(derived?.legalCaseId).toBe(created.id);
    const derivedMessages = derivedId === null ? [] : await harness.repo.listMessages(derivedId);
    expect(
      derivedMessages.some(
        (message) =>
          message.role === 'user' &&
          message.content.some((block) => block.type === 'text' && block.text.includes('# Demanda')),
      ),
    ).toBe(true);
  });

  it('bloquea elevar al definitivo si el atacante no tiene respuesta', async () => {
    const harness = createChatHarness();
    const legalRepo = new MemoryLegalCaseRepository();
    const created = await legalRepo.create({
      title: 'Caso con ataque incompleto',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    await legalRepo.update(created.id, {
      consent: { at: 1, text: 'consentimiento', scope: 'sensitive-data' },
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    await caseStore.getState().list();
    const redactor = await harness.repo.create({ title: 'Borrador' });
    await harness.repo.update(redactor.id, { legalCaseId: created.id, legalRole: 'redactor', messageCount: 2 });
    await harness.repo.appendMessage(
      assistantMessage('m1', [{ type: 'text', text: '# Demanda\n\nContenido.' }], {
        conversationId: redactor.id,
        createdAt: 1,
      }),
    );
    // Atacante con semilla pero sin respuesta: ida sin vuelta.
    const attacker = await harness.repo.create({ title: 'Atacante' });
    await harness.repo.update(attacker.id, { legalCaseId: created.id, legalRole: 'atacante', messageCount: 1 });
    await harness.repo.appendMessage(
      userMessage('m2', 'semilla', { conversationId: attacker.id, createdAt: 2 }),
    );
    window.location.hash = `#/chat/${redactor.id}`;
    renderChatPageWithCases(harness.services, caseStore);

    expect(await screen.findByText('Contenido.')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('circuit-open'));
    // Esperar etapas cargadas (marca "actual" en el redactor): sin esto el
    // gate se leería antes del `load()` y el botón nacería deshabilitado.
    await screen.findByText(
      (_, element) => element?.textContent === `${t('chat.circuitRole_redactor')} · ${t('chat.circuitCurrent')}`,
    );
    expect(screen.getByRole('button', { name: t('chat.circuitDeriveJuez') })).toBeDisabled();
  });

  it('encadena juez y síntesis solo con las tres partes completas', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    const legalRepo = new MemoryLegalCaseRepository();
    const created = await legalRepo.create({
      title: 'Caso circuito completo',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    await legalRepo.update(created.id, {
      consent: { at: 1, text: 'consentimiento', scope: 'sensitive-data' },
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    await caseStore.getState().list();
    const redactor = await harness.repo.create({ title: 'Borrador' });
    await harness.repo.update(redactor.id, { legalCaseId: created.id, legalRole: 'redactor', messageCount: 2 });
    await harness.repo.appendMessage(
      assistantMessage('m1', [{ type: 'text', text: '# Demanda\n\nContenido.' }], {
        conversationId: redactor.id,
        createdAt: 1,
      }),
    );
    const attacker = await harness.repo.create({ title: 'Ataque' });
    await harness.repo.update(attacker.id, { legalCaseId: created.id, legalRole: 'atacante', messageCount: 2 });
    await harness.repo.appendMessage(
      userMessage('m2', 'semilla', { conversationId: attacker.id, createdAt: 2 }),
    );
    await harness.repo.appendMessage(
      assistantMessage('m3', [{ type: 'text', text: 'Ataque: excepción de prescripción.' }], {
        conversationId: attacker.id,
        createdAt: 3,
      }),
    );
    harness.provider.scripts.push(scriptFor('Verdict: side A 60% / side B 40%.'));
    // Cada turno de 2 mensajes dispara además el auto-título lateral (consume
    // un script): se intercalan rellenos para que cada turno consuma el suyo.
    harness.provider.scripts.push(scriptFor('Título del definitivo'));
    harness.provider.scripts.push(scriptFor('Documento final pulido.'));
    harness.provider.scripts.push(scriptFor('Título de la síntesis'));
    window.location.hash = `#/chat/${redactor.id}`;
    const { conversations } = renderChatPageWithCases(harness.services, caseStore);

    expect(await screen.findByText('Contenido.')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('circuit-open'));
    await screen.findByText(
      (_, element) => element?.textContent === `${t('chat.circuitRole_redactor')} · ${t('chat.circuitCurrent')}`,
    );
    const deriveJuez = await screen.findByRole('button', { name: t('chat.circuitDeriveJuez') });
    await waitFor(() => expect(deriveJuez).toBeEnabled());
    fireEvent.click(deriveJuez);

    // El veredicto se auto-envía en el chat del definitivo.
    expect(await screen.findByText('Verdict: side A 60% / side B 40%.')).toBeInTheDocument();
    await conversations.getState().load();

    fireEvent.click(await screen.findByTestId('circuit-open'));
    const deriveSintesis = await screen.findByRole('button', { name: t('chat.circuitDeriveSintesis') });
    await waitFor(() => expect(deriveSintesis).toBeEnabled());
    fireEvent.click(deriveSintesis);

    // La síntesis fusiona las tres partes y responde el documento pulido.
    expect(await screen.findByText('Documento final pulido.')).toBeInTheDocument();
    const sintesis = (await harness.repo.list()).find((entry) => entry.legalRole === 'sintesis');
    expect(sintesis?.legalCaseId).toBe(created.id);
    const seed = sintesis === undefined ? [] : await harness.repo.listMessages(sintesis.id);
    const seedText = seed
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    expect(seedText).toContain('# Demanda');
    expect(seedText).toContain('excepción de prescripción');
    expect(seedText).toContain('Verdict: side A 60% / side B 40%');
  });

  it('sin consentimiento del caso no hay auto-envío (H1)', async () => {
    const harness = createChatHarness();
    const legalRepo = new MemoryLegalCaseRepository();
    const created = await legalRepo.create({
      title: 'Caso sin consentir',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const caseStore = createCaseStore({ cases: legalRepo });
    const conversation = await harness.repo.create({ title: 'Borrador' });
    await harness.repo.update(conversation.id, { legalCaseId: created.id, legalRole: 'redactor' });
    await harness.repo.appendMessage(
      assistantMessage('m1', [{ type: 'text', text: '# Demanda\n\nContenido.' }], {
        conversationId: conversation.id,
        createdAt: 1,
      }),
    );
    harness.provider.scripts.push(scriptFor('Ataque: excepción de prescripción.'));
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPageWithCases(harness.services, caseStore);

    fireEvent.click(await screen.findByTestId('circuit-open'));
    fireEvent.click(await screen.findByRole('button', { name: t('chat.circuitDeriveAtacante') }));

    // Se crea y se abre el chat derivado, pero sin auto-envío: el ataque no llega solo.
    await waitFor(async () => {
      const derived = (await harness.repo.list()).find(
        (entry) => entry.id !== conversation.id && entry.legalRole === 'atacante',
      );
      expect(derived).not.toBeUndefined();
    });
    expect(screen.queryByText('Ataque: excepción de prescripción.')).not.toBeInTheDocument();
  });
});
