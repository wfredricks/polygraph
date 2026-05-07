/**
 * NIST 800-53 Rev 5 — SC (System and Communications Protection) Security Tests
 *
 * Controls tested:
 *   SC-4  Information in Shared Resources
 *   SC-28 Protection of Information at Rest
 *
 * Why: Separate graph instances must share no state. Deleted data must not be
 * recoverable through the API. Serialized data must not leak internal structure
 * beyond what the API explicitly returns.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../../engine.js';

describe('NIST 800-53: SC — System and Communications Protection', () => {
  describe('SC-4: Information in Shared Resources', () => {
    it('should isolate data between separate graph instances', async () => {
      const graph1 = new PolyGraph();
      const graph2 = new PolyGraph();
      await graph1.open();
      await graph2.open();

      // Write to graph1
      await graph1.createNode(['Secret'], { data: 'classified-alpha' });

      // graph2 should see nothing
      const stats2 = await graph2.stats();
      expect(stats2.nodeCount).toBe(0);

      const leaked = await graph2.findNodes('Secret');
      expect(leaked).toHaveLength(0);

      await graph1.close();
      await graph2.close();
    });

    it('should not share indexes between graph instances', async () => {
      const graph1 = new PolyGraph();
      const graph2 = new PolyGraph();
      await graph1.open();
      await graph2.open();

      await graph1.createIndex('Person', 'ssn');

      const stats1 = await graph1.stats();
      const stats2 = await graph2.stats();

      expect(stats1.indexCount).toBe(1);
      expect(stats2.indexCount).toBe(0);

      await graph1.close();
      await graph2.close();
    });

    it('should not leak data from one operation context to another', async () => {
      const graph = new PolyGraph();
      await graph.open();

      // Create and delete sensitive data
      const secret = await graph.createNode(['Classified'], {
        content: 'TOP SECRET MATERIAL',
        clearance: 'TS/SCI',
      });
      const secretId = secret.id;

      await graph.deleteNode(secretId);

      // Create a new node — should not inherit any properties from deleted node
      const newNode = await graph.createNode(['Unclassified'], { content: 'public' });
      expect(newNode.properties.clearance).toBeUndefined();
      expect(newNode.properties.content).toBe('public');
      expect(newNode.id).not.toBe(secretId);

      await graph.close();
    });
  });

  describe('SC-28: Protection of Information at Rest', () => {
    it('should not expose raw storage keys through node retrieval', async () => {
      const graph = new PolyGraph();
      await graph.open();

      const node = await graph.createNode(['Person'], { name: 'Alice' });
      const retrieved = await graph.getNode(node.id);

      // The retrieved object should be a clean domain object
      // No storage prefixes (n:, i:, r:, m:) should appear in properties
      const json = JSON.stringify(retrieved);
      expect(json).not.toContain('"n:');
      expect(json).not.toContain('"i:l:');
      expect(json).not.toContain('"i:p:');
      expect(json).not.toContain('"m:nodeCount');

      await graph.close();
    });

    it('should not expose raw storage keys through relationship retrieval', async () => {
      const graph = new PolyGraph();
      await graph.open();

      const a = await graph.createNode(['A'], {});
      const b = await graph.createNode(['B'], {});
      const rel = await graph.createRelationship(a.id, b.id, 'LINKS', { weight: 5 });

      const retrieved = await graph.getRelationship(rel.id);
      const json = JSON.stringify(retrieved);

      expect(json).not.toContain('"r:');
      expect(json).not.toContain('"n:');

      await graph.close();
    });

    it('should not expose raw storage keys through traversal results', async () => {
      const graph = new PolyGraph();
      await graph.open();

      const a = await graph.createNode(['Person'], { name: 'Alice' });
      const b = await graph.createNode(['Person'], { name: 'Bob' });
      await graph.createRelationship(a.id, b.id, 'KNOWS');

      const results = await graph.traverse(a.id).outgoing('KNOWS').collect();
      const json = JSON.stringify(results);

      expect(json).not.toContain('"n:');
      expect(json).not.toContain('"r:');
      expect(json).not.toContain('"i:');

      await graph.close();
    });

    it('should not expose storage keys through findNodes results', async () => {
      const graph = new PolyGraph();
      await graph.open();

      await graph.createNode(['Person'], { name: 'Alice', email: 'alice@example.com' });
      await graph.createIndex('Person', 'email');

      const results = await graph.findNodes('Person', { email: 'alice@example.com' });
      const json = JSON.stringify(results);

      expect(json).not.toContain('"i:p:');
      expect(json).not.toContain('"i:l:');

      await graph.close();
    });

    it('should completely remove deleted data — not accessible via any API path', async () => {
      const graph = new PolyGraph();
      await graph.open();

      // Create a connected subgraph
      const secret = await graph.createNode(['Classified'], { data: 'secret payload' });
      const related = await graph.createNode(['Related'], { ref: 'linked' });
      const rel = await graph.createRelationship(secret.id, related.id, 'REFERENCES');

      const secretId = secret.id;
      const relId = rel.id;

      // Delete everything
      await graph.deleteNode(secret.id);

      // Verify through every API path
      expect(await graph.getNode(secretId)).toBeNull();
      expect(await graph.getRelationship(relId)).toBeNull();
      expect(await graph.findNodes('Classified')).toHaveLength(0);

      const path = await graph.shortestPath(secretId, related.id);
      expect(path).toBeNull();

      // Traversal from the surviving node should not find the deleted one
      const neighbors = await graph.traverse(related.id).both().collect();
      const leakedIds = neighbors.map((n) => n.id);
      expect(leakedIds).not.toContain(secretId);

      await graph.close();
    });
  });
});
