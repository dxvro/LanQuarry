import type { InstallState } from '../db/enums.js';
import type { RuntimeStatus } from '../process/types.js';

export type AppEvent =
  | { type: 'server.status'; serverId: string; status: RuntimeStatus }
  | { type: 'server.metrics'; serverId: string; cpuPercent: number | null; rssBytes: number | null }
  | { type: 'server.changed'; serverId: string; reason: 'created' | 'updated' | 'deleted' }
  | { type: 'server.crashed'; serverId: string; exitCode: number | null; lastLines: string[] }
  | { type: 'install.state'; serverId: string; installState: InstallState; installError: string | null }
  | { type: 'install.progress'; serverId: string; phase: string; percent: number | null; message: string }
  | { type: 'install.log'; serverId: string; line: string }
  | {
      type: 'mods.updates';
      serverId: string;
      ok: boolean;
      count: number;
      projects: string[];
      error: string | null;
    };

export type AppEventListener = (event: AppEvent) => void;

export class EventBus {
  private readonly listeners = new Set<AppEventListener>();

  subscribe(listener: AppEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AppEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // a faulty subscriber must never break the emitter
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
