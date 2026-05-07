/**
 * Tests for PolyGraph Traversal Operations
 *
 * Why: Traversal is the core capability of a graph database. Tests verify the fluent API,
 * path finding, neighborhood queries, and shortest path algorithms.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../engine.js';
import type { Node } from '../types.js';

describe('PolyGraph - Traversal Operations', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('TraversalBuilder - Basic Traversal', () => {
    let alice: Node, bob: Node, charlie: Node, david: Node;

    beforeEach(async () => {
      // Create a simple graph: Alice -> Bob -> Charlie -> David
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });
      charlie = await graph.createNode(['Person'], { name: 'Charlie' });
      david = await graph.createNode(['Person'], { name: 'David' });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS');
      await graph.createRelationship(charlie.id, david.id, 'KNOWS');
    });

    it('should traverse outgoing relationships (depth 1)', async () => {
      const results = await graph.traverse(alice.id).outgoing('KNOWS').collect();

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Bob');
    });

    it('should traverse outgoing relationships (depth 2)', async () => {
      const results = await graph.traverse(alice.id).outgoing('KNOWS').depth(2).collect();

      expect(results.length).toBe(2);
      const names = results.map(n => n.properties.name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('should traverse outgoing relationships (depth 3)', async () => {
      const results = await graph.traverse(alice.id).outgoing('KNOWS').depth(3).collect();

      expect(results.length).toBe(3);
      const names = results.map(n => n.properties.name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'David']);
    });

    it('should traverse without type filter', async () => {
      const results = await graph.traverse(alice.id).outgoing().collect();
      expect(results.length).toBe(1);
    });

    it('should respect limit', async () => {
      const results = await graph.traverse(alice.id).outgoing('KNOWS').depth(3).limit(2).collect();
      expect(results.length).toBe(2);
    });
  });

  describe('TraversalBuilder - Direction', () => {
    let alice: Node, bob: Node;

    beforeEach(async () => {
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
    });

    it('should traverse incoming relationships', async () => {
      const results = await graph.traverse(bob.id).incoming('KNOWS').collect();

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should traverse both directions', async () => {
      const charlie = await graph.createNode(['Person'], { name: 'Charlie' });
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS');

      const results = await graph.traverse(bob.id).both('KNOWS').collect();

      expect(results.length).toBe(2);
      const names = results.map(n => n.properties.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });
  });

  describe('TraversalBuilder - Filters', () => {
    let alice: Node, bob: Node, charlie: Node;

    beforeEach(async () => {
      alice = await graph.createNode(['Person'], { name: 'Alice', age: 30 });
      bob = await graph.createNode(['Person'], { name: 'Bob', age: 25 });
      charlie = await graph.createNode(['Person'], { name: 'Charlie', age: 35 });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(alice.id, charlie.id, 'KNOWS');
    });

    it('should filter nodes by property', async () => {
      const results = await graph
        .traverse(alice.id)
        .outgoing('KNOWS')
        .where({ age: { $gte: 30 } })
        .collect();

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Charlie');
    });

    it('should filter with multiple conditions', async () => {
      const results = await graph
        .traverse(alice.id)
        .outgoing('KNOWS')
        .where({ age: { $lt: 30 }, name: { $startsWith: 'B' } })
        .collect();

      expect(results.length).toBe(1);
      expect(results[0].properties.name).toBe('Bob');
    });
  });

  describe('TraversalBuilder - Unique', () => {
    let alice: Node, bob: Node, charlie: Node;

    beforeEach(async () => {
      // Create a triangle: Alice -> Bob -> Charlie -> Alice
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });
      charlie = await graph.createNode(['Person'], { name: 'Charlie' });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS');
      await graph.createRelationship(charlie.id, alice.id, 'KNOWS');
    });

    it('should prevent revisiting nodes with unique()', async () => {
      const results = await graph.traverse(alice.id).outgoing('KNOWS').depth(10).unique().collect();

      // Should visit Bob and Charlie only once, not loop back to Alice
      expect(results.length).toBe(2);
      const names = results.map(n => n.properties.name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('should allow revisiting without unique()', async () => {
      const results = await graph.traverse(alice.id).outgoing('KNOWS').depth(4).collect();

      // Will loop: Alice -> Bob -> Charlie -> Alice -> Bob
      expect(results.length).toBeGreaterThan(2);
    });
  });

  describe('TraversalBuilder - collectPaths', () => {
    let alice: Node, bob: Node, charlie: Node;

    beforeEach(async () => {
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });
      charlie = await graph.createNode(['Person'], { name: 'Charlie' });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS');
    });

    it('should return paths with nodes and relationships', async () => {
      const paths = await graph.traverse(alice.id).outgoing('KNOWS').depth(2).collectPaths();

      expect(paths.length).toBe(2); // Path to Bob, path to Charlie

      // Check first path (Alice -> Bob)
      expect(paths[0].nodes.length).toBe(2);
      expect(paths[0].relationships.length).toBe(1);
      expect(paths[0].length).toBe(1);

      // Check second path (Alice -> Bob -> Charlie)
      expect(paths[1].nodes.length).toBe(3);
      expect(paths[1].relationships.length).toBe(2);
      expect(paths[1].length).toBe(2);
    });
  });

  describe('TraversalBuilder - collectSubgraph', () => {
    let alice: Node, bob: Node, charlie: Node;

    beforeEach(async () => {
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });
      charlie = await graph.createNode(['Person'], { name: 'Charlie' });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(bob.id, charlie.id, 'KNOWS');
    });

    it('should return all nodes and relationships in traversal', async () => {
      const subgraph = await graph.traverse(alice.id).outgoing('KNOWS').depth(2).collectSubgraph();

      expect(subgraph.nodes.length).toBe(3); // Alice, Bob, Charlie
      expect(subgraph.relationships.length).toBe(2);

      const nodeNames = subgraph.nodes.map(n => n.properties.name).sort();
      expect(nodeNames).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('Shortest Path - BFS (unweighted)', () => {
    let alice: Node, bob: Node, charlie: Node, david: Node, eve: Node;

    beforeEach(async () => {
      // Create a graph with multiple paths
      //     Alice -> Bob -> David
      //       |              ^
      //       v              |
      //     Charlie -> Eve --+
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });
      charlie = await graph.createNode(['Person'], { name: 'Charlie' });
      david = await graph.createNode(['Person'], { name: 'David' });
      eve = await graph.createNode(['Person'], { name: 'Eve' });

      await graph.createRelationship(alice.id, bob.id, 'KNOWS');
      await graph.createRelationship(bob.id, david.id, 'KNOWS');
      await graph.createRelationship(alice.id, charlie.id, 'KNOWS');
      await graph.createRelationship(charlie.id, eve.id, 'KNOWS');
      await graph.createRelationship(eve.id, david.id, 'KNOWS');
    });

    it('should find shortest path between nodes', async () => {
      const path = await graph.shortestPath(alice.id, david.id);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(2); // Alice -> Bob -> David
      expect(path!.nodes.length).toBe(3);
      expect(path!.relationships.length).toBe(2);
    });

    it('should return null if no path exists', async () => {
      const isolated = await graph.createNode(['Person'], { name: 'Isolated' });
      const path = await graph.shortestPath(alice.id, isolated.id);

      expect(path).toBeNull();
    });

    it('should handle direct connection', async () => {
      const path = await graph.shortestPath(alice.id, bob.id);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(1);
      expect(path!.nodes.length).toBe(2);
    });

    it('should respect maxDepth', async () => {
      const path = await graph.shortestPath(alice.id, david.id, { maxDepth: 1 });

      expect(path).toBeNull(); // Can't reach in 1 hop
    });

    it('should filter by relationship type', async () => {
      await graph.createRelationship(alice.id, david.id, 'LOVES');

      const pathKnows = await graph.shortestPath(alice.id, david.id, {
        relationshipTypes: ['KNOWS'],
      });
      expect(pathKnows!.length).toBe(2);

      const pathLoves = await graph.shortestPath(alice.id, david.id, {
        relationshipTypes: ['LOVES'],
      });
      expect(pathLoves!.length).toBe(1);
    });

    it('should respect direction', async () => {
      const path = await graph.shortestPath(david.id, alice.id, { direction: 'outgoing' });
      expect(path).toBeNull();

      const pathIncoming = await graph.shortestPath(david.id, alice.id, { direction: 'incoming' });
      expect(pathIncoming).not.toBeNull();
    });
  });

  describe('Shortest Path - Dijkstra (weighted)', () => {
    let alice: Node, bob: Node, charlie: Node, david: Node;

    beforeEach(async () => {
      // Create a weighted graph
      //     Alice --(1)-> Bob --(1)-> David
      //       |                        ^
      //       +----(10)-> Charlie --(1)+
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });
      charlie = await graph.createNode(['Person'], { name: 'Charlie' });
      david = await graph.createNode(['Person'], { name: 'David' });

      await graph.createRelationship(alice.id, bob.id, 'ROAD', { distance: 1 });
      await graph.createRelationship(bob.id, david.id, 'ROAD', { distance: 1 });
      await graph.createRelationship(alice.id, charlie.id, 'ROAD', { distance: 10 });
      await graph.createRelationship(charlie.id, david.id, 'ROAD', { distance: 1 });
    });

    it('should find shortest weighted path', async () => {
      const path = await graph.shortestPath(alice.id, david.id, { costProperty: 'distance' });

      expect(path).not.toBeNull();
      expect(path!.length).toBe(2); // Alice -> Bob -> David (cost 2)

      const names = path!.nodes.map(n => n.properties.name);
      expect(names).toEqual(['Alice', 'Bob', 'David']);
    });

    it('should use cost property for weighting', async () => {
      // Without cost, both paths would be valid, but with cost Alice->Bob->David is cheaper
      const path = await graph.shortestPath(alice.id, david.id, { costProperty: 'distance' });
      expect(path!.nodes[1].properties.name).toBe('Bob');
    });
  });

  describe('Neighborhood', () => {
    let alice: Node, bob: Node, charlie: Node, david: Node, eve: Node;

    beforeEach(async () => {
      // Create a network
      //     Bob -> Alice -> Charlie
      //             |
      //             v
      //           David -> Eve
      alice = await graph.createNode(['Person'], { name: 'Alice' });
      bob = await graph.createNode(['Person'], { name: 'Bob' });
      charlie = await graph.createNode(['Person'], { name: 'Charlie' });
      david = await graph.createNode(['Person'], { name: 'David' });
      eve = await graph.createNode(['Person'], { name: 'Eve' });

      await graph.createRelationship(bob.id, alice.id, 'KNOWS');
      await graph.createRelationship(alice.id, charlie.id, 'KNOWS');
      await graph.createRelationship(alice.id, david.id, 'KNOWS');
      await graph.createRelationship(david.id, eve.id, 'KNOWS');
    });

    it('should get neighborhood at depth 1', async () => {
      const subgraph = await graph.neighborhood(alice.id, 1);

      expect(subgraph.nodes.length).toBe(4); // Alice, Bob, Charlie, David
      expect(subgraph.relationships.length).toBe(3);
    });

    it('should get neighborhood at depth 2', async () => {
      const subgraph = await graph.neighborhood(alice.id, 2);

      expect(subgraph.nodes.length).toBe(5); // All nodes
      expect(subgraph.relationships.length).toBe(4);
    });

    it('should filter by relationship type', async () => {
      await graph.createRelationship(alice.id, bob.id, 'LOVES');

      const subgraph = await graph.neighborhood(alice.id, 1, {
        relationshipTypes: ['KNOWS'],
      });

      // Should exclude the LOVES relationship
      const nodeNames = subgraph.nodes.map(n => n.properties.name).sort();
      expect(nodeNames).toContain('Charlie');
      expect(nodeNames).toContain('David');
    });

    it('should filter by direction', async () => {
      const subgraph = await graph.neighborhood(alice.id, 1, {
        direction: 'outgoing',
      });

      const nodeNames = subgraph.nodes.map(n => n.properties.name);
      expect(nodeNames).toContain('Charlie');
      expect(nodeNames).toContain('David');
      expect(nodeNames).not.toContain('Bob'); // Bob is incoming only
    });

    it('should filter nodes by properties', async () => {
      await graph.updateNode(charlie.id, { age: 30 });
      await graph.updateNode(david.id, { age: 25 });

      const subgraph = await graph.neighborhood(alice.id, 1, {
        nodeFilter: { age: { $gte: 30 } },
      });

      const nodeNames = subgraph.nodes.map(n => n.properties.name);
      expect(nodeNames).toContain('Charlie');
      expect(nodeNames).not.toContain('David');
    });
  });

  describe('Complex Traversal Patterns', () => {
    it('should handle multi-step traversal with different types', async () => {
      const user = await graph.createNode(['User'], { name: 'User1' });
      const post = await graph.createNode(['Post'], { title: 'My Post' });
      const comment = await graph.createNode(['Comment'], { text: 'Great!' });

      await graph.createRelationship(user.id, post.id, 'CREATED');
      await graph.createRelationship(comment.id, post.id, 'REPLIES_TO');

      // Find all comments on posts created by user (incoming to posts created by user)
      const posts = await graph.traverse(user.id).outgoing('CREATED').collect();
      expect(posts.length).toBe(1);

      const comments = await graph.traverse(posts[0].id).incoming('REPLIES_TO').collect();
      expect(comments.length).toBe(1);
      expect(comments[0].properties.text).toBe('Great!');
    });
  });
});
