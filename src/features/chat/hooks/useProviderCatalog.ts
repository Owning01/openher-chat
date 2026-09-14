import { useEffect, useState } from 'react';

import type { ProviderConfig } from '@/domain/types/provider';
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
        if (active) setProviders(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return providers;
}
