/**
 * Tests for MemoryAdapter
 *
 * Why: Ensures the in-memory storage adapter correctly implements the StorageAdapter interface,
 * with particular attention to sorted key ordering which is critical for graph operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryAdapter } from '../adapters/memory.js';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.open();
  });

  describe('Basic Operations', () => {
    it('should put and get a value', async () => {
      const key = 'test:key';
      const value = Buffer.from('test value');

      await adapter.put(key, value);
      const result = await adapter.get(key);

      expect(result).toEqual(value);
    });

    it('should return null for non-existent key', async () => {
      const result = await adapter.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete a key', async () => {
      const key = 'test:key';
      const value = Buffer.from('test value');

      await adapter.put(key, value);
      await adapter.delete(key);

      const result = await adapter.get(key);
      expect(result).toBeNull();
    });

    it('should overwrite existing key', async () => {
      const key = 'test:key';
      const value1 = Buffer.from('value 1');
      const value2 = Buffer.from('value 2');

      await adapter.put(key, value1);
      await adapter.put(key, value2);

      const result = await adapter.get(key);
      expect(result).toEqual(value2);
    });
  });

  describe('Batch Operations', () => {
    it('should execute batch put operations', async () => {
      await adapter.batch([
        { type: 'put', key: 'key1', value: Buffer.from('value1') },
        { type: 'put', key: 'key2', value: Buffer.from('value2') },
        { type: 'put', key: 'key3', value: Buffer.from('value3') },
      ]);

      expect(await adapter.get('key1')).toEqual(Buffer.from('value1'));
      expect(await adapter.get('key2')).toEqual(Buffer.from('value2'));
      expect(await adapter.get('key3')).toEqual(Buffer.from('value3'));
    });

    it('should execute batch delete operations', async () => {
      await adapter.put('key1', Buffer.from('value1'));
      await adapter.put('key2', Buffer.from('value2'));

      await adapter.batch([
        { type: 'del', key: 'key1' },
        { type: 'del', key: 'key2' },
      ]);

      expect(await adapter.get('key1')).toBeNull();
      expect(await adapter.get('key2')).toBeNull();
    });

    it('should execute mixed batch operations', async () => {
      await adapter.put('existing', Buffer.from('old value'));

      await adapter.batch([
        { type: 'put', key: 'new', value: Buffer.from('new value') },
        { type: 'del', key: 'existing' },
        { type: 'put', key: 'another', value: Buffer.from('another value') },
      ]);

      expect(await adapter.get('new')).toEqual(Buffer.from('new value'));
      expect(await adapter.get('existing')).toBeNull();
      expect(await adapter.get('another')).toEqual(Buffer.from('another value'));
    });

    it('should throw error for put without value', async () => {
      await expect(async () => {
        await adapter.batch([
          { type: 'put', key: 'key1' } as any,
        ]);
      }).rejects.toThrow('Put operation requires a value');
    });
  });

  describe('Scan Operations', () => {
    beforeEach(async () => {
      // Insert keys in random order to ensure sorting works
      await adapter.batch([
        { type: 'put', key: 'n:3', value: Buffer.from('node3') },
        { type: 'put', key: 'n:1', value: Buffer.from('node1') },
        { type: 'put', key: 'n:2', value: Buffer.from('node2') },
        { type: 'put', key: 'r:1', value: Buffer.from('rel1') },
        { type: 'put', key: 'n:10', value: Buffer.from('node10') },
      ]);
    });

    it('should scan with prefix and return sorted results', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:')) {
        results.push(key);
      }

      // Should be in lexicographic order
      expect(results).toEqual(['n:1', 'n:10', 'n:2', 'n:3']);
    });

    it('should scan with specific prefix', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('r:')) {
        results.push(key);
      }

      expect(results).toEqual(['r:1']);
    });

    it('should return empty for non-matching prefix', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('x:')) {
        results.push(key);
      }

      expect(results).toEqual([]);
    });

    it('should respect limit option', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:', { limit: 2 })) {
        results.push(key);
      }

      expect(results).toEqual(['n:1', 'n:10']);
    });

    it('should support reverse scan', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:', { reverse: true })) {
        results.push(key);
      }

      expect(results).toEqual(['n:3', 'n:2', 'n:10', 'n:1']);
    });

    it('should return both key and value', async () => {
      const results: Array<{ key: string; value: string }> = [];
      for await (const { key, value } of adapter.scan('n:1')) {
        results.push({ key, value: value.toString() });
      }

      expect(results).toEqual([
        { key: 'n:1', value: 'node1' },
        { key: 'n:10', value: 'node10' },
      ]);
    });
  });

  describe('Adjacency List Scanning (Critical for Graph)', () => {
    beforeEach(async () => {
      // Simulate graph adjacency list keys
      await adapter.batch([
        { type: 'put', key: 'n:user1:o:FOLLOWS:rel1', value: Buffer.from('1') },
        { type: 'put', key: 'n:user1:o:FOLLOWS:rel2', value: Buffer.from('1') },
        { type: 'put', key: 'n:user1:o:LIKES:rel3', value: Buffer.from('1') },
        { type: 'put', key: 'n:user1:i:FOLLOWS:rel4', value: Buffer.from('1') },
        { type: 'put', key: 'n:user2:o:FOLLOWS:rel5', value: Buffer.from('1') },
      ]);
    });

    it('should scan outgoing relationships for a node', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:user1:o:')) {
        results.push(key);
      }

      expect(results.length).toBe(3);
      expect(results).toContain('n:user1:o:FOLLOWS:rel1');
      expect(results).toContain('n:user1:o:FOLLOWS:rel2');
      expect(results).toContain('n:user1:o:LIKES:rel3');
    });

    it('should scan outgoing relationships of specific type', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:user1:o:FOLLOWS:')) {
        results.push(key);
      }

      expect(results).toEqual([
        'n:user1:o:FOLLOWS:rel1',
        'n:user1:o:FOLLOWS:rel2',
      ]);
    });

    it('should scan incoming relationships', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:user1:i:')) {
        results.push(key);
      }

      expect(results).toEqual(['n:user1:i:FOLLOWS:rel4']);
    });

    it('should isolate different nodes', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('n:user2:o:')) {
        results.push(key);
      }

      expect(results).toEqual(['n:user2:o:FOLLOWS:rel5']);
    });
  });

  describe('Index Scanning', () => {
    beforeEach(async () => {
      await adapter.batch([
        { type: 'put', key: 'i:l:Person:id1', value: Buffer.from('1') },
        { type: 'put', key: 'i:l:Person:id2', value: Buffer.from('1') },
        { type: 'put', key: 'i:l:Person:id3', value: Buffer.from('1') },
        { type: 'put', key: 'i:l:Company:id4', value: Buffer.from('1') },
        { type: 'put', key: 'i:p:Person:age:25:id1', value: Buffer.from('1') },
        { type: 'put', key: 'i:p:Person:age:25:id2', value: Buffer.from('1') },
        { type: 'put', key: 'i:p:Person:age:30:id3', value: Buffer.from('1') },
      ]);
    });

    it('should scan label index', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('i:l:Person:')) {
        results.push(key);
      }

      expect(results).toEqual([
        'i:l:Person:id1',
        'i:l:Person:id2',
        'i:l:Person:id3',
      ]);
    });

    it('should scan property index', async () => {
      const results: string[] = [];
      for await (const { key } of adapter.scan('i:p:Person:age:25:')) {
        results.push(key);
      }

      expect(results).toEqual([
        'i:p:Person:age:25:id1',
        'i:p:Person:age:25:id2',
      ]);
    });
  });

  describe('Lifecycle', () => {
    it('should clear data on close', async () => {
      await adapter.put('key', Buffer.from('value'));
      await adapter.close();

      const result = await adapter.get('key');
      expect(result).toBeNull();
    });

    it('should allow reopening', async () => {
      await adapter.close();
      await adapter.open();

      await adapter.put('key', Buffer.from('value'));
      const result = await adapter.get('key');
      expect(result).toEqual(Buffer.from('value'));
    });
  });
});
