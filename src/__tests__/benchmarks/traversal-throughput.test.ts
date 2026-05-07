/**
 * Traversal Throughput Benchmarks
 *
 * Why: Graph traversal is what makes a graph database valuable. Adopters need
 * to know how fast PolyGraph walks the graph at various depths and scales.
 *
 * Measures: traversal collect, shortest path, neighborhood extraction
 * Graph topologies: chain, tree, social network (random connections)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../../engine.js';
import type { Node } from '../../types.js';

async function benchmark(name: string, count: number, fn: (i: number) => Promise<void>): Promise<{
  name: string;
  count: number;
  totalMs: number;
  opsPerSec: number;
  avgLatencyUs: number;
}> {
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await fn(i);
  }
  const totalMs = performance.now() - start;
  const opsPerSec = Math.round((count / totalMs) * 1000);
  const avgLatencyUs = Math.round((totalMs / count) * 1000);

  console.log(`  ${name}: ${opsPerSec.toLocaleString()} ops/sec (${avgLatencyUs}µs avg, ${count} ops in ${totalMs.toFixed(1)}ms)`);

  return { name, count, totalMs, opsPerSec, avgLatencyUs };
}

/** Seed a pseudo-random number from an index (deterministic) */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

describe('Benchmarks: Traversal Throughput', { timeout: 60_000 }, () => {
  describe('Chain Topology (linked list)', () => {
    let graph: PolyGraph;
    let chainNodes: Node[];

    beforeEach(async () => {
      graph = new PolyGraph();
      await graph.open();

      // Build a chain of 1000 nodes: A→B→C→...
      chainNodes = [];
      for (let i = 0; i < 1_000; i++) {
        chainNodes.push(await graph.createNode(['ChainNode'], { index: i }));
      }
      for (let i = 0; i < 999; i++) {
        await graph.createRelationship(chainNodes[i].id, chainNodes[i + 1].id, 'NEXT');
      }

      console.log('  [Chain: 1,000 nodes, 999 relationships]');
    });

    it('should benchmark depth-1 traversal on chain', async () => {
      const result = await benchmark('Chain depth-1', 1_000, async (i) => {
        const results = await graph.traverse(chainNodes[i].id).outgoing('NEXT').collect();
        expect(results.length).toBeLessThanOrEqual(1);
      });

      expect(result.opsPerSec).toBeGreaterThan(500);
    });

    it('should benchmark depth-10 traversal on chain', async () => {
      const result = await benchmark('Chain depth-10', 500, async (i) => {
        const results = await graph.traverse(chainNodes[i % 990].id).outgoing('NEXT').depth(10).collect();
        expect(results.length).toBeLessThanOrEqual(10);
      });

      expect(result.opsPerSec).toBeGreaterThan(100);
    });

    it('should benchmark shortest path on chain', async () => {
      const result = await benchmark('Shortest path (chain, ~50 hops)', 100, async (i) => {
        const start = chainNodes[i * 9];
        const end = chainNodes[Math.min(i * 9 + 50, 999)];
        const path = await graph.shortestPath(start.id, end.id, {
          direction: 'outgoing',
          relationshipTypes: ['NEXT'],
        });
        expect(path).not.toBeNull();
      });

      expect(result.opsPerSec).toBeGreaterThan(5);
    });
  });

  describe('Tree Topology (branching factor 5, depth 4)', () => {
    let graph: PolyGraph;
    let root: Node;
    let allNodes: Node[];

    beforeEach(async () => {
      graph = new PolyGraph();
      await graph.open();

      // Build a tree: branching factor 5, depth 4
      // Total nodes: 1 + 5 + 25 + 125 + 625 = 781
      allNodes = [];
      root = await graph.createNode(['TreeNode'], { depth: 0, name: 'root' });
      allNodes.push(root);

      let currentLevel = [root];
      for (let d = 1; d <= 4; d++) {
        const nextLevel: Node[] = [];
        for (const parent of currentLevel) {
          for (let c = 0; c < 5; c++) {
            const child = await graph.createNode(['TreeNode'], { depth: d, name: `d${d}c${c}` });
            allNodes.push(child);
            nextLevel.push(child);
            await graph.createRelationship(parent.id, child.id, 'CHILD_OF');
          }
        }
        currentLevel = nextLevel;
      }

      const stats = await graph.stats();
      console.log(`  [Tree: ${stats.nodeCount} nodes, ${stats.relationshipCount} relationships, BF=5 D=4]`);
    });

    it('should benchmark depth-1 traversal on tree (5 children)', async () => {
      const result = await benchmark('Tree depth-1 (5 children)', 500, async () => {
        const results = await graph.traverse(root.id).outgoing('CHILD_OF').collect();
        expect(results.length).toBe(5);
      });

      expect(result.opsPerSec).toBeGreaterThan(1000);
    });

    it('should benchmark depth-2 traversal on tree (30 nodes)', async () => {
      const result = await benchmark('Tree depth-2 (30 descendants)', 200, async () => {
        const results = await graph.traverse(root.id).outgoing('CHILD_OF').depth(2).collect();
        expect(results.length).toBe(30); // 5 + 25
      });

      expect(result.opsPerSec).toBeGreaterThan(100);
    });

    it('should benchmark depth-4 traversal (full tree, 780 nodes)', async () => {
      const result = await benchmark('Tree depth-4 (full, 780 nodes)', 20, async () => {
        const results = await graph.traverse(root.id).outgoing('CHILD_OF').depth(4).collect();
        expect(results.length).toBe(780);
      });

      expect(result.opsPerSec).toBeGreaterThan(1);
    });

    it('should benchmark neighborhood extraction (depth 2)', async () => {
      const result = await benchmark('Neighborhood depth-2 (tree root)', 200, async () => {
        const subgraph = await graph.neighborhood(root.id, 2);
        expect(subgraph.nodes.length).toBe(31); // root + 5 + 25
      });

      expect(result.opsPerSec).toBeGreaterThan(100);
    });
  });

  describe('Social Network Topology (random connections)', () => {
    let graph: PolyGraph;
    let people: Node[];

    beforeEach(async () => {
      graph = new PolyGraph();
      await graph.open();

      // Build a social network: 1000 people, ~5 connections each
      people = [];
      for (let i = 0; i < 1_000; i++) {
        people.push(await graph.createNode(['Person'], {
          name: `Person-${i}`,
          age: 20 + (i % 50),
          city: ['NYC', 'LA', 'Chicago', 'Houston', 'Phoenix'][i % 5],
        }));
      }

      // Each person connects to ~5 random others (deterministic seed)
      let relCount = 0;
      for (let i = 0; i < 1_000; i++) {
        const connectionCount = 3 + Math.floor(seededRandom(i) * 5); // 3-7 connections
        for (let c = 0; c < connectionCount; c++) {
          const target = Math.floor(seededRandom(i * 100 + c) * 1_000);
          if (target !== i) {
            await graph.createRelationship(people[i].id, people[target].id, 'KNOWS');
            relCount++;
          }
        }
      }

      console.log(`  [Social: 1,000 people, ${relCount} connections]`);
    });

    it('should benchmark depth-1 traversal (direct friends)', async () => {
      const result = await benchmark('Social depth-1 (direct friends)', 200, async (i) => {
        await graph.traverse(people[i % 1000].id).outgoing('KNOWS').collect();
      });

      expect(result.opsPerSec).toBeGreaterThan(100);
    });

    it('should benchmark depth-2 traversal (friends of friends)', async () => {
      const result = await benchmark('Social depth-2 (FoF)', 100, async (i) => {
        await graph.traverse(people[i % 1000].id).outgoing('KNOWS').depth(2).unique().collect();
      });

      expect(result.opsPerSec).toBeGreaterThan(10);
    });

    it('should benchmark filtered traversal', async () => {
      const result = await benchmark('Social depth-1 filtered (age > 40)', 200, async (i) => {
        await graph
          .traverse(people[i % 1000].id)
          .outgoing('KNOWS')
          .where({ age: { $gt: 40 } })
          .collect();
      });

      expect(result.opsPerSec).toBeGreaterThan(100);
    });

    it('should benchmark shortest path in social network', async () => {
      const result = await benchmark('Shortest path (social, random pairs)', 10, async (i) => {
        const from = people[i * 19 % 1000];
        const to = people[(i * 19 + 500) % 1000];
        await graph.shortestPath(from.id, to.id, {
          relationshipTypes: ['KNOWS'],
          direction: 'outgoing',
          maxDepth: 4,
        });
      });

      // Social BFS is expensive on dense graphs — direction constraint helps
      expect(result.opsPerSec).toBeGreaterThan(0);
    });

    it('should benchmark neighborhood in social network', async () => {
      const result = await benchmark('Neighborhood depth-2 (social)', 50, async (i) => {
        await graph.neighborhood(people[i % 1000].id, 2, {
          relationshipTypes: ['KNOWS'],
          direction: 'outgoing',
        });
      });

      expect(result.opsPerSec).toBeGreaterThan(5);
    });
  });
});
