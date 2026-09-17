import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServices, ServicesProvider } from '@/app/services';
import type { HttpClient } from '@/domain/ports/HttpClient';
import { setLocale } from '@/i18n';
import { ToastViewport } from '@/shared/ui';
import {
  MemoryConversationRepository,
  MemoryKeyVault,
  MemorySettingsRepository,
  MemorySkillRepository,
} from '@/test/fakes/MemoryRepos';

import { SettingsPage } from '../SettingsPage';

beforeEach(() => {
  localStorage.clear();
  setLocale('es');
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

function renderPage(skills: MemorySkillRepository) {
  const services = createServices({
    conversations: new MemoryConversationRepository(),
    settings: new MemorySettingsRepository(),
    keys: new MemoryKeyVault(),
    http: { request: async () => ({ status: 200, headers: {}, text: '' }) } as HttpClient,
    skills,
  });
  // Hermético: sin config real de Firebase aunque el dev tenga `.env.local`.
  delete services.sync;
  render(
    <ServicesProvider services={services}>
      <SettingsPage />
      <ToastViewport />
    </ServicesProvider>,
  );
}

/** Abre el diálogo de alta desde el botón de acciones de la sección. */
function openSkillEditor(): void {
  fireEvent.click(screen.getAllByRole('button', { name: 'Agregar habilidad' })[0]!);
}

function fillEditor(parts: { name: string; description: string; body: string }): void {
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: parts.name } });
  fireEvent.change(screen.getByLabelText('Cuándo usarla'), { target: { value: parts.description } });
  fireEvent.change(screen.getByLabelText('Instrucciones'), { target: { value: parts.body } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
}

describe('SkillsSection', () => {
  it('parte del estado vacío y guarda una habilidad nueva', async () => {
    const repo = new MemorySkillRepository();
    renderPage(repo);

    expect(await screen.findByText('Todavía no hay habilidades')).toBeInTheDocument();

    openSkillEditor();
    fillEditor({ name: 'informe-laboral', description: 'Redacta informes', body: '# Pasos\n1. Revisar' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const list = await screen.findByTestId('skills-list');
    expect(within(list).getByText('informe-laboral')).toBeInTheDocument();
    expect(within(list).getByText('Redacta informes')).toBeInTheDocument();

    const saved = await repo.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'informe-laboral', description: 'Redacta informes' });
  });

  it('rechaza nombres repetidos (mismo nombre canónico) sin guardar', async () => {
    const repo = new MemorySkillRepository();
    await repo.save({ name: 'resumen-prensa', description: 'd', body: 'b' });
    renderPage(repo);

    await screen.findByTestId('skills-list');
    openSkillEditor();
    fillEditor({ name: 'Resumen Prensa', description: 'd', body: 'b' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una habilidad con ese nombre.');
    expect(await repo.list()).toHaveLength(1);
  });

  it('exige instrucciones antes de guardar', async () => {
    const repo = new MemorySkillRepository();
    renderPage(repo);

    await screen.findByText('Todavía no hay habilidades');
    openSkillEditor();
    fillEditor({ name: 'x', description: '', body: '   ' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Escribí las instrucciones de la habilidad.');
    expect(await repo.list()).toHaveLength(0);
  });

  it('importa un archivo .md con frontmatter y guarda la habilidad', async () => {
    const repo = new MemorySkillRepository();
    renderPage(repo);

    await screen.findByText('Todavía no hay habilidades');
    openSkillEditor();

    const markdown = [
      '---',
      'name: resumen-prensa',
      'description: Resume noticias del día',
      '---',
      '',
      '# Pasos',
      '1. Leer titulares',
    ].join('\n');
    const file = new File([markdown], 'SKILL.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByTestId('skill-import-input'), { target: { files: [file] } });

    // Con la suite en paralelo, el FileReader + render puede superar 1s.
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('resumen-prensa'), {
      timeout: 10_000,
    });
    expect(screen.getByLabelText('Cuándo usarla')).toHaveValue('Resume noticias del día');
    expect(screen.getByLabelText('Instrucciones')).toHaveValue('# Pasos\n1. Leer titulares');

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect(await repo.list()).toHaveLength(1);
    });
  });

  it('edita y elimina una habilidad existente', async () => {
    const repo = new MemorySkillRepository();
    await repo.save({ name: 'vieja', description: 'd', body: 'b' });
    renderPage(repo);

    const list = await screen.findByTestId('skills-list');
    fireEvent.click(within(list).getByRole('button', { name: 'Editar' }));
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(async () => {
      expect((await repo.list())[0]?.name).toBe('nueva');
    });

    const updated = await screen.findByTestId('skills-list');
    fireEvent.click(within(updated).getByRole('button', { name: 'Eliminar' }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }));

    await waitFor(async () => {
      expect(await repo.list()).toHaveLength(0);
    });
    expect(await screen.findByText('Todavía no hay habilidades')).toBeInTheDocument();
  });
});
