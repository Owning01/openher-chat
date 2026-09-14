import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppServices } from '@/app/services';
import { APP_VERSION } from '@/app/version';

import { checkForUpdate } from './checkForUpdate';
import type { UpdateManifest } from './manifest';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'available'; manifest: UpdateManifest }
  | { status: 'error'; message: string };

export interface UseUpdateCheckResult {
  state: UpdateState;
  check(): void;
}

/** Comprueba si hay una versión nueva; con `auto` lo hace una vez al montar. */
export function useUpdateCheck(services: AppServices, options: { auto?: boolean } = {}): UseUpdateCheckResult {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const activeRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const check = useCallback((): void => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'checking' });

    void checkForUpdate({ http: services.http, currentVersion: APP_VERSION, signal: controller.signal }).then(
      (result) => {
        if (!activeRef.current || controller.signal.aborted) return;
        if (result.status === 'error' && controller.signal.aborted) return;
        setState(result);
      },
    );
  }, [services]);

  const auto = options.auto ?? false;
  useEffect(() => {
    if (auto) check();
  }, [auto, check]);

  return { state, check };
}
