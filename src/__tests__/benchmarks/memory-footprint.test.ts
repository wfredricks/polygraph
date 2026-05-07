/**
 * Memory Footprint Benchmarks
 *
 * Why: Government environments often run on constrained hardware.
 * Adopters need to know memory consumption at various graph sizes
 * to capacity-plan their deployments.
 *
 * Measures: heap usage at 1K, 10K, 100K nodes; per-node overhead
 */

import { describe, it, expect } from 'vitest';
import { PolyGraph } from '../../engine.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getHeapUsed(): number {
  if (global.gc) global.gc();
  return process.memoryUsage().heapUsed;
}

describe('Benchmarks: Memory Footprint', () => {
  it('should measure memory for 1,000 nodes', async () => {
    const before = getHeapUsed();

    const graph = new PolyGraph();
    await graph.open();

    for (let i = 0; i < 1_000; i++) {
      await graph.createNode(['Person'], {
        name: `Person-${i}`,
        email: `person${i}@example.com`,
        age: 20 + (i % 50),
      });
    }

    const after = getHeapUsed();
    const used = after - before;
    const perNode = Math.round(used / 1_000);

    console.log(`  1K nodes: ${formatBytes(used)} total, ~${formatBytes(perNode)}/node`);

    expect(used).toBeGreaterThan(0);
    await graph.close();
  });

  it('should measure memory for 10,000 nodes', async () => {
    const before = getHeapUsed();

    const graph = new PolyGraph();
    await graph.open();

    for (let i = 0; i < 10_000; i++) {
      await graph.createNode(['Person'], {
        name: `Person-${i}`,
        email: `person${i}@example.com`,
        age: 20 + (i % 50),
      });
    }

    const after = getHeapUsed();
    const used = after - before;
    const perNode = Math.round(used / 10_000);

    console.log(`  10K nodes: ${formatBytes(used)} total, ~${formatBytes(perNode)}/node`);

    expect(used).toBeGreaterThan(0);
    await graph.close();
  });

  it('should measure memory for 10,000 nodes + 20,000 relationships', async () => {
    const before = getHeapUsed();

    const graph = new PolyGraph();
    await graph.open();

    const nodes: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const n = await graph.createNode(['Person'], {
        name: `Person-${i}`,
        age: 20 + (i % 50),
      });
      nodes.push(n.id);
    }

    for (let i = 0; i < 20_000; i++) {
      const from = nodes[i % nodes.length];
      const to = nodes[(i * 7 + 3) % nodes.length];
      if (from !== to) {
        await graph.createRelationship(from, to, 'KNOWS', { weight: Math.random() });
      }
    }

    const after = getHeapUsed();
    const used = after - before;

    const stats = await graph.stats();
    const perEntity = Math.round(used / (stats.nodeCount + stats.relationshipCount));

    console.log(`  10K nodes + 20K rels: ${formatBytes(used)} total, ~${formatBytes(perEntity)}/entity`);

    expect(used).toBeGreaterThan(0);
    await graph.close();
  });

  it('should measure overhead of empty graph instance', async () => {
    const before = getHeapUsed();

    const graph = new PolyGraph();
    await graph.open();

    const after = getHeapUsed();
    const overhead = after - before;

    console.log(`  Empty graph overhead: ${formatBytes(overhead)}`);

    // An empty graph should use less than 1MB
    expect(overhead).toBeLessThan(1024 * 1024);
    await graph.close();
  });
});
