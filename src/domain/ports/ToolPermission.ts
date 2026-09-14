export interface ToolPermissionRequest {
  tool: string;
  arguments: unknown;
}

/**
 * Gate de aprobación de tools: puerto del `Permission.ask` de OpenCode. El loop
 * del agente suspende la ejecución hasta que el usuario autoriza o deniega.
 * `request` resuelve `true` solo si el usuario aprueba.
 */
export interface ToolPermissionGate {
  request(request: ToolPermissionRequest): Promise<boolean>;
}
