/**
 * Tests for PolyGraph Index Management
 *
 * Why: Indexes dramatically speed up property-based queries by avoiding full scans.
 * Tests verify index creation, usage, and maintenance.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../engine.js';

describe('PolyGraph - Index Management', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('createIndex', () => {
    it('should create an index for a label and property', async () => {
      await graph.createIndex('Person', 'email');

      const stats = await graph.stats();
      expect(stats.indexCount).toBe(1);
    });

    it('should be idempotent (creating same index twice)', async () => {
      await graph.createIndex('Person', 'email');
      await graph.createIndex('Person', 'email');

      const stats = await graph.stats();
      expect(stats.indexCount).toBe(1);
    });

    it('should allow multiple indexes on same label', async () => {
      await graph.createIndex('Person', 'email');
      await graph.createIndex('Person', 'name');

      const stats = await graph.stats();
      expect(stats.indexCount).toBe(2);
    });

    it('should allow same property indexed across different labels', async () => {
      await graph.createIndex('Person', 'name');
      await graph.createIndex('Company', 'name');

      const stats = await graph.stats();
      expect(stats.indexCount).toBe(2);
    });

    it('should index existing nodes when created', async () => {
      await graph.createNode(['Person'], { name: 'Alice', email: 'alice@example.com' });
      await graph.createNode(['Person'], { name: 'Bob', email: 'bob@example.com' });

      await graph.createIndex('Person', 'email');

      // Index should now accelerate lookups
      const results = await graph.findNodes('Person', { email: 'alice@example.com' });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });
  });

  describe('dropIndex', () => {
    it('should drop an existing index', async () => {
      await graph.createIndex('Person', 'email');

      let stats = await graph.stats();
      expect(stats.indexCount).toBe(1);

      await graph.dropIndex('Person', 'email');

      stats = await graph.stats();
      expect(stats.indexCount).toBe(0);
    });

    it('should be idempotent (dropping non-existent index)', async () => {
      await graph.dropIndex('Person', 'email');
      // Should not throw
    });

    it('should still allow queries after dropping index (just slower)', async () => {
      await graph.createNode(['Person'], { name: 'Alice', email: 'alice@example.com' });

      await graph.createIndex('Person', 'email');
      await graph.dropIndex('Person', 'email');

      // Should still work, just using label scan instead of index
      const results = await graph.findNodes('Person', { email: 'alice@example.com' });
      expect(results.length).toBe(1);
    });
  });

  describe('Index Usage in findNodes', () => {
    beforeEach(async () => {
      await graph.createNode(['Person'], { name: 'Alice', age: 30, email: 'alice@example.com' });
      await graph.createNode(['Person'], { name: 'Bob', age: 25, email: 'bob@example.com' });
      await graph.createNode(['Person'], { name: 'Charlie', age: 35, email: 'charlie@example.com' });

      await graph.createIndex('Person', 'email');
    });

    it('should use index for exact match queries', async () => {
      const results = await graph.findNodes('Person', { email: 'bob@example.com' });

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Bob');
    });

    it('should use index for $eq queries', async () => {
      const results = await graph.findNodes('Person', { email: { $eq: 'alice@example.com' } });

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should fall back to label scan for non-indexed properties', async () => {
      // age is not indexed
      const results = await graph.findNodes('Person', { age: 30 });

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should fall back to label scan for range queries', async () => {
      // Index only helps with exact matches in our implementation
      const results = await graph.findNodes('Person', { age: { $gte: 30 } });

      expect(results.length).toBe(2);
    });

    it('should handle queries with both indexed and non-indexed properties', async () => {
      const results = await graph.findNodes('Person', {
        email: 'alice@example.com',
        age: { $gte: 25 },
      });

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });
  });

  describe('Index Maintenance on Updates', () => {
    beforeEach(async () => {
      await graph.createIndex('Person', 'email');
    });

    it('should update index when node property changes', async () => {
      const alice = await graph.createNode(['Person'], { name: 'Alice', email: 'alice@old.com' });

      await graph.updateNode(alice.id, { email: 'alice@new.com' });

      // Old value should not be found
      const oldResults = await graph.findNodes('Person', { email: 'alice@old.com' });
      expect(oldResults.length).toBe(0);

      // New value should be found
      const newResults = await graph.findNodes('Person', { email: 'alice@new.com' });
      expect(newResults.length).toBe(1);
    });

    it('should add index entry when property is added', async () => {
      const alice = await graph.createNode(['Person'], { name: 'Alice' });

      await graph.updateNode(alice.id, { email: 'alice@example.com' });

      const results = await graph.findNodes('Person', { email: 'alice@example.com' });
      expect(results.length).toBe(1);
    });

    it('should maintain index when adding label to node', async () => {
      const node = await graph.createNode(['Person'], { email: 'test@example.com' });

      await graph.createIndex('Employee', 'email');
      await graph.addLabel(node.id, 'Employee');

      const results = await graph.findNodes('Employee', { email: 'test@example.com' });
      expect(results.length).toBe(1);
    });

    it('should remove index entries when label is removed', async () => {
      const node = await graph.createNode(['Person', 'Employee'], { email: 'test@example.com' });

      await graph.createIndex('Person', 'email');
      await graph.removeLabel(node.id, 'Person');

      const results = await graph.findNodes('Person', { email: 'test@example.com' });
      expect(results.length).toBe(0);
    });
  });

  describe('Index Maintenance on Deletes', () => {
    beforeEach(async () => {
      await graph.createIndex('Person', 'email');
    });

    it('should remove index entries when node is deleted', async () => {
      const alice = await graph.createNode(['Person'], { name: 'Alice', email: 'alice@example.com' });
      const bob = await graph.createNode(['Person'], { name: 'Bob', email: 'bob@example.com' });

      await graph.deleteNode(alice.id);

      const results = await graph.findNodes('Person', { email: 'alice@example.com' });
      expect(results.length).toBe(0);

      const bobResults = await graph.findNodes('Person', { email: 'bob@example.com' });
      expect(bobResults.length).toBe(1);
    });
  });

  describe('Multiple Indexes', () => {
    it('should maintain multiple indexes independently', async () => {
      await graph.createIndex('Person', 'email');
      await graph.createIndex('Person', 'username');

      await graph.createNode(['Person'], {
        name: 'Alice',
        email: 'alice@example.com',
        username: 'alice123',
      });

      const byEmail = await graph.findNodes('Person', { email: 'alice@example.com' });
      expect(byEmail.length).toBe(1);

      const byUsername = await graph.findNodes('Person', { username: 'alice123' });
      expect(byUsername.length).toBe(1);
    });

    it('should choose appropriate index for query', async () => {
      await graph.createIndex('Person', 'email');
      await graph.createIndex('Person', 'username');

      await graph.createNode(['Person'], {
        email: 'alice@example.com',
        username: 'alice123',
        age: 30,
      });

      // Should use email index, then post-filter by age
      const results = await graph.findNodes('Person', {
        email: 'alice@example.com',
        age: { $gte: 20 }, // This can't use index, applied as post-filter
      });

      expect(results.length).toBe(1);
    });
  });

  describe('Index Performance Characteristics', () => {
    it('should handle large number of indexed nodes', async () => {
      await graph.createIndex('Person', 'id');

      // Create 100 nodes
      const nodes = [];
      for (let i = 0; i < 100; i++) {
        nodes.push(await graph.createNode(['Person'], { id: `user${i}`, value: i }));
      }

      // Lookup should be fast with index
      const results = await graph.findNodes('Person', { id: 'user50' });
      expect(results.length).toBe(1);
      expect(results[0].properties.value).toBe(50);
    });

    it('should handle nodes without indexed property', async () => {
      await graph.createIndex('Person', 'email');

      await graph.createNode(['Person'], { name: 'Alice', email: 'alice@example.com' });
      await graph.createNode(['Person'], { name: 'Bob' }); // No email

      const results = await graph.findNodes('Person', { email: 'alice@example.com' });
      expect(results.length).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle indexing null values', async () => {
      await graph.createIndex('Person', 'optional');

      await graph.createNode(['Person'], { name: 'Alice', optional: null });

      // Finding by null should work
      const results = await graph.findNodes('Person', { optional: null });
      expect(results.length).toBe(1);
    });

    it('should handle indexing various data types', async () => {
      await graph.createIndex('Data', 'value');

      await graph.createNode(['Data'], { value: 'string' });
      await graph.createNode(['Data'], { value: 123 });
      await graph.createNode(['Data'], { value: true });

      expect((await graph.findNodes('Data', { value: 'string' })).length).toBe(1);
      expect((await graph.findNodes('Data', { value: 123 })).length).toBe(1);
      expect((await graph.findNodes('Data', { value: true })).length).toBe(1);
    });

    it('should handle indexing array values', async () => {
      await graph.createIndex('Person', 'tags');

      await graph.createNode(['Person'], { name: 'Alice', tags: ['developer', 'admin'] });

      // Arrays are converted to strings for indexing
      const results = await graph.findNodes('Person', { tags: ['developer', 'admin'] });
      expect(results.length).toBe(1);
    });
  });
});
