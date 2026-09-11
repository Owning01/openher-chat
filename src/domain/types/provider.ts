/** Familia de transporte de un proveedor. */
export type ProviderKind = 'openai-compatible' | 'anthropic';

/** Modelo expuesto por un proveedor (descubierto por API o agregado a mano). */
export interface ModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  source: 'api' | 'manual';
}

/** Ajustes específicos del proveedor al construir payloads. */
export interface ProviderQuirks {
  includeUsage?: boolean;
  sendToolChoice?: boolean;
}

/** Configuración persistida de un proveedor. La API key nunca vive aquí (ver KeyVault). */
export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  requiresKey: boolean;
  keyRef: string | null;
  extraHeaders?: Record<string, string>;
  models: ModelInfo[];
  defaultModelId: string | null;
  quirks?: ProviderQuirks;
  createdAt: number;
  updatedAt: number;
}

/** Capacidades resueltas de la pareja proveedor/modelo. */
export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  systemPrompt: boolean;
  listModels: boolean;
  images: boolean;
}
