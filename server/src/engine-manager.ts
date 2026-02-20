import type { EngineAdapter } from './adapters/types.js';
import type { EngineInfo } from '../../shared/types.js';

/**
 * Registry of engine adapters.
 * The server creates one EngineManager at startup, registers adapters,
 * and looks them up by id when handling API requests.
 */
export class EngineManager {
  private adapters = new Map<string, EngineAdapter>();

  register(adapter: EngineAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter "${adapter.id}" is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(engineId: string): EngineAdapter {
    const adapter = this.adapters.get(engineId);
    if (!adapter) {
      throw new Error(`Unknown engine "${engineId}"`);
    }
    return adapter;
  }

  list(): EngineInfo[] {
    return [...this.adapters.values()].map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      connected: a.isConnected(),
    }));
  }
}
