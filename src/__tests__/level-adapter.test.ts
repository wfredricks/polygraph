/**
 * LevelDB Adapter Tests — Persistent storage correctness.
 *
 * Why: The LevelAdapter is what makes PolyGraph a real database.
 * Every test here has a MemoryAdapter counterpart — persistent storage
 * must behave identically to in-memory storage.
 *
 * Tests verify: CRUD, batch atomicity, prefix scanning (sorted order),
 * persistence across close/reopen, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LevelAdapter } from '../adapters/level.js';

describe('LevelAdapter — Persistent Storage', () => {
  let adapter: LevelAdapter;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = await mkdtemp(join(tmpdir(), 'polygraph-test-'));
    adapter = new LevelAdapter({ path: dbPath });
    await adapter.open();
  });

  afterEach(async () => {
    try { await adapter.close(); } catch { /* may already be closed */ }
    await rm(dbPath, { recursive: true, force: true });
  });

  describe('Basic CRUD', () => {
    it('should put and get a value', async () => {
      await adapter.put('key1', Buffer.from('hello'));
      const result = await adapter.get('key1');
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe('hello');
    });

    it('should return null for missing key', async () => {
      const result = await adapter.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should overwrite existing key', async () => {
      await adapter.put('key1', Buffer.from('first'));
      await adapter.put('key1', Buffer.from('second'));
      const result = await adapter.get('key1');
      expect(result!.toString()).toBe('second');
    });

    it('should delete a key', async () => {
      await adapter.put('key1', Buffer.from('data'));
      await adapter.delete('key1');
      const result = await adapter.get('key1');
      expect(result).toBeNull();
    });

    it('should not error when deleting missing key', async () => {
      await expect(adapter.delete('nonexistent')).resolves.not.toThrow();
    });

    it('should handle binary data (Buffer)', async () => {
      const binary = Buffer.from([0x00, 0xff, 0x80, 0x01, 0xfe]);
      await adapter.put('binary', binary);
      const result = await adapter.get('binary');
      expect(result).toEqual(binary);
    });

    it('should handle empty Buffer', async () => {
      await adapter.put('empty', Buffer.alloc(0));
      const result = await adapter.get('empty');
      expect(result).not.toBeNull();
      expect(result!.length).toBe(0);
    });

    it('should handle large values', async () => {
      const large = Buffer.alloc(1024 * 1024, 0x42); // 1MB of 'B'
      await adapter.put('large', large);
      const result = await adapter.get('large');
      expect(result!.length).toBe(1024 * 1024);
      expect(result![0]).toBe(0x42);
      expect(result![1024 * 1024 - 1]).toBe(0x42);
    });
  });

  describe('Batch Operations', () => {
    it('should execute batch puts atomically', async () => {
      await adapter.batch([
        { type: 'put', key: 'a', value: Buffer.from('1') },
        { type: 'put', key: 'b', value: Buffer.from('2') },
        { type: 'put', key: 'c', value: Buffer.from('3') },
      ]);

      expect((await adapter.get('a'))!.toString()).toBe('1');
      expect((await adapter.get('b'))!.toString()).toBe('2');
      expect((await adapter.get('c'))!.toString()).toBe('3');
    });

    it('should execute batch deletes', async () => {
      await adapter.put('x', Buffer.from('delete-me'));
      await adapter.put('y', Buffer.from('keep-me'));

      await adapter.batch([
        { type: 'del', key: 'x' },
      ]);

      expect(await adapter.get('x')).toBeNull();
      expect((await adapter.get('y'))!.toString()).toBe('keep-me');
    });

    it('should handle mixed put and delete in batch', async () => {
      await adapter.put('old', Buffer.from('old-value'));

      await adapter.batch([
        { type: 'del', key: 'old' },
        { type: 'put', key: 'new', value: Buffer.from('new-value') },
      ]);

      expect(await adapter.get('old')).toBeNull();
      expect((await adapter.get('new'))!.toString()).toBe('new-value');
    });

    it('should handle empty batch', async () => {
      await expect(adapter.batch([])).resolves.not.toThrow();
    });
  });

  describe('Prefix Scanning', () => {
    beforeEach(async () => {
      // Insert keys in random order — LevelDB sorts them
      await adapter.batch([
        { type: 'put', key: 'n:1:o:KNOWS:r1', value: Buffer.from([1]) },
        { type: 'put', key: 'n:1:o:KNOWS:r2', value: Buffer.from([1]) },
        { type: 'put', key: 'n:1:o:LIKES:r3', value: Buffer.from([1]) },
        { type: 'put', key: 'n:1:i:KNOWS:r4', value: Buffer.from([1]) },
        { type: 'put', key: 'n:2:o:KNOWS:r5', value: Buffer.from([1]) },
        { type: 'put', key: 'i:l:Person:1', value: Buffer.from([1]) },
        { type: 'put', key: 'i:l:Person:2', value: Buffer.from([1]) },
        { type: 'put', key: 'r:r1', value: Buffer.from('rel1') },
      ]);
    });

    it('should scan all keys with a prefix', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:1:o:')) {
        results.push(key);
      }
      expect(results).toHaveLength(3);
      expect(results).toContain('n:1:o:KNOWS:r1');
      expect(results).toContain('n:1:o:KNOWS:r2');
      expect(results).toContain('n:1:o:LIKES:r3');
    });

    it('should return keys in sorted order', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:1:o:')) {
        results.push(key);
      }
      // Sorted lexicographically
      const sorted = [...results].sort();
      expect(results).toEqual(sorted);
    });

    it('should scan specific relationship type', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:1:o:KNOWS:')) {
        results.push(key);
      }
      expect(results).toHaveLength(2);
    });

    it('should not return keys from other prefixes', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:2:')) {
        results.push(key);
      }
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('n:2:o:KNOWS:r5');
    });

    it('should scan label index', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('i:l:Person:')) {
        results.push(key);
      }
      expect(results).toHaveLength(2);
    });

    it('should return empty for non-matching prefix', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('z:nonexistent:')) {
        results.push(key);
      }
      expect(results).toHaveLength(0);
    });

    it('should respect limit option', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:1:o:', { limit: 2 })) {
        results.push(key);
      }
      expect(results).toHaveLength(2);
    });
  });

  describe('Persistence', () => {
    it('should persist data across close and reopen', async () => {
      // Write data
      await adapter.put('persistent', Buffer.from('survives-restart'));
      await adapter.close();

      // Reopen same path
      const adapter2 = new LevelAdapter({ path: dbPath });
      await adapter2.open();

      const result = await adapter2.get('persistent');
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe('survives-restart');

      await adapter2.close();
    });

    it('should persist batch writes across restart', async () => {
      await adapter.batch([
        { type: 'put', key: 'a', value: Buffer.from('1') },
        { type: 'put', key: 'b', value: Buffer.from('2') },
        { type: 'put', key: 'c', value: Buffer.from('3') },
      ]);
      await adapter.close();

      const adapter2 = new LevelAdapter({ path: dbPath });
      await adapter2.open();

      expect((await adapter2.get('a'))!.toString()).toBe('1');
      expect((await adapter2.get('b'))!.toString()).toBe('2');
      expect((await adapter2.get('c'))!.toString()).toBe('3');

      await adapter2.close();
    });

    it('should persist deletes across restart', async () => {
      await adapter.put('temp', Buffer.from('gone'));
      await adapter.delete('temp');
      await adapter.close();

      const adapter2 = new LevelAdapter({ path: dbPath });
      await adapter2.open();

      expect(await adapter2.get('temp')).toBeNull();
      await adapter2.close();
    });

    it('should persist prefix-scannable data across restart', async () => {
      await adapter.batch([
        { type: 'put', key: 'n:abc:o:KNOWS:r1', value: Buffer.from([1]) },
        { type: 'put', key: 'n:abc:o:KNOWS:r2', value: Buffer.from([1]) },
      ]);
      await adapter.close();

      const adapter2 = new LevelAdapter({ path: dbPath });
      await adapter2.open();

      const results: string[] = [];
      for await (const { key } of adapter2.scan('n:abc:o:KNOWS:')) {
        results.push(key);
      }
      expect(results).toHaveLength(2);

      await adapter2.close();
    });
  });

  describe('Error Handling', () => {
    it('should throw if used before open', async () => {
      const unopened = new LevelAdapter({ path: dbPath + '-unused' });
      await expect(unopened.get('key')).rejects.toThrow('not open');
    });

    it('should handle double close gracefully', async () => {
      await adapter.close();
      await expect(adapter.close()).resolves.not.toThrow();
    });
  });
});
