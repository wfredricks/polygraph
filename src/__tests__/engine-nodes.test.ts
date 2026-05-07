/**
 * Tests for PolyGraph Node Operations
 *
 * Why: Node CRUD operations are the foundation of the graph database.
 * Tests verify correctness of create, read, update, delete, labels, and filtering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../engine.js';

describe('PolyGraph - Node Operations', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('createNode', () => {
    it('should create a node with labels and properties', async () => {
      const node = await graph.createNode(['Person'], { name: 'Alice', age: 30 });

      expect(node.id).toBeDefined();
      expect(node.labels).toEqual(['Person']);
      expect(node.properties).toEqual({ name: 'Alice', age: 30 });
    });

    it('should create a node with multiple labels', async () => {
      const node = await graph.createNode(['Person', 'Employee'], { name: 'Bob' });

      expect(node.labels).toEqual(['Person', 'Employee']);
    });

    it('should create a node without properties', async () => {
      const node = await graph.createNode(['Tag']);

      expect(node.properties).toEqual({});
    });

    it('should generate unique IDs', async () => {
      const node1 = await graph.createNode(['Test']);
      const node2 = await graph.createNode(['Test']);

      expect(node1.id).not.toBe(node2.id);
    });

    it('should increment node count', async () => {
      await graph.createNode(['Test']);
      await graph.createNode(['Test']);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(2);
    });
  });

  describe('getNode', () => {
    it('should retrieve a node by ID', async () => {
      const created = await graph.createNode(['Person'], { name: 'Alice' });
      const retrieved = await graph.getNode(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent node', async () => {
      const result = await graph.getNode('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateNode', () => {
    it('should update node properties', async () => {
      const node = await graph.createNode(['Person'], { name: 'Alice', age: 30 });
      const updated = await graph.updateNode(node.id, { age: 31, city: 'NYC' });

      expect(updated.properties).toEqual({ name: 'Alice', age: 31, city: 'NYC' });
    });

    it('should merge properties (not replace)', async () => {
      const node = await graph.createNode(['Person'], { name: 'Alice', age: 30 });
      await graph.updateNode(node.id, { city: 'NYC' });

      const retrieved = await graph.getNode(node.id);
      expect(retrieved?.properties).toEqual({ name: 'Alice', age: 30, city: 'NYC' });
    });

    it('should throw error for non-existent node', async () => {
      await expect(async () => {
        await graph.updateNode('non-existent-id', { name: 'Test' });
      }).rejects.toThrow('Node non-existent-id not found');
    });
  });

  describe('deleteNode', () => {
    it('should delete a node', async () => {
      const node = await graph.createNode(['Person'], { name: 'Alice' });
      await graph.deleteNode(node.id);

      const retrieved = await graph.getNode(node.id);
      expect(retrieved).toBeNull();
    });

    it('should decrement node count', async () => {
      const node1 = await graph.createNode(['Test']);
      const node2 = await graph.createNode(['Test']);

      await graph.deleteNode(node1.id);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(1);
    });

    it('should be idempotent (deleting non-existent node should not error)', async () => {
      await graph.deleteNode('non-existent-id');
      // Should not throw
    });

    it('should delete connected relationships', async () => {
      const node1 = await graph.createNode(['Person'], { name: 'Alice' });
      const node2 = await graph.createNode(['Person'], { name: 'Bob' });
      const rel = await graph.createRelationship(node1.id, node2.id, 'KNOWS');

      await graph.deleteNode(node1.id);

      const retrievedRel = await graph.getRelationship(rel.id);
      expect(retrievedRel).toBeNull();
    });
  });

  describe('findNodes', () => {
    beforeEach(async () => {
      await graph.createNode(['Person'], { name: 'Alice', age: 30, city: 'NYC' });
      await graph.createNode(['Person'], { name: 'Bob', age: 25, city: 'LA' });
      await graph.createNode(['Person'], { name: 'Charlie', age: 35, city: 'NYC' });
      await graph.createNode(['Company'], { name: 'Acme Corp' });
    });

    it('should find all nodes by label', async () => {
      const persons = await graph.findNodes('Person');
      expect(persons.length).toBe(3);
    });

    it('should return empty array for non-existent label', async () => {
      const results = await graph.findNodes('NonExistent');
      expect(results).toEqual([]);
    });

    it('should filter by exact property value', async () => {
      const results = await graph.findNodes('Person', { name: 'Alice' });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should filter with $eq operator', async () => {
      const results = await graph.findNodes('Person', { age: { $eq: 30 } });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should filter with $neq operator', async () => {
      const results = await graph.findNodes('Person', { age: { $neq: 30 } });
      expect(results.length).toBe(2);
    });

    it('should filter with $gt operator', async () => {
      const results = await graph.findNodes('Person', { age: { $gt: 30 } });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Charlie');
    });

    it('should filter with $gte operator', async () => {
      const results = await graph.findNodes('Person', { age: { $gte: 30 } });
      expect(results.length).toBe(2);
    });

    it('should filter with $lt operator', async () => {
      const results = await graph.findNodes('Person', { age: { $lt: 30 } });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Bob');
    });

    it('should filter with $lte operator', async () => {
      const results = await graph.findNodes('Person', { age: { $lte: 30 } });
      expect(results.length).toBe(2);
    });

    it('should filter with $in operator', async () => {
      const results = await graph.findNodes('Person', { city: { $in: ['NYC', 'SF'] } });
      expect(results.length).toBe(2);
    });

    it('should filter with $contains operator', async () => {
      const results = await graph.findNodes('Person', { name: { $contains: 'arlie' } });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Charlie');
    });

    it('should filter with $startsWith operator', async () => {
      const results = await graph.findNodes('Person', { name: { $startsWith: 'Al' } });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should filter with $endsWith operator', async () => {
      const results = await graph.findNodes('Person', { name: { $endsWith: 'ice' } });
      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should filter with $exists operator (true)', async () => {
      const results = await graph.findNodes('Person', { city: { $exists: true } });
      expect(results.length).toBe(3);
    });

    it('should filter with $exists operator (false)', async () => {
      const results = await graph.findNodes('Company', { city: { $exists: false } });
      expect(results.length).toBe(1);
    });

    it('should filter with multiple conditions', async () => {
      const results = await graph.findNodes('Person', {
        age: { $gte: 30 },
        city: 'NYC',
      });
      expect(results.length).toBe(2);
    });
  });

  describe('Label Operations', () => {
    it('should add a label to a node', async () => {
      const node = await graph.createNode(['Person'], { name: 'Alice' });
      const updated = await graph.addLabel(node.id, 'Employee');

      expect(updated.labels).toContain('Person');
      expect(updated.labels).toContain('Employee');
    });

    it('should be idempotent when adding existing label', async () => {
      const node = await graph.createNode(['Person']);
      await graph.addLabel(node.id, 'Person');

      const retrieved = await graph.getNode(node.id);
      expect(retrieved?.labels).toEqual(['Person']);
    });

    it('should throw error when adding label to non-existent node', async () => {
      await expect(async () => {
        await graph.addLabel('non-existent', 'Label');
      }).rejects.toThrow('Node non-existent not found');
    });

    it('should remove a label from a node', async () => {
      const node = await graph.createNode(['Person', 'Employee'], { name: 'Alice' });
      const updated = await graph.removeLabel(node.id, 'Employee');

      expect(updated.labels).toEqual(['Person']);
    });

    it('should be idempotent when removing non-existent label', async () => {
      const node = await graph.createNode(['Person']);
      await graph.removeLabel(node.id, 'NonExistent');

      const retrieved = await graph.getNode(node.id);
      expect(retrieved?.labels).toEqual(['Person']);
    });

    it('should check if node has a label', async () => {
      const node = await graph.createNode(['Person', 'Employee']);

      expect(await graph.hasLabel(node.id, 'Person')).toBe(true);
      expect(await graph.hasLabel(node.id, 'Employee')).toBe(true);
      expect(await graph.hasLabel(node.id, 'Manager')).toBe(false);
    });

    it('should return false for non-existent node', async () => {
      expect(await graph.hasLabel('non-existent', 'Person')).toBe(false);
    });
  });

  describe('Stats', () => {
    it('should return correct stats', async () => {
      await graph.createNode(['Person']);
      await graph.createNode(['Person']);
      await graph.createIndex('Person', 'name');

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.relationshipCount).toBe(0);
      expect(stats.indexCount).toBe(1);
    });
  });
});
