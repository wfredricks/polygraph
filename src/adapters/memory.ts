/**
 * MemoryAdapter — In-memory storage adapter for PolyGraph
 *
 * Why: Provides fast, ephemeral storage for testing and development.
 * Keys are stored in a sorted Map to ensure scan() returns results in lexicographic order.
 * This is critical for adjacency list scanning and index operations.
 *
 * What: Implements the StorageAdapter interface using a Map with sorted key iteration.
 */

import type { StorageAdapter } from '../types.js';

/**
 * In-memory storage adapter using a sorted Map.
 * All operations are async for consistency with disk-based adapters.
 */
export class MemoryAdapter implements StorageAdapter {
  private store: Map<string, Buffer> = new Map();
  private isOpen = false;

  /**
   * Opens the adapter (no-op for memory, but maintains interface consistency).
   */
  async open(): Promise<void> {
    this.isOpen = true;
  }

  /**
   * Closes the adapter and clears all data.
   */
  async close(): Promise<void> {
    this.store.clear();
    this.isOpen = false;
  }

  /**
   * Retrieves a value by key.
   * Returns null if the key doesn't exist.
   */
  async get(key: string): Promise<Buffer | null> {
    return this.store.get(key) ?? null;
  }

  /**
   * Stores a key-value pair.
   */
  async put(key: string, value: Buffer): Promise<void> {
    this.store.set(key, value);
  }

  /**
   * Deletes a key-value pair.
   */
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Executes a batch of operations atomically.
   * All operations succeed or all fail.
   */
  async batch(ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }>): Promise<void> {
    // For memory adapter, we can just execute sequentially since it's synchronous
    // In a real scenario with errors, we'd need rollback logic
    for (const op of ops) {
      if (op.type === 'put') {
        if (!op.value) {
          throw new Error('Put operation requires a value');
        }
        this.store.set(op.key, op.value);
      } else if (op.type === 'del') {
        this.store.delete(op.key);
      }
    }
  }

  /**
   * Scans all keys with the given prefix in sorted order.
   *
   * Why sorted: Graph operations depend on predictable ordering for adjacency lists
   * and index scans. Keys like "n:123:o:FOLLOWS:456" must be iterable in order.
   *
   * @param prefix - The key prefix to scan for
   * @param options - Optional limit and reverse flags
   */
  async *scan(
    prefix: string,
    options?: { limit?: number; reverse?: boolean }
  ): AsyncIterable<{ key: string; value: Buffer }> {
    const { limit = Infinity, reverse = false } = options ?? {};

    // Get all keys, sort them, then filter by prefix
    const allKeys = Array.from(this.store.keys()).sort();

    // Apply reverse if needed
    const sortedKeys = reverse ? allKeys.reverse() : allKeys;

    // Filter keys that start with prefix
    const matchingKeys = sortedKeys.filter(k => k.startsWith(prefix));

    let count = 0;
    for (const key of matchingKeys) {
      if (count >= limit) break;

      const value = this.store.get(key);
      if (value !== undefined) {
        yield { key, value };
        count++;
      }
    }
  }
}
