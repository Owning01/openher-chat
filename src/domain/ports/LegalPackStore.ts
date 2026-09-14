import type { InstalledPack, LegalPack } from '../types/legal';

/** Puerto del store de packs instalados; fuente única de "packs instalados" en el dispositivo. */
export interface LegalPackStore {
  /** Metadatos de los packs instalados, sin su contenido. */
  listInstalled(): Promise<InstalledPack[]>;
  /** Pack completo por id, o `null` si no está instalado. */
  get(id: string): Promise<LegalPack | null>;
  /** Instala (o reemplaza por id) y devuelve los metadatos persistidos. */
  install(pack: LegalPack, bytes: number): Promise<InstalledPack>;
  remove(id: string): Promise<void>;
}
