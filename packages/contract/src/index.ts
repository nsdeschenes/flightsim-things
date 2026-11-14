export const runtimeHealthChannel = 'runtime:health';

export interface RuntimeHealth {
  status: 'ready';
  database: 'connected';
}

export interface DesktopApi {
  getRuntimeHealth(): Promise<RuntimeHealth>;
}
