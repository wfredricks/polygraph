/**
 * Cypher Bridge Tests — Lightweight Cypher query support.
 *
 * Why: Validates that common Cypher patterns are correctly parsed and executed
 * against the PolyGraph engine. This is the bridge that makes Neo4j users
 * feel at home.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../engine.js';
import { parseCypher } from '../pure/cypher.js';

describe('Cypher Bridge', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('Parser — Pure Function Tests', () => {
    it('should parse simple MATCH with label', () => {
      const plan = parseCypher("MATCH (n:Person) RETURN n");
      expect(plan.type).toBe('match');
      if (plan.type === 'match') {
        expect(plan.pattern.start.variable).toBe('n');
        expect(plan.pattern.start.labels).toEqual(['Person']);
      }
    });

    it('should parse MATCH with relationship', () => {
      const plan = parseCypher("MATCH (a:Person)-[:KNOWS]->(b:Person) RETURN b");
      expect(plan.type).toBe('match');
      if (plan.type === 'match') {
        expect(plan.pattern.start.labels).toEqual(['Person']);
        expect(plan.pattern.segments).toHaveLength(1);
        expect(plan.pattern.segments[0].rel.type).toBe('KNOWS');
        expect(plan.pattern.segments[0].rel.direction).toBe('outgoing');
        expect(plan.pattern.segments[0].node.labels).toEqual(['Person']);
      }
    });

    it('should parse MATCH with incoming relationship', () => {
      const plan = parseCypher("MATCH (a:Person)<-[:FOLLOWS]-(b:Person) RETURN b");
      expect(plan.type).toBe('match');
      if (plan.type === 'match') {
        expect(plan.pattern.segments[0].rel.direction).toBe('incoming');
      }
    });

    it('should parse WHERE clause with equality', () => {
      const plan = parseCypher("MATCH (n:Person) WHERE n.name = 'Alice' RETURN n");
      expect(plan.type).toBe('match');
      if (plan.type === 'match') {
        expect(plan.where).toBeDefined();
        expect(plan.where!.conditions).toHaveLength(1);
        expect(plan.where!.conditions[0].variable).toBe('n');
        expect(plan.where!.conditions[0].property).toBe('name');
        expect(plan.where!.conditions[0].operator).toBe('=');
        expect(plan.where!.conditions[0].value).toBe('Alice');
      }
    });

    it('should parse WHERE clause with multiple conditions', () => {
      const plan = parseCypher("MATCH (n:Person) WHERE n.age > 30 AND n.city = 'NYC' RETURN n");
      if (plan.type === 'match') {
        expect(plan.where!.conditions).toHaveLength(2);
        expect(plan.where!.conditions[0].operator).toBe('>');
        expect(plan.where!.conditions[0].value).toBe(30);
        expect(plan.where!.conditions[1].operator).toBe('=');
        expect(plan.where!.conditions[1].value).toBe('NYC');
      }
    });

    it('should parse RETURN with property access', () => {
      const plan = parseCypher("MATCH (n:Person) RETURN n.name, n.age");
      if (plan.type === 'match') {
        expect(plan.returns!.items).toHaveLength(2);
        expect(plan.returns!.items[0].variable).toBe('n');
        expect(plan.returns!.items[0].property).toBe('name');
      }
    });

    it('should parse LIMIT', () => {
      const plan = parseCypher("MATCH (n:Person) RETURN n LIMIT 10");
      if (plan.type === 'match') {
        expect(plan.limit).toBe(10);
      }
    });

    it('should parse CREATE node', () => {
      const plan = parseCypher("CREATE (n:Person {name: 'Alice', age: 30})");
      expect(plan.type).toBe('create-node');
      if (plan.type === 'create-node') {
        expect(plan.node.labels).toEqual(['Person']);
        expect(plan.node.properties?.name).toBe('Alice');
        expect(plan.node.properties?.age).toBe(30);
      }
    });

    it('should parse CREATE path', () => {
      const plan = parseCypher("CREATE (a:Person {name: 'Alice'})-[:KNOWS]->(b:Person {name: 'Bob'})");
      expect(plan.type).toBe('create-path');
    });

    it('should parse MATCH with SET', () => {
      const plan = parseCypher("MATCH (n:Person) WHERE n.name = 'Alice' SET n.age = 31");
      expect(plan.type).toBe('match-set');
    });

    it('should parse MATCH with DELETE', () => {
      const plan = parseCypher("MATCH (n:Person) WHERE n.name = 'Alice' DELETE n");
      expect(plan.type).toBe('match-delete');
    });
  });

  describe('Query Execution — CREATE', () => {
    it('should create a node via Cypher', async () => {
      const results = await graph.query("CREATE (n:Person {name: 'Alice', age: 30})");

      expect(results).toHaveLength(1);
      expect(results[0].n.labels).toContain('Person');
      expect(results[0].n.properties.name).toBe('Alice');
      expect(results[0].n.properties.age).toBe(30);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(1);
    });

    it('should create a path via Cypher', async () => {
      const results = await graph.query(
        "CREATE (a:Person {name: 'Alice'})-[:KNOWS {since: 2020}]->(b:Person {name: 'Bob'})"
      );

      expect(results).toHaveLength(1);
      expect(results[0].a.properties.name).toBe('Alice');
      expect(results[0].b.properties.name).toBe('Bob');
      expect(results[0].rel.type).toBe('KNOWS');
      expect(results[0].rel.properties.since).toBe(2020);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.relationshipCount).toBe(1);
    });
  });

  describe('Query Execution — MATCH', () => {
    beforeEach(async () => {
      // Set up a small social graph
      const alice = await graph.createNode(['Person'], { name: 'Alice', age: 30, city: 'NYC' });
      const bob = await graph.createNode(['Person'], { name: 'Bob', age: 25, city: 'LA' });
      const charlie = await graph.createNode(['Person'], { name: 'Charlie', age: 35, city: 'NYC' });
      const project = await graph.createNode(['Project'], { name: 'PolyGraph', status: 'active' });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS', { since: 2020 });
      await graph.createRelationship(alice.id, charlie.id, 'KNOWS', { since: 2019 });
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS', { since: 2021 });
      await graph.createRelationship(alice.id, project.id, 'WORKS_ON');
    });

    it('should match all nodes with a label', async () => {
      const results = await graph.query("MATCH (n:Person) RETURN n");
      expect(results).toHaveLength(3);
    });

    it('should match with WHERE equality', async () => {
      const results = await graph.query("MATCH (n:Person) WHERE n.name = 'Alice' RETURN n");
      expect(results).toHaveLength(1);
      expect(results[0].n.properties.name).toBe('Alice');
    });

    it('should match with WHERE comparison', async () => {
      const results = await graph.query("MATCH (n:Person) WHERE n.age > 28 RETURN n");
      expect(results).toHaveLength(2); // Alice (30) and Charlie (35)
    });

    it('should match with WHERE AND', async () => {
      const results = await graph.query("MATCH (n:Person) WHERE n.age > 28 AND n.city = 'NYC' RETURN n");
      expect(results).toHaveLength(2); // Alice and Charlie, both in NYC and > 28
    });

    it('should match with relationship pattern', async () => {
      const results = await graph.query("MATCH (a:Person)-[:KNOWS]->(b:Person) WHERE a.name = 'Alice' RETURN b");
      expect(results).toHaveLength(2); // Bob and Charlie
    });

    it('should return specific properties', async () => {
      const results = await graph.query("MATCH (n:Person) WHERE n.name = 'Alice' RETURN n.name, n.age");
      expect(results).toHaveLength(1);
      expect(results[0]['n.name']).toBe('Alice');
      expect(results[0]['n.age']).toBe(30);
    });

    it('should respect LIMIT', async () => {
      const results = await graph.query("MATCH (n:Person) RETURN n LIMIT 2");
      expect(results).toHaveLength(2);
    });

    it('should match cross-label relationships', async () => {
      const results = await graph.query("MATCH (p:Person)-[:WORKS_ON]->(proj:Project) RETURN p, proj");
      expect(results).toHaveLength(1);
      expect(results[0].p.properties.name).toBe('Alice');
      expect(results[0].proj.properties.name).toBe('PolyGraph');
    });
  });

  describe('Query Execution — SET', () => {
    it('should update node properties via Cypher', async () => {
      await graph.createNode(['Person'], { name: 'Alice', age: 30 });

      await graph.query("MATCH (n:Person) WHERE n.name = 'Alice' SET n.age = 31");

      const results = await graph.query("MATCH (n:Person) WHERE n.name = 'Alice' RETURN n.age");
      expect(results[0]['n.age']).toBe(31);
    });
  });

  describe('Query Execution — DELETE', () => {
    it('should delete nodes via Cypher', async () => {
      await graph.createNode(['Temp'], { name: 'DeleteMe' });
      expect((await graph.stats()).nodeCount).toBe(1);

      await graph.query("MATCH (n:Temp) WHERE n.name = 'DeleteMe' DELETE n");

      expect((await graph.stats()).nodeCount).toBe(0);
    });
  });
});
