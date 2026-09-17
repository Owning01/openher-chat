import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useServices } from '@/app/services';
import { readAttachmentText } from '@/domain/chat/attachments';
import { isSkillNameTaken } from '@/domain/skills/skillName';
import { parseSkillMarkdown } from '@/domain/skills/parseSkillMarkdown';
import type { Skill, SkillDraft } from '@/domain/types/skill';
import { useT } from '@/i18n/useT';
import { Pencil, Plus, Trash2, Upload } from '@/shared/icons';
import { Button, Dialog, EmptyState, Input, Skeleton, TextArea, useToast } from '@/shared/ui';

import { SectionCard } from './SectionCard';

/** Borrador del editor: los campos son strings controlados, `id` presente = edición. */
interface EditorState {
  id?: string;
  name: string;
  description: string;
  body: string;
}

const EMPTY_DRAFT: EditorState = { name: '', description: '', body: '' };

/**
 * Habilidades (skills) del dispositivo: el usuario las escribe o importa un
 * `.md`, y el agente las carga con `load_skill` cuando la tarea coincide.
 */
export function SkillsSection() {
  const t = useT();
  const services = useServices();
  const repo = services.skills;
  const { push } = useToast();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (repo === undefined) {
      setSkills([]);
      return;
    }
    try {
      setSkills(await repo.list());
    } catch {
      setSkills([]);
      push({ title: t('skills.loadError'), variant: 'danger' });
    }
  }, [push, repo, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (repo === undefined) return null;

  const handleDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await repo.remove(deleting.id);
      push({ title: t('skills.removed'), variant: 'success' });
      setDeleting(null);
      await refresh();
    } catch {
      push({ title: t('skills.deleteError'), variant: 'danger' });
    }
  };

  return (
    <SectionCard
      title={t('skills.sectionTitle')}
      description={t('skills.sectionDescription')}
      actions={
        <Button
          size="sm"
          icon={<Plus aria-hidden="true" />}
          onClick={() => setEditor({ ...EMPTY_DRAFT })}
        >
          {t('skills.add')}
        </Button>
      }
    >
      {skills === null ? (
        <Skeleton className="h-20" />
      ) : skills.length === 0 ? (
        <EmptyState
          title={t('skills.emptyTitle')}
          description={t('skills.emptyDescription')}
          action={
            <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={() => setEditor({ ...EMPTY_DRAFT })}>
              {t('skills.add')}
            </Button>
          }
        />
      ) : (
        <ul data-testid="skills-list" className="space-y-2">
          {skills.map((skill) => (
            <li
              key={skill.id}
              data-testid={`skill-item-${skill.id}`}
              className="flex flex-wrap items-start gap-2 rounded-lg border border-border-subtle bg-background/40 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{skill.name}</p>
                <p className="text-xs text-muted">{skill.description}</p>
                <p className="mt-1 text-xs text-muted">
                  {t('skills.wordCount', { count: countWords(skill.body) })}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil aria-hidden="true" />}
                  onClick={() =>
                    setEditor({
                      id: skill.id,
                      name: skill.name,
                      description: skill.description,
                      body: skill.body,
                    })
                  }
                >
                  {t('skills.edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 aria-hidden="true" />}
                  onClick={() => setDeleting(skill)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t('skills.localHint')}</p>

      {editor !== null ? (
        <SkillEditorDialog
          draft={editor}
          skills={skills ?? []}
          onClose={() => setEditor(null)}
          onSave={async (draft) => {
            try {
              await repo.save(draft);
              push({ title: t('skills.saved'), variant: 'success' });
              setEditor(null);
              await refresh();
            } catch {
              push({ title: t('skills.saveError'), variant: 'danger' });
            }
          }}
        />
      ) : null}

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('common.confirmDelete', { name: deleting?.name ?? '' })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()}>
              {t('common.delete')}
            </Button>
          </>
        }
      />
    </SectionCard>
  );
}

/** Editor con importación desde `.md`; valida nombre único y cuerpo no vacío. */
function SkillEditorDialog({
  draft,
  skills,
  onClose,
  onSave,
}: {
  draft: EditorState;
  skills: readonly Skill[];
  onClose: () => void;
  onSave: (draft: SkillDraft) => Promise<void>;
}) {
  const t = useT();
  const { push } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const fileId = useId();
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      const parsed = parseSkillMarkdown(await readAttachmentText(file));
      setName(parsed.name);
      setDescription(parsed.description);
      setBody(parsed.body);
      setError(null);
    } catch {
      push({ title: t('skills.importError'), variant: 'danger' });
    }
  };

  const handleSave = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError(t('skills.nameRequired'));
      return;
    }
    if (isSkillNameTaken(skills, trimmedName, draft.id)) {
      setError(t('skills.nameTaken'));
      return;
    }
    if (body.trim() === '') {
      setError(t('skills.bodyRequired'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ id: draft.id, name: trimmedName, description: description.trim(), body });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={draft.id === undefined ? t('skills.addTitle') : t('skills.editTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} onClick={() => void handleSave()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <label htmlFor={`${fileId}-name`} className="block text-sm font-medium text-text">
            {t('skills.name')}
          </label>
          <Input
            id={`${fileId}-name`}
            value={name}
            placeholder={t('skills.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-xs text-muted">{t('skills.nameHint')}</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fileId}-description`} className="block text-sm font-medium text-text">
            {t('skills.descriptionLabel')}
          </label>
          <Input
            id={`${fileId}-description`}
            value={description}
            placeholder={t('skills.descriptionPlaceholder')}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="text-xs text-muted">{t('skills.descriptionHint')}</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fileId}-body`} className="block text-sm font-medium text-text">
            {t('skills.bodyLabel')}
          </label>
          <TextArea
            id={`${fileId}-body`}
            value={body}
            rows={10}
            placeholder={t('skills.bodyPlaceholder')}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            data-testid="skill-import-input"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            icon={<Upload aria-hidden="true" />}
            onClick={() => fileInput.current?.click()}
          >
            {t('skills.importFile')}
          </Button>
          <span className="text-xs text-muted">{t('skills.importHint')}</span>
        </div>

        {error !== null ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
