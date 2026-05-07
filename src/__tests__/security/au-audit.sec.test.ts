/**
 * NIST 800-53 Rev 5 — AU (Audit and Accountability) Security Tests
 *
 * Controls tested:
 *   AU-2  Event Logging (capability)
 *   AU-3  Content of Audit Records
 *   AU-12 Audit Record Generation
 *
 * Why: Every mutation must produce a traceable artifact. Node and relationship IDs
 * are immutable and unique. Stats must accurately reflect the true state of the graph
 * at all times — an inaccurate count is an integrity violation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../../engine.js';

describe('NIST 800-53: AU — Audit and Accountability', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('AU-2/AU-12: Event Logging Capability', () => {
    it('should assign unique IDs to every created node', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const node = await graph.createNode(['Test'], { index: i });
        expect(ids.has(node.id)).toBe(false);
        ids.add(node.id);
      }
      expect(ids.size).toBe(100);
    });

    it('should assign unique IDs to every created relationship', async () => {
      const nodes = [];
      for (let i = 0; i < 10; i++) {
        nodes.push(await graph.createNode(['Test'], { index: i }));
      }

      const relIds = new Set<string>();
      for (let i = 0; i < 9; i++) {
        const rel = await graph.createRelationship(nodes[i].id, nodes[i + 1].id, 'CHAIN');
        expect(relIds.has(rel.id)).toBe(false);
        relIds.add(rel.id);
      }
      expect(relIds.size).toBe(9);
    });

    it('should preserve node ID across retrieval (immutability)', async () => {
      const created = await graph.createNode(['Audit'], { event: 'test' });
      const retrieved = await graph.getNode(created.id);
      expect(retrieved!.id).toBe(created.id);
    });

    it('should preserve relationship ID across retrieval (immutability)', async () => {
      const a = await graph.createNode(['A'], {});
      const b = await graph.createNode(['B'], {});
      const created = await graph.createRelationship(a.id, b.id, 'LINKS');
      const retrieved = await graph.getRelationship(created.id);
      expect(retrieved!.id).toBe(created.id);
    });
  });

  describe('AU-3: Content of Audit Records', () => {
    it('should maintain accurate node count through all operations', async () => {
      expect((await graph.stats()).nodeCount).toBe(0);

      const n1 = await graph.createNode(['A'], {});
      expect((await graph.stats()).nodeCount).toBe(1);

      const n2 = await graph.createNode(['B'], {});
      expect((await graph.stats()).nodeCount).toBe(2);

      await graph.deleteNode(n1.id);
      expect((await graph.stats()).nodeCount).toBe(1);

      await graph.deleteNode(n2.id);
      expect((await graph.stats()).nodeCount).toBe(0);
    });

    it('should maintain accurate relationship count through all operations', async () => {
      const a = await graph.createNode(['A'], {});
      const b = await graph.createNode(['B'], {});
      const c = await graph.createNode(['C'], {});

      expect((await graph.stats()).relationshipCount).toBe(0);

      const r1 = await graph.createRelationship(a.id, b.id, 'LINKS');
      expect((await graph.stats()).relationshipCount).toBe(1);

      await graph.createRelationship(b.id, c.id, 'LINKS');
      expect((await graph.stats()).relationshipCount).toBe(2);

      await graph.deleteRelationship(r1.id);
      expect((await graph.stats()).relationshipCount).toBe(1);
    });

    it('should maintain accurate counts after cascade delete', async () => {
      const hub = await graph.createNode(['Hub'], {});
      const spokes = [];
      for (let i = 0; i < 5; i++) {
        const spoke = await graph.createNode(['Spoke'], { index: i });
        spokes.push(spoke);
        await graph.createRelationship(hub.id, spoke.id, 'CONNECTS');
      }

      expect((await graph.stats()).nodeCount).toBe(6);
      expect((await graph.stats()).relationshipCount).toBe(5);

      // Delete hub — should cascade delete all 5 relationships
      await graph.deleteNode(hub.id);

      expect((await graph.stats()).nodeCount).toBe(5);
      expect((await graph.stats()).relationshipCount).toBe(0);
    });

    it('should reflect index count accurately', async () => {
      expect((await graph.stats()).indexCount).toBe(0);

      await graph.createIndex('Person', 'email');
      expect((await graph.stats()).indexCount).toBe(1);

      await graph.createIndex('Person', 'name');
      expect((await graph.stats()).indexCount).toBe(2);

      await graph.dropIndex('Person', 'email');
      expect((await graph.stats()).indexCount).toBe(1);
    });

    it('should not allow stats to go negative', async () => {
      // Delete non-existent — stats should remain at 0, not go negative
      await graph.deleteNode('does-not-exist');
      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.relationshipCount).toBe(0);
    });
  });
});
