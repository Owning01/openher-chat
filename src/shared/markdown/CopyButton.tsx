import { useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n/useT';
import { Check, Copy } from '@/shared/icons';
import { IconButton } from '@/shared/ui';

/** Duración del feedback «copiado» antes de volver al estado inicial. */
export const COPY_FEEDBACK_MS = 1200;

export interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

export function CopyButton({ text, label, copiedLabel, className }: CopyButtonProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async (): Promise<void> => {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) return;
    try {
      await clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setCopied(false);
    }, COPY_FEEDBACK_MS);
  };

  const accessibleLabel = copied ? (copiedLabel ?? t('common.copied')) : (label ?? t('common.copy'));

  return (
    <IconButton
      size="sm"
      label={accessibleLabel}
      icon={copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      className={className}
      onClick={() => void handleCopy()}
    />
  );
}
