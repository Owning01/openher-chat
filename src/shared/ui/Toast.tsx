import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

import { useT } from '@/i18n/useT';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@/shared/icons';
import type { LucideIcon } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';
import { newId } from '@/shared/utils/ids';

import { IconButton } from './IconButton';

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number | null;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  durationMs: number | null;
}

interface ToastState {
  toasts: ToastItem[];
  push: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_TOASTS = 3;
const DEFAULT_DURATION_MS = 4000;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (options) => {
    const id = newId('toast');
    const item: ToastItem = {
      id,
      title: options.title,
      description: options.description,
      variant: options.variant ?? 'info',
      durationMs: options.durationMs === undefined ? DEFAULT_DURATION_MS : options.durationMs,
    };

    set((state) => ({ toasts: [...state.toasts, item].slice(-MAX_TOASTS) }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export function clearToasts(): void {
  useToastStore.getState().clear();
}

export function useToast(): Pick<ToastState, 'push' | 'dismiss' | 'clear'> {
  const push = useToastStore((state) => state.push);
  const dismiss = useToastStore((state) => state.dismiss);
  const clear = useToastStore((state) => state.clear);

  return useMemo(() => ({ push, dismiss, clear }), [push, dismiss, clear]);
}

const VARIANT_ICONS: Record<ToastVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const VARIANT_CONTAINERS: Record<ToastVariant, string> = {
  info: 'border-border bg-surface',
  success: 'border-success/30 bg-success-soft',
  warning: 'border-warning/30 bg-warning-soft',
  danger: 'border-danger/30 bg-danger-soft',
};

const VARIANT_ICON_CLASSES: Record<ToastVariant, string> = {
  info: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  className?: string;
}

export function Toast({ toast, onDismiss, className }: ToastProps) {
  const t = useT();
  const Icon = VARIANT_ICONS[toast.variant];

  useEffect(() => {
    if (toast.durationMs === null) return undefined;

    const timeout = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timeout);
  }, [toast.durationMs, toast.id, onDismiss]);

  return (
    <div
      role={toast.variant === 'danger' ? 'alert' : 'status'}
      className={cn(
        'anim-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3 shadow-lg',
        VARIANT_CONTAINERS[toast.variant],
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', VARIANT_ICON_CLASSES[toast.variant])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{toast.title}</p>
        {toast.description ? <p className="mt-0.5 text-sm text-muted">{toast.description}</p> : null}
      </div>
      <IconButton label={t('common.dismiss')} icon={<X />} size="sm" onClick={() => onDismiss(toast.id)} />
    </div>
  );
}

export interface ToastViewportProps {
  className?: string;
}

export function ToastViewport({ className }: ToastViewportProps) {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return createPortal(
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4',
        className,
      )}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  );
}
