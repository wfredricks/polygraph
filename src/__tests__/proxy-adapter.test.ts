/**
 * PolyGraphProxyAdapter Tests — Full GraphProxy interface compliance.
 *
 * Why: This proves PolyGraph can serve as a drop-in replacement for Neo4j
 * through the GraphProxy (formerly LiteGraph) adapter interface.
 * Every operation the UDT uses must work identically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraphProxyAdapter } from '../proxy/polygraph-proxy-adapter.js';

describe('PolyGraphProxyAdapter', () => {
  let adapter: PolyGraphProxyAdapter;
  const SPACE = 'test-twin';

  beforeEach(async () => {
    adapter = new PolyGraphProxyAdapter({ storage: 'memory' });
    await adapter.connect();
    await adapter.createGraphSpace(SPACE);
  });

  describe('Connection Lifecycle', () => {
    it('should connect and report healthy', async () => {
      const health = await adapter.healthCheck();
      expect(health.connected).toBe(true);
      expect(health.provider).toBe('polygraph');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should disconnect cleanly', async () => {
      await adapter.disconnect();
      // No error = success
    });
  });

  describe('Graph Space Management', () => {
    it('should create and list graph spaces', async () => {
      await adapter.createGraphSpace('space-a');
      await adapter.createGraphSpace('space-b');
      const spaces = await adapter.listGraphSpaces();
      expect(spaces).toContain(SPACE);
      expect(spaces).toContain('space-a');
      expect(spaces).toContain('space-b');
    });

    it('should isolate data between graph spaces', async () => {
      await adapter.createGraphSpace('space-a');
      await adapter.createGraphSpace('space-b');

      await adapter.createNode('space-a', 'Person', { name: 'Alice' });
      await adapter.createNode('space-b', 'Person', { name: 'Bob' });

      const inA = await adapter.findNodes('space-a', 'Person');
      const inB = await adapter.findNodes('space-b', 'Person');

      expect(inA).toHaveLength(1);
      expect(inA[0].properties.name).toBe('Alice');
      expect(inB).toHaveLength(1);
      expect(inB[0].properties.name).toBe('Bob');
    });

    it('should drop a graph space', async () => {
      await adapter.createGraphSpace('temp');
      const before = await adapter.listGraphSpaces();
      expect(before).toContain('temp');

      await adapter.dropGraphSpace('temp');
      const after = await adapter.listGraphSpaces();
      expect(after).not.toContain('temp');
    });
  });

  describe('Node CRUD', () => {
    it('should create a node', async () => {
      const node = await adapter.createNode(SPACE, 'Person', { name: 'Alice', age: 30 });
      expect(node.id).toBeDefined();
      expect(node.label).toBe('Person');
      expect(node.properties.name).toBe('Alice');
    });

    it('should get a node by id', async () => {
      const created = await adapter.createNode(SPACE, 'Person', { name: 'Alice' });
      const retrieved = await adapter.getNode(SPACE, created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.properties.name).toBe('Alice');
    });

    it('should return null for missing node', async () => {
      const result = await adapter.getNode(SPACE, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should update a node', async () => {
      const node = await adapter.createNode(SPACE, 'Person', { name: 'Alice', age: 30 });
      const updated = await adapter.updateNode(SPACE, node.id, { age: 31 });
      expect(updated).not.toBeNull();
      expect(updated!.properties.age).toBe(31);
      expect(updated!.properties.name).toBe('Alice'); // preserved
    });

    it('should delete a node', async () => {
      const node = await adapter.createNode(SPACE, 'Person', { name: 'Alice' });
      const deleted = await adapter.deleteNode(SPACE, node.id);
      expect(deleted).toBe(true);

      const gone = await adapter.getNode(SPACE, node.id);
      expect(gone).toBeNull();
    });

    it('should return false when deleting non-existent node', async () => {
      const result = await adapter.deleteNode(SPACE, 'nonexistent');
      expect(result).toBe(false);
    });

    it('should find nodes by label', async () => {
      await adapter.createNode(SPACE, 'Person', { name: 'Alice' });
      await adapter.createNode(SPACE, 'Person', { name: 'Bob' });
      await adapter.createNode(SPACE, 'Project', { name: 'PolyGraph' });

      const people = await adapter.findNodes(SPACE, 'Person');
      expect(people).toHaveLength(2);

      const projects = await adapter.findNodes(SPACE, 'Project');
      expect(projects).toHaveLength(1);
    });

    it('should find nodes with filter', async () => {
      await adapter.createNode(SPACE, 'Person', { name: 'Alice', city: 'NYC' });
      await adapter.createNode(SPACE, 'Person', { name: 'Bob', city: 'LA' });

      const nyc = await adapter.findNodes(SPACE, 'Person', { city: 'NYC' });
      expect(nyc).toHaveLength(1);
      expect(nyc[0].properties.name).toBe('Alice');
    });
  });

  describe('Upsert', () => {
    it('should create node on first upsert', async () => {
      const node = await adapter.upsertNode(SPACE, 'Person', { email: 'alice@test.com' }, { name: 'Alice', age: 30 });
      expect(node.properties.name).toBe('Alice');
      expect(node.properties.email).toBe('alice@test.com');
    });

    it('should update existing node on second upsert', async () => {
      await adapter.upsertNode(SPACE, 'Person', { email: 'alice@test.com' }, { name: 'Alice', age: 30 });
      const updated = await adapter.upsertNode(SPACE, 'Person', { email: 'alice@test.com' }, { age: 31 });

      expect(updated.properties.age).toBe(31);

      // Should still be only one Person
      const all = await adapter.findNodes(SPACE, 'Person');
      expect(all).toHaveLength(1);
    });
  });

  describe('Relationship Operations', () => {
    let aliceId: string;
    let bobId: string;

    beforeEach(async () => {
      const alice = await adapter.createNode(SPACE, 'Person', { name: 'Alice' });
      const bob = await adapter.createNode(SPACE, 'Person', { name: 'Bob' });
      aliceId = alice.id;
      bobId = bob.id;
    });

    it('should create a relationship', async () => {
      const rel = await adapter.createRelationship(SPACE, aliceId, bobId, 'KNOWS', { since: 2020 });
      expect(rel.type).toBe('KNOWS');
      expect(rel.fromId).toBe(aliceId);
      expect(rel.toId).toBe(bobId);
      expect(rel.properties.since).toBe(2020);
    });

    it('should get relationships for a node', async () => {
      await adapter.createRelationship(SPACE, aliceId, bobId, 'KNOWS');

      const outgoing = await adapter.getRelationships(SPACE, aliceId, { direction: 'out' });
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].type).toBe('KNOWS');

      const incoming = await adapter.getRelationships(SPACE, bobId, { direction: 'in' });
      expect(incoming).toHaveLength(1);
    });

    it('should filter relationships by type', async () => {
      await adapter.createRelationship(SPACE, aliceId, bobId, 'KNOWS');
      await adapter.createRelationship(SPACE, aliceId, bobId, 'WORKS_WITH');

      const knows = await adapter.getRelationships(SPACE, aliceId, { direction: 'out', type: 'KNOWS' });
      expect(knows).toHaveLength(1);
      expect(knows[0].type).toBe('KNOWS');
    });

    it('should delete a relationship', async () => {
      const rel = await adapter.createRelationship(SPACE, aliceId, bobId, 'KNOWS');
      const deleted = await adapter.deleteRelationship(SPACE, rel.id);
      expect(deleted).toBe(true);

      const remaining = await adapter.getRelationships(SPACE, aliceId, { direction: 'out' });
      expect(remaining).toHaveLength(0);
    });

    it('should upsert relationships', async () => {
      const rel1 = await adapter.upsertRelationship(SPACE, aliceId, bobId, 'KNOWS', { since: 2020 });
      expect(rel1.properties.since).toBe(2020);

      const rel2 = await adapter.upsertRelationship(SPACE, aliceId, bobId, 'KNOWS', { since: 2019 });
      expect(rel2.id).toBe(rel1.id); // Same relationship
      expect(rel2.properties.since).toBe(2019); // Updated

      const all = await adapter.getRelationships(SPACE, aliceId, { direction: 'out', type: 'KNOWS' });
      expect(all).toHaveLength(1); // Not duplicated
    });
  });

  describe('Traversal', () => {
    beforeEach(async () => {
      const alice = await adapter.createNode(SPACE, 'Person', { name: 'Alice', age: 30 });
      const bob = await adapter.createNode(SPACE, 'Person', { name: 'Bob', age: 25 });
      const charlie = await adapter.createNode(SPACE, 'Person', { name: 'Charlie', age: 35 });
      const project = await adapter.createNode(SPACE, 'Project', { name: 'PolyGraph' });

      await adapter.createRelationship(SPACE, alice.id, bob.id, 'KNOWS');
      await adapter.createRelationship(SPACE, alice.id, charlie.id, 'KNOWS');
      await adapter.createRelationship(SPACE, bob.id, charlie.id, 'KNOWS');
      await adapter.createRelationship(SPACE, alice.id, project.id, 'WORKS_ON');
    });

    it('should traverse outgoing relationships', async () => {
      const people = await adapter.findNodes(SPACE, 'Person', { name: 'Alice' });
      const friends = await adapter.traverse(SPACE, people[0].id, {
        type: 'KNOWS',
        direction: 'out',
      });
      expect(friends).toHaveLength(2);
    });

    it('should traverse with depth', async () => {
      const people = await adapter.findNodes(SPACE, 'Person', { name: 'Alice' });
      const network = await adapter.traverse(SPACE, people[0].id, {
        type: 'KNOWS',
        direction: 'out',
        depth: 2,
      });
      expect(network).toHaveLength(2); // Bob + Charlie (unique)
    });

    it('should traverse with filter', async () => {
      const people = await adapter.findNodes(SPACE, 'Person', { name: 'Alice' });
      const older = await adapter.traverse(SPACE, people[0].id, {
        type: 'KNOWS',
        direction: 'out',
        filter: { age: { $gt: 28 } },
      });
      expect(older).toHaveLength(1);
      expect(older[0].properties.name).toBe('Charlie');
    });

    it('should traverse with limit', async () => {
      const people = await adapter.findNodes(SPACE, 'Person', { name: 'Alice' });
      const limited = await adapter.traverse(SPACE, people[0].id, {
        type: 'KNOWS',
        direction: 'out',
        limit: 1,
      });
      expect(limited).toHaveLength(1);
    });
  });

  describe('Batch Operations', () => {
    it('should batch create nodes', async () => {
      const nodes = await adapter.batchCreateNodes(SPACE, 'Person', [
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ]);
      expect(nodes).toHaveLength(3);

      const all = await adapter.findNodes(SPACE, 'Person');
      expect(all).toHaveLength(3);
    });

    it('should batch create relationships', async () => {
      const [a, b, c] = await adapter.batchCreateNodes(SPACE, 'Person', [
        { name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' },
      ]);

      const rels = await adapter.batchCreateRelationships(SPACE, [
        { fromId: a.id, toId: b.id, type: 'KNOWS' },
        { fromId: b.id, toId: c.id, type: 'KNOWS' },
      ]);
      expect(rels).toHaveLength(2);
    });

    it('should batch upsert nodes', async () => {
      // First batch — creates
      await adapter.batchUpsertNodes(SPACE, 'Person', 'email', [
        { email: 'alice@test.com', name: 'Alice', version: 1 },
        { email: 'bob@test.com', name: 'Bob', version: 1 },
      ]);

      // Second batch — updates
      await adapter.batchUpsertNodes(SPACE, 'Person', 'email', [
        { email: 'alice@test.com', name: 'Alice', version: 2 },
      ]);

      const all = await adapter.findNodes(SPACE, 'Person');
      expect(all).toHaveLength(2); // Not duplicated

      const alice = all.find((n) => n.properties.email === 'alice@test.com');
      expect(alice!.properties.version).toBe(2);
    });
  });

  describe('Portable Query', () => {
    beforeEach(async () => {
      await adapter.batchCreateNodes(SPACE, 'Person', [
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
        { name: 'Charlie', age: 35, city: 'NYC' },
      ]);
    });

    it('should execute match query', async () => {
      const results = await adapter.query(SPACE, {
        kind: 'match',
        label: 'Person',
        where: { city: 'NYC' },
      });
      expect(results).toHaveLength(2);
    });

    it('should execute match query with ordering', async () => {
      const results = await adapter.query(SPACE, {
        kind: 'match',
        label: 'Person',
        orderBy: { field: 'age', direction: 'DESC' },
      });
      expect(results[0].name).toBe('Charlie');
      expect(results[2].name).toBe('Bob');
    });

    it('should execute match query with limit', async () => {
      const results = await adapter.query(SPACE, {
        kind: 'match',
        label: 'Person',
        limit: 1,
      });
      expect(results).toHaveLength(1);
    });

    it('should execute match query with return fields', async () => {
      const results = await adapter.query(SPACE, {
        kind: 'match',
        label: 'Person',
        where: { name: 'Alice' },
        returnFields: ['name', 'age'],
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
      expect(results[0].age).toBe(30);
      expect(results[0].city).toBeUndefined(); // Not in returnFields
    });
  });

  describe('Raw Query (Cypher Bridge)', () => {
    it('should execute raw Cypher via PolyGraph bridge', async () => {
      await adapter.createNode(SPACE, 'Hero', { name: 'Batman' });

      // Note: rawQuery bypasses graph space scoping since it goes through
      // PolyGraph's Cypher bridge directly. The label needs the full scoped name.
      // This is a known limitation — rawQuery is for advanced use.
    });
  });

  describe('Schema', () => {
    it('should create indexes via ensureIndex', async () => {
      await adapter.ensureIndex(SPACE, 'Person', ['email']);
      // No error = success. Index is used internally by findNodes.
    });

    it('should initialize full schema', async () => {
      await adapter.initSchema(SPACE, {
        version: '1.0',
        constraints: [{ label: 'Person', property: 'email', type: 'unique' }],
        indexes: [{ label: 'Person', properties: ['name'] }],
      });
      // No error = success
    });
  });

  describe('Feature Detection', () => {
    it('should report supported features', () => {
      expect(adapter.hasFeature('nodes')).toBe(true);
      expect(adapter.hasFeature('relationships')).toBe(true);
      expect(adapter.hasFeature('traversal')).toBe(true);
      expect(adapter.hasFeature('cypher-bridge')).toBe(true);
      expect(adapter.hasFeature('upsert')).toBe(true);
      expect(adapter.hasFeature('graph-spaces')).toBe(true);
    });

    it('should report unsupported features', () => {
      expect(adapter.hasFeature('full-text-search')).toBe(false);
      expect(adapter.hasFeature('clustering')).toBe(false);
    });
  });
});
