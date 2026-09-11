export interface KeyVault {
  has(ref: string): Promise<boolean>;
  get(ref: string): Promise<string | null>;
  set(ref: string, secret: string): Promise<void>;
  remove(ref: string): Promise<void>;
}
