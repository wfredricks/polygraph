/**
 * Tests for PolyGraph Relationship Operations
 *
 * Why: Relationships are what make a graph a graph. Tests verify relationship CRUD,
 * cascade deletion, filtering, and adjacency list correctness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../engine.js';
import type { Node } from '../types.js';

describe('PolyGraph - Relationship Operations', () => {
  let graph: PolyGraph;
  let alice: Node;
  let bob: Node;
  let charlie: Node;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();

    alice = await graph.createNode(['Person'], { name: 'Alice' });
    bob = await graph.createNode(['Person'], { name: 'Bob' });
    charlie = await graph.createNode(['Person'], { name: 'Charlie' });
  });

  describe('createRelationship', () => {
    it('should create a relationship between two nodes', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS', { since: 2020 });

      expect(rel.id).toBeDefined();
      expect(rel.type).toBe('KNOWS');
      expect(rel.startNode).toBe(alice.id);
      expect(rel.endNode).toBe(bob.id);
      expect(rel.properties).toEqual({ since: 2020 });
    });

    it('should create a relationship without properties', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'FOLLOWS');

      expect(rel.properties).toEqual({});
    });

    it('should generate unique IDs', async () => {
      const rel1 = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      const rel2 = await graph.createRelationship(alice.id, charlie.id, 'KNOWS');

      expect(rel1.id).not.toBe(rel2.id);
    });

    it('should throw error if start node does not exist', async () => {
      await expect(async () => {
        await graph.createRelationship('non-existent', bob.id, 'KNOWS');
      }).rejects.toThrow('Cannot create relationship: node non-existent not found');
    });

    it('should throw error if end node does not exist', async () => {
      await expect(async () => {
        await graph.createRelationship(alice.id, 'non-existent', 'KNOWS');
      }).rejects.toThrow('Cannot create relationship: node non-existent not found');
    });

    it('should increment relationship count', async () => {
      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS');

      const stats = await graph.stats();
      expect(stats.relationshipCount).toBe(2);
    });

    it('should allow self-referencing relationships', async () => {
      const rel = await graph.createRelationship(alice.id, alice.id, 'LIKES');

      expect(rel.startNode).toBe(alice.id);
      expect(rel.endNode).toBe(alice.id);
    });
  });

  describe('getRelationship', () => {
    it('should retrieve a relationship by ID', async () => {
      const created = await graph.createRelationship(alice.id, bob.id, 'KNOWS', { since: 2020 });
      const retrieved = await graph.getRelationship(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent relationship', async () => {
      const result = await graph.getRelationship('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateRelationship', () => {
    it('should update relationship properties', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS', { since: 2020 });
      const updated = await graph.updateRelationship(rel.id, { since: 2021, strength: 'strong' });

      expect(updated.properties).toEqual({ since: 2021, strength: 'strong' });
    });

    it('should merge properties (not replace)', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS', { since: 2020 });
      await graph.updateRelationship(rel.id, { strength: 'strong' });

      const retrieved = await graph.getRelationship(rel.id);
      expect(retrieved?.properties).toEqual({ since: 2020, strength: 'strong' });
    });

    it('should throw error for non-existent relationship', async () => {
      await expect(async () => {
        await graph.updateRelationship('non-existent-id', { test: 'value' });
      }).rejects.toThrow('Relationship non-existent-id not found');
    });
  });

  describe('deleteRelationship', () => {
    it('should delete a relationship', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.deleteRelationship(rel.id);

      const retrieved = await graph.getRelationship(rel.id);
      expect(retrieved).toBeNull();
    });

    it('should decrement relationship count', async () => {
      const rel1 = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      const rel2 = await graph.createRelationship(bob.id, charlie.id, 'KNOWS');

      await graph.deleteRelationship(rel1.id);

      const stats = await graph.stats();
      expect(stats.relationshipCount).toBe(1);
    });

    it('should be idempotent (deleting non-existent relationship should not error)', async () => {
      await graph.deleteRelationship('non-existent-id');
      // Should not throw
    });

    it('should not affect nodes when deleting relationship', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.deleteRelationship(rel.id);

      const retrievedAlice = await graph.getNode(alice.id);
      const retrievedBob = await graph.getNode(bob.id);

      expect(retrievedAlice).not.toBeNull();
      expect(retrievedBob).not.toBeNull();
    });
  });

  describe('Cascade Delete on Node Deletion', () => {
    it('should delete outgoing relationships when node is deleted', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.deleteNode(alice.id);

      const retrievedRel = await graph.getRelationship(rel.id);
      expect(retrievedRel).toBeNull();
    });

    it('should delete incoming relationships when node is deleted', async () => {
      const rel = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.deleteNode(bob.id);

      const retrievedRel = await graph.getRelationship(rel.id);
      expect(retrievedRel).toBeNull();
    });

    it('should delete all connected relationships', async () => {
      const rel1 = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      const rel2 = await graph.createRelationship(charlie.id, alice.id, 'FOLLOWS');
      const rel3 = await graph.createRelationship(alice.id, charlie.id, 'LIKES');

      await graph.deleteNode(alice.id);

      expect(await graph.getRelationship(rel1.id)).toBeNull();
      expect(await graph.getRelationship(rel2.id)).toBeNull();
      expect(await graph.getRelationship(rel3.id)).toBeNull();
    });

    it('should update relationship count correctly after cascade delete', async () => {
      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS');
      await graph.createRelationship(alice.id, charlie.id, 'FOLLOWS');

      await graph.deleteNode(alice.id);

      const stats = await graph.stats();
      expect(stats.relationshipCount).toBe(1); // Only bob->charlie remains
    });
  });

  describe('findRelationships', () => {
    beforeEach(async () => {
      await graph.createRelationship(alice.id, bob.id, 'KNOWS', { since: 2020 });
      await graph.createRelationship(alice.id, charlie.id, 'KNOWS', { since: 2021 });
      await graph.createRelationship(bob.id, charlie.id, 'FOLLOWS', { since: 2019 });
    });

    it('should find all relationships by type', async () => {
      const knows = await graph.findRelationships('KNOWS');
      expect(knows.length).toBe(2);
    });

    it('should return empty array for non-existent type', async () => {
      const results = await graph.findRelationships('LIKES');
      expect(results).toEqual([]);
    });

    it('should filter by property value', async () => {
      const results = await graph.findRelationships('KNOWS', { since: 2020 });
      expect(results.length).toBe(1);
      expect(results[0].properties.since).toBe(2020);
    });

    it('should filter with comparison operators', async () => {
      const results = await graph.findRelationships('KNOWS', { since: { $gte: 2021 } });
      expect(results.length).toBe(1);
      expect(results[0].properties.since).toBe(2021);
    });
  });

  describe('getNeighbors (internal helper)', () => {
    beforeEach(async () => {
      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(alice.id, charlie.id, 'FOLLOWS');
      await graph.createRelationship(bob.id, alice.id, 'LIKES');
    });

    it('should get outgoing neighbors', async () => {
      const neighbors = await graph.getNeighbors(alice.id, undefined, 'outgoing');
      expect(neighbors.length).toBe(2);

      const nodeIds = neighbors.map(n => n.node.id);
      expect(nodeIds).toContain(bob.id);
      expect(nodeIds).toContain(charlie.id);
    });

    it('should get incoming neighbors', async () => {
      const neighbors = await graph.getNeighbors(alice.id, undefined, 'incoming');
      expect(neighbors.length).toBe(1);
      expect(neighbors[0].node.id).toBe(bob.id);
    });

    it('should get both directions', async () => {
      const neighbors = await graph.getNeighbors(alice.id, undefined, 'both');
      expect(neighbors.length).toBe(3);
    });

    it('should filter by relationship type', async () => {
      const neighbors = await graph.getNeighbors(alice.id, ['KNOWS'], 'outgoing');
      expect(neighbors.length).toBe(1);
      expect(neighbors[0].node.id).toBe(bob.id);
    });

    it('should filter by multiple relationship types', async () => {
      const neighbors = await graph.getNeighbors(alice.id, ['KNOWS', 'FOLLOWS'], 'outgoing');
      expect(neighbors.length).toBe(2);
    });
  });

  describe('Multiple Relationships Between Same Nodes', () => {
    it('should allow multiple relationships of different types', async () => {
      const rel1 = await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      const rel2 = await graph.createRelationship(alice.id, bob.id, 'FOLLOWS');

      expect(rel1.id).not.toBe(rel2.id);
      expect(await graph.getRelationship(rel1.id)).not.toBeNull();
      expect(await graph.getRelationship(rel2.id)).not.toBeNull();
    });

    it('should allow multiple relationships of the same type', async () => {
      const rel1 = await graph.createRelationship(alice.id, bob.id, 'KNOWS', { context: 'work' });
      const rel2 = await graph.createRelationship(alice.id, bob.id, 'KNOWS', { context: 'school' });

      expect(rel1.id).not.toBe(rel2.id);
      expect(await graph.getRelationship(rel1.id)).not.toBeNull();
      expect(await graph.getRelationship(rel2.id)).not.toBeNull();
    });
  });
});
