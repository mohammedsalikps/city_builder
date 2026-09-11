/**
 * Minimal typed event emitter used across game systems.
 * Keeps systems decoupled: the world, UI and state talk through events
 * instead of holding references to each other.
 */
export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class EventEmitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners[event]?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners[event]?.forEach((listener) => listener(payload));
  }

  clear(): void {
    this.listeners = {};
  }
}
