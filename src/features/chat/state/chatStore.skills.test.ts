import { describe, expect, it } from 'vitest';

import { MemorySkillRepository } from '@/test/fakes/MemoryRepos';

import type { ChatHarness } from './__fixtures__/chatTestHarness';
import { createChatHarness, scriptFor } from './__fixtures__/chatTestHarness';

async function startConversation(h: ChatHarness): Promise<string> {
  const conversation = await h.repo.create({ title: '' });
  await h.store.getState().load(conversation.id);
  return conversation.id;
}

/**
 * Skills: con skills guardadas el turno habilita tools (aunque researchMode y
 * el expediente estén apagados) para que el agente pueda cargarlas solo.
 */
describe('chatStore - skills', () => {
  it('con skills guardadas expone load_skill y las lista en el system prompt', async () => {
    const skills = new MemorySkillRepository();
    await skills.save({
      name: 'informe-laboral',
      description: 'Redacta informes laborales',
      body: '# Pasos\n\n1. Revisar el expediente.',
    });
    const h = createChatHarness({ skills, realTools: true });
    h.provider.toolCalling = true;
    h.provider.scripts.push(scriptFor('listo'));

    await startConversation(h);
    await h.store.getState().send('hacé un informe');

    const request = h.provider.requests[0];
    expect(request?.system).toContain('- informe-laboral: Redacta informes laborales');
    expect(request?.system).toContain('load_skill');
    expect(request?.tools?.map((tool) => tool.name)).toEqual(['web_search', 'open_url', 'load_skill']);
  });

  it('sin skills el turno general sigue sin tools ni bloque nuevo en el prompt', async () => {
    const h = createChatHarness({ realTools: true });
    h.provider.toolCalling = true;
    h.provider.scripts.push(scriptFor('hola'));

    await startConversation(h);
    await h.store.getState().send('hola');

    const request = h.provider.requests[0];
    expect(request?.tools).toBeUndefined();
    expect(request?.system).not.toContain('load_skill');
    expect(request?.system).not.toContain('Skills (reusable instructions');
  });

  it('el agente puede pedir la skill y recibe su contenido como resultado de tool', async () => {
    const skills = new MemorySkillRepository();
    await skills.save({
      name: 'resumen-prensa',
      description: 'Resume noticias',
      body: 'PASOS_SECRETOS_DE_LA_SKILL',
    });
    const h = createChatHarness({ skills, realTools: true });
    h.provider.toolCalling = true;
    h.provider.scripts.push({
      events: [
        { type: 'tool-call', toolCall: { id: 'call-1', name: 'load_skill', argumentsText: '{"name":"resumen-prensa"}' } },
        { type: 'stop', reason: 'tool_use' },
      ],
    });
    h.provider.scripts.push(scriptFor('seguí los pasos'));

    const conversationId = await startConversation(h);
    await h.store.getState().send('resumime las noticias');

    const messages = await h.repo.listMessages(conversationId);
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('PASOS_SECRETOS_DE_LA_SKILL');
    expect(serialized).toContain('load_skill');
  });
});
