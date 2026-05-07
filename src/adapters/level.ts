/**
 * LevelDB Storage Adapter — Persistent storage for PolyGraph.
 *
 * Why: The MemoryAdapter loses all data on process exit. This adapter persists
 * the graph to disk using LevelDB (Google's sorted key-value store, BSD license).
 * Data survives restarts, crashes, and reboots.
 *
 * Architecture: This is I/O shell code — it adapts classic-level's API to our
 * StorageAdapter interface. All graph logic remains in pure functions.
 *
 * Choice: classic-level (LevelDB) over RocksDB because:
 *   - Actively maintained (v3.0.0, 2025)
 *   - BSD-licensed (same as RocksDB)
 *   - N-API bindings (no recompilation across Node versions)
 *   - Same sorted key-value semantics our key schema requires
 *   - Already present in FedRAMP-authorized systems
 *   - The `rocksdb` npm package is discontinued
 */

import { ClassicLevel } from 'classic-level';
import type { StorageAdapter } from '../types.js';

export interface LevelAdapterOptions {
  /** Path to the database directory */
  path: string;
  /** Create the database if it doesn't exist (default: true) */
  createIfMissing?: boolean;
  /** Throw an error if the database already exists (default: false) */
  errorIfExists?: boolean;
}

/**
 * Persistent storage adapter backed by LevelDB via classic-level.
 *
 * Why: Makes PolyGraph a real database — data survives process restarts.
 * Uses the same key schema as MemoryAdapter (sorted string keys, Buffer values).
 */
export class LevelAdapter implements StorageAdapter {
  private db: ClassicLevel<string, Buffer> | null = null;
  private options: LevelAdapterOptions;

  constructor(options: LevelAdapterOptions) {
    this.options = options;
  }

  /** Opens the LevelDB database, creating the directory if needed. */
  async open(): Promise<void> {
    this.db = new ClassicLevel<string, Buffer>(this.options.path, {
      keyEncoding: 'utf8',
      valueEncoding: 'buffer',
      createIfMissing: this.options.createIfMissing ?? true,
      errorIfExists: this.options.errorIfExists ?? false,
    });
    await this.db.open();
  }

  /** Closes the database, flushing pending writes. */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  /** Gets a value by key. Returns null if not found. */
  async get(key: string): Promise<Buffer | null> {
    this.assertOpen();
    try {
      const result = await this.db!.get(key);
      // classic-level may return undefined for missing keys (depending on version)
      return result ?? null;
    } catch (err: any) {
      // Older versions throw LEVEL_NOT_FOUND for missing keys
      if (err.code === 'LEVEL_NOT_FOUND') return null;
      throw err;
    }
  }

  /** Puts a key-value pair. */
  async put(key: string, value: Buffer): Promise<void> {
    this.assertOpen();
    await this.db!.put(key, value);
  }

  /** Deletes a key. No error if key doesn't exist. */
  async delete(key: string): Promise<void> {
    this.assertOpen();
    await this.db!.del(key);
  }

  /**
   * Executes a batch of put/delete operations atomically.
   *
   * Why: Atomic batches are critical for graph consistency — a node creation
   * involves multiple keys (data + labels + indexes) that must all succeed or
   * all fail together. LevelDB's WriteBatch provides this guarantee.
   */
  async batch(ops: Array<{ type: 'put' | 'del'; key: string; value?: Buffer }>): Promise<void> {
    this.assertOpen();
    const batch = this.db!.batch();
    for (const op of ops) {
      if (op.type === 'put') {
        batch.put(op.key, op.value ?? Buffer.from([1]));
      } else {
        batch.del(op.key);
      }
    }
    await batch.write();
  }

  /**
   * Scans all keys matching a prefix, yielding key-value pairs in sorted order.
   *
   * Why: Prefix scanning is the core mechanism for index-free adjacency.
   * Scanning `n:{id}:o:` returns all outgoing relationships for a node.
   * LevelDB's sorted storage makes this a sequential read — very fast.
   */
  async *scan(
    prefix: string,
    options?: { limit?: number; reverse?: boolean }
  ): AsyncIterable<{ key: string; value: Buffer }> {
    this.assertOpen();

    let count = 0;
    const limit = options?.limit ?? Infinity;

    // LevelDB range: gte prefix, lt prefix with last char incremented
    // This captures all keys starting with the prefix
    const rangeEnd = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);

    const iterator = this.db!.iterator({
      gte: prefix,
      lt: rangeEnd,
      reverse: options?.reverse ?? false,
      keyEncoding: 'utf8',
      valueEncoding: 'buffer',
    });

    try {
      for await (const [key, value] of iterator) {
        if (count >= limit) break;
        yield { key, value };
        count++;
      }
    } finally {
      await iterator.close();
    }
  }

  /** Asserts the database is open. */
  private assertOpen(): void {
    if (!this.db) {
      throw new Error('LevelAdapter: database is not open. Call open() first.');
    }
  }
}
