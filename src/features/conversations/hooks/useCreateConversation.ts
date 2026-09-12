import { useCallback } from 'react';

import { chatHref, navigate } from '@/app/routing';
import { useT } from '@/i18n/useT';
import { useToast } from '@/shared/ui';

import { useConversationsStore } from '../state/conversationsStore';

/** Crea una conversación y navega a `#/chat/:id`; notifica si la persistencia falla. */
export function useCreateConversation(): () => Promise<void> {
  const create = useConversationsStore((state) => state.create);
  const t = useT();
  const { push } = useToast();

  return useCallback(async () => {
    const conversation = await create();
    if (conversation === null) {
      push({ title: t('conversations.createError'), variant: 'danger' });
      return;
    }
    navigate(chatHref(conversation.id));
  }, [create, push, t]);
}
