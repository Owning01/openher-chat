import { useEffect, useMemo, useRef, useState } from 'react';

import { AlertBanner } from '@/app/layout/AlertBanner';
import { chatHref, navigate } from '@/app/routing';
import type { Conversation } from '@/domain/types/conversation';
import { useT } from '@/i18n/useT';
import { Download, MessageSquare, Plus, Search, Upload } from '@/shared/icons';
import { Button, EmptyState, Skeleton } from '@/shared/ui';
import { downloadTextFile, safeFilename } from '@/shared/utils/download';

import { ConversationItem } from './components/ConversationItem';
import { ConversationSearch } from './components/ConversationSearch';
import { DeleteConversationDialog } from './components/DeleteConversationDialog';
import { RenameConversationDialog } from './components/RenameConversationDialog';
import { useCreateConversation } from './hooks/useCreateConversation';
import { INVALID_IMPORT_ERROR, filterConversations, useConversationsStore } from './state/conversationsStore';

export interface ConversationsPanelProps {
  onNavigate?: () => void;
}

export function ConversationsPanel({ onNavigate }: ConversationsPanelProps) {
  const t = useT();
  const items = useConversationsStore((state) => state.items);
  const activeId = useConversationsStore((state) => state.activeId);
  const query = useConversationsStore((state) => state.query);
  const status = useConversationsStore((state) => state.status);
  const error = useConversationsStore((state) => state.error);
  const load = useConversationsStore((state) => state.load);
  const setQuery = useConversationsStore((state) => state.setQuery);
  const select = useConversationsStore((state) => state.select);
  const rename = useConversationsStore((state) => state.rename);
  const remove = useConversationsStore((state) => state.remove);
  const dismissError = useConversationsStore((state) => state.dismissError);
  const exportMarkdown = useConversationsStore((state) => state.exportMarkdown);
  const importConversation = useConversationsStore((state) => state.importConversation);
  const messageHits = useConversationsStore((state) => state.messageHits);
  const searchMessages = useConversationsStore((state) => state.searchMessages);
  const createConversation = useCreateConversation();

  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void searchMessages(query);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, searchMessages]);

  const visibleItems = useMemo(() => filterConversations(items, query), [items, query]);

  const handleCreate = async (): Promise<void> => {
    await createConversation();
    onNavigate?.();
  };

  const handleSelect = (id: string): void => {
    select(id);
    navigate(chatHref(id));
    onNavigate?.();
  };

  const handleRename = async (title: string): Promise<void> => {
    if (renameTarget === null) return;
    await rename(renameTarget.id, title);
    setRenameTarget(null);
  };

  const handleDelete = async (): Promise<void> => {
    if (deleteTarget === null) return;
    const wasActive = deleteTarget.id === activeId;
    const removed = await remove(deleteTarget.id);
    setDeleteTarget(null);
    if (removed && wasActive) {
      navigate(chatHref());
      onNavigate?.();
    }
  };

  const handleExport = async (conversation: Conversation): Promise<void> => {
    const markdown = await exportMarkdown(conversation.id);
    if (markdown === null) return;
    downloadTextFile(`${safeFilename(conversation.title)}.md`, markdown, 'text/markdown');
  };

  const handleImportFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    const text = await file.text();
    const imported = await importConversation(text);
    if (imported === null) return;
    select(imported.id);
    navigate(chatHref(imported.id));
    onNavigate?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 p-3">
        <Button icon={<Plus aria-hidden="true" />} fullWidth onClick={() => void handleCreate()}>
          {t('conversations.new')}
        </Button>
        <ConversationSearch value={query} onChange={setQuery} />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Upload aria-hidden="true" className="size-4" />}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('conversations.import')}
          </Button>
          {activeId !== null ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Download aria-hidden="true" className="size-4" />}
              onClick={() => {
                const target = items.find((item) => item.id === activeId);
                if (target !== undefined) void handleExport(target);
              }}
            >
              {t('conversations.export')}
            </Button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              void handleImportFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>
      <nav aria-label={t('conversations.listLabel')} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {error !== null ? (
          <AlertBanner
            variant="danger"
            title={t('conversations.errorTitle')}
            description={error === INVALID_IMPORT_ERROR ? t('conversations.importInvalid') : error}
            className="mb-2"
            action={
              <Button size="sm" variant="ghost" onClick={dismissError}>
                {t('common.dismiss')}
              </Button>
            }
          />
        ) : null}
        {status === 'loading' && items.length === 0 ? (
          <div className="flex flex-col gap-2 px-1" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : null}
        {status !== 'loading' && visibleItems.length === 0 && messageHits.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              icon={<MessageSquare aria-hidden="true" />}
              title={t('conversations.emptyTitle')}
              description={t('conversations.emptyDescription')}
              action={
                <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={() => void handleCreate()}>
                  {t('conversations.new')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Search aria-hidden="true" />}
              title={t('conversations.noResultsTitle')}
              description={t('conversations.noResultsDescription', { query: query.trim() })}
              action={
                <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                  {t('conversations.clearSearch')}
                </Button>
              }
            />
          )
        ) : null}
        {visibleItems.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {visibleItems.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                onSelect={handleSelect}
                onRename={setRenameTarget}
                onDelete={setDeleteTarget}
                onExport={(conversation) => void handleExport(conversation)}
              />
            ))}
          </ul>
        ) : null}
        {messageHits.length > 0 ? (
          <div className="mt-3">
            <h3 className="px-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {t('conversations.messageHits')}
            </h3>
            <ul className="flex flex-col gap-1">
              {messageHits.map((hit) => {
                const conversation = items.find((item) => item.id === hit.conversationId);
                return (
                  <li key={hit.messageId}>
                    <button
                      type="button"
                      onClick={() => handleSelect(hit.conversationId)}
                      className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      <span className="truncate text-xs font-medium text-text">
                        {conversation?.title.trim() === '' || conversation === undefined
                          ? t('conversations.untitled')
                          : conversation.title}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted">{hit.snippet}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </nav>
      {renameTarget !== null ? (
        <RenameConversationDialog
          conversation={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSubmit={handleRename}
        />
      ) : null}
      {deleteTarget !== null ? (
        <DeleteConversationDialog
          conversation={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}
