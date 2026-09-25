/** Port de monitoring externe (ex: Uptime Kuma en mode push). */
export interface MonitorPort {
  push(pushUrl: string, status: 'up' | 'down', message?: string, pingMs?: number): Promise<void>;
}

export const MONITOR_PORT = Symbol('MONITOR_PORT');
