/**
 * CRUD Throughput Benchmarks
 *
 * Why: Adopters need to know ops/sec for basic operations before committing
 * to PolyGraph. These numbers are the first thing an evaluator looks for.
 *
 * Measures: node create, read, update, delete; relationship create, read, delete
 * Reports: ops/sec and average latency per operation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../../engine.js';
import type { Node } from '../../types.js';

/** Run an operation N times and return timing stats */
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

describe('Benchmarks: CRUD Throughput', { timeout: 30_000 }, () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('Node Operations', () => {
    it('should benchmark node creation throughput', async () => {
      const result = await benchmark('Node CREATE', 10_000, async (i) => {
        await graph.createNode(['Person'], { name: `Person-${i}`, index: i });
      });

      expect(result.opsPerSec).toBeGreaterThan(1000);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(10_000);
    });

    it('should benchmark node read throughput', async () => {
      // Setup: create nodes first
      const ids: string[] = [];
      for (let i = 0; i < 10_000; i++) {
        const node = await graph.createNode(['Person'], { name: `Person-${i}` });
        ids.push(node.id);
      }

      const result = await benchmark('Node READ', 10_000, async (i) => {
        await graph.getNode(ids[i]);
      });

      expect(result.opsPerSec).toBeGreaterThan(5000);
    });

    it('should benchmark node update throughput', async () => {
      // Setup
      const ids: string[] = [];
      for (let i = 0; i < 5_000; i++) {
        const node = await graph.createNode(['Person'], { name: `Person-${i}`, version: 0 });
        ids.push(node.id);
      }

      const result = await benchmark('Node UPDATE', 5_000, async (i) => {
        await graph.updateNode(ids[i], { version: 1, updatedAt: Date.now() });
      });

      expect(result.opsPerSec).toBeGreaterThan(1000);
    });

    it('should benchmark node delete throughput', async () => {
      // Setup: create nodes (no relationships — pure delete speed)
      const ids: string[] = [];
      for (let i = 0; i < 2_000; i++) {
        const node = await graph.createNode(['Temp'], { index: i });
        ids.push(node.id);
      }

      const result = await benchmark('Node DELETE', 2_000, async (i) => {
        await graph.deleteNode(ids[i]);
      });

      expect(result.opsPerSec).toBeGreaterThan(100);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(0);
    });

    it('should benchmark findNodes with label scan', async () => {
      // Setup: 10K nodes across 3 labels
      for (let i = 0; i < 3_000; i++) {
        await graph.createNode(['Engineer'], { name: `Eng-${i}`, level: i % 5 });
      }
      for (let i = 0; i < 5_000; i++) {
        await graph.createNode(['Manager'], { name: `Mgr-${i}` });
      }
      for (let i = 0; i < 2_000; i++) {
        await graph.createNode(['Director'], { name: `Dir-${i}` });
      }

      const result = await benchmark('findNodes (label scan, 3K)', 100, async () => {
        const results = await graph.findNodes('Engineer');
        expect(results.length).toBe(3_000);
      });

      expect(result.opsPerSec).toBeGreaterThan(10);
    });

    it('should benchmark findNodes with property index', async () => {
      // Setup
      await graph.createIndex('Person', 'email');
      for (let i = 0; i < 10_000; i++) {
        await graph.createNode(['Person'], {
          name: `Person-${i}`,
          email: `person${i}@example.com`,
        });
      }

      const result = await benchmark('findNodes (indexed, 10K pool)', 1_000, async (i) => {
        const results = await graph.findNodes('Person', {
          email: `person${i}@example.com`,
        });
        expect(results.length).toBe(1);
      });

      // Indexed lookups include deserialization overhead; 100+ ops/sec is healthy
      expect(result.opsPerSec).toBeGreaterThan(50);
    });
  });

  describe('Relationship Operations', () => {
    let nodes: Node[];

    beforeEach(async () => {
      // Pre-create 1000 nodes for relationship benchmarks
      nodes = [];
      for (let i = 0; i < 1_000; i++) {
        nodes.push(await graph.createNode(['Person'], { index: i }));
      }
    });

    it('should benchmark relationship creation throughput', async () => {
      const result = await benchmark('Relationship CREATE', 5_000, async (i) => {
        const from = nodes[i % nodes.length];
        const to = nodes[(i + 1) % nodes.length];
        await graph.createRelationship(from.id, to.id, 'KNOWS', { weight: Math.random() });
      });

      expect(result.opsPerSec).toBeGreaterThan(1000);
    });

    it('should benchmark relationship read throughput', async () => {
      // Setup: create relationships
      const relIds: string[] = [];
      for (let i = 0; i < 5_000; i++) {
        const rel = await graph.createRelationship(
          nodes[i % nodes.length].id,
          nodes[(i + 1) % nodes.length].id,
          'KNOWS'
        );
        relIds.push(rel.id);
      }

      const result = await benchmark('Relationship READ', 5_000, async (i) => {
        await graph.getRelationship(relIds[i]);
      });

      expect(result.opsPerSec).toBeGreaterThan(5000);
    });

    it('should benchmark cascade delete (node with relationships)', async () => {
      // Setup: create hub-and-spoke pattern (each hub has 10 relationships)
      const hubs: string[] = [];
      for (let i = 0; i < 500; i++) {
        const hub = await graph.createNode(['Hub'], { index: i });
        hubs.push(hub.id);
        for (let j = 0; j < 10; j++) {
          const spoke = nodes[(i * 10 + j) % nodes.length];
          await graph.createRelationship(hub.id, spoke.id, 'CONNECTS');
        }
      }

      const result = await benchmark('Cascade DELETE (10 rels each)', 500, async (i) => {
        await graph.deleteNode(hubs[i]);
      });

      expect(result.opsPerSec).toBeGreaterThan(50);
    });
  });
});
