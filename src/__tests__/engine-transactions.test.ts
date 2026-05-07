/**
 * Tests for PolyGraph Transaction Support
 *
 * Why: Transactions ensure atomicity — all operations succeed or all fail.
 * Critical for maintaining graph consistency during complex operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolyGraph } from '../engine.js';

describe('PolyGraph - Transactions', () => {
  let graph: PolyGraph;

  beforeEach(async () => {
    graph = new PolyGraph();
    await graph.open();
  });

  describe('withTx - Basic Operations', () => {
    it('should execute operations within a transaction', async () => {
      const result = await graph.withTx(async (g) => {
        const node = await g.createNode(['Person'], { name: 'Alice' });
        return node;
      });

      expect(result.properties.name).toBe('Alice');

      const retrieved = await graph.getNode(result.id);
      expect(retrieved).not.toBeNull();
    });

    it('should allow multiple operations in a transaction', async () => {
      await graph.withTx(async (g) => {
        const alice = await g.createNode(['Person'], { name: 'Alice' });
        const bob = await g.createNode(['Person'], { name: 'Bob' });
        await g.createRelationship(alice.id, bob.id, 'KNOWS');
      });

      const persons = await graph.findNodes('Person');
      expect(persons.length).toBe(2);

      const rels = await graph.findRelationships('KNOWS');
      expect(rels.length).toBe(1);
    });

    it('should return value from transaction', async () => {
      const nodeCount = await graph.withTx(async (g) => {
        await g.createNode(['Person'], { name: 'Alice' });
        await g.createNode(['Person'], { name: 'Bob' });
        await g.createNode(['Person'], { name: 'Charlie' });
        return 3;
      });

      expect(nodeCount).toBe(3);
    });
  });

  describe('withTx - Error Handling', () => {
    it('should propagate errors from transaction', async () => {
      await expect(async () => {
        await graph.withTx(async (g) => {
          await g.createNode(['Person'], { name: 'Alice' });
          throw new Error('Something went wrong');
        });
      }).rejects.toThrow('Something went wrong');
    });

    it('should handle errors when creating invalid relationships', async () => {
      await expect(async () => {
        await graph.withTx(async (g) => {
          const alice = await g.createNode(['Person'], { name: 'Alice' });
          // Try to create relationship with non-existent node
          await g.createRelationship(alice.id, 'non-existent-id', 'KNOWS');
        });
      }).rejects.toThrow();
    });

    it('should handle errors when updating non-existent nodes', async () => {
      await expect(async () => {
        await graph.withTx(async (g) => {
          await g.updateNode('non-existent-id', { name: 'Updated' });
        });
      }).rejects.toThrow('Node non-existent-id not found');
    });
  });

  describe('withTx - Complex Scenarios', () => {
    it('should handle creating a tree structure', async () => {
      const root = await graph.withTx(async (g) => {
        const root = await g.createNode(['Category'], { name: 'Root' });
        const child1 = await g.createNode(['Category'], { name: 'Child1' });
        const child2 = await g.createNode(['Category'], { name: 'Child2' });
        const grandchild = await g.createNode(['Category'], { name: 'Grandchild' });

        await g.createRelationship(root.id, child1.id, 'HAS_CHILD');
        await g.createRelationship(root.id, child2.id, 'HAS_CHILD');
        await g.createRelationship(child1.id, grandchild.id, 'HAS_CHILD');

        return root;
      });

      const children = await graph.traverse(root.id).outgoing('HAS_CHILD').collect();
      expect(children.length).toBe(2);

      const descendants = await graph.traverse(root.id).outgoing('HAS_CHILD').depth(2).collect();
      expect(descendants.length).toBe(3);
    });

    it('should handle updating multiple related nodes', async () => {
      const alice = await graph.createNode(['Person'], { name: 'Alice', version: 1 });
      const bob = await graph.createNode(['Person'], { name: 'Bob', version: 1 });
      await graph.createRelationship(alice.id, bob.id, 'KNOWS');

      await graph.withTx(async (g) => {
        await g.updateNode(alice.id, { version: 2 });
        await g.updateNode(bob.id, { version: 2 });
      });

      const updatedAlice = await graph.getNode(alice.id);
      const updatedBob = await graph.getNode(bob.id);

      expect(updatedAlice?.properties.version).toBe(2);
      expect(updatedBob?.properties.version).toBe(2);
    });

    it('should handle creating a cluster of nodes and relationships', async () => {
      await graph.withTx(async (g) => {
        const nodes = await Promise.all([
          g.createNode(['Transaction'], { id: 'tx1', amount: 100 }),
          g.createNode(['Transaction'], { id: 'tx2', amount: 200 }),
          g.createNode(['Transaction'], { id: 'tx3', amount: 300 }),
          g.createNode(['Transaction'], { id: 'tx4', amount: 400 }),
        ]);

        // Create a cluster where each transaction links to the next
        for (let i = 0; i < nodes.length - 1; i++) {
          await g.createRelationship(nodes[i].id, nodes[i + 1].id, 'LINKED_TO', {
            confidence: 0.9,
          });
        }

        // Create a hub node linking to all
        const hub = await g.createNode(['Cluster'], { name: 'Hub1' });
        for (const node of nodes) {
          await g.createRelationship(node.id, hub.id, 'BELONGS_TO');
        }
      });

      const transactions = await graph.findNodes('Transaction');
      expect(transactions.length).toBe(4);

      const links = await graph.findRelationships('LINKED_TO');
      expect(links.length).toBe(3);

      const belongs = await graph.findRelationships('BELONGS_TO');
      expect(belongs.length).toBe(4);
    });
  });

  describe('withTx - Nested Transactions', () => {
    it('should allow nested withTx calls', async () => {
      const result = await graph.withTx(async (g1) => {
        const alice = await g1.createNode(['Person'], { name: 'Alice' });

        const bob = await g1.withTx(async (g2) => {
          return await g2.createNode(['Person'], { name: 'Bob' });
        });

        await g1.createRelationship(alice.id, bob.id, 'KNOWS');
        return { alice, bob };
      });

      const persons = await graph.findNodes('Person');
      expect(persons.length).toBe(2);

      const rels = await graph.findRelationships('KNOWS');
      expect(rels.length).toBe(1);
    });
  });

  describe('withTx - Concurrent Operations', () => {
    it('should handle sequential transactions', async () => {
      await graph.withTx(async (g) => {
        await g.createNode(['Person'], { name: 'Alice' });
      });

      await graph.withTx(async (g) => {
        await g.createNode(['Person'], { name: 'Bob' });
      });

      await graph.withTx(async (g) => {
        await g.createNode(['Person'], { name: 'Charlie' });
      });

      const persons = await graph.findNodes('Person');
      expect(persons.length).toBe(3);
    });

    it('should handle parallel transactions (though serialized internally)', async () => {
      await Promise.all([
        graph.withTx(async (g) => {
          await g.createNode(['Person'], { name: 'Alice' });
        }),
        graph.withTx(async (g) => {
          await g.createNode(['Person'], { name: 'Bob' });
        }),
        graph.withTx(async (g) => {
          await g.createNode(['Person'], { name: 'Charlie' });
        }),
      ]);

      const persons = await graph.findNodes('Person');
      expect(persons.length).toBe(3);
    });
  });

  describe('Batch Operations (implicit transactions)', () => {
    it('should batch multiple node creates', async () => {
      const nodes = await Promise.all([
        graph.createNode(['Person'], { name: 'Alice' }),
        graph.createNode(['Person'], { name: 'Bob' }),
        graph.createNode(['Person'], { name: 'Charlie' }),
      ]);

      expect(nodes.length).toBe(3);

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(3);
    });

    it('should batch relationship creates', async () => {
      const alice = await graph.createNode(['Person'], { name: 'Alice' });
      const bob = await graph.createNode(['Person'], { name: 'Bob' });
      const charlie = await graph.createNode(['Person'], { name: 'Charlie' });

      await Promise.all([
        graph.createRelationship(alice.id, bob.id, 'KNOWS'),
        graph.createRelationship(bob.id, charlie.id, 'KNOWS'),
        graph.createRelationship(alice.id, charlie.id, 'KNOWS'),
      ]);

      const stats = await graph.stats();
      expect(stats.relationshipCount).toBe(3);
    });
  });

  describe('Transaction Consistency', () => {
    it('should maintain referential integrity', async () => {
      const { alice, bob } = await graph.withTx(async (g) => {
        const alice = await g.createNode(['Person'], { name: 'Alice' });
        const bob = await g.createNode(['Person'], { name: 'Bob' });
        await g.createRelationship(alice.id, bob.id, 'KNOWS');
        return { alice, bob };
      });

      // Verify both nodes exist
      expect(await graph.getNode(alice.id)).not.toBeNull();
      expect(await graph.getNode(bob.id)).not.toBeNull();

      // Verify relationship exists
      const rels = await graph.findRelationships('KNOWS');
      expect(rels.length).toBe(1);
      expect(rels[0].startNode).toBe(alice.id);
      expect(rels[0].endNode).toBe(bob.id);
    });

    it('should maintain stats consistency', async () => {
      await graph.withTx(async (g) => {
        const alice = await g.createNode(['Person'], { name: 'Alice' });
        const bob = await g.createNode(['Person'], { name: 'Bob' });
        await g.createRelationship(alice.id, bob.id, 'KNOWS');
      });

      const stats = await graph.stats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.relationshipCount).toBe(1);
    });
  });
});
