import { estimateCost, totalCost, totalTokens as sumTokens } from '@/domain/providers/pricing';
import type { ChatMessage } from '@/domain/types/chat';
import { useT } from '@/i18n/useT';
import { Badge } from '@/shared/ui';
import { formatTokenCount, formatUsd } from '@/shared/utils/format';

/** Línea compacta de tokens y coste estimado de un mensaje del asistente. */
export function MessageUsage({ message }: { message: ChatMessage }) {
  const t = useT();
  const usage = message.usage;
  if (usage === undefined) return null;

  const prompt = usage.promptTokens ?? 0;
  const completion = usage.completionTokens ?? 0;
  if (prompt === 0 && completion === 0) return null;

  const cached = usage.cachedPromptTokens ?? 0;
  const cost = estimateCost(message.modelId, usage);
  const parts = [
    `${formatTokenCount(prompt)} ${t('chat.usageIn')}`,
    `${formatTokenCount(completion)} ${t('chat.usageOut')}`,
  ];
  if (cached > 0) parts.push(`${formatTokenCount(cached)} ${t('chat.usageCached')}`);
  if (cost !== null && cost.total > 0) parts.push(formatUsd(cost.total));

  return (
    <p data-testid="message-usage" className="font-mono text-[11px] text-muted tabular-nums">
      {parts.join(' · ')}
    </p>
  );
}

/** Uso acumulado de la conversación (tokens y coste estimado) para la cabecera. */
export function ConversationUsage({ messages }: { messages: readonly ChatMessage[] }) {
  const t = useT();
  const tokens = sumTokens(messages);
  const total = tokens.totalTokens ?? 0;
  if (total === 0) return null;

  const cached = tokens.cachedPromptTokens ?? 0;
  const cost = totalCost(messages);
  const titleParts = [t('chat.usageTotal'), `${formatTokenCount(total)} ${t('chat.usageTokens')}`];
  if (cached > 0) titleParts.push(`${formatTokenCount(cached)} ${t('chat.usageCached')}`);
  if (cost !== null && cost.total > 0) titleParts.push(`${formatUsd(cost.total)} ${t('chat.usageEstimated')}`);

  const label = `${formatTokenCount(total)}${cost !== null && cost.total > 0 ? ` · ${formatUsd(cost.total)}` : ''}`;

  return (
    <Badge variant="neutral" title={titleParts.join(' · ')} className="hidden font-mono sm:inline-flex" data-testid="conversation-usage">
      {label}
    </Badge>
  );
}
