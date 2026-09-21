import { useEffect, useState } from 'react';

import type { ProviderConfig } from '@/domain/types/provider';
import { ensureZenFreeModels } from '@/domain/providers/zenFreeModels';
import { LocalProviderConfigRepository } from '@/features/settings/state/providerStorage';

/**
 * Carga el catálogo de proveedores (localStorage) para el selector de modelo del chat.
 * Se recarga al montar: cada visita al chat relee lo configurado en Ajustes.
 */
export function useProviderCatalog(): ProviderConfig[] {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);

  useEffect(() => {
    let active = true;
    void new LocalProviderConfigRepository()
      .load()
      .then((loaded) => {
        if (!active) return;
        const normalized = loaded.map((p) =>
          p.kind === 'opencode' || p.id.includes('opencode') || p.id.includes('zen')
            ? { ...p, models: ensureZenFreeModels(p.models) }
            : p,
        );
        setProviders(normalized);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return providers;
}
