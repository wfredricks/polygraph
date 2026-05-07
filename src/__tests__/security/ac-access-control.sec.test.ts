/**
 * NIST 800-53 Rev 5 — AC (Access Control) Security Tests
 *
 * Controls tested:
 *   AC-3  Access Enforcement
 *   AC-4  Information Flow Enforcement
 *   AC-6  Least Privilege
 *
 * Why: PolyGraph has no built-in auth (the host owns identity), but the API
 * must enforce referential integrity, fail predictably on invalid references,
 * and prevent implicit privilege escalation through the API surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../../engine.js';

describe('NIST 800-53: AC — Access Control', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('AC-3: Access Enforcement', () => {
    it('should reject operations on non-existent node IDs', async () => {
      const result = await graph.getNode('non-existent-id');
      expect(result).toBeNull();
    });

    it('should reject relationship creation with non-existent start node', async () => {
      const node = await graph.createNode(['Test'], { name: 'Real' });
      await expect(
        graph.createRelationship('fake-id', node.id, 'LINKS_TO')
      ).rejects.toThrow();
    });

    it('should reject relationship creation with non-existent end node', async () => {
      const node = await graph.createNode(['Test'], { name: 'Real' });
      await expect(
        graph.createRelationship(node.id, 'fake-id', 'LINKS_TO')
      ).rejects.toThrow();
    });

    it('should reject updates to non-existent nodes', async () => {
      await expect(
        graph.updateNode('non-existent-id', { name: 'Hacked' })
      ).rejects.toThrow();
    });

    it('should reject updates to non-existent relationships', async () => {
      await expect(
        graph.updateRelationship('non-existent-id', { weight: 999 })
      ).rejects.toThrow();
    });

    it('should not return data for deleted nodes', async () => {
      const node = await graph.createNode(['Secret'], { data: 'classified' });
      const id = node.id;
      await graph.deleteNode(id);

      const result = await graph.getNode(id);
      expect(result).toBeNull();
    });

    it('should not return data for deleted relationships', async () => {
      const a = await graph.createNode(['A'], {});
      const b = await graph.createNode(['B'], {});
      const rel = await graph.createRelationship(a.id, b.id, 'LINKS');
      const relId = rel.id;
      await graph.deleteRelationship(relId);

      const result = await graph.getRelationship(relId);
      expect(result).toBeNull();
    });
  });

  describe('AC-4: Information Flow Enforcement', () => {
    it('should not allow traversal to reach deleted nodes', async () => {
      const a = await graph.createNode(['Person'], { name: 'Alice' });
      const b = await graph.createNode(['Person'], { name: 'Bob' });
      const c = await graph.createNode(['Person'], { name: 'Charlie' });

      await graph.createRelationship(a.id, b.id, 'KNOWS');
      await graph.createRelationship(b.id, c.id, 'KNOWS');

      // Delete middle node — should break the chain
      await graph.deleteNode(b.id);

      const reachable = await graph.traverse(a.id).outgoing('KNOWS').depth(3).collect();
      expect(reachable).toHaveLength(0);

      // Charlie should be unreachable from Alice
      const path = await graph.shortestPath(a.id, c.id);
      expect(path).toBeNull();
    });

    it('should enforce relationship directionality', async () => {
      const boss = await graph.createNode(['Person'], { name: 'Boss' });
      const worker = await graph.createNode(['Person'], { name: 'Worker' });

      await graph.createRelationship(worker.id, boss.id, 'REPORTS_TO');

      // Worker → Boss: exists
      const outgoing = await graph.traverse(worker.id).outgoing('REPORTS_TO').collect();
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].id).toBe(boss.id);

      // Boss → Worker via outgoing REPORTS_TO: should NOT exist
      const wrongDirection = await graph.traverse(boss.id).outgoing('REPORTS_TO').collect();
      expect(wrongDirection).toHaveLength(0);
    });
  });

  describe('AC-6: Least Privilege', () => {
    it('should not expose internal storage keys through the API', async () => {
      const node = await graph.createNode(['Person'], { name: 'Alice' });

      // Node object should only contain id, labels, properties
      const keys = Object.keys(node);
      expect(keys).toContain('id');
      expect(keys).toContain('labels');
      expect(keys).toContain('properties');
      expect(keys).toHaveLength(3);
    });

    it('should not expose internal storage keys in relationships', async () => {
      const a = await graph.createNode(['A'], {});
      const b = await graph.createNode(['B'], {});
      const rel = await graph.createRelationship(a.id, b.id, 'LINKS');

      const keys = Object.keys(rel);
      expect(keys).toContain('id');
      expect(keys).toContain('type');
      expect(keys).toContain('startNode');
      expect(keys).toContain('endNode');
      expect(keys).toContain('properties');
      expect(keys).toHaveLength(5);
    });

    it('should not expose adapter or internal state through node properties', async () => {
      const node = await graph.createNode(['Test'], {
        name: 'probe',
        __proto__: 'attack',
        constructor: 'attack',
      });

      // Properties should be stored as-is, not interpreted
      const retrieved = await graph.getNode(node.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.properties.name).toBe('probe');
    });

    it('should return only matching results from findNodes — no data leakage', async () => {
      await graph.createNode(['Secret'], { level: 'top-secret', data: 'nuclear codes' });
      await graph.createNode(['Public'], { level: 'public', data: 'weather report' });

      const results = await graph.findNodes('Public');
      expect(results).toHaveLength(1);
      expect(results[0].labels).toContain('Public');
      expect(results[0].labels).not.toContain('Secret');
    });
  });
});
