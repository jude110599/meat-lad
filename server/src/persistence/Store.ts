import type { RoomState } from '@starforge/shared';

/**
 * Persistence boundary. The game loop only ever talks to this interface so
 * the backing store can change without touching rules or networking.
 *
 * Planned adapters (DESIGN.md §7):
 *   - RedisStore: hot room state (HSET room:{code}), 30 s write-behind,
 *     TTL on abandoned rooms, pub/sub for cross-node room routing.
 *   - MongoStore: durable player profiles, Quantum skill tree, lifetime stats,
 *     and the `lastSeen` timestamp used for offline gains.
 */
export interface ProgressStore {
  loadRoom(code: string): Promise<RoomState | null>;
  saveRoom(code: string, state: RoomState): Promise<void>;
}

/** Default dev store: process memory, lost on restart. */
export class MemoryStore implements ProgressStore {
  private readonly rooms = new Map<string, string>();

  async loadRoom(code: string): Promise<RoomState | null> {
    const raw = this.rooms.get(code);
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async saveRoom(code: string, state: RoomState): Promise<void> {
    this.rooms.set(code, JSON.stringify(state));
  }
}
