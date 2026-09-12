import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ServicesProvider } from '@/app/services';
import { PROVIDERS_STORAGE_KEY } from '@/features/settings/state/providerStorage';

import { useChatController } from '../hooks/useChatController';
import { ChatStoreProvider } from '../state/chatStore';
import { createChatHarness, createProviderConfig, scriptFor } from '../state/__fixtures__/chatTestHarness';

describe('useChatController', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('expone el estado y las acciones del chatStore', async () => {
    const h = createChatHarness();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={h.services}>
        <ChatStoreProvider store={h.store}>{children}</ChatStoreProvider>
      </ServicesProvider>
    );
    const { result } = renderHook(() => useChatController(), { wrapper });

    expect(result.current.runStatus).toBe('idle');
    expect(result.current.messages).toEqual([]);
    expect(result.current.liveSteps).toEqual([]);
    expect(result.current.lastError).toBeNull();

    h.provider.scripts.push(scriptFor('hola'));
    await act(async () => {
      await result.current.send('hola');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.runStatus).toBe('idle');
    expect(result.current.lastError).toBeNull();
    expect(result.current.send).toBeTypeOf('function');
    expect(result.current.stop).toBeTypeOf('function');
    expect(result.current.regenerate).toBeTypeOf('function');
    expect(result.current.editUserMessage).toBeTypeOf('function');
    expect(result.current.deleteMessage).toBeTypeOf('function');
    expect(result.current.retryLast).toBeTypeOf('function');
  });

  it('comparte un store de respaldo por services cuando no hay ChatStoreProvider', async () => {
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    const h = createChatHarness();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={h.services}>{children}</ServicesProvider>
    );
    const first = renderHook(() => useChatController(), { wrapper });
    const second = renderHook(() => useChatController(), { wrapper });

    h.provider.scripts.push(scriptFor('hola'));
    await act(async () => {
      await first.result.current.send('hola');
    });

    expect(first.result.current.messages).toHaveLength(2);
    expect(second.result.current.messages).toHaveLength(2);
  });
});
